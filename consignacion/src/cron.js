// Tareas programadas (wrangler.toml → triggers.crons): reservas vencidas cada 5 min y el
// resumen diario (alertas por WhatsApp, respaldo semanal por correo).
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
import { ADMIN_WA, fetchResend, fijarSbCorreo, probarCorreo } from "./lib/avisos.js";
import { generarCierreMes } from "./lib/cierre-mensual.js";
import { auditarStock } from "./lib/codigos.js";
import { liberarReservasVencidas } from "./lib/reservas.js";
import { Supabase } from "./lib/supabase.js";
import { diasParaCorteVend } from "./lib/vendedores.js";

export async function tareasProgramadas(event, env, ctx) {
  const sb = new Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  fijarSbCorreo(sb);

  // ── CRON CADA 5 MIN: liberar reservas de stock vencidas ──
  // Pedidos que reservaron pieza al crearse (REGISTRAR_LEAD) pero nadie
  // confirmó en 30 min (cliente no completó el pago, etc.) — se liberan
  // solas para no dejar piezas "atascadas" como no disponibles para
  // siempre. Un cron aparte del diario de abajo, distinguido por el
  // patrón exacto del schedule (ver wrangler.toml).
  if (event.cron === "*/5 * * * *") {
    await liberarReservasVencidas(sb);
    return;
  }

  // ── CRON DIARIO: alertas pedidos pendientes +2 días, cortes por vencer
  // y reposiciones pendientes — todo en un solo WhatsApp, para no depender
  // de que el admin entre a NEXUS a verlas. ──
  const todos = await sb.getAll("pedidos");
  const hace2dias = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const pendientes = todos.filter(p =>
    (p.estado === "Pendiente" || p.estado === "En camino") &&
    new Date(p.fecha).getTime() < hace2dias
  );

  const secciones = [];

  if (pendientes.length) {
    const lista = pendientes.map(p =>
      `• ${p.numeroPedido} — ${p.cliente} ($${parseFloat(p.total||0).toFixed(2)}) — ${p.estado}`
    ).join("\n");
    secciones.push(`⚠️ ${pendientes.length} pedido(s) llevan +2 días sin actualizar:\n${lista}`);
  }

  // Mismo cálculo que usa NEXUS para "Cortes por vencer" (dias<=1 antes
  // de cumplirse los 30 días desde fechaCorte, porque ahí se pagan
  // comisiones) y "Piezas por reponer" (reposicionesPendientes por vendedor).
  // Solo cuentan vendedores con Link Inventario vigente (tokenInventario, que
  // se borra al cortar): sin link no está activo y no hay corte pendiente. Un
  // afiliado sin piezas no tiene ese link — su catálogo vive en Admin y desde
  // acá no se puede consultar — así que no entra en este aviso; sí aparece en
  // NEXUS, que lo consulta en vivo.
  const todosVendCron = await sb.getAll("vendedores");
  const cortesCron = todosVendCron
    .filter(v => v.tokenInventario)
    .map(v => ({ v, dias: diasParaCorteVend(v) }))
    .filter(({dias}) => dias !== null && dias <= 1);
  if (cortesCron.length) {
    const lista = cortesCron.map(({v, dias}) => {
      const msgD = dias < 0 ? `vencido hace ${Math.abs(dias)}d` : dias === 0 ? "vence hoy" : "vence mañana";
      return `• ${v.nombre} — ${msgD}`;
    }).join("\n");
    secciones.push(`🧾 Cortes por vencer:\n${lista}`);
  }

  const reposicionesCron = [];
  for (const v of todosVendCron) {
    for (const r of (v.reposicionesPendientes || [])) {
      reposicionesCron.push(`• ${v.nombre} — ${r.codigo} (${r.nombre||""})`);
    }
  }
  if (reposicionesCron.length) {
    secciones.push(`📦 Reposiciones pendientes (venta bajo pedido):\n${reposicionesCron.join("\n")}`);
  }

  // ── SALUD DE LOS CORREOS: manda una prueba diaria a la dirección de pruebas de Resend (no llega a nadie)
  // para detectar a tiempo si el envío dejó de funcionar (clave, dominio verificado, límite) — el aviso va
  // por WhatsApp, que no depende de los correos. ──
  try {
    const hb = await probarCorreo(env, "delivered@resend.dev");
    if (!hb.ok) {
      const causa = hb.motivo === "falta_clave" ? "falta la clave RESEND_KEY"
        : hb.status === 401 || hb.status === 403 ? `Resend rechazó el envío (HTTP ${hb.status}): ${String(hb.detalle || "").slice(0, 160)}`
        : `error ${hb.status || hb.motivo || ""}: ${String(hb.detalle || "").slice(0, 120)}`;
      secciones.push(`📧 Los CORREOS del sistema NO están saliendo (pedidos, pagos, envíos, respaldo semanal). ${causa}\nRevisa Resend (clave y dominio) y prueba desde el hub → Pedidos → "Probar el envío de correos".`);
    }
  } catch (hbErr) { console.error("Chequeo diario de correos falló:", hbErr); }

  // ── AUDITORÍA DIARIA DE STOCK: detecta descuadres (total, negativos, consignación vs. registros, huérfanos) antes
  // de que se acumulen. Solo avisa si hay algo; si la propia auditoría falla, también avisa (no falla en silencio). ──
  try {
    const aud = await auditarStock(sb);
    const r = aud.resumen, n = r.discrepancias + r.negativos + r.huerfanas + r.totalDescuadrado;
    await sb.set("config", "auditoria_stock", { fecha: aud.generadoEn, ok: n === 0, resumen: r,
      muestra: { discrepancias: aud.discrepanciasConsignacion.slice(0, 20), negativos: aud.negativos.slice(0, 20), totalDescuadrado: aud.totalDescuadrado.slice(0, 20), huerfanas: aud.consHuerfanas.slice(0, 20) } }).catch(() => {});
    if (n > 0) {
      const top = (arr, f) => arr.slice(0, 8).map(f).join("\n") + (arr.length > 8 ? `\n… y ${arr.length - 8} más` : "");
      const partes = [];
      if (aud.totalDescuadrado.length) partes.push(`• ${aud.totalDescuadrado.length} con stock_total que no suma:\n${top(aud.totalDescuadrado, x => `   ${x.codigo}: total ${x.stock_total}, suma ${x.suma}`)}`);
      if (aud.negativos.length) partes.push(`• ${aud.negativos.length} con cantidades negativas:\n${top(aud.negativos, x => `   ${x.codigo}`)}`);
      if (aud.discrepanciasConsignacion.length) partes.push(`• ${aud.discrepanciasConsignacion.length} donde Stock no coincide con lo que tienen los vendedores:\n${top(aud.discrepanciasConsignacion, x => `   ${x.codigo}: Stock ${x.stock_consignacion_registrado}, vendedores ${x.consignacion_real}`)}`);
      if (aud.consHuerfanas.length) partes.push(`• ${aud.consHuerfanas.length} consignaciones de códigos que ya no existen en Stock`);
      secciones.push(`🔎 Auditoría de stock: ${n} producto(s) con descuadre\n${partes.join("\n")}\nDetalle: Consignación → Stock → 🔍 Auditoría`);
    }
    // Categorías de la tienda: un anillo (dúo, trío o suelto) nunca debe estar en «Conjuntos», ni nada fuera de su categoría
    if (aud.categoriasDudosas.length) {
      const cd = aud.categoriasDudosas, top8 = cd.slice(0, 8).map(x => `   ${x.codigo}: ${x.motivo}`).join("\n") + (cd.length > 8 ? `\n… y ${cd.length - 8} más` : "");
      secciones.push(`🧩 ${cd.length} producto(s) en la categoría equivocada de la tienda:\n${top8}\nCorregir: Consignación → Stock → 🧩 Categorías`);
    }
  } catch (audErr) {
    console.error("Auditoría diaria de stock falló:", audErr);
    secciones.push("🔎 La auditoría diaria de stock NO pudo ejecutarse (" + String(audErr && audErr.message || audErr).slice(0, 120) + "). Revisa el Worker.");
  }

  if (secciones.length) {
    const msg = encodeURIComponent(
      `VEREX — avisos del día:\n\n${secciones.join("\n\n")}\n\n📋 Revisa todo en: https://admin-tienda.pages.dev`
    );
    // Enviar via CallMeBot API (gratis, solo requiere registro inicial)
    const apikey = env.CALLMEBOT_KEY || "";
    if (apikey) {
      await fetch(`https://api.callmebot.com/whatsapp.php?phone=${ADMIN_WA}&text=${msg}&apikey=${apikey}`).catch(()=>{});
    }
  }

  // ── CIERRE MENSUAL AUTOMÁTICO: el día 1 de cada mes, genera el cierre
  // del mes que acaba de terminar (si todavía no existe) — cero pasos
  // manuales, el admin solo lo revisa en Admin VEREX → 📅 Cierres. ──
  if (new Date().getUTCDate() === 1) {
    try {
      const ahoraCierre = new Date();
      let mesAnt = ahoraCierre.getUTCMonth() - 1, anioAnt = ahoraCierre.getUTCFullYear();
      if (mesAnt < 0) { mesAnt = 11; anioAnt -= 1; }
      const idCierreAnt = `${anioAnt}-${String(mesAnt + 1).padStart(2, "0")}`;
      const cfgCierreCron = await sb.get("config", "cierres_mensuales");
      const listaCierreCron = (cfgCierreCron && Array.isArray(cfgCierreCron.lista)) ? cfgCierreCron.lista : [];
      if (!listaCierreCron.some(c => c.id === idCierreAnt)) {
        const nuevoCierreCron = await generarCierreMes(sb, anioAnt, mesAnt);
        listaCierreCron.push(nuevoCierreCron);
        listaCierreCron.sort((a, b) => b.id.localeCompare(a.id));
        await sb.set("config", "cierres_mensuales", { lista: listaCierreCron });
      }
    } catch (cierreErr) { console.error("Cierre mensual automático error:", cierreErr); }
  }

  // ── RESPALDO SEMANAL: solo los lunes, adjunta un JSON con todas las
  // tablas al correo de VEREX — la única forma de recuperar algo si se
  // borra por error, ya que hoy no hay ningún respaldo automático. ──
  if (new Date().getUTCDay() === 1) {
    try {
      const RESEND_KEY = env.RESEND_KEY;
      if (RESEND_KEY) {
        const tablasBk = ["stock","vendedores","consignacion","abonos","entregas","cortes","pedidos","clientes","cupones","leads","ventas_directas"];
        const backupData = {};
        for (const t of tablasBk) {
          try { backupData[t] = await sb.getAll(t); } catch(_) { backupData[t] = []; }
        }
        const fechaBk = new Date().toISOString().slice(0, 10);
        backupData._fecha = new Date().toISOString();
        const json = JSON.stringify(backupData);
        const contentB64 = btoa(unescape(encodeURIComponent(json)));
        await fetchResend("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
          body: JSON.stringify({
            from: "VEREX Store <hola@notificaciones.verexstore.com>",
            reply_to: "hola@verexstore.com",
            to:   ["hola@verexstore.com"],
            subject: `💾 Respaldo semanal VEREX — ${fechaBk}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;border:2px solid #C9A84C;border-radius:12px;padding:24px;">
                <h2 style="color:#C9A84C;margin:0 0 12px;">💾 Respaldo semanal</h2>
                <p style="font-size:14px;color:#333;">Adjunto va el respaldo completo de la base de datos (${fechaBk}): stock, vendedores, consignación, pedidos, clientes, leads, ventas directas y más.</p>
                <p style="font-size:12px;color:#999;margin-top:16px;">Guarda este archivo en un lugar seguro — si algún dato se borra por error, este es el respaldo al que se puede volver.</p>
              </div>`,
            attachments: [{ filename: `verex-backup-${fechaBk}.json`, content: contentB64 }]
          })
        }).catch(()=>{});
      }
    } catch(backupErr) { console.error("Backup semanal error:", backupErr); }
  }
}
