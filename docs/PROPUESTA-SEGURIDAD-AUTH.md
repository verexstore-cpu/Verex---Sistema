# Propuesta: endurecer autenticación del Worker `verex-api`

Estado: **borrador para aprobación — no se ha modificado código.**
Archivos involucrados: `consignacion/worker-firebase.js`, `adminverex/index (2).html`, `consignacion/index (4).html`, `adminverex/functions/_auth.js`.

## 1. Situación actual (verificada en el código)

| # | Hallazgo | Dónde |
|---|---|---|
| 1 | La contraseña del admin se guarda como SHA-256 simple, sin sal ni algoritmo lento | `hashStr`, `passHash` |
| 2 | El **hash es la credencial**: `verificarPassword` acepta `pass === cfg.passHash`; el frontend lo envía como `_pass` | `verificarPassword` |
| 3 | `_pass` viaja en **~77 llamadas** (54 en Admin, 23 en Consignación) + 12 Functions de Pages | `ADMIN_PASS`, `_sessionPass`, `_auth.js` |
| 4 | `SSO_CANJEAR_TOKEN` devuelve el hash al frontend | worker ~l.375 |
| 5 | `VERIFICAR_PASS` es público, sin límite de intentos ni bloqueo; el 2FA (TOTP) se pide **después**, así que no protege la fuerza bruta de la contraseña | worker l.309 |
| 6 | `SECRET_PASS` y PINs/tokens de vendedores se comparan en texto plano con `===` | varios |
| 7 | CORS `Access-Control-Allow-Origin: *` | worker l.20 |
| 8 | La API vive en `workers.dev`, fuera de la zona `verexstore.com` → el WAF/rate limiting de Cloudflare de la zona no la cubre | `wrangler.toml` |

Lo que ya está bien: TOTP para admin, tokens SSO de un uso (90 s), `sanearConfigPublico`, Functions de catálogo ya exigen admin.

## 2. Objetivos y restricciones

- Cerrar la fuerza bruta (hallazgo 5) **sin romper** Admin, Consignación, Inventario ni el Hub.
- El Worker se despliega a mano (`npx wrangler deploy`); los frontends se despliegan por push. Durante el cambio **Worker nuevo y frontends viejos deben coexistir**.
- Sin Workers KV ni Durable Objects hoy en `wrangler.toml`; el estado vive en Supabase.

## 3. Enfoques

### A — Parche mínimo, compatible hacia atrás (recomendado como primer paso)
1. **Límite de intentos + bloqueo** en `VERIFICAR_PASS`, `TOTP_VERIFICAR` y validación de PIN: contador por IP (`CF-Connecting-IP`) y global, guardado en Supabase `config` (ej. 5 fallos → bloqueo 15 min, con espera creciente). Respuesta genérica sin revelar cuál dato falló.
2. **Comparación en tiempo constante** para `SECRET_PASS`, hash, PIN y tokens.
3. **CORS restringido** a `verexstore.com` y los dominios de los paneles (lista blanca).
4. **Nuevo hash PBKDF2-SHA256 con sal** (≥ 210 000 iteraciones, Web Crypto) guardado junto al hash antiguo; en el siguiente login correcto se migra. El SHA-256 antiguo se sigue aceptando solo hasta migrar.

- Ventajas: no cambia el protocolo (`_pass` sigue igual) → 0 cambios en frontends; se despliega solo el Worker; reversible.
- Desventajas: el hash/credencial sigue viajando en cada petición (hallazgos 2–4 no se eliminan); PBKDF2 solo protege el almacenamiento, no el tránsito.
- Esfuerzo: bajo (~1 sesión). Riesgo: bajo-medio (bloqueo mal calibrado podría dejar fuera al admin → incluir desbloqueo por `SECRET_KEY`/manual en Supabase).

### B — Sesiones con token (elimina que la contraseña/hash viaje siempre)
Tras contraseña + TOTP, el Worker emite un **token de sesión aleatorio** (256 bits, caducidad 8–12 h, guardado como hash en Supabase). Los frontends envían ese token en lugar de `_pass`. `esAdmin` acepta sesión válida; la ruta con `_pass` queda solo para el login y se desactiva con un interruptor cuando todos migren. `SSO_CANJEAR_TOKEN` devuelve una sesión, no el hash. `_auth.js` valida sesión.

- Ventajas: un token robado caduca y se puede revocar; el hash deja de ser secreto reutilizable; cierre de sesión real.
- Desventajas: hay que tocar ~77 puntos de llamada en 2 archivos HTML enormes + Functions + Hub/SSO; requiere despliegue coordinado (Worker primero, frontends después).
- Esfuerzo: medio-alto. Riesgo: medio (regresiones en flujos raramente probados).

### C — Poner la API detrás de tu zona + reglas de Cloudflare
Publicar la API en `api.verexstore.com` (Worker Custom Domain / ruta) para que apliquen WAF, Free Managed Ruleset, Bot Fight y una regla de rate limiting nativa (`/` POST con `VERIFICAR_PASS`). Requiere cambiar la URL de la API en todos los frontends y Functions, y mantener `workers.dev` deshabilitado o restringido.

- Ventajas: defensa antes de que la petición llegue al código; sin costo en plan Free (1 regla de rate limiting).
- Desventajas: solo 1 regla de rate limiting en Free, y el Worker despacha por `accion` en el cuerpo, no por ruta → la regla no distingue el login del resto salvo que se separe el endpoint; cambio de URL en todos lados.
- Esfuerzo: medio. Riesgo: medio (caché/CORS/URL).

## 4. Recomendación

**A ahora → C en paralelo (configuración, poco código) → B después.**
- **Fase 1 (A):** cierra el riesgo más grave (fuerza bruta) con el menor cambio y sin tocar frontends.
- **Fase 2 (C):** dominio propio + Free Managed Ruleset + Bot Fight; regla de rate limiting de respaldo.
- **Fase 3 (B):** sesiones, cuando haya ventana para probar Admin y Consignación completos; luego se apaga la ruta `_pass`.

## 5. Plan de pruebas y despliegue (Fase 1)

1. Pruebas automáticas del Worker con `wrangler dev`/Miniflare: login correcto, 5 fallos → bloqueo, desbloqueo por tiempo, migración PBKDF2, aceptación del hash antiguo, CORS (origen permitido/no permitido).
2. Verificar en local Admin y Consignación contra el Worker de prueba (login, TOTP, SSO desde el Hub).
3. `npx wrangler deploy` manual; comprobar login real y rollback preparado (`wrangler rollback`).
4. Ningún frontend cambia en esta fase.

## 6. Decisiones que necesito de ti

1. ¿Apruebas empezar por el enfoque **A**? ¿O prefieres saltar directo a **B**?
2. Umbrales de bloqueo (propuesta: 5 fallos / 15 min por IP; 20 fallos / hora global).
3. Lista de dominios permitidos para CORS (verexstore.com, dominios de Admin/Consignación/Inventario/Hub).
4. ¿Cómo debe desbloquearse el admin si se bloquea a sí mismo? (propuesta: por `SECRET_KEY` o borrando el contador en Supabase).
5. Acceso a la zona de Cloudflare para la Fase 2 (o que tú apliques la configuración con mi guía).
