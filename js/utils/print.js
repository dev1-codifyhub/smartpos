// Print helper: renders HTML into #print-area; print.css hides all app UI during printing.

let styleEl;
function setPage(css) {
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'print-page-style'; document.head.appendChild(styleEl); }
  styleEl.textContent = css;
}

/**
 * printHTML(html, { mode: 'receipt'|'labels'|'report', width: '58'|'80', landscape })
 */
export function printHTML(html, { mode = 'report', width = '58', landscape = false } = {}) {
  const area = document.getElementById('print-area');
  area.innerHTML = html;
  document.body.dataset.print = mode;
  if (mode === 'receipt') setPage(`@page { size: ${width}mm auto; margin: 0; }`);
  else setPage(`@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 8mm; }`);
  const cleanup = () => { area.innerHTML = ''; delete document.body.dataset.print; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  // Give images/SVG a frame to lay out before opening the print dialog
  setTimeout(() => window.print(), 120);
}
