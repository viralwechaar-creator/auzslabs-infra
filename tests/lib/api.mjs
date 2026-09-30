// Tiny HTTP client for the salon API (keeps the session cookie by hand, since the real cookie is Secure).
export function salonClient(stack, slug) {
  let cookie = '';
  async function call(method, path, body, extra = {}) {
    const r = await fetch(stack.apiBase + '/salon-api' + path, { method, headers: { 'content-type': 'application/json', 'x-tenant-slug': slug, ...(cookie ? { cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc && /salon_session=[^;]+/.test(sc)) { const m = /salon_session=([^;]*)/.exec(sc)[1]; cookie = m ? 'salon_session=' + m : ''; }
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  }
  return { call, get cookie() { return cookie; }, set cookie(c) { cookie = c; }, clone() { const c = salonClient(stack, slug); c.cookie = cookie; return c; } };
}
// JSON-RPC style calls the marketing/POS apps make to the main API.
export async function rpc(stack, fn, args = {}, token) {
  const r = await fetch(stack.apiBase + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(args) });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
