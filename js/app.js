// App bootstrap: DB init, seed, shell (sidebar / bottom-nav), theme, PWA, network status.
import { openDB, requestPersistence } from './database/db.js';
import { seedIfEmpty } from './database/seed.js';
import { loadSettings, state, applyTheme, t, on, isLow, isOut } from './state.js';
import { ROUTES, startRouter, onRoute, currentRoute } from './router.js';
import { $, $$, esc, icon, refreshIcons, prefs } from './utils/helpers.js';
import { openSheet, toast } from './ui/ui.js';
import { listProducts } from './database/products.db.js';

let deferredInstall = null;

/* ---------- Navigation ---------- */
const SIDE_ORDER = ['dashboard', 'pos', 'products', 'categories', 'inventory', 'transactions', 'reports', 'settings'];
const TAB_ORDER = [['dashboard', 'home'], ['products', 'products'], ['pos', 'cashier'], ['transactions', 'transactions']];
const MORE = ['categories', 'inventory', 'reports', 'settings'];

function renderNav() {
  $('#nav').innerHTML = SIDE_ORDER.map((k) => {
    const r = ROUTES[k];
    return `<a class="nav-item" href="#/${k}" data-route="${k}" title="${esc(t(r.key))}">${icon(r.icon)}<span class="label">${esc(t(r.key))}</span>${k === 'inventory' ? '<span class="badge-count hidden" id="lowBadge">0</span>' : ''}</a>`;
  }).join('');
  $('#bottomNav').innerHTML = TAB_ORDER.map(([k, label]) => `<a href="#/${k}" data-route="${k}" class="${k === 'pos' ? 'center-tab' : ''}" aria-label="${esc(t(label))}">${icon(ROUTES[k].icon)}<span>${esc(t(label))}</span></a>`).join('')
    + `<button id="moreBtn" aria-label="${esc(t('more'))}">${icon('layout-grid')}<span>${esc(t('more'))}</span></button>`;
  renderProfile();
  refreshIcons();
}

function renderProfile() {
  const u = state.user;
  $('#profile').innerHTML = `<div class="avatar">${esc((u.name || '?')[0].toUpperCase())}</div><div class="profile-info"><b>${esc(u.name)}</b><small>${esc(u.role || 'Kasir')}</small></div>`;
  $('#topAvatar').textContent = (u.name || '?')[0].toUpperCase();
}

function setActive(route) {
  $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
  $('#moreBtn')?.classList.toggle('active', MORE.includes(route));
  document.getElementById('app').classList.remove('drawer-open');
  $('#drawerScrim').classList.remove('show');
}

async function refreshBadge() {
  try {
    const list = await listProducts();
    const n = list.filter((p) => isLow(p) || isOut(p)).length;
    const b = $('#lowBadge'); if (!b) return;
    b.textContent = n; b.classList.toggle('hidden', n === 0);
    $('#bellDot').classList.toggle('hidden', n === 0);
  } catch { /* ignore */ }
}

function openMore() {
  const items = MORE.map((k) => `<a class="nav-item" href="#/${k}" data-close style="color:var(--text)">${icon(ROUTES[k].icon)}<span class="label">${esc(t(ROUTES[k].key))}</span></a>`).join('');
  const s = openSheet({
    title: t('more'),
    body: `<div class="nav" style="gap:6px">${items}</div>
      <div class="divider"></div>
      <div class="profile">${$('#profile').innerHTML}</div>
      <div class="setting-row"><div><b>Mode Gelap</b><small>Ubah tampilan aplikasi</small></div><label class="switch"><input type="checkbox" id="moreTheme" ${document.documentElement.dataset.theme === 'dark' ? 'checked' : ''}><span></span></label></div>`,
  });
  s.el.querySelector('#moreTheme').onchange = (e) => setTheme(e.target.checked ? 'dark' : 'light');
}

/* ---------- Theme ---------- */
export function setTheme(theme) {
  prefs.set('theme', theme); applyTheme(theme); updateThemeIcon();
  document.dispatchEvent(new CustomEvent('themechange'));
}
function updateThemeIcon() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#themeBtn').innerHTML = icon(dark ? 'sun' : 'moon'); refreshIcons();
}

/* ---------- Network ---------- */
function updateNet() {
  const online = navigator.onLine;
  const p = $('#netPill');
  p.classList.toggle('offline', !online);
  p.querySelector('.txt').textContent = online ? 'Online' : 'Offline';
}

/* ---------- PWA ---------- */
export function canInstall() { return !!deferredInstall; }
export async function promptInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null; $('#installBtn').classList.add('hidden');
  return outcome === 'accepted';
}
function setupPWA() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('#installBtn').classList.remove('hidden'); });
  window.addEventListener('appinstalled', () => { toast('Smart POS berhasil dipasang', 'success'); $('#installBtn').classList.add('hidden'); });
  $('#installBtn').onclick = promptInstall;
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('service-worker.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Versi baru tersedia. Muat ulang untuk memperbarui.', 'info', 7000);
        });
      });
    }).catch((e) => console.warn('SW gagal didaftarkan', e));
  }
}

/* ---------- Boot ---------- */
async function boot() {
  applyTheme();
  try {
    await openDB();
    const seeded = await seedIfEmpty();
    await loadSettings();
    requestPersistence();
    renderNav();
    updateThemeIcon();
    updateNet();
    window.addEventListener('online', () => { updateNet(); toast('Kembali online', 'success'); });
    window.addEventListener('offline', () => { updateNet(); toast('Anda offline — aplikasi tetap bisa digunakan', 'warning'); });
    $('#collapseBtn').onclick = () => { const c = document.getElementById('app').classList.toggle('collapsed'); prefs.set('collapsed', c); };
    if (prefs.get('collapsed', false)) document.getElementById('app').classList.add('collapsed');
    $('#menuToggle').onclick = () => { const a = document.getElementById('app'); const o = a.classList.toggle('drawer-open'); $('#drawerScrim').classList.toggle('show', o); };
    $('#drawerScrim').onclick = () => { document.getElementById('app').classList.remove('drawer-open'); $('#drawerScrim').classList.remove('show'); };
    $('#themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    document.addEventListener('click', (e) => { if (e.target.closest('#moreBtn')) openMore(); });
    onRoute(setActive);
    on('settings-changed', () => { renderNav(); setActive(currentRoute()); });
    on('user-changed', renderProfile);
    on('data-changed', refreshBadge);
    setupPWA();
    startRouter();
    setActive(currentRoute());
    refreshBadge();
    if (seeded) setTimeout(() => toast('Data demo dimuat. Selamat mencoba!', 'info', 4000), 600);
  } catch (err) {
    console.error(err);
    $('#view').innerHTML = `<div class="card empty"><b>Gagal memulai aplikasi</b><span>${esc(err.message || err)}</span></div>`;
  } finally {
    setTimeout(() => $('#splash').classList.add('done'), 350);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
