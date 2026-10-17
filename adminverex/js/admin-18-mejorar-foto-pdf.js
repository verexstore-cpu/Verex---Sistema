// Admin VEREX — Mejorar imagen (ImageKit) y PDF del catálogo
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ── MEJORAR IMAGEN (nitidez vía ImageKit) ──────────────────────────
// Solo transformaciones de nitidez (sharpen), nunca color/contraste/brillo
// ni IA generativa — la pieza debe verse exactamente igual, solo más nítida.
// Es una transformación por URL de ImageKit (mismo servicio ya en uso, sin
// nueva integración): no sube ni duplica ningún archivo.
const NIVELES_MEJORA_IMG = { natural: "e-sharpen-3", mejorado: "e-sharpen-8" };
function ikMejorar(url, nivel) {
    if (!url || !url.includes("imagekit.io")) return url;
    const tr = NIVELES_MEJORA_IMG[nivel] || NIVELES_MEJORA_IMG.natural;
    return url.includes("?tr=") ? url + "," + tr : url + "?tr=" + tr;
}

// Textos del panel en ES/EN — panel autocontenido, no depende de ningún
// sistema de idioma del resto del admin (que es solo en español).
const MEJORA_I18N = {
    es: {
        titulo: "✨ Mejorar imagen", original: "Original", preview: "Vista previa mejorada",
        nivel: "Nivel", natural: "Natural", mejorado: "Mejorado",
        cancelar: "Cancelar", aplicar: "Aplicar mejora", aplicando: "Aplicando...",
        toggleIdioma: "EN", okMsg: "✨ Mejora aplicada — el original se conserva intacto",
        errMsg: "⚠️ No se pudo aplicar la mejora"
    },
    en: {
        titulo: "✨ Enhance image", original: "Original", preview: "Enhanced preview",
        nivel: "Level", natural: "Natural", mejorado: "Enhanced",
        cancelar: "Cancel", aplicar: "Apply enhancement", aplicando: "Applying...",
        toggleIdioma: "ES", okMsg: "✨ Enhancement applied — the original is kept untouched",
        errMsg: "⚠️ Could not apply the enhancement"
    }
};
let _mjIdioma = "es";
let _mjNivel  = "natural";
let _mjProd   = null;

function renderTextosMejora() {
    const L = MEJORA_I18N[_mjIdioma];
    document.getElementById("mj-titulo").textContent          = L.titulo;
    document.getElementById("mj-label-original").textContent  = L.original;
    document.getElementById("mj-label-preview").textContent   = L.preview;
    document.getElementById("mj-label-nivel").textContent     = L.nivel;
    document.getElementById("mj-btn-natural").textContent     = L.natural;
    document.getElementById("mj-btn-mejorado").textContent    = L.mejorado;
    document.getElementById("mj-btn-cancelar").textContent    = L.cancelar;
    document.getElementById("mj-btn-aplicar").textContent     = L.aplicar;
    document.getElementById("mj-btn-idioma").textContent      = L.toggleIdioma;
}

function toggleIdiomaMejora() {
    _mjIdioma = _mjIdioma === "es" ? "en" : "es";
    renderTextosMejora();
}

function abrirMejorarFoto(p) {
    const foto = p.foto || p.img || "";
    if (!foto) { toast("⚠️ Este producto no tiene foto", "#f97316"); return; }
    _mjProd   = p;
    _mjNivel  = "natural"; // Natural es siempre el nivel predeterminado
    document.getElementById("mj-nombre").textContent = `${p.nombre || "—"} · Ref: ${p.codigo || "—"}`;
    document.getElementById("mj-img-original").src   = foto;
    renderTextosMejora();
    actualizarNivelMejora();
    document.getElementById("modal-mejorar-foto").classList.add("open");
}

function cerrarMejorarFoto() {
    document.getElementById("modal-mejorar-foto").classList.remove("open");
    _mjProd = null;
}

