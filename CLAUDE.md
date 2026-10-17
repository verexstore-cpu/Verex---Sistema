# VEREX Sistema — Instrucciones para Claude

## Contexto del Proyecto

Sistema de gestión para VEREX Store (joyería/accesorios). Incluye:
- **Admin VEREX** — panel de administración (Cloudflare Pages → `admin-tienda` repo)
- **Consignación VEREX** — gestión de vendedores y consignaciones (Cloudflare Pages → `verex-consignacion` repo)
- **Catálogo VEREX** — tienda pública en `verexstore.com` (Cloudflare Pages → `verex-catalogo` repo)
- **Inventario Sellers** — inventario para vendedores (Cloudflare Pages → `inventario-sellers` repo)
- **Worker API** — backend en Cloudflare Workers (`worker-firebase.js`) — se publica SOLO desde el repo `verex-consignacion` (rama `main`, GitHub Actions)
- **Sistema de Impresión** — generador de etiquetas Brother QL

## Stack Tecnológico

- Frontend: HTML/CSS/JS vanilla (sin frameworks)
- Backend: Cloudflare Worker (JavaScript)
- Base de datos: Supabase (PostgreSQL)
- Imágenes: ImageKit
- Deploy: Cloudflare Pages (auto desde GitHub) + Cloudflare Workers (auto desde `verex-consignacion`)

## Flujo de Deploy

```
Editar archivo local → git commit+push al repo correspondiente → Cloudflare Pages auto-despliega
Worker (worker-firebase.js) → push a `main` de verex-consignacion → GitHub Actions lo publica
```

### Repositorios de Deploy
| Carpeta local | Repo GitHub | Auto-deploy | URL |
|---|---|---|---|
| `adminverex/index (2).html` | `admin-tienda` → `_admin-repo/index.html` | ✅ Cloudflare Pages | — |
| `consignacion/index (4).html` | `verex-consignacion` → `_consig-repo/index.html` | ✅ Cloudflare Pages | — |
| `consignacion/worker-firebase.js` | `verex-consignacion` → `worker-firebase.js` | ✅ GitHub Actions (`deploy-worker.yml`) | `verex-api.verexstore.workers.dev` |
| `verex-catalogo/index.html` | `verex-catalogo` → `index.html` | ✅ Cloudflare Pages | `verexstore.com` |
| `inventario-sellers/index (5).html` | `inventario-sellers` → `_inventario-repo/index.html` | ✅ Cloudflare Pages | — |
| — (repo propio, sin copia aquí) | `verex-catalogo-us` → `index.html`, `assistant/`, `functions/` | ✅ Cloudflare Pages (+ Pages Functions `/api/*`) | `us.verexstore.com` |

**Siempre hacer push a los repos de deploy además del repo principal.**

### ⚠️ Worker: un solo origen de publicación
- El Worker `verex-api` se publica **únicamente** desde `verex-consignacion` (`worker-firebase.js` en `main`). Ese archivo es la versión oficial.
- La copia `consignacion/worker-firebase.js` de este repo es solo referencia: **no** tiene deploy automático ni `wrangler.toml` (se quitaron a propósito) y **nunca** se debe correr `npx wrangler deploy` desde aquí — publicaría una versión vieja encima de la de producción.
- Para cambiar el Worker: editar en `verex-consignacion`, push a `main`, y después copiar el archivo aquí para mantener la referencia al día.

### ⚠️ Reglas críticas del catálogo
- El archivo fuente del catálogo es **`verex-catalogo/index.html`** — es su propio repo git
- **NUNCA** editar ni copiar desde `catalogo/index (6).html.OLD_NO_USAR` — es una versión antigua abandonada
- Para cambiar el catálogo: editar `verex-catalogo/index.html` directamente y hacer `git push` dentro de `verex-catalogo/`
- Google Sheets **ya no se usa** — el catálogo lee desde Supabase via `verex-api.verexstore.workers.dev`
- El catálogo tiene diseño propio: drawer cart, tarjetas premium, filtros por material/talla — no reemplazar con versiones de otros sistemas

### VEREX AI Jewelry Assistant (tienda USA)
- Vive en el repo `verex-catalogo-us`: widget en `assistant/`, backend en `functions/` (Pages Functions `/api/chat`, `/api/products`, `/api/search`).
- Lee el inventario real del Worker (`GET_CATALOGO`); no tiene productos escritos en el código.
- IA vía Groq (misma cuenta que el Worker): la clave va SOLO como Secret `GROQ_API_KEY` en Cloudflare Pages (proyecto verex-catalogo-us). Sin clave funciona por reglas.
- Si cambian tarifas de envío / mínimo de compra en `verex-catalogo-us/index.html`, actualizar también `functions/_lib/knowledge.js`.
- Guía completa: `verex-catalogo-us/docs/AI-ASSISTANT.md`.
- **Lyra en WhatsApp (El Salvador)**: vive en el mismo repo y el **mismo proyecto de Cloudflare Pages `verex-catalogo-us`** (`functions/_lib/wa/`, «modo El Salvador» `VEREX_MARKET=sv`, no usa nada de la tienda USA). Webhook `whatsapp.verexstore.com/api/whatsapp/webhook` (dominio extra del proyecto; o `us.verexstore.com/...`; los clientes no lo ven). Lee TODO el stock ofrecible (`WA_STOCK`), crea catálogos de Cliente en admin-tienda (`LYRA_CATALOG_KEY` igual en verex-catalogo-us y admin-tienda; reglas en `admin-tienda/functions/_lyra-catalog.js`) y guarda las conversaciones en VEREX Chats (`chats.html`), desde donde el equipo responde por WhatsApp. Se configura en Admin → 🤖 Lyra WhatsApp (`config/lyra`). Guía: `verex-catalogo-us/docs/WHATSAPP.md`.

---

## Reglas de Trabajo

### 1. Verificación Antes de Declarar Listo

**Nunca decir "listo" sin evidencia.**

Antes de reportar que algo funciona:
1. Abrir el archivo en el navegador y verificar visualmente
2. Si hay cambios en el worker → verificar que el deploy fue exitoso
3. Si hay cambios en HTML → verificar que el push llegó a GitHub

❌ "Debería funcionar ahora"
✅ "Verifiqué en el navegador y funciona — screenshot adjunto"

### 2. Debugging Sistemático

Cuando algo no funciona, seguir este orden:
1. **Leer el error completo** — no saltar mensajes de error
2. **Reproducir el problema** — confirmar que pasa de forma consistente
3. **Revisar qué cambió** — git diff, últimas ediciones
4. **Una hipótesis a la vez** — probar un cambio, verificar, luego el siguiente
5. **Si 3 intentos fallan** — replantear el enfoque, no seguir parcheando

❌ Cambiar múltiples cosas a la vez esperando que algo funcione
✅ Identificar la causa raíz antes de proponer solución

### 3. Diseño Antes de Implementar

Para features nuevas o cambios grandes:
1. Preguntar el objetivo y restricciones
2. Proponer 2-3 enfoques con sus ventajas/desventajas
3. Esperar aprobación antes de codear
4. Implementar en pasos pequeños verificables

Para cambios pequeños (ajustes de estilo, texto, correcciones): implementar directamente.

---

## Recordatorios Importantes

- El worker usa **Supabase**, no Firebase (aunque el archivo se llame `worker-firebase.js`)
- Los nombres de archivos tienen números: `index (4).html`, `index (2).html` — respetar exactamente
- Siempre copiar los cambios a los repos `_admin-repo`, `_consig-repo`, `_inventario-repo` según corresponda
- El Hub de VEREX abre archivos locales — siempre están actualizados en el PC
