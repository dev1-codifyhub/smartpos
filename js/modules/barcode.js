// Barcode utilities: camera scanner (html5-qrcode), USB/keyboard-wedge scanner, barcode rendering/generation.
import { esc, icon, refreshIcons, beep, sleep } from '../utils/helpers.js';
import { ean13 } from '../database/seed.js';

/* ---------- Generation / rendering ---------- */
export function generateBarcodeValue(existing = new Set()) {
  for (let i = 0; i < 50; i++) {
    const body = '899' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    const code = ean13(body);
    if (!existing.has(code)) return code;
  }
  return ean13('899' + Date.now().toString().slice(-9));
}

export function renderBarcode(target, value, opts = {}) {
  if (!window.JsBarcode || !value) return false;
  const base = { width: 2, height: 54, fontSize: 14, margin: 6, displayValue: true, ...opts };
  const formats = /^\d{13}$/.test(value) ? ['EAN13', 'CODE128'] : ['CODE128'];
  for (const format of formats) {
    try { window.JsBarcode(target, value, { ...base, format }); return true; } catch { /* try next (e.g. invalid EAN checksum) */ }
  }
  return false;
}

/* ---------- USB / Bluetooth keyboard-wedge scanner ----------
 * Scanners type digits very fast then press Enter. We detect bursts (<45 ms between keys)
 * outside of regular inputs and report the finished code. */
export function attachKeyboardScanner(onCode, { minLength = 4 } = {}) {
  let buf = ''; let last = 0;
  const handler = (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const now = performance.now();
    if (e.key === 'Enter') {
      if (buf.length >= minLength && !typing) { e.preventDefault(); const code = buf; buf = ''; onCode(code); }
      buf = ''; return;
    }
    if (e.key.length !== 1) return;
    if (now - last > 80) buf = '';
    last = now;
    if (!typing || (now - last) < 45) buf += e.key;
  };
  document.addEventListener('keydown', handler, true);
  return () => document.removeEventListener('keydown', handler, true);
}

/* ---------- Camera scanner ----------
 * openScanner({ title, continuous, onScan: async (code) => ({ok:boolean, message:string}) })
 * Always includes a manual-input fallback. */
export function openScanner({ title = 'Scan Barcode', continuous = true, onScan }) {
  const ov = document.createElement('div');
  ov.className = 'scanner';
  ov.innerHTML = `
    <div class="scanner-top"><b style="font-size:17px">${esc(title)}</b><button class="btn btn-sm" data-cancel>${icon('x')} Batal</button></div>
    <div class="scanner-view">
      <div id="qr-reader"></div>
      <div class="scan-frame"><div class="scan-line"></div></div>
    </div>
    <div class="scanner-bottom">
      <div class="scan-status" id="scanStatus">Menyiapkan kamera…</div>
      <div class="flex" style="gap:8px">
        <button class="btn hidden" data-torch>${icon('flashlight')} Senter</button>
        <form class="input-group grow" id="manualForm" autocomplete="off">
          <input class="input" name="code" inputmode="numeric" placeholder="Ketik barcode / SKU manual" aria-label="Barcode manual">
          <button class="btn btn-primary" type="submit">Cari</button>
        </form>
      </div>
    </div>`;
  document.body.appendChild(ov);
  refreshIcons();
  const statusEl = ov.querySelector('#scanStatus');
  const setStatus = (msg, kind = '') => { statusEl.textContent = msg; statusEl.className = 'scan-status ' + kind; };

  let scanner = null, running = false, closed = false, torchOn = false, lastCode = '', lastAt = 0, busy = false;

  async function handle(code, fromManual = false) {
    code = String(code || '').trim();
    if (!code || busy) return;
    const now = Date.now();
    if (!fromManual && code === lastCode && now - lastAt < 2000) return; // cooldown against repeated reads
    lastCode = code; lastAt = now; busy = true;
    try {
      const res = (await onScan(code)) || { ok: true };
      beep(res.ok ? 'scan' : 'error');
      setStatus(res.message || (res.ok ? `✓ ${code}` : `Barcode ${code} tidak terdaftar`), res.ok ? 'ok' : 'bad');
      if (res.ok && !continuous) close();
    } finally { busy = false; }
  }

  async function close() {
    if (closed) return; closed = true;
    try { if (scanner && running) await scanner.stop(); } catch { /* ignore */ }
    try { scanner && scanner.clear(); } catch { /* ignore */ }
    ov.remove();
  }
  ov.querySelector('[data-cancel]').onclick = close;
  ov.querySelector('#manualForm').onsubmit = (e) => { e.preventDefault(); const i = e.target.code; handle(i.value, true); i.value = ''; };
  const esc2 = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); } };
  document.addEventListener('keydown', esc2);

  (async () => {
    if (!window.Html5Qrcode) { setStatus('Pemindai kamera tidak tersedia. Gunakan input manual.', 'bad'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setStatus('Kamera tidak didukung di browser/koneksi ini (butuh HTTPS). Gunakan input manual.', 'bad'); return; }
    try {
      scanner = new window.Html5Qrcode('qr-reader', { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
      const cfg = { fps: 12, qrbox: (w, h) => ({ width: Math.floor(Math.min(w * 0.8, 340)), height: Math.floor(Math.min(h * 0.45, 190)) }) };
      try {
        await scanner.start({ facingMode: { ideal: 'environment' } }, cfg, (txt) => handle(txt), () => {});
      } catch (err) {
        // fallback: any available camera
        const cams = await window.Html5Qrcode.getCameras();
        if (!cams.length) throw err;
        await scanner.start(cams[cams.length - 1].id, cfg, (txt) => handle(txt), () => {});
      }
      running = true;
      setStatus('Arahkan kamera ke barcode…');
      await sleep(400);
      try {
        const caps = scanner.getRunningTrackCapabilities && scanner.getRunningTrackCapabilities();
        if (caps && caps.torch) {
          const tb = ov.querySelector('[data-torch]'); tb.classList.remove('hidden');
          tb.onclick = async () => { torchOn = !torchOn; try { await scanner.applyVideoConstraints({ advanced: [{ torch: torchOn }] }); } catch { torchOn = !torchOn; setStatus('Senter tidak tersedia', 'bad'); } };
        }
      } catch { /* torch unsupported */ }
    } catch (err) {
      const denied = /permission|denied|notallowed/i.test(String(err && (err.name || err.message || err)));
      setStatus(denied ? 'Izin kamera ditolak. Aktifkan izin kamera atau gunakan input manual.' : 'Kamera tidak dapat dibuka. Gunakan input manual.', 'bad');
    }
  })();

  return { close };
}
