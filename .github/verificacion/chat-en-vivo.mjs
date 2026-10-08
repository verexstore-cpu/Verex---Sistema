// Verificación EN VIVO (producción) del chat con el equipo + app VEREX Chats.
// Corre en GitHub Actions (tiene internet). No usa contraseñas: prueba el lado del cliente
// completo y que las rutas del asesor respondan y estén protegidas. Crea un chat de prueba
// marcado "PRUEBA AUTOMÁTICA" y lo cierra al final.
const US = "https://us.verexstore.com", ADMIN = "https://admin-tienda.pages.dev", WORKER = "https://verex-api.verexstore.workers.dev/";
let pass = 0, fail = 0;
const ok = (c, m, d = "") => { console.log(`${c ? "✅" : "❌"} ${m}${d ? " — " + d : ""}`); c ? pass++ : fail++; };
const get = async u => { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 VEREX-verificacion" } }); return { status: r.status, text: await r.text(), type: r.headers.get("content-type") || "" }; };
const post = async (u, body, origin = US) => { const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "User-Agent": "Mozilla/5.0 VEREX-verificacion" }, body: JSON.stringify(body) }); let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch (_) {} return { status: r.status, body: j, raw: t.slice(0, 160), headers: r.headers }; };
const mid = () => Date.now().toString(36).padStart(9, "0") + Math.random().toString(36).slice(2, 10);

console.log("── App VEREX Chats (Admin) ──");
const app = await get(`${ADMIN}/chats.html`);
ok(app.status === 200 && app.text.includes("VEREX CHATS") && app.text.includes("us.verexstore.com/api/live/agent"), "chats.html publicada", `HTTP ${app.status}`);
const sw = await get(`${ADMIN}/chats-sw.js`);
ok(sw.status === 200 && sw.text.includes("showNotification") && /javascript/.test(sw.type), "service worker de avisos publicado", `HTTP ${sw.status} ${sw.type}`);
const mf = await get(`${ADMIN}/chats.webmanifest`);
let mfj = null; try { mfj = JSON.parse(mf.text); } catch (_) {}
ok(mf.status === 200 && mfj?.name === "VEREX Chats", "manifest (instalable como app)", `HTTP ${mf.status}`);
ok((await get(`${ADMIN}/images/chats-icon-192.png`)).status === 200, "ícono de la app");

console.log("\n── Tienda USA: widget de Lyra con chat del equipo ──");
const cfg = await get(`${US}/assistant/config.js`);
ok(cfg.status === 200 && /teamChat:\s*\{\s*enabled:\s*true/.test(cfg.text), "config.js publicado con el chat del equipo activo", `HTTP ${cfg.status}`);
const tc = await get(`${US}/assistant/components/team-chat.js`);
ok(tc.status === 200 && tc.text.includes("class TeamChat"), "componente del chat del equipo publicado", `HTTP ${tc.status}`);
// La página principal puede responder 403 a servidores (protección anti-bots de Cloudflare): se distingue.
const hr = await fetch(`${US}/`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", Accept: "text/html" } });
const htext = await hr.text();
const desafio = hr.headers.get("cf-mitigated") || (hr.status === 403 && /challenge|cf-chl|Just a moment/i.test(htext) ? "challenge" : "");
console.log(`   página principal: HTTP ${hr.status} · cf-mitigated=${hr.headers.get("cf-mitigated") || "-"} · server=${hr.headers.get("server") || "-"} · ${htext.length} bytes`);
if (hr.status === 200) ok(htext.includes("assistant/main.js"), "la tienda carga a Lyra (assistant/main.js en la página)");
else ok(!!desafio, "página principal protegida por Cloudflare contra bots (los clientes reales sí la ven)", `HTTP ${hr.status} ${desafio}`);
const idx = await get(`${US}/index.html`);
console.log(`   /index.html: HTTP ${idx.status} ${idx.text.includes("assistant/main.js") ? "· incluye Lyra" : ""}`);
const main = await get(`${US}/assistant/main.js`);
ok(main.status === 200, "assistant/main.js publicado", `HTTP ${main.status}`);

console.log("\n── API del cliente (us.verexstore.com/api/live) ──");
const st = await post(`${US}/api/live/start`, { lang: "en", summary: { pregunta: "PRUEBA AUTOMÁTICA — ignorar (verificación del sistema)" } });
ok(st.status === 200 && st.body?.ok && st.body.chatId, "abrir chat con el equipo (Pages ↔ Worker conectados: INTERNAL_SECRET correcto)", `HTTP ${st.status} ${st.body?.error || st.raw}`);
if (st.body?.ok) {
  const { chatId, token } = st.body;
  const t0 = Date.now();
  const s1 = await post(`${US}/api/live/send`, { chatId, token, msgId: mid(), text: "Hi! This is an automated test. Do you have this ring in size 8? It costs $25." });
  ok(s1.status === 200 && s1.body?.ok, "el cliente envía un mensaje en inglés (se traduce y guarda)", `HTTP ${s1.status} ${s1.body?.error || ""} · ${Date.now() - t0} ms`);
  const p = await post(`${US}/api/live/poll`, { chatId, token });
  ok(p.status === 200 && p.body?.state?.status === "waiting" && p.body.msgs?.length === 1, "el cliente consulta su chat: esperando al equipo", `estado=${p.body?.state?.status} mensajes=${p.body?.msgs?.length}`);
  const bad = await post(`${US}/api/live/poll`, { chatId, token: "x".repeat(32) });
  ok(bad.status === 403, "con un token ajeno no se puede leer el chat", `HTTP ${bad.status}`);
  const cl = await post(`${US}/api/live/close`, { chatId, token });
  ok(cl.status === 200 && cl.body?.ok, "cerrar el chat de prueba", `HTTP ${cl.status}`);
}
const evil = await post(`${US}/api/live/start`, { lang: "en" }, "https://evil.example");
ok(evil.status === 403, "otro sitio no puede abrir chats", `HTTP ${evil.status}`);

console.log("\n── API del asesor (app VEREX Chats) ──");
const lg = await post(`${US}/api/live/agent/login`, { password: "contraseña-incorrecta-de-prueba", code: "000000", name: "Prueba" }, ADMIN);
ok(lg.status === 401 && lg.body?.error === "bad_password", "login: contraseña incorrecta rechazada (ruta + Worker + 2FA activos)", `HTTP ${lg.status} ${lg.body?.error || lg.raw}`);
ok(lg.headers.get("access-control-allow-origin") === ADMIN, "la app del Admin tiene permiso (CORS)", lg.headers.get("access-control-allow-origin") || "sin cabecera");
const ps = await post(`${US}/api/live/agent/chats`, {}, ADMIN);
ok(ps.status === 401, "lista de chats sin sesión: protegida", `HTTP ${ps.status}`);
const ev = await post(`${US}/api/live/agent/chats`, {}, "https://evil.example");
ok(ev.status === 403, "otro sitio no puede usar la API del asesor", `HTTP ${ev.status}`);

console.log("\n── Worker ──");
const w = await post(WORKER, { accion: "LIVE_CHATS_LISTAR" }, "https://evil.example");
ok(w.status === 403, "acciones LIVE_* del Worker exigen el secreto interno", `HTTP ${w.status}`);

console.log(`\n${pass}/${pass + fail} verificaciones correctas`);
process.exit(fail ? 1 : 0);
