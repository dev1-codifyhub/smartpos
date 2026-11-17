// Live camera photo capture. Resolves to a compressed JPEG data URL, or null if cancelled.
// Falls back to the native camera picker (<input capture>) when getUserMedia is unavailable.
import { esc, icon, refreshIcons, resizeImage } from '../utils/helpers.js';

function nativeCapture() {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*'; i.setAttribute('capture', 'environment');
    i.onchange = async () => { try { resolve(i.files[0] ? await resizeImage(i.files[0]) : null); } catch { resolve(null); } };
    i.oncancel = () => resolve(null);
    i.click();
  });
}

export function capturePhoto({ title = 'Ambil Foto Produk', max = 360 } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return nativeCapture();
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'scanner';
    ov.innerHTML = `
      <div class="scanner-top"><b style="font-size:17px">${esc(title)}</b><button class="btn btn-sm" data-cancel>${icon('x')} Batal</button></div>
      <div class="scanner-view"><video playsinline muted autoplay style="width:100%;height:100%;object-fit:cover"></video></div>
      <div class="scanner-bottom">
        <div class="scan-status" id="camStatus">Menyiapkan kamera…</div>
        <div class="flex" style="gap:8px">
          <button class="btn" data-flip>${icon('switch-camera')} Balik</button>
          <button class="btn btn-primary grow btn-lg" data-shot disabled>${icon('camera')} Ambil Foto</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    refreshIcons();
    const video = ov.querySelector('video'), status = ov.querySelector('#camStatus'), shot = ov.querySelector('[data-shot]');
    let stream = null, facing = 'environment', done = false;

    const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    const finish = (v) => { if (done) return; done = true; stop(); ov.remove(); resolve(v); };

    async function start() {
      stop(); shot.disabled = true; status.textContent = 'Menyiapkan kamera…'; status.className = 'scan-status';
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 } }, audio: false });
        video.srcObject = stream; await video.play();
        status.textContent = 'Arahkan kamera ke produk'; shot.disabled = false;
      } catch (e) {
        const denied = /permission|denied|notallowed/i.test(String(e && (e.name || e.message)));
        status.textContent = denied ? 'Izin kamera ditolak. Aktifkan izin kamera atau unggah dari galeri.' : 'Kamera tidak dapat dibuka.';
        status.className = 'scan-status bad';
      }
    }
    ov.querySelector('[data-cancel]').onclick = () => finish(null);
    ov.querySelector('[data-flip]').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; start(); };
    shot.onclick = () => {
      if (!video.videoWidth) return;
      const r = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(video.videoWidth * r); c.height = Math.round(video.videoHeight * r);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      finish(c.toDataURL('image/jpeg', 0.82));
    };
    start();
  });
}
