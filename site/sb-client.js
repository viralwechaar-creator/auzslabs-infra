/* Drop-in replacement for the supabase-js CDN script this app used to
 * load. Implements only the subset of its API this app actually calls
 * (checked against every .from()/.rpc()/.auth./.channel()/.storage.
 * call site in index.html, site.html, i.html, admin/onboard.html) --
 * talking to this project's own API server (server/) instead of a
 * Supabase project. Same global shape (`window.supabase.createClient`),
 * so every page needs only its <script src> swapped, nothing else.
 */
(function () {
  const LS_KEY = 'auz_session';

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
  }
  function saveSession(s) {
    try { s ? localStorage.setItem(LS_KEY, JSON.stringify(s)) : localStorage.removeItem(LS_KEY); } catch {}
  }

  function createClient(url, _key) {
    const base = url.replace(/\/$/, '');
    let session = loadSession();

    async function request(path, { method = 'GET', body, auth = true, raw } = {}) {
      const headers = {};
      if (auth && session?.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;
      if (!raw) headers['Content-Type'] = 'application/json';
      const res = await fetch(base + path, { method, headers, body: raw ? body : (body !== undefined ? JSON.stringify(body) : undefined) });
      let json = null;
      try { json = await res.json(); } catch {}
      if (!res.ok) return { data: null, error: { message: json?.error || res.statusText, status: res.status } };
      return { data: json?.data !== undefined ? json.data : json, error: null };
    }

    // ---- query builder: enough of .from(table).select().eq().gte().order().limit()/.single()/.insert()/.update()/.upsert() to cover this app's actual usage ----
    function from(table) {
      const state = { filters: [], select: '*', order: null, limit: null, single: false, onConflict: null };
      const qs = () => {
        const p = new URLSearchParams();
        p.set('select', state.select);
        for (const f of state.filters) p.set(`${f.op}.${f.col}`, f.val);
        if (state.order) p.set('order', state.order);
        if (state.limit) p.set('limit', state.limit);
        if (state.single) p.set('single', '1');
        return p.toString();
      };
      const builder = {
        select(cols) { state.select = cols || '*'; return builder; },
        eq(col, val) { state.filters.push({ op: 'eq', col, val }); return builder; },
        gte(col, val) { state.filters.push({ op: 'gte', col, val }); return builder; },
        lte(col, val) { state.filters.push({ op: 'lte', col, val }); return builder; },
        order(col) { state.order = col; return builder; },
        limit(n) { state.limit = n; return builder; },
        single() { state.single = true; return then(); },
        insert(values) { return request(`/db/${table}`, { method: 'POST', body: values }); },
        upsert(values, opts) { return request(`/db/${table}?onConflict=${encodeURIComponent(opts?.onConflict || 'id')}`, { method: 'POST', body: values }); },
        update(values) {
          return {
            eq(col, val) {
              const p = new URLSearchParams(); p.set(`eq.${col}`, val);
              return request(`/db/${table}?${p.toString()}`, { method: 'PATCH', body: values });
            },
          };
        },
        then(resolve, reject) { return then().then(resolve, reject); },
      };
      function then() { return request(`/db/${table}?${qs()}`); }
      return builder;
    }

    async function rpc(fn, args) {
      return request(`/rpc/${fn}`, { method: 'POST', body: args || {}, auth: true });
    }

    const auth = {
      async getSession() {
        return { data: { session } };
      },
      async signInWithPassword({ email, password }) {
        const { data, error } = await request('/auth/login', { method: 'POST', body: { email, password }, auth: false });
        if (error) return { data: { session: null }, error };
        session = { access_token: data.access_token, user: data.user };
        saveSession(session);
        return { data: { session, user: data.user }, error: null };
      },
      async signOut() {
        session = null;
        saveSession(null);
        return { error: null };
      },
    };

    // The server picks the actual stored filename (never a client-
    // supplied one, to keep paths unpredictable/uncollidable) -- so
    // getPublicUrl(path) can't derive a URL from the path it's given
    // the way real Supabase Storage could. Every call site in this app
    // calls upload() then getPublicUrl() back to back on the same
    // bucket handle, so caching the just-uploaded path here and having
    // getPublicUrl() return that (ignoring its argument) matches actual
    // usage exactly.
    let lastUploadedPath = null;
    const storage = {
      from(bucket) {
        return {
          async upload(clientPath, blob) {
            const prefix = (clientPath.split('/')[0] || 'file').replace(/[^a-zA-Z0-9_-]/g, '') || 'file';
            const { data, error } = await request(`/storage/${bucket}/${prefix}`, {
              method: 'POST', body: blob, raw: true,
            });
            if (data?.path) lastUploadedPath = data.path;
            return { data, error };
          },
          getPublicUrl(_path) {
            // /uploads/* is served from this same api.$DOMAIN origin --
            // see the Caddyfile.
            return { data: { publicUrl: lastUploadedPath ? base + lastUploadedPath : '' } };
          },
        };
      },
    };

    // ---- realtime: postgres_changes -> WebSocket "changed" relay.
    // Every call site here just wants "something changed, go refetch"
    // (`() => sync()`), not the row itself, so that's all this sends. ----
    function channel(_name) {
      let ws = null;
      let handler = null;
      let wantedTable = null;
      return {
        on(_event, filter, cb) { handler = cb; wantedTable = filter?.table || null; return this; },
        subscribe() {
          if (!session?.access_token) return this;
          const wsUrl = base.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(session.access_token);
          ws = new WebSocket(wsUrl);
          ws.onmessage = (ev) => {
            try {
              const msg = JSON.parse(ev.data);
              if (msg.type === 'changed' && handler && (!wantedTable || msg.table === wantedTable)) handler(msg);
            } catch {}
          };
          ws.onclose = () => setTimeout(() => { if (session?.access_token) this.subscribe(); }, 5000);
          return this;
        },
      };
    }

    return { auth, from, rpc, storage, channel };
  }

  window.supabase = { createClient };
})();
