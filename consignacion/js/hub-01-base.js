// Hub VEREX — Base: utilidades, login (contraseña + código), sesión, SSO al Admin, sincronización
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
const API_URL  = "https://verex-api.verexstore.workers.dev/";
const BASE_URL = window.location.href.split('?')[0];

// Pase de sesión que entrega el Worker al entrar con contraseña + código (vence a
// las 8 h). Va en _pass de cada petición. La contraseña no se guarda en ningún lado
// (antes el Hub la comparaba contra un hash fijo en este archivo y la guardaba en
// texto plano en el navegador).
let _sessionPass = null;
let _loginHashTemp = "";

async function hashStr(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function sanitizar(str) {
    return String(str ?? "")
        .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function jsArg(val) {
    return JSON.stringify(String(val ?? "")).replace(/"/g,"&quot;");
}

function jsArgArr(arr) {
    return JSON.stringify(arr || []).replace(/"/g,"&quot;");
}

function safeParseJSON(str, fallback) {
    if (str == null) return fallback;
    try {
        const r = JSON.parse(str);
        // Si el resultado es null/undefined, usar el fallback
        return r ?? fallback;
    } catch(_) { return fallback; }
}

const RANGOS_COMISION = [
    { min: 0,    max: 199.99,  pct: 25 },
    { min: 200,  max: 399.99,  pct: 30 },
    { min: 400,  max: 99999,   pct: 35 },
];

// Afiliados no manejan piezas físicas ni asumen riesgo de inventario no vendido —
// comisión más baja que consignación, pero sigue subiendo por tramos según lo vendido.
const RANGOS_COMISION_AFILIADO = [
    { min: 0,    max: 199.99,  pct: 20 },
    { min: 200,  max: 399.99,  pct: 25 },
    { min: 400,  max: 99999,   pct: 30 },
];

let vendedores   = [];
let consignacion = [];
let vendedorActual = null;
let productosDisponibles = [];
// Promo general definida en Admin (Catálogo Cliente) — se ofrece también acá
// para no tener que calcular a mano el mismo descuento en Venta Directa.
let promoGeneral = null;
let carritoEntrega = {};
let fotoBase64 = "";

// Botón 👁️ de la casilla de contraseña: mostrar / ocultar lo que se escribe.
function toggleVerPass(forzarOculta) {
    const inp = document.getElementById("inp-pass"), btn = document.getElementById("btn-ver-pass");
    if (!inp || !btn) return;
    const ver = forzarOculta ? false : inp.type === "password";
    inp.type = ver ? "text" : "password";
    btn.textContent = ver ? "🙈" : "👁️";
    btn.classList.toggle("activo", ver);
    btn.title = ver ? "Ocultar contraseña" : "Mostrar contraseña";
    btn.setAttribute("aria-label", btn.title);
    if (!forzarOculta) inp.focus();
}

// Paso 1: la contraseña la valida el servidor (no el navegador).
async function login() {
    const pass = document.getElementById("inp-pass").value;
    if (!pass) return;
    const hash = await hashStr(pass);
    const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ accion: "VERIFICAR_PASS", _pass: hash }) })
        .then(r => r.json()).catch(() => ({ ok: false, error: "red" }));
    if (res.error === "red") { toast("⚠️ Sin conexión con el servidor", "#c0392b"); return; }
    if (!res.ok) { toast(res.error ? "⚠️ " + res.error : "⚠️ Contraseña incorrecta", "#c0392b"); document.getElementById("inp-pass").value = ""; return; }
    if (!res.totpConfigurado) { toast("⚠️ Primero configura la app autenticadora entrando una vez al Admin VEREX", "#c0392b"); return; }
    _loginHashTemp = hash;
    document.getElementById("inp-pass").value = "";
    toggleVerPass(true);   // vuelve a ocultarse para la próxima vez
    document.getElementById("login-paso1").style.display = "none";
    document.getElementById("login-paso2").style.display = "block";
    document.getElementById("inp-otp").value = "";
    document.getElementById("inp-otp").focus();
}

function volverPaso1Login() {
    _loginHashTemp = "";
    document.getElementById("login-paso2").style.display = "none";
    document.getElementById("login-paso1").style.display = "block";
}

// Paso 2: código de la app autenticadora → el servidor entrega el pase de sesión.
async function verificarCodigoLogin() {
    const codigo = document.getElementById("inp-otp").value.trim();
    if (!/^\d{6}$/.test(codigo)) { toast("⚠️ El código tiene 6 dígitos", "#c0392b"); return; }
    const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ accion: "TOTP_VERIFICAR", _pass: _loginHashTemp, codigo }) })
        .then(r => r.json()).catch(() => ({ ok: false }));
    if (!res.ok || !res.sesion) {
        toast("⚠️ " + (res.error || "Código incorrecto"), "#c0392b");
        document.getElementById("inp-otp").value = "";
        return;
    }
    _loginHashTemp = "";
    localStorage.setItem("vx_consig_session", res.sesion);
    localStorage.setItem("vx_consig_session_exp", res.exp);
    entrarHub(res.sesion);
}

