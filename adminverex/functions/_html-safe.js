// Escapa texto para insertarlo dentro de un atributo o texto HTML — sin esto,
// un nombre de producto, nota o parámetro de URL con comillas/ángulos rompe
// el atributo e inyecta HTML/JS arbitrario en una página pública (XSS
// almacenado si el dato viene de un catálogo guardado, reflejado si viene
// directo de la URL como en p/[codigo].js).
export function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
}

// JSON.stringify no escapa "<", así que un valor con el texto literal
// "</script>" (nombre de producto, código de la URL, etc.) cierra el tag
// <script> antes de tiempo e inyecta HTML/JS a continuación. < es una
// secuencia de escape válida dentro de un string JS, así que el navegador la
// interpreta igual como "<" sin que el parser HTML la vea como un tag.
// Recibe el JSON ya serializado (no un valor sin stringify) para no alterar
// si el llamador necesita el resultado como objeto literal o como string.
export function escapeForScript(jsonText) {
    return String(jsonText).replace(/</g, "\\u003c");
}
