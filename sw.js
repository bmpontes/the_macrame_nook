// Service worker: permite abrir a app rapidamente e mostra a última versão quando há rede.
const CACHE = 'tmn-v14';
const SHELL = [
  './', './index.html', './styles.css', './config.js', './js/app.js', './js/db.js',
  './manifest.webmanifest', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/logo.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return; // dados: sempre da rede

  if (url.origin === location.origin) {
    // Ficheiros da app: rede primeiro (para receber atualizações), cache se estiver offline.
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    // Biblioteca com versão fixa: cache primeiro.
    e.respondWith(
      caches.match(req).then((r) => r || fetch(req).then((res) => {
        const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
      }))
    );
  }
});
