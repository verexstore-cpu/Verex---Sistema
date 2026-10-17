// Inteligencia artificial: análisis de fotos, traducciones e interpretación de pedidos
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
// Cada acción devuelve el resultado (se responde como JSON) o una Response; NO_MANEJADA si no es de este módulo.
import { _baseTrio } from "../lib/codigos.js";
import { NO_MANEJADA, forbidden } from "../lib/http.js";

export async function accionesIA({ d, sb, env, ip, esAdmin, request }) {
  let result;
  switch (d.accion) {

    case "GEMINI_TEST": {
      if (!esAdmin) return forbidden();
      const gKey = env.GEMINI_KEY;
      if (!gKey) { result = { ok: false, error: "No hay GEMINI_KEY" }; break; }
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${gKey}`);
      const data = await r.json();
      const nombres = (data.models || []).map(m => m.name).filter(n => n.includes("gemini"));
      result = { ok: r.ok, status: r.status, modelos: nombres, error: data.error?.message };
      break;
    }

    case "ANALIZAR_IMAGEN": {
      if (!esAdmin) return forbidden();
      try {
        const base64 = (d.imagen || "").replace(/^data:image\/[^;]+;base64,/, "");
        if (!base64) { result = { ok: false, error: "No se recibió imagen" }; break; }
        const material = d.material || "Plata 925";

        // Detectar tipo de imagen (jpeg por defecto)
        const mimeMatch = (d.imagen || "").match(/^data:(image\/[^;]+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

        const promptGemini =
          `Eres el naming director de una joyería de lujo latinoamericana. Creas nombres COMERCIALES, EVOCADORES y PREMIUM para cada pieza. Responde ÚNICAMENTE con JSON válido, sin texto antes ni después.\n\n` +
          `MATERIAL CONFIRMADO (no lo detectes, úsalo tal cual): ${material}\n\n` +
          `CATEGORÍA — elige el código exacto:\n` +
          `AN=anillo PU=pulsera CO=collar CD=collar con dije AR=aretes DJ=dije CJ=conjunto TB=tobillera RS=rosario CA=cadena\n\n` +
          `IDENTIFICA CON PRECISIÓN:\n` +
          `• Tipo de pieza: anillo, aretes, collar, pulsera, etc.\n` +
          `• Motivo principal — elige el que de verdad ves, pero ten en mente este banco amplio de opciones para no caer siempre en los mismos 3-4: corazón, mariposa, luna creciente, luna llena, sol, estrella, serpiente, infinito, flor, rosa, margarita, girasol, cruz, ángel, corona, llave, gota, espiral, lazo, moño, hoja, concha, caracola, delfín, abeja, libélula, pluma, arco iris, nudo, nudo marinero, banda lisa, solitario, trébol, ola, cascada, racimo, links, eslabones, cadena forzada, cadena veneciana, panal, rombo, cuadro, triángulo, ojo, media luna, sirena, estrella de mar, orquídea, hoja de olivo, rayo, cometa, cristal facetado, barroco, orgánico, ondas, espigas\n` +
          `• Piedras: zirconia blanca/champagne/negra/azul/roja/verde/morada/rosa/amarilla, ópalo, perla, cristal, turquesa, ónix, amatista, sin piedra\n` +
          `• Técnica: pavé, calado, filigrana, martillado, esmaltado, bicolor, halo, trenzado, entrelazado, texturizado, mate, pulido espejo\n\n` +
          `NOMBRE — sigue estas reglas ESTRICTAMENTE:\n` +
          `• Debe ser ESPECÍFICO al motivo real que ves en la foto — nunca inventes un motivo que no esté en la imagen\n` +
          `• Formato: [Tipo de joya] [motivo/técnica] [piedra o estilo si aplica]\n` +
          `• VARIEDAD OBLIGATORIA: este mismo prompt se usa cientos de veces seguidas para catalogar todo el inventario, así que NUNCA repitas la misma combinación de palabras que usarías para otra pieza parecida — cambia el orden, usa sinónimos, agrega un descriptor de estilo distinto cada vez (chic, boho, vintage, retro, art decó, minimalista, oversize — evita los adjetivos de la lista prohibida de abajo). Elige directamente el nombre menos genérico — NO escribas tu razonamiento ni nombres descartados, solo el JSON final.\n` +
          `• EJEMPLOS CORRECTOS:\n` +
          `  "Anillo Corazón Pavé Zirconia"\n` +
          `  "Aretes Luna Creciente Calada"\n` +
          `  "Collar Mariposa Ópalo"\n` +
          `  "Pulsera Infinito Zirconia Blanca"\n` +
          `  "Anillo Solitario Zirconia Oval"\n` +
          `  "Aretes Gota Zirconia Champagne"\n` +
          `  "Collar Estrella Halo Zirconia"\n` +
          `  "Anillo Serpiente Entrelazada"\n` +
          `  "Conjunto Corazón Bicolor"\n` +
          `  "Pulsera Trenzada Perla Cultivada"\n` +
          `  "Anillo Turquesa Chic"\n` +
          `• PROHIBIDO — NUNCA uses estas palabras: geométrico, decorativo, abstracto, elegante, moderno, bonito, clásico, simple, diseño, estilizado, sofisticado, fino, delicado, exclusivo, único, especial, precioso\n` +
          `• CADA PALABRA con su primera letra en mayúscula (Title Case), el resto de cada palabra en minúscula. Sin mencionar el material. Máximo 5 palabras.\n\n` +
          `DESCRIPCION — máximo 12 palabras:\n` +
          `• Describe exactamente lo que ves: motivo, piedra, técnica, forma. Sin mencionar ${material}.\n` +
          `• Ejemplo: "Corazón calado con pavé de zirconia blanca en todo el contorno"\n\n` +
          `DESCRIPCION_TIENDA — máximo 18 palabras:\n` +
          `• Frase de marketing que evoca emoción y ocasión de uso\n` +
          `• Ejemplos: "Captura cada mirada con el brillo eterno de este corazón iluminado", "La luna que siempre llevas contigo, radiante en plata"\n\n` +
          `Responde SOLO con este JSON (sin markdown, sin texto extra):\n` +
          `{"categoria":"XX","nombre":"nombre específico","descripcion":"descripción exacta","descripcion_tienda":"frase de marketing"}`;

        // ── Usar Groq (gratis) — llama-4-scout Y llama-4-maverick fueron
        // descontinuados por Groq (scout el 17-jun-2026, maverick antes),
        // y despues qwen3.6-27b tambien dejo de existir (error 404
        // model_not_found visto en producción el 15-sep-2026). El modelo
        // de visión vigente en Groq es su sucesor, qwen3.8-27b.
        const groqKey = env.GROQ_KEY;
        if (!groqKey) { result = { ok: false, error: "GROQ_KEY no configurada en Cloudflare" }; break; }

        // Límite de 30s — sin esto, si Groq tarda mucho en responder (ej.
        // un modelo descontinuado que igual acepta la petición pero nunca
        // contesta bien), el análisis se queda "pegado" para siempre sin
        // mostrar ningún error en la pantalla.
        const llamarGroqVision = () => fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${groqKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: "qwen/qwen3.8-27b",
              messages: [{
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
                  { type: "text", text: promptGemini }
                ]
              }],
              // qwen3.8-27b es un modelo de razonamiento — sin esto, gasta
              // los tokens "pensando" en voz alta (bloque <think>...</think>)
              // y nunca llega a escribir el JSON final. reasoning_effort:none
              // lo pone en modo directo, sin ese paso.
              reasoning_effort: "none",
              max_tokens: 700,
              temperature: 0.95
            }),
            signal: AbortSignal.timeout(30000)
          });
        // Respaldo con Google Gemini (cuenta gratis aparte, Secret GEMINI_KEY): si Groq
        // llega a su límite diario, falla o no responde, se intenta con Gemini sin que
        // el usuario note nada. Se prueban varios modelos porque Google también retira
        // modelos y cada uno tiene su propio cupo gratis.
        const llamarGemini = async () => {
          const gKey = env.GEMINI_KEY;
          if (!gKey) return { ok: false, error: "sin GEMINI_KEY" };
          const errores = [];
          for (const modelo of ["gemini-flash-latest", "gemini-flash-lite-latest"]) {
            // Con thinkingBudget:0 responde directo (sin "pensar" y gastar tokens); si algún
            // modelo no acepta esa opción (400), se reintenta una vez sin ella.
            for (const sinPensar of [true, false]) {
              try {
                const generationConfig = { temperature: 0.95, maxOutputTokens: sinPensar ? 700 : 2048, responseMimeType: "application/json" };
                if (sinPensar) generationConfig.thinkingConfig = { thinkingBudget: 0 };
                const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${gKey}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    contents: [{ parts: [
                      { inline_data: { mime_type: mimeType, data: base64 } },
                      { text: promptGemini }
                    ] }],
                    generationConfig
                  }),
                  signal: AbortSignal.timeout(30000)
                });
                if (!r.ok) {
                  const errTxt = await r.text();
                  let msg = errTxt;
                  try { msg = JSON.parse(errTxt)?.error?.message || errTxt; } catch(_) {}
                  if (sinPensar && r.status === 400) continue;
                  errores.push(modelo + " " + r.status + ": " + String(msg).slice(0, 120));
                  break;
                }
                const gData = await r.json();
                const txt = (gData.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("").trim();
                if (txt) return { ok: true, texto: txt };
                errores.push(modelo + ": sin respuesta (" + (gData.candidates?.[0]?.finishReason || gData.promptFeedback?.blockReason || "vacía") + ")");
                break;
              } catch (e) {
                errores.push(modelo + ": " + (e.name === "TimeoutError" ? "no respondió a tiempo" : e.message));
                break;
              }
            }
          }
          return { ok: false, error: errores.join(" · ") };
        };

        let texto = "";
        let errorGroq = "";
        // proveedor:"gemini" = probar Gemini directo, sin pasar por Groq (diagnóstico desde la consola del Hub).
        const soloGemini = d.proveedor === "gemini";
        let groqRes;
        try {
          groqRes = soloGemini ? null : await llamarGroqVision();
          // 429 = límite de uso de la cuenta de Groq. Si pide esperar poco, se reintenta una vez sola.
          if (groqRes && groqRes.status === 429) {
            const espera = parseFloat(groqRes.headers.get("retry-after")) || 0;
            if (espera > 0 && espera <= 12) {
              await new Promise(r => setTimeout(r, Math.ceil(espera * 1000) + 300));
              groqRes = await llamarGroqVision();
            }
          }
        } catch (e) {
          groqRes = null;
          errorGroq = e.name === "TimeoutError" ? "Groq no respondió a tiempo (30s) — intenta de nuevo" : "Error de red hacia Groq: " + e.message;
        }

        if (groqRes && !groqRes.ok) {
          const errTxt = await groqRes.text();
          if (groqRes.status === 429) {
            let msg = errTxt;
            try { msg = JSON.parse(errTxt)?.error?.message || errTxt; } catch(_) {}
            const porDia = /per day|TPD|RPD/i.test(msg);
            // Groq manda la espera como "25m9.6s" o "1h2m3.5s" — se muestra legible ("25 min").
            const cuandoRaw = (msg.match(/try again in\s+((?:\d+h)?(?:\d+m)?(?:[\d.]+s)?)/i) || [])[1] || "";
            const hh = +((cuandoRaw.match(/(\d+)h/) || [])[1] || 0);
            const mm = +((cuandoRaw.match(/(\d+)m/) || [])[1] || 0);
            const ss = parseFloat((cuandoRaw.match(/([\d.]+)s/) || [])[1] || 0);
            const totalMin = hh * 60 + mm + (ss > 0 ? 1 : 0);
            const cuando = !cuandoRaw ? "" : totalMin <= 1 ? "1 min" : totalMin < 60 ? totalMin + " min" : hh + " h " + (mm ? mm + " min" : "");
            errorGroq = "La IA gratuita (Groq) llegó a su límite " + (porDia ? "diario" : "por minuto") +
              (cuando ? " — se libera en " + cuando.trim() : " — intenta de nuevo en unos minutos") +
              ". Mientras tanto puedes llenar nombre y descripción a mano.";
          } else {
            errorGroq = "Groq error " + groqRes.status + ": " + errTxt.slice(0, 150);
          }
        } else if (groqRes) {
          const groqData = await groqRes.json();
          texto = (groqData.choices?.[0]?.message?.content || "").trim();
        }

        if (!texto) {
          const gem = await llamarGemini();
          if (!gem.ok) {
            // Se muestra también por qué falló Gemini, para no quedar a ciegas si el respaldo no entra.
            result = { ok: false, error: (errorGroq || "La IA no devolvió respuesta.") + " | Respaldo Gemini: " + gem.error };
            break;
          }
          texto = gem.texto;
        }

        // Por si el modelo igual manda un bloque <think> pese al
        // reasoning_effort:none, se descarta antes de buscar el JSON.
        texto = texto.replace(/<think>[\s\S]*?<\/think>/i, "").trim();
        const match = texto.match(/\{[\s\S]*?\}/);
        if (!match) { result = { ok: false, error: "La IA no devolvió JSON: " + texto.slice(0, 150) }; break; }
        let parsed;
        try { parsed = JSON.parse(match[0]); }
        catch(pe) { result = { ok: false, error: "JSON inválido de la IA: " + match[0].slice(0, 120) }; break; }

        result = { ok: true, resultado: {
          nombre:            parsed.nombre            || "",
          categoria:         parsed.categoria         || "",
          descripcion:       parsed.descripcion       || "",
          descripcion_tienda: parsed.descripcion_tienda || parsed.descripcion || "",
          material
        }};
      } catch(eIA) {
        result = { ok: false, error: "Error IA: " + eIA.message };
      }
      break;
    }

    // Traduce al inglés la frase de marketing (descripcionTienda) de un
    // producto para el catálogo de EE.UU. Pública (la llama el catálogo,
    // no el admin) — se usa la primera vez que alguien ve ese producto
    // en inglés. El resultado se guarda en descripcionTiendaEN en todos
    // los SKUs del grupo (tallas) para no tener que volver a traducir.
    case "TRADUCIR_DESCRIPCION": {
      const texto = String(d.texto || "").trim();
      const codigos = Array.from(new Set((Array.isArray(d.codigos) ? d.codigos : []).map(String).filter(Boolean))).slice(0, 40);
      if (!texto) { result = { ok: false, error: "Texto vacío" }; break; }
      if (texto.length > 500) { result = { ok: false, error: "Texto demasiado largo" }; break; }
      // Es pública (us.verexstore.com traduce la descripción la primera vez que alguien la ve en inglés), así que:
      // solo traduce el texto REAL del producto (la descripción que escribió el admin, igual en todos los códigos
      // pedidos), y si ya hay traducción la devuelve sin gastar IA. Antes cualquiera podía mandar su propio texto
      // y guardarlo como descripción en inglés de cualquier producto (y gastar la cuenta de Groq en bucle).
      if (!codigos.length) { result = { ok: false, error: "codigos requeridos" }; break; }
      const filasTr = await sb.getMany("stock", codigos);
      const descReal = x => String(x.descripcionTienda || x.descripcion || "").trim();
      // Todas las tallas de UN diseño; alguna puede no tener descripción propia (la hereda de la primera).
      const baseTr = _baseTrio(codigos[0]).toUpperCase();   // un trío incluye su 2da pieza de dama ("B")
      if (filasTr.length !== codigos.length || !codigos.every(c => _baseTrio(c).toUpperCase() === baseTr)
          || !filasTr.some(x => descReal(x) === texto) || !filasTr.every(x => descReal(x) === texto || descReal(x) === "")) { result = { ok: false, error: "texto_no_coincide" }; break; }
      const yaTr = filasTr.find(x => x.descripcionTiendaEN && x.descripcionTiendaENDe === texto);
      if (yaTr) { result = { ok: true, traduccion: yaTr.descripcionTiendaEN, cache: true }; break; }
      const groqKey = env.GROQ_KEY;
      if (!groqKey) { result = { ok: false, error: "GROQ_KEY no configurada en Cloudflare" }; break; }
      try {
        const prompt =
          `Traduce esta frase de marketing de una joyería del español al inglés, para una tienda en Estados Unidos. ` +
          `Que suene natural para un hablante nativo de inglés, no una traducción literal palabra por palabra — ` +
          `mantén el mismo tono emotivo y de venta. Responde ÚNICAMENTE con la traducción, sin comillas ni texto adicional.\n\n` +
          `Frase original: "${texto}"`;
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${groqKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "qwen/qwen3.8-27b",
            messages: [{ role: "user", content: prompt }],
            reasoning_effort: "none",
            max_tokens: 150,
            temperature: 0.5
          }),
          signal: AbortSignal.timeout(15000)
        });
        if (!groqRes.ok) {
          const errTxt = await groqRes.text();
          result = { ok: false, error: "Groq error " + groqRes.status + ": " + errTxt.slice(0, 150) };
          break;
        }
        const groqData = await groqRes.json();
        let traduccion = (groqData.choices?.[0]?.message?.content || "").trim();
        traduccion = traduccion.replace(/<think>[\s\S]*?<\/think>/i, "").trim();
        traduccion = traduccion.replace(/^["“”']|["“”']$/g, "").trim();
        traduccion = traduccion.replace(/<[^>]*>/g, "").replace(/[<>]/g, "").slice(0, 600).trim();   // solo texto, nunca HTML
        if (!traduccion) { result = { ok: false, error: "Groq no devolvió traducción" }; break; }
        await Promise.all(codigos.map(cod => sb.update("stock", cod, { descripcionTiendaEN: traduccion, descripcionTiendaENDe: texto }).catch(() => {})));
        result = { ok: true, traduccion };
      } catch (e) {
        result = { ok: false, error: e.name === "TimeoutError" ? "Groq no respondió a tiempo" : "Error de traducción: " + e.message };
      }
      break;
    }

    // Admin → Catálogo Cliente → «Pega lo que te pidió el cliente»: convierte el mensaje
    // (tal como llegó por WhatsApp) en filtros del catálogo. Solo devuelve filtros;
    // las piezas las elige el admin. Todo valor se valida contra listas fijas.
    case "IA_INTERPRETAR_PEDIDO": {
      if (!esAdmin) return forbidden();
      const texto = String(d.texto || "").trim().slice(0, 800);
      if (!texto) { result = { ok: false, error: "Texto vacío" }; break; }
      const groqKey = env.GROQ_KEY;
      if (!groqKey) { result = { ok: false, error: "GROQ_KEY no configurada en Cloudflare" }; break; }
      const ocasionesIA = (Array.isArray(d.ocasiones) ? d.ocasiones : []).slice(0, 40)
        .map(o => ({ id: String(o?.id || "").slice(0, 40), nombre: String(o?.nombre || "").slice(0, 40) }))
        .filter(o => /^[a-z0-9-]{1,40}$/.test(o.id));
      const CATS_IA = { AN: "anillos", AR: "aretes", CD: "cadenas / collares / dijes", PL: "pulseras", CN: "conjuntos / sets", RL: "relojes" };
      try {
        const prompt =
          `Eres asistente de VEREX, joyería en El Salvador. Un cliente escribió el mensaje de abajo. ` +
          `Conviértelo en filtros para armarle un catálogo. Responde SOLO con un objeto JSON, sin texto extra, con estas claves:\n` +
          `"ocasiones": ids de esta lista que apliquen: ${JSON.stringify(ocasionesIA)}\n` +
          `"categorias": códigos de esta lista: ${JSON.stringify(CATS_IA)}\n` +
          `"materiales": de ["plata","acero","oro"] (oro incluye laminado/chapa de oro)\n` +
          `"tallas": tallas de anillo como texto, ej. ["6","6.5"]\n` +
          `"precioMin" y "precioMax": números en dólares o 0 si no dijo. Si dice "como de $30" usa precioMax un poco arriba (ej. 35).\n` +
          `"tipoAnillo": "sencillo", "pareja" (argollas de matrimonio/novios) o ""\n` +
          `"genero": "dama", "caballero" o "" (solo si lo dice)\n` +
          `"nombreCliente": su nombre si lo dice, si no ""\n` +
          `"noEntendido": palabras de estilo o gusto que no son filtros (ej. "delicado", "elegante")\n` +
          `No inventes: deja vacío lo que el mensaje no diga.\n\nMensaje: """${texto}"""`;
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${groqKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "qwen/qwen3.8-27b",
            messages: [{ role: "user", content: prompt }],
            reasoning_effort: "none",
            max_tokens: 350,
            temperature: 0
          }),
          signal: AbortSignal.timeout(15000)
        });
        if (!groqRes.ok) { result = { ok: false, error: "Groq error " + groqRes.status }; break; }
        const groqData = await groqRes.json();
        let txt = (groqData.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/i, "");
        const m = txt.match(/\{[\s\S]*\}/);
        let j = {};
        try { j = JSON.parse(m ? m[0] : "{}"); } catch (_) { j = {}; }
        const lista = (v, ok, max = 10) => Array.from(new Set((Array.isArray(v) ? v : []).map(x => String(x).trim()).filter(ok))).slice(0, max);
        const idsOc = new Set(ocasionesIA.map(o => o.id));
        const num = v => { const n = Math.round(parseFloat(v) || 0); return n > 0 && n < 10000 ? n : 0; };
        let precioMin = num(j.precioMin), precioMax = num(j.precioMax);
        if (precioMin && precioMax && precioMin > precioMax) [precioMin, precioMax] = [precioMax, precioMin];
        result = { ok: true, pedido: {
          ocasiones:  lista(j.ocasiones, x => idsOc.has(x)),
          categorias: lista(j.categorias, x => CATS_IA[x]),
          materiales: lista(j.materiales, x => ["plata", "acero", "oro"].includes(x)),
          tallas:     lista(j.tallas, x => /^\d{1,2}(\.5)?$/.test(x) && parseFloat(x) >= 3 && parseFloat(x) <= 16, 12),
          precioMin, precioMax,
          tipoAN:     ["sencillo", "pareja"].includes(j.tipoAnillo) ? j.tipoAnillo : "",
          genero:     ["dama", "caballero"].includes(j.genero) ? j.genero : "",
          nombreCliente: String(j.nombreCliente || "").replace(/<[^>]*>/g, "").replace(/[<>"]/g, "").trim().slice(0, 30),
          noEntendido: lista(j.noEntendido, x => x.length > 1 && x.length < 30, 5),
        } };
      } catch (e) {
        result = { ok: false, error: e.name === "TimeoutError" ? "Groq no respondió a tiempo" : "Error de IA: " + e.message };
      }
      break;
    }

    default:
      return NO_MANEJADA;
  }
  return result;
}
