// Demo data for first launch (realistic Indonesian retail examples).
import { count, replaceAll } from './db.js';
import { uid, dateKey, emojiImage } from '../utils/helpers.js';
import { DEFAULT_SETTINGS } from '../state.js';

// deterministic PRNG so demo data is stable
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

export function ean13(base12) {
  const d = String(base12).padStart(12, '0').slice(0, 12).split('').map(Number);
  const sum = d.reduce((a, n, i) => a + n * (i % 2 ? 3 : 1), 0);
  return d.join('') + ((10 - (sum % 10)) % 10);
}

const CATS = [
  { key: 'sembako', name: 'Sembako', color: '#F59E0B' },
  { key: 'minuman', name: 'Minuman', color: '#0EA5E9' },
  { key: 'makanan', name: 'Makanan & Snack', color: '#EF4444' },
  { key: 'rumah', name: 'Kebutuhan Rumah', color: '#8B5CF6' },
  { key: 'bayi', name: 'Perawatan & Susu', color: '#16A36A' },
];

// [name, sku, cat, buy, sell, stock(initial), min, unit, emoji]
const PRODUCTS = [
  ['Beras Premium 5kg', 'SMB-001', 'sembako', 62000, 72000, 60, 10, 'kg', '🍚'],
  ['Minyak Goreng 1L', 'SMB-002', 'sembako', 15500, 18000, 90, 15, 'btl', '🛢️'],
  ['Gula Pasir 1kg', 'SMB-003', 'sembako', 14000, 17000, 80, 15, 'kg', '🍬'],
  ['Tepung Terigu 1kg', 'SMB-004', 'sembako', 9000, 11500, 50, 10, 'kg', '🌾'],
  ['Telur Ayam 1kg', 'SMB-005', 'sembako', 26000, 30000, 40, 8, 'kg', '🥚'],
  ['Kopi Arabika 200g', 'MNM-001', 'minuman', 42000, 55000, 35, 6, 'pak', '☕'],
  ['Air Mineral 600ml', 'MNM-002', 'minuman', 2200, 3500, 240, 36, 'btl', '💧'],
  ['Teh Celup 25s', 'MNM-003', 'minuman', 5500, 8000, 70, 12, 'box', '🍵'],
  ['Jus Jeruk 250ml', 'MNM-004', 'minuman', 4200, 6500, 60, 12, 'btl', '🍊'],
  ['Kopi Sachet 10s', 'MNM-005', 'minuman', 9500, 13000, 85, 15, 'renteng', '☕'],
  ['Mie Instan Goreng', 'MKN-001', 'makanan', 2600, 3500, 300, 50, 'pcs', '🍜'],
  ['Mie Instan Kuah', 'MKN-002', 'makanan', 2500, 3300, 280, 50, 'pcs', '🍲'],
  ['Biskuit Cokelat', 'MKN-003', 'makanan', 6500, 9000, 75, 12, 'pak', '🍪'],
  ['Keripik Kentang', 'MKN-004', 'makanan', 8000, 11500, 55, 10, 'bks', '🥔'],
  ['Roti Tawar', 'MKN-005', 'makanan', 11000, 15000, 30, 8, 'bks', '🍞'],
  ['Sabun Mandi Batang', 'RMH-001', 'rumah', 2800, 4500, 120, 20, 'pcs', '🧼'],
  ['Detergen Bubuk 800g', 'RMH-002', 'rumah', 17500, 22000, 45, 8, 'pak', '🧺'],
  ['Sabun Cuci Piring 400ml', 'RMH-003', 'rumah', 8500, 12000, 55, 10, 'btl', '🍽️'],
  ['Pembersih Lantai 800ml', 'RMH-004', 'rumah', 11000, 15500, 40, 8, 'btl', '🧽'],
  ['Tisu Wajah 250s', 'RMH-005', 'rumah', 9500, 13500, 65, 10, 'pak', '🧻'],
  ['Susu UHT Cokelat 1L', 'SSU-001', 'bayi', 15000, 19000, 50, 10, 'kotak', '🥛'],
  ['Susu UHT Full Cream 1L', 'SSU-002', 'bayi', 15500, 19500, 50, 10, 'kotak', '🥛'],
  ['Pasta Gigi 120g', 'SSU-003', 'bayi', 8000, 11500, 70, 12, 'pcs', '🪥'],
  ['Shampo Sachet 10s', 'SSU-004', 'bayi', 8500, 12000, 60, 12, 'renteng', '🧴'],
];

