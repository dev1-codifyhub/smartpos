// Backup / restore / reset. Backups are plain JSON containing every object store.
import { exportAll, replaceAll, STORES } from '../database/db.js';
import { loadDemo, resetEmpty } from '../database/seed.js';
import { download, readText } from '../utils/helpers.js';
import { loadSettings } from '../state.js';

const APP = 'smart-pos';

export async function exportBackup() {
  const data = await exportAll();
  const payload = { app: APP, version: 1, exportedAt: new Date().toISOString(), counts: Object.fromEntries(STORES.map((s) => [s, data[s].length])), data };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  download(`smart-pos-backup-${stamp}.json`, JSON.stringify(payload), 'application/json');
  return payload.counts;
}

export function validateBackup(obj) {
  if (!obj || obj.app !== APP || typeof obj.data !== 'object') throw new Error('File bukan backup Smart POS yang valid');
  for (const s of STORES) if (obj.data[s] !== undefined && !Array.isArray(obj.data[s])) throw new Error(`Data "${s}" pada backup rusak`);
  const prod = obj.data.products || [];
  if (prod.some((p) => !p.id || !p.name)) throw new Error('Data produk pada backup tidak valid');
  const tx = obj.data.transactions || [];
  if (tx.some((t) => !t.id || !Array.isArray(t.items))) throw new Error('Data transaksi pada backup tidak valid');
  return obj;
}

export async function importBackupFile(file) {
  let obj;
  try { obj = JSON.parse(await readText(file)); } catch { throw new Error('File JSON tidak dapat dibaca'); }
  validateBackup(obj);
  const safety = await exportAll(); // in case restore fails mid-way the tx rolls back anyway
  try { await replaceAll(obj.data); } catch (e) { await replaceAll(safety); throw e; }
  await loadSettings();
  return Object.fromEntries(STORES.map((s) => [s, (obj.data[s] || []).length]));
}

export async function clearAllData() { await resetEmpty(); await loadSettings(); }
export async function restoreDemo() { await loadDemo(); await loadSettings(); }
