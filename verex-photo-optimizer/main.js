'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const DEV = process.argv.includes('--dev');
const EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
let win = null;

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  const files = argv.filter((a) => EXTS.has(path.extname(a).toLowerCase()) && fs.existsSync(a));
  if (files.length && win) win.webContents.send('open-files', files);
});

function settingsFile() { return path.join(app.getPath('userData'), 'verex-photo-optimizer.json'); }

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0b0b0c', title: 'VEREX PHOTO OPTIMIZER', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  if (!DEV) Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());   // soltar un archivo no navega
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
  win.webContents.once('did-finish-load', () => {
    const files = process.argv.slice(1).filter((a) => EXTS.has(path.extname(a).toLowerCase()) && fs.existsSync(a));
    if (files.length) win.webContents.send('open-files', files);
  });
}

app.whenReady().then(() => { app.setAppUserModelId('com.verexstore.photooptimizer'); createWindow(); });
app.on('window-all-closed', () => app.quit());

// ── Archivos ────────────────────────────────────────────────────────────────
async function expand(paths, depth = 0) {
  const out = [];
  for (const p of paths || []) {
    try {
      const st = await fsp.stat(p);
      if (st.isDirectory() && depth < 3) {
        const names = (await fsp.readdir(p)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        out.push(...(await expand(names.filter((n) => !n.startsWith('_originales_verex')).map((n) => path.join(p, n)), depth + 1)));
      } else if (st.isFile() && EXTS.has(path.extname(p).toLowerCase())) out.push(p);
    } catch (_) { /* archivo inaccesible: se ignora */ }
  }
  return out;
}

ipcMain.handle('dialog:openImages', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Abrir fotografías', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:chooseFolder', async (_e, title) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'Seleccionar carpeta', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:confirm', async (_e, o) => {
  const r = await dialog.showMessageBox(win, {
    type: o.type || 'warning', title: o.title || 'VEREX PHOTO OPTIMIZER', message: o.message, detail: o.detail || '',
    buttons: o.buttons || ['Continuar', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true,
  });
  return r.response;
});
ipcMain.handle('fs:expandPaths', (_e, paths) => expand(paths));
ipcMain.handle('fs:readFile', async (_e, p) => {
  if (!EXTS.has(path.extname(p).toLowerCase())) throw new Error('Formato no admitido');
  return new Uint8Array(await fsp.readFile(p));          // solo lectura: el original nunca se modifica
});
ipcMain.handle('shell:showItem', (_e, p) => { shell.showItemInFolder(p); });
ipcMain.handle('app:version', () => app.getVersion());

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

async function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 2; i < 10000; i++) { const c = path.join(dir, `${name} (${i})${ext}`); if (!fs.existsSync(c)) return c; }
  throw new Error('No se pudo elegir un nombre libre');
}

/**
 * Escritura de resultados. Reglas de seguridad:
 *  - 'copy'      → junto al original, con sufijo; nunca pisa archivos existentes (numera).
 *  - 'folder'    → en la carpeta elegida; si coincidiera con el original, cae a copia numerada.
 *  - 'overwrite' → solo aquí se toca el original, y ANTES se guarda una copia en _originales_verex/.
 */
ipcMain.handle('export:write', async (_e, job) => {
  const { srcPath, mode, folder, suffix, ext, data } = job;
  const srcDir = path.dirname(srcPath), stem = path.parse(srcPath).name;
  let target;
  if (mode === 'overwrite') {
    target = path.join(srcDir, stem + ext);
    if (fs.existsSync(target) && same(target, srcPath)) {
      const bdir = path.join(srcDir, '_originales_verex');
      await fsp.mkdir(bdir, { recursive: true });
      const backup = path.join(bdir, path.basename(srcPath));
      if (!fs.existsSync(backup)) await fsp.copyFile(srcPath, backup);   // el primer original se conserva siempre
    }
  } else if (mode === 'folder') {
    if (!folder) throw new Error('No se eligió carpeta de destino');
    await fsp.mkdir(folder, { recursive: true });
    target = path.join(folder, stem + ext);
    if (same(target, srcPath)) target = await uniquePath(path.join(folder, stem + (suffix || '_verex') + ext));
    else if (fs.existsSync(target)) target = await uniquePath(target);
  } else {
    target = await uniquePath(path.join(srcDir, stem + (suffix || '_verex') + ext));
  }
  const tmp = target + '.tmp-verex';
  await fsp.writeFile(tmp, Buffer.from(data));
  await fsp.rename(tmp, target);
  return target;
});

// ── Ajustes ─────────────────────────────────────────────────────────────────
ipcMain.handle('settings:load', async () => {
  try { return JSON.parse(await fsp.readFile(settingsFile(), 'utf8')); } catch (_) { return {}; }
});
ipcMain.handle('settings:save', async (_e, s) => {
  try { await fsp.mkdir(path.dirname(settingsFile()), { recursive: true }); await fsp.writeFile(settingsFile(), JSON.stringify(s, null, 2)); return true; }
  catch (_) { return false; }
});
