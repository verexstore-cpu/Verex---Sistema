// Fotos e imágenes: ImageKit, quitar fondo, fotos pendientes
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
// Cada acción devuelve el resultado (se responde como JSON) o una Response; NO_MANEJADA si no es de este módulo.
import { NO_MANEJADA, forbidden } from "../lib/http.js";
import { RL_UPLOAD, rlBlocked, rlFail } from "../lib/seguridad.js";

export async function accionesImagenes({ d, sb, env, ip, esAdmin, request }) {
  let result;
  switch (d.accion) {

    case "ELIMINAR_FOTO": {
      if (!esAdmin) return forbidden();
      const ikKey = env.IMAGEKIT_PRIVATE_KEY;
      if (!ikKey) { result = { ok: false, error: "ImageKit no configurado" }; break; }
      try {
        const urlFoto  = (d.url || "").split("?")[0];
        const pathMatch = urlFoto.match(/ik\.imagekit\.io\/[^/]+(.+)/);
        if (!pathMatch) { result = { ok: false, error: "URL de ImageKit inválida" }; break; }
        const filePath = pathMatch[1]; // ej: /consignacion/foto_abc.jpg
        const parts    = filePath.split("/");
        const name     = parts[parts.length - 1];
        const folder   = parts.slice(0, -1).join("/") || "/";
        const auth     = "Basic " + btoa(ikKey + ":");
        // Buscar fileId por nombre + carpeta
        const listRes  = await fetch(
          `https://api.imagekit.io/v1/files?name=${encodeURIComponent(name)}&path=${encodeURIComponent(folder)}&limit=1`,
          { headers: { "Authorization": auth } }
        );
        const files = await listRes.json();
        if (!Array.isArray(files) || files.length === 0) {
          result = { ok: false, error: "Archivo no encontrado en ImageKit" }; break;
        }
        await fetch(`https://api.imagekit.io/v1/files/${files[0].fileId}`, {
          method: "DELETE", headers: { "Authorization": auth }
        });
        result = { ok: true };
      } catch(eIK) {
        result = { ok: false, error: "Error ImageKit: " + eIK.message };
      }
      break;
    }

    case "IMAGEKIT_FIRMA": {
      if (!esAdmin) return forbidden();
      const ikPriv = env.IMAGEKIT_PRIVATE_KEY;
      if (!ikPriv) { result = { ok: false, error: "ImageKit no configurado" }; break; }
      const token  = crypto.randomUUID();
      const expire = Math.floor(Date.now() / 1000) + 3600;
      const enc    = new TextEncoder();
      const ck     = await crypto.subtle.importKey("raw", enc.encode(ikPriv), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
      const sig    = await crypto.subtle.sign("HMAC", ck, enc.encode(token + expire));
      const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
      result = { ok: true, token, expire, signature };
      break;
    }

    case "SUBIR_FOTO": {
      // Permitir subida con key pública (desde celular) o con pass admin
      const keyOk = d.key === "vx_upload_7c4406c55f0f10174b0cb08da23cae88" || esAdmin;
      if (!keyOk) return forbidden();
      // La clave pública está en upload.html (la usa el celular sin sesión): con ella solo se suben IMÁGENES de hasta
      // ~8 MB y máx. 120 por hora por IP. Antes cualquiera podía subir lo que fuera, sin límite, a ImageKit.
      if (!esAdmin) {
        if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(d.imagen || "").slice(0, 60) + "A") || String(d.imagen || "").length > 11_000_000) {
          result = { ok: false, error: "Solo imágenes JPG, PNG o WebP de hasta 8 MB" }; break;
        }
        const rkUp = "upload:" + ip;
        if (await rlBlocked(sb, rkUp)) { result = { ok: false, error: "Demasiadas fotos seguidas: espera un rato" }; break; }
        await rlFail(sb, rkUp, RL_UPLOAD);
        d.nombre = String(d.nombre || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
      }
      const ikKey = env.IMAGEKIT_PRIVATE_KEY;
      if (!ikKey) { result = { ok: false, error: "ImageKit no configurado en secrets" }; break; }
      const authHeader = "Basic " + btoa(ikKey + ":");
      const ext        = (d.imagen || "").startsWith("data:image/png") ? "png" : "jpg";
      const fileName   = (d.nombre || ("foto_" + Date.now())) + "." + ext;
      const form       = new FormData();
      form.append("file",              d.imagen);
      form.append("fileName",          fileName);
      form.append("folder",            "/consignacion");
      form.append("useUniqueFileName", "true");
      const ikRes  = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
        method: "POST",
        headers: { "Authorization": authHeader },
        body:   form
      });
      const ikData = await ikRes.json();
      if (ikData.url) {
        const urlBase = ikData.url.split("?")[0];
        // d.original = la foto tal cual (sin reducir a 900 px): para el hero de la tienda, que necesita ~2000 px
        result = { ok: true, url: d.original === true ? urlBase : urlBase + "?tr=w-900,h-900,c-maintain_ratio" };
      } else {
        result = { ok: false, error: ikData.message || "Error subiendo foto" };
      }
      break;
    }

    // ── Imágenes informativas (guías de talla, cuidados, promociones) —
    // separadas del inventario, solo para compartir el link con clientes.
    case "GUARDAR_IMAGEN_INFO": {
      if (!esAdmin) return forbidden();
      if (!d.url) { result = { ok: false, error: "Falta la URL de la imagen" }; break; }
      const imgId = "IMGINFO_" + Date.now();
      await sb.set("imagenes_info", imgId, {
        id: imgId,
        etiqueta: d.etiqueta || "",
        url: d.url,
        fecha: new Date().toISOString()
      });
      result = { ok: true, id: imgId };
      break;
    }

    case "GET_IMAGENES_INFO": {
      if (!esAdmin) return forbidden();
      const imagenes = await sb.getAll("imagenes_info");
      result = { ok: true, imagenes };
      break;
    }

    case "ELIMINAR_IMAGEN_INFO": {
      if (!esAdmin) return forbidden();
      await sb.delete("imagenes_info", d.id);
      result = { ok: true };
      break;
    }

    case "ELIMINAR_FONDO": {
      if (!esAdmin) return forbidden();
      const hfKey = env.HF_TOKEN;
      if (!hfKey) { result = { ok: false, error: "HF_TOKEN no configurado en secrets" }; break; }
      try {
        // Convertir base64 a binario
        const base64 = (d.imagen || "").replace(/^data:image\/\w+;base64,/, "");
        const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        // Llamar a Hugging Face RMBG-1.4
        const hfRes = await fetch(
          "https://api-inference.huggingface.co/models/briaai/RMBG-1.4",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${hfKey}`,
              "Content-Type": "application/octet-stream"
            },
            body: binary
          }
        );
        if (!hfRes.ok) {
          const err = await hfRes.text();
          result = { ok: false, error: `HF error ${hfRes.status}: ${err}` };
          break;
        }
        // Convertir respuesta PNG a base64
        const pngBuffer = await hfRes.arrayBuffer();
        const pngBase64 = btoa(String.fromCharCode(...new Uint8Array(pngBuffer)));
        result = { ok: true, imagen: "data:image/png;base64," + pngBase64 };
      } catch(e) {
        result = { ok: false, error: e.message };
      }
      break;
    }

    case "GUARDAR_FOTO_PENDIENTE": {
      // Guarda URL de foto subida desde celular para usarla en el sistema
      // Público (lo usa la página del celular): solo URLs de ImageKit, sin comillas ni espacios (se pinta en el Hub).
      if (!/^https:\/\/ik\.imagekit\.io\/[^\s"'<>`]{1,500}$/.test(String(d.url || ""))) { result = { ok: false, error: "url_invalida" }; break; }
      const id = `foto_${Date.now()}`;
      await sb.set("fotos_pendientes", id, {
        id, url: d.url, fecha: new Date().toISOString(), usada: false
      });
      result = { ok: true, id };
      break;
    }

    case "GET_FOTOS_PENDIENTES": {
      if (!esAdmin) return forbidden();
      const fotos = await sb.getAll("fotos_pendientes");
      // Devolver solo las no usadas, más recientes primero, máx 20
      const recientes = fotos
        .filter(f => !f.usada)
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
        .slice(0, 20);
      result = { ok: true, fotos: recientes };
      break;
    }

    case "MARCAR_FOTO_USADA": {
      if (!esAdmin) return forbidden();
      await sb.update("fotos_pendientes", d.id, { usada: true });
      result = { ok: true };
      break;
    }

    default:
      return NO_MANEJADA;
  }
  return result;
}
