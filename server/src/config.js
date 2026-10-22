

export const PORT = process.env.PORT || 3000;
export const DOMAIN = process.env.DOMAIN || '';
// where links in emails point (the marketing site)
export const SITE_URL = process.env.PUBLIC_SITE_URL || (DOMAIN && DOMAIN !== 'localhost' ? `https://${DOMAIN}` : 'http://localhost');

// Where a password-reset link may point: our own site or one of its shop subdomains (or localhost when running locally). Anything else falls back to the sign-in page.
export function safeResetBase(candidate) {
  const fallback = `${SITE_URL}/signup.html`;
  try {
    const u = new URL(String(candidate));
    const host = u.hostname.toLowerCase();
    const own = DOMAIN && DOMAIN !== 'localhost' ? (host === DOMAIN || host.endsWith('.' + DOMAIN)) : (host === 'localhost' || host === '127.0.0.1');
    if (own && (u.protocol === 'https:' || (u.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')))) return u.origin + u.pathname + u.search;
  } catch {}
  return fallback;
}
// The two logins seeded by db/023_demo_tenants.sql and published on
// site/demo.html on purpose -- unlike a real tenant's login, lots of
// unrelated strangers trying these from behind the same mobile-carrier
// or office IP within the same 15 minutes is expected traffic, not an
// attack, so they get their own much looser rate-limit bucket below
// instead of sharing login's tight one.
export const DEMO_LOGIN_EMAILS = new Set(['demo@auzslab.in', 'demo-salon@auzslab.in', 'showoffsalon-demo@auzslab.in']);
