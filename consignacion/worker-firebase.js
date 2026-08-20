// ═══════════════════════════════════════════════════════════════════
//  VEREX API — Cloudflare Worker con Supabase — v2026.06
//  (CF_API_TOKEN/CF_ACCOUNT_ID renovados en GitHub Actions - 2026-08-17)
//
//  SECRETS en Cloudflare (Settings → Variables → Secrets):
//    SUPABASE_URL         → URL del proyecto (ej: https://xxx.supabase.co)
//    SUPABASE_SERVICE_KEY → service_role key (Settings → API en Supabase)
//    SECRET_PASS          → contraseña del admin
//    SECRET_KEY           → clave legacy de vendedores
//    IMAGEKIT_PRIVATE_KEY → clave privada de ImageKit
// ═══════════════════════════════════════════════════════════════════

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json"
};

const ADMIN_WA = "50371250725"; // WhatsApp VEREX

export default {
  // ── CRON DIARIO: alertas pedidos pendientes +2 días ──────────────
  async scheduled(event, env, ctx) {
    const sb    = new Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    const todos = await sb.getAll("pedidos");
    const hace2dias = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const pendientes = todos.filter(p =>
      (p.estado === "Pendiente" || p.estado === "En camino") &&
      new Date(p.fecha).getTime() < hace2dias
    );
    if (!pendientes.length) return;

    const lista = pendientes.map(p =>
      `• ${p.numeroPedido} — ${p.cliente} ($${parseFloat(p.total||0).toFixed(2)}) — ${p.estado}`
    ).join("\n");

    const msg = encodeURIComponent(
      `⚠️ VEREX — ${pendientes.length} pedido(s) llevan +2 días sin actualizar:\n\n${lista}\n\n📋 Actualiza el estado en: https://admin-tienda.pages.dev`
    );

    // Enviar via CallMeBot API (gratis, solo requiere registro inicial)
    const apikey = env.CALLMEBOT_KEY || "";
    if (apikey) {
      await fetch(`https://api.callmebot.com/whatsapp.php?phone=${ADMIN_WA}&text=${msg}&apikey=${apikey}`).catch(()=>{});
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
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
            body: JSON.stringify({
              from: "VEREX Store <hola@verexstore.com>",
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
  },

  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response("", { headers: CORS });

    const sb = new Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

    // ── GET: rutas ────────────────────────────────────────────────
    if (request.method === "GET") {
      const url = new URL(request.url);

      // Página del celular para tomar foto
      if (url.pathname === "/foto-upload") {
        const session = url.searchParams.get("s") || "";
        const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>VEREX — Foto</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#111;color:#fff;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:20px;gap:16px}
.logo{font-size:22px;font-weight:700;color:#C9A84C;letter-spacing:1px}
#preview{width:100%;max-width:340px;aspect-ratio:1;object-fit:cover;border-radius:16px;display:none;border:2px solid #C9A84C}
.btn{width:100%;max-width:340px;padding:16px;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;background:#C9A84C;color:#111}
.btn:disabled{opacity:.5;cursor:not-allowed}
#status{font-size:14px;color:#aaa;text-align:center;min-height:20px}
#tick{font-size:48px;display:none}</style></head>
<body>
<div class="logo">✨ VEREX — Foto</div>
<img id="preview" alt="preview">
<div id="tick">✅</div>
<input type="file" id="inp" accept="image/*" capture="environment" style="display:none" onchange="onFoto(this)">
<button class="btn" onclick="document.getElementById('inp').click()">📷 Tomar foto</button>
<button class="btn" id="btnEnviar" style="display:none;background:#34D399;margin-top:4px" onclick="enviar()">✅ Enviar foto</button>
<div id="status" style="font-size:16px;font-weight:700;color:#C9A84C;">ID: ${session || "sin sesión"}</div>
<script>
let b64="";
function onFoto(inp){
  const file=inp.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const MAX=1000; let w=img.width,h=img.height;
      if(w>MAX){h=Math.round(h*MAX/w);w=MAX;}
      if(h>MAX){w=Math.round(w*MAX/h);h=MAX;}
      const c=document.createElement("canvas");c.width=w;c.height=h;
      c.getContext("2d").drawImage(img,0,0,w,h);
      b64=c.toDataURL("image/jpeg",0.72);
      document.getElementById("preview").src=b64;
      document.getElementById("preview").style.display="block";
      document.getElementById("btnEnviar").style.display="block";
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}
async function enviar(){
  const btn=document.getElementById("btnEnviar");
  btn.disabled=true; btn.textContent="⏳ Enviando...";
  document.getElementById("status").textContent="Subiendo foto...";
  try{
    const r=await fetch(location.origin+"/foto-upload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accion:"FOTO_CEL_SAVE",session:"${session}",data:b64})});
    const res=await r.json();
    if(res.ok){
    document.getElementById("tick").style.display="block";
    document.getElementById("preview").style.display="none";
    btn.style.display="none";
    document.getElementById("status").textContent="✅ Foto enviada. Toca 📷 para la siguiente.";
    setTimeout(()=>{document.getElementById("tick").style.display="none";},2000);
    b64="";
    const oldInp=document.getElementById("inp");
    const newInp=document.createElement("input");
    newInp.type="file"; newInp.id="inp"; newInp.accept="image/*";
    newInp.setAttribute("capture","environment");
    newInp.style.display="none";
    newInp.onchange=function(){onFoto(this);};
    oldInp.parentNode.replaceChild(newInp,oldInp);
  } else {
    document.getElementById("status").textContent="Error: "+(res.error||"desconocido");
    btn.disabled=false; btn.textContent="✅ Enviar foto";
  }
  }catch(e){document.getElementById("status").textContent="⚠️ Error de red — intenta de nuevo";btn.disabled=false;btn.textContent="✅ Enviar foto";}
  b64=""; document.getElementById("inp").value="";
}
</script></body></html>`;
        return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" } });
      }

      // Polling: verificar si hay foto pendiente — devuelve y borra la entrada
      if (url.pathname === "/foto-check") {
        const session = url.searchParams.get("s") || "";
        if (!session) return json({ ok: false, pending: false });
        try {
          const rec = await sb.get("config", `foto_temp_${session}`);
          if (rec && rec.url) {
            await sb.delete("config", `foto_temp_${session}`);
            return json({ ok: true, pending: true, url: rec.url, ts: rec.ts || Date.now() });
          }
          return json({ ok: true, pending: false });
        } catch(e) {
          return json({ ok: false, pending: false, error: e.message });
        }
      }

      // Catálogo público (ruta por defecto)
      try {
        const [prods, cups, cfgDoc] = await Promise.all([
          sb.getAll("stock"),
          sb.getAll("cupones"),
          sb.get("config", "settings"),
        ]);
        return json({
          productos: prods.filter(p => (p.enCatalogo === true || p.enCatalogo === "true" || p.enCatalogo === "TRUE") && p.estado !== "inactivo"),
          cupones:   cups.filter(c => c.activo !== false && c.activo !== "false"),
          config:    cfgDoc || {}
        });
      } catch(e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    try {
      const d = await request.json();

      // ── Foto desde celular: guarda base64 directamente en Supabase ──
      if (d.accion === "FOTO_CEL_SAVE") {
        const { session, data } = d;
        if (!session || !data) return json({ ok: false, error: "Faltan datos" });
        try {
          const ts = Date.now();
          await sb.set("config", `foto_temp_${session}`, { url: data, ts });
          return json({ ok: true, ts });
        } catch(e) {
          return json({ ok: false, error: e.message });
        }
      }

      // ── Verificación de contraseña (endpoint público de login) ───
      if (d.accion === "VERIFICAR_PASS") {
        const ok = await verificarPassword(d._pass, env, sb);
        return json({ ok });
      }

      // ── 2FA: Enviar OTP por Telegram ───────────────────────────
      if (d.accion === "ENVIAR_OTP") {
        const ok = await verificarPassword(d._pass, env, sb);
        if (!ok) return json({ ok: false, error: "No autorizado" }, 403);
        const otp  = String(Math.floor(100000 + Math.random() * 900000));
        const exp  = Date.now() + 5 * 60 * 1000; // 5 minutos
        await sb.update("config", "settings", { otp, otpExp: exp });
        const TELEGRAM_BOT = "8876219004:AAHZavenfX0SjTYZbzqGTEGBxD0P4VKvtLM";
        const TELEGRAM_CHAT = "6788653579";
        const msg = `🔐 *VEREX Admin*\n\nCódigo de acceso: *${otp}*\n\nVálido por 5 minutos.`;
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: msg, parse_mode: "Markdown" })
        });
        return json({ ok: true });
      }

      // ── 2FA: Verificar OTP ─────────────────────────────────────
      if (d.accion === "VERIFICAR_OTP") {
        const ok = await verificarPassword(d._pass, env, sb);
        if (!ok) return json({ ok: false, error: "No autorizado" }, 403);
        const cfg = await sb.get("config", "settings");
        if (!cfg || !cfg.otp || !cfg.otpExp) return json({ ok: false, error: "Sin OTP" });
        if (Date.now() > cfg.otpExp) {
          await sb.update("config", "settings", { otp: null, otpExp: null });
          return json({ ok: false, error: "OTP expirado" });
        }
        if (String(d.codigo).trim() !== String(cfg.otp)) return json({ ok: false, error: "Código incorrecto" });
        await sb.update("config", "settings", { otp: null, otpExp: null }); // Invalidar OTP usado
        return json({ ok: true });
      }

      // ── SSO: el Hub ya autenticado genera un token corto de un solo uso
      // para saltar directo a Admin sin volver a pedir contraseña ni
      // Telegram — el login normal de Admin (password + OTP) sigue intacto
      // si se entra directo a su URL sin pasar por el Hub. ──
      if (d.accion === "SSO_CREAR_TOKEN") {
        const ok = await verificarPassword(d._pass, env, sb);
        if (!ok) return json({ ok: false, error: "No autorizado" }, 403);
        const token = crypto.randomUUID();
        const cfgSso = (await sb.get("config", "settings")) || {};
        cfgSso.ssoTokens = cfgSso.ssoTokens || {};
        const ahoraSso = Date.now();
        // Limpia tokens viejos para que el documento no crezca sin control
        for (const t of Object.keys(cfgSso.ssoTokens)) {
          if (ahoraSso - cfgSso.ssoTokens[t].creado > 5 * 60 * 1000) delete cfgSso.ssoTokens[t];
        }
        cfgSso.ssoTokens[token] = { creado: ahoraSso };
        await sb.set("config", "settings", cfgSso);
        return json({ ok: true, token });
      }

      // ── SSO: Admin canjea el token — un solo uso, expira a los 90s ──
      if (d.accion === "SSO_CANJEAR_TOKEN") {
        const cfgSso = await sb.get("config", "settings");
        const entry = cfgSso?.ssoTokens?.[d.token];
        if (!entry || (Date.now() - entry.creado) > 90 * 1000) {
          return json({ ok: false, error: "Token inválido o expirado" });
        }
        delete cfgSso.ssoTokens[d.token];
        await sb.set("config", "settings", cfgSso);
        const hash = cfgSso.passHash || await hashStr(env.SECRET_PASS || "");
        return json({ ok: true, hash });
      }

      // esAdmin: acepta SECRET_PASS (env var) O el hash guardado en Supabase
      const esAdmin = (await verificarPassword(d._pass, env, sb)) ||
                      (d.key && d.key === env.SECRET_KEY);

      let result;

      switch (d.accion) {

        // ══ STOCK ════════════════════════════════════════════════
        case "STOCK_GET_ALL": {
          const docs = await sb.getAll("stock");
          result = { ok: true, stock: docs.filter(p => p.estado !== "inactivo") };
          break;
        }

        case "STOCK_REGISTRAR": {
          if (!esAdmin) return forbidden();
          // Nunca guardar campos de control de la petición (contraseña, nombre de
          // acción, etc.) dentro del documento — GET_STOCK es público y los expondría.
          const limpiarControl = obj => {
            const { _pass, accion, items, ...limpio } = obj;
            return limpio;
          };
          const items = (Array.isArray(d.items) ? d.items : [d]).map(limpiarControl);
          const codigos = [];
          // Cargar stock UNA sola vez fuera del loop (evita race condition y N queries)
          const allStockCache = await sb.getAll("stock");
          const codigosUsados = new Set(allStockCache.map(s => s.codigo));
          let conflictoCodigo = null;
          for (const item of items) {
            // Auto-generar código si no viene o se pide
            let codigo = item.codigo;
            if (codigo && !item.autoGenerarCodigo) {
              // Código ya calculado del lado del cliente (Hub → "+Agregar" /
              // "Nueva Entrega") — sin esta verificación, si el stock local del
              // cliente estaba desactualizado o dos personas agregaron casi al
              // mismo tiempo, sb.set() de más abajo lo hubiera sobrescrito en
              // silencio (mismo código = mismo registro).
              if (codigosUsados.has(codigo)) { conflictoCodigo = codigo; break; }
              codigosUsados.add(codigo);
            }
            if (!codigo || item.autoGenerarCodigo) {
              // Prefijo de material
              const mat = String(item.material || "").toLowerCase();
              const prefMat = mat.includes("oro laminado") ? "PO"
                            : mat.includes("14 kil") || mat.includes("14k") ? "OR14"
                            : mat.includes("10 kil") || mat.includes("10k") ? "OR10"
                            : mat.includes("oro")          ? "OR"
                            : mat.includes("acero")        ? "A"
                            : mat.includes("reloj")        ? "W"
                            : mat.includes("plata")        ? "P"
                            : "";
              const prefCat = String(item.categoria || "GEN").toUpperCase().slice(0, 2);
              const prefijo = prefMat ? `${prefMat}-${prefCat}` : prefCat;
              let maxNum = 0;
              allStockCache.forEach(s => {
                const base = String(s.codigoBase || s.codigo || "");
                if (base.startsWith(prefijo)) {
                  const num = parseInt(base.replace(prefijo, "")) || 0;
                  if (num > maxNum) maxNum = num;
                }
              });
              // Anti-colisión: incrementar hasta encontrar código libre
              let codigoBase;
              do {
                maxNum++;
                codigoBase = `${prefijo}${String(maxNum).padStart(3, "0")}`;
              } while (codigosUsados.has(codigoBase) || codigosUsados.has(`${codigoBase}T${item.talla}`));
              codigo = item.talla ? `${codigoBase}T${item.talla}` : codigoBase;
              item.codigoBase = item.codigoBase || codigoBase;
              codigosUsados.add(codigo); // Registrar para evitar colisión en el mismo lote
            }
            const qty = parseInt(item.cantidad) || 1;
            const doc = {
              ...item,
              codigo,
              precio:             Math.round((parseFloat(item.precio) || 0) * 100) / 100,
              stock_bodega:       item.stock_bodega       !== undefined ? parseInt(item.stock_bodega)       : qty,
              stock_tienda:       item.stock_tienda        !== undefined ? parseInt(item.stock_tienda)        : 0,
              stock_consignacion: item.stock_consignacion !== undefined ? parseInt(item.stock_consignacion) : 0,
              stock_reservado:    item.stock_reservado     !== undefined ? parseInt(item.stock_reservado)     : 0,
              stock_vendido:      item.stock_vendido       !== undefined ? parseInt(item.stock_vendido)       : 0,
              stock_total:        item.stock_total         !== undefined ? parseInt(item.stock_total)         : qty,
              estado:             item.estado || "bodega",
              fechaRegistro:      item.fechaRegistro || new Date().toISOString(),
            };
            await sb.set("stock", codigo, doc);
            codigos.push(codigo);
          }
          if (conflictoCodigo) {
            result = { ok: false, error: `El código ${conflictoCodigo} ya existe — alguien más lo generó justo antes. Vuelve a abrir el formulario para que se recalcule.` };
            break;
          }
          result = { ok: true, codigos };
          break;
        }

        // Reparar productos existentes sin campos de stock
        case "STOCK_REPARAR_CAMPOS": {
          if (!esAdmin) return forbidden();
          const todos = await sb.getAll("stock");
          let reparados = 0;
          for (const p of todos) {
            if (p.stock_bodega === undefined || p.stock_bodega === null) {
              const qty = parseInt(p.cantidad) || 1;
              await sb.update("stock", p.id || p.codigo, {
                stock_bodega:       qty,
                stock_tienda:       0,
                stock_consignacion: 0,
                stock_reservado:    0,
                stock_vendido:      0,
                stock_total:        qty,
                estado:             p.estado || "bodega",
              });
              reparados++;
            }
          }
          result = { ok: true, reparados, total: todos.length };
          break;
        }

        // Limpieza única: purgar campos de control (contraseña, nombre de acción)
        // que quedaron guardados por error en filas de stock ya existentes.
        case "STOCK_LIMPIAR_CAMPOS_SENSIBLES": {
          if (!esAdmin) return forbidden();
          const todos = await sb.getAll("stock");
          const pendientes = todos.filter(p => p._pass !== undefined || p.accion !== undefined);
          const lote = pendientes.slice(0, parseInt(d.limit) || 40); // límite de subrequests por invocación
          for (const p of lote) {
            const { _pass, accion, id, ...limpio } = p;
            await sb.set("stock", p.id || p.codigo, limpio);
          }
          result = { ok: true, limpiados: lote.length, quedan: pendientes.length - lote.length, total: todos.length };
          break;
        }

        case "STOCK_ELIMINAR": {
          if (!esAdmin) return forbidden();
          await sb.delete("stock", d.codigo);
          result = { ok: true };
          break;
        }

        case "STOCK_ACTUALIZAR_CANTIDADES": {
          if (!esAdmin) return forbidden();
          const notFound = [];
          for (const item of (d.items || [])) {
            const doc = await sb.get("stock", item.codigo);
            if (doc) {
              await sb.update("stock", item.codigo, {
                stock_bodega:       item.stock_bodega       ?? doc.stock_bodega,
                stock_tienda:       item.stock_tienda       ?? doc.stock_tienda,
                stock_consignacion: item.stock_consignacion ?? doc.stock_consignacion,
              });
            } else {
              notFound.push(item.codigo);
            }
          }
          result = { ok: true, notFound };
          break;
        }

        // ══ VENDEDORES ═══════════════════════════════════════════
        case "GET_VENDEDORES": {
          if (!esAdmin) return forbidden();
          const docs = await sb.getAll("vendedores");
          result = { ok: true, vendedores: docs };
          break;
        }

        case "GUARDAR_VENDEDOR": {
          if (!esAdmin) return forbidden();
          await sb.set("vendedores", d.vendedor.codigo, d.vendedor);
          result = { ok: true };
          break;
        }

        case "ELIMINAR_VENDEDOR": {
          if (!esAdmin) return forbidden();
          // Cancelar los Leads pendientes de este vendedor/afiliado antes de
          // borrarlo — si no, quedan huérfanos apuntando a un código que ya
          // no existe (aparecen en las alertas sin nombre, solo el código).
          const leadsVend = await sb.getAll("leads");
          for (const l of leadsVend) {
            if (l.afiliado === d.codigo && (l.estado === "interesado" || l.estado === "reportado" || l.estado === "en_camino")) {
              // Si estaba "en camino" el stock quedó reservado (apartado del
              // inventario disponible) — hay que devolverlo a bodega, si no
              // queda atrapado en el balde de reservado para siempre.
              if (l.estado === "en_camino") {
                const codigoRes = l.codigoConfirmado || l.codigo;
                const sRes = await sb.get("stock", codigoRes);
                if (sRes) {
                  await sb.update("stock", codigoRes, {
                    stock_reservado: Math.max(0, (parseInt(sRes.stock_reservado)||0) - 1),
                    stock_bodega: (parseInt(sRes.stock_bodega)||0) + 1
                  });
                }
              }
              const historial = [...(l.historial || []), { estado: "cancelado", fecha: new Date().toISOString(), motivo: "Vendedor eliminado" }];
              await sb.update("leads", l.id, { estado: "cancelado", historial });
            }
          }
          await sb.delete("vendedores", d.codigo);
          result = { ok: true };
          break;
        }

        case "GUARDAR_TOKEN": {
          if (!esAdmin) return forbidden();
          await sb.update("vendedores", d.vendedor, { tokenInventario: d.token });
          result = { ok: true };
          break;
        }

        case "GUARDAR_TOKEN_FIRMA": {
          if (!esAdmin) return forbidden();
          await sb.update("vendedores", d.vendedor, { tokenFirma: d.token });
          result = { ok: true };
          break;
        }

        case "GUARDAR_TOKEN_PEDIDOS": {
          if (!esAdmin) return forbidden();
          await sb.update("vendedores", d.vendedor, { tokenPedidos: d.token });
          result = { ok: true };
          break;
        }

        // Público — portal del afiliado para completar pedidos (protegido por token + PIN)
        case "GET_LEADS_PORTAL_AFILIADO": {
          const vend = await sb.get("vendedores", d.vendedor);
          if (!vend) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
          if (!vend.tokenPedidos || String(vend.tokenPedidos) !== String(d.token)) {
            result = { ok: false, error: "Link inválido" }; break;
          }
          // Si el afiliado tiene PIN configurado, validarlo
          if (vend.pin && String(vend.pin) !== String(d.pin || "")) {
            result = { ok: false, error: "PIN incorrecto", pinRequerido: true }; break;
          }
          const todos = await sb.getAll("leads");
          const pendientes = todos.filter(l => l.afiliado === d.vendedor && l.estado === "interesado" && !l.cliente);
          result = { ok: true, leads: pendientes, vendedorNombre: vend.nombre, tienePin: !!vend.pin };
          break;
        }

        // Público — historial completo del afiliado (protegido por token + PIN)
        case "GET_HISTORIAL_AFILIADO": {
          const vend = await sb.get("vendedores", d.vendedor);
          if (!vend) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
          if (!vend.tokenPedidos || String(vend.tokenPedidos) !== String(d.token)) {
            result = { ok: false, error: "Link inválido" }; break;
          }
          if (vend.pin && String(vend.pin) !== String(d.pin || "")) {
            result = { ok: false, error: "PIN incorrecto", pinRequerido: true }; break;
          }
          const todosH = await sb.getAll("leads");
          const mios = todosH.filter(l => l.afiliado === d.vendedor);
          const enCamino  = mios.filter(l => l.estado === "en_camino");
          const vendidos  = mios.filter(l => l.estado === "vendido" && !l.esCambio);
          // Tabla por tramos igual que el panel de consignación (RANGOS_COMISION_AFILIADO)
          const RANGOS_AFILIADO = [
            { min: 0,   pct: 20 },
            { min: 200, pct: 25 },
            { min: 400, pct: 30 },
          ];
          const totalVendido = vendidos.reduce((s, l) => s + (parseFloat(l.precio) || 0), 0);
          let pct;
          if (vend.comisionFija != null && vend.comisionFija !== "") {
            pct = parseFloat(vend.comisionFija);
          } else {
            const rango = RANGOS_AFILIADO.slice().reverse().find(r => totalVendido >= r.min);
            pct = rango ? rango.pct : RANGOS_AFILIADO[0].pct;
          }
          const vendidosConComision = vendidos.map(l => ({
            ...l,
            comision: Math.round((parseFloat(l.precio) || 0) * pct / 100 * 100) / 100
          }));
          result = { ok: true, enCamino, vendidos: vendidosConComision, comisionPct: pct, vendedorNombre: vend.nombre };
          break;
        }

        // Público — el afiliado completa un pedido (uno o más Leads del mismo
        // cliente) con nombre, teléfono y dirección. NO mueve stock ni genera
        // comisión — solo adjunta los datos; el admin sigue confirmando desde
        // Consignación → Leads como ya lo hacía, ahora con el pedido completo.
        case "COMPLETAR_PEDIDO_LEADS": {
          const vend = await sb.get("vendedores", d.vendedor);
          if (!vend) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
          if (!vend.tokenPedidos || String(vend.tokenPedidos) !== String(d.token)) {
            result = { ok: false, error: "Link inválido" }; break;
          }
          if (vend.pin && String(vend.pin) !== String(d.pin || "")) {
            result = { ok: false, error: "PIN incorrecto", pinRequerido: true }; break;
          }
          const cliente = d.cliente || {};
          if (!cliente.nombre || !cliente.telefono || !cliente.departamento || !cliente.municipio || !cliente.direccion) {
            result = { ok: false, error: "Faltan datos del cliente" }; break;
          }
          const leadIds = Array.isArray(d.leadIds) ? d.leadIds : [];
          if (!leadIds.length) { result = { ok: false, error: "Selecciona al menos un producto" }; break; }

          const leads = [];
          for (const id of leadIds) {
            const lead = await sb.get("leads", id);
            if (lead && lead.afiliado === d.vendedor && lead.estado === "interesado" && !lead.cliente) leads.push(lead);
          }
          if (!leads.length) { result = { ok: false, error: "Esos productos ya no están disponibles para completar" }; break; }

          const subtotal = leads.reduce((s, l) => s + (parseFloat(l.precio) || 0), 0);
          let envio = subtotal >= 30 ? 0 : 2;
          try {
            const cfg = await sb.get("config", "settings");
            if (cfg?.reglasEnvio?.length) {
              const regla = cfg.reglasEnvio.slice().sort((a,b) => a.min - b.min).find(r => subtotal >= r.min && subtotal <= r.max);
              if (regla) envio = regla.costo;
            }
          } catch(_) {}
          const total = subtotal + envio;
          const pedidoId = "PEDAF_" + Date.now();
          const fecha = new Date().toISOString();

          for (const lead of leads) {
            const historial = [...(lead.historial || []), { estado: "pedido_completado", fecha }];
            await sb.update("leads", lead.id, {
              cliente, metodoPago: "efectivo", tipoPago: "contra_entrega",
              pedidoId, pedidoFecha: fecha,
              envioInfo: { subtotal, envio, total },
              historial
            });
          }
          result = { ok: true, pedidoId, subtotal, envio, total };
          break;
        }

        // Público — página de firma remota (sin sesión de admin, protegida por token)
        case "GET_VENDEDOR_FIRMA": {
          const vend = await sb.get("vendedores", d.vendedor);
          if (!vend) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
          if (!vend.tokenFirma || String(vend.tokenFirma) !== String(d.token)) {
            result = { ok: false, error: "Link inválido" }; break;
          }
          result = { ok: true, vendedor: {
            nombre: vend.nombre, codigo: vend.codigo, telefono: vend.telefono,
            dui: vend.dui || null,
            tipo: vend.tipo, comisionFija: vend.comisionFija ?? null,
            recibeFisico: vend.recibeFisico === true,
            firmaContrato: vend.firmaContrato || null,
            firmaContratoFecha: vend.firmaContratoFecha || null
          } };
          break;
        }

        case "FIRMAR_CONTRATO_REMOTO": {
          const vend = await sb.get("vendedores", d.vendedor);
          if (!vend) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
          if (!vend.tokenFirma || String(vend.tokenFirma) !== String(d.token)) {
            result = { ok: false, error: "Link inválido" }; break;
          }
          if (vend.firmaContrato) { result = { ok: false, error: "Este contrato ya fue firmado" }; break; }
          if (!d.firma) { result = { ok: false, error: "Falta la firma" }; break; }
          const fecha = new Date().toISOString();
          await sb.update("vendedores", d.vendedor, { firmaContrato: d.firma, firmaContratoFecha: fecha });
          result = { ok: true, firmaContratoFecha: fecha };
          break;
        }

        // ══ CONSIGNACION ══════════════════════════════════════════
        case "GET_CONSIGNACION": {
          if (!esAdmin) return forbidden();
          const [cons, vends, stock] = await Promise.all([
            sb.getAll("consignacion"),
            sb.getAll("vendedores"),
            sb.getAll("stock"),
          ]);
          result = { ok: true, consignacion: cons, vendedores: vends, stock, productos: stock };
          break;
        }

        // Público (validado por token+PIN, igual que VERIFICAR_TOKEN) — el
        // inventario del vendedor necesita ver SU propio consignacion sin
        // tener contraseña de admin. Solo devuelve lo de ese vendedor, nunca
        // el dataset completo de todos los vendedores.
        case "GET_INVENTARIO_VENDEDOR": {
          if (!d.vendedor || !d.token) return json({ ok: false, error: "vendedor y token requeridos" });
          const vendInv = await sb.get("vendedores", d.vendedor);
          if (!vendInv || String(vendInv.tokenInventario) !== String(d.token)) {
            return json({ ok: false, error: "Token inválido" });
          }
          if (vendInv.pin && String(vendInv.pin) !== String(d.pin || "")) {
            return json({ ok: false, error: "PIN incorrecto" });
          }
          const consV2 = await sb.query("consignacion", "vendedor", "==", d.vendedor);
          // Se enriquece cada item con si VEREX todavía tiene piezas en
          // bodega — así el inventario del vendedor puede seguir ofreciendo
          // (y vendiendo "bajo pedido") una pieza aunque él ya no tenga
          // ninguna físicamente, en vez de perder la venta.
          const todoStockInv = await sb.getAll("stock");
          const stockMapInv = new Map(todoStockInv.map(s => [String(s.codigo||"").toUpperCase(), s]));
          // Mismo agrupado por codigoBase que GET_CODIGOS_VENDEDOR — si la
          // talla exacta se agotó pero hay otra talla del mismo modelo en
          // bodega, se avisa cuál en vez de solo ocultar la pieza.
          const stockPorBaseInv = new Map();
          for (const s of todoStockInv) {
            const base = String(s.codigoBase || s.codigo || "").toUpperCase();
            if (!base) continue;
            if (!stockPorBaseInv.has(base)) stockPorBaseInv.set(base, []);
            stockPorBaseInv.get(base).push(s);
          }
          const consV2Enriquecido = consV2.map(c => {
            const sInv = stockMapInv.get(String(c.codigo||"").toUpperCase()) || {};
            const restanteInv = Math.max(0, (parseInt(c.cantidad)||0) - (parseInt(c.vendido)||0));
            const bajoPedidoInv = restanteInv <= 0 && (parseInt(sInv.stock_bodega)||0) > 0;
            let tallasDisponiblesInv = [];
            if (restanteInv <= 0 && !bajoPedidoInv) {
              const baseC = String(c.codigoBase || (c.codigo||"").replace(/-\d+$/, "") || "").toUpperCase();
              const codC = String(c.codigo||"").toUpperCase();
              tallasDisponiblesInv = [...new Set(
                (stockPorBaseInv.get(baseC) || [])
                  .filter(sib => String(sib.codigo||"").toUpperCase() !== codC && (parseInt(sib.stock_bodega)||0) > 0)
                  .map(sib => sib.talla).filter(Boolean)
              )];
            }
            return { ...c, bajoPedido: bajoPedidoInv, tallasDisponibles: tallasDisponiblesInv };
          });
          result = { ok: true, consignacion: consV2Enriquecido };
          break;
        }

        case "GET_CODIGOS_FISICOS": {
          // Retorna los códigos de productos activos en consignación para un vendedor híbrido
          if (!esAdmin) return forbidden();
          if (!d.vendedor) return json({ ok: false, error: "vendedor requerido" });
          const todaCons = await sb.getAll("consignacion");
          const codigos = todaCons
            .filter(c => c.vendedor === d.vendedor && c.estado === "activo" && (parseInt(c.cantidad)||0) - (parseInt(c.vendido)||0) > 0)
            .map(c => c.codigo);
          result = { ok: true, codigos };
          break;
        }

        case "GET_CODIGOS_VENDEDOR": {
          // Endpoint público: devuelve los productos que un vendedor tiene
          // en consignación activa, con TODOS los datos que el catálogo
          // necesita para mostrarlos (foto, precio, nombre, etc.) — el
          // catálogo del vendedor NO depende de la curación "enCatalogo"
          // de la tienda general (esas son cosas distintas: lo que él
          // tiene físicamente vs. lo que se destaca en verexstore.com).
          if (!d.vendedor) return json({ ok: false, error: "vendedor requerido" });
          const [todaCons, todoStock] = await Promise.all([
            sb.getAll("consignacion"),
            sb.getAll("stock"),
          ]);
          const stockPorCodigo = new Map(todoStock.map(s => [String(s.codigo || "").toUpperCase(), s]));
          // Para avisar "disponible en otras tallas": agrupar TODO el stock
          // por codigoBase (el mismo modelo, sin importar la talla) — así
          // cuando la talla exacta que tenía el vendedor se agota, se puede
          // saber qué otras tallas de ESE modelo sí hay en bodega, en vez de
          // solo decir "bajo pedido" (que implica que llega la MISMA talla).
          const stockPorBase = new Map();
          for (const s of todoStock) {
            const base = String(s.codigoBase || s.codigo || "").toUpperCase();
            if (!base) continue;
            if (!stockPorBase.has(base)) stockPorBase.set(base, []);
            stockPorBase.get(base).push(s);
          }
          const tallasHermanasDisponibles = c => {
            const baseC = String(c.codigoBase || (c.codigo||"").replace(/-\d+$/, "") || "").toUpperCase();
            const codC = String(c.codigo||"").toUpperCase();
            return [...new Set(
              (stockPorBase.get(baseC) || [])
                .filter(sib => String(sib.codigo||"").toUpperCase() !== codC && (parseInt(sib.stock_bodega)||0) > 0)
                .map(sib => sib.talla).filter(Boolean)
            )];
          };
          // Se incluyen también los items en 0 con el vendedor SIEMPRE que
          // VEREX todavía tenga piezas en bodega para reponerle (misma talla)
          // o en otra talla del mismo modelo — así el catálogo no oculta la
          // pieza ni el vendedor pierde la venta, solo se marca "bajoPedido"
          // o "tallasDisponibles" para que el catálogo lo avise al cliente.
          const itemsVendedor = todaCons.filter(c => {
            if (c.vendedor !== d.vendedor || c.estado !== "activo") return false;
            const restante = (parseInt(c.cantidad)||0) - (parseInt(c.vendido)||0);
            if (restante > 0) return true;
            const sBod = stockPorCodigo.get(String(c.codigo || "").toUpperCase());
            if ((parseInt(sBod?.stock_bodega)||0) > 0) return true;
            return tallasHermanasDisponibles(c).length > 0;
          });
          const productos = itemsVendedor.map(c => {
            const s = stockPorCodigo.get(String(c.codigo || "").toUpperCase()) || {};
            const restante = Math.max(0, (parseInt(c.cantidad)||0) - (parseInt(c.vendido)||0));
            const bajoPedido = restante <= 0 && (parseInt(s.stock_bodega)||0) > 0;
            const tallasDisponibles = (restante <= 0 && !bajoPedido) ? tallasHermanasDisponibles(c) : [];
            return {
              codigo: c.codigo, codigoBase: c.codigoBase || (c.codigo||"").replace(/-\d+$/, ""),
              nombre: c.nombre || s.nombre || "", nombre_base: c.nombre_base || s.nombre_base || c.nombre || "",
              precio: c.precio || s.precio || 0, foto: c.foto || s.foto || "",
              categoria: c.categoria || s.categoria || "", talla: c.talla || s.talla || "",
              descripcion: s.descripcion || "", material: s.material || "",
              stock_bodega: restante,
              bajoPedido,
              tallasDisponibles,
            };
          });
          const codigos = [...new Set(productos.map(p => p.codigoBase.toUpperCase()).filter(Boolean))];
          result = { ok: true, codigos, productos };
          break;
        }

        case "REGISTRAR_ENTREGA": {
          if (!esAdmin) return forbidden();
          const items = d.items || [];
          // Borrador: se descuenta stock y queda respaldado en BD, pero invisible
          // en el link del vendedor y demás vistas hasta FINALIZAR_ENTREGA_VENDEDOR.
          const estadoInicial = d.borrador ? "borrador" : "activo";
          // A prueba de fallos: un item con datos raros NO debe abortar el lote
          // entero silenciosamente (causaba items "escaneados" que nunca se
          // guardaban sin ningún aviso). Se procesan todos y se reporta cuáles
          // fallaron para que el frontend pueda avisar exactamente qué faltó.
          const guardados = [];
          const fallidos = [];
          for (const item of items) {
            try {
              const id = item.id || `CONS_${Date.now()}_${item.codigo}`;
              await sb.set("consignacion", id, {
                id, vendedor: d.vendedor, codigo: item.codigo,
                nombre: item.nombre, codigoBase: item.codigoBase || item.codigo,
                talla: item.talla || "", nombre_base: item.nombre_base || item.nombre,
                categoria: item.categoria || "", precio: item.precio || 0,
                cantidad: item.cantidad || 1, vendido: 0,
                foto: item.foto || "", fecha: new Date().toISOString(), estado: estadoInicial
              });
              const s = await sb.get("stock", item.codigo);
              if (s) {
                await sb.update("stock", item.codigo, {
                  stock_bodega:       Math.max(0, (parseInt(s.stock_bodega)||0) - (item.cantidad||1)),
                  stock_consignacion: (parseInt(s.stock_consignacion)||0) + (item.cantidad||1)
                });
              }
              guardados.push(item.codigo);
            } catch (errItem) {
              fallidos.push({ codigo: item.codigo, error: errItem.message || String(errItem) });
            }
          }
          result = { ok: fallidos.length === 0, guardados, fallidos };
          break;
        }

        case "FINALIZAR_ENTREGA_VENDEDOR": {
          // Publica de una vez todos los borradores acumulados de un vendedor:
          // estado "borrador" → "activo". A partir de aquí aparecen en su link.
          if (!esAdmin) return forbidden();
          if (!d.vendedor) return json({ ok: false, error: "vendedor requerido" });
          const todaCons = await sb.getAll("consignacion");
          const borradores = todaCons.filter(c => c.vendedor === d.vendedor && c.estado === "borrador");
          // A prueba de fallos: si un item falla a mitad del lote, los demás
          // se siguen publicando en vez de quedar todos atascados en borrador
          // (eso obligaba a firmar dos veces — una por cada intento parcial).
          const publicadosIds = [];
          const fallidosPub = [];
          for (const c of borradores) {
            try {
              await sb.update("consignacion", c.id, { estado: "activo" });
              publicadosIds.push(c.id);
            } catch (errPub) {
              fallidosPub.push({ id: c.id, codigo: c.codigo, error: errPub.message || String(errPub) });
            }
          }
          result = { ok: fallidosPub.length === 0, publicados: publicadosIds.length, publicadosIds, fallidos: fallidosPub };
          break;
        }

        case "BORRAR_BORRADORES_VENDEDOR": {
          // Borra TODOS los borradores pendientes (sin publicar) de un vendedor
          // y restaura el stock de cada pieza a bodega — para empezar de cero
          // sin dejar stock "atrapado" en registros a medio armar.
          if (!esAdmin) return forbidden();
          if (!d.vendedor) return json({ ok: false, error: "vendedor requerido" });
          const todaCons = await sb.getAll("consignacion");
          const borradores = todaCons.filter(c => c.vendedor === d.vendedor && c.estado === "borrador");
          let restaurados = 0;
          for (const item of borradores) {
            try {
              const cantRestaurar = Math.max(0, (parseInt(item.cantidad)||0) - (parseInt(item.vendido)||0));
              if (cantRestaurar > 0) {
                const prodStock = await sb.get("stock", item.codigo);
                if (prodStock) {
                  await sb.update("stock", item.codigo, {
                    stock_consignacion: Math.max(0, (parseInt(prodStock.stock_consignacion)||0) - cantRestaurar),
                    stock_bodega: (parseInt(prodStock.stock_bodega)||0) + cantRestaurar
                  });
                }
              }
              await sb.delete("consignacion", item.id);
              restaurados++;
            } catch (errItem) { /* seguir con los demás aunque uno falle */ }
          }
          result = { ok: true, eliminados: restaurados };
          break;
        }

        case "GET_BORRADORES_VENDEDOR": {
          if (!esAdmin) return forbidden();
          if (!d.vendedor) return json({ ok: false, error: "vendedor requerido" });
          const todaCons = await sb.getAll("consignacion");
          const borradores = todaCons.filter(c => c.vendedor === d.vendedor && c.estado === "borrador");
          result = { ok: true, borradores };
          break;
        }

        case "REGISTRAR_VENTA": {
          if (!esAdmin) return forbidden();
          const cons = await sb.get("consignacion", d.id);
          if (!cons) { result = { ok: false, error: "Item no encontrado" }; break; }
          const cantVentaAdmin = parseInt(d.cantidad) || 1;
          const nuevoVendido = (parseInt(cons.vendido)||0) + cantVentaAdmin;
          await sb.update("consignacion", d.id, { vendido: nuevoVendido });
          const s = await sb.get("stock", cons.codigo);
          if (s) {
            await sb.update("stock", cons.codigo, {
              stock_vendido: (parseInt(s.stock_vendido)||0) + cantVentaAdmin
            });
          }
          // Igual que REGISTRAR_VENTA_VENDEDOR: se guarda un registro individual
          // de la venta con su fecha real — acepta d.fecha para ventas que se
          // registran tarde (el admin se entera después de que ya pasaron) y
          // así no queden fuera del cierre del mes en que de verdad ocurrieron.
          const fechaVentaAdmin = d.fecha ? new Date(d.fecha).toISOString() : new Date().toISOString();
          const vendVA = await sb.get("vendedores", cons.vendedor);
          if (vendVA) {
            const historialVA = Array.isArray(vendVA.historialVentas) ? vendVA.historialVentas : [];
            historialVA.push({
              id: `VV_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, consignacionId: d.id,
              codigo: cons.codigo, nombre: cons.nombre || "",
              precio: cons.precio || 0, foto: cons.foto || "",
              cantidad: cantVentaAdmin, fecha: fechaVentaAdmin,
              registradaPorAdmin: true
            });
            await sb.update("vendedores", cons.vendedor, { historialVentas: historialVA });
          }
          result = { ok: true };
          break;
        }

        case "REGISTRAR_DEVOLUCION": {
          if (!esAdmin) return forbidden();
          const items = d.items || [];
          const devId = `DEV_${Date.now()}`;
          await sb.set("devoluciones", devId, {
            id: devId, vendedor: d.vendedor,
            fecha: new Date().toISOString(), items: JSON.stringify(items)
          });
          for (const item of items) {
            const cons = await sb.get("consignacion", item.id);
            if (cons) {
              const nuevaCant = Math.max(0, (parseInt(cons.cantidad)||0) - (item.cantidad||1));
              await sb.update("consignacion", item.id, {
                cantidad: nuevaCant,
                estado: nuevaCant <= parseInt(cons.vendido||0) ? "devuelto" : "activo"
              });
            }
            const s = await sb.get("stock", item.codigo);
            if (s) {
              await sb.update("stock", item.codigo, {
                stock_bodega:       (parseInt(s.stock_bodega)||0) + (item.cantidad||1),
                stock_consignacion: Math.max(0, (parseInt(s.stock_consignacion)||0) - (item.cantidad||1))
              });
            }
          }
          result = { ok: true, devolucionId: devId, fecha: new Date().toISOString() };
          break;
        }

        case "ELIMINAR_ITEM_CONSIGNACION": {
          if (!esAdmin) return forbidden();
          // Restaurar stock_consignacion antes de borrar
          const itemCons = await sb.get("consignacion", d.id);
          if (itemCons && itemCons.codigo) {
            const cantRestaurar = Math.max(0, (parseInt(itemCons.cantidad)||0) - (parseInt(itemCons.vendido)||0));
            if (cantRestaurar > 0) {
              const prodStock = await sb.get("stock", itemCons.codigo);
              if (prodStock) {
                await sb.update("stock", itemCons.codigo, {
                  stock_consignacion: Math.max(0, (parseInt(prodStock.stock_consignacion)||0) - cantRestaurar),
                  stock_bodega: (parseInt(prodStock.stock_bodega)||0) + cantRestaurar
                });
              }
            }
          }
          await sb.delete("consignacion", d.id);
          result = { ok: true };
          break;
        }

        // Cierra un item que en realidad YA se vendió (típicamente uno que
        // quedó mal cerrado por el bug de CERRAR_CORTE: vendido reseteado a
        // 0 sin cerrar la pieza) — a diferencia de ELIMINAR_ITEM_CONSIGNACION,
        // NO toca stock ni lo regresa a bodega, porque la pieza no existe
        // físicamente en VEREX, ya está con el cliente que la compró.
        case "MARCAR_CONSIGNACION_VENDIDA": {
          if (!esAdmin) return forbidden();
          const itemMV = await sb.get("consignacion", d.id);
          if (!itemMV) { result = { ok: false, error: "Item no encontrado" }; break; }
          await sb.update("consignacion", d.id, { estado: "vendido" });
          result = { ok: true };
          break;
        }

        // Backfill de SOLO REGISTRO — para ventas que ya se cobraron y ya se
        // liquidaron (ej. en un corte manual/antiguo) pero nunca dejaron un
        // registro individual en historialVentas. A propósito NO toca
        // consignacion.vendido ni stock_vendido: esos números YA están
        // correctos (el corte ya los contó); esto solo hace que la venta
        // aparezca en "Ventas generales" / Cierres Mensuales con su fecha
        // real, sin arriesgar que se vuelva a cobrar comisión por ella en
        // el próximo corte.
        case "REGISTRAR_VENTA_HISTORICA": {
          if (!esAdmin) return forbidden();
          if (!d.vendedor || !d.codigo) { result = { ok: false, error: "vendedor y codigo requeridos" }; break; }
          const vendRVH = await sb.get("vendedores", d.vendedor);
          if (!vendRVH) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
          const historialRVH = Array.isArray(vendRVH.historialVentas) ? vendRVH.historialVentas : [];
          historialRVH.push({
            id: `VV_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
            codigo: d.codigo, nombre: d.nombre || "",
            precio: d.precio || 0, foto: d.foto || "",
            cantidad: parseInt(d.cantidad)||1,
            fecha: d.fecha ? new Date(d.fecha).toISOString() : new Date().toISOString(),
            soloRegistro: true
          });
          await sb.update("vendedores", d.vendedor, { historialVentas: historialRVH });
          result = { ok: true };
          break;
        }

        // ══ CORTES ════════════════════════════════════════════════
        case "CERRAR_CORTE": {
          if (!esAdmin) return forbidden();
          for (const id of (d.devueltos || [])) {
            await sb.update("consignacion", id, { estado: "devuelto" });
          }
          const allCons = await sb.query("consignacion", "vendedor", "==", d.vendedor);
          for (const c of allCons.filter(c => c.estado === "activo")) {
            const cantC = parseInt(c.cantidad) || 0, vendC = parseInt(c.vendido) || 0;
            if (cantC > 0 && vendC >= cantC) {
              // Pieza totalmente vendida: se cierra en vez de resetear vendido
              // a 0 — antes esto dejaba cantidad intacta con vendido:0, así que
              // la pieza (ya vendida y ya cobrada en este mismo corte) volvía
              // a aparecer como "disponible" en el inventario del vendedor.
              await sb.update("consignacion", c.id, { estado: "vendido" });
            } else {
              await sb.update("consignacion", c.id, { vendido: 0 });
            }
          }
          await sb.update("vendedores", d.vendedor, {
            totalVendido: 0,
            fechaCorte: new Date().toISOString()
          });
          result = { ok: true };
          break;
        }

        case "GUARDAR_CORTE_HISTORIAL": {
          if (!esAdmin) return forbidden();
          const corteId = String(d.id);
          await sb.set("cortes_historial", corteId, {
            id: corteId,
            vendedor:          d.vendedor,
            vendedorNombre:    d.vendedorNombre    || "",
            vendedorTelefono:  d.vendedorTelefono  || "",
            fecha:             d.fecha || new Date().toISOString(),
            totalVendido:      d.totalVendido,
            comisionPct:       d.comisionPct,
            gananciaVendedor:  d.gananciaVendedor,
            aPagarVerex:       d.aPagarVerex,
            items:             JSON.stringify(d.items || []),
          });
          result = { ok: true };
          break;
        }

        case "GET_HISTORIAL_CORTES": {
          const cortes = await sb.query("cortes_historial", "vendedor", "==", d.vendedor);
          result = { ok: true, cortes };
          break;
        }

        // Todos los cortes (de cualquier vendedor), marcando cuáles son de un
        // afiliado sin stock físico — el Dashboard usa esto para descontar del
        // ingreso bruto la comisión YA pagada a esos afiliados.
        case "GET_CORTES_HISTORIAL_TODOS": {
          if (!esAdmin) return forbidden();
          const [cortes, vends] = await Promise.all([
            sb.getAll("cortes_historial"),
            sb.getAll("vendedores")
          ]);
          const vendMap = new Map(vends.map(v => [v.codigo, v]));
          const enriquecidos = cortes.map(c => {
            const vend = vendMap.get(c.vendedor);
            return { ...c, esAfiliadoSinStock: vend?.tipo === "afiliado" && !vend?.recibeFisico };
          });
          result = { ok: true, cortes: enriquecidos };
          break;
        }

        // ══ VENTAS DIRECTAS ═══════════════════════════════════════
        case "REGISTRAR_VENTA_DIRECTA": {
          if (!esAdmin) return forbidden();
          const vdId = d.id || `VD_${Date.now()}`;
          await sb.set("ventas_directas", vdId, {
            id: vdId, fecha: d.fecha || new Date().toISOString(),
            cliente: d.cliente || "", telefono: d.telefono || "",
            items: JSON.stringify(d.items || []),
            subtotal: d.subtotal || d.total || 0,
            descuento: d.descuento || 0,
            descuentoTipo:  d.descuentoTipo  || "monto",
            descuentoValor: d.descuentoValor || 0,
            costoEnvio: d.costoEnvio || 0,
            direccionEnvio: d.direccionEnvio || "",
            departamentoEnvio: d.departamentoEnvio || "",
            empresaEnvio: d.empresaEnvio || "",
            total: d.total || 0,
            tipo: d.tipo || "contado",
            metodoPago: d.metodoPago || "efectivo",
            enganche: d.enganche || 0,
            saldoPendiente: d.saldoPendiente || 0,
            nota: d.nota || "",
            estado: d.estado || "pagado"
          });
          // Registrar/actualizar el cliente en el mismo directorio que usa el ecommerce
          // (deduplicado por teléfono), para que aparezca en Clientes con su canal.
          if (d.telefono) {
            const clientesVD = await sb.getAll("clientes");
            const normTelVD = t => String(t || "").replace(/\D/g, "");
            const cliExistVD = clientesVD.find(c => normTelVD(c.telefono) === normTelVD(d.telefono));
            if (cliExistVD) {
              await sb.update("clientes", cliExistVD.codigo, {
                totalPedidos: (parseInt(cliExistVD.totalPedidos)||0) + 1,
                totalPedidosDirecta: (parseInt(cliExistVD.totalPedidosDirecta)||0) + 1,
                // Solo guarda la dirección/departamento si el cliente aún no
                // tenía uno — no pisa datos ya conocidos con un envío distinto.
                ...(!cliExistVD.direccion && d.direccionEnvio ? { direccion: d.direccionEnvio } : {}),
                ...(!cliExistVD.departamento && d.departamentoEnvio ? { departamento: d.departamentoEnvio } : {})
              });
            } else {
              const codigoClienteVD = `CVX-${String(clientesVD.length + 1).padStart(3, "0")}`;
              await sb.set("clientes", codigoClienteVD, {
                codigo: codigoClienteVD, nombre: d.cliente || "", telefono: d.telefono,
                correo: "", municipio: "", direccion: d.direccionEnvio || "", departamento: d.departamentoEnvio || "",
                totalPedidos: 1, totalPedidosEcommerce: 0, totalPedidosDirecta: 1,
                fechaRegistro: new Date().toISOString()
              });
            }
          }
          const itemsSinStock = [];
          for (const item of (d.items || [])) {
            if (!item.codigo) { itemsSinStock.push("SIN_CODIGO"); continue; }
            const s = await sb.get("stock", item.codigo);
            if (s) {
              const cant     = parseInt(item.cantidad) || 1;
              const bodega   = parseInt(s.stock_bodega)   || 0;
              const tienda   = parseInt(s.stock_tienda)   || 0;
              const vendido  = parseInt(s.stock_vendido)  || 0;
              // Descontar primero de tienda si hay, luego de bodega
              let descBodega = 0, descTienda = 0;
              if (tienda >= cant) {
                descTienda = cant;
              } else {
                descTienda = tienda;
                descBodega = cant - tienda;
              }
              await sb.update("stock", item.codigo, {
                stock_tienda:  Math.max(0, tienda  - descTienda),
                stock_bodega:  Math.max(0, bodega  - descBodega),
                stock_vendido: vendido + cant
              });
            } else {
              itemsSinStock.push(item.codigo);
            }
          }
          result = { ok: true, itemsSinStock };
          break;
        }

        case "AJUSTAR_STOCK_MANUAL": {
          if (!esAdmin) return forbidden();
          const { codigo: codAj, campo: campoAj, delta: deltaAj } = d;
          if (!codAj || !campoAj || deltaAj == null) { result = { ok: false, error: "Faltan parámetros: codigo, campo, delta" }; break; }
          const camposPermitidos = ["stock_bodega","stock_tienda","stock_reservado","stock_consignacion","stock_vendido"];
          if (!camposPermitidos.includes(campoAj)) { result = { ok: false, error: "Campo no permitido" }; break; }
          const sAj = await sb.get("stock", codAj);
          if (!sAj) { result = { ok: false, error: "Producto no encontrado en stock" }; break; }
          const valorActual = parseInt(sAj[campoAj]) || 0;
          const valorNuevo  = Math.max(0, valorActual + parseInt(deltaAj));
          await sb.update("stock", codAj, { [campoAj]: valorNuevo });
          result = { ok: true, anterior: valorActual, nuevo: valorNuevo };
          break;
        }

        case "GET_VENTAS_DIRECTAS": {
          if (!esAdmin) return forbidden();
          let ventas = await sb.getAll("ventas_directas");
          if (d.estado) ventas = ventas.filter(v => v.estado === d.estado);
          ventas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
          result = { ok: true, ventas };
          break;
        }

        case "ACTUALIZAR_DESCUENTO_VD": {
          if (!esAdmin) return forbidden();
          const vd = await sb.get("ventas_directas", d.id);
          if (!vd) { result = { ok: false, error: "Venta no encontrada" }; break; }
          // Si viene totalReal, el total registrado estaba mal y hay que corregirlo.
          // subtotal = precio sin descuento (lo que estaba registrado antes),
          // total    = precio real cobrado al cliente.
          const subtotalNuevo = parseFloat(d.subtotal) || parseFloat(vd.total || 0);
          const totalNuevo    = (d.totalReal != null) ? parseFloat(d.totalReal) : parseFloat(vd.total || 0);
          const descNuevo     = Math.max(0, subtotalNuevo - totalNuevo);
          // Lo ya pagado hasta ahora = total viejo - saldo viejo (incluye enganche
          // Y cualquier abono ya registrado). Usar "enganche" acá era el bug: con
          // enganche=0 (crédito sin inicial), "0 || totalNuevo" da totalNuevo en JS
          // (0 es falsy), dejando el saldo en $0 aunque no se hubiera pagado nada.
          const pagadoHastaAhora = Math.max(0, (parseFloat(vd.total)||0) - (parseFloat(vd.saldoPendiente)||0));
          await sb.update("ventas_directas", d.id, {
            subtotal:       subtotalNuevo,
            total:          totalNuevo,
            descuento:      descNuevo,
            descuentoTipo:  d.descuentoTipo  || "monto",
            descuentoValor: d.descuentoValor || descNuevo,
            saldoPendiente: Math.max(0, totalNuevo - pagadoHastaAhora),
          });
          result = { ok: true };
          break;
        }

        case "REGISTRAR_ABONO": {
          if (!esAdmin) return forbidden();
          const abonoId = `AB_${Date.now()}`;
          await sb.set("abonos", abonoId, {
            id: abonoId, ventaId: d.ventaId,
            fecha: new Date().toISOString(), monto: d.monto || 0
          });
          const vd = await sb.get("ventas_directas", d.ventaId);
          if (vd) {
            const nuevoSaldo = Math.max(0, (parseFloat(vd.saldoPendiente)||0) - (d.monto||0));
            await sb.update("ventas_directas", d.ventaId, {
              saldoPendiente: nuevoSaldo,
              estado: nuevoSaldo <= 0 ? "pagado" : "credito"
            });
          }
          result = { ok: true };
          break;
        }

        case "CAMBIAR_PRODUCTO_VENTA_DIRECTA": {
          // Cambio de pieza en una venta directa ya registrada (ej. devolución
          // por cambio). Regresa la pieza vieja a bodega, descuenta la nueva,
          // y ajusta total/saldoPendiente por la diferencia de precio — puede
          // subir el saldo (pieza nueva más cara) o bajarlo (más barata).
          if (!esAdmin) return forbidden();
          const vdCam = await sb.get("ventas_directas", d.id);
          if (!vdCam) { result = { ok: false, error: "Venta no encontrada" }; break; }
          const itemsCam = JSON.parse(vdCam.items || "[]");
          const idxCam = itemsCam.findIndex(it => it.codigo === d.codigoViejo);
          if (idxCam === -1) { result = { ok: false, error: "Ese producto no está en esta venta" }; break; }
          const itemViejo = itemsCam[idxCam];
          const cantCam = parseInt(itemViejo.cantidad) || 1;

          const codigoNuevoCam = String(d.codigoNuevo || "").trim();
          if (!codigoNuevoCam) { result = { ok: false, error: "Falta el código del producto nuevo" }; break; }
          const sNuevoCam = await sb.get("stock", codigoNuevoCam);
          if (!sNuevoCam) { result = { ok: false, error: "El producto nuevo (" + codigoNuevoCam + ") no existe en stock" }; break; }
          const dispNuevoCam = (parseInt(sNuevoCam.stock_bodega)||0) + (parseInt(sNuevoCam.stock_tienda)||0);
          if (dispNuevoCam < cantCam) { result = { ok: false, error: "Sin stock suficiente del producto nuevo" }; break; }

          // Devolver la pieza vieja a bodega
          const sViejoCam = await sb.get("stock", d.codigoViejo);
          if (sViejoCam) {
            await sb.update("stock", d.codigoViejo, {
              stock_bodega: (parseInt(sViejoCam.stock_bodega)||0) + cantCam,
              stock_vendido: Math.max(0, (parseInt(sViejoCam.stock_vendido)||0) - cantCam)
            });
          }
          // Descontar la pieza nueva (bodega primero, luego tienda)
          const bodNuevoCam = parseInt(sNuevoCam.stock_bodega)||0, tieNuevoCam = parseInt(sNuevoCam.stock_tienda)||0;
          const restaBodCam = Math.min(cantCam, bodNuevoCam);
          await sb.update("stock", codigoNuevoCam, {
            stock_bodega: Math.max(0, bodNuevoCam - restaBodCam),
            stock_tienda: Math.max(0, tieNuevoCam - (cantCam - restaBodCam)),
            stock_vendido: (parseInt(sNuevoCam.stock_vendido)||0) + cantCam
          });

          // Reemplazar el item y ajustar montos por la diferencia de precio
          const precioViejoCam = parseFloat(itemViejo.precio) || 0;
          const precioNuevoCam = parseFloat(sNuevoCam.precio) || 0;
          const diffCam = (precioNuevoCam - precioViejoCam) * cantCam;
          itemsCam[idxCam] = {
            ...itemViejo,
            codigo: codigoNuevoCam,
            nombre: sNuevoCam.nombre_base || sNuevoCam.nombre || codigoNuevoCam,
            precio: precioNuevoCam,
            cambiadoDe: d.codigoViejo,
            fechaCambio: new Date().toISOString() // para que el recibo marque que esta pieza no es de la fecha original
          };

          const totalCam = Math.max(0, (parseFloat(vdCam.total)||0) + diffCam);
          const subtotalCam = Math.max(0, (parseFloat(vdCam.subtotal)||0) + diffCam);
          const saldoCam = Math.max(0, (parseFloat(vdCam.saldoPendiente)||0) + diffCam);
          const fechaCam = new Date().toLocaleDateString("es-SV", { day: "numeric", month: "short", year: "numeric" });
          const notaCam = `🔄 Cambio el ${fechaCam}: "${itemViejo.nombre||d.codigoViejo}" (${d.codigoViejo}) → "${itemsCam[idxCam].nombre}" (${codigoNuevoCam})${diffCam !== 0 ? ` — diferencia $${diffCam.toFixed(2)}` : ""}${d.motivo ? " — Motivo: " + d.motivo : ""}`;

          await sb.update("ventas_directas", d.id, {
            items: JSON.stringify(itemsCam),
            total: totalCam,
            subtotal: subtotalCam,
            saldoPendiente: saldoCam,
            estado: saldoCam <= 0 ? "pagado" : "credito",
            nota: (vdCam.nota ? vdCam.nota + "\n" : "") + notaCam
          });
          result = { ok: true, diferencia: diffCam, nuevoTotal: totalCam, nuevoSaldo: saldoCam };
          break;
        }

        case "AGREGAR_PRODUCTO_VENTA_DIRECTA": {
          // Suma una pieza NUEVA a una venta directa ya registrada (ej. el
          // cliente aprovecha una devolución/cambio para llevarse algo más)
          // — a diferencia de CAMBIAR_PRODUCTO_VENTA_DIRECTA, esto no quita
          // nada, solo agrega, así el cliente queda con un solo saldo
          // combinado en vez de dos créditos sueltos que rastrear.
          if (!esAdmin) return forbidden();
          const vdAdd = await sb.get("ventas_directas", d.id);
          if (!vdAdd) { result = { ok: false, error: "Venta no encontrada" }; break; }
          const codigoAdd = String(d.codigo || "").trim();
          if (!codigoAdd) { result = { ok: false, error: "Falta el código del producto" }; break; }
          const cantAdd = Math.max(1, parseInt(d.cantidad) || 1);
          const sAdd = await sb.get("stock", codigoAdd);
          if (!sAdd) { result = { ok: false, error: "El producto (" + codigoAdd + ") no existe en stock" }; break; }
          const dispAdd = (parseInt(sAdd.stock_bodega)||0) + (parseInt(sAdd.stock_tienda)||0);
          if (dispAdd < cantAdd) { result = { ok: false, error: "Sin stock suficiente" }; break; }

          const bodAdd = parseInt(sAdd.stock_bodega)||0, tieAdd = parseInt(sAdd.stock_tienda)||0;
          const restaBodAdd = Math.min(cantAdd, bodAdd);
          await sb.update("stock", codigoAdd, {
            stock_bodega: Math.max(0, bodAdd - restaBodAdd),
            stock_tienda: Math.max(0, tieAdd - (cantAdd - restaBodAdd)),
            stock_vendido: (parseInt(sAdd.stock_vendido)||0) + cantAdd
          });

          const itemsAdd = JSON.parse(vdAdd.items || "[]");
          const precioAdd = parseFloat(sAdd.precio) || 0;
          itemsAdd.push({
            codigo: codigoAdd,
            nombre: sAdd.nombre_base || sAdd.nombre || codigoAdd,
            precio: precioAdd,
            cantidad: cantAdd,
            fechaAgregado: new Date().toISOString() // para que el recibo marque que no es de la compra original
          });
          const montoAdd = precioAdd * cantAdd;
          const totalAdd = (parseFloat(vdAdd.total)||0) + montoAdd;
          const subtotalAdd = (parseFloat(vdAdd.subtotal)||0) + montoAdd;
          const saldoAdd = (parseFloat(vdAdd.saldoPendiente)||0) + montoAdd;
          const fechaAdd = new Date().toLocaleDateString("es-SV", { day: "numeric", month: "short", year: "numeric" });
          const notaAdd = `➕ Pieza agregada el ${fechaAdd}: "${itemsAdd[itemsAdd.length-1].nombre}" (${codigoAdd}) x${cantAdd} — $${montoAdd.toFixed(2)}`;

          await sb.update("ventas_directas", d.id, {
            items: JSON.stringify(itemsAdd),
            total: totalAdd,
            subtotal: subtotalAdd,
            saldoPendiente: saldoAdd,
            estado: saldoAdd <= 0 ? "pagado" : "credito",
            nota: (vdAdd.nota ? vdAdd.nota + "\n" : "") + notaAdd
          });
          result = { ok: true, montoAgregado: montoAdd, nuevoTotal: totalAdd, nuevoSaldo: saldoAdd };
          break;
        }

        case "CORREGIR_SALDO_VD": {
          // Corrección manual — repara ventas donde subtotal/total/saldo quedaron
          // desalineados de la suma real de productos (ver nota de arriba en
          // AGREGAR/CAMBIAR: cada acción solo suma/resta un número al anterior,
          // así que un error en un paso arrastra a todos los siguientes).
          // Si solo viene saldoPendiente, se comporta como antes (ajuste rápido).
          // Si vienen subtotal/total, se corrigen también esos campos juntos.
          if (!esAdmin) return forbidden();
          const vdCorr = await sb.get("ventas_directas", d.id);
          if (!vdCorr) { result = { ok: false, error: "Venta no encontrada" }; break; }
          const nuevoSaldoCorr = Math.max(0, parseFloat(d.saldoPendiente) || 0);
          const patchCorr = {
            saldoPendiente: nuevoSaldoCorr,
            estado: nuevoSaldoCorr <= 0 ? "pagado" : "credito",
          };
          if (d.subtotal != null) patchCorr.subtotal = Math.max(0, parseFloat(d.subtotal) || 0);
          if (d.total != null)    patchCorr.total    = Math.max(0, parseFloat(d.total) || 0);
          if (d.descuento != null) patchCorr.descuento = Math.max(0, parseFloat(d.descuento) || 0);
          await sb.update("ventas_directas", d.id, patchCorr);
          result = { ok: true, nuevoSaldo: nuevoSaldoCorr, patch: patchCorr };
          break;
        }

        case "MARCAR_FECHA_ITEM_VD": {
          // Repara piezas agregadas/cambiadas ANTES de que existiera el
          // marcador de fecha en el recibo (AGREGAR/CAMBIAR_PRODUCTO_VENTA_
          // DIRECTA) — les asigna fechaAgregado retroactivamente.
          if (!esAdmin) return forbidden();
          const vdFecha = await sb.get("ventas_directas", d.id);
          if (!vdFecha) { result = { ok: false, error: "Venta no encontrada" }; break; }
          const itemsFecha = JSON.parse(vdFecha.items || "[]");
          const idxFecha = itemsFecha.findIndex(it => it.codigo === d.codigo);
          if (idxFecha === -1) { result = { ok: false, error: "Producto no encontrado en esta venta" }; break; }
          itemsFecha[idxFecha] = { ...itemsFecha[idxFecha], fechaAgregado: d.fecha || new Date().toISOString() };
          await sb.update("ventas_directas", d.id, { items: JSON.stringify(itemsFecha) });
          result = { ok: true };
          break;
        }

        case "GET_ABONOS_VENTA": {
          if (!esAdmin) return forbidden();
          const abonos = await sb.query("abonos", "ventaId", "==", d.ventaId);
          result = { ok: true, abonos };
          break;
        }

        case "REGISTRAR_VENTA_VENDEDOR": {
          const consV = await sb.get("consignacion", d.id);
          if (!consV) { result = { ok: false, error: "Item no encontrado" }; break; }
          const cantVentaV = parseInt(d.cantidad) || 1;
          const nuevoVendidoV = (parseInt(consV.vendido)||0) + cantVentaV;
          await sb.update("consignacion", d.id, { vendido: nuevoVendidoV });
          const sV = await sb.get("stock", consV.codigo);
          if (sV) {
            await sb.update("stock", consV.codigo, {
              stock_vendido: (parseInt(sV.stock_vendido)||0) + cantVentaV
            });
          }
          // Se guarda un registro INDIVIDUAL de esta venta (con su fecha/hora
          // real) dentro del vendedor, en vez de solo incrementar el contador
          // "vendido" compartido — antes GET_VENTAS_VENDEDOR devolvía el
          // registro de consignación completo (con la fecha de ENTREGA de la
          // pieza, no la de la venta), así que el historial del vendedor
          // mostraba fechas/horas equivocadas para cada venta.
          const ventaIdV = `VV_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
          const vendV = await sb.get("vendedores", d.vendedor);
          const historialV = vendV && Array.isArray(vendV.historialVentas) ? vendV.historialVentas : [];
          historialV.push({
            id: ventaIdV, consignacionId: d.id,
            codigo: consV.codigo, nombre: d.nombre || consV.nombre || "",
            precio: d.precio ?? consV.precio ?? 0, foto: d.foto || consV.foto || "",
            cantidad: cantVentaV, fecha: new Date().toISOString()
          });
          if (vendV) await sb.update("vendedores", d.vendedor, { historialVentas: historialV });

          // Si esa era la última pieza física que tenía el vendedor pero
          // VEREX todavía tiene stock en bodega, se avisa al admin para que
          // le reponga — el vendedor pudo vender "bajo pedido" sin perder
          // el negocio, pero alguien tiene que acordarse de surtirlo.
          const restanteV = (parseInt(consV.cantidad)||0) - nuevoVendidoV;
          if (restanteV <= 0 && (parseInt(sV?.stock_bodega)||0) > 0 && vendV) {
            const pendientesV = Array.isArray(vendV.reposicionesPendientes) ? vendV.reposicionesPendientes : [];
            if (!pendientesV.some(r => r.codigo === consV.codigo)) {
              pendientesV.push({ codigo: consV.codigo, nombre: consV.nombre || "", fecha: new Date().toISOString() });
              await sb.update("vendedores", d.vendedor, { reposicionesPendientes: pendientesV });
            }
          }
          result = { ok: true, ventaId: ventaIdV };
          break;
        }

        case "GET_REPOSICIONES_PENDIENTES": {
          if (!esAdmin) return forbidden();
          const todosVendRep = await sb.getAll("vendedores");
          const reposiciones = [];
          for (const v of todosVendRep) {
            for (const r of (v.reposicionesPendientes || [])) {
              reposiciones.push({ vendedor: v.codigo, vendedorNombre: v.nombre, codigo: r.codigo, nombre: r.nombre, fecha: r.fecha });
            }
          }
          result = { ok: true, reposiciones };
          break;
        }

        case "RESOLVER_REPOSICION": {
          if (!esAdmin) return forbidden();
          if (!d.vendedor || !d.codigo) { result = { ok: false, error: "vendedor y codigo requeridos" }; break; }
          const vendRes = await sb.get("vendedores", d.vendedor);
          if (!vendRes) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
          const restantesRes = (vendRes.reposicionesPendientes || []).filter(r => r.codigo !== d.codigo);
          await sb.update("vendedores", d.vendedor, { reposicionesPendientes: restantesRes });
          result = { ok: true };
          break;
        }

        case "GET_HISTORIAL_VENTAS": {
          if (!esAdmin) return forbidden();
          const [vd, peds, consig, vends] = await Promise.all([
            sb.getAll("ventas_directas"),
            sb.getAll("pedidos"),
            sb.getAll("consignacion"),
            sb.getAll("vendedores")
          ]);
          const vendMap = new Map(vends.map(v => [v.codigo, v]));
          const unificadas = [
            ...vd.map(v => ({
              id: v.id, fecha: v.fecha, tipo: "directa",
              cliente: v.cliente || "—", telefono: v.telefono || "",
              total: parseFloat(v.total || 0),
              estado: v.estado || "pagado",
              saldoPendiente: parseFloat(v.saldoPendiente || 0),
              items: v.items || "[]",
              nota: v.nota || "",
              metodoPago: v.metodoPago || "",
              // Faltaban estos — sin ellos, el recibo generado DESDE el
              // Historial (no el que sale justo al confirmar la venta) no
              // podía mostrar el desglose de descuento ni "Envío: GRATIS".
              subtotal: v.subtotal != null ? parseFloat(v.subtotal) : undefined,
              descuento: parseFloat(v.descuento || 0),
              costoEnvio: parseFloat(v.costoEnvio || 0),
              departamentoEnvio: v.departamentoEnvio || "",
              direccionEnvio: v.direccionEnvio || "",
              tipo_venta: v.tipo || "contado",
              enganche: parseFloat(v.enganche || 0)
            })),
            ...peds.map(p => ({
              id: p.numeroPedido || p.id, fecha: p.fecha, tipo: "catalogo",
              cliente: p.cliente || "—", telefono: p.telefono || "",
              total: parseFloat(p.total || 0),
              estado: p.estado || "pendiente",
              saldoPendiente: 0,
              items: JSON.stringify(
                (p.productos || "").split(",").filter(Boolean).map(x => ({ nombre: x.trim() }))
              ),
              nota: p.municipio || ""
            })),
            // Un vendedor de consignación tradicional (con piezas físicas) cobra él
            // mismo al cliente y liquida con VEREX después — esa venta NO es dinero
            // que ya entró a la caja de VEREX, así que se etiqueta aparte.
            // Un afiliado SIN piezas físicas es distinto: VEREX entrega y cobra
            // directo al cliente, así que ese dinero sí es ingreso real de VEREX
            // ya en caja (solo falta pagarle la comisión al afiliado).
            ...consig.filter(c => parseInt(c.vendido) > 0).map(c => {
              const vend = vendMap.get(c.vendedor);
              const esAfiliadoSinStock = vend?.tipo === "afiliado" && !vend?.recibeFisico;
              return {
                id: c.id, fecha: c.fecha,
                tipo: esAfiliadoSinStock ? "afiliado_sin_stock" : "consignacion",
                cliente: c.vendedor || "—", telefono: "",
                afiliadoNombre: vend?.nombre || c.vendedor || "",
                total: parseFloat(c.precio || 0) * parseInt(c.vendido || 1),
                estado: "pagado",
                saldoPendiente: 0,
                items: JSON.stringify([{ nombre: c.nombre || c.codigo, cantidad: c.vendido, precio: c.precio }]),
                nota: c.notaCambio || ""
              };
            })
          ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
          result = { ok: true, ventas: unificadas };
          break;
        }

        case "GET_VENTAS_VENDEDOR": {
          const vendGV = await sb.get("vendedores", d.vendedor);
          result = { ok: true, ventas: (vendGV && Array.isArray(vendGV.historialVentas)) ? vendGV.historialVentas : [] };
          break;
        }

        case "CERRAR_MES": {
          if (!esAdmin) return forbidden();
          const ahoraCM = new Date();
          // Por defecto cierra el MES ANTERIOR (el actual sigue corriendo) —
          // d.anio/d.mes (mes 1-indexado) permiten forzar un mes específico.
          let anioCM, mesCM0;
          if (d.anio != null && d.mes != null) {
            anioCM = parseInt(d.anio); mesCM0 = parseInt(d.mes) - 1;
          } else {
            mesCM0 = ahoraCM.getUTCMonth() - 1; anioCM = ahoraCM.getUTCFullYear();
            if (mesCM0 < 0) { mesCM0 = 11; anioCM -= 1; }
          }
          const cierreCM = await generarCierreMes(sb, anioCM, mesCM0);
          const cfgCM = await sb.get("config", "cierres_mensuales");
          const listaCM = (cfgCM && Array.isArray(cfgCM.lista)) ? cfgCM.lista.filter(c => c.id !== cierreCM.id) : [];
          listaCM.push(cierreCM);
          listaCM.sort((a, b) => b.id.localeCompare(a.id));
          await sb.set("config", "cierres_mensuales", { lista: listaCM });
          result = { ok: true, cierre: cierreCM };
          break;
        }

        case "GET_CIERRES_MENSUALES": {
          if (!esAdmin) return forbidden();
          const cfgGCM = await sb.get("config", "cierres_mensuales");
          result = { ok: true, cierres: (cfgGCM && Array.isArray(cfgGCM.lista)) ? cfgGCM.lista : [] };
          break;
        }

        // Migración de UNA SOLA VEZ: antes de que existiera historialVentas,
        // una venta solo incrementaba consignacion.vendido sin dejar registro
        // individual — así que "Mis Ventas" quedó vacío para todo lo vendido
        // antes de esa fecha, aunque el vendedor sí lo vendió y VEREX ya lo
        // sabe (está en el total de consignacion.vendido). Esto rellena un
        // registro aproximado por cada item ya vendido que aún no tenga
        // historial, usando la fecha de ENTREGA como mejor aproximación
        // disponible (marcado "migrado" para dejarlo claro). Es idempotente:
        // se puede correr varias veces sin duplicar, porque salta cualquier
        // consignacionId que ya tenga un registro (migrado o real).
        case "MIGRAR_HISTORIAL_VENTAS_ANTIGUAS": {
          if (!esAdmin) return forbidden();
          const [todosVendMig, todaConsMig] = await Promise.all([
            sb.getAll("vendedores"),
            sb.getAll("consignacion"),
          ]);
          let creados = 0;
          for (const v of todosVendMig) {
            const historialMig = Array.isArray(v.historialVentas) ? [...v.historialVentas] : [];
            const yaTiene = new Set(historialMig.map(h => h.consignacionId).filter(Boolean));
            const itemsVend = todaConsMig.filter(c => c.vendedor === v.codigo && (parseInt(c.vendido)||0) > 0);
            let cambiado = false;
            for (const c of itemsVend) {
              if (yaTiene.has(c.id)) continue;
              historialMig.push({
                id: `MIG_${c.id}`, consignacionId: c.id,
                codigo: c.codigo, nombre: c.nombre || "",
                precio: c.precio || 0, foto: c.foto || "",
                cantidad: parseInt(c.vendido)||1,
                fecha: c.fecha || new Date().toISOString(),
                migrado: true
              });
              cambiado = true; creados++;
            }
            if (cambiado) await sb.update("vendedores", v.codigo, { historialVentas: historialMig });
          }
          result = { ok: true, creados };
          break;
        }

        case "SOLICITAR_CORRECCION_VENTA": {
          const solId = `SOL_${Date.now()}`;
          await sb.set("solicitudes_correccion", solId, {
            id: solId, ventaId: d.ventaId || "",
            vendedor: d.vendedor || "", vendedorNombre: d.vendedorNombre || "", motivo: d.motivo || "",
            codigo: d.codigo || "", nombre: d.nombre || "", cantidad: parseInt(d.cantidad)||1,
            estado: "pendiente",
            fecha: new Date().toISOString()
          });
          result = { ok: true };
          break;
        }

        case "GET_DEVOLUCIONES_VENDEDOR": {
          const devs = await sb.query("devoluciones", "vendedor", "==", d.vendedor);
          result = { ok: true, devoluciones: devs };
          break;
        }

        // ══ CATÁLOGO PÚBLICO POR VENDEDOR (sin auth) ══════════════
        case "CATALOGO_VENDEDOR": {
          const vendCod = d.vendedor;
          if (!vendCod) { result = { ok: false, razon: "no_encontrado" }; break; }
          const [vend, cons] = await Promise.all([
            sb.get("vendedores", vendCod),
            sb.query("consignacion", "vendedor", "==", vendCod),
          ]);
          // Vendedor no existe
          if (!vend) { result = { ok: false, razon: "no_encontrado" }; break; }
          // Catálogo no activado
          if (!vend.catalogoActivo) { result = { ok: false, razon: "no_activo" }; break; }
          // Validar 30 días desde último corte
          if (vend.fechaCorte) {
            const diasDesdeCorte = (Date.now() - new Date(vend.fechaCorte).getTime()) / (1000 * 60 * 60 * 24);
            if (diasDesdeCorte > 30) { result = { ok: false, razon: "vencido" }; break; }
          }
          // Solo items activos con stock disponible
          const items = cons
            .filter(c => c.estado === "activo" && (parseInt(c.cantidad||0) - parseInt(c.vendido||0)) > 0)
            .map(c => ({
              codigo:    c.codigo,
              nombre:    c.nombre_base || c.nombre,
              precio:    c.precio,
              foto:      c.foto || "",
              categoria: c.categoria || "",
            }));
          result = {
            ok: true,
            vendedor: { nombre: vend.nombre, telefono: vend.telefono },
            items,
          };
          break;
        }

        // ══ PEDIDOS TIENDA ════════════════════════════════════════
        case "GUARDAR_PEDIDO": {
          const pedidoId = d.numeroPedido || `PED_${Date.now()}`;
          await sb.set("pedidos", pedidoId, { ...d, id: pedidoId });
          result = { ok: true, numeroPedido: pedidoId };
          break;
        }

        case "GET_PEDIDOS": {
          if (!esAdmin) return forbidden();
          const pedidos = await sb.getAll("pedidos");
          result = { ok: true, pedidos };
          break;
        }

        case "ACTUALIZAR_ESTADO_PEDIDO": {
          if (!esAdmin) return forbidden();

          // Cargar pedido actual para verificar si ya se actualizó el stock
          const pedidoActual = await sb.get("pedidos", d.numeroPedido);
          if (!pedidoActual) { result = { ok: false, error: "Pedido no encontrado" }; break; }

          // Guardar nuevo estado
          await sb.update("pedidos", d.numeroPedido, { estado: d.estado });

          // ── Ajustar stock según nuevo estado ──────────────────────
          let itemsEst = [];
          try {
            itemsEst = typeof pedidoActual.items === "string"
              ? JSON.parse(pedidoActual.items) : (pedidoActual.items || []);
          } catch(_) {}

          if (d.estado === "Entregado" && !pedidoActual.stockActualizado) {
            // Reservado → Vendido
            for (const item of itemsEst) {
              if (!item.codigo) continue;
              const prod = await sb.get("stock", item.codigo);
              if (!prod) continue;
              const qty = parseInt(item.cantidad || 1);
              const upd = {
                stock_reservado: Math.max(0, (parseInt(prod.stock_reservado)||0) - qty),
                stock_vendido:   (parseInt(prod.stock_vendido)||0) + qty,
              };
              // Talla específica para anillos
              const talla = item.tallaElegida;
              if (talla && talla !== "—" && prod.caracteristicas) {
                try {
                  const chars = typeof prod.caracteristicas === "string"
                    ? JSON.parse(prod.caracteristicas) : prod.caracteristicas;
                  if (chars[talla] !== undefined) {
                    chars[talla] = Math.max(0, (parseInt(chars[talla])||0) - qty);
                    upd.caracteristicas = JSON.stringify(chars);
                  }
                } catch(_) {}
              }
              await sb.update("stock", item.codigo, upd);
            }
            await sb.update("pedidos", d.numeroPedido, { stockActualizado: true });

          } else if ((d.estado === "Cancelado" || d.estado === "No entregado") && !pedidoActual.stockLiberado) {
            // Reservado → regresa a Tienda
            for (const item of itemsEst) {
              if (!item.codigo) continue;
              const prod = await sb.get("stock", item.codigo);
              if (!prod) continue;
              const qty = parseInt(item.cantidad || 1);
              await sb.update("stock", item.codigo, {
                stock_reservado: Math.max(0, (parseInt(prod.stock_reservado)||0) - qty),
                stock_tienda:    (parseInt(prod.stock_tienda)||0) + qty,
                enCatalogo:      true
              });
            }
            await sb.update("pedidos", d.numeroPedido, { stockLiberado: true });
          }

          // ── Notificar al cliente si fue Despachado, ordenó por correo y tiene correo ──
          if (d.estado === "Despachado" && pedidoActual.canal === "correo" && pedidoActual.correo) {
            try {
              const RESEND_KEY = env.RESEND_KEY;
              if (RESEND_KEY) {
                await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
                  body: JSON.stringify({
                    from: "VEREX Store <hola@verexstore.com>",
                    to:   [pedidoActual.correo],
                    subject: `🚚 Tu pedido ${pedidoActual.numeroPedido} está en camino — VEREX Store`,
                    html: `
                      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;border:2px solid #C9A84C;border-radius:12px;overflow:hidden;">
                        <div style="background:linear-gradient(135deg,#aaa,#d0d0d0);padding:24px;text-align:center;">
                          <h1 style="margin:0;font-size:22px;letter-spacing:3px;color:#111;">VEREX STORE</h1>
                          <p style="margin:6px 0 0;font-size:13px;color:#444;">🚚 Tu pedido está en camino</p>
                        </div>
                        <div style="padding:24px;">
                          <p style="margin:0 0 16px;font-size:15px;color:#111;">¡Hola, <strong>${pedidoActual.cliente}</strong>! 💛</p>
                          <p style="margin:0 0 16px;font-size:14px;color:#333;">¡Tenemos excelentes noticias! Tu pedido <strong>${pedidoActual.numeroPedido}</strong> ha sido despachado y ya está en camino hacia ti.</p>
                          <h2 style="color:#C9A84C;margin:0 0 16px;">${pedidoActual.numeroPedido}</h2>
                          <table style="width:100%;border-collapse:collapse;font-size:14px;">
                            <tr><td style="padding:6px 0;color:#555;">Productos</td><td style="font-weight:700;color:#111;">${pedidoActual.productos || "—"}</td></tr>
                            <tr><td style="padding:6px 0;color:#555;">Destino</td><td style="color:#111;">${pedidoActual.departamento || ""} ${pedidoActual.municipio || ""}</td></tr>
                            <tr><td style="padding:6px 0;color:#555;font-weight:700;">Total</td><td style="font-size:18px;font-weight:800;color:#C9A84C;">${pedidoActual.total}</td></tr>
                          </table>
                          <div style="margin:20px 0 0;padding:14px 16px;background:#b0b0b0;border-left:4px solid #C9A84C;border-radius:6px;font-size:13px;color:#333;">
                            🕐 <strong>Tiempos estimados de entrega:</strong><br><br>
                            Para el <strong>área metropolitana de San Salvador</strong>, tu pedido llegará en un máximo de <strong>24 horas</strong> a partir del despacho.<br><br>
                            Para el <strong>resto del país</strong>, el tiempo estimado es de máximo <strong>48 horas</strong>.
                          </div>
                          <p style="margin:16px 0 0;font-size:13px;color:#444;">Si tienes alguna consulta no dudes en escribirnos a <a href="mailto:hola@verexstore.com" style="color:#7a5500;">hola@verexstore.com</a></p>
                        </div>
                        <div style="padding:16px 24px;background:#f5f5f5;border-top:2px solid #C9A84C;text-align:center;font-size:12px;color:#888;">
                          El mundo es mejor cuando brillas tú ✨ — <a href="https://verexstore.com" style="color:#C9A84C;text-decoration:none;">verexstore.com</a>
                        </div>
                      </div>`
                  })
                });
              }
            } catch(dispatchEmailErr) { console.error("Dispatch email error:", dispatchEmailErr); }
          }

          result = { ok: true };
          break;
        }

        // ══ CLIENTES ══════════════════════════════════════════════
        case "GET_CLIENTES": {
          if (!esAdmin) return forbidden();
          const clientes = await sb.getAll("clientes");
          result = { ok: true, clientes };
          break;
        }

        case "GUARDAR_CLIENTE": {
          await sb.set("clientes", d.codigo || `CLI_${Date.now()}`, d);
          result = { ok: true };
          break;
        }

        // ══ CUPONES ═══════════════════════════════════════════════
        case "USAR_CUPON": {
          const cup = await sb.get("cupones", d.codigo);
          if (!cup) { result = { ok: false, error: "Cupón no encontrado" }; break; }
          if (cup.activo === false || cup.activo === "false") {
            result = { ok: false, error: "Cupón inactivo" }; break;
          }
          const usosActuales = (parseInt(cup.usosActuales) || 0);
          const limiteUsos   = parseInt(cup.limiteUsos) || 0;
          if (limiteUsos > 0 && usosActuales >= limiteUsos) {
            result = { ok: false, error: "Cupón agotado" }; break;
          }
          await sb.update("cupones", d.codigo, {
            usosActuales: usosActuales + 1,
            // Desactivar automáticamente si llegó al límite
            activo: limiteUsos > 0 ? (usosActuales + 1 < limiteUsos) : true
          });
          result = { ok: true };
          break;
        }

        // ══ CONFIG ════════════════════════════════════════════════
        case "GET_CONFIG": {
          const cfg = await sb.get("config", "settings");
          result = { ok: true, config: cfg || {} };
          break;
        }

        case "GUARDAR_CONFIG": {
          if (!esAdmin) return forbidden();
          await sb.update("config", "settings", d.config || {});
          result = { ok: true };
          break;
        }

        // ══ GENERAR CÓDIGO ════════════════════════════════════════
        case "GENERAR_CODIGO": {
          const cat = String(d.categoria || "GEN").toUpperCase().slice(0, 2);
          const mat = String(d.material || "").toLowerCase();
          const matChar = mat.includes("laminado")  ? "L"
                        : mat.includes("oro")       ? "O"
                        : mat.includes("acero")     ? "A"
                        : mat.includes("reloj")     ? "W"
                        : mat.includes("plata")     ? "P"
                        : "X";
          const prefijo = cat + matChar;
          const allStock = await sb.getAll("stock");
          let maxNum = 0;
          allStock.forEach(s => {
            const base = String(s.codigoBase || s.codigo || "").toUpperCase();
            if (base.startsWith(prefijo)) {
              const num = parseInt(base.slice(prefijo.length).replace(/T[\d.]+$/i, "")) || 0;
              if (num > maxNum) maxNum = num;
            }
          });
          result = { ok: true, codigo: `${prefijo}${String(maxNum + 1).padStart(3, "0")}` };
          break;
        }

        // ══ CATÁLOGO / TIENDA PÚBLICA ════════════════════════════
        case "GET_CATALOGO": {
          const [prods, cups, cfgDoc] = await Promise.all([
            sb.getAll("stock"),
            sb.getAll("cupones"),
            sb.get("config", "settings"),
          ]);
          const cfg2   = cfgDoc || {};
          const limite = parseInt(cfg2.limiteCatalogo) || 0; // 0 = sin límite

          let activos = prods.filter(p =>
            (p.enCatalogo === true || p.enCatalogo === "true" || p.enCatalogo === "TRUE") &&
            p.estado !== "inactivo"
          );

          // Separar destacados del resto
          const destacados = activos.filter(p => p.destacado === true || p.destacado === "TRUE" || p.destacado === "true");
          const normales   = activos.filter(p => !(p.destacado === true || p.destacado === "TRUE" || p.destacado === "true"));

          // Rotación semanal: semilla basada en número de semana del año
          const ahora     = new Date();
          const inicioAno = new Date(ahora.getFullYear(), 0, 1);
          const semana    = Math.floor((ahora - inicioAno) / (7 * 24 * 60 * 60 * 1000));
          // Shuffle determinístico con semilla semanal
          const shuffled = normales.slice().sort((a, b) => {
            const ha = parseInt(String(semana) + String((a.codigo||"").charCodeAt(0)||0), 10) % 997;
            const hb = parseInt(String(semana) + String((b.codigo||"").charCodeAt(0)||0), 10) % 997;
            return ha - hb;
          });

          // Destacados primero, luego rotados
          let final = [...destacados, ...shuffled];

          // Aplicar límite si está configurado
          if (limite > 0) final = final.slice(0, limite);

          result = {
            ok:        true,
            productos: final,
            cupones:   cups.filter(c => c.activo !== false && c.activo !== "false"),
            config:    cfg2
          };
          break;
        }

        // Migración/sincronización (segura de correr varias veces — recalcula, no
        // incrementa). Normaliza teléfonos (quita guiones/espacios) para detectar
        // que son la misma persona, fusiona clientes duplicados por número mal
        // formateado, y recalcula el conteo por canal desde los datos reales
        // (pedidos = ecommerce, ventas_directas = directa).
        case "MIGRAR_CLIENTES_VENTA_DIRECTA": {
          if (!esAdmin) return forbidden();
          const normTel = t => String(t || "").replace(/\D/g, "");
          const [ventasDirectas, pedidosAll, clientesAll] = await Promise.all([
            sb.getAll("ventas_directas"),
            sb.getAll("pedidos"),
            sb.getAll("clientes")
          ]);

          // 1. Agrupar clientes existentes por teléfono normalizado y fusionar duplicados
          const grupos = {};
          for (const c of clientesAll) {
            const tn = normTel(c.telefono);
            if (!tn) continue;
            (grupos[tn] = grupos[tn] || []).push(c);
          }
          let fusionados = 0;
          const vivos = {}; // tn -> cliente representativo (ya actualizado en memoria)
          for (const [tn, grupo] of Object.entries(grupos)) {
            grupo.sort((a, b) => new Date(a.fechaRegistro || 0) - new Date(b.fechaRegistro || 0));
            const principal = grupo[0];
            if (grupo.length > 1) {
              const sumaEco = grupo.reduce((s, c) => s + (parseInt(c.totalPedidosEcommerce) || 0), 0);
              const sumaDir = grupo.reduce((s, c) => s + (parseInt(c.totalPedidosDirecta) || 0), 0);
              await sb.update("clientes", principal.codigo, {
                totalPedidosEcommerce: sumaEco,
                totalPedidosDirecta: sumaDir,
                totalPedidos: sumaEco + sumaDir
              });
              for (let i = 1; i < grupo.length; i++) { await sb.delete("clientes", grupo[i].codigo); fusionados++; }
              vivos[tn] = { ...principal, totalPedidosEcommerce: sumaEco, totalPedidosDirecta: sumaDir, totalPedidos: sumaEco + sumaDir };
            } else {
              vivos[tn] = principal;
            }
          }

          // 2. Contar pedidos reales (ecommerce) y ventas directas por teléfono normalizado
          const ecoPorTel = {};
          for (const p of pedidosAll) {
            const tn = normTel(p.telefono);
            if (tn) ecoPorTel[tn] = (ecoPorTel[tn] || 0) + 1;
          }
          const dirPorTel = {};
          for (const vd of ventasDirectas) {
            const tn = normTel(vd.telefono);
            if (!tn) continue;
            if (!dirPorTel[tn]) dirPorTel[tn] = { nombre: "", count: 0 };
            dirPorTel[tn].count++;
            if (!dirPorTel[tn].nombre && vd.cliente) dirPorTel[tn].nombre = vd.cliente;
          }

          // 3. Aplicar conteos reales — crea el cliente si no existía, actualiza si sí
          let creados = 0, actualizados = 0;
          const todosTel = new Set([...Object.keys(ecoPorTel), ...Object.keys(dirPorTel), ...Object.keys(vivos)]);
          let nextNum = clientesAll.length - fusionados + 1;
          for (const tn of todosTel) {
            const eco = ecoPorTel[tn] || 0;
            const dir = dirPorTel[tn]?.count || 0;
            const existente = vivos[tn];
            if (existente) {
              const ecoActual = parseInt(existente.totalPedidosEcommerce) || 0;
              const dirActual = parseInt(existente.totalPedidosDirecta) || 0;
              const nuevoEco = Math.max(ecoActual, eco);
              const nuevoDir = Math.max(dirActual, dir);
              if (nuevoEco !== ecoActual || nuevoDir !== dirActual) {
                await sb.update("clientes", existente.codigo, {
                  totalPedidosEcommerce: nuevoEco, totalPedidosDirecta: nuevoDir, totalPedidos: nuevoEco + nuevoDir
                });
                actualizados++;
              }
            } else if (dir > 0) {
              const codigoCliente = `CVX-${String(nextNum++).padStart(3, "0")}`;
              await sb.set("clientes", codigoCliente, {
                codigo: codigoCliente, nombre: dirPorTel[tn].nombre, telefono: tn,
                correo: "", municipio: "", direccion: "", departamento: "",
                totalPedidos: dir, totalPedidosEcommerce: 0, totalPedidosDirecta: dir,
                fechaRegistro: new Date().toISOString()
              });
              creados++;
            }
          }
          result = { ok: true, creados, actualizados, fusionados, totalVentasDirectas: ventasDirectas.length };
          break;
        }

        case "NUEVO_PEDIDO": {
          const now      = new Date();
          const dd       = String(now.getDate()).padStart(2, "0");
          const mm       = String(now.getMonth() + 1).padStart(2, "0");
          const prefijo  = `#10${dd}${mm}`;
          const todosLosPedidos = await sb.getAll("pedidos");
          const hoyStr   = now.toISOString().slice(0, 10);
          const correl   = todosLosPedidos.filter(p => (p.fecha || "").slice(0, 10) === hoyStr).length + 1;
          const numeroPedido = `${prefijo}-${String(correl).padStart(3, "0")}`;
          const clientes = await sb.getAll("clientes");
          const normTelPed = t => String(t || "").replace(/\D/g, "");
          const cliExist = clientes.find(c => normTelPed(c.telefono) === normTelPed(d.telefono));
          let codigoCliente = "";
          if (cliExist) {
            codigoCliente = cliExist.codigo;
            const updCli = {
              totalPedidos: (parseInt(cliExist.totalPedidos)||0) + 1,
              totalPedidosEcommerce: (parseInt(cliExist.totalPedidosEcommerce)||0) + 1
            };
            if (d.correo && !cliExist.correo) updCli.correo = d.correo;
            await sb.update("clientes", codigoCliente, updCli);
          } else {
            codigoCliente = `CVX-${String(clientes.length + 1).padStart(3, "0")}`;
            await sb.set("clientes", codigoCliente, {
              codigo: codigoCliente, nombre: d.cliente, telefono: d.telefono,
              correo: d.correo || "",
              municipio: d.municipio || "", direccion: d.direccion || "",
              departamento: d.departamento || "", totalPedidos: 1,
              totalPedidosEcommerce: 1, totalPedidosDirecta: 0,
              fechaRegistro: new Date().toISOString()
            });
          }
          await sb.set("pedidos", numeroPedido, {
            id: numeroPedido, numeroPedido, fecha: new Date().toISOString(),
            cliente: d.cliente, telefono: d.telefono, municipio: d.municipio || "",
            departamento: d.departamento || "", direccion: d.direccion || "",
            correo: d.correo || "", telLlamada: d.telLlamada || "",
            productos: d.productos || "", total: d.total || 0,
            estado: "Pendiente", metodoPago: d.metodoPago || "",
            items: d.items || "", cuponUsado: d.cuponUsado || "",
            descMonto: d.descMonto || 0, envio: d.envio || 0,
            codigoCliente: codigoCliente || "", canal: d.canal || "whatsapp"
          });

          // ── Reservar stock inmediatamente ──────────────────────────
          let itemsPed = [];
          try { itemsPed = typeof d.items === "string" ? JSON.parse(d.items) : (d.items || []); } catch(_) {}
          for (const item of itemsPed) {
            if (!item.codigo) continue;
            const prod = await sb.get("stock", item.codigo);
            if (!prod) continue;
            const qty = parseInt(item.cantidad || 1);
            await sb.update("stock", item.codigo, {
              stock_tienda:    Math.max(0, (parseInt(prod.stock_tienda)||0) - qty),
              stock_reservado: (parseInt(prod.stock_reservado)||0) + qty
            });
          }

          // ── Notificación por email ─────────────────────────────────
          try {
            const RESEND_KEY = env.RESEND_KEY;
            if (!RESEND_KEY) throw new Error("RESEND_KEY no configurada en Cloudflare Secrets");
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
              body: JSON.stringify({
                from: "VEREX Store <hola@verexstore.com>",
                to:   ["hola@verexstore.com"],
                subject: `🛍️ Nuevo Pedido ${numeroPedido} — ${d.total}`,
                html: `
                  <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;border:2px solid #C9A84C;border-radius:12px;overflow:hidden;">
                    <div style="background:linear-gradient(135deg,#aaa,#d0d0d0);padding:24px;text-align:center;">
                      <h1 style="margin:0;font-size:22px;letter-spacing:3px;color:#111;">VEREX STORE</h1>
                      <p style="margin:6px 0 0;font-size:13px;color:#444;">Nuevo pedido recibido</p>
                    </div>
                    <div style="padding:24px;">
                      <h2 style="color:#C9A84C;margin:0 0 16px;">${numeroPedido}</h2>
                      <table style="width:100%;border-collapse:collapse;font-size:14px;">
                        <tr><td style="padding:6px 0;color:#888;">Cliente</td><td style="font-weight:700;color:#111;">${d.cliente}</td></tr>
                        <tr><td style="padding:6px 0;color:#888;">Teléfono</td><td style="color:#111;">${d.telefono}</td></tr>
                        <tr><td style="padding:6px 0;color:#888;">Ubicación</td><td style="color:#111;">${d.departamento || ""} ${d.municipio || ""}</td></tr>
                        <tr><td style="padding:6px 0;color:#888;">Dirección</td><td style="color:#111;">${d.direccion || "—"}</td></tr>
                        <tr><td style="padding:6px 0;color:#888;">Productos</td><td style="color:#111;">${d.productos || "—"}</td></tr>
                        <tr><td style="padding:6px 0;color:#888;">Pago</td><td style="color:#111;">${d.metodoPago || "—"}</td></tr>
                        <tr><td style="padding:6px 0;color:#888;font-weight:700;">Total</td><td style="font-size:18px;font-weight:800;color:#C9A84C;">${d.total}</td></tr>
                      </table>
                    </div>
                    <div style="padding:16px 24px;background:#f5f5f5;border-top:2px solid #C9A84C;text-align:center;font-size:12px;color:#888;">
                      El mundo es mejor cuando brillas tú ✨
                    </div>
                  </div>`
              })
            });
          } catch(emailErr) { console.error("Email error:", emailErr); }

          // ── Confirmación al cliente (solo si dejó correo) ──────────
          if (d.correo) {
            try {
              const RESEND_KEY = env.RESEND_KEY;
              if (RESEND_KEY) {
                await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
                  body: JSON.stringify({
                    from: "VEREX Store <hola@verexstore.com>",
                    to:   [d.correo],
                    subject: `✅ Confirmación de tu pedido ${numeroPedido} — VEREX Store — ${d.total}`,
                    html: `
                      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;border:2px solid #C9A84C;border-radius:12px;overflow:hidden;">
                        <div style="background:linear-gradient(135deg,#aaa,#d0d0d0);padding:24px;text-align:center;">
                          <h1 style="margin:0;font-size:22px;letter-spacing:3px;color:#111;">VEREX STORE</h1>
                          <p style="margin:6px 0 0;font-size:13px;color:#444;">Confirmación de pedido</p>
                        </div>
                        <div style="padding:24px;">
                          <p style="margin:0 0 16px;font-size:15px;color:#111;">Hola <strong>${d.cliente}</strong>, ¡gracias por tu compra! 💛</p>
                          <p style="margin:0 0 16px;font-size:14px;color:#444;">Tu pedido ha sido recibido y está siendo procesado.</p>
                          <h2 style="color:#C9A84C;margin:0 0 16px;">${numeroPedido}</h2>
                          <table style="width:100%;border-collapse:collapse;font-size:14px;">
                            <tr><td style="padding:6px 0;color:#555;">Productos</td><td style="font-weight:700;color:#111;">${d.productos || "—"}</td></tr>
                            <tr><td style="padding:6px 0;color:#555;">Pago</td><td style="color:#111;">${d.metodoPago || "—"}</td></tr>
                            <tr><td style="padding:6px 0;color:#555;">Envío a</td><td style="color:#111;">${d.departamento || ""} ${d.municipio || ""}</td></tr>
                            <tr><td style="padding:6px 0;color:#555;font-weight:700;">Total</td><td style="font-size:18px;font-weight:800;color:#C9A84C;">${d.total}</td></tr>
                          </table>
                          <p style="margin:20px 0 0;font-size:13px;color:#444;">Nos pondremos en contacto contigo pronto para coordinar la entrega.</p>
                        </div>
                        <div style="padding:16px 24px;background:#f5f5f5;border-top:2px solid #C9A84C;text-align:center;font-size:12px;color:#888;">
                          El mundo es mejor cuando tú brillas ✨ — <a href="https://verexstore.com" style="color:#C9A84C;text-decoration:none;">verexstore.com</a>
                        </div>
                      </div>`
                  })
                });
              }
            } catch(clientEmailErr) { console.error("Client email error:", clientEmailErr); }
          }

          result = { ok: true, numeroPedido, codigoCliente };
          break;
        }

        case "GET_ESTADISTICAS": {
          if (!esAdmin) return forbidden();
          const pedsStat = await sb.getAll("pedidos");
          // Destinos
          const destinos = {};
          pedsStat.forEach(p => {
            const lugar = (p.municipio || p.departamento || "Sin especificar").trim();
            if (!lugar || lugar === "—") return;
            destinos[lugar] = (destinos[lugar] || 0) + 1;
          });
          const topDestinos = Object.entries(destinos)
            .sort((a,b) => b[1]-a[1]).slice(0,10)
            .map(([lugar, total]) => ({ lugar, total }));
          // Métodos de pago
          const pagos = {};
          pedsStat.forEach(p => {
            const m = (p.metodoPago || "Sin especificar").trim();
            pagos[m] = (pagos[m] || 0) + 1;
          });
          const topPagos = Object.entries(pagos)
            .sort((a,b) => b[1]-a[1])
            .map(([metodo, total]) => ({ metodo, total }));
          // Pedidos pendientes +2 días
          const hace2 = Date.now() - 2*24*60*60*1000;
          const alertas = pedsStat.filter(p =>
            (p.estado === "Pendiente" || p.estado === "En camino") &&
            new Date(p.fecha).getTime() < hace2
          ).length;
          result = { ok: true, topDestinos, topPagos, alertas };
          break;
        }

        case "BUSCAR_CLIENTE": {
          const cliAll = await sb.getAll("clientes");
          const cli = cliAll.find(c =>
            String(c.codigo) === String(d.codigo) ||
            String(c.telefono) === String(d.codigo)
          );
          result = cli ? { ok: true, cliente: cli } : { ok: false };
          break;
        }

        // Lista liviana de vendedores tipo afiliado — usada por el admin (adminverex)
        // para vincular un catálogo temporal a un afiliado real ya registrado.
        case "GET_VENDEDORES_AFILIADOS": {
          if (!esAdmin) return forbidden();
          const vends = await sb.getAll("vendedores");
          result = { ok: true, vendedores: vends.filter(v => v.tipo === "afiliado" && v.activo !== false) };
          break;
        }

        // Guarda los criterios (categorías, talla, género, cantidad) usados al
        // generar el catálogo de un afiliado, para poder "refrescarlo" después
        // con stock actualizado sin rearmar la selección desde cero.
        case "GUARDAR_RECETA_CATALOGO": {
          if (!esAdmin) return forbidden();
          await sb.update("vendedores", d.vendedor, { catalogoReceta: d.receta });
          result = { ok: true };
          break;
        }

        // ══ LEADS DE AFILIADOS ═══════════════════════════════════════
        // Público — se llama desde el catálogo temporal cuando el cliente
        // presiona "Quiero este", antes de abrir WhatsApp. Registro silencioso,
        // no requiere sesión de admin ni token del afiliado.
        // Se registra tanto desde catálogos de afiliado (d.afiliado presente)
        // como desde el catálogo público de clientes (d.afiliado vacío) — en
        // ese segundo caso el cliente escribe directo a VEREX por WhatsApp, así
        // que el Lead solo sirve para no perder de vista el interés si la
        // conversación no llega a cerrarse como venta.
        case "REGISTRAR_LEAD": {
          if (!d.codigo) { result = { ok: false, error: "Datos incompletos" }; break; }
          const leadId = "LEAD_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
          await sb.set("leads", leadId, {
            id: leadId,
            afiliado: d.afiliado || "",
            codigo: d.codigo,
            nombre: d.nombre || "",
            precio: parseFloat(d.precio) || 0,
            foto: d.foto || "",
            fecha: new Date().toISOString(),
            estado: "interesado",
            // Capturados ANTES de que el cliente abra WhatsApp — si el envío
            // falla o nunca lo manda, estos datos son lo único que queda
            // para poder contactarlo. No se guardan en "cliente" (eso sigue
            // reservado para cuando el afiliado completa el pedido de verdad).
            telefonoCliente: d.telefonoCliente || "",
            nombreCliente: d.nombreCliente || "",
            direccionCliente: d.direccionCliente || "",
            historial: [{ estado: "interesado", fecha: new Date().toISOString() }]
          });

          // ── Notificación por email a VEREX ──────────────────────────
          // Para que un pedido de catálogo no dependa de que alguien esté
          // viendo el badge de Vendedores — llega al correo apenas el
          // cliente toca "¡Hazlo tuyo!" o manda el carrito, indicando
          // siempre si es un cliente directo o de un afiliado (y de cuál).
          try {
            const RESEND_KEY = env.RESEND_KEY;
            if (RESEND_KEY) {
              let origenTxt = "👤 Cliente directo (catálogo VEREX)";
              if (d.afiliado) {
                const vend = await sb.get("vendedores", d.afiliado);
                origenTxt = `🎯 Afiliado: ${vend?.nombre || d.afiliado}`;
              }
              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
                body: JSON.stringify({
                  from: "VEREX Store <hola@verexstore.com>",
                  to:   ["hola@verexstore.com"],
                  subject: `💛 Nuevo interés — ${d.nombre || d.codigo} — $${(parseFloat(d.precio)||0).toFixed(2)}`,
                  html: `
                    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;border:2px solid #C9A84C;border-radius:12px;overflow:hidden;">
                      <div style="background:linear-gradient(135deg,#aaa,#d0d0d0);padding:24px;text-align:center;">
                        <h1 style="margin:0;font-size:22px;letter-spacing:3px;color:#111;">VEREX STORE</h1>
                        <p style="margin:6px 0 0;font-size:13px;color:#444;">Nuevo interés desde el catálogo</p>
                      </div>
                      <div style="padding:24px;">
                        <p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#7a5500;">${origenTxt}</p>
                        <table style="width:100%;border-collapse:collapse;font-size:14px;">
                          <tr><td style="padding:6px 0;color:#888;">Producto</td><td style="font-weight:700;color:#111;">${d.nombre || d.codigo}</td></tr>
                          <tr><td style="padding:6px 0;color:#888;">Precio</td><td style="color:#111;">$${(parseFloat(d.precio)||0).toFixed(2)}</td></tr>
                          <tr><td style="padding:6px 0;color:#888;">Cliente</td><td style="color:#111;">${d.nombreCliente || "—"}</td></tr>
                          <tr><td style="padding:6px 0;color:#888;">WhatsApp</td><td style="color:#111;">${d.telefonoCliente || "—"}</td></tr>
                          <tr><td style="padding:6px 0;color:#888;">Dirección</td><td style="color:#111;">${d.direccionCliente || "—"}</td></tr>
                        </table>
                        <p style="margin:16px 0 0;font-size:12px;color:#999;">Este es un registro de interés capturado antes de que el cliente mande el WhatsApp — revisa la pestaña Vendedores en el Hub para confirmar la venta.</p>
                      </div>
                      <div style="padding:16px 24px;background:#f5f5f5;border-top:2px solid #C9A84C;text-align:center;font-size:12px;color:#888;">
                        El mundo es mejor cuando brillas tú ✨
                      </div>
                    </div>`
                })
              });
            }
          } catch(leadEmailErr) { console.error("Lead email error:", leadEmailErr); }

          result = { ok: true, leadId };
          break;
        }

        // Portal del afiliado (protegido por token, igual que VERIFICAR_TOKEN)
        case "GET_LEADS_AFILIADO": {
          const todos = await sb.getAll("leads");
          const propios = todos.filter(l => l.afiliado === d.vendedor);
          result = { ok: true, leads: propios };
          break;
        }

        // El afiliado autorreporta que cerró la venta — NO descuenta stock ni
        // genera comisión todavía, solo avisa al admin para que confirme.
        case "MARCAR_LEAD_VENDIDO": {
          const lead = await sb.get("leads", d.id);
          if (!lead) { result = { ok: false, error: "Lead no encontrado" }; break; }
          if (lead.afiliado !== d.vendedor) { result = { ok: false, error: "No autorizado" }; break; }
          const historial = [...(lead.historial || []), { estado: "reportado", fecha: new Date().toISOString() }];
          await sb.update("leads", d.id, { estado: "reportado", historial });
          result = { ok: true };
          break;
        }

        case "GET_LEADS_ADMIN": {
          if (!esAdmin) return forbidden();
          const todos = await sb.getAll("leads");
          result = { ok: true, leads: todos };
          break;
        }

        // El admin confirma un lead reportado — esto SÍ mueve stock y genera
        // la venta real (mismo efecto que REGISTRAR_ENTREGA + REGISTRAR_VENTA).
        // Paso 1 de 2: el admin empaca y entrega el pedido al transportista.
        // La venta NO se cierra todavía — solo se reserva el stock (igual que un
        // pedido de ecommerce) para que no se pueda vender dos veces, mientras el
        // pedido está en camino. La comisión y el conteo de venta final se generan
        // hasta que se confirma la entrega real (ver CONFIRMAR_LEAD_ENTREGA), porque
        // con pago contra entrega el cliente puede rechazar el pedido en la puerta.
        case "CONFIRMAR_LEAD_ENVIO": {
          if (!esAdmin) return forbidden();
          const lead = await sb.get("leads", d.id);
          if (!lead) { result = { ok: false, error: "Lead no encontrado" }; break; }
          if (lead.estado !== "interesado" && lead.estado !== "reportado") {
            result = { ok: false, error: "Este lead no está pendiente de envío" }; break;
          }
          const codigoReal = (d.codigoOverride && String(d.codigoOverride).trim()) || lead.codigo;
          const s = await sb.get("stock", codigoReal);
          if (!s) { result = { ok: false, error: "El producto (" + codigoReal + ") ya no existe en stock" }; break; }
          const disponible = (parseInt(s.stock_bodega)||0) + (parseInt(s.stock_tienda)||0);
          if (disponible < 1) { result = { ok: false, error: "Sin stock disponible para confirmar esta venta" }; break; }
          const restaDeBodega = Math.min(1, parseInt(s.stock_bodega)||0);
          await sb.update("stock", codigoReal, {
            stock_bodega:    Math.max(0, (parseInt(s.stock_bodega)||0) - restaDeBodega),
            stock_tienda:    Math.max(0, (parseInt(s.stock_tienda)||0) - (1 - restaDeBodega)),
            stock_reservado: (parseInt(s.stock_reservado)||0) + 1
          });
          const historial = [...(lead.historial || []), { estado: "en_camino", fecha: new Date().toISOString(), codigoConfirmado: codigoReal }];
          await sb.update("leads", d.id, { estado: "en_camino", historial, codigoConfirmado: codigoReal });
          result = { ok: true };
          break;
        }

        // Paso 2 de 2 (caso A): el transportista SÍ entregó y cobró — recién aquí
        // se cierra la venta de verdad: se libera la reserva hacia vendido, se crea
        // el registro de venta (para comisión e Historial) y se registra el cliente.
        // EXCEPCIÓN: si esCambio=true, este envío es el reemplazo de un cambio de
        // producto ya registrado en OTRO Lead (venta original, ya cobrada) — solo
        // se mueve el stock (la pieza sí salió físicamente), pero NO se crea venta
        // ni comisión nueva, porque el cliente ya pagó una sola vez por esto.
        case "CONFIRMAR_LEAD_ENTREGA": {
          if (!esAdmin) return forbidden();
          const lead = await sb.get("leads", d.id);
          if (!lead) { result = { ok: false, error: "Lead no encontrado" }; break; }
          if (lead.estado !== "en_camino") { result = { ok: false, error: "Este lead no está en camino" }; break; }
          const codigoReal = lead.codigoConfirmado || lead.codigo;
          const s = await sb.get("stock", codigoReal);
          if (!s) { result = { ok: false, error: "El producto (" + codigoReal + ") ya no existe en stock" }; break; }
          const esCambio = Boolean(d.esCambio);
          let consId = null;
          if (!esCambio) {
            const fechaVentaLead = new Date().toISOString();
            consId = "CONS_" + Date.now() + "_" + codigoReal;
            await sb.set("consignacion", consId, {
              id: consId, vendedor: lead.afiliado, codigo: codigoReal,
              nombre: lead.nombre, codigoBase: s.codigoBase || codigoReal,
              talla: s.talla || "", nombre_base: s.nombre_base || lead.nombre,
              categoria: s.categoria || "", precio: lead.precio || s.precio || 0,
              cantidad: 1, vendido: 1,
              foto: lead.foto || s.foto || "", fecha: fechaVentaLead, estado: "activo"
            });
            // Igual que REGISTRAR_VENTA_VENDEDOR/REGISTRAR_VENTA: se guarda un
            // registro individual de la venta con su fecha real — sin esto, las
            // ventas de leads de afiliado nunca aparecían en "Mis Ventas" ni en
            // los Cierres Mensuales (el mismo hueco que le pasó a Jorge Bermúdez).
            const vendLeadHist = await sb.get("vendedores", lead.afiliado);
            if (vendLeadHist) {
              const historialLeadV = Array.isArray(vendLeadHist.historialVentas) ? vendLeadHist.historialVentas : [];
              historialLeadV.push({
                id: `VV_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, consignacionId: consId,
                codigo: codigoReal, nombre: lead.nombre || "",
                precio: lead.precio || s.precio || 0, foto: lead.foto || s.foto || "",
                cantidad: 1, fecha: fechaVentaLead
              });
              await sb.update("vendedores", lead.afiliado, { historialVentas: historialLeadV });
            }
          }
          // Un afiliado SIN piezas físicas nunca tuvo la pieza en sus manos — VEREX
          // la entrega y cobra directo, así que la pieza sale de una vez de reservado
          // hacia vendida, SIN pasar por el balde de "Consignación" (que es para
          // piezas físicamente asignadas a un vendedor).
          const vendAf = await sb.get("vendedores", lead.afiliado);
          const esAfiliadoSinStockAf = vendAf?.tipo === "afiliado" && !vendAf?.recibeFisico;
          await sb.update("stock", codigoReal, {
            stock_reservado:    Math.max(0, (parseInt(s.stock_reservado)||0) - 1),
            stock_consignacion: esAfiliadoSinStockAf ? (parseInt(s.stock_consignacion)||0) : (parseInt(s.stock_consignacion)||0) + 1,
            stock_vendido:      (parseInt(s.stock_vendido)||0) + 1
          });
          const historial = [...(lead.historial || []), { estado: "vendido", fecha: new Date().toISOString(), codigoConfirmado: codigoReal, esCambio }];
          await sb.update("leads", d.id, { estado: "vendido", historial, consignacionId: consId, esCambio });

          // Registrar/actualizar el cliente en el mismo directorio que usa ecommerce
          // y venta directa (deduplicado por teléfono), para que aparezca en
          // Clientes con su canal — en este caso "Afiliado". No aplica si es cambio
          // (el cliente ya estaba registrado por la venta original).
          if (!esCambio && lead.cliente?.telefono) {
            const clientesAf = await sb.getAll("clientes");
            const normTelAf = t => String(t || "").replace(/\D/g, "");
            const cliExistAf = clientesAf.find(c => normTelAf(c.telefono) === normTelAf(lead.cliente.telefono));
            if (cliExistAf) {
              await sb.update("clientes", cliExistAf.codigo, {
                totalPedidos: (parseInt(cliExistAf.totalPedidos)||0) + 1,
                totalPedidosAfiliado: (parseInt(cliExistAf.totalPedidosAfiliado)||0) + 1,
                ...(cliExistAf.municipio ? {} : { municipio: lead.cliente.municipio || "", departamento: lead.cliente.departamento || "", direccion: lead.cliente.direccion || "" })
              });
            } else {
              const codigoClienteAf = `CVX-${String(clientesAf.length + 1).padStart(3, "0")}`;
              await sb.set("clientes", codigoClienteAf, {
                codigo: codigoClienteAf, nombre: lead.cliente.nombre || "", telefono: lead.cliente.telefono,
                correo: "", municipio: lead.cliente.municipio || "", direccion: lead.cliente.direccion || "", departamento: lead.cliente.departamento || "",
                totalPedidos: 1, totalPedidosEcommerce: 0, totalPedidosDirecta: 0, totalPedidosAfiliado: 1,
                fechaRegistro: new Date().toISOString()
              });
            }
          }

          result = { ok: true };
          break;
        }

        // Paso 2 de 2 (caso B): el cliente rechazó el pedido en la puerta — la
        // pieza regresa a bodega tal cual, sin generar venta ni comisión.
        case "RECHAZAR_LEAD_ENTREGA": {
          if (!esAdmin) return forbidden();
          const lead = await sb.get("leads", d.id);
          if (!lead) { result = { ok: false, error: "Lead no encontrado" }; break; }
          if (lead.estado !== "en_camino") { result = { ok: false, error: "Este lead no está en camino" }; break; }
          const codigoReal = lead.codigoConfirmado || lead.codigo;
          const s = await sb.get("stock", codigoReal);
          if (s) {
            await sb.update("stock", codigoReal, {
              stock_reservado: Math.max(0, (parseInt(s.stock_reservado)||0) - 1),
              stock_bodega:    (parseInt(s.stock_bodega)||0) + 1
            });
          }
          const historial = [...(lead.historial || []), { estado: "rechazado", fecha: new Date().toISOString() }];
          await sb.update("leads", d.id, { estado: "rechazado", historial });
          result = { ok: true };
          break;
        }

        // Cambio de producto DESPUÉS de entregado (talla que no quedó, pieza
        // con defecto, o el motivo que sea) — la venta y la comisión ya
        // quedaron cerradas al confirmar la entrega, así que esto NO las
        // toca: solo ajusta el inventario físico (regresa la pieza vieja a
        // bodega, descuenta la nueva) y deja constancia del cambio.
        case "CAMBIAR_PRODUCTO_LEAD": {
          if (!esAdmin) return forbidden();
          const lead = await sb.get("leads", d.id);
          if (!lead) { result = { ok: false, error: "Lead no encontrado" }; break; }
          if (lead.estado !== "vendido") { result = { ok: false, error: "Solo se puede cambiar un pedido ya entregado" }; break; }
          const codigoNuevo = String(d.codigoNuevo || "").trim();
          if (!codigoNuevo) { result = { ok: false, error: "Falta el código del producto nuevo" }; break; }
          const codigoViejo = lead.codigoConfirmado || lead.codigo;
          const sNuevo = await sb.get("stock", codigoNuevo);
          if (!sNuevo) { result = { ok: false, error: "El producto nuevo (" + codigoNuevo + ") no existe en stock" }; break; }
          const disponibleNuevo = (parseInt(sNuevo.stock_bodega)||0) + (parseInt(sNuevo.stock_tienda)||0);
          if (disponibleNuevo < 1) { result = { ok: false, error: "Sin stock disponible del producto nuevo" }; break; }

          const sViejo = await sb.get("stock", codigoViejo);
          if (sViejo) {
            await sb.update("stock", codigoViejo, { stock_bodega: (parseInt(sViejo.stock_bodega)||0) + 1 });
          }
          const restaBodega = Math.min(1, parseInt(sNuevo.stock_bodega)||0);
          await sb.update("stock", codigoNuevo, {
            stock_bodega: Math.max(0, (parseInt(sNuevo.stock_bodega)||0) - restaBodega),
            stock_tienda: Math.max(0, (parseInt(sNuevo.stock_tienda)||0) - (1 - restaBodega))
          });

          if (lead.consignacionId) {
            const nombreViejo = lead.nombre || codigoViejo;
            const fechaCambio = new Date().toLocaleDateString("es-SV", { day: "numeric", month: "short", year: "numeric" });
            const notaCambio = `🔄 Cambio de producto el ${fechaCambio}: "${nombreViejo}" (${codigoViejo}) → "${sNuevo.nombre_base || sNuevo.nombre || codigoNuevo}" (${codigoNuevo})${d.motivo ? " — Motivo: " + d.motivo : ""}`;
            await sb.update("consignacion", lead.consignacionId, {
              codigo: codigoNuevo, codigoBase: sNuevo.codigoBase || codigoNuevo,
              talla: sNuevo.talla || "", nombre: sNuevo.nombre_base || sNuevo.nombre || lead.nombre,
              nombre_base: sNuevo.nombre_base || sNuevo.nombre || lead.nombre,
              foto: sNuevo.foto || lead.foto || "",
              notaCambio
            });
          }

          const historialCambio = [...(lead.historial || []), {
            estado: "cambio", fecha: new Date().toISOString(),
            codigoAnterior: codigoViejo, codigoNuevo, motivo: d.motivo || ""
          }];
          await sb.update("leads", d.id, {
            codigo: codigoNuevo, codigoConfirmado: codigoNuevo,
            nombre: sNuevo.nombre_base || sNuevo.nombre || lead.nombre,
            foto: sNuevo.foto || lead.foto || "",
            historial: historialCambio
          });
          result = { ok: true };
          break;
        }

        case "CANCELAR_LEAD": {
          if (!esAdmin) return forbidden();
          const lead = await sb.get("leads", d.id);
          if (!lead) { result = { ok: false, error: "Lead no encontrado" }; break; }
          const historial = [...(lead.historial || []), { estado: "cancelado", fecha: new Date().toISOString() }];
          await sb.update("leads", d.id, { estado: "cancelado", historial });
          result = { ok: true };
          break;
        }

        case "VERIFICAR_TOKEN": {
          const vend = await sb.get("vendedores", d.vendedor);
          if (!vend) { result = { ok: false, razon: "no_encontrado" }; break; }
          if (String(vend.tokenInventario) !== String(d.token)) {
            result = { ok: false, razon: "token_invalido" }; break;
          }
          // Segunda capa: si el vendedor tiene PIN configurado, también se
          // exige — así, aunque el link (con token) se comparta por error,
          // no basta para entrar a ver ventas ni tocar el inventario.
          if (vend.pin && String(vend.pin) !== String(d.pin || "")) {
            result = { ok: false, razon: "pin_requerido", tienePin: true }; break;
          }
          // Validar 30 días desde último corte
          if (vend.fechaCorte) {
            const diasDesdeCorte = (Date.now() - new Date(vend.fechaCorte).getTime()) / (1000 * 60 * 60 * 24);
            if (diasDesdeCorte > 30) {
              result = { ok: false, razon: "vencido" }; break;
            }
          }
          result = { ok: true, vendedor: vend };
          break;
        }

        // ══ ADMIN TIENDA ══════════════════════════════════════════
        case "GET_TIENDA": {
          if (!esAdmin) return forbidden();
          const [prods, peds, cups, clis, cfgDoc] = await Promise.all([
            sb.getAll("stock"),
            sb.getAll("pedidos"),
            sb.getAll("cupones"),
            sb.getAll("clientes"),
            sb.get("config", "settings"),
          ]);
          result = {
            ok: true,
            productos: prods.filter(p => p.estado !== "inactivo"),
            pedidos:   peds,
            cupones:   cups,
            clientes:  clis,
            config:    cfgDoc || {}
          };
          break;
        }

        case "CREAR_PRODUCTO": {
          if (!esAdmin) return forbidden();
          const prodId = d.codigo || `PROD_${Date.now()}`;
          // El código se calcula en el navegador mirando el stock que tiene
          // cargado localmente — si dos personas agregan casi al mismo tiempo
          // o el stock local quedó desactualizado, podrían calcular el mismo
          // código sin saberlo. Sin esta verificación, sb.set() lo hubiera
          // sobrescrito en silencio (mismo id = mismo registro).
          const existente = await sb.get("stock", prodId);
          if (existente) {
            result = { ok: false, error: `El código ${prodId} ya existe (${existente.nombre || "otro producto"}) — alguien más lo generó justo antes. Vuelve a intentar para que se recalcule.` };
            break;
          }
          await sb.set("stock", prodId, {
            codigo:             prodId,
            codigoBase:         prodId,
            nombre:             d.nombre || "",
            precio:             Math.round((parseFloat(d.precio) || 0) * 100) / 100,
            foto:               d.img || d.foto || "",
            descripcion:        d.caracteristicas || "",
            descripcionTienda:  d.caracteristicas || "",
            categoria:          d.categoria || "",
            talla:              "",
            stock_bodega:       parseInt(d.cantidad) || 0,
            stock_tienda:       0,
            stock_consignacion: 0,
            stock_vendido:      0,
            enCatalogo:         d.enCatalogo === true || d.enCatalogo === "true" || false,
            estado:             "activo",
            fechaRegistro:      new Date().toISOString()
          });
          result = { ok: true };
          break;
        }

        case "ELIMINAR_PEDIDO": {
          if (!esAdmin) return forbidden();
          await sb.delete("pedidos", d.numeroPedido);
          result = { ok: true };
          break;
        }

        // Solo para corregir una venta duplicada por doble clic (ver guard
        // _vdEnviando en el frontend) — no toca stock porque
        // REGISTRAR_VENTA_DIRECTA tampoco lo descuenta server-side.
        case "ELIMINAR_VENTA_DIRECTA": {
          if (!esAdmin) return forbidden();
          if (!d.id) { result = { ok: false, error: "Falta el id" }; break; }
          await sb.delete("ventas_directas", d.id);
          result = { ok: true };
          break;
        }

        // ══ GARANTÍA LIMITADA (editable desde el Admin) ═══════════
        case "GET_GARANTIA": {
          // Pública — la lee garantia.html sin necesidad de login
          const g = await sb.get("config", "garantia");
          result = { ok: true, garantia: g || null };
          break;
        }

        case "GUARDAR_GARANTIA": {
          if (!esAdmin) return forbidden();
          const { intro, dias, cubre, no_cubre, promo, solicitud, evaluacion, destacado } = d;
          await sb.set("config", "garantia", {
            intro: intro || "", dias: parseInt(dias) || 30,
            cubre: cubre || "", no_cubre: no_cubre || "",
            promo: promo || "", solicitud: solicitud || "",
            evaluacion: evaluacion || "", destacado: destacado || "",
            actualizado: new Date().toISOString()
          });
          result = { ok: true };
          break;
        }

        // ══ ALIAS ════════════════════════════════════════════════
        case "GET_STOCK": {
          const stock = await sb.getAll("stock");
          // Se incluye config (ej. fraseConfianza del catálogo) porque
          // catalogo.html (los links /c/:id) ya llama GET_STOCK para el
          // chequeo de disponibilidad en vivo — reutilizar esa llamada evita
          // un fetch extra solo para leer la frase editable de envíos/pago.
          const cfgStock = await sb.get("config", "settings");
          result = { ok: true, stock: stock.filter(p => p.estado !== "inactivo"), config: cfgStock || {} };
          break;
        }

        // ══ STOCK MOVIMIENTOS ════════════════════════════════════
        case "STOCK_ASIGNAR_TIENDA": {
          if (!esAdmin) return forbidden();
          for (const codigo of (d.codigos || [])) {
            const s = await sb.get("stock", codigo);
            if (s) {
              const disponible = parseInt(s.stock_bodega) || 0;
              const cant = Math.min(d.cantidad || 1, disponible); // no mover más de lo que hay
              if (cant <= 0) continue;
              await sb.update("stock", codigo, {
                stock_bodega: disponible - cant,
                stock_tienda: (parseInt(s.stock_tienda)||0) + cant,
                enCatalogo:   true,
                estado:       "tienda"
              });
            }
          }
          result = { ok: true };
          break;
        }

        case "STOCK_ASIGNAR_VENDEDOR": {
          if (!esAdmin) return forbidden();
          for (const codigo of (d.codigos || [])) {
            const s = await sb.get("stock", codigo);
            if (s) {
              const disponible = parseInt(s.stock_bodega) || 0;
              const cant = Math.min(d.cantidad || 1, disponible);
              if (cant <= 0) continue;
              await sb.update("stock", codigo, {
                stock_bodega:       disponible - cant,
                stock_consignacion: (parseInt(s.stock_consignacion)||0) + cant,
                estado:             "consignacion"
              });
            }
          }
          result = { ok: true };
          break;
        }

        case "STOCK_DEVOLVER_BODEGA": {
          if (!esAdmin) return forbidden();
          for (const codigo of (d.codigos || [])) {
            const s = await sb.get("stock", codigo);
            if (s) {
              const origen = d.origen || "tienda";
              // Determinar cuánto hay realmente en el origen para no inventar stock
              const enOrigen = origen === "tienda"
                ? (parseInt(s.stock_tienda)||0)
                : (parseInt(s.stock_consignacion)||0);
              const cant = Math.min(d.cantidad || 1, enOrigen);
              if (cant <= 0) continue; // ya no hay nada que devolver
              const updates = {
                stock_bodega: (parseInt(s.stock_bodega)||0) + cant,
                estado: "bodega"
              };
              if (origen === "tienda") {
                updates.stock_tienda  = enOrigen - cant;
                updates.enCatalogo    = false;
              } else {
                updates.stock_consignacion = enOrigen - cant;
              }
              await sb.update("stock", codigo, updates);
            }
          }
          result = { ok: true };
          break;
        }

        // ══ PRODUCTOS ════════════════════════════════════════════
        case "EDITAR_PRODUCTO": {
          if (!esAdmin) return forbidden();
          const upd = {};
          if (d.nombre          !== undefined) upd.nombre            = d.nombre;
          // OJO: Stock (y el catálogo) muestran nombre_base primero, no
          // nombre — si solo se actualiza nombre, el cambio queda invisible
          // en todas partes aunque sí se haya guardado en la base de datos.
          if (d.nombre_base     !== undefined) upd.nombre_base       = d.nombre_base;
          if (d.precio          !== undefined) upd.precio            = Math.round((parseFloat(d.precio) || 0) * 100) / 100;
          if (d.img             !== undefined) upd.foto              = d.img;
          if (d.descripcion     !== undefined) upd.descripcionTienda = d.descripcion;
          if (d.destacado       !== undefined) upd.destacado         = d.destacado;
          if (d.enCatalogo      !== undefined) upd.enCatalogo        = Boolean(d.enCatalogo);
          if (d.stock_bodega    !== undefined) upd.stock_bodega      = Math.max(0, parseInt(d.stock_bodega) || 0);
          if (d.caracteristicas !== undefined) upd.caracteristicas   = d.caracteristicas;
          if (d.material        !== undefined) upd.material          = d.material;
          if (d.caracterEspecial !== undefined) upd.caracterEspecial = d.caracterEspecial;
          if (d.set_config      !== undefined) upd.set_config        = d.set_config || null;
          if (d.precio_caballero !== undefined) upd.precio_caballero = d.precio_caballero || null;
          if (d.reservado       !== undefined) upd.reservado         = Boolean(d.reservado);
          if (d.codigoBase      !== undefined) upd.codigoBase        = d.codigoBase;
          // Cambio de código: copiar fila con nuevo código y marcar vieja inactiva
          if (d.nuevo_codigo && d.nuevo_codigo !== d.codigo) {
            const viejo = await sb.get("stock", d.codigo);
            if (viejo) {
              const nueva = { ...viejo, ...upd, codigo: d.nuevo_codigo };
              delete nueva.id;
              await sb.set("stock", d.nuevo_codigo, nueva);
              await sb.update("stock", d.codigo, { estado: "inactivo" });
            }
          } else {
            await sb.update("stock", d.codigo, upd);
          }
          result = { ok: true };
          break;
        }

        case "ROTAR_CATALOGO": {
          if (!esAdmin) return forbidden();
          // d.porcentaje: número 0-100, d.guardarConfig: {dias, porcentaje} opcional
          const todos = await sb.getAll("stock");
          const activos = todos.filter(p => p.estado !== "inactivo");
          const pct  = Math.min(100, Math.max(0, parseInt(d.porcentaje) || 30));
          const cant = Math.max(1, Math.round(activos.length * pct / 100));
          // Shuffle Fisher-Yates
          const mezclados = activos.slice();
          for (let i = mezclados.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [mezclados[i], mezclados[j]] = [mezclados[j], mezclados[i]];
          }
          const enCatalogoSet = new Set(mezclados.slice(0, cant).map(p => p.codigo));
          // Actualizar en lotes de 50 para no saturar con 1000+ productos
          const BATCH = 50;
          for (let i = 0; i < activos.length; i += BATCH) {
            await Promise.all(
              activos.slice(i, i + BATCH).map(p =>
                sb.update("stock", p.codigo, { enCatalogo: enCatalogoSet.has(p.codigo) })
              )
            );
          }
          // Guardar fecha de rotación en config
          const cfg = (await sb.get("config", "settings")) || {};
          if (!cfg.rotacion) cfg.rotacion = {};
          cfg.rotacion.ultimaRotacion = new Date().toISOString();
          if (d.guardarConfig) {
            cfg.rotacion.activa     = Boolean(d.guardarConfig.activa);
            cfg.rotacion.dias       = parseInt(d.guardarConfig.dias)       || 8;
            cfg.rotacion.porcentaje = parseInt(d.guardarConfig.porcentaje) || 30;
          }
          await sb.set("config", "settings", cfg);
          result = { ok: true, total: activos.length, enCatalogo: cant };
          break;
        }

        case "ELIMINAR_PRODUCTO": {
          if (!esAdmin) return forbidden();
          await sb.update("stock", d.codigo, { estado: "inactivo" });
          result = { ok: true };
          break;
        }

        // ══ ENTREGAS PENDIENTES ════════════════════════════════════
        case "REGISTRAR_ENTREGA_PENDIENTE": {
          if (!esAdmin) return forbidden();
          const entId = d.id || `ENT_${Date.now()}`;
          // firmaImg se guarda para poder regenerar el mismo PDF del recibo
          // después, desde el Historial — antes no quedaba ningún rastro
          // permanente de la firma ni de los items una vez cerrado el modal.
          await sb.set("entregas", entId, {
            id: entId, vendedor: d.vendedor || "",
            fecha: new Date().toISOString(),
            items: JSON.stringify(d.items || []),
            estado: d.estado || "pendiente",
            codigoRecibo: d.codigoRecibo || "",
            fechaConfirmacion: d.estado === "confirmado" ? new Date().toISOString() : "",
            firmaImg: d.firmaImg || ""
          });
          result = { ok: true };
          break;
        }

        case "GET_ENTREGAS_PENDIENTES": {
          const ents = await sb.query("entregas", "vendedor", "==", d.vendedor);
          result = { ok: true, entregas: ents.filter(e => e.estado === "pendiente") };
          break;
        }

        case "GET_ENTREGAS_CONFIRMADAS": {
          if (!esAdmin) return forbidden();
          let allEnts;
          try { allEnts = await sb.getAll("entregas"); } catch(_) { allEnts = []; }
          result = { ok: true, entregas: allEnts.filter(e => e.estado === "confirmado") };
          break;
        }

        case "CONFIRMAR_ENTREGA_RECIBO": {
          const entDoc = await sb.get("entregas", d.id);
          if (!entDoc) { result = { ok: false, error: "Entrega no encontrada" }; break; }
          const esperado  = String(entDoc.codigoRecibo || "").toUpperCase();
          const ingresado = String(d.codigoRecibo || "").toUpperCase();
          if (esperado && esperado !== ingresado) {
            result = { ok: false, error: "Código de recibo incorrecto" }; break;
          }
          await sb.update("entregas", d.id, {
            estado: "confirmado", fechaConfirmacion: new Date().toISOString()
          });
          result = { ok: true };
          break;
        }

        // ══ SOLICITUDES DE CORRECCIÓN ═════════════════════════════
        case "GET_SOLICITUDES_CORRECCION": {
          if (!esAdmin) return forbidden();
          let sols;
          try { sols = await sb.query("solicitudes_correccion", "estado", "==", "pendiente"); }
          catch(_) { sols = []; }
          result = { ok: true, solicitudes: sols };
          break;
        }

        case "APROBAR_CORRECCION_VENTA": {
          if (!esAdmin) return forbidden();
          const sol = await sb.get("solicitudes_correccion", String(d.id));
          if (!sol) return json({ ok: false, error: "Solicitud no encontrada" });
          // Revertir la venta de verdad — antes solo se marcaba "aprobado" en
          // la solicitud sin tocar el registro de consignación, así que la
          // pieza nunca volvía a aparecer disponible en el inventario del
          // vendedor ni en su catálogo compartido.
          const cantRevertir = parseInt(sol.cantidad) || 1;
          // sol.ventaId ahora es el id del registro INDIVIDUAL de venta
          // (historialVentas del vendedor), no del registro de consignación
          // — hay que buscarlo ahí para saber a qué consignación pertenece.
          const vendSol = sol.vendedor ? await sb.get("vendedores", sol.vendedor) : null;
          const historialSol = vendSol && Array.isArray(vendSol.historialVentas) ? vendSol.historialVentas : [];
          const ventaSol = historialSol.find(v => v.id === sol.ventaId);
          const consignacionIdRevertir = ventaSol?.consignacionId || sol.ventaId; // fallback a solicitudes viejas (pre-historial)
          if (consignacionIdRevertir) {
            const consSol = await sb.get("consignacion", consignacionIdRevertir);
            if (consSol) {
              await sb.update("consignacion", consignacionIdRevertir, {
                vendido: Math.max(0, (parseInt(consSol.vendido)||0) - cantRevertir)
              });
              const sSol = await sb.get("stock", consSol.codigo);
              if (sSol) {
                await sb.update("stock", consSol.codigo, {
                  stock_vendido: Math.max(0, (parseInt(sSol.stock_vendido)||0) - cantRevertir)
                });
              }
            }
          }
          if (vendSol && ventaSol) {
            await sb.update("vendedores", sol.vendedor, {
              historialVentas: historialSol.filter(v => v.id !== sol.ventaId)
            });
          }
          await sb.update("solicitudes_correccion", String(d.id), { estado: "aprobado" });
          result = { ok: true };
          break;
        }

        case "RECHAZAR_CORRECCION_VENTA": {
          if (!esAdmin) return forbidden();
          await sb.update("solicitudes_correccion", String(d.id), { estado: "rechazado" });
          result = { ok: true };
          break;
        }

        // ══ CONFIG / PASS ═════════════════════════════════════════
        case "ACTUALIZAR_PASS_HASH": {
          if (!esAdmin) return forbidden();
          await sb.update("config", "settings", { passHash: d.nuevoHash });
          result = { ok: true };
          break;
        }

        case "ACTUALIZAR_CONFIG": {
          if (!esAdmin) return forbidden();
          await sb.update("config", "settings", d.config || {});
          result = { ok: true };
          break;
        }

        // ══ CUPONES ═══════════════════════════════════════════════
        case "CREAR_CUPON": {
          if (!esAdmin) return forbidden();
          await sb.set("cupones", d.codigo, {
            codigo: d.codigo, tipo: d.tipo || "porcentaje_total",
            descuento: parseFloat(d.descuento) || 0, categorias: d.categorias || "",
            montoMinimo: parseFloat(d.montoMinimo) || 0, limiteUsos: parseInt(d.limiteUsos) || 0,
            usosActuales: 0, activo: true
          });
          result = { ok: true };
          break;
        }

        case "TOGGLE_CUPON": {
          if (!esAdmin) return forbidden();
          await sb.update("cupones", d.codigo, { activo: !!d.activo });
          result = { ok: true };
          break;
        }

        case "ELIMINAR_CUPON": {
          if (!esAdmin) return forbidden();
          await sb.delete("cupones", d.codigo);
          result = { ok: true };
          break;
        }

        // ══ IMAGEN / FOTO ═════════════════════════════════════════
        case "ELIMINAR_FOTO": {
          if (!esAdmin) return forbidden();
          const ikKey = env.IMAGEKIT_PRIVATE_KEY;
          if (!ikKey) { result = { ok: false, error: "ImageKit no configurado" }; break; }
          try {
            const urlFoto  = (d.url || "").split("?")[0];
            const pathMatch = urlFoto.match(/ik\.imagekit\.io\/[^/]+(.+)/);
            if (!pathMatch) { result = { ok: false, error: "URL de ImageKit inválida" }; break; }
            const filePath = pathMatch[1]; // ej: /consignacion/foto_abc.jpg
            const parts    = filePath.split("/");
            const name     = parts[parts.length - 1];
            const folder   = parts.slice(0, -1).join("/") || "/";
            const auth     = "Basic " + btoa(ikKey + ":");
            // Buscar fileId por nombre + carpeta
            const listRes  = await fetch(
              `https://api.imagekit.io/v1/files?name=${encodeURIComponent(name)}&path=${encodeURIComponent(folder)}&limit=1`,
              { headers: { "Authorization": auth } }
            );
            const files = await listRes.json();
            if (!Array.isArray(files) || files.length === 0) {
              result = { ok: false, error: "Archivo no encontrado en ImageKit" }; break;
            }
            await fetch(`https://api.imagekit.io/v1/files/${files[0].fileId}`, {
              method: "DELETE", headers: { "Authorization": auth }
            });
            result = { ok: true };
          } catch(eIK) {
            result = { ok: false, error: "Error ImageKit: " + eIK.message };
          }
          break;
        }

        case "IMAGEKIT_FIRMA": {
          if (!esAdmin) return forbidden();
          const ikPriv = env.IMAGEKIT_PRIVATE_KEY;
          if (!ikPriv) { result = { ok: false, error: "ImageKit no configurado" }; break; }
          const token  = crypto.randomUUID();
          const expire = Math.floor(Date.now() / 1000) + 3600;
          const enc    = new TextEncoder();
          const ck     = await crypto.subtle.importKey("raw", enc.encode(ikPriv), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
          const sig    = await crypto.subtle.sign("HMAC", ck, enc.encode(token + expire));
          const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
          result = { ok: true, token, expire, signature };
          break;
        }

        case "SUBIR_FOTO": {
          // Permitir subida con key pública (desde celular) o con pass admin
          const keyOk = d.key === "VEREX_2026_PRO" || esAdmin;
          if (!keyOk) return forbidden();
          const ikKey = env.IMAGEKIT_PRIVATE_KEY;
          if (!ikKey) { result = { ok: false, error: "ImageKit no configurado en secrets" }; break; }
          const authHeader = "Basic " + btoa(ikKey + ":");
          const ext        = (d.imagen || "").startsWith("data:image/png") ? "png" : "jpg";
          const fileName   = (d.nombre || ("foto_" + Date.now())) + "." + ext;
          const form       = new FormData();
          form.append("file",              d.imagen);
          form.append("fileName",          fileName);
          form.append("folder",            "/consignacion");
          form.append("useUniqueFileName", "true");
          const ikRes  = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
            method: "POST",
            headers: { "Authorization": authHeader },
            body:   form
          });
          const ikData = await ikRes.json();
          if (ikData.url) {
            const urlBase = ikData.url.split("?")[0];
            result = { ok: true, url: urlBase + "?tr=w-900,h-900,c-maintain_ratio" };
          } else {
            result = { ok: false, error: ikData.message || "Error subiendo foto" };
          }
          break;
        }

        // ── Imágenes informativas (guías de talla, cuidados, promociones) —
        // separadas del inventario, solo para compartir el link con clientes.
        case "GUARDAR_IMAGEN_INFO": {
          if (!esAdmin) return forbidden();
          if (!d.url) { result = { ok: false, error: "Falta la URL de la imagen" }; break; }
          const imgId = "IMGINFO_" + Date.now();
          await sb.set("imagenes_info", imgId, {
            id: imgId,
            etiqueta: d.etiqueta || "",
            url: d.url,
            fecha: new Date().toISOString()
          });
          result = { ok: true, id: imgId };
          break;
        }

        case "GET_IMAGENES_INFO": {
          if (!esAdmin) return forbidden();
          const imagenes = await sb.getAll("imagenes_info");
          result = { ok: true, imagenes };
          break;
        }

        case "ELIMINAR_IMAGEN_INFO": {
          if (!esAdmin) return forbidden();
          await sb.delete("imagenes_info", d.id);
          result = { ok: true };
          break;
        }

        case "ELIMINAR_FONDO": {
          if (!esAdmin) return forbidden();
          const hfKey = env.HF_TOKEN;
          if (!hfKey) { result = { ok: false, error: "HF_TOKEN no configurado en secrets" }; break; }
          try {
            // Convertir base64 a binario
            const base64 = (d.imagen || "").replace(/^data:image\/\w+;base64,/, "");
            const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            // Llamar a Hugging Face RMBG-1.4
            const hfRes = await fetch(
              "https://api-inference.huggingface.co/models/briaai/RMBG-1.4",
              {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${hfKey}`,
                  "Content-Type": "application/octet-stream"
                },
                body: binary
              }
            );
            if (!hfRes.ok) {
              const err = await hfRes.text();
              result = { ok: false, error: `HF error ${hfRes.status}: ${err}` };
              break;
            }
            // Convertir respuesta PNG a base64
            const pngBuffer = await hfRes.arrayBuffer();
            const pngBase64 = btoa(String.fromCharCode(...new Uint8Array(pngBuffer)));
            result = { ok: true, imagen: "data:image/png;base64," + pngBase64 };
          } catch(e) {
            result = { ok: false, error: e.message };
          }
          break;
        }

        case "BACKUP_SOLO": {
          if (!esAdmin) return forbidden();
          const tablasBk = ["stock","vendedores","consignacion","abonos","entregas","cortes","pedidos","clientes","cupones"];
          const backupData = {};
          for (const t of tablasBk) {
            try { backupData[t] = await sb.getAll(t); } catch(_) { backupData[t] = []; }
          }
          backupData._fecha = new Date().toISOString();
          result = { ok: true, backup: backupData };
          break;
        }

        case "GEMINI_TEST": {
          if (!esAdmin) return forbidden();
          const gKey = env.GEMINI_KEY;
          if (!gKey) { result = { ok: false, error: "No hay GEMINI_KEY" }; break; }
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${gKey}`);
          const data = await r.json();
          const nombres = (data.models || []).map(m => m.name).filter(n => n.includes("gemini"));
          result = { ok: r.ok, status: r.status, modelos: nombres, error: data.error?.message };
          break;
        }

        case "ANALIZAR_IMAGEN": {
          if (!esAdmin) return forbidden();
          try {
            const base64 = (d.imagen || "").replace(/^data:image\/[^;]+;base64,/, "");
            if (!base64) { result = { ok: false, error: "No se recibió imagen" }; break; }
            const material = d.material || "Plata 925";

            // Detectar tipo de imagen (jpeg por defecto)
            const mimeMatch = (d.imagen || "").match(/^data:(image\/[^;]+);base64,/);
            const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

            const promptGemini =
              `Eres el naming director de una joyería de lujo latinoamericana. Creas nombres COMERCIALES, EVOCADORES y PREMIUM para cada pieza. Responde ÚNICAMENTE con JSON válido, sin texto antes ni después.\n\n` +
              `MATERIAL CONFIRMADO (no lo detectes, úsalo tal cual): ${material}\n\n` +
              `CATEGORÍA — elige el código exacto:\n` +
              `AN=anillo PU=pulsera CO=collar CD=collar con dije AR=aretes DJ=dije CJ=conjunto TB=tobillera RS=rosario CA=cadena\n\n` +
              `IDENTIFICA CON PRECISIÓN:\n` +
              `• Tipo de pieza: anillo, aretes, collar, pulsera, etc.\n` +
              `• Motivo principal — elige el que de verdad ves, pero ten en mente este banco amplio de opciones para no caer siempre en los mismos 3-4: corazón, mariposa, luna creciente, luna llena, sol, estrella, serpiente, infinito, flor, rosa, margarita, girasol, cruz, ángel, corona, llave, gota, espiral, lazo, moño, hoja, concha, caracola, delfín, abeja, libélula, pluma, arco iris, nudo, nudo marinero, banda lisa, solitario, trébol, ola, cascada, racimo, links, eslabones, cadena forzada, cadena veneciana, panal, rombo, cuadro, triángulo, ojo, media luna, sirena, estrella de mar, orquídea, hoja de olivo, rayo, cometa, cristal facetado, barroco, orgánico, ondas, espigas\n` +
              `• Piedras: zirconia blanca/champagne/negra/azul/roja/verde/morada/rosa/amarilla, ópalo, perla, cristal, turquesa, ónix, amatista, sin piedra\n` +
              `• Técnica: pavé, calado, filigrana, martillado, esmaltado, bicolor, halo, trenzado, entrelazado, texturizado, mate, pulido espejo\n\n` +
              `NOMBRE — sigue estas reglas ESTRICTAMENTE:\n` +
              `• Debe ser ESPECÍFICO al motivo real que ves en la foto — nunca inventes un motivo que no esté en la imagen\n` +
              `• Formato: [Tipo de joya] [motivo/técnica] [piedra o estilo si aplica]\n` +
              `• VARIEDAD OBLIGATORIA: este mismo prompt se usa cientos de veces seguidas para catalogar todo el inventario, así que NUNCA repitas la misma combinación de palabras que usarías para otra pieza parecida — cambia el orden, usa sinónimos, agrega un descriptor de estilo distinto cada vez (chic, boho, vintage, retro, art decó, minimalista, oversize — evita los adjetivos de la lista prohibida de abajo). Elige directamente el nombre menos genérico — NO escribas tu razonamiento ni nombres descartados, solo el JSON final.\n` +
              `• EJEMPLOS CORRECTOS:\n` +
              `  "Anillo Corazón Pavé Zirconia"\n` +
              `  "Aretes Luna Creciente Calada"\n` +
              `  "Collar Mariposa Ópalo"\n` +
              `  "Pulsera Infinito Zirconia Blanca"\n` +
              `  "Anillo Solitario Zirconia Oval"\n` +
              `  "Aretes Gota Zirconia Champagne"\n` +
              `  "Collar Estrella Halo Zirconia"\n` +
              `  "Anillo Serpiente Entrelazada"\n` +
              `  "Conjunto Corazón Bicolor"\n` +
              `  "Pulsera Trenzada Perla Cultivada"\n` +
              `  "Anillo Turquesa Chic"\n` +
              `• PROHIBIDO — NUNCA uses estas palabras: geométrico, decorativo, abstracto, elegante, moderno, bonito, clásico, simple, diseño, estilizado, sofisticado, fino, delicado, exclusivo, único, especial, precioso\n` +
              `• CADA PALABRA con su primera letra en mayúscula (Title Case), el resto de cada palabra en minúscula. Sin mencionar el material. Máximo 5 palabras.\n\n` +
              `DESCRIPCION — máximo 12 palabras:\n` +
              `• Describe exactamente lo que ves: motivo, piedra, técnica, forma. Sin mencionar ${material}.\n` +
              `• Ejemplo: "Corazón calado con pavé de zirconia blanca en todo el contorno"\n\n` +
              `DESCRIPCION_TIENDA — máximo 18 palabras:\n` +
              `• Frase de marketing que evoca emoción y ocasión de uso\n` +
              `• Ejemplos: "Captura cada mirada con el brillo eterno de este corazón iluminado", "La luna que siempre llevas contigo, radiante en plata"\n\n` +
              `Responde SOLO con este JSON (sin markdown, sin texto extra):\n` +
              `{"categoria":"XX","nombre":"nombre específico","descripcion":"descripción exacta","descripcion_tienda":"frase de marketing"}`;

            // ── Usar Groq (gratis) — llama-4-scout Y llama-4-maverick fueron
            // descontinuados por Groq (scout el 17-jun-2026, maverick antes),
            // por eso el análisis se quedaba colgado sin terminar. El modelo
            // de visión vigente en Groq es qwen3.6-27b.
            const groqKey = env.GROQ_KEY;
            if (!groqKey) { result = { ok: false, error: "GROQ_KEY no configurada en Cloudflare" }; break; }

            // Límite de 30s — sin esto, si Groq tarda mucho en responder (ej.
            // un modelo descontinuado que igual acepta la petición pero nunca
            // contesta bien), el análisis se queda "pegado" para siempre sin
            // mostrar ningún error en la pantalla.
            let groqRes;
            try {
              groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${groqKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: "qwen/qwen3.6-27b",
                  messages: [{
                    role: "user",
                    content: [
                      { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
                      { type: "text", text: promptGemini }
                    ]
                  }],
                  // qwen3.6-27b es un modelo de razonamiento — sin esto, gasta
                  // los tokens "pensando" en voz alta (bloque <think>...</think>)
                  // y nunca llega a escribir el JSON final. reasoning_effort:none
                  // lo pone en modo directo, sin ese paso.
                  reasoning_effort: "none",
                  max_tokens: 700,
                  temperature: 0.95
                }),
                signal: AbortSignal.timeout(30000)
              });
            } catch (e) {
              result = { ok: false, error: e.name === "TimeoutError" ? "Groq no respondió a tiempo (30s) — intenta de nuevo" : "Error de red hacia Groq: " + e.message };
              break;
            }

            if (!groqRes.ok) {
              const errTxt = await groqRes.text();
              result = { ok: false, error: "Groq error " + groqRes.status + ": " + errTxt.slice(0, 150) };
              break;
            }

            const groqData = await groqRes.json();
            // Por si el modelo igual manda un bloque <think> pese al
            // reasoning_effort:none, se descarta antes de buscar el JSON.
            let texto = (groqData.choices?.[0]?.message?.content || "").trim();
            texto = texto.replace(/<think>[\s\S]*?<\/think>/i, "").trim();
            const match = texto.match(/\{[\s\S]*?\}/);
            if (!match) { result = { ok: false, error: "Gemini no devolvió JSON: " + texto.slice(0, 150) }; break; }
            let parsed;
            try { parsed = JSON.parse(match[0]); }
            catch(pe) { result = { ok: false, error: "JSON inválido de Gemini: " + match[0].slice(0, 120) }; break; }

            result = { ok: true, resultado: {
              nombre:            parsed.nombre            || "",
              categoria:         parsed.categoria         || "",
              descripcion:       parsed.descripcion       || "",
              descripcion_tienda: parsed.descripcion_tienda || parsed.descripcion || "",
              material
            }};
          } catch(eIA) {
            result = { ok: false, error: "Error IA: " + eIA.message };
          }
          break;
        }

        case "GUARDAR_FOTO_PENDIENTE": {
          // Guarda URL de foto subida desde celular para usarla en el sistema
          const id = `foto_${Date.now()}`;
          await sb.set("fotos_pendientes", id, {
            id, url: d.url, fecha: new Date().toISOString(), usada: false
          });
          result = { ok: true, id };
          break;
        }

        case "GET_FOTOS_PENDIENTES": {
          if (!esAdmin) return forbidden();
          const fotos = await sb.getAll("fotos_pendientes");
          // Devolver solo las no usadas, más recientes primero, máx 20
          const recientes = fotos
            .filter(f => !f.usada)
            .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
            .slice(0, 20);
          result = { ok: true, fotos: recientes };
          break;
        }

        case "MARCAR_FOTO_USADA": {
          if (!esAdmin) return forbidden();
          await sb.update("fotos_pendientes", d.id, { usada: true });
          result = { ok: true };
          break;
        }

        case "REGISTRAR_VISITA": {
          // Público — se llama desde el catálogo en cada visita
          const hoy = new Date().toISOString().slice(0, 10); // "2026-06-08"
          let vis = await sb.get("config", "visitas_catalogo");
          if (!vis) vis = { total: 0, porDia: {} };
          vis.total = (vis.total || 0) + 1;
          vis.porDia = vis.porDia || {};
          vis.porDia[hoy] = (vis.porDia[hoy] || 0) + 1;
          // Mantener solo los últimos 30 días para no inflar el registro
          const dias = Object.keys(vis.porDia).sort();
          if (dias.length > 30) dias.slice(0, dias.length - 30).forEach(d => delete vis.porDia[d]);
          await sb.set("config", "visitas_catalogo", vis);
          result = { ok: true };
          break;
        }

        // Historial global de variedad: registra cuándo se le mostró por última
        // vez cada código a CUALQUIER afiliado, para repartir la variedad del
        // inventario entre todos en vez de que cada afiliado solo evite repetirse
        // a sí mismo (con varios afiliados compartiendo el mismo stock, eso
        // agotaba la variedad rápido — cada uno terminaba con el mismo catálogo).
        case "GET_VARIEDAD_CATALOGO_GLOBAL": {
          if (!esAdmin) return forbidden();
          const reg = await sb.get("config", "variedad_catalogo_global") || { codigos: {} };
          result = { ok: true, codigos: reg.codigos || {} };
          break;
        }

        case "REGISTRAR_VARIEDAD_CATALOGO_GLOBAL": {
          if (!esAdmin) return forbidden();
          const reg = await sb.get("config", "variedad_catalogo_global") || { codigos: {} };
          reg.codigos = reg.codigos || {};
          const ts = Date.now();
          (Array.isArray(d.codigos) ? d.codigos : []).forEach(c => { reg.codigos[c] = ts; });
          // Limitar el registro a 2000 códigos más recientes para no inflarlo indefinidamente
          const entradas = Object.entries(reg.codigos).sort((a, b) => b[1] - a[1]);
          if (entradas.length > 2000) reg.codigos = Object.fromEntries(entradas.slice(0, 2000));
          await sb.set("config", "variedad_catalogo_global", reg);
          result = { ok: true };
          break;
        }

        case "GET_VISITAS": {
          if (!esAdmin) return forbidden();
          const vis = await sb.get("config", "visitas_catalogo") || { total: 0, porDia: {} };
          const hoy = new Date().toISOString().slice(0, 10);
          const hace7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
          const visitasHoy    = vis.porDia?.[hoy] || 0;
          const visitasSemana = Object.entries(vis.porDia || {})
            .filter(([dia]) => dia >= hace7)
            .reduce((s, [, n]) => s + n, 0);
          result = { ok: true, total: vis.total || 0, hoy: visitasHoy, semana: visitasSemana, porDia: vis.porDia || {} };
          break;
        }

        default:
          result = { ok: false, error: `Acción no reconocida: ${d.accion}` };
      }

      return json(result);

    } catch(e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }
};

