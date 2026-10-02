import * as Sentry from '@sentry/node';

// Error tracking (Sentry). Same dormant-until-configured discipline as
// every other optional integration in this project (mail.js, sms.js,
// payments.js, the sign-in providers): with no SENTRY_DSN set, init()
// below is a no-op and captureError() just logs to the console exactly
// as every unhandled error already did before this file existed --
// nothing about error handling changes until the owner adds a DSN.
const SENTRY_DSN = process.env.SENTRY_DSN || '';

export function errorTrackingConfigured() {
  return !!SENTRY_DSN;
}

export function initErrorTracking() {
  if (!SENTRY_DSN) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    // Traces/profiling cost quota on Sentry's free tier for little benefit on a
    // small self-hosted API -- this is deliberately error-only, not full APM.
    tracesSampleRate: 0,
  });
  // Catches anything that would otherwise crash the whole API process silently
  // (a bug outside any single request's own try/catch) -- these are the
  // failures most worth knowing about immediately, not just on the next
  // "something's broken" report from a client.
  process.on('uncaughtException', (err) => { captureError(err); console.error('uncaughtException', err); });
  process.on('unhandledRejection', (err) => { captureError(err); console.error('unhandledRejection', err); });
}

// Called from index.js's one top-level try/catch, only for genuine 500s --
// a 400/401/403/404/409/429 is the caller's own mistake or a normal business
// rule (wrong password, insufficient stock, rate limit), not a bug worth an
// alert. Never throws itself -- a broken error reporter must never become
// the reason a request fails.
export function captureError(err, context) {
  if (SENTRY_DSN) {
    try { Sentry.captureException(err, context ? { extra: context } : undefined); } catch {}
  }
}
