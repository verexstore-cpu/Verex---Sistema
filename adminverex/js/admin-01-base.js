// Admin VEREX — Base: sanitización HTML, configuración, sesión (login, 2FA, SSO)
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
function toggleFabLink(force) {
    const menu = document.getElementById("fab-link-menu");
    const btn  = document.getElementById("fab-link-btn");
    const abrir = force !== undefined ? force : menu.style.display === "none";
    menu.style.display = abrir ? "flex" : "none";
    btn.style.transform = abrir ? "rotate(45deg)" : "rotate(0deg)";
    btn.textContent = abrir ? "✕" : "🔗";
}
// Cerrar el menú del FAB si se hace clic fuera de él
document.addEventListener("click", (e) => {
    const wrap = document.getElementById("fab-link-wrap");
    if (wrap && !wrap.contains(e.target)) toggleFabLink(false);
});

// ═════════════════════════════════════════════
//  SANITIZACIÓN HTML (previene XSS)
// ═════════════════════════════════════════════
// Para pasar un texto como argumento de una función dentro de onclick="…": JSON lo vuelve un string JS válido y esc()
// lo protege dentro del atributo (un nombre con comillas ya no puede salirse del atributo ni del string).
// Aviso cuando el total que mandó la tienda no coincide con el que calculó el servidor (precios del inventario,
// cupón y envío): el pedido se recibe igual, pero hay que revisarlo antes de cobrar.
function avisoTotalPedido(p) {
    const a = p && p.alertaTotal;
    if (!a) return "";
    const det = [a.precioDistinto ? "precio distinto al inventario" : "", a.cupon ? "cupón " + ({ ya_usado: "ya usado por este cliente", agotado: "agotado", vencido: "vencido", inactivo: "inactivo", no_existe: "no existe", otra_tienda: "de otra tienda" }[a.cupon] || "no válido") : ""].filter(Boolean).join(" · ");
    return `<div style="color:#b91c1c;font-size:10.5px;font-weight:700;white-space:normal;" title="Total calculado por el servidor">⚠️ Revisar: debería ser $${(parseFloat(a.esperado) || 0).toFixed(2)}${det ? " — " + esc(det) : ""}</div>`;
}
function jsAttr(v) { return esc(JSON.stringify(String(v ?? ""))); }
function esc(str) {
    return String(str ?? "")
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;")
        .replace(/'/g,"&#39;");
}

// Mensaje estándar al compartir un link de catálogo — usado tanto por el
// botón "Copiar" (copia mensaje + link, no solo la URL) como por WhatsApp,
// así se ve igual sin importar dónde se pegue.
// Copia al portapapeles y avisa. «Copiar link» copia SOLO la URL (para pegarla en el
// navegador); «Copiar mensaje» copia el saludo + URL (para pegarlo en WhatsApp).
function copiarTexto(texto, aviso) {
    const ok = () => toast(aviso, "#22c55e");
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(texto).then(ok, () => _copiarRespaldo(texto, ok));
    else _copiarRespaldo(texto, ok);
}
function _copiarRespaldo(texto, ok) {
    const ta = document.createElement("textarea");
    ta.value = texto; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); ok(); } catch (_) { prompt("Copia el texto:", texto); }
    ta.remove();
}

function mensajeCompartirCatalogo(url) {
    return "Hola!✨ Preparamos una selección especial de VEREX para ti.\nRevisa el catálogo aquí...\n" + url;
}

// ═════════════════════════════════════════════
//  CONFIG
// ═════════════════════════════════════════════
const API_URL    = "https://verex-api.verexstore.workers.dev/";
// Número oficial de WhatsApp de VEREX (mismo que aparece en los recibos:
// 7125-0725) — el catálogo de Cliente SIEMPRE debe usar este, nunca el
// número de un afiliado guardado de una sesión anterior.
const VEREX_WA_OFICIAL = "71250725";
const SECRET_KEY = "";
let   ADMIN_PASS = ""; // Pase de sesión del Worker (vence a las 8 h) — nunca la contraseña

