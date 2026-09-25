# VEREX Sistema — Instrucciones para Claude

## Contexto del Proyecto

Sistema de gestión para VEREX Store (joyería/accesorios). Incluye:
- **Admin VEREX** — panel de administración (Cloudflare Pages → `admin-tienda` repo)
- **Consignación VEREX** — gestión de vendedores y consignaciones (Cloudflare Pages → `verex-consignacion` repo)
- **Catálogo VEREX** — tienda pública en `verexstore.com` (Cloudflare Pages → `verex-catalogo` repo)
- **Catálogo VEREX US** — tienda pública para EE.UU. en `us.verexstore.com` (Cloudflare Pages → `verex-catalogo-us` repo) — ver sección "Sistema de Estados Unidos" abajo
- **Inventario Sellers** — inventario para vendedores (Cloudflare Pages → `inventario-sellers` repo)
- **Worker API** — backend en Cloudflare Workers (`worker-firebase.js`) — requiere `npx wrangler deploy` manual (o push a `verex-consignacion` → deploy automático por GitHub Actions, ver abajo)
- **Sistema de Impresión** — generador de etiquetas Brother QL

## Stack Tecnológico

- Frontend: HTML/CSS/JS vanilla (sin frameworks)
- Backend: Cloudflare Worker (JavaScript)
- Base de datos: Supabase (PostgreSQL)
- Imágenes: ImageKit
- Deploy: Cloudflare Pages (auto desde GitHub) + Cloudflare Workers (auto vía GitHub Actions en `verex-consignacion`, o manual con `npx wrangler deploy`)

## Flujo de Deploy

```
Editar archivo local → git commit+push al repo correspondiente → Cloudflare Pages auto-despliega
Worker (worker-firebase.js) → push a verex-consignacion (main) → GitHub Actions lo despliega solo (wrangler-action)
```

### Repositorios de Deploy
| Carpeta local | Repo GitHub | Auto-deploy | URL |
|---|---|---|---|
| `adminverex/index (2).html` | `admin-tienda` → `_admin-repo/index.html` | ✅ Cloudflare Pages | — |
| `consignacion/index (4).html` | `verex-consignacion` → `_consig-repo/index.html` | ✅ Cloudflare Pages | — |
| `consignacion/worker-firebase.js` | `verex-consignacion` → `_consig-repo/worker-firebase.js` | ✅ GitHub Actions (wrangler-action) | `verex-api.verexstore.workers.dev` |
| `verex-catalogo/index.html` | `verex-catalogo` → `index.html` | ✅ Cloudflare Pages | `verexstore.com` |
| `inventario-sellers/index (5).html` | `inventario-sellers` → `_inventario-repo/index.html` | ✅ Cloudflare Pages | — |
| *(repo aparte, no vive dentro de este)* | `verex-catalogo-us` → `index.html` | ✅ Cloudflare Pages | `us.verexstore.com` |

**Siempre hacer push a los repos de deploy además del repo principal.**

El deploy automático del worker corre vía GitHub Actions (`.github/workflows/deploy-worker.yml` en `verex-consignacion`), usando el secreto `CLOUFLARE_API_TOKEN` — **el nombre está mal escrito a propósito** (le falta la "D" de "CLOUD"), porque así quedó guardado el secreto real en GitHub. No "corregir" ese nombre en el workflow sin antes renombrar el secreto en GitHub, o el deploy se rompe.

### ⚠️ Reglas críticas del catálogo
- El archivo fuente del catálogo es **`verex-catalogo/index.html`** — es su propio repo git
- **NUNCA** editar ni copiar desde `catalogo/index (6).html.OLD_NO_USAR` — es una versión antigua abandonada
- Para cambiar el catálogo: editar `verex-catalogo/index.html` directamente y hacer `git push` dentro de `verex-catalogo/`
- Google Sheets **ya no se usa** — el catálogo lee desde Supabase via `verex-api.verexstore.workers.dev`
- El catálogo tiene diseño propio: drawer cart, tarjetas premium, filtros por material/talla — no reemplazar con versiones de otros sistemas

### 🇺🇸 Sistema de Estados Unidos

Hay **tres piezas separadas** para vender en EE.UU. — no confundirlas ni fusionarlas:

1. **`verex-catalogo-us`** (repo aparte, `git clone` propio, **NO** vive dentro de la carpeta de este repo) → `us.verexstore.com`. Es el sitio completo navegable, fork de `verex-catalogo/index.html`, con: interfaz bilingüe ES/EN (toggle + traducción automática de nombres de producto), envío por DHL (mínimo de compra $50, tramos de envío hasta $150+ = gratis), checkout con formulario de dirección de EE.UU. (calle/ciudad/estado/ZIP, con autocompletado de ciudad/estado a partir del ZIP vía la API pública de Zippopotam), y pago directo por PayPal.me (botón "Pagar con PayPal" que abre el link con el monto exacto). Mismo backend/inventario que `verexstore.com` (Supabase vía `verex-api.verexstore.workers.dev`).
2. **`adminverex/catalogo-us.html`** — generador de **links de catálogo curado** para compartir (ej. por WhatsApp): el admin arma una selección de productos y genera un link con los datos comprimidos (LZString) en la URL. **No es un sitio navegable** — sin esos datos en la URL muestra "Link inválido.". Comparte la misma lógica de checkout que se portó a `verex-catalogo-us` (DHL, PayPal, `REGISTRAR_LEAD`/`ENVIAR_PEDIDO_USA`), pero es una herramienta distinta con un propósito distinto.
3. **`adminverex/logistica-usa.html`** — panel de administración para los pedidos de EE.UU. (marcar pago, tracking DHL, notas, imprimir etiqueta Brother QL). Recibe los leads/pedidos generados tanto por `verex-catalogo-us` como por `catalogo-us.html`, porque ambos llaman a las mismas acciones del worker (`REGISTRAR_LEAD` con `pais:"US"`, `ENVIAR_PEDIDO_USA`).

**Correo de pedidos USA**: `ENVIAR_PEDIDO_USA` (en `worker-firebase.js`) manda el aviso de cada pedido a **`verex.pedidos@verexstore.com`** (cuenta de Zoho ya creada para esto — no `pedidos@verexstore.com`, que no existe). Si se necesita otro destinatario, cambiar el `to:` de ese case en el worker.

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
