// ── Motor de mejora de fotos ────────────────────────────────────────────────
// Usa Real-ESRGAN (realesrgan-ncnn-vulkan) — una red neuronal entrenada para
// denoise + realce de detalle, corriendo localmente vía GPU (Vulkan) o CPU.
// Es open-source y gratis; no es Topaz, pero usa el mismo tipo de enfoque
// (red entrenada, no un filtro simple) y en fotos de producto da resultados
// mucho más naturales que un sharpen genérico.
//
// El binario NO se guarda en git (pesa ~60-90MB y es específico de Windows):
// se descarga una sola vez, la primera vez que se usa la app, directo desde
// los releases oficiales de GitHub, y queda cacheado en la carpeta de datos
// de usuario de Electron.
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFile } = require("child_process");
const AdmZip = require("adm-zip");
const sharp = require("sharp");

const GITHUB_API_LATEST = "https://api.github.com/repos/xinntao/Real-ESRGAN/releases/latest";
const MODEL_NAME = "realesrgan-x4plus"; // modelo general de fotos (no anime)

function engineDir(userDataPath) {
    return path.join(userDataPath, "realesrgan-engine");
}

function binPath(userDataPath) {
    const dir = engineDir(userDataPath);
    return process.platform === "win32"
        ? path.join(dir, "realesrgan-ncnn-vulkan.exe")
        : path.join(dir, "realesrgan-ncnn-vulkan");
}

function isEngineInstalled(userDataPath) {
    return fs.existsSync(binPath(userDataPath));
}

// Descarga un JSON/binario por HTTPS siguiendo redirects (GitHub redirige
// los assets de releases a S3, y npm-style https.get no sigue redirects solo).
function httpGetFollow(url, headers, onResponse, onError, redirectsLeft) {
    redirectsLeft = redirectsLeft == null ? 5 : redirectsLeft;
    const req = https.get(url, { headers }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            if (redirectsLeft <= 0) { onError(new Error("Demasiados redirects")); return; }
            httpGetFollow(res.headers.location, headers, onResponse, onError, redirectsLeft - 1);
            return;
        }
        onResponse(res);
    });
    req.on("error", onError);
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        httpGetFollow(
            url,
            { "User-Agent": "verex-mejora-fotos" },
            (res) => {
                if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} al consultar ${url}`)); return; }
                let data = "";
                res.setEncoding("utf8");
                res.on("data", (c) => (data += c));
                res.on("end", () => {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                });
            },
            reject
        );
    });
}

function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        httpGetFollow(
            url,
            { "User-Agent": "verex-mejora-fotos" },
            (res) => {
                if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} al descargar ${url}`)); return; }
                const total = parseInt(res.headers["content-length"] || "0", 10);
                let received = 0;
                res.on("data", (chunk) => {
                    received += chunk.length;
                    if (onProgress) onProgress(total ? received / total : null, received, total);
                });
                res.pipe(file);
                file.on("finish", () => file.close(() => resolve()));
                res.on("error", reject);
            },
            reject
        );
        file.on("error", reject);
    });
}

// Busca en la última release de xinntao/Real-ESRGAN el ZIP de Windows,
// lo descarga y lo extrae en la carpeta del motor.
async function instalarMotor(userDataPath, onProgress) {
    const dir = engineDir(userDataPath);
    fs.mkdirSync(dir, { recursive: true });

    if (onProgress) onProgress({ etapa: "buscando", pct: 0 });
    const release = await fetchJson(GITHUB_API_LATEST);
    const asset = (release.assets || []).find(
        (a) => /windows/i.test(a.name) && /\.zip$/i.test(a.name)
    );
    if (!asset) throw new Error("No se encontró el paquete de Windows en la última release de Real-ESRGAN");

    const zipPath = path.join(dir, asset.name);
    if (onProgress) onProgress({ etapa: "descargando", pct: 0 });
    await downloadFile(asset.browser_download_url, zipPath, (frac) => {
        if (onProgress) onProgress({ etapa: "descargando", pct: frac == null ? null : Math.round(frac * 100) });
    });

    if (onProgress) onProgress({ etapa: "extrayendo", pct: 100 });
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(dir, true);
    fs.unlinkSync(zipPath);

    if (!fs.existsSync(binPath(userDataPath))) {
        throw new Error("Se descargó el paquete pero no se encontró el ejecutable esperado dentro del ZIP");
    }
    if (onProgress) onProgress({ etapa: "listo", pct: 100 });
}

// Corre el binario sobre una sola imagen. Devuelve la ruta del archivo
// temporal ya escalado/denoised por la red (sin mezclar todavía).
function correrRealesrgan(userDataPath, inputPath, outDir, opts) {
    return new Promise((resolve, reject) => {
        const bin = binPath(userDataPath);
        const outPath = path.join(outDir, `ia-${path.basename(inputPath, path.extname(inputPath))}.png`);
        const args = [
            "-i", inputPath,
            "-o", outPath,
            "-n", MODEL_NAME,
            "-s", String(opts.scale || 4),
        ];
        if (opts.useCpu) args.push("-g", "-1");

        execFile(bin, args, { cwd: engineDir(userDataPath), timeout: 120000 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error((stderr || err.message || "").toString().trim() || "Error desconocido al ejecutar el motor"));
                return;
            }
            if (!fs.existsSync(outPath)) { reject(new Error("El motor no generó ningún archivo de salida")); return; }
            resolve(outPath);
        });
    });
}

// Mezcla la imagen procesada por la IA con la original, según intensidad
// (0 = sin cambios, 100 = efecto completo de la IA). Esto es lo que evita
// el look "artificial" — se aplica el mismo enfoque que un profesional
// haría a mano: aplicar el filtro fuerte y bajarle la opacidad al ojo.
async function mezclarConOriginal(inputPath, iaPath, outputPath, opts) {
    const intensidad = Math.max(0, Math.min(100, opts.intensidad != null ? opts.intensidad : 55));
    const t = intensidad / 100;
    const mismoTamano = opts.modo !== "ampliar";

    const original = sharp(inputPath);
    const metaOriginal = await original.metadata();

    let base = original;
    let overlay = sharp(iaPath);

    if (mismoTamano) {
        // Volvemos la salida de la IA al tamaño original — el pase por la red
        // funciona como un denoise+sharpen inteligente, no como upscaling.
        overlay = overlay.resize(metaOriginal.width, metaOriginal.height, { kernel: "lanczos3" });
    } else {
        // Conservamos el tamaño ampliado: escalamos el original hacia arriba
        // para poder mezclarlo pixel a pixel con la salida de la IA.
        const metaIA = await sharp(iaPath).metadata();
        base = original.resize(metaIA.width, metaIA.height, { kernel: "lanczos3" });
    }

    const overlayBuf = await overlay.ensureAlpha(t).toBuffer();
    const baseBuf = await base.toBuffer();

    await sharp(baseBuf)
        .composite([{ input: overlayBuf, blend: "over" }])
        .jpeg({ quality: 92 })
        .toFile(outputPath);
}

// Procesa una imagen de punta a punta: IA → mezcla → limpia temporales.
async function procesarImagen(userDataPath, inputPath, outputPath, opts) {
    const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "verex-mejora-"));
    try {
        const iaPath = await correrRealesrgan(userDataPath, inputPath, tmpDir, opts);
        await mezclarConOriginal(inputPath, iaPath, outputPath, opts);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

module.exports = {
    engineDir,
    binPath,
    isEngineInstalled,
    instalarMotor,
    procesarImagen,
    mezclarConOriginal, // exportado aparte para poder probarlo sin el binario
};