async function sha256(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

const FRASE_CONFIANZA_DEFAULT = "🚚 Envíos a todo el país  ·  ⏱️ 1–2 días tras despacho  ·  💵 Pagas al recibir";
let cfg = {
    tiendaActiva: true,
    reglasEnvio: [{ min:0, max:49.99, costo:2 }, { min:50, max:9999, costo:0 }],
    fraseConfianza: FRASE_CONFIANZA_DEFAULT
};
let productos=[], pedidos=[], cupones=[];
let _ventasUnificadas = null; // ecommerce + venta directa, cargado por cargarVentasUnificadas()
let _cortesAfiliados  = null; // comisiones ya pagadas a afiliados sin stock, cargado por cargarVentasUnificadas()
let notifLeidas = new Set(JSON.parse(localStorage.getItem("vx_notif")||"[]"));

// ═════════════════════════════════════════════
//  AUTH + 2FA TOTP (app autenticadora)
// ═════════════════════════════════════════════
let _hashTemp = ""; // Hash temporal durante el proceso de 2FA

// Sesión guardada en este navegador: { hash: <pase de sesión>, exp, fecha }.
// "hash" conserva el nombre de antes porque Logística USA y los catálogos lo leen.
// Sin "exp" es una sesión vieja (guardaba el hash de la contraseña): vale solo hoy,
// y el Worker la acepta únicamente durante la transición.
function sesionGuardada() {
    let data = {};
    try { data = JSON.parse(localStorage.getItem("vx_sesion_dia") || "{}"); } catch(_) {}
    if (!data.hash) return null;
    if (data.exp) return Date.now() < data.exp ? data : null;
    return data.fecha === new Date().toDateString() ? data : null;
}
function sesionValidaHoy() {
    const s = sesionGuardada();
    return s ? s.hash : false;
}
function guardarSesion(pase, exp) {
    localStorage.setItem("vx_sesion_dia", JSON.stringify({ fecha: new Date().toDateString(), hash: pase, exp: exp || 0 }));
}

let _vigilaSesion = null;
function entrarConSesion(hash) {
    ADMIN_PASS = hash;
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("panel").style.display = "block";
    init();
    // Al vencer la sesión (8 h) se vuelve a pedir contraseña + código, en vez de
    // dejar el panel abierto fallando en cada acción.
    clearInterval(_vigilaSesion);
    _vigilaSesion = setInterval(() => {
        if (sesionGuardada()) return;
        clearInterval(_vigilaSesion);
        alert("🔒 Tu sesión venció (dura 8 horas). Vuelve a entrar con tu contraseña y el código.");
        logout();
    }, 60000);
}

// Botón 👁️ de la casilla de contraseña: mostrar / ocultar lo que se escribe.
function toggleVerPass(forzarOculta) {
    const inp = document.getElementById("in-pass"), btn = document.getElementById("btn-ver-pass");
    if (!inp || !btn) return;
    const ver = forzarOculta ? false : inp.type === "password";
    inp.type = ver ? "text" : "password";
    btn.textContent = ver ? "🙈" : "👁️";
    btn.classList.toggle("activo", ver);
    btn.title = ver ? "Ocultar contraseña" : "Mostrar contraseña";
    btn.setAttribute("aria-label", btn.title);
    if (!forzarOculta) inp.focus();
}

async function login() {
    const input = document.getElementById("in-pass").value;
    if (!input) return;
    const hash = await sha256(input);
    const res  = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"VERIFICAR_PASS", _pass: hash }) }).then(r=>r.json()).catch(()=>({ok:false}));
    if (res.ok) {
        _hashTemp = hash;
        toggleVerPass(true);   // vuelve a ocultarse para la próxima vez
        document.getElementById("login-paso1").style.display = "none";
        document.getElementById("login-paso2").style.display = "block";
        document.getElementById("otp-err").style.display = "none";
        if (res.totpConfigurado) {
            mostrarPasoLoginNormal();
        } else {
            await mostrarPasoConfiguracionTotp();
        }
        document.getElementById("in-otp").focus();
    } else {
        document.getElementById("login-err").style.display = "block";
        document.getElementById("in-pass").value = "";
    }
}

function mostrarPasoLoginNormal() {
    document.getElementById("totp-setup-info").style.display = "none";
    document.getElementById("totp-login-info").style.display = "block";
}

// Pide al servidor un secreto TOTP nuevo y dibuja el QR — se usa tanto en el
// primer login (todavía no hay TOTP configurado) como al reconfigurar por
// pérdida del celular.
async function mostrarPasoConfiguracionTotp() {
    document.getElementById("totp-setup-info").style.display = "block";
    document.getElementById("totp-login-info").style.display = "none";
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"TOTP_INICIAR_SETUP", _pass: _hashTemp, sesion: sesionValidaHoy() || "" }) })
        .then(r => r.json()).catch(() => ({ ok: false }));
    if (!res.ok && res.error === "ya_configurado") {
        // Solo con la contraseña ya no se puede reemplazar un código existente (si no,
        // quien robe la contraseña pondría su propio celular).
        alert("🔒 Ya hay una app autenticadora configurada.\n\nPara cambiarla necesitas una sesión abierta (por ejemplo, en otro dispositivo donde ya entraste: menú 📱 Cambiar app autenticadora).\n\nSi perdiste el celular y no tienes ninguna sesión abierta: en Supabase, tabla config, fila settings, borra el campo totpSecret y vuelve a entrar.");
        mostrarPasoLoginNormal();
        return;
    }
    if (!res.ok) { alert("⚠️ No se pudo generar el código de configuración."); return; }
    document.getElementById("totp-secret-txt").textContent = res.secret;
    const qrDiv = document.getElementById("totp-qr");
    qrDiv.innerHTML = "";
    new QRCode(qrDiv, { text: res.otpauthUrl, width: 180, height: 180 });
}

