// Admin VEREX — Arranque: entrar con la sesión guardada / SSO e iniciar el panel
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// Va al final porque llama funciones de los demás archivos (en el archivo único original todas
// estaban definidas antes de que esto corriera).

// Auto-login si la sesión del día sigue válida (o si viene un token SSO del Hub)
(async function() {
    if (await intentarSSO()) return;
    const sesion = sesionGuardada();
    if (sesion) entrarConSesion(sesion.hash);
})()

// ═════════════════════════════════════════════
//  INIT
// ═════════════════════════════════════════════
if (sessionStorage.getItem("vxa")==="1") init();

actualizarNombre();
