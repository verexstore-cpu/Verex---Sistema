// Tienda USA (us.verexstore.com): pedidos, pagos PayPal/Wompi, reembolsos, rentabilidad y VEREX AI
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
// Cada acción devuelve el resultado (se responde como JSON) o una Response; NO_MANEJADA si no es de este módulo.
import { fetchResend } from "../lib/avisos.js";
import { NO_MANEJADA, forbidden } from "../lib/http.js";
import { limpiarTextoPublico, sinHtml } from "../lib/publico.js";
import { RESERVA_PAYPAL_CHECKOUT_MS } from "../lib/reservas.js";
import { safeEq } from "../lib/seguridad.js";
import { OTP_REEMB_MAX_INTENTOS, OTP_REEMB_VIGENCIA_MS, RE_PAYPAL_ORDER, _ppTokenCache, cerrarCobroUSA, codigoAleatorio6, confirmarPagoPedidoUSA, enviarCodigoReembolso, huellaCodigoReembolso, montoCoincide, paypalApi, paypalCapturaDe, paypalConfigurado, paypalToken, prepararCobroUSA, wompiToken } from "../lib/usa-pagos.js";
import { RE_PEDIDO_USA, avisarAdminUSA, enviarCorreoEnvioUSA, enviarCorreoPagoConfirmadoUSA, numeroGuardadoPedidoUSA, numeroPedidoUSA } from "../lib/usa-pedidos.js";