function setNivelMejora(nivel) {
    _mjNivel = nivel;
    actualizarNivelMejora();
}

function actualizarNivelMejora() {
    if (!_mjProd) return;
    const foto = _mjProd.foto || _mjProd.img || "";
    document.getElementById("mj-img-preview").src = ikMejorar(foto, _mjNivel);
    document.getElementById("mj-btn-natural").classList.toggle("bp", _mjNivel === "natural");
    document.getElementById("mj-btn-natural").classList.toggle("bg", _mjNivel !== "natural");
    document.getElementById("mj-btn-mejorado").classList.toggle("bp", _mjNivel === "mejorado");
    document.getElementById("mj-btn-mejorado").classList.toggle("bg", _mjNivel !== "mejorado");
}

async function aplicarMejoraFoto() {
    if (!_mjProd) return;
    const foto = _mjProd.foto || _mjProd.img || "";
    const L = MEJORA_I18N[_mjIdioma];
    const btn = document.getElementById("mj-btn-aplicar");
    btn.textContent = L.aplicando; btn.disabled = true;
    try {
        const res = await fetch(API_URL, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                accion: "EDITAR_PRODUCTO", _pass: ADMIN_PASS,
                codigo: _mjProd.codigo,
                fotoMejorada: ikMejorar(foto, _mjNivel),
                fotoMejoraNivel: _mjNivel
            })
        });
        const data = await res.json();
        if (data.ok) { toast(L.okMsg, "#22c55e"); cerrarMejorarFoto(); await cargarDatos(true); }
        else { toast(L.errMsg, "#ef4444"); }
    } catch (e) {
        toast(L.errMsg, "#ef4444");
    } finally {
        btn.textContent = L.aplicar; btn.disabled = false;
    }
}

async function imgToBase64Cat(url) {
    if (!url) return null;
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                const c = document.createElement("canvas");
                c.width = img.naturalWidth; c.height = img.naturalHeight;
                c.getContext("2d").drawImage(img, 0, 0);
                resolve(c.toDataURL("image/jpeg", 0.85));
            } catch(_) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = ikSharp(url);
    });
}

