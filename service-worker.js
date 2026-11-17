/* Smart POS service worker
 * - Precaches the static app shell so the app works offline after the first load.
 * - NEVER caches business data: transactions/products live in IndexedDB (not touched here).
 * - Only static GET requests (same-origin files + Google Fonts) are cached.
 */
const VERSION = 'v1.1.0';
const SHELL_CACHE = `smart-pos-shell-${VERSION}`;
const RUNTIME_CACHE = `smart-pos-runtime-${VERSION}`;

const SHELL = [
  './', 'index.html', 'offline.html', 'manifest.json',
  'css/variables.css', 'css/main.css', 'css/layout.css', 'css/components.css', 'css/responsive.css', 'css/print.css',
  'js/app.js', 'js/router.js', 'js/state.js',
  'js/database/db.js', 'js/database/products.db.js', 'js/database/transactions.db.js', 'js/database/seed.js',
  'js/modules/dashboard.js', 'js/modules/pos.js', 'js/modules/products.js', 'js/modules/categories.js', 'js/modules/inventory.js',
  'js/modules/transactions.js', 'js/modules/reports.js', 'js/modules/barcode.js', 'js/modules/settings.js',
  'js/services/receipt.service.js', 'js/services/export.service.js', 'js/services/backup.service.js', 'js/services/analytics.js',
  'js/ui/ui.js', 'js/ui/charts.js', 'js/ui/camera.js',
  'js/utils/format.js', 'js/utils/validation.js', 'js/utils/helpers.js', 'js/utils/print.js',
  'assets/vendor/lucide.min.js', 'assets/vendor/chart.umd.js', 'assets/vendor/JsBarcode.all.min.js', 'assets/vendor/html5-qrcode.min.js', 'assets/vendor/jspdf.umd.min.js',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png', 'assets/icons/apple-touch-icon.png', 'assets/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('smart-pos-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Page navigations: network first, fall back to cached shell, then offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put('index.html', copy)); return res; })
        .catch(async () => (await caches.match('index.html')) || (await caches.match('offline.html')))
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return; // never touch other origins / APIs

  // Static assets: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(sameOrigin ? SHELL_CACHE : RUNTIME_CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