export async function accionesUSA({ d, sb, env, ip, esAdmin, request }) {
  let result;
  switch (d.accion) {

    // Un solo correo por pedido completo de catalogo-us.html (no uno por
    // producto como REGISTRAR_LEAD) — se llama una vez al final del
    // checkout, en paralelo a que se abra WhatsApp para el cliente. Sin
    // auth de admin: mismo nivel de confianza público que REGISTRAR_LEAD
    // (el catálogo es una página pública, no el panel de Admin).
    case "ENVIAR_PEDIDO_USA": {
      if (!Array.isArray(d.items) || !d.items.length) { result = { ok: false, error: "Pedido vacío" }; break; }
      // Endpoint público que manda correos desde el dominio de VEREX: los datos del cliente van como texto, nunca HTML.
      limpiarTextoPublico(d, ["nombreCliente", "telefono", "correo", "direccionCompleta"]);
      d.items = d.items.slice(0, 30).map(it => ({ ...it, nombre: sinHtml(it && it.nombre, 160) }));
      const numPed = await numeroGuardadoPedidoUSA(sb, d.pedidoId);   // número corto US-DDMM-NNN (si la página mandó el pedidoId)
      try {
        const RESEND_KEY = env.RESEND_KEY;
        if (RESEND_KEY) {
          // Fila con miniatura — valida que la foto sea una URL https
          // real antes de insertarla como <img src> (endpoint público,
          // sin auth de admin, así que no se confía en el string tal cual).
          const filaProducto = it => {
            const fotoOk = /^https:\/\/[^\s"'<>]+$/.test(it.foto || "");
            const img = fotoOk
              ? `<img src="${it.foto}" width="40" height="40" style="border-radius:6px;object-fit:cover;vertical-align:middle;margin-right:8px;" alt="">`
              : "";
            return `<tr><td style="padding:6px 0;color:#111;">${img}${it.nombre || "—"}${it.qty > 1 ? ` ×${it.qty}` : ""}</td><td style="padding:6px 0;color:#111;text-align:right;">$${((parseFloat(it.precio)||0)*(parseInt(it.qty)||1)).toFixed(2)}</td></tr>`;
          };
          const filas = d.items.map(filaProducto).join("");
          const envio = parseFloat(d.envio) || 0;
          const total = d.total != null ? parseFloat(d.total) : null;
          // Validar formato antes de insertarlo como link clicable en el
          // correo (este endpoint es público, sin auth de admin) — solo
          // se acepta un paypal.me/usuario/monto bien formado.
          const esWompi = d.metodoPago === "wompi";
          const pagoLinkOk = /^https:\/\/paypal\.me\/[A-Za-z0-9_.]{1,50}\/\d+\.\d{2}[A-Z]{0,3}$/.test(d.pagoLink || "")
            || /^https:\/\/www\.(sandbox\.)?paypal\.com\/[A-Za-z0-9\/_\-?=&%.]{1,200}$/.test(d.pagoLink || "")
            || /^https:\/\/([a-z0-9-]+\.)*wompi\.sv\/[A-Za-z0-9\/_\-?=&%.]{0,300}$/.test(d.pagoLink || "");   // sin comillas: va dentro de un href
          const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.correo || "");
          const pagoLinkHtml = pagoLinkOk ? `
                        <div style="margin:0 0 16px;padding:12px 14px;background:#fef9e7;border:1px solid #f0d98c;border-radius:8px;text-align:center;">
                          <div style="font-size:11px;color:#8a6d1a;font-weight:700;margin-bottom:6px;">💳 LINK DE PAGO (${esWompi ? "Wompi" : "PayPal"})${correoValido ? "" : " — MANDAR AL CLIENTE"}</div>
                          <a href="${d.pagoLink}" style="font-size:13px;color:#1a5fb4;word-break:break-all;">${d.pagoLink}</a>
                        </div>` : "";
          await fetchResend("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
            body: JSON.stringify({
              from: "VEREX Store <hola@notificaciones.verexstore.com>",
              reply_to: "hola@verexstore.com",
              to:   ["verex.pedidos@verexstore.com"],
              subject: `🇺🇸 Pedido USA${numPed ? " " + numPed : ""} — ${d.nombreCliente || "cliente"} — $${(total ?? 0).toFixed(2)}`,
              html: `
                    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border:2px solid #C9A84C;border-radius:12px;overflow:hidden;">
                      <div style="background:linear-gradient(135deg,#aaa,#d0d0d0);padding:24px;text-align:center;">
                        <h1 style="margin:0;font-size:22px;letter-spacing:3px;color:#111;">VEREX STORE</h1>
                        <p style="margin:6px 0 0;font-size:13px;color:#444;">Nuevo pedido — catálogo Estados Unidos</p>
                      </div>
                      <div style="padding:24px;">
                        ${pagoLinkHtml}
                        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">
                          <tr><td style="padding:6px 0;color:#888;width:110px;">Cliente</td><td style="padding:6px 0;font-weight:700;color:#111;">${d.nombreCliente || "—"}</td></tr>
                          <tr><td style="padding:6px 0;color:#888;">Teléfono</td><td style="padding:6px 0;color:#111;">${d.telefono || "—"}</td></tr>
                          <tr><td style="padding:6px 0;color:#888;">Correo</td><td style="padding:6px 0;color:#111;">${d.correo || "—"}</td></tr>
                          <tr><td style="padding:6px 0;color:#888;">Dirección</td><td style="padding:6px 0;color:#111;">${d.direccionCompleta || "—"}</td></tr>
                        </table>
                        <table style="width:100%;border-collapse:collapse;font-size:13px;border-top:1px solid #eee;padding-top:8px;">
                          ${filas}
                          <tr><td style="padding:8px 0 2px;color:#888;">Envío (DHL)</td><td style="padding:8px 0 2px;color:#111;text-align:right;">${envio > 0 ? "$" + envio.toFixed(2) : "GRATIS"}</td></tr>
                          <tr><td style="padding:2px 0;font-weight:700;color:#111;">Total</td><td style="padding:2px 0;font-weight:700;color:#111;text-align:right;">$${(total ?? 0).toFixed(2)}</td></tr>
                        </table>
                        <p style="margin:16px 0 0;font-size:12px;color:#999;">${correoValido ? "✅ Ya se le mandó al cliente su resumen y el link de pago por correo — no hace falta reenviárselo." : "⚠️ El cliente no dejó un correo válido — mándale tú el link de pago de arriba por WhatsApp."} Revisa el panel de Logística USA para marcar el pago, agregar el tracking de DHL e imprimir la etiqueta de envío.</p>
                      </div>
                      <div style="padding:16px 24px;background:#f5f5f5;border-top:2px solid #C9A84C;text-align:center;font-size:12px;color:#888;">
                        El mundo es mejor cuando brillas tú ✨
                      </div>
                    </div>`
            })
          });

          // ── Correo al CLIENTE con su pedido + link de pago ──────────
          // Antes esto dependía de que el admin viera el aviso y le
          // reenviara el link a mano por WhatsApp (nada garantizado en
          // EE. UU.) — ahora sale solo, en el idioma que eligió en el
          // catálogo, apenas termina el checkout.
          if (correoValido) {
            const en = d.lang === "en";
            // Mismo diccionario de palabras comunes de joyería que usa
            // catalogo-us.html (duplicado a propósito: el worker no
            // comparte código con la página estática) — el correo al
            // admin (arriba) se queda siempre en español tal cual está
            // en el inventario; esto solo aplica al correo del cliente.
            const traducirNombreEN = nombre => {
              if (!nombre) return nombre || "";
              let s = String(nombre).trim();
              // La categoría (Anillo, Cadena...) suele ser la primera
              // palabra en español, pero en inglés va al final del
              // nombre ("Sterling Silver Ring", no "Ring Sterling
              // Silver") — se saca del frente y se reordena al final.
              const categorias = [
                [/^alianzas?\b/i, "Wedding Band"],
                [/^argollas?\b/i, "Band"],
                [/^anillos?\b/i, "Ring"],
                [/^cadenas?\b/i, "Chain"],
                [/^pulseras?\b/i, "Bracelet"],
                [/^aretes?\b/i, "Earrings"],
                [/^aros?\b/i, "Hoops"],
                [/^dijes?\b/i, "Charm"],
                [/^collares?\b/i, "Necklace"],
                [/^conjuntos?\b/i, "Set"],
                [/^relojes?\b/i, "Watch"],
              ];
              let categoriaEN = "";
              for (const [re, out] of categorias) {
                if (re.test(s)) { categoriaEN = out; s = s.replace(re, "").trim(); break; }
              }
              const reglas = [
                [/plata\s*925\s*(?:\+|con)?\s*oro\s*laminado/gi, "Sterling Silver with Gold Plating"],
                [/plata\s*(?:fina\s*)?925/gi, "Sterling Silver"],
                [/oro\s*laminado/gi, "Gold Plated"],
                [/acero\s*(?:inoxidable\s*)?316l?/gi, "Stainless Steel"],
                [/\bplata\b/gi, "Silver"],
                [/\bacero\b/gi, "Steel"],
                [/\bmatrimonios?\b/gi, "Wedding"],
                [/\bnovios?\b/gi, "Bridal"],
                [/\bsolitarios?\b/gi, "Solitaire"],
                [/\bparejas?\b/gi, "Pair"],
                [/\bdama\b/gi, "Women's"],
                [/\bcaballero\b/gi, "Men's"],
                [/\bcoraz[oó]n\b/gi, "Heart"],
                [/\bdobles?\b/gi, "Double"],
                [/\btr[ií]o\b/gi, "Trio"],
                [/\bsencillos?\b/gi, "Simple"],
              ];
              reglas.forEach(([re, out]) => { s = s.replace(re, out); });
              s = s.trim();
              return categoriaEN ? (s ? `${s} ${categoriaEN}` : categoriaEN) : s;
            };
            const filasCliente = d.items
              .map(it => en ? { ...it, nombre: traducirNombreEN(it.nombre) } : it)
              .map(filaProducto).join("");
            const txt = en ? {
              preheader: "We received your order",
              hola: `Hi ${d.nombreCliente || ""},`,
              gracias: "Thanks for your order! We received it. Here's your summary:",
              envioLbl: "Shipping (DHL)", freeLbl: "FREE", totalLbl: "Total",
              pagoTitulo: "If you already paid, there's nothing else you need to do. If not — or if you closed the page before finishing — here's your payment link:",
              siguiente: "Once we confirm your payment, we'll prepare your order and ship it via DHL — delivery takes 5–7 business days.",
              direccionLbl: "Shipping to:",
              dudas: "Questions? Just reply to this email.",
              subject: `🛍️ We received your VEREX Store order${numPed ? " " + numPed : ""}`
            } : {
              preheader: "Recibimos tu pedido",
              hola: `Hola ${d.nombreCliente || ""},`,
              gracias: "¡Gracias por tu pedido! Lo recibimos. Aquí está tu resumen:",
              envioLbl: "Envío (DHL)", freeLbl: "GRATIS", totalLbl: "Total",
              pagoTitulo: "Si ya pagaste, no necesitas hacer nada más. Si aún no, o si cerraste la página antes de terminar, este es tu link de pago:",
              siguiente: "Cuando confirmemos tu pago, preparamos tu pedido y lo enviamos por DHL — la entrega toma entre 5 y 7 días hábiles.",
              direccionLbl: "Dirección de envío:",
              dudas: "¿Dudas? Responde este mismo correo.",
              subject: `🛍️ Recibimos tu pedido${numPed ? " " + numPed : ""} en VEREX Store`
            };
            // Ya no es un botón grande de "pagar aquí": el pago se completa
            // directo en la página al hacer el pedido (link de respaldo
            // visible ahí mismo si el pop-up se bloquea). Este correo solo
            // deja el link como texto simple, por si el cliente cerró la
            // página antes de terminar y necesita retomarlo sin volver a
            // hacer el pedido.
            const botonPago = pagoLinkOk ? `
                  <div style="margin:16px 0;padding:12px 14px;background:#faf8f2;border-radius:8px;">
                    <p style="font-size:12px;color:#777;margin:0 0 6px;">${txt.pagoTitulo}</p>
                    <a href="${d.pagoLink}" style="font-size:13px;color:#1a5fb4;word-break:break-all;">${d.pagoLink}</a>
                  </div>` : "";
            await fetchResend("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
              body: JSON.stringify({
                from: "VEREX Store <hola@notificaciones.verexstore.com>",
                reply_to: "hola@verexstore.com",
                to:   [d.correo],
                subject: txt.subject,
                html: `
                      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border:2px solid #C9A84C;border-radius:12px;overflow:hidden;">
                        <div style="background:linear-gradient(135deg,#8a6a1f,#e8c766,#C9A84C);padding:24px;text-align:center;">
                          <h1 style="margin:0;font-size:22px;letter-spacing:3px;color:#111;">VEREX STORE</h1>
                          <p style="margin:6px 0 0;font-size:13px;color:#3a2a05;">${txt.preheader}</p>
                        </div>
                        <div style="padding:24px;">
                          <p style="margin:0 0 14px;font-size:14px;color:#111;">${txt.hola}</p>
                          <p style="margin:0 0 16px;font-size:13px;color:#555;">${txt.gracias}</p>
                          ${numPed ? `<p style="margin:0 0 14px;font-size:14px;color:#111;"><span style="color:#888;">${en ? "Order number" : "Número de pedido"}:</span> <b>${numPed}</b></p>` : ""}
                          <table style="width:100%;border-collapse:collapse;font-size:13px;border-top:1px solid #eee;padding-top:8px;">
                            ${filasCliente}
                            <tr><td style="padding:8px 0 2px;color:#888;">${txt.envioLbl}</td><td style="padding:8px 0 2px;color:#111;text-align:right;">${envio > 0 ? "$" + envio.toFixed(2) : txt.freeLbl}</td></tr>
                            <tr><td style="padding:2px 0;font-weight:700;color:#111;">${txt.totalLbl}</td><td style="padding:2px 0;font-weight:700;color:#111;text-align:right;">$${(total ?? 0).toFixed(2)}</td></tr>
                          </table>
                          ${botonPago}
                          <p style="margin:16px 0 4px;font-size:12px;color:#999;">${txt.direccionLbl}<br>${d.direccionCompleta || "—"}</p>
                          <p style="margin:14px 0 0;font-size:12px;color:#999;">${txt.siguiente}</p>
                          <p style="margin:8px 0 0;font-size:12px;color:#999;">${txt.dudas}</p>
                        </div>
                        <div style="padding:16px 24px;background:#f5f5f5;border-top:2px solid #C9A84C;text-align:center;font-size:12px;color:#888;">
                          El mundo es mejor cuando brillas tú ✨
                        </div>
                      </div>`
              })
            });
          }
        }
        result = { ok: true };
      } catch(pedidoUsaErr) {
        console.error("Pedido USA email error:", pedidoUsaErr);
        result = { ok: false, error: "No se pudo enviar el correo" };
      }
      break;
    }

    // Alternativa a PayPal en el checkout de EE.UU.: genera un enlace de
    // pago de Wompi (comisión más baja, depósito directo a la cuenta en
    // El Salvador) por el monto exacto del pedido. Mismo nivel de
    // confianza público que ENVIAR_PEDIDO_USA — sin auth de admin.
    case "CREAR_ENLACE_PAGO_WOMPI": {
      if (!RE_PEDIDO_USA.test(String(d.pedidoId || "")) || !(parseFloat(d.monto) > 0) || parseFloat(d.monto) > 50000) {
        result = { ok: false, error: "Pedido inválido" }; break;
      }
      const cobroW = await prepararCobroUSA(sb, String(d.pedidoId), d);
      if (!cobroW.ok) { result = cobroW; break; }
      const montoWompi = cobroW.total;
      try {
        const token = await wompiToken(env);
        const ahora = new Date();
        const vence = new Date(ahora.getTime() + 48 * 3600 * 1000);
        const resEnlace = await fetch("https://api.wompi.sv/EnlacePago", {
          method: "POST",
          headers: { "Content-Type": "application/json", "authorization": `Bearer ${token}` },
          body: JSON.stringify({
            identificadorEnlaceComercio: String(d.pedidoId),
            monto: montoWompi,
            nombreProducto: "Pedido VEREX Store",
            formaPago: {
              permitirTarjetaCreditoDebido: true,
              permitirPagoConPuntoAgricola: false,
              permitirPagoEnCuotasAgricola: false,
              permitirPagoEnBitcoin: false,
              permitePagoQuickPay: false
            },
            infoProducto: {
              descripcionProducto: String(d.descripcion || "").slice(0, 300),
              urlImagenProducto: /^https:\/\//.test(d.foto || "") ? d.foto : ""
            },
            configuracion: {
              esMontoEditable: false,
              esCantidadEditable: false,
              cantidadPorDefecto: 1,
              urlWebhook: `https://verex-api.verexstore.workers.dev/webhook-wompi/${env.WOMPI_WEBHOOK_SECRET}`,
              urlRetorno: "https://us.verexstore.com/",
              notificarTransaccionCliente: true,
              emailsNotificacion: "verex.pedidos@verexstore.com"
            },
            vigencia: {
              fechaInicio: ahora.toISOString(),
              fechaFin: vence.toISOString()
            },
            limitesDeUso: {
              cantidadMaximaPagosExitosos: 1,
              cantidadMaximaPagosFallidos: 5
            }
          })
        });
        const dataEnlace = await resEnlace.json();
        if (!resEnlace.ok || !dataEnlace.urlEnlace) {
          console.error("Wompi enlace error:", dataEnlace);
          result = { ok: false, error: "No se pudo generar el link de pago" }; break;
        }
        const numeroW = await numeroPedidoUSA(sb, String(d.pedidoId));
        await cerrarCobroUSA(sb, cobroW, { pagoLink: dataEnlace.urlEnlace, metodoPagoUSA: "wompi", numeroPedidoUSA: numeroW || "" });
        result = { ok: true, urlEnlace: dataEnlace.urlEnlace, idEnlace: dataEnlace.idEnlace, numeroPedido: numeroW, total: montoWompi };
      } catch(wompiErr) {
        console.error("Wompi error:", wompiErr);
        result = { ok: false, error: "No se pudo generar el link de pago" };
      }
      break;
    }

    // Panel de Logística USA: actualiza pago/tracking/notas/entrega de un
    // pedido del catálogo de Estados Unidos. El ciclo estado/historial
    // sigue siendo independiente del flujo doméstico (interesado→
    // reportado→en_camino→vendido) — este merge solo toca las llaves
    // que llegan. El stock SÍ se mueve en las transiciones de pago/
    // entrega (ver abajo), para que no dependa de que el admin se
    // acuerde de descontarlo aparte.
    // Público (lo usa us.verexstore.com): ¿ya se confirmó el pago de este pedido? No devuelve datos del
    // cliente, solo un estado. El pedidoId lo genera el catálogo al hacer el pedido (no es adivinable a la ligera).
    case "GET_ESTADO_PEDIDO_USA": {
      const pid = String(d.pedidoId || "");
      if (!/^US[a-z0-9]{4,40}$/.test(pid)) { result = { ok: false, error: "pedido_invalido" }; break; }
      const lds = (await sb.query("leads", "pedidoId", "eq", pid)).filter(l => l.pais === "US");
      let estadoPed = "no_encontrado";
      if (lds.length) {
        estadoPed = lds.some(l => l.pagadoUSA) ? "pagado"
          : lds.every(l => l.estado === "cancelado") ? "cancelado" : "pendiente";
      }
      result = { ok: true, estado: estadoPed, numero: lds.find(l => l.numeroPedidoUSA)?.numeroPedidoUSA || "" };
      break;
    }

    // Checkout oficial de PayPal (público, lo usa us.verexstore.com): crea la orden y devuelve a dónde mandar al cliente.
    case "CREAR_ORDEN_PAYPAL": {
      if (!paypalConfigurado(env)) { result = { ok: false, error: "paypal_no_configurado" }; break; }
      const pid = String(d.pedidoId || "");
      if (!RE_PEDIDO_USA.test(pid) || !(parseFloat(d.monto) > 0) || parseFloat(d.monto) > 50000) { result = { ok: false, error: "pedido_invalido" }; break; }
      // El monto lo calcula el servidor (productos verificados + cupón + envío); el del navegador solo se compara.
      const cobroPP = await prepararCobroUSA(sb, pid, d);
      if (!cobroPP.ok) { result = cobroPP; break; }
      const montoPP = cobroPP.total;
      const baseRet = (env.PAYPAL_RETURN_BASE || "https://us.verexstore.com/").replace(/\/?$/, "/");
      const numeroPP = await numeroPedidoUSA(sb, pid);
      try {
        const o = await paypalApi(env, "POST", "/v2/checkout/orders", {
          intent: "CAPTURE",
          purchase_units: [{
            reference_id: pid, custom_id: pid,
            description: ((numeroPP ? numeroPP + " — " : "") + String(d.descripcion || "VEREX Store order")).slice(0, 120),
            amount: { currency_code: "USD", value: montoPP.toFixed(2) }
          }],
          payment_source: { paypal: { experience_context: {
            brand_name: "VEREX Store", landing_page: "NO_PREFERENCE", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING",
            return_url: `${baseRet}?pp=return&pedido=${pid}`, cancel_url: `${baseRet}?pp=cancel&pedido=${pid}`
          } } }
        }, pid);
        const link = (o.data?.links || []).find(l => l.rel === "payer-action") || (o.data?.links || []).find(l => l.rel === "approve");
        if (!o.ok || !o.data?.id || !link?.href) {
          console.error("PayPal crear orden:", o.status, JSON.stringify(o.data).slice(0, 300));
          result = { ok: false, error: "paypal_error" }; break;
        }
        await cerrarCobroUSA(sb, cobroPP, { paypalOrderId: o.data.id, pagoLink: link.href, numeroPedidoUSA: numeroPP || "", reservaExpiraEn: new Date(Date.now() + RESERVA_PAYPAL_CHECKOUT_MS).toISOString() });
        result = { ok: true, orderId: o.data.id, urlAprobar: link.href, numeroPedido: numeroPP, total: montoPP };
      } catch (ePP) {
        console.error("PayPal crear orden error:", ePP);
        result = { ok: false, error: "paypal_error" };
      }
      break;
    }

    // El cliente volvió de PayPal tras aprobar: se cobra de verdad (captura) y el pedido queda pagado.
    // Idempotente — si ya estaba capturado (otra pestaña, el webhook) solo confirma el estado.
    case "CAPTURAR_ORDEN_PAYPAL": {
      if (!paypalConfigurado(env)) { result = { ok: false, error: "paypal_no_configurado" }; break; }
      const pid = String(d.pedidoId || ""), oid = String(d.orderId || "");
      if (!RE_PEDIDO_USA.test(pid) || !RE_PAYPAL_ORDER.test(oid)) { result = { ok: false, error: "pedido_invalido" }; break; }
      const lds = (await sb.query("leads", "pedidoId", "eq", pid)).filter(l => l.pais === "US");
      if (!lds.length || !lds.some(l => l.paypalOrderId === oid)) { result = { ok: false, error: "orden_no_coincide" }; break; }
      if (lds.every(l => l.pagadoUSA)) { result = { ok: true, estado: "pagado", numero: lds.find(l => l.numeroPedidoUSA)?.numeroPedidoUSA || "" }; break; }
      try {
        let cap = null;
        const c = await paypalApi(env, "POST", `/v2/checkout/orders/${oid}/capture`, {}, "cap-" + oid);
        if (c.ok && c.data?.status === "COMPLETED") cap = paypalCapturaDe(c.data);
        else {
          // ¿ya estaba capturada? (doble clic, otra pestaña) — se consulta el estado real de la orden
          const g = await paypalApi(env, "GET", `/v2/checkout/orders/${oid}`);
          if (g.ok && g.data?.status === "COMPLETED") cap = paypalCapturaDe(g.data);
          else if (g.ok && (g.data?.status === "APPROVED" || g.data?.status === "PAYER_ACTION_REQUIRED" || g.data?.status === "CREATED")) { result = { ok: true, estado: "pendiente" }; break; }
          else { console.error("PayPal capturar:", c.status, JSON.stringify(c.data).slice(0, 300)); result = { ok: false, error: "no_se_pudo_cobrar" }; break; }
        }
        if (!cap) { result = { ok: true, estado: "pendiente" }; break; }
        if (!montoCoincide(lds, cap)) {
          await avisarAdminUSA(env, `⚠️ PayPal: el monto cobrado no coincide — ${pid}`, `<p>PayPal cobró <b>${cap.amount?.value} ${cap.amount?.currency_code}</b> en el pedido <b>${pid}</b>, pero el total registrado es <b>${lds.find(l => l.totalPedidoUSD != null)?.totalPedidoUSD}</b>. No se marcó como pagado: revísalo en PayPal.</p>`);
          result = { ok: false, error: "monto_distinto" }; break;
        }
        await confirmarPagoPedidoUSA(env, sb, pid, { metodo: "paypal", idTransaccion: cap.id, extra: { paypalCaptureId: cap.id, paypalOrderId: oid } });
        result = { ok: true, estado: "pagado", numero: lds.find(l => l.numeroPedidoUSA)?.numeroPedidoUSA || "" };
      } catch (eCap) {
        console.error("PayPal capturar error:", eCap);
        result = { ok: false, error: "paypal_error" };
      }
      break;
    }

    // Reembolso total de un pedido USA pagado por PayPal (solo admin): devuelve el dinero, cancela el pedido y libera el stock.
    // Paso 1 del reembolso: valida que se pueda reembolsar y manda un código de 6 dígitos por correo (y WhatsApp si hay).
    case "SOLICITAR_CODIGO_REEMBOLSO": {
      if (!esAdmin) return forbidden();
      const pid = String(d.pedidoId || "");
      const lds = RE_PEDIDO_USA.test(pid) ? (await sb.query("leads", "pedidoId", "eq", pid)).filter(l => l.pais === "US") : [];
      if (!lds.length) { result = { ok: false, error: "pedido_no_encontrado" }; break; }
      if (lds.every(l => l.reembolsadoUSA)) { result = { ok: false, error: "ya_reembolsado" }; break; }
      if (!lds.some(l => l.pagadoUSA) || !lds.find(l => l.paypalCaptureId)) { result = { ok: false, error: "no_reembolsable_por_aqui" }; break; }
      if (lds.some(l => l.trackingDHL || l.entregadoUSA)) { result = { ok: false, error: "ya_enviado" }; break; }
      const previo = await sb.get("config", "otp_reemb_" + pid);
      if (previo && previo.creado && Date.now() - previo.creado < 30000) { result = { ok: false, error: "espera_un_momento" }; break; }
      const codigo = codigoAleatorio6();
      await sb.set("config", "otp_reemb_" + pid, { hash: await huellaCodigoReembolso(env, pid, codigo), exp: Date.now() + OTP_REEMB_VIGENCIA_MS, intentos: 0, creado: Date.now() });
      const total = lds.find(l => l.totalPedidoUSD != null)?.totalPedidoUSD;
      const envio = await enviarCodigoReembolso(env, lds.find(l => l.numeroPedidoUSA)?.numeroPedidoUSA || pid, total, codigo);
      if (!envio.ok) {
        try { await sb.delete("config", "otp_reemb_" + pid); } catch (_) {}   // sin envío no queda ningún código activo
        result = { ok: false, error: envio.motivo };
        break;
      }
      result = { ok: true, venceEnMin: OTP_REEMB_VIGENCIA_MS / 60000, canales: envio.canales, destino: envio.destino };
      break;
    }

    case "REEMBOLSAR_PEDIDO_USA": {
      if (!esAdmin) return forbidden();
      if (!paypalConfigurado(env)) { result = { ok: false, error: "paypal_no_configurado" }; break; }
      const pid = String(d.pedidoId || "");
      const lds = (await sb.query("leads", "pedidoId", "eq", pid)).filter(l => l.pais === "US");
      const capId = lds.find(l => l.paypalCaptureId)?.paypalCaptureId;
      if (!lds.length) { result = { ok: false, error: "pedido_no_encontrado" }; break; }
      if (lds.every(l => l.reembolsadoUSA)) { result = { ok: false, error: "ya_reembolsado" }; break; }
      if (!lds.some(l => l.pagadoUSA) || !capId) { result = { ok: false, error: "no_reembolsable_por_aqui" }; break; }   // tarjeta (Wompi) o sin pago: se hace aparte
      // Política: una vez enviado el paquete (tiene tracking) o entregado, ya no se reembolsa ni se libera stock desde aquí.
      // Si algún día hay que hacer una excepción, se hace directamente en PayPal (el webhook lo marca como reembolsado).
      if (lds.some(l => l.trackingDHL || l.entregadoUSA)) { result = { ok: false, error: "ya_enviado" }; break; }
      // Segundo paso: el código de un solo uso que llegó por correo/WhatsApp (ver SOLICITAR_CODIGO_REEMBOLSO)
      const codigoIngresado = String(d.codigo || "").trim();
      if (!/^\d{6}$/.test(codigoIngresado)) { result = { ok: false, error: "codigo_requerido" }; break; }
      const otp = await sb.get("config", "otp_reemb_" + pid);
      if (!otp || !otp.hash) { result = { ok: false, error: "codigo_invalido" }; break; }
      if (Date.now() > otp.exp) { await sb.delete("config", "otp_reemb_" + pid).catch(() => {}); result = { ok: false, error: "codigo_vencido" }; break; }
      if ((otp.intentos || 0) >= OTP_REEMB_MAX_INTENTOS) { result = { ok: false, error: "demasiados_intentos" }; break; }
      if (!safeEq(otp.hash, await huellaCodigoReembolso(env, pid, codigoIngresado))) {
        const n = (otp.intentos || 0) + 1;
        await sb.update("config", "otp_reemb_" + pid, { intentos: n });
        result = { ok: false, error: n >= OTP_REEMB_MAX_INTENTOS ? "demasiados_intentos" : "codigo_invalido", intentosRestantes: Math.max(0, OTP_REEMB_MAX_INTENTOS - n) };
        break;
      }
      await sb.delete("config", "otp_reemb_" + pid).catch(() => {});   // se gasta: un solo uso
      try {
        const rf = await paypalApi(env, "POST", `/v2/payments/captures/${capId}/refund`, { note_to_payer: "VEREX Store refund" }, "refund-" + capId);
        if (!rf.ok || !["COMPLETED", "PENDING"].includes(rf.data?.status)) {
          console.error("PayPal reembolso:", rf.status, JSON.stringify(rf.data).slice(0, 300));
          result = { ok: false, error: "paypal_error", detalle: String(rf.data?.message || rf.data?.name || "").slice(0, 160) }; break;
        }
        for (const l of lds) {
          const patch = { reembolsadoUSA: true, paypalReembolsoId: rf.data.id || "" };
          if (!l.entregadoUSA && l.estado !== "cancelado") {
            if (l.reservaDescTienda || l.reservaDescBodega) { try { await sb.liberar(l.codigo, l.reservaDescTienda || 0, l.reservaDescBodega || 0); } catch (eLib) { console.error("Reembolso: error liberando " + l.codigo, eLib); } }
            patch.estado = "cancelado"; patch.reservaDescTienda = 0; patch.reservaDescBodega = 0; patch.reservaExpiraEn = null;
            patch.historial = [...(l.historial || []), { estado: "cancelado", fecha: new Date().toISOString(), motivo: "Reembolsado por PayPal" }];
          }
          await sb.update("leads", l.id, patch);
        }
        result = { ok: true, reembolsoId: rf.data.id || "", estado: rf.data.status };
      } catch (eRf) {
        console.error("PayPal reembolso error:", eRf);
        result = { ok: false, error: "paypal_error" };
      }
      break;
    }

    // Diagnóstico de PayPal (solo admin): comprueba que las claves existan y que PayPal las acepte. No revela ningún valor.
    case "PROBAR_PAYPAL": {
      if (!esAdmin) return forbidden();
      const info = { tieneClientId: !!env.PAYPAL_CLIENT_ID, tieneSecret: !!env.PAYPAL_SECRET, tieneWebhookId: !!env.PAYPAL_WEBHOOK_ID, entorno: env.PAYPAL_ENV === "live" ? "live" : "sandbox",
        // Nunca se devuelve el valor tal cual (por si alguien pegó ahí una clave por error): solo si es válido o no.
        entornoDefinido: env.PAYPAL_ENV === "live" ? "live" : env.PAYPAL_ENV === "sandbox" ? "sandbox" : (env.PAYPAL_ENV ? "valor_invalido" : "") };
      if (!info.tieneClientId || !info.tieneSecret) { result = { ok: false, ...info, motivo: "faltan_claves" }; break; }
      try {
        _ppTokenCache.clear();
        await paypalToken(env);
        result = { ok: true, ...info };
      } catch (ePP) {
        result = { ok: false, ...info, motivo: "paypal_rechazo", detalle: String(ePP && ePP.message || ePP).slice(0, 200) };
      }
      break;
    }

    case "ACTUALIZAR_LEAD_USA": {
      if (!esAdmin) return forbidden();
      if (!d.id) { result = { ok: false, error: "Falta el id del pedido" }; break; }
      const leadUSA = await sb.get("leads", d.id);
      if (!leadUSA) { result = { ok: false, error: "Lead no encontrado" }; break; }
      const patch = {};
      if (d.pagadoUSA !== undefined) patch.pagadoUSA = !!d.pagadoUSA;
      if (d.trackingDHL !== undefined) patch.trackingDHL = String(d.trackingDHL || "").trim();
      if (d.notasUSA !== undefined) patch.notasUSA = String(d.notasUSA || "").trim();
      if (d.entregadoUSA !== undefined) patch.entregadoUSA = !!d.entregadoUSA;
      // Lo que costó de verdad el envío DHL de este pedido (Rentabilidad). null/"" = usar la tarifa fija de los ajustes.
      if (d.dhlRealUSA !== undefined) {
        const v = d.dhlRealUSA === null || d.dhlRealUSA === "" ? null : Math.round(parseFloat(d.dhlRealUSA) * 100) / 100;
        if (v !== null && !(v >= 0 && v < 10000)) { result = { ok: false, error: "Costo de envío inválido" }; break; }
        patch.dhlRealUSA = v;
      }

      // La reserva normalmente ya se hizo en REGISTRAR_LEAD, al momento del
      // pedido — acá solo se confirma (deja de poder vencer sola). Un lead
      // de antes de este cambio, que nunca llegó a reservar nada, se
      // reserva recién ahora como respaldo.
      if (patch.pagadoUSA === true && !leadUSA.pagadoUSA) {
        if (!leadUSA.reservaDescTienda && !leadUSA.reservaDescBodega) {
          let resPago;
          try { resPago = await sb.reservar(leadUSA.codigo, leadUSA.qty || 1); }
          catch (ePago) { result = { ok: false, error: "No se pudo verificar el stock: " + ePago.message }; break; }
          if (!resPago.ok) { result = { ok: false, error: "Sin stock disponible para confirmar este pago" }; break; }
          patch.reservaDescTienda = resPago.desc_tienda || 0;
          patch.reservaDescBodega = resPago.desc_bodega || 0;
        }
        patch.reservaExpiraEn = null;
        // Si la reserva ya había vencido y el lead quedó "cancelado", este
        // pago lo reactiva (ya se volvió a reservar arriba) — si no, el
        // pedido pagado seguía figurando como cancelado.
        if (leadUSA.estado === "cancelado") {
          patch.estado = "interesado";
          patch.historial = [...(leadUSA.historial || []), { estado: "interesado", fecha: new Date().toISOString(), motivo: "Pago confirmado tras vencer la reserva" }];
        }
      }
      // "Marcar entregado" cierra la venta: pasa de reservado a vendido —
      // mismo criterio que CONFIRMAR_LEAD_ENTREGA. Solo si de verdad
      // había stock reservado para este pedido (se marcó pagado antes,
      // como exige el orden del panel).
      if (patch.entregadoUSA === true && !leadUSA.entregadoUSA && (leadUSA.pagadoUSA || patch.pagadoUSA)) {
        const sEntrega = await sb.get("stock", leadUSA.codigo);
        const qtyEntrega = Math.max(1, parseInt(leadUSA.qty) || 1); // antes se descontaba siempre 1, aunque el pedido fuera de 2 o más
        if (sEntrega) {
          await sb.update("stock", leadUSA.codigo, {
            stock_reservado: Math.max(0, (parseInt(sEntrega.stock_reservado)||0) - qtyEntrega),
            stock_vendido:   (parseInt(sEntrega.stock_vendido)||0) + qtyEntrega
          });
        }
      }

      // Reembolso hecho fuera del panel (PayPal.me, Wompi, etc.): solo deja constancia.
      // No toca dinero ni stock. Solo para pedidos cancelados, pagados y sin captura de PayPal Checkout
      // (esos se reembolsan desde el panel con código).
      if (d.reembolsadoManual === true) {
        if (!leadUSA.pagadoUSA || leadUSA.estado !== "cancelado" || leadUSA.paypalCaptureId || leadUSA.reembolsadoUSA) {
          result = { ok: false, error: "No se puede marcar como reembolsado este pedido" }; break;
        }
        patch.reembolsadoUSA = true;
        patch.reembolsoManual = true;
        patch.historial = [...(leadUSA.historial || []), { estado: "cancelado", fecha: new Date().toISOString(), motivo: "Reembolso hecho aparte (marcado manualmente)" }];
      }
      await sb.update("leads", d.id, patch);
      if (patch.pagadoUSA === true && !leadUSA.pagadoUSA) {
        await enviarCorreoPagoConfirmadoUSA(env, sb, leadUSA.pedidoId);
      }
      // Primer tracking de DHL de un pedido pagado → aviso de envío al cliente.
      if (patch.trackingDHL && !leadUSA.trackingDHL && (leadUSA.pagadoUSA || patch.pagadoUSA)) {
        await enviarCorreoEnvioUSA(env, sb, leadUSA, patch.trackingDHL);
      }
      result = { ok: true };
      break;
    }

    // Borra del panel de Logística USA los pedidos CANCELADOS que ya no deben cobrarse ni devolverse (pruebas, reservas vencidas).
    // Seguro: no toca stock; omite lo que tenga reserva activa, entrega, o dinero cobrado sin reembolsar (esos se resuelven antes).
    case "ELIMINAR_CANCELADOS_USA": {
      if (!esAdmin) return forbidden();
      const pids = Array.isArray(d.pedidoIds) ? d.pedidoIds.map(String).slice(0, 200) : [];
      let borrados = 0; const omitidos = [];
      for (const pid of pids) {
        const lds = (await sb.query("leads", "pedidoId", "eq", pid)).filter(l => l.pais === "US");
        const ok = lds.length && lds.every(l => l.estado === "cancelado" && !l.entregadoUSA && !l.reservaDescTienda && !l.reservaDescBodega
          && (!l.pagadoUSA || l.reembolsadoUSA));
        if (!ok) { omitidos.push(pid); continue; }
        for (const l of lds) await sb.delete("leads", l.id);
        borrados++;
      }
      result = { ok: true, borrados, omitidos };
      break;
    }

    // ── Rentabilidad USA (Logística USA del admin) ──
    // Ajustes (tarifa DHL fija, comisión de pago, empaque) + costo de cada pieza, por código. Solo admin:
    // el costo nunca sale en GET_CATALOGO ni en GET_STOCK público (lista blanca de campos).
    case "RENTABILIDAD_USA_DATOS": {
      if (!esAdmin) return forbidden();
      const [cfgR, stockR] = await Promise.all([sb.get("config", "settings"), sb.getAll("stock")]);
      const costos = {};
      for (const x of stockR) {
        const c = parseFloat(x.costo);
        if (x.costo !== undefined && x.costo !== null && x.costo !== "" && c >= 0) costos[String(x.codigo || x.id).toUpperCase()] = c;
      }
      result = { ok: true, ajustes: (cfgR && cfgR.rentabilidadUSA) || null, costos };
      break;
    }

    // Registra, sin datos personales, lo que los clientes buscan y no encuentran
    // ("sin_resultados"), lo que piden que se les consiga ("pedido_cliente") y las
    // preguntas que el asistente no pudo responder ("pregunta"). Solo lo llaman las
    // Pages Functions de verex-catalogo-us, con el secreto interno compartido
    // (INTERNAL_SECRET, el mismo valor en el Worker y en ese proyecto de Pages).
    // Se agrega por mes en config/ia_demanda_AAAA-MM (máx. 400 entradas por mes).
    case "IA_DEMANDA_REGISTRAR": {
      if (!env.INTERNAL_SECRET || !safeEq(request.headers.get("X-Verex-Internal") || "", env.INTERNAL_SECRET)) return forbidden();
      const limpiarIA = (v, n) => String(v || "")
        .replace(/[\u0000-\u001f<>]/g, " ")
        .replace(/\S+@\S+\.\S+/g, "[correo]")                  // nunca guardar correos ni teléfonos
        .replace(/\+?\d[\d\s().-]{6,}\d/g, "[teléfono]")
        .replace(/\s+/g, " ").trim().slice(0, n);
      const tipoIA = ["sin_resultados", "pedido_cliente", "pregunta"].includes(d.tipo) ? d.tipo : "sin_resultados";
      const claveIA = limpiarIA(d.clave, 90).toLowerCase();
      if (!claveIA) { result = { ok: false, error: "clave vacía" }; break; }
      const mesIA = new Date().toISOString().slice(0, 7);
      const docIdIA = `ia_demanda_${mesIA}`;
      const docIA = (await sb.get("config", docIdIA)) || { mes: mesIA, items: {} };
      docIA.items = docIA.items || {};
      const kIA = `${tipoIA === "pregunta" ? "p" : "b"}:${claveIA}`;
      const itIA = docIA.items[kIA] || { tipo: tipoIA === "pregunta" ? "pregunta" : "producto", descripcion: limpiarIA(d.descripcion || d.clave, 140), veces: 0, pedidos: 0, ejemplos: [], idiomas: {} };
      if (tipoIA === "pedido_cliente") itIA.pedidos = (itIA.pedidos || 0) + 1; else itIA.veces = (itIA.veces || 0) + 1;
      itIA.ultima = new Date().toISOString();
      const ejIA = limpiarIA(d.consulta, 160);
      if (ejIA && !itIA.ejemplos.includes(ejIA)) itIA.ejemplos = [ejIA, ...itIA.ejemplos].slice(0, 3);
      const langIA = d.idioma === "es" ? "es" : "en";
      itIA.idiomas[langIA] = (itIA.idiomas[langIA] || 0) + 1;
      docIA.items[kIA] = itIA;
      const clavesIA = Object.keys(docIA.items);
      if (clavesIA.length > 400) {
        clavesIA.sort((a, b) => ((docIA.items[a].pedidos || 0) * 3 + (docIA.items[a].veces || 0)) - ((docIA.items[b].pedidos || 0) * 3 + (docIA.items[b].veces || 0)))
          .slice(0, clavesIA.length - 400).forEach(k => delete docIA.items[k]);
      }
      await sb.set("config", docIdIA, docIA);
      result = { ok: true };
      break;
    }

    // Reporte para Admin VEREX: lo más buscado sin resultado, lo más pedido y las preguntas sin respuesta.
    case "IA_DEMANDA_LISTAR": {
      if (!esAdmin) return forbidden();
      const mesesIA = Math.min(Math.max(parseInt(d.meses, 10) || 1, 1), 6);
      const ahoraIA = new Date();
      const idsIA = [];
      for (let i = 0; i < mesesIA; i++) {
        const f = new Date(Date.UTC(ahoraIA.getUTCFullYear(), ahoraIA.getUTCMonth() - i, 1));
        idsIA.push(`ia_demanda_${f.toISOString().slice(0, 7)}`);
      }
      const docsIA = await Promise.all(idsIA.map(id => sb.get("config", id).catch(() => null)));
      const juntosIA = {};
      for (const doc of docsIA) {
        for (const [k, it] of Object.entries((doc && doc.items) || {})) {
          const acc = juntosIA[k] || (juntosIA[k] = { tipo: it.tipo, descripcion: it.descripcion, veces: 0, pedidos: 0, ejemplos: [], idiomas: {}, ultima: "" });
          acc.veces += it.veces || 0;
          acc.pedidos += it.pedidos || 0;
          for (const e of it.ejemplos || []) if (!acc.ejemplos.includes(e) && acc.ejemplos.length < 3) acc.ejemplos.push(e);
          for (const [l, n] of Object.entries(it.idiomas || {})) acc.idiomas[l] = (acc.idiomas[l] || 0) + n;
          if ((it.ultima || "") > acc.ultima) acc.ultima = it.ultima;
        }
      }
      const listaIA = Object.values(juntosIA).sort((a, b) => (b.pedidos * 3 + b.veces) - (a.pedidos * 3 + a.veces));
      result = {
        ok: true, meses: mesesIA,
        productos: listaIA.filter(x => x.tipo !== "pregunta").slice(0, 100),
        preguntas: listaIA.filter(x => x.tipo === "pregunta").slice(0, 50),
      };
      break;
    }

    default:
      return NO_MANEJADA;
  }
  return result;
}
