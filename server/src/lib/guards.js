import { withAuth } from '../db.js';
import { emailVerificationState, emailVerificationRequired } from '../auth.js';
import { HttpError } from './http.js';

// user.app_metadata.tenant_id/role come from the JWT -- a snapshot from
// whenever that token was issued. profiles is the actual live source of
// truth (same lesson as db/038_client_setup_handoff.sql's app_metadata
// fix on the auth side): a caller whose profile changed since their last
// login -- or, real incident, an owner uploading an employee document
// whose token predates some other profile update -- gets a stale
// tenant_id here and a misleading "empId is required" 400, since the
// actual missing piece was tenantId, not empId. Look it up fresh instead.
export async function myProfile(userId) {
  const { rows } = await withAuth(userId, (client) =>
    client.query('select tenant_id, role from profiles where id = $1', [userId]),
  );
  return rows[0] || null;
}

// Actions that start a real business relationship (a signup request, an add-on request, a payment) need a proven
// email address, once the owner has switched the requirement on (platform_flags, db/092). Off by default.
export async function requireVerifiedEmail(userId) {
  if (!userId || !(await emailVerificationRequired())) return;
  const st = await emailVerificationState(userId);
  if (st && !st.verified) throw new HttpError(403, 'Please confirm your email address first. We sent you a link when you signed up; you can ask for a new one from your account page.');
}
