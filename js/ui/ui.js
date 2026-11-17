// Reusable UI components: toast, modal / bottom sheet, confirm dialog, skeletons, loading buttons.
import { esc, icon, refreshIcons, beep, $ } from '../utils/helpers.js';

/* ---------- Toast ---------- */
export function toast(message, type = 'info', ms = 3200) {
  const host = $('#toasts');
  if (!host) return;
  const ic = { success: 'check-circle-2', error: 'alert-circle', warning: 'alert-triangle', info: 'info' }[type] || 'info';
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `${icon(ic)}<span>${esc(message)}</span>`;
  host.appendChild(el);
  refreshIcons();
  if (type === 'error') beep('error');
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  setTimeout(close, ms);
  el.addEventListener('click', close);
  while (host.children.length > 4) host.firstChild.remove();
}

/* ---------- Sheet / modal ---------- */
const stack = [];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close();
});

/**
 * openSheet({ title, body, footer, size, onClose, dismissible })
 * body/footer: HTML string. Returns { el, body, close, setBusy }.
 * Desktop: centered modal with scale animation. Mobile (<768px): bottom sheet (CSS).
 */
export function openSheet({ title = '', body = '', footer = '', size = '', onClose, dismissible = true, onMount } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="sheet ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grab"></div>
      ${title ? `<div class="sheet-head"><h2>${esc(title)}</h2><button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Tutup">${icon('x')}</button></div>` : ''}
      <div class="sheet-body">${body}</div>
      ${footer ? `<div class="sheet-foot">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  refreshIcons();
  let closed = false;
  const api = {
    el: overlay,
    sheet: overlay.querySelector('.sheet'),
    body: overlay.querySelector('.sheet-body'),
    foot: overlay.querySelector('.sheet-foot'),
    close(result) {
      if (closed) return; closed = true;
      const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 220);
      if (onClose) onClose(result);
    },
    setBody(html) { api.body.innerHTML = html; refreshIcons(); },
    setFooter(html) { if (api.foot) { api.foot.innerHTML = html; refreshIcons(); } },
  };
  overlay.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return api.close();
    if (e.target === overlay && dismissible) api.close();
  });
  stack.push(api);
  if (onMount) onMount(api);
  // focus first input for faster entry (not on touch devices to avoid keyboard popping)
  if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => api.body.querySelector('input:not([type=hidden]):not([type=file]):not([readonly]), textarea')?.focus(), 80);
  return api;
}

export function confirmDialog({ title = 'Konfirmasi', message = '', confirmText = 'Ya, lanjutkan', cancelText = 'Batal', danger = false } = {}) {
  return new Promise((resolve) => {
    let decided = false;
    const s = openSheet({
      title, size: 'sm',
      body: `<p style="line-height:1.6">${message}</p>`,
      footer: `<button class="btn" data-no>${esc(cancelText)}</button><button class="btn ${danger ? 'btn-danger solid' : 'btn-primary'}" data-yes>${esc(confirmText)}</button>`,
      onClose: () => { if (!decided) resolve(false); },
    });
    s.el.querySelector('[data-no]').onclick = () => { decided = true; s.close(); resolve(false); };
    s.el.querySelector('[data-yes]').onclick = () => { decided = true; s.close(); resolve(true); };
  });
}

// Ask for a text reason
export function promptDialog({ title, label, placeholder = '', confirmText = 'Simpan', danger = false, required = true, multiline = true } = {}) {
  return new Promise((resolve) => {
    let decided = false;
    const s = openSheet({
      title, size: 'sm',
      body: `<form class="field" id="pf"><label>${esc(label)}</label>${multiline ? `<textarea class="textarea" name="v" placeholder="${esc(placeholder)}"></textarea>` : `<input class="input" name="v" placeholder="${esc(placeholder)}">`}<div class="err">Wajib diisi</div></form>`,
      footer: `<button class="btn" data-no>Batal</button><button class="btn ${danger ? 'btn-danger solid' : 'btn-primary'}" data-yes>${esc(confirmText)}</button>`,
      onClose: () => { if (!decided) resolve(null); },
    });
    const submit = () => {
      const v = s.el.querySelector('[name=v]').value.trim();
      if (required && !v) { s.el.querySelector('#pf').classList.add('invalid'); return; }
      decided = true; s.close(); resolve(v);
    };
    s.el.querySelector('[data-no]').onclick = () => { decided = true; s.close(); resolve(null); };
    s.el.querySelector('[data-yes]').onclick = submit;
  });
}

/* ---------- Helpers ---------- */
export async function withLoading(btn, fn) {
  if (btn.classList.contains('loading')) return;
  btn.classList.add('loading');
  try { return await fn(); } finally { btn.classList.remove('loading'); }
}

export function skeletonCards(n = 5) {
  return `<div class="grid grid-cards">${Array.from({ length: n }, () => '<div class="skeleton sk-card"></div>').join('')}</div><div class="grid grid-main mt"><div class="skeleton sk-block"></div><div class="skeleton sk-block"></div></div>`;
}
export const skeletonList = (n = 6) => Array.from({ length: n }, () => '<div class="skeleton" style="height:56px;margin-bottom:10px"></div>').join('');

export const emptyState = (title, text = '', ic = 'inbox') => `<div class="empty">${icon(ic)}<b>${esc(title)}</b><span>${esc(text)}</span></div>`;

export function badge(text, color = '') { return `<span class="badge ${color}">${esc(text)}</span>`; }

export function segmented(options, active, attr = 'data-v') {
  return `<div class="segmented">${options.map(([v, l]) => `<button type="button" ${attr}="${esc(v)}" class="${v === active ? 'active' : ''}">${esc(l)}</button>`).join('')}</div>`;
}
export function bindSegmented(root, selector, onChange, attr = 'data-v') {
  let seg = root.querySelector(selector);
  if (seg && !seg.classList.contains('segmented')) seg = seg.closest('.segmented');
  if (!seg) return;
  seg.addEventListener('click', (e) => {
    const b = e.target.closest(`button[${attr}]`); if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    onChange(b.getAttribute(attr));
  });
}

// Number input that shows thousands separators while typing (for money)
export function bindMoneyInput(input, onChange) {
  const fmt = () => {
    const raw = input.value.replace(/\D/g, '');
    input.value = raw ? new Intl.NumberFormat('id-ID').format(Number(raw)) : '';
    onChange && onChange(raw ? Number(raw) : 0);
  };
  input.addEventListener('input', fmt);
}
export const moneyValue = (input) => Number(String(input.value).replace(/\D/g, '')) || 0;
