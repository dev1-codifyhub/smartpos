// Global app state: settings (persisted in IndexedDB), current user, and a tiny event bus.
import { getAll, put, getById, withTx, tPut } from './database/db.js';
import { setFormatConfig } from './utils/format.js';
import { prefs } from './utils/helpers.js';

export const DEFAULT_SETTINGS = {
  storeName: 'Toko Sejahtera',
  storeLogo: '',
  address: 'Jl. Merdeka No. 10, Jakarta Pusat',
  phone: '0812-3456-7890',
  receiptFooter: 'Terima kasih atas kunjungan Anda!\nBarang yang sudah dibeli tidak dapat ditukar.',
  currency: 'IDR',
  receiptWidth: '58',
  taxEnabled: false,
  taxName: 'PPN',
  taxPercent: 11,
  defaultDiscount: 0,
  lowStockThreshold: 5,
  allowPartial: true,
  currencyFormat: 'symbol',
};

export const state = {
  settings: { ...DEFAULT_SETTINGS },
  user: { id: 'u-admin', name: 'Kasir Utama', role: 'Pemilik' },
};

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => { bus.addEventListener(name, fn); return () => bus.removeEventListener(name, fn); };

export async function loadSettings() {
  const rows = await getAll('settings');
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  state.settings = s;
  setFormatConfig({ mode: s.currencyFormat });
  const users = await getAll('users');
  if (users.length) state.user = users[0];
  return s;
}

export async function saveSettings(patch) {
  await withTx('settings', 'readwrite', async (t) => {
    for (const [key, value] of Object.entries(patch)) await tPut(t, 'settings', { key, value });
  });
  Object.assign(state.settings, patch);
  setFormatConfig({ mode: state.settings.currencyFormat });
  emit('settings-changed', patch);
}

export async function saveUser(patch) {
  state.user = { ...state.user, ...patch };
  await put('users', state.user);
  emit('user-changed', state.user);
}

// UI preferences kept in LocalStorage
export function applyTheme(theme = prefs.get('theme', 'dark')) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#101010' : '#DC2626');
}

// Low-stock rule: product minStock wins; falls back to global threshold.
export const stockLimit = (p) => (p.minStock > 0 ? p.minStock : state.settings.lowStockThreshold);
export const isOut = (p) => p.stock <= 0;
export const isLow = (p) => p.stock > 0 && p.stock <= stockLimit(p);

// language
const DICT = {
  id: { dashboard: 'Dashboard', pos: 'Kasir / POS', products: 'Produk', categories: 'Kategori', inventory: 'Stok Barang', transactions: 'Transaksi', reports: 'Laporan', settings: 'Pengaturan', home: 'Home', cashier: 'Kasir', more: 'Lainnya' },
  en: { dashboard: 'Dashboard', pos: 'Cashier / POS', products: 'Products', categories: 'Categories', inventory: 'Inventory', transactions: 'Transactions', reports: 'Reports', settings: 'Settings', home: 'Home', cashier: 'Cashier', more: 'More' },
};
export const t = (k) => (DICT[prefs.get('lang', 'id')] || DICT.id)[k] || k;
export { getById };
