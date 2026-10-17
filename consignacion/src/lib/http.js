// Respuestas HTTP y cabeceras CORS
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.

export const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json"
};

// ── HELPERS HTTP ──────────────────────────────────────────────────
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export function forbidden() {
  return json({ ok: false, error: "No autorizado" }, 403);
}

// Valor que devuelve un módulo de acciones cuando la acción no es suya.
export const NO_MANEJADA = Symbol("NO_MANEJADA");