async function reconfigurarTotp() {
    if (!confirm("Esto genera un código QR nuevo y el anterior deja de servir. ¿Continuar?")) return;
    document.getElementById("otp-err").style.display = "none";
    document.getElementById("in-otp").value = "";
    await mostrarPasoConfiguracionTotp();
    document.getElementById("in-otp").focus();
}

async function verificarOTP() {
    const codigo = document.getElementById("in-otp").value.trim();
    if (codigo.length !== 6) return;
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"TOTP_VERIFICAR", _pass: _hashTemp, codigo }) }).then(r=>r.json()).catch(()=>({ok:false}));
    if (res.ok) {
        // El Worker entrega un pase de sesión de 8 h; la contraseña no se guarda.
        const pase = res.sesion || _hashTemp;
        guardarSesion(pase, res.exp);
        _hashTemp = "";
        // Venía de "Cambiar app autenticadora" con el panel ya cargado: recargar en vez de iniciarlo dos veces.
        if (_recargarTrasOTP) { location.reload(); return; }
        entrarConSesion(pase);
    } else {
        document.getElementById("otp-err").style.display = "block";
        document.getElementById("in-otp").value = "";
        document.getElementById("in-otp").focus();
    }
}

function logout() {
    localStorage.removeItem("vx_sesion_dia");
    sessionStorage.clear();
    location.reload();
}

// Cierra la sesión en TODOS los dispositivos (Admin, Hub, Logística, editor):
// útil si perdiste un celular o crees que alguien más entró.
async function cerrarTodasLasSesiones() {
    if (!confirm("¿Cerrar la sesión en TODOS los dispositivos (Admin, Hub, Logística USA)?\n\nTodos, incluido este, tendrán que volver a entrar con contraseña y código.")) return;
    const r = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"CERRAR_SESIONES", _pass: ADMIN_PASS }) }).then(x => x.json()).catch(() => ({ ok:false }));
    if (!r.ok) { alert("⚠️ No se pudo cerrar las sesiones. Intenta de nuevo."); return; }
    alert("✅ Se cerraron todas las sesiones.");
    logout();
}

// Cambiar la app autenticadora estando dentro (el Worker lo permite solo con sesión abierta).
let _recargarTrasOTP = false;
async function cambiarAppAutenticadora() {
    const pass = prompt("Para cambiar la app autenticadora, escribe tu contraseña:");
    if (!pass) return;
    _hashTemp = await sha256(pass);
    const ok = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"VERIFICAR_PASS", _pass: _hashTemp }) }).then(r => r.json()).catch(() => ({ ok:false }));
    if (!ok.ok) { alert("⚠️ Contraseña incorrecta."); _hashTemp = ""; return; }
    _recargarTrasOTP = true;
    // Mismo paso 2 del login: muestra el QR nuevo y pide el código de la app nueva.
    document.getElementById("panel").style.display = "none";
    document.getElementById("login-screen").style.display = "";
    document.getElementById("login-paso1").style.display = "none";
    document.getElementById("login-paso2").style.display = "block";
    document.getElementById("otp-err").style.display = "none";
    document.getElementById("in-otp").value = "";
    await mostrarPasoConfiguracionTotp();
    document.getElementById("in-otp").focus();
}

// SSO desde el Hub: si viene un token en la URL (?sso=...), lo canjea con
// el worker y entra directo, sin pedir contraseña ni código de Telegram —
// el Hub ya se autenticó para generarlo. Token de un solo uso, expira a
// los 90s, así que no sirve de nada si alguien lo copia después.
async function intentarSSO() {
    const params = new URLSearchParams(location.search);
    const token = params.get("sso");
    if (!token) return false;
    // Limpiar el token de la URL de inmediato para que no quede en el
    // historial del navegador ni se pueda reusar recargando la página.
    history.replaceState({}, "", location.pathname);
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ accion: "SSO_CANJEAR_TOKEN", token })
        });
        const data = await res.json();
        if (data.ok && data.hash) {
            guardarSesion(data.hash, data.exp);
            entrarConSesion(data.hash);
            return true;
        }
    } catch(e) {}
    return false;
}