// Sesión guardada y vigente (solo pases de sesión: una contraseña guardada por la
// versión anterior del Hub se descarta y se pide entrar de nuevo).
function sesionHubGuardada() {
    const s = localStorage.getItem("vx_consig_session") || "";
    const exp = parseInt(localStorage.getItem("vx_consig_session_exp") || "0");
    if (!s.startsWith("vxs1.") || !(Date.now() < exp)) return null;
    return s;
}

let _vigilaSesionHub = null;
function entrarHub(pase) {
    _sessionPass = pase;
    document.getElementById("login-paso2").style.display = "none";
    document.getElementById("login-paso1").style.display = "block";
    // Al vencer la sesión (8 h) o si se cerró desde otro lado, se vuelve al login.
    clearInterval(_vigilaSesionHub);
    _vigilaSesionHub = setInterval(() => {
        if (sesionHubGuardada()) return;
        cerrarSesion();
        toast("🔒 Tu sesión venció (dura 8 horas). Vuelve a entrar.", "#c0392b");
    }, 60000);
    document.getElementById("pantalla-login").style.display = "none";
    document.getElementById("app").style.display = "block";
    cargarDatos();
    iniciarAutoSync();
    document.querySelectorAll('.menu-btn[data-color]').forEach(btn => {
        btn.style.setProperty('--mc', btn.dataset.color);
    });
}

// Abre Admin Tienda sin volver a pedir contraseña ni código de Telegram —
// el Hub ya está autenticado, así que le pide al worker un token corto de
// un solo uso (90s) y Admin lo canjea al cargar. Si algo falla, cae al
// link normal (Admin sigue pidiendo su login completo como siempre).
async function abrirAdminSSO(pagina) {
    const base = "https://admin-tienda.pages.dev/" + (pagina || "");
    try {
        const res = await fetch(API_URL, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ accion: "SSO_CREAR_TOKEN", _pass: _sessionPass })
        });
        const data = await res.json();
        if (data.ok && data.token) {
            window.open(base + (base.includes("?") ? "&" : "?") + "sso=" + encodeURIComponent(data.token), "_blank");
            return;
        }
    } catch(e) {}
    window.open(base, "_blank");
}

let _autoSyncInterval = null;
let _pausarSyncHasta  = 0; // timestamp: no sincronizar hasta esta hora
function iniciarAutoSync() {
    if (_autoSyncInterval) clearInterval(_autoSyncInterval);
    _autoSyncInterval = setInterval(async () => {
        // No sincronizar si hay un modal abierto o si hubo acción reciente
        const modalAbierto = document.querySelector('.modal-overlay.active');
        if (modalAbierto || Date.now() < _pausarSyncHasta) return;
        try {
            const res  = await fetch(API_URL, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ accion: "GET_CONSIGNACION", _pass: _sessionPass }) });
            const data = await res.json();
            vendedores           = data.vendedores   || [];
            consignacion         = data.consignacion || [];
            productosDisponibles = data.productos    || [];
            promoGeneral         = data.config?.promoGeneral || null;
            _renderBotonPromoGeneralVD(); // por si Venta Directa está abierta con productos ya en el carrito
            if (Date.now() - _linksAfiliadoTs > 300000) cargarLinksAfiliados();
            // Re-renderizar vista activa sin interrumpir al usuario
            const enPerfil = document.getElementById("pantalla-perfil")?.style.display !== "none";
            if (enPerfil && vendedorActual) {
                renderPerfilStats();
                renderInventario();
                renderVentasPerfil();
            } else {
                renderVendedores();
            }
            // Leads y pedidos de tienda cambian solos (clientes que piden): se refrescan cada ~30 s
            if (Date.now() - _pedidosTs > 30000) { await cargarLeads(); cargarPedidosTienda(); }
            renderAlertasAfiliadosHub(); // mantiene vivos los avisos de Vendedores y Pedidos
            // Indicador discreto
            const ind = document.getElementById("sync-indicator");
            if (ind) { ind.textContent = "↻ " + new Date().toLocaleTimeString('es', {hour:'2-digit',minute:'2-digit'}); }
        } catch(e) { /* silencioso */ }
    }, 10000); // cada 10 segundos
}

async function actualizarSistema() {
    const btn = document.getElementById("btn-actualizar");
    btn.textContent = "⏳ Actualizando...";
    btn.disabled = true;
    await cargarDatos();
    btn.textContent = "🔄 Actualizar";
    btn.disabled = false;
    toast("✅ Datos actualizados");
}

function cerrarSesion() {
    _sessionPass = null;
    clearInterval(_vigilaSesionHub);
    localStorage.removeItem("vx_consig_session");
    localStorage.removeItem("vx_consig_session_exp");
    if (_autoSyncInterval) { clearInterval(_autoSyncInterval); _autoSyncInterval = null; }
    document.getElementById("pantalla-login").style.display = "flex";
    document.getElementById("app").style.display = "none";
    document.getElementById("inp-pass").value = "";
    toggleVerPass(true);
}

let leadsData = [];