async function generarPDFCatalogo() {
    const codsSel = [...document.querySelectorAll(".cat-chk:checked")].map(c => c.dataset.cod);
    if (!codsSel.length) return toast("⚠️ Selecciona al menos un producto", "#f97316");

    const lista   = _catFiltrada.filter(p => codsSel.includes(p.codigo));
    const talla   = document.getElementById("cat-talla").value;
    const nombre  = document.getElementById("cat-nombre").value.trim();
    const dias    = parseInt(document.getElementById("cat-validez").value) || 3;
    const expDate = new Date(Date.now() + dias * 864e5).toLocaleDateString("es-CO");

    const btn = document.getElementById("btn-gen-pdf");
    btn.textContent = "⏳ Generando..."; btn.disabled = true;

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: "mm", format: "a4" });

        const PW = 210, PH = 297;
        const mg = 14;
        const gap = 7;
        const cols = 2;
        const colW = (PW - mg * 2 - gap * (cols - 1)) / cols;   // ~85.5 mm
        const imgH = 52;
        const cardH = imgH + 32;

        // ── Encabezado ──
        doc.setFillColor(17, 17, 17);
        doc.rect(0, 0, PW, 30, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.setTextColor(0, 191, 255);
        doc.text("VEREX", PW / 2, 13, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(180, 180, 180);
        doc.text("La expresión de tu mejor versión", PW / 2, 20, { align: "center" });

        // Subtítulo
        doc.setFont("helvetica", "italic");
        doc.setFontSize(10);
        doc.setTextColor(60, 60, 60);
        let sub = nombre ? `Catálogo para: ${nombre}` : "Catálogo de productos";
        if (talla) sub += `  ·  Talla ${_tallasDisplay(talla)}`;
        doc.text(sub, PW / 2, 38, { align: "center" });

        // ── Cuadrícula de productos ──
        let y = 44, col = 0;

        for (const p of lista) {
            const x = mg + col * (colW + gap);

            // Fondo tarjeta
            doc.setFillColor(250, 250, 252);
            doc.setDrawColor(220, 220, 225);
            doc.roundedRect(x, y, colW, cardH, 3, 3, "FD");

            // Imagen (preservando proporción)
            const imgUrl = p.foto || p.img || "";
            const b64 = await imgToBase64Cat(imgUrl);
            if (b64) {
                const maxW = colW - 4, maxH = imgH - 2;
                const props = doc.getImageProperties(b64);
                const ratio = props.width / props.height;
                let dw, dh;
                if (ratio > maxW / maxH) { dw = maxW; dh = maxW / ratio; }
                else                     { dh = maxH; dw = maxH * ratio; }
                const dx = x + 2 + (maxW - dw) / 2;
                const dy = y + 2 + (maxH - dh) / 2;
                doc.addImage(b64, "JPEG", dx, dy, dw, dh, undefined, "MEDIUM");
            } else {
                doc.setFillColor(235, 235, 240);
                doc.rect(x + 2, y + 2, colW - 4, imgH - 2, "F");
                doc.setFont("helvetica", "normal");
                doc.setFontSize(8);
                doc.setTextColor(180, 180, 180);
                doc.text("Sin imagen", x + colW / 2, y + imgH / 2 + 2, { align: "center" });
            }

            // Nombre
            doc.setFont("helvetica", "bold");
            doc.setFontSize(7.5);
            doc.setTextColor(30, 30, 30);
            const lineas = doc.splitTextToSize(p.nombre || "—", colW - 6);
            doc.text(lineas[0], x + colW / 2, y + imgH + 7, { align: "center" });

            // Material
            const matPDF = p.material || detectarMaterial(p.nombre) || "";
            if (matPDF) {
                doc.setFont("helvetica", "bold");
                doc.setFontSize(6.5);
                doc.setTextColor(124, 58, 237);
                doc.text(matPDF, x + colW / 2, y + imgH + 14, { align: "center" });
            }

            // Precio
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9);
            doc.setTextColor(0, 150, 200);
            doc.text(`$${parseFloat(p.precio || 0).toFixed(2)}`, x + colW / 2, y + imgH + 22, { align: "center" });

            // Nota
            const notaPDF = (document.querySelector(`.cat-nota[data-cod="${p.codigo}"]`)?.value || "").trim();
            if (notaPDF) {
                doc.setFont("helvetica", "italic");
                doc.setFontSize(6.5);
                doc.setTextColor(120, 120, 120);
                const notaLine = doc.splitTextToSize(notaPDF, colW - 6)[0];
                doc.text(notaLine, x + colW / 2, y + imgH + 29, { align: "center" });
            }

            col++;
            if (col === cols) {
                col = 0;
                y += cardH + gap;
            }

            if (y + cardH > PH - 16) {
                doc.addPage();
                y = 16; col = 0;
            }
        }

        // ── Pie de página (todas las hojas) ──
        const total = doc.internal.getNumberOfPages();
        for (let i = 1; i <= total; i++) {
            doc.setPage(i);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.5);
            doc.setTextColor(190, 190, 190);
            doc.text(
                `VEREX  ·  Válido hasta: ${expDate}  ·  Página ${i} de ${total}`,
                PW / 2, PH - 5, { align: "center" }
            );
        }

        const fname = nombre
            ? `catalogo-${nombre.toLowerCase().replace(/\s+/g, "-")}.pdf`
            : "catalogo-verex.pdf";
        doc.save(fname);
        toast("✅ PDF generado correctamente", "#22c55e");
        cerrarModalCatalogo();
    } catch (e) {
        console.error(e);
        toast("❌ Error al generar PDF", "#ef4444");
    } finally {
        btn.textContent = "📥 Generar PDF"; btn.disabled = false;
    }
}