// ── CLASE SUPABASE ────────────────────────────────────────────────
//
//  Estructura de cada tabla en Supabase:
//    id   TEXT PRIMARY KEY   — el mismo "doc ID" que se usaba en Firestore
//    data JSONB              — todos los campos del documento
//
//  Función PostgreSQL requerida (ver SQL de setup):
//    update_doc(p_table, p_id, p_patch) — merge parcial de JSONB
// ─────────────────────────────────────────────────────────────────
class Supabase {
  constructor(url, key) {
    this.url = (url || "").replace(/\/$/, "");
    this.key = key || "";
  }

  _headers(prefer = null) {
    const h = {
      "apikey":        this.key,
      "Authorization": `Bearer ${this.key}`,
      "Content-Type":  "application/json"
    };
    if (prefer) h["Prefer"] = prefer;
    return h;
  }

  // Leer un documento por id
  async get(table, id) {
    const res  = await fetch(
      `${this.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=id,data&limit=1`,
      { headers: this._headers(), cf: { cacheTtl: 0, cacheEverything: false } }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB get ${table}/${id}: ${res.status} ${txt}`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return { id: rows[0].id, ...rows[0].data };
  }

  // Obtener todos los documentos de una tabla.
  // Pagina en bloques de 1000 (en vez de pedir limit=10000 de una vez) y
  // desactiva el cache de borde de Cloudflare en cada subrequest — sin esto,
  // filas recién insertadas podían no aparecer en lecturas subsecuentes
  // (Cloudflare cacheaba la respuesta GET del REST de Supabase).
  async getAll(table) {
    const pageSize = 1000;
    let allRows = [];
    let offset = 0;
    while (true) {
      const res = await fetch(
        `${this.url}/rest/v1/${table}?select=id,data&order=id&limit=${pageSize}&offset=${offset}`,
        { headers: this._headers(), cf: { cacheTtl: 0, cacheEverything: false } }
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`SB getAll ${table}: ${res.status} ${txt}`);
      }
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) break;
      allRows = allRows.concat(rows);
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
    return allRows.map(r => ({ id: r.id, ...r.data }));
  }

  // Crear/sobreescribir documento (upsert completo)
  async set(table, id, obj) {
    const { id: _id, ...data } = obj;
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method:  "POST",
      headers: this._headers("resolution=merge-duplicates"),
      body:    JSON.stringify({ id, data }),
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB set ${table}: ${res.status} ${txt}`);
    }
  }

  // stock_total es un DERIVADO de las unidades reales: bodega + tienda +
  // consignación (misma fórmula que _stockTotalProd() en el admin).
  //
  // Se recalcula acá, en el único punto por donde pasan TODAS las escrituras,
  // porque hay más de 20 lugares en el worker que mueven stock y cualquiera se
  // podía olvidar de mantenerlo. De hecho eso pasaba: stock_total solo se
  // escribía al crear el producto y nunca se decrementaba al vender, así que
  // quedaba inflado para siempre y los catálogos nunca ocultaban lo agotado.
  static COMPONENTES_STOCK = ["stock_bodega", "stock_tienda", "stock_consignacion"];

  async _conStockTotal(id, fields) {
    const comp = Supabase.COMPONENTES_STOCK;
    // Si el patch no toca las unidades, no hay nada que recalcular.
    if (!comp.some(c => fields[c] !== undefined)) return fields;

    const vals = { ...fields };
    // Si el patch trae solo algunos componentes, se leen los actuales para
    // completar los que faltan — sin eso el total saldría mal.
    if (!comp.every(c => vals[c] !== undefined)) {
      let actual = null;
      try { actual = await this.get("stock", id); } catch (_) { actual = null; }
      if (!actual) return fields;   // no se pudo leer: mejor no tocar el total
      for (const c of comp) if (vals[c] === undefined) vals[c] = actual[c];
    }

    const total = comp.reduce((a, c) => a + (parseInt(vals[c]) || 0), 0);
    return { ...fields, stock_total: total };
  }

  // Actualizar campos específicos (merge parcial vía RPC)
  async update(table, id, fields) {
    if (table === "stock") fields = await this._conStockTotal(id, fields);
    const res = await fetch(`${this.url}/rest/v1/rpc/update_doc`, {
      method:  "POST",
      headers: this._headers(),
      body:    JSON.stringify({ p_table: table, p_id: String(id), p_patch: fields })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB update ${table}/${id}: ${res.status} ${txt}`);
    }
  }

  // Eliminar documento
  async delete(table, id) {
    const res = await fetch(
      `${this.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,
      { method: "DELETE", headers: this._headers() }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB delete ${table}/${id}: ${res.status} ${txt}`);
    }
  }

  // Query con filtro sobre campo JSONB (campo == valor)
  async query(table, campo, _op, valor) {
    const res = await fetch(
      `${this.url}/rest/v1/${table}?select=id,data&data->>${encodeURIComponent(campo)}=eq.${encodeURIComponent(valor)}`,
      { headers: this._headers(), cf: { cacheTtl: 0, cacheEverything: false } }
    );
    if (!res.ok) {
      console.error(`[Supabase.query] Error ${res.status} en tabla ${table}`);
      return [];
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows.map(r => ({ id: r.id, ...r.data }));
  }
}

// ── CIERRE MENSUAL ────────────────────────────────────────────────
// Junta los 4 canales de venta (ecommerce, venta directa, consignación,
// afiliados sin stock) en un solo resumen del mes. Consignación y afiliados
// se sacan de historialVentas de cada vendedor (fecha real de cada venta,
// no la de entrega) — antes de la migración de historial, meses viejos
// pueden salir en 0 en esos dos canales porque ese detalle no existía.
async function generarCierreMes(sb, anio, mesIndex0) {
  const inicio = Date.UTC(anio, mesIndex0, 1);
  const fin    = Date.UTC(anio, mesIndex0 + 1, 1);
  const enRango = f => { const t = new Date(f || 0).getTime(); return t >= inicio && t < fin; };

  const [peds, vd, todosVendCierre] = await Promise.all([
    sb.getAll("pedidos"), sb.getAll("ventas_directas"), sb.getAll("vendedores")
  ]);

  const ecommerceVentas = peds.filter(p => enRango(p.fecha));
  const ecommerceTotal  = ecommerceVentas.reduce((s, p) => s + (parseFloat(p.total) || 0), 0);

  const directaVentas = vd.filter(v => enRango(v.fecha));
  const directaTotal  = directaVentas.reduce((s, v) => s + (parseFloat(v.total) || 0), 0);

  let consignacionTotal = 0, consignacionCant = 0;
  let afiliadoSinStockTotal = 0, afiliadoSinStockCant = 0;
  const porVendedor = [];
  for (const v of todosVendCierre) {
    const hist = Array.isArray(v.historialVentas) ? v.historialVentas : [];
    const delMes = hist.filter(h => enRango(h.fecha));
    if (!delMes.length) continue;
    const totalV = delMes.reduce((s, h) => s + (parseFloat(h.precio) || 0) * (parseInt(h.cantidad) || 1), 0);
    const unidadesV = delMes.reduce((s, h) => s + (parseInt(h.cantidad) || 1), 0);
    const esAfiliadoSinStock = v.tipo === "afiliado" && !v.recibeFisico;
    if (esAfiliadoSinStock) { afiliadoSinStockTotal += totalV; afiliadoSinStockCant += unidadesV; }
    else { consignacionTotal += totalV; consignacionCant += unidadesV; }
    porVendedor.push({ vendedor: v.codigo, nombre: v.nombre, total: totalV, unidades: unidadesV, esAfiliadoSinStock });
  }
  porVendedor.sort((a, b) => b.total - a.total);

  // Ingreso REAL de VEREX este mes: ecommerce + venta directa + comisión que
  // cobra por afiliados sin stock (ese dinero ya entró a caja). Consignación
  // tradicional NO cuenta aquí — el vendedor cobró él primero y liquida
  // después, ese dinero no ha entrado a VEREX todavía.
  const ingresoRealVerex = ecommerceTotal + directaTotal + afiliadoSinStockTotal;
  const totalGeneral = ingresoRealVerex + consignacionTotal;

  return {
    id: `${anio}-${String(mesIndex0 + 1).padStart(2, "0")}`,
    anio, mes: mesIndex0 + 1,
    generadoEn: new Date().toISOString(),
    ecommerce:        { total: ecommerceTotal,      cantidad: ecommerceVentas.length },
    ventaDirecta:      { total: directaTotal,         cantidad: directaVentas.length },
    afiliadosSinStock:{ total: afiliadoSinStockTotal, cantidad: afiliadoSinStockCant },
    consignacion:      { total: consignacionTotal,    cantidad: consignacionCant },
    ingresoRealVerex, totalGeneral,
    porVendedor
  };
}

// ── AUTENTICACIÓN ────────────────────────────────────────────────
async function hashStr(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Verifica la contraseña: primero contra SECRET_PASS (env var),
// si no coincide intenta con el hash guardado en Supabase
// (permite cambiar contraseña sin editar el env var de Cloudflare).
async function verificarPassword(pass, env, sb) {
  if (!pass) return false;
  // Aceptar texto plano (SECRET_PASS del env) o su hash SHA-256
  if (pass === env.SECRET_PASS) return true;
  const hashDeSecret = await hashStr(env.SECRET_PASS || "");
  if (pass === hashDeSecret) return true;
  // También verificar contra passHash guardado en Supabase
  try {
    const cfg = await sb.get("config", "settings");
    if (cfg && cfg.passHash) {
      // Aceptar el hash directamente (frontend ya lo hasheó)
      if (pass === cfg.passHash) return true;
      // O hashear lo que llegó (compatibilidad con texto plano)
      const hash = await hashStr(pass);
      if (hash === cfg.passHash) return true;
    }
  } catch(_) {}
  return false;
}

// ── HELPERS HTTP ──────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
function forbidden() {
  return json({ ok: false, error: "No autorizado" }, 403);
}
