// Cupones: condiciones de uso
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.

// ── Cupones: condiciones de uso ──
// Lo que la tienda necesita para calcular el descuento (sin la lista de clientes ni contadores).
export function cuponPublico(c) {
  if (!c) return null;
  const { codigo, tipo, descuento, descuentoFijo, montoMinimo, descuentoMax, categorias, tienda, vence, activo } = c;
  return { codigo, tipo, descuento, descuentoFijo, montoMinimo, descuentoMax, categorias, tienda, vence, activo };
}

// Envío de El Salvador: mismas reglas que verexstore.com (config.reglasEnvio; si no hay, $2 hasta $30 y gratis desde $30).
export function envioSV(cfg, subtotal) {
  const reglas = Array.isArray(cfg && cfg.reglasEnvio) ? cfg.reglasEnvio.slice().sort((a, b) => a.min - b.min) : [];
  if (reglas.length) { const r = reglas.find(x => subtotal >= x.min && subtotal <= x.max); if (r !== undefined) return parseFloat(r.costo) || 0; }
  return subtotal >= 30 ? 0 : subtotal >= 1 ? 2 : 0;
}

// Cliente = correo (minúsculas) o, si no hay, solo los dígitos del teléfono.
export function idClienteCupon(c) {
  const v = String(c || "").trim().toLowerCase();
  if (!v) return "";
  return v.includes("@") ? v.slice(0, 120) : v.replace(/\D/g, "").slice(-15);
}

// Fecha de hoy en El Salvador (UTC−6): un cupón que vence el 31 vale todo el 31.
export function hoySV() { return new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10); }

// null = se puede usar; si no, { ok:false, error, motivo } con un motivo corto para que la tienda lo traduzca.
export function cuponNoUsable(cup, cliente, tienda) {
  if (!cup) return { ok: false, error: "Cupón no encontrado", motivo: "no_existe" };
  if (cup.activo === false || cup.activo === "false") return { ok: false, error: "Cupón inactivo", motivo: "inactivo" };
  const limite = parseInt(cup.limiteUsos) || 0;
  if (limite > 0 && (parseInt(cup.usosActuales) || 0) >= limite) return { ok: false, error: "Cupón agotado", motivo: "agotado" };
  if (cup.vence && hoySV() > cup.vence) return { ok: false, error: "Cupón vencido", motivo: "vencido" };
  if (tienda && cup.tienda && cup.tienda !== "ambas" && cup.tienda !== tienda) return { ok: false, error: "Cupón no válido en esta tienda", motivo: "otra_tienda" };
  if (cup.unoPorCliente) {
    const id = idClienteCupon(cliente);
    if (id && (cup.usadoPor || []).includes(id)) return { ok: false, error: "Ya usaste este cupón", motivo: "ya_usado" };
  }
  return null;
}
