// Declarative form validation.
// rules: { fieldName: { label, required, type:'number'|'text'|'int', min, max, minLen, maxLen, pattern, message } }

export function validateValues(values, rules) {
  const errors = {};
  for (const [name, r] of Object.entries(rules)) {
    const raw = values[name];
    const v = typeof raw === 'string' ? raw.trim() : raw;
    const label = r.label || name;
    const empty = v === undefined || v === null || v === '';
    if (empty) { if (r.required) errors[name] = `${label} wajib diisi`; continue; }
    if (r.type === 'number' || r.type === 'int') {
      const n = Number(v);
      if (!Number.isFinite(n)) { errors[name] = `${label} harus berupa angka`; continue; }
      if (r.type === 'int' && !Number.isInteger(n)) { errors[name] = `${label} harus bilangan bulat`; continue; }
      if (r.min !== undefined && n < r.min) { errors[name] = `${label} minimal ${r.min}`; continue; }
      if (r.max !== undefined && n > r.max) { errors[name] = `${label} maksimal ${r.max}`; continue; }
    } else {
      const s = String(v);
      if (r.minLen && s.length < r.minLen) { errors[name] = `${label} minimal ${r.minLen} karakter`; continue; }
      if (r.maxLen && s.length > r.maxLen) { errors[name] = `${label} maksimal ${r.maxLen} karakter`; continue; }
      if (r.pattern && !r.pattern.test(s)) { errors[name] = r.message || `${label} tidak valid`; continue; }
    }
    if (r.custom) { const m = r.custom(v, values); if (m) errors[name] = m; }
  }
  return errors;
}

export function readForm(form) {
  const out = {};
  new FormData(form).forEach((v, k) => { out[k] = typeof v === 'string' ? v : v; });
  // unchecked checkboxes
  form.querySelectorAll('input[type=checkbox][name]').forEach((c) => { out[c.name] = c.checked; });
  return out;
}

export function showErrors(form, errors) {
  form.querySelectorAll('.field').forEach((f) => {
    f.classList.remove('invalid');
    const e = f.querySelector('.err'); if (e) e.textContent = '';
  });
  let first = null;
  for (const [name, msg] of Object.entries(errors)) {
    const input = form.querySelector(`[name="${name}"]`);
    const field = input && input.closest('.field');
    if (!field) continue;
    field.classList.add('invalid');
    let e = field.querySelector('.err');
    if (!e) { e = document.createElement('div'); e.className = 'err'; field.appendChild(e); }
    e.textContent = msg;
    if (!first) first = input;
  }
  if (first) { first.focus({ preventScroll: false }); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}

// Validate a <form> element against rules. Returns {ok, values}
export function validateForm(form, rules) {
  const values = readForm(form);
  const errors = validateValues(values, rules);
  showErrors(form, errors);
  return { ok: Object.keys(errors).length === 0, values, errors };
}
