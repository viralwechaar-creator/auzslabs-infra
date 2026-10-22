/* AUZsFinance: API access. Money entries carry a phone-made id (`op`), so sending one again is always safe. */
'use strict';
async function api(fn, args) {
  let r;
  try { r = await sb.rpc(fn, args || {}); } catch (e) { const er = new Error(navigator.onLine === false ? 'You are offline' : 'Could not reach the server'); er.net = true; throw er; }
  const { data, error } = r;
  if (error) { const e = new Error(error.message || 'Something went wrong'); e.code = error.code; e.status = error.status; e.net = !error.status || error.status >= 500 || error.status === 408 || error.status === 429; throw e; }
  return data;
}
async function token() { const { data: { session } } = await sb.auth.getSession(); return session && session.access_token; }
async function apiFile(path, opts = {}) {
  const tk = await token();
  const res = await fetch(CFG.url.replace(/\/$/, '') + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + tk } });
  if (!res.ok) { let m = res.statusText; try { m = (await res.json()).error || m; } catch { /* keep */ } throw new Error(m); }
  return res;
}
const LS = {
  get(k, d) { try { const v = localStorage.getItem('fin.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('fin.' + k, JSON.stringify(v)); } catch { /* private mode / full */ } },
};
const PDF_MAX = 10 * 1024;
async function compressPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That picture could not be read')); i.src = url; });
    let w = 1280, q = 0.6, out = null;
    for (let n = 0; n < 4; n++) {
      const sc = Math.min(1, w / Math.max(img.width, img.height)); const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out = await new Promise((res) => c.toBlob(res, 'image/jpeg', q));
      if (out && out.size <= 150 * 1024) break; w = Math.round(w * 0.78); q = Math.max(0.4, q - 0.08);
    }
    return out || file;
  } finally { URL.revokeObjectURL(url); }
}
async function uploadEvidence(txnId, file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf && file.size > PDF_MAX) throw new Error('A PDF can be up to 10 KB. Use a photo instead, it is made small automatically.');
  if (!isPdf && file.size > 25e6) throw new Error('That picture is too big');
  const body = isPdf ? file : await compressPhoto(file);
  const res = await apiFile('/storage/fin', { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream' } });
  const j = await res.json();
  await api('fin_attach', { p_id: txnId, p_name: isPdf ? file.name : file.name.replace(/\.[^.]+$/, '') + '.jpg', p_url: j.url, p_size: body.size });
}
async function openEvidence(f) { const res = await apiFile(f.url.replace(/^.*?(\/storage\/)/, '/storage/')); const b = await res.blob(); const u = URL.createObjectURL(b); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); }
