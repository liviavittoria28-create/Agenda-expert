// Service worker — app instalável e consulta offline da agenda (RNF01, RNF08)
const VERSION = 'ae-v1';
const SHELL = [
  '/', '/index.html', '/css/app.css', '/manifest.webmanifest', '/icons/icon.svg', '/icons/apple-touch-icon.png',
  '/js/app.js', '/js/api.js', '/js/ui.js', '/js/icons.js',
  '/js/views/login.js', '/js/views/agenda.js', '/js/views/appointment.js', '/js/views/clients.js',
  '/js/views/procedures.js', '/js/views/finance.js', '/js/views/more.js',
];
const API_CACHE = 'ae-api';
const OFFLINE_API = ['/api/me', '/api/appointments', '/api/procedures', '/api/clients', '/api/dashboard'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== API_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'logout') caches.delete(API_CACHE);
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    // Rede primeiro; sem internet, usa a última resposta salva (somente leitura)
    if (!OFFLINE_API.some((p) => url.pathname.startsWith(p))) return;
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(API_CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(e.request).then((r) => {
            if (!r) return new Response(JSON.stringify({ error: 'Sem conexão.', offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } });
            const h = new Headers(r.headers);
            h.set('X-Offline', '1');
            return r.blob().then((b) => new Response(b, { status: 200, headers: h }));
          })
        )
    );
    return;
  }

  if (url.origin === location.origin) {
    // Arquivos do app: rede primeiro (para pegar atualizações), cache como reserva
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
    );
  }
  // fontes do Google e outros endereços externos: o próprio navegador cuida do cache
});
