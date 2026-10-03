const CACHE = 'beyachad-v5';
self.addEventListener('push',event=>{
  let payload={};try{payload=event.data?.json() || {};}catch{}
  const url=['/#help','/#inbox'].includes(payload.url)?payload.url:'/#help';
  event.waitUntil(self.registration.showNotification(payload.title || 'ביחד · עדכון מהקהילה',{
    body:payload.body || 'יש עדכון חדש בקהילה שלך.',icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',lang:'he',dir:'rtl',tag:payload.tag || 'community-update',data:{url},
  }));
});
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/', '/demo-product.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'])));
  self.skipWaiting();
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target=['/#help','/#inbox'].includes(event.notification.data?.url)?event.notification.data.url:'/#help';
  const homeUrl = new URL(target, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      const navigated = await existing.navigate(homeUrl);
      return (navigated || existing).focus();
    }
    return self.clients.openWindow(homeUrl);
  }));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (new URL(event.request.url).pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? await caches.match('/') : Response.error())));
});
