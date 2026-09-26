/* Resolves which AUZlabs client a page belongs to, from the subdomain.
   Only needed by pages an anonymous visitor can load without logging in
   (site.html, terms.html, privacy.html) — the authenticated admin app
   (index.html) never needs this, since RLS scopes every query to
   whichever tenant the logged-in staff member's own profile belongs to. */
window.TENANT_SLUG = (() => {
  const host = location.hostname;
  // local testing (localhost / an IP) has no real subdomain to read —
  // fall back to a query param (?tenant=ogbookcafe) instead
  if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return new URLSearchParams(location.search).get('tenant') || '';
  }
  return host.split('.')[0];
})();
