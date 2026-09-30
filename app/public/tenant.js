/* Resolves which AUZlabs client a page belongs to, from the subdomain.
   Used both by pages an anonymous visitor can load without logging in
   (site.html, terms.html, privacy.html, w.html) AND by the authenticated
   apps (index.html, payroll.html, builder.html) -- login itself is global,
   never scoped to a subdomain (one email = one login across the whole
   platform, see db/000_own_auth.sql), so a valid staff login for tenant A
   is still accepted on tenant B's own URL. RLS keeps the DATA correctly
   scoped to the account's real tenant regardless, but each app's own
   boot() compares this against my_dashboard()'s tenant.slug and refuses
   the login outright on a mismatch, rather than silently rendering one
   business's real data under a different business's branding. */
window.TENANT_SLUG = (() => {
  const host = location.hostname;
  // local testing (localhost / an IP) has no real subdomain to read —
  // fall back to a query param (?tenant=ogbookcafe) instead
  if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return new URLSearchParams(location.search).get('tenant') || '';
  }
  return host.split('.')[0];
})();