const CUSTOMERS = [
  ['Budi Santoso', '081234560001'], ['Siti Rahmawati', '081234560002'], ['Agus Prasetyo', '081234560003'],
  ['Dewi Lestari', '081234560004'], ['Rina Marlina', '081234560005'],
];

export function buildDemoData() {
  const R = rng(20260101);
  const now = new Date();
  const created = new Date(now.getTime() - 45 * 86400000).toISOString();

  const categories = CATS.map((c) => ({ id: uid(), name: c.name, color: c.color, createdAt: created, _k: c.key }));
  const catByKey = Object.fromEntries(categories.map((c) => [c._k, c]));
  categories.forEach((c) => delete c._k);

  const movements = [];
  const products = PRODUCTS.map((p, i) => {
    const cat = catByKey[p[2]];
    const prod = {
      id: uid(), name: p[0], sku: p[1], barcode: ean13('899' + String(100000 + i * 137).padStart(9, '0')),
      categoryId: cat.id, purchasePrice: p[3], sellingPrice: p[4], stock: p[5], minStock: p[6], unit: p[7],
      image: emojiImage(p[8], cat.color), description: `${p[0]} - produk demo`, createdAt: created, updatedAt: created,
    };
    movements.push({ id: uid(), productId: prod.id, productName: prod.name, sku: prod.sku, unit: prod.unit, type: 'initial', qty: prod.stock, prevStock: 0, newStock: prod.stock, date: created, notes: 'Stok awal', ref: '', by: 'Sistem' });
    return prod;
  });

  const customers = CUSTOMERS.map((c) => ({ id: uid(), name: c[0], phone: c[1], createdAt: created }));
  const user = { id: 'u-admin', name: 'Kasir Utama', role: 'Pemilik', createdAt: created };

  // Sample transactions across the past 30 days (stock deducted consistently)
  const methods = ['cash', 'cash', 'cash', 'transfer', 'qris', 'qris', 'other'];
  const transactions = [];
  for (let day = 29; day >= 0; day--) {
    const d = new Date(now); d.setDate(d.getDate() - day);
    if (day === 20) {
      [0, 1, 6, 10].forEach((i) => {
        const p = products[i]; const q = 40;
        const when = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7, 30).toISOString();
        movements.push({ id: uid(), productId: p.id, productName: p.name, sku: p.sku, unit: p.unit, type: 'in', qty: q, prevStock: p.stock, newStock: p.stock + q, date: when, notes: 'Pembelian dari supplier', ref: '', by: 'Kasir Utama' });
        p.stock += q;
      });
    }
    const n = day === 0 ? 4 : 1 + Math.floor(R() * 3) + (d.getDay() === 0 || d.getDay() === 6 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const when = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8 + Math.floor(R() * 12), Math.floor(R() * 60), Math.floor(R() * 60));
      if (when > now) when.setHours(Math.max(0, now.getHours() - 1));
      const lineCount = 1 + Math.floor(R() * 4);
      const chosen = new Set(); const lines = [];
      while (chosen.size < lineCount) chosen.add(Math.floor(R() * products.length));
      for (const idx of chosen) {
        const p = products[idx]; const qty = 1 + Math.floor(R() * 3);
        if (p.stock - qty < 0) continue;
        lines.push({ productId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty, price: p.sellingPrice, cost: p.purchasePrice, discount: 0 });
      }
      if (!lines.length) continue;
      const gross = lines.reduce((a, l) => a + l.price * l.qty, 0);
      const discount = R() < 0.18 ? Math.round(gross * 0.05 / 500) * 500 : 0;
      if (discount) lines[lines.length - 1].discount = discount;
      const net = gross - discount;
      const method = methods[Math.floor(R() * methods.length)];
      const paid = method === 'cash' ? Math.ceil(net / 5000) * 5000 + (R() < 0.3 ? 5000 : 0) : net;
      const cust = R() < 0.35 ? customers[Math.floor(R() * customers.length)] : null;
      const idDate = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, '0')}${String(when.getDate()).padStart(2, '0')}`;
      const id = `TRX-${idDate}-${uid().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
      const iso = when.toISOString();
      transactions.push({
        id, createdAt: iso, dateKey: dateKey(when), cashier: 'Kasir Utama',
        customerId: cust?.id || null, customerName: cust?.name || 'Umum', items: lines,
        gross, discount, net, tax: 0, taxPercent: 0, total: net,
        cogs: lines.reduce((a, l) => a + l.cost * l.qty, 0),
        paymentMethod: method, reference: '', paid, change: paid - net, remaining: 0,
        payments: [{ at: iso, method, amount: net, received: paid }],
        status: 'completed', notes: '', audit: [{ at: iso, action: 'create', by: 'Kasir Utama', note: 'Transaksi dibuat' }],
      });
      const voidIt = day === 3 && k === 0;
      for (const l of lines) {
        const p = products.find((x) => x.id === l.productId);
        movements.push({ id: uid(), productId: p.id, productName: p.name, sku: p.sku, unit: p.unit, type: 'sale', qty: -l.qty, prevStock: p.stock, newStock: p.stock - l.qty, date: iso, notes: `Penjualan ${id}`, ref: id, by: 'Kasir Utama' });
        p.stock -= l.qty;
      }
      if (voidIt) {
        const t = transactions[transactions.length - 1];
        const at = new Date(when.getTime() + 600000).toISOString();
        t.status = 'void'; t.voidedAt = at; t.voidReason = 'Salah input oleh kasir (demo)'; t.voidedBy = 'Kasir Utama';
        t.audit.push({ at, action: 'void', by: 'Kasir Utama', note: t.voidReason });
        for (const l of t.items) {
          const p = products.find((x) => x.id === l.productId);
          movements.push({ id: uid(), productId: p.id, productName: p.name, sku: p.sku, unit: p.unit, type: 'void', qty: l.qty, prevStock: p.stock, newStock: p.stock + l.qty, date: at, notes: 'Pembatalan ' + t.id + ': ' + t.voidReason, ref: t.id, by: 'Kasir Utama' });
          p.stock += l.qty;
        }
      }
    }
  }

  // A few products with low / out of stock (via explicit stock-out movements)
  [[2, 'low'], [14, 'low'], [8, 'out'], [18, 'low']].forEach(([i, mode]) => {
    const p = products[i]; const target = mode === 'out' ? 0 : Math.max(1, p.minStock - 2);
    const delta = target - p.stock; if (delta >= 0) return;
    movements.push({ id: uid(), productId: p.id, productName: p.name, sku: p.sku, unit: p.unit, type: 'out', qty: delta, prevStock: p.stock, newStock: target, date: new Date(now.getTime() + 1000).toISOString(), notes: mode === 'out' ? 'Habis / kedaluwarsa dibuang' : 'Barang rusak / retur', ref: '', by: 'Kasir Utama' });
    p.stock = target;
  });

  const settings = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value }));
  return { products, categories, transactions, customers, stock_movements: movements, settings, users: [user] };
}

export async function seedIfEmpty() {
  const n = await count('products');
  const c = await count('categories');
  const s = await count('settings');
  if (n === 0 && c === 0 && s === 0) { await replaceAll(buildDemoData()); return true; }
  return false;
}
export async function loadDemo() { await replaceAll(buildDemoData()); }
export async function resetEmpty() {
  await replaceAll({ settings: Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })), users: [{ id: 'u-admin', name: 'Kasir Utama', role: 'Pemilik', createdAt: new Date().toISOString() }] });
}
