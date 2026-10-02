// Points at this project's own API server (server/), not a third-party
// platform -- one shared API every tenant's subdomain talks to; which
// tenant a request belongs to is resolved from the caller's own login
// (app_metadata.tenant_id), never from this URL. `key` is unused now
// (kept only so every createClient(CFG.url, CFG.key) call site across
// this app's pages doesn't need touching) -- there's no publishable/anon
// key in this design, auth is a real login against the API server.
// googleClientId/appleClientId: public, client-side values (not secrets) --
// empty until the owner creates them (see .env.example at the repo root
// for the exact console-by-console steps). Every Google/Apple button
// across every app -- this config.js is shared by index.html, payroll.html
// and accounts.html -- stays hidden until these are filled in, so no page
// ever shows a sign-in button that can't actually work yet.
window.CFG={url:'https://api.auzslab.in',key:'',googleClientId:'',appleClientId:''};
