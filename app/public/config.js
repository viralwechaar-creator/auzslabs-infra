// Points at this project's own API server (server/), not a third-party
// platform -- one shared API every tenant's subdomain talks to; which
// tenant a request belongs to is resolved from the caller's own login
// (app_metadata.tenant_id), never from this URL. `key` is unused now
// (kept only so every createClient(CFG.url, CFG.key) call site across
// this app's pages doesn't need touching) -- there's no publishable/anon
// key in this design, auth is a real login against the API server.
window.CFG={url:'https://api.auzslab.in',key:''};
