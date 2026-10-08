// Service worker de VEREX Chats (solo cubre /chats*: no toca el resto del Admin).
// - Muestra los avisos push de chats nuevos / mensajes de clientes, aunque la app esté cerrada.
// - Al tocar el aviso, abre (o enfoca) la app directamente en ese chat.
// - Guarda la app para que abra rápido y muestre la pantalla aunque falle la red.
const CACHE = "verex-chats-v1";
const SHELL = ["chats.html", "chats.webmanifest", "images/chats-icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("verex-chats-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Red primero para la app (siempre la última versión); la copia guardada solo si no hay red.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || !/\/chats(\.html|\.webmanifest)?$/.test(url.pathname)) return;
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "VEREX Chats", body: e.data ? e.data.text() : "" }; }
  const title = d.title || "VEREX Chats";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    wins.forEach(w => w.postMessage({ type: "verex-chats-push", chatId: d.chatId || "" }));
    // Con la app abierta y a la vista, la app ya avisa (sonido): igual se muestra el aviso del sistema
    // si está en segundo plano o con la pantalla apagada.
    const visible = wins.some(w => w.visibilityState === "visible" && w.url.includes("chats"));
    if (visible && d.chatId) return;
    await self.registration.showNotification(title, {
      body: d.body || "",
      tag: d.chatId ? `chat-${d.chatId}` : "verex-chats",
      renotify: true,
      icon: "images/chats-icon-192.png",
      vibrate: [120, 60, 120],
      data: { url: d.url || "chats.html" },
    });
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "chats.html", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = wins.find(w => new URL(w.url).pathname.endsWith("/chats.html"));
    if (app) { await app.focus(); app.postMessage({ type: "verex-chats-open", url: target }); return; }
    await self.clients.openWindow(target);
  })());
});
