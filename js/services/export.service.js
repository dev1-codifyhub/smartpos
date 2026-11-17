// CSV / PDF export and CSV parsing.
import { download, esc } from '../utils/helpers.js';
import { state } from '../state.js';
import { num, rupiah } from '../utils/format.js';
import { printHTML } from '../utils/print.js';

/* ---------- CSV ---------- */
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCSV(columns, rows) {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(c.raw ? c.raw(r) : r[c.key])).join(','));
  return '﻿' + [head, ...body].join('\r\n');
}
export function downloadCSV(filename, columns, rows) {
  download(filename, toCSV(columns, rows), 'text/csv;charset=utf-8');
}

// RFC-4180-ish parser with quoted fields; auto-detects , or ; delimiter
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/* ---------- Shared table model for reports ----------
 * columns: [{key, label, align:'num'|'', fmt:(v,row)=>string}] */
const fmtCell = (c, r) => (c.fmt ? c.fmt(r[c.key], r) : r[c.key] ?? '');

export function reportTableHTML({ title, subtitle, summary = [], columns, rows, footer }) {
  const s = state.settings;
  return `<div class="report-print">
    <h1>${esc(title)}</h1>
    <div class="rp-sub">${esc(s.storeName)} — ${esc(subtitle || '')}</div>
    ${summary.length ? `<div class="rp-sum">${summary.map(([l, v]) => `<div>${esc(l)}<b>${esc(v)}</b></div>`).join('')}</div>` : ''}
    <table><thead><tr>${columns.map((c) => `<th class="${c.align || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.align || ''}">${esc(fmtCell(c, r))}</td>`).join('')}</tr>`).join('')}</tbody>
    ${footer ? `<tfoot><tr>${columns.map((c) => `<td class="${c.align || ''}"><b>${esc(footer[c.key] ?? '')}</b></td>`).join('')}</tr></tfoot>` : ''}
    </table></div>`;
}
export const printReport = (model) => printHTML(reportTableHTML(model), { mode: 'report', landscape: model.columns.length > 6 });

/* ---------- PDF (jsPDF, manual table with pagination) ---------- */
export function exportPDF({ title, subtitle, summary = [], columns, rows, footer, filename }) {
  const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFCtor) throw new Error('Library PDF belum termuat. Muat ulang halaman saat online.');
  const landscape = columns.length > 6;
  const doc = new jsPDFCtor({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36;
  let y = M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(title, M, y); y += 18;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110);
  doc.text(`${state.settings.storeName} — ${subtitle || ''}`, M, y); y += 8;
  doc.text(`Dicetak: ${new Date().toLocaleString('id-ID')}`, M, y + 8); y += 24; doc.setTextColor(0);
  if (summary.length) {
    const perRow = landscape ? 4 : 3; const bw = (W - 2 * M - (perRow - 1) * 8) / perRow;
    summary.forEach(([l, v], i) => {
      const col = i % perRow, rowI = Math.floor(i / perRow);
      const x = M + col * (bw + 8), yy = y + rowI * 38;
      doc.setDrawColor(210); doc.roundedRect(x, yy, bw, 32, 4, 4);
      doc.setFontSize(8); doc.setTextColor(120); doc.text(l, x + 6, yy + 12);
      doc.setFontSize(10.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(0); doc.text(String(v), x + 6, yy + 25); doc.setFont('helvetica', 'normal');
    });
    y += Math.ceil(summary.length / perRow) * 38 + 8;
  }
  const colW = (W - 2 * M) / columns.length;
  const drawHead = () => {
    doc.setFillColor(238, 241, 246); doc.rect(M, y, W - 2 * M, 20, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    columns.forEach((c, i) => { const x = M + i * colW; c.align === 'num' ? doc.text(c.label, x + colW - 4, y + 13, { align: 'right' }) : doc.text(c.label, x + 4, y + 13); });
    y += 22; doc.setFont('helvetica', 'normal');
  };
  drawHead();
  const cell = (c, r) => String(fmtCell(c, r));
  rows.forEach((r) => {
    if (y > H - M - 20) { doc.addPage(); y = M; drawHead(); }
    doc.setFontSize(8.5);
    columns.forEach((c, i) => {
      const x = M + i * colW; let t = cell(c, r);
      const maxChars = Math.floor((colW - 8) / 4.2);
      if (t.length > maxChars) t = t.slice(0, Math.max(1, maxChars - 1)) + '…';
      c.align === 'num' ? doc.text(t, x + colW - 4, y + 11, { align: 'right' }) : doc.text(t, x + 4, y + 11);
    });
    doc.setDrawColor(230); doc.line(M, y + 16, W - M, y + 16);
    y += 18;
  });
  if (footer) {
    if (y > H - M - 20) { doc.addPage(); y = M; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    columns.forEach((c, i) => { const x = M + i * colW; const t = String(footer[c.key] ?? ''); c.align === 'num' ? doc.text(t, x + colW - 4, y + 12, { align: 'right' }) : doc.text(t, x + 4, y + 12); });
  }
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFontSize(8); doc.setTextColor(140); doc.text(`Halaman ${p} / ${pages}`, W - M, H - 18, { align: 'right' }); }
  doc.save(filename || 'laporan.pdf');
}

export { num, rupiah };
