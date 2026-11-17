// Hash router. Each route lazy-loads a module exposing render(root) and optional destroy().
import { $, refreshIcons, esc } from './utils/helpers.js';
import { t, state } from './state.js';
import { skeletonCards } from './ui/ui.js';

export const ROUTES = {
  dashboard: { key: 'dashboard', icon: 'layout-dashboard', load: () => import('./modules/dashboard.js') },
  pos: { key: 'pos', icon: 'shopping-cart', load: () => import('./modules/pos.js'), full: true },
  products: { key: 'products', icon: 'package', load: () => import('./modules/products.js') },
  categories: { key: 'categories', icon: 'tags', load: () => import('./modules/categories.js') },
  inventory: { key: 'inventory', icon: 'boxes', load: () => import('./modules/inventory.js') },
  transactions: { key: 'transactions', icon: 'receipt-text', load: () => import('./modules/transactions.js') },
  reports: { key: 'reports', icon: 'bar-chart-3', load: () => import('./modules/reports.js') },
  settings: { key: 'settings', icon: 'settings', load: () => import('./modules/settings.js') },
};
export const DEFAULT_ROUTE = 'dashboard';

let current = null, token = 0;
const listeners = new Set();
export const onRoute = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const currentRoute = () => (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || DEFAULT_ROUTE);
export const go = (route) => { if (currentRoute() === route) navigate(); else location.hash = '#/' + route; };

export async function navigate() {
  const name = ROUTES[currentRoute()] ? currentRoute() : DEFAULT_ROUTE;
  const route = ROUTES[name];
  const my = ++token;
  const view = $('#view');
  if (current && current.mod.destroy) { try { current.mod.destroy(); } catch (e) { console.error(e); } }
  current = null;
  view.classList.toggle('pos-view', name === 'pos');
  view.innerHTML = skeletonCards(name === 'pos' ? 3 : 5);
  document.getElementById('pageTitle').textContent = name === 'dashboard' ? `Halo, ${String(state.user.name).split(" ")[0]}!` : t(route.key);
  document.title = `${t(route.key)} · Smart POS`;
  document.getElementById('crumbs').innerHTML = `<span>Smart POS</span><span>›</span><b>${esc(t(route.key))}</b>`;
  listeners.forEach((fn) => fn(name));
  try {
    const mod = await route.load();
    if (my !== token) return; // user navigated away while loading
    view.innerHTML = '';
    view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
    current = { name, mod };
    await mod.render(view);
    refreshIcons();
    window.scrollTo({ top: 0 });
  } catch (err) {
    console.error(err);
    if (my === token) view.innerHTML = `<div class="card empty"><b>Terjadi kesalahan</b><span>${esc(err.message || err)}</span><div class="mt"><button class="btn btn-primary" onclick="location.reload()">Muat ulang</button></div></div>`;
  }
}

export function startRouter() {
  window.addEventListener('hashchange', navigate);
  navigate();
}
