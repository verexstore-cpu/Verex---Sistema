# Fase 1 (enfoque A) — qué cambió y cómo desplegarlo

**Estado: implementado y probado con Supabase simulado (34/34). NO desplegado.** El Worker se despliega a mano.

## Qué cambió
| Archivo | Cambio |
|---|---|
| `consignacion/worker-firebase.js` | Límite de intentos con bloqueo escalonado; comparación en tiempo constante (contraseña, hash, `SECRET_KEY`, PIN, tokens); límite propio para el código TOTP; CORS con lista blanca opcional; IP real reenviada por las Functions |
| `adminverex/functions/_auth.js` y 12 Functions | `esAdminValido(pass, context)`: reenvían la IP real del cliente al Worker |
| `consignacion/test-seguridad.mjs` | 34 pruebas (`node consignacion/test-seguridad.mjs`) |

### Reglas de bloqueo
| Qué | Umbral | Bloqueo |
|---|---|---|
| Login (`VERIFICAR_PASS`, TOTP_*, SSO) | 5 fallos / 15 min por IP | 15 min, el doble en cada reincidencia (máx. 24 h) |
| Acciones de admin con `_pass` o `key` erróneos | 15 fallos / 15 min por IP (tolera pestañas con clave vieja) | ídem |
| Código TOTP | 5 por IP y 10 globales / 15 min | ídem |
| PIN de vendedor (token ya válido) | 8 fallos / 15 min por vendedor | ídem |

Un acceso correcto reinicia el contador. Durante un bloqueo **ni la contraseña correcta entra**. Si Supabase falla, el límite no bloquea (fail-open). Respuesta: HTTP 429 + `Retry-After` + `{ok:false, bloqueado:true}`.
Los contadores viven en Supabase, tabla `config`, ids `rl_*`.

## Orden de despliegue (importante)
1. **Elegir un secreto largo** (p. ej. `openssl rand -hex 32`).
2. **Proyecto de Pages `admin-tienda`** → Settings → Variables and Secrets → `INTERNAL_SECRET` = ese valor (Production).
3. **Worker:** `cd consignacion && npx wrangler secret put INTERNAL_SECRET` (mismo valor).
4. `npx wrangler deploy`.
5. **Functions:** copiar `adminverex/functions/*` a `_admin-repo/functions/` y hacer push al repo `admin-tienda` (auto-deploy).
6. Verificar: login en Admin y Consignación (con TOTP), una acción de catálogo (p. ej. listar catálogos) y el acceso de un vendedor con PIN.

> Si despliegas el Worker **sin** `INTERNAL_SECRET` (o antes que las Functions), las Functions se ven como una sola IP compartida y 5 contraseñas malas enviadas a una Function pública bloquearían a las demás llamadas de Functions durante 15 min. Sigue el orden de arriba.

### CORS (opcional, activar después de probar)
Sin `ALLOWED_ORIGINS` el comportamiento es el de antes (`*`). Para restringir: `npx wrangler secret put ALLOWED_ORIGINS` con, p. ej.,
`https://verexstore.com,https://<admin>.pages.dev,https://<consignacion>.pages.dev,https://<inventario>.pages.dev,null`
(`null` = archivos locales que abre el Hub). Un origen omitido dejará de poder llamar a la API desde el navegador. CORS no sustituye la autenticación.

## Rollback y desbloqueo
- Volver atrás: `npx wrangler rollback`.
- Si te bloqueas: espera el tiempo indicado, o en Supabase borra las filas de `config` cuyo `id` empiece por `rl_`.

## Lo que NO cubre esta fase
- **Hash de contraseña (PBKDF2):** aplazado a la Fase 3. Hoy el SSO devuelve `passHash` al navegador y el panel lo usa como credencial; guardar un PBKDF2 no protegería nada mientras eso siga así. (Nota: Workers limita PBKDF2 a 100 000 iteraciones, no 210 000 como decía la propuesta.)
- **`_pass` en cada petición** y el hash como credencial: se resuelve con sesiones (Fase 3).
- **Botnets:** el límite es por IP; contra muchas IPs solo el TOTP tiene tope global. La Fase 2 (WAF/rate limiting de Cloudflare) lo complementa.
- **Sin probar en real:** solo se probó contra Supabase simulado; los HTML no cambian, pero no se ejecutaron contra el Worker desplegado.
