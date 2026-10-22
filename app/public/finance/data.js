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
async function uploadEvidence(txnId, file) {
  if (file.size > 10e6) throw new Error('Files can be up to 10 MB');
  const body = window.auzCompressImage ? await window.auzCompressImage(file) : file;
  const res = await apiFile('/storage/acc', { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream' } });
  const j = await res.json();
  await api('fin_attach', { p_id: txnId, p_name: file.name, p_url: j.url, p_size: body.size });
}
async function openEvidence(f) { const res = await apiFile(f.url.replace(/^.*?(\/storage\/)/, '/storage/')); const b = await res.blob(); const u = URL.createObjectURL(b); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); }
