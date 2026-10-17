// Datos públicos: qué campos del stock y de la configuración se pueden mostrar
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.

// El documento config/settings guarda, junto a ajustes públicos del catálogo
// (fraseConfianza, limiteCatalogo, rotación), las credenciales del propio
// login de admin: passHash, otp/otpExp (2FA por Telegram) y ssoTokens. Varias
// acciones devuelven ese documento COMPLETO a quien las llame — GET_CONFIG,
// GET_CATALOGO y GET_STOCK no piden contraseña, y la ruta pública "/" tampoco.
// Sin este filtro, cualquiera obtenía passHash con una sola petición sin
// autenticarse, y ese mismo hash es aceptado como contraseña válida en
// verificarPassword() — bypaseaba contraseña + OTP + SSO por completo.
// Campos de un producto que pueden salir en respuestas públicas (GET_STOCK sin contraseña).
export const CAMPOS_STOCK_PUBLICOS = ["id", "codigo", "codigoBase", "talla", "nombre", "nombre_base", "nombreEN", "categoria",
  "material", "precio", "precio_caballero", "set_config", "foto", "fotoMejorada", "img", "descripcion", "descripcionTienda",
  "descripcionTiendaEN", "caracterEspecial", "estado", "enCatalogo", "destacado", "fechaRegistro", "reservado",
  "stock_tienda", "stock_bodega"];

export function stockPublico(p) {
  const o = {};
  for (const k of CAMPOS_STOCK_PUBLICOS) if (p[k] !== undefined) o[k] = p[k];
  return o;
}

// Texto que llega de páginas públicas y termina en correos o en pantallas del admin: sin etiquetas HTML y con tope.
export function sinHtml(v, max = 300) { return String(v ?? "").replace(/[<>]/g, "").slice(0, max); }

export function limpiarTextoPublico(d, campos) { for (const c of campos) if (d[c] != null) d[c] = sinHtml(d[c], c === "productos" ? 2000 : 300); }

export function sanearConfigPublico(cfg) {
  if (!cfg || typeof cfg !== "object") return {};
  // rentabilidadUSA (tarifa DHL, comisión de pago, empaque) es información interna del negocio: solo la lee el admin.
  const { passHash, otp, otpExp, ssoTokens, rentabilidadUSA, totpSecret, ...publico } = cfg;
  // Red de seguridad: ninguna clave con pinta de credencial sale en respuestas públicas.
  for (const k of Object.keys(publico)) if (/secret|token|hash|otp|pass|clave|key/i.test(k)) delete publico[k];
  return publico;
}
