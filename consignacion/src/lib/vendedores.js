// Vendedores: validación de token y fecha real del corte
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
import { pinIncorrecto } from "./auth.js";
import { safeEq } from "./seguridad.js";

// ── CORTE DEL VENDEDOR: FECHA REAL ────────────────────────────────
// El corte vence 30 días después del último corte (fechaCorte) — SALVO que el
// admin haya fijado a mano la fecha del próximo corte (proximoCorte,
// "AAAA-MM-DD"): esa manda. Sirve para vendedores que aún no han hecho ningún
// corte y no tienen fechaCorte. NO se guarda como fechaCorte a propósito: la
// página del vendedor usa fechaCorte para decidir qué piezas le muestra
// (oculta lo entregado antes), así que falsearla le escondería inventario.
// Se borra al cerrar un corte real (CERRAR_CORTE).
export const RE_FECHA_CORTE = /^\d{4}-\d{2}-\d{2}$/;

// Días que faltan (null si no hay una fecha real). El Salvador es UTC-6, sin cambio de hora.
export function diasParaCorteVend(v) {
  if (v.proximoCorte && RE_FECHA_CORTE.test(v.proximoCorte)) {
    const hoySV = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);
    return Math.round((Date.parse(v.proximoCorte) - Date.parse(hoySV)) / 86400000);
  }
  if (v.fechaCorte) {
    const venc = new Date(v.fechaCorte);
    venc.setDate(venc.getDate() + 30);
    return Math.ceil((venc - Date.now()) / 86400000);
  }
  return null;
}

// ¿Ya pasó la fecha del corte? Con fecha fijada, el link sirve todo ese día.
export function corteVencido(v) {
  if (v.proximoCorte && RE_FECHA_CORTE.test(v.proximoCorte)) {
    return Date.now() > Date.parse(v.proximoCorte + "T23:59:59-06:00");
  }
  if (v.fechaCorte) return (Date.now() - new Date(v.fechaCorte).getTime()) / (1000 * 60 * 60 * 24) > 30;
  return false;
}

// Valida que quien llama sea REALMENTE el vendedor que dice ser — mismo
// chequeo de tokenInventario+PIN que ya hace GET_INVENTARIO_VENDEDOR/
// VERIFICAR_TOKEN. Varias acciones de Inventario de Vendedores (ver ventas,
// entregas pendientes, registrar una venta) solo pedían el código del
// vendedor (no es secreto — aparece en su propio link) y confiaban en él
// sin volver a pedir el token — cualquiera podía leer o alterar el
// inventario/ventas de un vendedor ajeno con solo saber su código.
export async function validarVendedorToken(sb, vendedor, token, pin) {
  if (!vendedor || !token) return { ok: false, error: "vendedor y token requeridos" };
  const vend = await sb.get("vendedores", vendedor);
  if (!vend || !vend.tokenInventario || !safeEq(vend.tokenInventario, token)) {
    return { ok: false, error: "Token inválido" };
  }
  if (await pinIncorrecto(sb, vend, pin, vendedor)) {
    return { ok: false, error: "PIN incorrecto" };
  }
  return { ok: true, vend };
}
