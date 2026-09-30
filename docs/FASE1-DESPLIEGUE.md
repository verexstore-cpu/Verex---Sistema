# Fase 1 (enfoque A) — qué cambió y cómo desplegarlo

> **ESTADO FINAL: completada y desplegada.** Worker en producción (verex-consignacion `main`, commits a41b221 y fd9551e), Functions en `admin-tienda`, `INTERNAL_SECRET` definido en ambos sitios y pruebas manuales de login (Admin y Consignación con TOTP, acción de catálogo, vendedor con PIN) confirmadas por el propietario.
> **Pendiente opcional:** activar `ALLOWED_ORIGINS` (CORS restringido). Se probó una vez y falló por un valor mal pegado (catálogo USA); el Worker ya tolera barra final, mayúsculas, comillas y separadores. Reactivar con la lista de la sección CORS y probar cada página con la consola abierta.
> **Fase 2 (Cloudflare):** MFA de la cuenta, Bot Fight Mode, Always Use HTTPS, HSTS (6 meses, sin subdominios ni preload), regla contra escáneres (Managed Challenge) y DMARC Management activados. Pendiente: revisar informes DMARC en 2–3 semanas y subir a `p=quarantine`.

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

## Estado del despliegue (actualizado)
| Pieza | Estado |
|---|---|
| Functions en repo `admin-tienda` (`main`, commit a6d2cfc) | **Subidas.** No cambian el comportamiento hasta que exista `INTERNAL_SECRET` |
| Worker en repo `verex-consignacion`, rama **`fase1-seguridad`** (commit a41b221) | **Preparado, NO en `main`.** Un push a `main` lo despliega solo a producción (Action `deploy-worker.yml`) |
| Secreto `INTERNAL_SECRET` | **Pendiente (manual):** requiere el panel de Cloudflare |

## Lo que falta (orden)
1. **Elegir un secreto largo** (p. ej. `openssl rand -hex 32`, o el generador del panel). No lo compartas por chat.
2. **Worker:** Cloudflare → Workers & Pages → `verex-api` → Settings → Variables and Secrets → Add → tipo **Secret**, nombre `INTERNAL_SECRET`. (Los secretos del panel se conservan en cada despliegue.)
3. **Solo si `admin-tienda` corre en Cloudflare Pages** (las Functions no se ejecutan en GitHub Pages, que es lo que publica el workflow del repo): en ese proyecto → Settings → Variables and Secrets → `INTERNAL_SECRET` = **el mismo valor**. Si no existe proyecto de Cloudflare Pages, se omite este paso: las Functions no están en uso.
4. **Desplegar el Worker:** fusionar `fase1-seguridad` en `main` de `verex-consignacion` (o pedírselo a Claude). El Action lo despliega.
5. **Verificar:** login en Admin y Consignación (con TOTP), una acción de catálogo y el acceso de un vendedor con PIN. Rollback: `npx wrangler rollback` o revertir el commit en `main`.

> Si el Worker se despliega **sin** `INTERNAL_SECRET` y las Functions están en uso, se ven como una IP compartida: 5 contraseñas malas enviadas a una Function pública bloquearían a las demás llamadas de Functions durante 15 min.

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

## Nota posterior: devoluciones en bloque
`REGISTRAR_DEVOLUCION` hacía 5 peticiones a Supabase por producto y fallaba con más de ~9 productos («Too many subrequests», límite de 50 del plan gratuito). Ahora usa lectura/escritura en bloque (~8 peticiones sin importar el número de productos), suma todo lo devuelto a `stock_bodega`, recalcula `stock_total`, es todo-o-nada e idempotente por `devId`. Pruebas: `consignacion/test-devolucion.mjs` (20). Otras acciones del Worker que recorren listas con una petición por elemento tienen el mismo riesgo con el plan gratuito.
