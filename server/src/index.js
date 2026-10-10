import http from 'node:http';
import { createHash } from 'node:crypto';
import { pool, withAuth } from './db.js';
import {
  login, verifyToken, bearerFrom, createUser, resetToRandomPassword, signToken, refreshToken,
  loginWithGoogle, loginWithApple, createPhoneOtp, loginWithPhone,
  createPasswordReset, resetPassword, deleteOwnAccount,
  listSessions, revokeSession, revokeAllSessionsForUser, staffLogin, createEmailVerification, confirmEmailVerification, emailVerificationState, emailVerificationRequired, passwordSignupAllowed,
  verify2faChallenge, my2faStatus, generate2faSecret, confirm2fa, disable2fa,
  verifyPassword, emailInUse, createEmailChange, confirmEmailChange,
  createRecoveryEmailVerification, confirmRecoveryEmail, removeRecoveryEmail,
} from './auth.js';
import { saveSiteUpload, saveDocUpload, readDocUpload, getUploadsDiskUsage } from './storage.js';
import { startRealtime } from './realtime.js';
import { handlePushEvent } from './push.js';
import { sendStaffInviteEmail, sendPasswordResetEmail, sendEmailVerification, sendEmailChangeVerification, sendRecoveryEmailVerification, mailConfigured } from './mail.js';
import { verifyCaptcha, captchaEnabled } from './captcha.js';
import { startMaintenance } from './maintenance.js';
import { sendOtpSms } from './sms.js';
import { handleSalon } from './salon.js';
import { paymentConfig, gstPct, createOrder, verifyWebhookSignature, handleWebhookEvent } from './payments.js';
import { cashfreeConfigured, startAutorenew, cancelAutorenew, verifyWebhookSignature as verifyCashfreeSignature, handleWebhookEvent as handleCashfreeWebhookEvent } from './cashfree.js';
import { initErrorTracking, captureError } from './errors.js';
import { tenantForIconContext, appIcon, appManifest } from './appicon.js';

initErrorTracking(); // dormant unless SENTRY_DSN is set -- see errors.js

const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.DOMAIN || '';
// where links in emails point (the marketing site)
const SITE_URL = process.env.PUBLIC_SITE_URL || (DOMAIN && DOMAIN !== 'localhost' ? `https://${DOMAIN}` : 'http://localhost');

// Where a password-reset link may point: our own site or one of its shop subdomains (or localhost when running locally). Anything else falls back to the sign-in page.
function safeResetBase(candidate) {
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
const DEMO_LOGIN_EMAILS = new Set(['demo@auzslab.in', 'demo-salon@auzslab.in']);

// user.app_metadata.tenant_id/role come from the JWT -- a snapshot from
// whenever that token was issued. profiles is the actual live source of
// truth (same lesson as db/038_client_setup_handoff.sql's app_metadata
// fix on the auth side): a caller whose profile changed since their last
// login -- or, real incident, an owner uploading an employee document
// whose token predates some other profile update -- gets a stale
// tenant_id here and a misleading "empId is required" 400, since the
// actual missing piece was tenantId, not empId. Look it up fresh instead.
async function myProfile(userId) {
  const { rows } = await withAuth(userId, (client) =>
    client.query('select tenant_id, role from profiles where id = $1', [userId]),
  );
  return rows[0] || null;
}

// ---- whitelist: the only tables/columns this API will ever touch.
// Mirrors exactly what app/public's client code actually calls (see
// index.html/site.html/i.html) -- not a generic open-ended DB proxy. ----
const TABLES = {
  records: { columns: ['id', 'tenant_id', 'kind', 'data', 'deleted', 'author', 'updated_at'] }, // read-only here; writes go through the push_record RPC (optimistic concurrency)
  profiles: { columns: ['id', 'tenant_id', 'email', 'role', 'role_id', 'name', 'phone', 'username', 'outlet_id', 'login_off'], writable: ['role', 'role_id', 'name', 'phone'] },
  guest_orders: { columns: ['id', 'tenant_id', 'tbl', 'name', 'phone', 'note', 'items', 'status', 'created_at'], writable: ['status'] },
  push_subs: { columns: ['id', 'tenant_id', 'user_id', 'endpoint', 'p256dh', 'auth', 'created_at'], insertable: ['user_id', 'endpoint', 'p256dh', 'auth'] },
  fcm_tokens: { columns: ['id', 'tenant_id', 'user_id', 'token', 'platform', 'created_at'], insertable: ['user_id', 'token', 'platform'] },
  leads: { columns: ['id', 'name', 'business', 'contact', 'message', 'niche', 'status', 'created_at'], writable: ['status'] }, // admin-only via RLS (is_platform_admin())
  signup_requests: { columns: ['id', 'user_id', 'business_name', 'slug', 'features', 'notes', 'contact_name', 'phone', 'niche', 'address', 'status', 'created_at'] }, // read-only here; state changes go through approve/decline_signup_request
  addon_requests: { columns: ['id', 'tenant_id', 'tenant_name', 'tenant_slug', 'user_id', 'features', 'notes', 'status', 'created_at'] }, // read-only here; state changes go through approve/decline_addon_request

  // --- Client dashboard: custom roles + staff, notifications ---
  // roles.tenant_id defaults from the caller's own session (see
  // 013_client_dashboard_roles_notifications.sql), same pattern as
  // bookings.tenant_id -- never insertable/writable directly.
  roles: { columns: ['id', 'tenant_id', 'name', 'permissions', 'created_at'], insertable: ['name', 'permissions'], writable: ['name', 'permissions'] },
  // insert/delete deliberately blocked here -- creation only via
  // the auto-notify triggers or send_client_notification, and the
  // only thing a client/admin can change afterward is read state.
  notifications: { columns: ['id', 'tenant_id', 'type', 'title', 'body', 'link', 'read', 'created_at'], insertable: [], writable: ['read'] },

  // --- Phase 1: Booking & Appointments ---
  // tenant_id is never insertable/writable -- it defaults from the
  // caller's own session (see 008_phase1_...sql), same pattern
  // push_subs.tenant_id already uses. order_id is likewise excluded
  // from both lists: it's only ever set by convert_booking_to_order.
  bookings: {
    columns: ['id', 'tenant_id', 'resource_id', 'customer_name', 'customer_phone', 'date', 'time', 'end_time', 'status', 'items', 'total', 'order_id', 'created_at', 'party_size', 'note', 'source', 'outlet'],
    insertable: ['resource_id', 'customer_name', 'customer_phone', 'date', 'time', 'end_time', 'items', 'total', 'status', 'party_size', 'note', 'source', 'outlet'],
    writable: ['resource_id', 'customer_name', 'customer_phone', 'date', 'time', 'end_time', 'status', 'items', 'total', 'party_size', 'note', 'source', 'outlet'],
  },
  // append-only audit log written by a trigger on records (db/068); readable by owners and managers through RLS
  pos_audit: { columns: ['id', 'tenant_id', 'at', 'actor', 'actor_role', 'action', 'kind', 'record_id', 'ref', 'amount', 'reason', 'approved_by', 'outlet', 'before', 'after'], insertable: [], writable: [] },
};

const OPS = { eq: '=', gte: '>=', lte: '<=', gt: '>', lt: '<' };

// jsonb: pg only auto-stringifies plain JS *objects* into query params --
// a JS *array* gets sent as a Postgres native array literal instead
// (confirmed by hand: place_order's `its` array errored with "invalid
// input syntax for type json" until explicitly JSON.stringify'd below).
// Named here so callRpc knows which params need that regardless of
// whether the value happens to be an object or an array.
const RPC = {
  push_record: { params: ['rid', 'rkind', 'rdata', 'rdeleted', 'base', 'force'], jsonb: ['rdata'], auth: true },
  next_invoice_no: { params: ['prefix'], auth: true },
  provision_tenant: { params: ['p_name', 'p_slug', 'p_niche'], auth: true },
  provision_custom_tenant: { params: ['p_name', 'p_slug', 'p_brief'], auth: true },
  public_menu: { params: ['tenant_slug'], auth: false },
  public_page: { params: ['tenant_slug', 'page_slug'], auth: false },
  public_salon_page: { params: ['tenant_slug'], auth: false },
  public_salon_slots: { params: ['tenant_slug', 'p_date'], auth: false },
  // p_service_ids is a Postgres text[] param, not jsonb -- a JS array is
  // already sent as a native array literal by default (see the comment
  // on RPC/jsonb above), so it's deliberately absent from a jsonb list here.
  public_create_booking: { params: ['tenant_slug', 'p_name', 'p_phone', 'p_email', 'p_date', 'p_time', 'p_service_ids'], auth: false },
  public_create_reservation: { params: ['tenant_slug', 'p_name', 'p_phone', 'p_date', 'p_time', 'p_party_size', 'p_note'], auth: false },
  place_order: { params: ['tenant_slug', 't', 'n', 'p', 'nt', 'its'], jsonb: ['its'], auth: false },
  call_waiter: { params: ['tenant_slug', 't'], auth: false },
  public_invoice: { params: ['oid'], auth: false },
  submit_feedback: { params: ['oid', 'rating', 'comment'], auth: false },
  submit_lead: { params: ['p_name', 'p_contact', 'p_business', 'p_message', 'p_niche', 'p_hp'], auth: false },
  demo_context: { params: ['p_kind', 'p_id'], auth: false },
  list_clients: { params: [], auth: true },
  update_client: { params: ['p_tenant_id', 'p_monthly_fee', 'p_renewal_date', 'p_notes', 'p_status'], auth: true },
  admin_set_tenant_slug: { params: ['p_tenant_id', 'p_slug'], auth: true },
  submit_signup_request: { params: ['p_business_name', 'p_slug', 'p_features', 'p_notes', 'p_contact_name', 'p_phone', 'p_niche', 'p_address'], jsonb: ['p_features'], auth: true },
  approve_signup_request: { params: ['p_request_id', 'p_niche'], auth: true },
  decline_signup_request: { params: ['p_request_id'], auth: true },

  // --- Razorpay payments (db/070): dormant until RAZORPAY_KEY_ID/SECRET are set, see payments.js ---
  public_product_prices: { params: [], auth: false },
  payment_status: { params: ['p_order_id'], auth: true },
  admin_list_payments: { params: [], auth: true },
  admin_set_product_price: { params: ['p_key', 'p_monthly_price'], auth: true },
  // --- Bundle pricing (db/072) ---
  public_bundles: { params: [], auth: false },
  admin_set_bundle_price: { params: ['p_key', 'p_monthly_price'], auth: true },
  public_addon_price_overrides: { params: [], auth: false },
  // --- Admin-managed bundles + yearly prices (db/113) ---
  admin_list_bundles: { params: [], auth: true },
  admin_save_bundle: { params: ['p_key', 'p_label', 'p_feature_keys', 'p_monthly_price', 'p_list_price', 'p_yearly_price', 'p_badge', 'p_blurb', 'p_active', 'p_auto', 'p_discount_pct'], auth: true },
  admin_delete_bundle: { params: ['p_key'], auth: true },
  admin_set_product_yearly: { params: ['p_key', 'p_yearly_price', 'p_renewal_yearly_price'], auth: true },
  admin_set_addon_price: { params: ['p_key', 'p_requires', 'p_monthly_price'], auth: true },
  // provision_from_payment / provision_addon_from_payment deliberately NOT
  // registered here -- they skip the is_platform_admin() check that every
  // other provisioning path requires, trusting instead that the only
  // caller is the webhook handler below, which already verified real
  // money was captured. Registering them would let anyone free-provision
  // a tenant by POSTing a fake payment id to /rpc/provision_from_payment.

  // --- Phase 1: Booking & Appointments / Reports & Analytics ---
  convert_booking_to_order: { params: ['p_booking_id', 'p_invoice_prefix'], auth: true },
  // POS rebuild (db/068_pos_rebuild.sql): KOT numbers, manager approval PINs, QR orders claimed once, gift-card tender
  next_kot_no: { params: ['p_day', 'p_outlet'], auth: true },
  pos_pin_status: { params: [], auth: true },
  pos_set_pin: { params: ['p_pin'], auth: true },
  pos_verify_pin: { params: ['p_pin', 'p_action', 'p_ref'], auth: true },
  pos_sign_approval: { params: ['p_action', 'p_ref'], auth: true },
  claim_guest_order: { params: ['p_id', 'p_status'], auth: true },
  redeem_giftcard: { params: ['p_code', 'p_amount', 'p_order'], auth: true },
  report_dashboard: { params: ['p_from', 'p_to'], auth: true },

  // --- Admin: reset a client's forgotten password ---
  admin_reset_client_password: { params: ['p_tenant_id'], auth: true },
  admin_set_tenant_features: { params: ['p_tenant_id', 'p_features'], jsonb: ['p_features'], auth: true },
  mark_client_delivered: { params: ['p_tenant_id'], auth: true },
  delete_client: { params: ['p_tenant_id'], auth: true },
  admin_system_stats: { params: [], auth: true },

  // --- Admin: Users directory + audit log (db/087) ---
  admin_list_users: { params: ['p_query', 'p_limit'], defaults: { p_query: null, p_limit: 50 }, auth: true },
  admin_user_detail: { params: ['p_user_id'], auth: true },
  admin_set_user_disabled: { params: ['p_user_id', 'p_disabled'], auth: true },
  admin_set_user_email: { params: ['p_user_id', 'p_new_email'], auth: true },
  admin_delete_lead: { params: ['p_kind', 'p_id'], auth: true },
  admin_delete_user: { params: ['p_user_id', 'p_confirm_email'], auth: true },
  admin_list_audit: { params: ['p_limit'], defaults: { p_limit: 100 }, auth: true },

  // --- Admin: salesmen (db/137) ---
  admin_add_salesman: { params: ['p_email', 'p_name'], defaults: { p_name: null }, auth: true },
  admin_list_salesmen: { params: [], auth: true },
  submit_client_order: { params: ['p'], jsonb: ['p'], auth: true },
  my_client_orders: { params: [], auth: true },
  public_client_order: { params: ['p_token'], auth: false },
  public_order_submit_payment: { params: ['p_token', 'p_utr', 'p_terms'], defaults: { p_utr: null, p_terms: false }, auth: false },
  admin_list_client_orders: { params: ['p_status'], defaults: { p_status: null }, auth: true },
  admin_get_client_order: { params: ['p_id'], auth: true },
  admin_set_order_status: { params: ['p_id', 'p_status', 'p_note'], defaults: { p_note: null }, auth: true },
  admin_update_client_order: { params: ['p_id', 'p'], jsonb: ['p'], auth: true },
  admin_save_order_quote: { params: ['p_id', 'p_quote'], jsonb: ['p_quote'], auth: true },
  admin_confirm_order_payment: { params: ['p_id', 'p_paid_on', 'p_utr'], defaults: { p_paid_on: null, p_utr: null }, auth: true },
  admin_mark_order_bill_sent: { params: ['p_id'], auth: true },
  admin_list_client_bills: { params: ['p_from', 'p_to'], auth: true, defaults: { p_from: null, p_to: null } },
  admin_update_bill_details: { params: ['p_id', 'p'], jsonb: ['p'], auth: true },
  admin_create_bill_for_payment: { params: ['p_payment_id', 'p'], jsonb: ['p'], auth: true },
  admin_open_client_orders_count: { params: [], auth: true },
  admin_add_client_payment: { params: ['p_tenant_id', 'p_amount', 'p_paid_on', 'p_mode', 'p_utr', 'p_purpose', 'p_note'], auth: true, defaults: { p_paid_on: null, p_mode: 'upi', p_utr: null, p_purpose: null, p_note: null } },
  admin_list_client_payments: { params: ['p_tenant_id'], auth: true, defaults: { p_tenant_id: null } },
  admin_delete_client_payment: { params: ['p_id'], auth: true },
  admin_salesman_work: { params: ['p_days'], auth: true, defaults: { p_days: 0 } },
  admin_set_salesman_active: { params: ['p_id', 'p_active'], auth: true },

  // --- Salesman: provision + brand one real trial tenant per sales pitch (db/137) ---
  salesman_provision_trial: { params: ['p_business_name', 'p_slug', 'p_niche'], defaults: { p_niche: 'cafe' }, auth: true },
  salesman_my_trials: { params: [], auth: true },
  salesman_branding_get: { params: ['p_tenant_id'], auth: true },
  salesman_branding_save: { params: ['p_tenant_id', 'p_patch'], jsonb: ['p_patch'], auth: true },
  salesman_delete_trial: { params: ['p_tenant_id', 'p_confirm_slug'], auth: true },
  salesman_apply_demo_content: { params: ['p_tenant_id'], auth: true },

  // --- Client dashboard: own account, staff, feature toggles ---
  my_dashboard: { params: [], auth: true },
  my_profile: { params: [], auth: true },
  save_my_profile: { params: ['p'], jsonb: ['p'], auth: true },
  admin_list_profiles: { params: ['p_limit'], defaults: { p_limit: 200 }, auth: true },
  privacy_current_version: { params: [], auth: false },
  record_my_consent: { params: ['p_purposes', 'p_source'], jsonb: ['p_purposes'], defaults: { p_purposes: { service: true }, p_source: 'account' }, auth: true },
  my_consents: { params: [], auth: true },
  withdraw_my_consent: { params: ['p_purpose'], auth: true },
  submit_data_request: { params: ['p_kind', 'p_message'], defaults: { p_message: '' }, auth: true },
  my_data_requests: { params: [], auth: true },
  my_personal_data: { params: [], auth: true },
  admin_list_data_requests: { params: ['p_status'], defaults: { p_status: 'active' }, auth: true },
  admin_update_data_request: { params: ['p_id', 'p_status', 'p_response'], defaults: { p_response: null }, auth: true },
  admin_open_data_request_count: { params: [], auth: true },
  my_subscription: { params: [], auth: true },
  my_autorenew: { params: [], auth: true },
  my_data_export: { params: [], auth: true },
  my_data_clear: { params: ['p_confirm'], auth: true },
  update_my_features: { params: ['p_enabled'], jsonb: ['p_enabled'], auth: true },
  change_my_password: { params: ['p_old_password', 'p_new_password'], auth: true },
  staff_create: { params: ['p_name', 'p_phone', 'p_role_id', 'p_builtin', 'p_outlet', 'p_username'], defaults: { p_phone: null, p_role_id: null, p_builtin: null, p_outlet: null, p_username: null }, auth: true },
  staff_reset_pin: { params: ['p_staff_id', 'p_pin'], defaults: { p_pin: null }, auth: true },
  staff_set_active: { params: ['p_staff_id', 'p_active'], auth: true },
  staff_set_outlet: { params: ['p_staff_id', 'p_outlet'], auth: true },
  invite_staff: { params: ['p_email', 'p_name', 'p_phone', 'p_role_id', 'p_builtin'], defaults: { p_role_id: null, p_builtin: null }, auth: true },
  confirm_staff_email: { params: ['p_token'], auth: false },
  remove_staff: { params: ['p_staff_id'], auth: true },
  reset_staff_password: { params: ['p_staff_id', 'p_new_password'], auth: true },
  delete_role: { params: ['p_role_id'], auth: true },

  // --- Notifications ---
  send_client_notification: { params: ['p_tenant_id', 'p_title', 'p_body'], auth: true },

  // --- Add-on requests (existing client asking to add modules) ---
  submit_addon_request: { params: ['p_features', 'p_notes'], jsonb: ['p_features'], auth: true },
  approve_addon_request: { params: ['p_request_id'], auth: true },
  decline_addon_request: { params: ['p_request_id'], auth: true },

  // --- AUZslab Accounting (db/059-065). Every one of these starts with acc_guard() in SQL, which re-checks the
  // 'accounting' entitlement and the caller's permission server side; being listed here only makes it reachable.
  // `defaults` fills a parameter the client left out (callRpc otherwise sends null, which would defeat the SQL default).
  acc_save_document: { params: ['p'], jsonb: ['p'], auth: true },
  acc_post_document: { params: ['p_doc_id', 'p_payments'], jsonb: ['p_payments'], defaults: {'p_payments': []}, auth: true },
  acc_delete_document: { params: ['p_doc_id'], auth: true },
  acc_cancel_document: { params: ['p_doc_id', 'p_reason'], auth: true },
  acc_convert_document: { params: ['p_src', 'p_to'], auth: true },
  acc_save_payment: { params: ['p'], jsonb: ['p'], auth: true },
  acc_allocate: { params: ['p_payment', 'p_doc', 'p_amount'], auth: true },
  acc_apply_credit: { params: ['p_note', 'p_doc', 'p_amount'], auth: true },
  acc_unallocate: { params: ['p_allocation'], auth: true },
  acc_cancel_payment: { params: ['p_payment', 'p_reason'], auth: true },
  acc_save_voucher: { params: ['p'], jsonb: ['p'], auth: true },
  acc_post_opening: { params: ['p_date', 'p_lines'], jsonb: ['p_lines'], auth: true },
  acc_set_party_opening: { params: ['p_party', 'p_amount', 'p_date'], auth: true },
  acc_stock_adjust: { params: ['p'], jsonb: ['p'], auth: true },
  acc_stock_transfer: { params: ['p'], jsonb: ['p'], auth: true },
  acc_context: { params: [], auth: true },
  acc_bootstrap: { params: [], auth: true },
  acc_save_org: { params: ['p'], jsonb: ['p'], auth: true },
  acc_save_fy: { params: ['p'], jsonb: ['p'], auth: true },
  acc_set_lock: { params: ['p_date'], auth: true },
  acc_mark_gst_filed: { params: ['p_period', 'p_filed', 'p_ref'], auth: true },
  acc_close_fy: { params: ['p_fy'], auth: true },
  acc_save_account: { params: ['p'], jsonb: ['p'], auth: true },
  acc_save_party: { params: ['p'], jsonb: ['p'], auth: true },
  acc_save_product: { params: ['p'], jsonb: ['p'], auth: true },
  acc_save_master: { params: ['p'], jsonb: ['p'], auth: true },
  acc_save_warehouse: { params: ['p'], jsonb: ['p'], auth: true },
  acc_save_branch: { params: ['p'], jsonb: ['p'], auth: true },
  acc_save_taxcode: { params: ['p'], jsonb: ['p'], auth: true },
  acc_list_documents: { params: ['p'], jsonb: ['p'], auth: true },
  acc_get_document: { params: ['p_id'], auth: true },
  acc_list_payments: { params: ['p'], jsonb: ['p'], auth: true },
  acc_get_payment: { params: ['p_id'], auth: true },
  acc_list_parties: { params: ['p'], jsonb: ['p'], auth: true },
  acc_list_products: { params: ['p'], jsonb: ['p'], auth: true },
  acc_product_stock: { params: ['p_product'], auth: true },
  acc_list_audit: { params: ['p'], jsonb: ['p'], auth: true },
  acc_search: { params: ['p_q'], auth: true },
  acc_trial_balance: { params: ['p_from', 'p_to', 'p_all'], defaults: {'p_all': false}, auth: true },
  acc_ledger: { params: ['p'], jsonb: ['p'], auth: true },
  acc_party_statement: { params: ['p_party', 'p_from', 'p_to'], auth: true },
  acc_daybook: { params: ['p_from', 'p_to', 'p_type'], auth: true },
  acc_journal_detail: { params: ['p_id'], auth: true },
  acc_book: { params: ['p_kind', 'p_from', 'p_to', 'p_account'], auth: true },
  acc_pnl: { params: ['p_from', 'p_to'], auth: true },
  acc_balance_sheet: { params: ['p_asof'], auth: true },
  acc_cash_flow: { params: ['p_from', 'p_to'], auth: true },
  acc_ageing: { params: ['p'], jsonb: ['p'], auth: true },
  acc_register: { params: ['p'], jsonb: ['p'], auth: true },
  acc_payment_mode_sales: { params: ['p_from', 'p_to'], auth: true },
  acc_stock_summary: { params: ['p'], jsonb: ['p'], auth: true },
  acc_stock_movement: { params: ['p_from', 'p_to'], auth: true },
  acc_stock_velocity: { params: ['p_days'], defaults: {'p_days': 90}, auth: true },
  acc_stock_batches: { params: ['p_before'], auth: true },
  acc_gst_summary: { params: ['p_from', 'p_to'], auth: true },
  acc_gst_register: { params: ['p'], jsonb: ['p'], auth: true },
  acc_gst_exceptions: { params: ['p_from', 'p_to'], auth: true },
  acc_dashboard: { params: ['p'], jsonb: ['p'], defaults: {'p': {}}, auth: true },
  acc_integrity_check: { params: [], auth: true },
  acc_bank_import: { params: ['p_account', 'p_rows', 'p_batch'], jsonb: ['p_rows'], auth: true },
  acc_bank_list: { params: ['p'], jsonb: ['p'], auth: true },
  acc_bank_book_lines: { params: ['p_account', 'p_upto'], auth: true },
  acc_bank_match: { params: ['p_txn', 'p_line'], auth: true },
  acc_bank_unmatch: { params: ['p_txn'], auth: true },
  acc_bank_ignore: { params: ['p_txn', 'p_ignore'], defaults: {'p_ignore': true}, auth: true },
  acc_bank_create_entry: { params: ['p_txn', 'p'], jsonb: ['p'], auth: true },
  acc_bank_reconcile: { params: ['p_account', 'p_date', 'p_balance', 'p_commit'], defaults: {'p_commit': false}, auth: true },
  acc_bank_recons: { params: ['p_account'], auth: true },
  acc_save_asset: { params: ['p'], jsonb: ['p'], auth: true },
  acc_run_depreciation: { params: ['p_month'], auth: true },
  acc_dispose_asset: { params: ['p_asset', 'p_date', 'p_amount', 'p_account'], auth: true },
  acc_list_assets: { params: [], auth: true },
  acc_import: { params: ['p_entity', 'p_rows', 'p_commit', 'p_strict', 'p_options'], jsonb: ['p_rows', 'p_options'], defaults: {'p_commit': false, 'p_strict': true, 'p_options': {}}, auth: true },
  acc_list_imports: { params: [], auth: true },
  acc_bulk_update: { params: ['p_entity', 'p_ids', 'p_changes'], jsonb: ['p_changes'], auth: true },
  acc_bulk_post: { params: ['p_ids'], auth: true },
  acc_delete_products: { params: ['p_ids'], auth: true },
  acc_due_reminders: { params: ['p_side'], defaults: {'p_side': 'receivable'}, auth: true },
  acc_log_comm: { params: ['p'], jsonb: ['p'], auth: true },
  acc_retry_comm: { params: ['p_id', 'p_status'], auth: true },
  acc_list_comms: { params: ['p'], jsonb: ['p'], defaults: {'p': {}}, auth: true },
  acc_save_budget: { params: ['p_fy', 'p_rows'], jsonb: ['p_rows'], auth: true },
  acc_budget_report: { params: ['p_fy'], auth: true },
  acc_add_attachment: { params: ['p_entity', 'p_id', 'p_name', 'p_url', 'p_size'], auth: true },
  acc_einvoice_payload: { params: ['p_doc'], auth: true },
  acc_einvoice_record: { params: ['p_doc', 'p_irn', 'p_ack_no', 'p_ack_date', 'p_qr'], auth: true },
  acc_einvoice_cancel: { params: ['p_doc', 'p_reason'], auth: true },
  acc_eway_payload: { params: ['p_doc', 'p_transport'], jsonb: ['p_transport'], defaults: {'p_transport': {}}, auth: true },
  acc_eway_record: { params: ['p_doc', 'p_ewb', 'p_valid_upto'], auth: true },
  acc_gst2b_import: { params: ['p_period', 'p_rows'], jsonb: ['p_rows'], auth: true },
  acc_gst_recon_list: { params: ['p_period'], auth: true },
  acc_save_view: { params: ['p'], jsonb: ['p'], auth: true },
  acc_list_views: { params: ['p_scope'], auth: true },
  acc_delete_view: { params: ['p_id'], auth: true },
  acc_save_recurring: { params: ['p'], jsonb: ['p'], auth: true },
  acc_list_recurring: { params: [], auth: true },
  acc_delete_recurring: { params: ['p_id'], auth: true },
  acc_run_recurring: { params: ['p_upto'], auth: true },
  acc_share_document: { params: ['p_doc', 'p_enable'], defaults: {'p_enable': true}, auth: true },
  public_acc_document: { params: ['p_token'], auth: false },
  acc_remove_attachment: { params: ['p_id'], auth: true },

  // --- AUZslab Payroll v2 (db/073-077). Every one of these starts with pay_guard()/pay_tenant() in SQL, which re-checks the
  // 'payroll' entitlement, the caller's permission and field-level security; employees reach their own data through pay_me_*.
  // Internal helpers (pay_calc_item, pay_import_legacy, pay_demo_seed, ...) are deliberately not listed here.
  pay_bootstrap: { params: [], auth: true },
  pay_dashboard: { params: [], auth: true },
  pay_save_org: { params: ['p'], jsonb: ['p'], auth: true },
  pay_save_location: { params: ['p'], jsonb: ['p'], auth: true },
  pay_save_master: { params: ['p'], jsonb: ['p'], auth: true },
  pay_save_shift: { params: ['p'], jsonb: ['p'], auth: true },
  pay_save_holiday: { params: ['p'], jsonb: ['p'], auth: true },
  pay_delete_holiday: { params: ['p_id'], auth: true },
  pay_save_leave_type: { params: ['p'], jsonb: ['p'], auth: true },
  pay_save_component: { params: ['p'], jsonb: ['p'], auth: true },
  pay_preview_structure: { params: ['p'], jsonb: ['p'], auth: true },
  pay_save_structure: { params: ['p'], jsonb: ['p'], auth: true },
  pay_save_rule: { params: ['p'], jsonb: ['p'], auth: true },
  pay_list_rules: { params: [], auth: true },
  pay_list_employees: { params: ['p'], jsonb: ['p'], defaults: { p: {} }, auth: true },
  pay_get_employee: { params: ['p_id'], auth: true },
  pay_save_employee: { params: ['p'], jsonb: ['p'], auth: true },
  pay_save_job: { params: ['p_emp', 'p'], jsonb: ['p'], auth: true },
  pay_save_salary: { params: ['p_emp', 'p'], jsonb: ['p'], auth: true },
  pay_delete_salary: { params: ['p_id'], auth: true },
  pay_save_bank: { params: ['p_emp', 'p'], jsonb: ['p'], auth: true },
  pay_bank_decide: { params: ['p_id', 'p_approve'], auth: true },
  pay_set_status: { params: ['p_emp', 'p'], jsonb: ['p'], auth: true },
  pay_link_login: { params: ['p_emp', 'p_email'], auth: true },
  pay_set_kiosk_pin: { params: ['p_emp', 'p_pin'], auth: true },
  pay_save_asset: { params: ['p'], jsonb: ['p'], auth: true },
  pay_add_document: { params: ['p'], jsonb: ['p'], auth: true },
  pay_delete_document: { params: ['p_id'], auth: true },
  pay_import_check: { params: ['p_rows', 'p_commit'], jsonb: ['p_rows'], defaults: { p_commit: false }, auth: true },
  pay_attendance_day: { params: ['p_date'], auth: true },
  pay_attendance_month: { params: ['p_emp', 'p_month'], auth: true },
  pay_attendance_grid: { params: ['p_month'], auth: true },
  pay_mark_attendance: { params: ['p_emp', 'p_date', 'p'], jsonb: ['p'], auth: true },
  pay_mark_bulk: { params: ['p_date', 'p_rows', 'p_reason'], jsonb: ['p_rows'], auth: true },
  pay_add_punch: { params: ['p_emp', 'p'], jsonb: ['p'], auth: true },
  pay_void_punch: { params: ['p_id', 'p_reason'], auth: true },
  pay_save_roster: { params: ['p_rows'], jsonb: ['p_rows'], auth: true },
  pay_roster_week: { params: ['p_from'], auth: true },
  pay_leave_decide: { params: ['p_id', 'p_approve', 'p_note'], auth: true },
  pay_leave_cancel: { params: ['p_id', 'p_reason'], auth: true },
  pay_leave_add: { params: ['p_emp', 'p'], jsonb: ['p'], auth: true },
  pay_leave_adjust: { params: ['p_emp', 'p_type', 'p_days', 'p_note', 'p_opening'], defaults: { p_opening: false }, auth: true },
  pay_leave_ledger_list: { params: ['p_emp', 'p_type'], auth: true },
  pay_reg_decide: { params: ['p_id', 'p_approve', 'p_note'], auth: true },
  pay_list_requests: { params: ['p'], jsonb: ['p'], defaults: { p: {} }, auth: true },
  pay_save_loan: { params: ['p'], jsonb: ['p'], auth: true },
  pay_loan_decide: { params: ['p_id', 'p_approve', 'p'], jsonb: ['p'], defaults: { p: {} }, auth: true },
  pay_loan_update: { params: ['p_id', 'p'], jsonb: ['p'], auth: true },
  pay_list_loans: { params: ['p'], jsonb: ['p'], defaults: { p: {} }, auth: true },
  pay_claim_decide: { params: ['p_id', 'p_approve', 'p'], jsonb: ['p'], defaults: { p: {} }, auth: true },
  pay_claim_pay: { params: ['p_id', 'p'], jsonb: ['p'], defaults: { p: {} }, auth: true },
  pay_save_claim: { params: ['p_emp', 'p'], jsonb: ['p'], auth: true },
  pay_list_claims: { params: ['p'], jsonb: ['p'], defaults: { p: {} }, auth: true },
  pay_save_tax: { params: ['p_emp', 'p'], jsonb: ['p'], auth: true },
  pay_get_tax: { params: ['p_emp'], auth: true },
  pay_list_runs: { params: ['p'], jsonb: ['p'], defaults: { p: {} }, auth: true },
  pay_get_run: { params: ['p_id'], auth: true },
  pay_get_item: { params: ['p_id'], auth: true },
  pay_save_inputs: { params: ['p_run', 'p_rows'], jsonb: ['p_rows'], auth: true },
  pay_get_batch: { params: ['p_id'], auth: true },
  pay_run_create: { params: ['p'], jsonb: ['p'], auth: true },
  pay_run_calculate: { params: ['p_run'], auth: true },
  pay_run_submit: { params: ['p_run'], auth: true },
  pay_run_approve: { params: ['p_run', 'p_note'], auth: true },
  pay_run_send_back: { params: ['p_run', 'p_reason'], auth: true },
  pay_run_cancel: { params: ['p_run', 'p_reason'], auth: true },
  pay_run_finalize: { params: ['p_run'], auth: true },
  pay_run_lock: { params: ['p_run'], auth: true },
  pay_item_hold: { params: ['p_item', 'p_hold', 'p_reason'], auth: true },
  pay_batch_create: { params: ['p_run', 'p'], jsonb: ['p'], defaults: { p: {} }, auth: true },
  pay_batch_mark: { params: ['p_batch', 'p'], jsonb: ['p'], auth: true },
  pay_batch_cancel: { params: ['p_batch'], auth: true },
  pay_stat_pay: { params: ['p'], jsonb: ['p'], auth: true },
  pay_list_stat_payments: { params: ['p'], jsonb: ['p'], defaults: { p: {} }, auth: true },
  pay_acc_post_run: { params: ['p_run'], auth: true },
  pay_integrity_check: { params: [], auth: true },
  pay_list_audit: { params: ['p'], jsonb: ['p'], defaults: { p: {} }, auth: true },
  pay_search: { params: ['p_q'], auth: true },
  pay_console_summary: { params: [], auth: true },
  pay_report: { params: ['p_kind', 'p'], jsonb: ['p'], defaults: { p: {} }, auth: true },
  pay_save_announcement: { params: ['p'], jsonb: ['p'], auth: true },
  pay_list_announcements: { params: [], auth: true },
  pay_kiosk_list: { params: [], auth: true },
  pay_kiosk_punch: { params: ['p_emp', 'p_pin'], auth: true },
  pay_me: { params: [], auth: true },
  pay_me_punch: { params: ['p'], jsonb: ['p'], defaults: { p: {} }, auth: true },
  pay_me_punch_offline: { params: ['p'], jsonb: ['p'], auth: true },
  acc_save_draft_offline: { params: ['p'], jsonb: ['p'], auth: true },
  acc_offline_apply: { params: ['p'], jsonb: ['p'], auth: true },
  pay_me_attendance: { params: ['p_month'], auth: true },
  pay_me_leave_apply: { params: ['p'], jsonb: ['p'], auth: true },
  pay_me_regularize: { params: ['p'], jsonb: ['p'], auth: true },
  pay_me_cancel: { params: ['p_type', 'p_id'], auth: true },
  pay_me_payslips: { params: [], auth: true },
  pay_me_loan_request: { params: ['p'], jsonb: ['p'], auth: true },
  pay_me_claim: { params: ['p'], jsonb: ['p'], auth: true },
  pay_me_bank_request: { params: ['p'], jsonb: ['p'], auth: true },
  pay_me_profile: { params: ['p'], jsonb: ['p'], auth: true },
  pay_me_tax: { params: [], auth: true },
  pay_me_tax_save: { params: ['p'], jsonb: ['p'], auth: true },
  pay_me_documents: { params: [], auth: true },

  // --- AUZsMob (db/080-082): mobile phone retail & repair shops. Own real tables (mob_*), not the generic
  // records engine. Every one of these starts with mob_guard()/mob_tenant() in SQL, which re-checks the
  // 'mobile' entitlement and the caller's permission server side; being listed here only makes it reachable.
  mob_context: { params: [], auth: true },
  mob_save_settings: { params: ['p'], jsonb: ['p'], auth: true },
  mob_save_my_language: { params: ['p_lang'], auth: true },
  mob_save_item: { params: ['p_id', 'p', 'p_base'], jsonb: ['p'], defaults: { p_base: null }, auth: true },
  mob_save_vendor: { params: ['p_id', 'p', 'p_base'], jsonb: ['p'], defaults: { p_base: null }, auth: true },
  mob_save_customer: { params: ['p_id', 'p', 'p_base'], jsonb: ['p'], defaults: { p_base: null }, auth: true },
  mob_save_unit: { params: ['p_id', 'p', 'p_base'], jsonb: ['p'], defaults: { p_base: null }, auth: true },
  mob_push_purchase: { params: ['p_id', 'p'], jsonb: ['p'], auth: true },
  mob_push_sale: { params: ['p_id', 'p'], jsonb: ['p'], auth: true },
  mob_void_sale: { params: ['p_sale_id', 'p_reason'], defaults: { p_reason: null }, auth: true },
  mob_void_purchase: { params: ['p_purchase_id', 'p_reason'], defaults: { p_reason: null }, auth: true },
  mob_void_sales_bulk: { params: ['p_sale_ids', 'p_reason'], defaults: { p_reason: null }, auth: true },
  mob_void_purchases_bulk: { params: ['p_purchase_ids', 'p_reason'], defaults: { p_reason: null }, auth: true },
  mob_create_repair: { params: ['p_id', 'p'], jsonb: ['p'], auth: true },
  mob_push_repair_event: { params: ['p_id', 'p_repair_id', 'p'], jsonb: ['p'], auth: true },
  mob_push_payment: { params: ['p_id', 'p'], jsonb: ['p'], auth: true },
  mob_adjust_stock: { params: ['p_id', 'p_item_id', 'p_qty_delta', 'p_note'], defaults: { p_note: null }, auth: true },
  mob_staff_list: { params: [], auth: true },
  mob_sync_pull: { params: ['p_since'], defaults: { p_since: null }, auth: true },
  mob_report_dashboard: { params: ['p_from', 'p_to'], defaults: { p_from: null, p_to: null }, auth: true },
  mob_report_activity: { params: ['p_from', 'p_to'], defaults: { p_from: null, p_to: null }, auth: true },
  mob_data_epoch: { params: [], auth: true },
  mob_report_mine: { params: ['p_from', 'p_to', 'p_limit'], defaults: { p_from: null, p_to: null, p_limit: 500 }, auth: true },
  mob_report_ledger: { params: ['p_from', 'p_to', 'p_staff_id', 'p_limit'], defaults: { p_from: null, p_to: null, p_staff_id: null, p_limit: 2000 }, auth: true },
  mob_integrity_check: { params: [], auth: true },
  mob_export_all: { params: [], auth: true },
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Actions that start a real business relationship (a signup request, an add-on request, a payment) need a proven
// email address, once the owner has switched the requirement on (platform_flags, db/092). Off by default.
async function requireVerifiedEmail(userId) {
  if (!userId || !(await emailVerificationRequired())) return;
  const st = await emailVerificationState(userId);
  if (st && !st.verified) throw new HttpError(403, 'Please confirm your email address first. We sent you a link when you signed up; you can ask for a new one from your account page.');
}

// ---- CORS: reflect the request's Origin only when it's this domain,
// a subdomain of it (every tenant), or localhost (local dev) -- never
// the wildcard '*' every response used to send unconditionally. ----
function allowedOrigin(originHeader) {
  if (!originHeader) return null;
  let u;
  try { u = new URL(originHeader); } catch { return null; }
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return originHeader;
  if (!DOMAIN || u.protocol !== 'https:') return null;
  if (u.hostname === DOMAIN || u.hostname.endsWith('.' + DOMAIN)) return originHeader;
  return null;
}

// ---- rate limiting: plain in-memory fixed-window counters, no
// external dependency or paid service. Deliberately NOT applied as a
// single global per-IP cap -- a cafe's whole customer base can share
// one NAT/WiFi IP while self-ordering off a QR code, so a blanket
// limit would lock out real customers. Instead: tight limits on the
// two endpoints actually worth brute-forcing (login, signup), and a
// generous shared-IP-friendly ceiling on the public/anonymous RPCs. ----
const rateBuckets = new Map();
function rateLimited(key, limit, windowMs) {
  if (process.env.DISABLE_RATE_LIMIT === '1') return false; // automated tests only (tests/lib/stack.mjs); never set in production
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; rateBuckets.set(key, b); }
  b.count += 1;
  return b.count > limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (b.resetAt <= now) rateBuckets.delete(k);
}, 60_000).unref();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  // Caddy (the only thing in front of this server) puts the real address in X-Forwarded-For; take the LAST entry, the one our own proxy wrote, never the first, which a caller can set to anything to dodge the rate limits.
  if (fwd) { const parts = String(fwd).split(',').map((x) => x.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.socket.remoteAddress || 'unknown';
}

function parseFilters(query, allowedColumns) {
  const filters = [];
  for (const [key, val] of query.entries()) {
    const m = key.match(/^(eq|gte|lte|gt|lt)\.(.+)$/);
    if (!m) continue;
    const [, op, col] = m;
    if (!allowedColumns.includes(col)) throw new HttpError(400, `bad filter column: ${col}`);
    filters.push({ op, col, val });
  }
  return filters;
}

async function handleSelect(client, table, cfg, query) {
  const selectParam = query.get('select') || '*';
  const selectCols = selectParam === '*' ? ['*'] : selectParam.split(',').map((s) => s.trim());
  if (!(selectCols.length === 1 && selectCols[0] === '*')) {
    for (const c of selectCols) if (!cfg.columns.includes(c)) throw new HttpError(400, `bad select column: ${c}`);
  }
  const filters = parseFilters(query, cfg.columns);
  const order = query.get('order');
  if (order && !cfg.columns.includes(order)) throw new HttpError(400, 'bad order column');
  const limit = query.get('limit') ? parseInt(query.get('limit'), 10) : null;

  // records.updated_at is the optimistic-concurrency token (push_record compares it for exact equality). node-pg would hand it back as a JS Date,
  // i.e. truncated to milliseconds, so every record pulled from the server looked "changed on another device" at the next push and was force-overwritten.
  // Serve it as a microsecond-precision ISO string, the same shape push_record returns.
  const stamp = (c) => `to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') as ${c}`;
  let outCols = selectCols;
  if (table === 'records') outCols = (selectCols[0] === '*' ? cfg.columns : selectCols).map((c) => (c === 'updated_at' ? stamp(c) : c));
  let sql = `select ${outCols.join(',')} from ${table}`;
  const params = [];
  if (filters.length) {
    sql += ' where ' + filters.map((f) => { params.push(f.val); return `${f.col} ${OPS[f.op]} $${params.length}`; }).join(' and ');
  }
  if (order) sql += ` order by ${order}`;
  if (limit) sql += ` limit ${limit}`;

  const { rows } = await client.query(sql, params);
  return query.get('single') === '1' ? (rows[0] || null) : rows;
}

async function handleInsert(client, table, cfg, body, onConflictCol) {
  const insertable = cfg.insertable || cfg.columns;
  const cols = Object.keys(body).filter((c) => insertable.includes(c));
  if (!cols.length) throw new HttpError(400, 'nothing to insert');
  const values = cols.map((c) => body[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  let sql = `insert into ${table} (${cols.join(',')}) values (${placeholders.join(',')})`;
  if (onConflictCol) {
    const updateSet = cols.filter((c) => c !== onConflictCol).map((c) => `${c}=excluded.${c}`).join(',');
    sql += ` on conflict (${onConflictCol}) do update set ${updateSet}`;
  }
  sql += ' returning *';
  const { rows } = await client.query(sql, values);
  return rows[0];
}

async function handleUpdate(client, table, cfg, body, query) {
  const writable = cfg.writable || cfg.columns;
  const cols = Object.keys(body).filter((c) => writable.includes(c));
  if (!cols.length) throw new HttpError(400, 'nothing to update');
  const filters = parseFilters(query, cfg.columns);
  const values = cols.map((c) => body[c]);
  const setClauses = cols.map((c, i) => `${c}=$${i + 1}`);
  let sql = `update ${table} set ${setClauses.join(',')}`;
  if (filters.length) {
    sql += ' where ' + filters.map((f) => { values.push(f.val); return `${f.col} ${OPS[f.op]} $${values.length}`; }).join(' and ');
  }
  sql += ' returning *';
  const { rows } = await client.query(sql, values);
  return rows;
}

async function callRpc(client, fnName, args) {
  const cfg = RPC[fnName];
  if (!cfg) throw new HttpError(404, 'unknown function');
  const jsonbParams = cfg.jsonb || [];
  const values = cfg.params.map((p) => {
    const v = args[p] !== undefined ? args[p] : (cfg.defaults && p in cfg.defaults ? cfg.defaults[p] : null);
    return jsonbParams.includes(p) && v !== null ? JSON.stringify(v) : v;
  });
  const placeholders = cfg.params.map((_, i) => `$${i + 1}`);
  const { rows } = await client.query(`select ${fnName}(${placeholders.join(',')}) as result`, values);
  return rows[0]?.result;
}

function httpFromError(err) {
  let status = err.status || 500;
  let message = err.message || 'internal error';
  // Phase 1: bookings_no_overlap is a Postgres EXCLUDE constraint
  // (see 008_phase1_...sql) -- surface its violation as a normal
  // 409, not a raw 500. Verified against a real Postgres 16 (see
  // that migration's own testing notes).
  if (err.code === '23P01') {
    status = 409;
    message = 'That resource is already booked for an overlapping time.';
  }
  // A stale/cached login token whose auth_users row no longer exists
  // (e.g. an admin cleanup deleted it) hits this FK, not a bad
  // password -- surface it as "please sign in again", not a raw
  // constraint-violation string.
  if (err.code === '23503' && /user_id_fkey/.test(err.constraint || '')) {
    status = 401;
    message = 'Your session is no longer valid. Please sign in again.';
  }
  if (err.code === '23505' && err.constraint === 'auth_users_email_key') {
    status = 409;
    message = 'An account with that email already exists.';
  }
  // Accounting raises ordinary business-rule errors from SQL (locked period, insufficient stock, credit limit,
  // unbalanced journal, ...). Those are the caller's to fix, not server faults: 400 (or 401/403), and no stack in the log.
  if (status === 500 && typeof err.code === 'string') {
    if (err.code === 'P0001' || /^(AC|PY|MB)\d{3}$/.test(err.code) || /^(22|23)/.test(err.code)) { status = 400; message = err.message; }
    else if (err.code === '42501') { status = 403; message = err.message; }
    else if (err.code === '28000') { status = 401; message = err.message; }
  }
  return { status, message };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 5_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new HttpError(400, 'bad json')); } });
    req.on('error', reject);
  });
}
function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (maxBytes && total > maxBytes) { req.destroy(); reject(new HttpError(413, 'file too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body, origin) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  };
  if (origin) { headers['Access-Control-Allow-Origin'] = origin; headers['Vary'] = 'Origin'; }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  // Salon Suite (Showoff Salon's original app, see salon.js): same-origin
  // /api/* on a tenant subdomain, rewritten to /salon-api by Caddy.
  if (req.url.startsWith('/salon-api')) { handleSalon(req, res, clientIp(req)); return; }
  const origin = allowedOrigin(req.headers.origin);
  const reply = (status, body) => send(res, status, body, origin);
  if (req.method === 'OPTIONS') { reply(204, {}); return; }

  const url = new URL(req.url, 'http://internal');
  const user = verifyToken(bearerFrom(req) || '');
  const ip = clientIp(req);
  const meta = { ip, userAgent: req.headers['user-agent'] || '' }; // threaded into every sign-in, so it gets its own row in auth_sessions (db/071)

  try {
    // ---- health: for uptime monitors (UptimeRobot etc.). Public on purpose and carries nothing sensitive: it only
    // says whether the API is up and can reach the database. ----
    if (url.pathname === '/health' && (req.method === 'GET' || req.method === 'HEAD')) {
      try {
        await pool.query('select 1');
        return reply(200, { ok: true, db: true, uptime_s: Math.round(process.uptime()) });
      } catch {
        return reply(503, { ok: false, db: false });
      }
    }

    // ---- per-tenant home-screen icon/manifest for the main app shell
    // (POS, console, Payroll, Accounting, AUZsMob). Public on purpose, no
    // session needed -- a browser asks for these before anyone is signed
    // in. See server/src/appicon.js. Falls back to the static, shared
    // AUZslab icon/manifest for a shared address (app., auzsmob., ...) or
    // an unknown subdomain. ----
    if (url.pathname === '/app-manifest.json' && req.method === 'GET') {
      const tenant = await tenantForIconContext(req);
      if (!tenant) { res.writeHead(302, { Location: '/manifest.json' }); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
      res.end(JSON.stringify(appManifest(tenant, tenant.settings)));
      return;
    }
    const appIconMatch = url.pathname.match(/^\/app-icon\/(\d+)\.png$/);
    if (appIconMatch && req.method === 'GET') {
      const size = Math.min(512, Math.max(32, parseInt(appIconMatch[1], 10) || 192));
      const tenant = await tenantForIconContext(req);
      if (!tenant) { res.writeHead(302, { Location: '/icon-512.png' }); res.end(); return; }
      const buf = await appIcon(tenant, tenant.settings, size);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' });
      res.end(buf);
      return;
    }

    // ---- auth ----
    // ---- staff sign-in: username + PIN (db/096). Same reply shape as /auth/login. ----
    if (url.pathname === '/auth/staff-login' && req.method === 'POST') {
      const { username, pin } = await readJsonBody(req);
      if (rateLimited(`staffpin:${ip}`, 40, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const result = await staffLogin(username, pin, meta);
      if (!result) throw new HttpError(401, 'Wrong username or PIN');
      if (result.locked) throw new HttpError(429, 'Too many wrong PINs. Try again in 15 minutes, or ask your owner to reset your PIN.');
      return reply(200, result);
    }
    if (url.pathname === '/auth/login' && req.method === 'POST') {
      const { email, password } = await readJsonBody(req);
      // 20 attempts / 15 min per IP for real accounts -- bcrypt is
      // expensive on purpose, and login is the endpoint most worth
      // brute-forcing. The two published demo logins get a far looser,
      // separate bucket (see DEMO_LOGIN_EMAILS above) so a crowd of
      // prospects sharing one IP don't lock each other out of a login
      // that's meant to be tried by strangers.
      const isDemo = typeof email === 'string' && DEMO_LOGIN_EMAILS.has(email.trim().toLowerCase());
      const bucket = isDemo ? `demologin:${ip}` : `login:${ip}`;
      const limit = isDemo ? 300 : 20;
      if (rateLimited(bucket, limit, 15 * 60_000)) throw new HttpError(429, 'too many login attempts, try again later');
      // Also limit per account, so a crowd of different addresses cannot take turns guessing one person's password.
      if (!isDemo && typeof email === 'string' && rateLimited(`loginacct:${email.trim().toLowerCase()}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many login attempts for this account, try again later');
      const result = await login(email, password, meta);
      if (!result) throw new HttpError(401, 'invalid credentials');
      if (result.unverified) throw new HttpError(403, 'Please verify your email first -- check your inbox for the verification link, or ask your manager to resend it.');
      return reply(200, result);
    }
    // ---- silent session renewal (owner report: POS clients got logged out
    // "again and again" mid-shift -- nothing ever refreshed a token before
    // this, so it expired exactly 7 days after the last LOGIN regardless of
    // how actively someone kept using the app). Needs an already-valid,
    // non-expired, non-revoked token -- a session that's truly gone stale
    // still gets a plain 401 here and has to sign in again, same as today. ----
    if (url.pathname === '/auth/refresh' && req.method === 'POST') {
      await readJsonBody(req).catch(() => {});
      if (!user) throw new HttpError(401, 'Your session is no longer valid. Please sign in again.');
      if (rateLimited(`refresh:${user.id}`, 60, 15 * 60_000)) throw new HttpError(429, 'too many refresh attempts, try again later');
      return reply(200, { access_token: refreshToken(user), user: { id: user.id, email: user.email, app_metadata: user.app_metadata } });
    }
    // ---- public self-serve signup: creates a bare login with no
    // tenant_id yet (on_signup's guard skips the profiles row for it,
    // same as a platform_admin) -- becomes a real tenant owner only
    // once a platform_admin approves their signup_request. ----
    if (url.pathname === '/auth/signup' && req.method === 'POST') {
      // 10 accounts / hour per IP -- loose enough for a shared cafe/office
      // IP, tight enough to block scripted account-spam.
      if (rateLimited(`signup:${ip}`, 10, 60 * 60_000)) throw new HttpError(429, 'too many signups from this network, try again later');
      if (!(await passwordSignupAllowed())) throw new HttpError(403, 'Email sign-up is switched off. Please sign up with Google.');
      const { email, password, captcha_token } = await readJsonBody(req);
      if (!email || !password) throw new HttpError(400, 'email and password are required');
      if (password.length < 8) throw new HttpError(400, 'password must be at least 8 characters');
      if (!(await verifyCaptcha(captcha_token, ip))) throw new HttpError(400, 'Please complete the verification check and try again.');
      let created;
      try {
        created = await createUser({ email, password });
      } catch (err) {
        if (err.code === '23505') throw new HttpError(409, 'an account with that email already exists');
        throw err;
      }
      // mail the confirmation link (quietly does nothing if no mail sender is configured yet)
      const vtoken = await createEmailVerification(created.id, created.email);
      const vmail = await sendEmailVerification({ to: created.email, verifyLink: `${SITE_URL}/verify-email.html?token=${vtoken}` }).catch(() => ({ sent: false }));
      return reply(200, { access_token: await signToken(created, meta), user: created, email_verification: { sent: !!vmail.sent, verified: false } });
    }
    // ---- Google / Apple / phone sign-in (db/069) -- each finds or
    // creates an auth_users row via findOrCreateIdentityUser and returns
    // the exact same {access_token,user} shape /auth/login does, so the
    // client treats every sign-in method identically from here on. ----
    // ---- email verification (db/092) ----
    if (url.pathname === '/auth/verify-email' && req.method === 'POST') {
      if (rateLimited(`verifyemail:${ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const { token } = await readJsonBody(req);
      const r = await confirmEmailVerification(token);
      if (!r.ok) throw new HttpError(400, 'This confirmation link is invalid or has expired. Sign in and ask for a new one.');
      return reply(200, { ok: true, email: r.email });
    }
    if (url.pathname === '/auth/resend-verification' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      if (rateLimited(`resendverify:${user.id}`, 3, 60 * 60_000)) throw new HttpError(429, 'we already sent you a few links; check your inbox and spam folder, or try again in an hour');
      const st = await emailVerificationState(user.id);
      if (!st) throw new HttpError(404, 'account not found');
      if (st.verified) return reply(200, { ok: true, verified: true, sent: false });
      const vtoken = await createEmailVerification(user.id, st.email);
      const vmail = await sendEmailVerification({ to: st.email, verifyLink: `${SITE_URL}/verify-email.html?token=${vtoken}` }).catch(() => ({ sent: false }));
      return reply(200, { ok: true, verified: false, sent: !!vmail.sent });
    }
    // ---- login-email change + recovery email (db/121) ----
    const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (url.pathname === '/auth/change-email/request' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      if (rateLimited(`changeemail:${user.id}`, 5, 60 * 60_000)) throw new HttpError(429, 'too many attempts, try again in an hour');
      const { new_email, password } = await readJsonBody(req);
      if (!new_email || !EMAIL_RE.test(new_email)) throw new HttpError(400, 'that does not look like a valid email address');
      if (!(await verifyPassword(user.id, password))) throw new HttpError(401, 'your current password is incorrect');
      if (await emailInUse(new_email, user.id)) throw new HttpError(409, 'that email is already in use by another account');
      const token = await createEmailChange(user.id, new_email);
      const link = `${SITE_URL}/confirm-email.html?type=change&token=${token}`;
      const mail = await sendEmailChangeVerification({ to: new_email, verifyLink: link }).catch(() => ({ sent: false }));
      return reply(200, { ok: true, sent: !!mail.sent, link: mailConfigured() ? undefined : link });
    }
    if (url.pathname === '/auth/change-email/confirm' && req.method === 'POST') {
      if (rateLimited(`changeemailconfirm:${ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const { token } = await readJsonBody(req);
      const r = await confirmEmailChange(token);
      if (!r.ok) throw new HttpError(400, r.reason === 'taken' ? 'That email was taken by another account before this link was opened. Please start again with a different address.' : 'This confirmation link is invalid or has expired. Please ask for a new one.');
      return reply(200, { ok: true, email: r.email });
    }
    if (url.pathname === '/auth/recovery-email/request' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      if (rateLimited(`recoveryemail:${user.id}`, 5, 60 * 60_000)) throw new HttpError(429, 'too many attempts, try again in an hour');
      const { email } = await readJsonBody(req);
      if (!email || !EMAIL_RE.test(email)) throw new HttpError(400, 'that does not look like a valid email address');
      const token = await createRecoveryEmailVerification(user.id, email);
      const link = `${SITE_URL}/confirm-email.html?type=recovery&token=${token}`;
      const mail = await sendRecoveryEmailVerification({ to: email, verifyLink: link }).catch(() => ({ sent: false }));
      return reply(200, { ok: true, sent: !!mail.sent, link: mailConfigured() ? undefined : link });
    }
    if (url.pathname === '/auth/recovery-email/confirm' && req.method === 'POST') {
      if (rateLimited(`recoveryemailconfirm:${ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const { token } = await readJsonBody(req);
      const r = await confirmRecoveryEmail(token);
      if (!r.ok) throw new HttpError(400, 'This confirmation link is invalid or has expired. Please ask for a new one.');
      return reply(200, { ok: true, email: r.email });
    }
    if (url.pathname === '/auth/recovery-email/remove' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      await removeRecoveryEmail(user.id);
      return reply(200, { ok: true });
    }
    if (url.pathname === '/auth/google' && req.method === 'POST') {
      if (rateLimited(`oauth:${ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const { id_token } = await readJsonBody(req);
      if (!id_token) throw new HttpError(400, 'id_token is required');
      let result;
      try {
        result = await loginWithGoogle(id_token, meta);
      } catch (err) {
        throw new HttpError(401, err.message || 'Google sign-in failed');
      }
      if (!result) throw new HttpError(401, 'this account has been suspended');
      return reply(200, result);
    }
    if (url.pathname === '/auth/apple' && req.method === 'POST') {
      if (rateLimited(`oauth:${ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const { code } = await readJsonBody(req);
      if (!code) throw new HttpError(400, 'code is required');
      let result;
      try {
        result = await loginWithApple(code, meta);
      } catch (err) {
        throw new HttpError(401, err.message || 'Apple sign-in failed');
      }
      if (!result) throw new HttpError(401, 'this account has been suspended');
      return reply(200, result);
    }
    // 5 codes / 10 min per phone number, on top of the per-IP bucket --
    // a phone number is the actual scarce resource worth brute-forcing
    // here (an attacker rotating IPs still can't out-text the phone).
    if (url.pathname === '/auth/phone/send' && req.method === 'POST') {
      if (rateLimited(`phonesend:${ip}`, 20, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const { phone } = await readJsonBody(req);
      if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) throw new HttpError(400, 'a phone number in +<countrycode><number> format is required');
      if (rateLimited(`phonesend:${phone}`, 5, 10 * 60_000)) throw new HttpError(429, 'too many codes sent to this number, try again later');
      const code = await createPhoneOtp(phone);
      const sent = await sendOtpSms(phone, code);
      return reply(200, sent);
    }
    if (url.pathname === '/auth/phone/verify' && req.method === 'POST') {
      if (rateLimited(`phoneverify:${ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const { phone, code } = await readJsonBody(req);
      if (!phone || !code) throw new HttpError(400, 'phone and code are required');
      const result = await loginWithPhone(phone, code, meta);
      if (!result) throw new HttpError(401, 'that code is invalid or has expired');
      return reply(200, result);
    }

    // ---- self-service password reset (db/069) ----
    // Always replies the same way whether or not the email exists --
    // only createPasswordReset itself (and the server log) knows which.
    // reset_link_base is the page the CALLER wants the link to open
    // (e.g. https://auzslab.in/reset-password.html) -- same split as
    // /staff/send-invite-email, so the server never hardcodes a frontend
    // path.
    if (url.pathname === '/auth/forgot' && req.method === 'POST') {
      if (rateLimited(`forgot:${ip}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const { email, reset_link_base } = await readJsonBody(req);
      if (!email || !reset_link_base) throw new HttpError(400, 'email and reset_link_base are required');
      // At most 3 reset mails per address per hour, so nobody can fill a stranger's inbox. Same reply either way (no way to tell which addresses exist).
      if (rateLimited(`forgotmail:${String(email).trim().toLowerCase()}`, 3, 60 * 60_000)) return reply(200, { ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
      const token = await createPasswordReset(email);
      if (token) {
        // Never trust the caller's page: a reset link must open on our own site, or an attacker could get a victim a real reset email that points at their own page.
        const base = safeResetBase(reset_link_base);
        const resetLink = `${base}${base.includes('?') ? '&' : '?'}token=${token}`;
        await sendPasswordResetEmail({ to: email, resetLink }).catch((err) => console.warn('password reset email failed', err));
      }
      return reply(200, { ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
    }
    if (url.pathname === '/auth/reset' && req.method === 'POST') {
      if (rateLimited(`reset:${ip}`, 20, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const { token, password } = await readJsonBody(req);
      if (!token || !password) throw new HttpError(400, 'token and password are required');
      if (password.length < 8) throw new HttpError(400, 'password must be at least 8 characters');
      const ok = await resetPassword(token, password);
      if (!ok) throw new HttpError(400, 'this reset link is invalid or has expired');
      return reply(200, { ok: true });
    }

    // ---- self-service account deletion (Apple Guideline 5.1.1(v)) ----
    if (url.pathname === '/auth/delete-account' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      // A leaked/stolen JWT (e.g. an XSS token theft) shouldn't let an
      // attacker brute-force the password confirmation unlimited times --
      // same discipline as every other password check in this file.
      if (rateLimited(`delacct:${user.id}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const { password } = await readJsonBody(req);
      try {
        await deleteOwnAccount(user.id, password);
      } catch (err) {
        throw new HttpError(err.message === 'incorrect password' ? 401 : 400, err.message);
      }
      return reply(200, { ok: true });
    }

    if (url.pathname === '/auth/session' && req.method === 'GET') {
      if (!user) throw new HttpError(401, 'no session');
      const vs = await emailVerificationState(user.id);
      return reply(200, { user, email_verified: vs ? vs.verified : true, captcha: captchaEnabled() });
    }

    // ---- two-factor authentication (TOTP, db/117) ----
    // /auth/login, /auth/google, /auth/apple and /auth/phone/verify above
    // already pass whatever login()/loginWithGoogle()/etc. return straight
    // through to the client, so a {requires2fa, challenge} reply needs no
    // change there -- this is the one new step a client takes in between:
    // show a 6-digit code box, then call this with the challenge it got.
    if (url.pathname === '/auth/2fa/challenge' && req.method === 'POST') {
      if (rateLimited(`2fa:${ip}`, 20, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const { challenge, code } = await readJsonBody(req);
      if (!challenge || !code) throw new HttpError(400, 'challenge and code are required');
      // Each sign-in challenge gets only a few guesses in total (a 6-digit code must not be guessable from many networks at once).
      if (rateLimited(`2fach:${createHash('sha256').update(String(challenge)).digest('hex')}`, 8, 10 * 60_000)) throw new HttpError(429, 'too many wrong codes, sign in again');
      const result = await verify2faChallenge(challenge, code, meta);
      if (!result) throw new HttpError(401, 'that code is wrong or has expired');
      return reply(200, result);
    }
    if (url.pathname === '/auth/2fa/status' && req.method === 'GET') {
      if (!user) throw new HttpError(401, 'authentication required');
      return reply(200, await my2faStatus(user.id));
    }
    // Setup is gated to a tenant owner/manager -- this protects the
    // login of the person who can do the most damage if it's
    // compromised, not every staff login (shop-floor username+PIN
    // logins are untouched by 2FA). A platform admin account is
    // explicitly refused too, not just left unsupported in the UI:
    // site/admin.html and app/public/admin/onboard.html (the owner's own
    // client-onboarding tools) are deliberately never routed through a
    // 2FA prompt, and this check makes it true at the server, not just
    // by missing UI -- the owner's own ability to onboard a new client
    // must never depend on a second factor surviving on this account.
    if (url.pathname === '/auth/2fa/setup' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      // profiles has owner-read-only RLS (db/002's p_read policy, using id = app_uid() or...) -- a bare
      // pool.query here never sets app.uid, so app_uid() is null and the policy hides every row, meaning
      // this check always returned "not found" for a real owner/manager under the app role (confirmed
      // against a real running server: a real owner login got 403 "not available" every single time).
      // Same bug shape this file has already hit twice before (createOrder()'s RLS read, storage.js's
      // saveSiteUpload) -- wrap in withAuth so the policy actually sees who is asking.
      const { rows } = await withAuth(user.id, (client) => client.query('select role from profiles where id = $1', [user.id]));
      if (!rows[0] || !['owner', 'manager'].includes(rows[0].role)) throw new HttpError(403, 'Two-factor authentication is only available to a business\'s own owner or manager account.');
      if (rateLimited(`2fasetup:${user.id}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      return reply(200, await generate2faSecret(user.id, user.email));
    }
    if (url.pathname === '/auth/2fa/confirm' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      if (rateLimited(`2faconfirm:${user.id}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const { code } = await readJsonBody(req);
      const result = await confirm2fa(user.id, code);
      if (!result) throw new HttpError(400, 'that code did not match -- scan the QR code again and try the newest code shown');
      return reply(200, result);
    }
    if (url.pathname === '/auth/2fa/disable' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      if (rateLimited(`2fadisable:${user.id}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const { password, code } = await readJsonBody(req);
      const ok = await disable2fa(user.id, { password, code });
      if (!ok) throw new HttpError(401, 'enter your password or a valid code to turn this off');
      return reply(200, { ok: true });
    }

    // ---- single-device session revocation (db/071) ----
    if (url.pathname === '/auth/sessions' && req.method === 'GET') {
      if (!user) throw new HttpError(401, 'authentication required');
      const sessions = await listSessions(user.id);
      return reply(200, { sessions: sessions.map((s) => ({ ...s, current: s.jti === user.jti })) });
    }
    const revokeMatch = url.pathname.match(/^\/auth\/sessions\/([0-9a-f-]{36})\/revoke$/);
    if (revokeMatch && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      if (rateLimited(`revokesess:${user.id}`, 30, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      try {
        await revokeSession(user.id, revokeMatch[1]);
      } catch (err) {
        throw new HttpError(404, err.message || 'session not found');
      }
      return reply(200, { ok: true });
    }

    // ---- Razorpay payments (db/070) -- dormant until RAZORPAY_KEY_ID/SECRET
    // are set (see payments.js). /payments/config tells the cart page
    // whether to even offer online checkout. ----
    if (url.pathname === '/payments/config' && req.method === 'GET') {
      return reply(200, { ...paymentConfig(), gstPct: await gstPct() });
    }
    if (url.pathname === '/payments/create-order' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      // Each call hits Razorpay's own API -- worth a modest per-caller cap.
      if (rateLimited(`payorder:${ip}`, 20, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      await requireVerifiedEmail(user.id);
      const { signup_request_id, addon_request_id, period } = await readJsonBody(req);
      let result;
      try {
        result = await createOrder({ userId: user.id, signupRequestId: signup_request_id, addonRequestId: addon_request_id, period: period === 'year' ? 'year' : 'month' });
      } catch (err) {
        throw new HttpError(400, err.message || 'could not start payment');
      }
      return reply(200, result);
    }
    // Razorpay calls this directly, server-to-server -- no Bearer token,
    // no Origin, no rate limit by IP (it's always Razorpay's own IPs).
    // The signature check below is the only authentication this endpoint
    // has, and it is the ONLY thing allowed to ever mark a payment paid
    // and auto-provision a tenant -- see payments.js's own comment.
    if (url.pathname === '/payments/webhook' && req.method === 'POST') {
      const raw = await readRawBody(req, 1_000_000);
      if (!verifyWebhookSignature(raw, req.headers['x-razorpay-signature'])) {
        throw new HttpError(400, 'invalid signature');
      }
      let event;
      try { event = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'bad json'); }
      await handleWebhookEvent(event);
      return reply(200, { ok: true });
    }

    // ---- Cashfree auto-renewal (db/116) -- dormant until CASHFREE_APP_ID/
    // CASHFREE_SECRET_KEY are set (see cashfree.js). Offered to every
    // tenant, not just new signups; a failed charge only flags the
    // business for the owner to chase, never suspends anything. ----
    if (url.pathname === '/payments/cashfree/config' && req.method === 'GET') {
      return reply(200, { enabled: cashfreeConfigured() });
    }
    if (url.pathname === '/payments/cashfree/start' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      if (rateLimited(`cfautorenew:${ip}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const prof = await withAuth(user.id, (client) => client.query('select tenant_id, role from profiles where id = $1', [user.id]));
      const p = prof.rows[0];
      if (!p || p.role !== 'owner') throw new HttpError(403, 'owner access required');
      const tr = await pool.query('select name from tenants where id = $1', [p.tenant_id]);
      let result;
      try {
        result = await startAutorenew({ userId: user.id, tenantId: p.tenant_id, tenantName: tr.rows[0]?.name || 'business', email: user.email, phone: user.phone });
      } catch (err) {
        throw new HttpError(400, err.message || 'could not start auto-renewal');
      }
      return reply(200, result);
    }
    if (url.pathname === '/payments/cashfree/cancel' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      const prof = await withAuth(user.id, (client) => client.query('select tenant_id, role from profiles where id = $1', [user.id]));
      const p = prof.rows[0];
      if (!p || p.role !== 'owner') throw new HttpError(403, 'owner access required');
      await cancelAutorenew({ tenantId: p.tenant_id });
      return reply(200, { ok: true });
    }
    // Cashfree calls this server-to-server -- the signature check is the
    // only authentication it has, same discipline as the Razorpay webhook above.
    if (url.pathname === '/payments/cashfree/webhook' && req.method === 'POST') {
      const raw = await readRawBody(req, 1_000_000);
      if (!verifyCashfreeSignature(raw, req.headers['x-webhook-signature'], req.headers['x-webhook-timestamp'])) {
        throw new HttpError(400, 'invalid signature');
      }
      let event;
      try { event = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'bad json'); }
      await handleCashfreeWebhookEvent(event);
      return reply(200, { ok: true });
    }

    // ---- generic data API (records/profiles/guest_orders/push_subs/leads/signup_requests/bookings) ----
    const dbMatch = url.pathname.match(/^\/db\/([a-z_]+)$/);
    if (dbMatch) {
      const table = dbMatch[1];
      const cfg = TABLES[table];
      if (!cfg) throw new HttpError(404, 'unknown table');
      const uid = user?.id || null;

      const result = await withAuth(uid, async (client) => {
        if (req.method === 'GET') return handleSelect(client, table, cfg, url.searchParams);
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          return handleInsert(client, table, cfg, body, url.searchParams.get('onConflict'));
        }
        if (req.method === 'PATCH') {
          const body = await readJsonBody(req);
          return handleUpdate(client, table, cfg, body, url.searchParams);
        }
        throw new HttpError(405, 'method not allowed');
      });
      return reply(200, { data: result });
    }

    // ---- batch sync: POST /sync { ops: [{ id, fn, args }] } ----
    // Lets a phone send everything it queued while offline in one request instead of one request per record. It adds no
    // new door: every op goes through exactly the same allow-list, login check and per-function permission checks as
    // POST /rpc/<fn> (anonymous functions are refused here), each op in its own transaction so one refusal never undoes
    // the others. Ops run in order. After a failure that may be temporary (500s, 401, 429, 408) the rest are not tried
    // ({skipped:true}) so the client keeps them queued and the order is preserved; a refusal (4xx business rule) only
    // fails that op. The functions are idempotent on their client-generated ids, so resending a batch is safe.
    if (url.pathname === '/sync' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      const body = await readJsonBody(req);
      const ops = Array.isArray(body && body.ops) ? body.ops : null;
      if (!ops || !ops.length) throw new HttpError(400, 'ops must be a non-empty list');
      if (ops.length > 50) throw new HttpError(413, 'at most 50 ops per request');
      const results = []; let stopped = false;
      for (const op of ops) {
        const id = op && op.id != null ? String(op.id).slice(0, 80) : null;
        if (stopped) { results.push({ id, ok: false, skipped: true }); continue; }
        try {
          const fnName = op && typeof op.fn === 'string' ? op.fn : '';
          const cfg = RPC[fnName];
          if (!cfg) throw new HttpError(404, 'unknown function');
          if (!cfg.auth) throw new HttpError(400, 'this function cannot be sent in a batch');
          if (fnName === 'submit_signup_request' || fnName === 'submit_addon_request') await requireVerifiedEmail(user.id);
          const args = op.args && typeof op.args === 'object' ? op.args : {};
          const data = await withAuth(user.id, (client) => callRpc(client, fnName, args));
          results.push({ id, ok: true, data });
        } catch (e) {
          const { status, message } = httpFromError(e);
          if (status === 500) { console.error(e); captureError(e, { method: 'POST', path: '/sync', user_id: user.id }); }
          results.push({ id, ok: false, status, error: message });
          if (status >= 500 || status === 401 || status === 408 || status === 429) stopped = true;
        }
      }
      return reply(200, { results });
    }

    // ---- rpc ----
    const rpcMatch = url.pathname.match(/^\/rpc\/([a-z_]+)$/);
    if (rpcMatch && req.method === 'POST') {
      const fnName = rpcMatch[1];
      const cfg = RPC[fnName];
      if (!cfg) throw new HttpError(404, 'unknown function');
      if (cfg.auth && !user) throw new HttpError(401, 'authentication required');
      // Public/anonymous RPCs (public_menu, place_order, ...) are
      // reachable by every customer self-ordering off a QR code, often
      // from one shared cafe/restaurant WiFi IP -- so this stays
      // generous (300 / 5 min) rather than a tight per-request cap.
      // Authenticated calls aren't limited here: a logged-in session
      // already required passing the login rate limit above.
      if (!cfg.auth && rateLimited(`public:${ip}`, 300, 5 * 60_000)) throw new HttpError(429, 'too many requests, please slow down');
      // The contact form shares the generous public-RPC bucket above (sized for QR self-ordering, not a "get in
      // touch" form), so it also gets its own tighter cap -- a real visitor never submits this more than a
      // couple of times; this bounds the spam a bot can push into leads even if it clears the honeypot (db/131).
      if (fnName === 'submit_lead' && rateLimited(`lead:${ip}`, 5, 60 * 60_000)) throw new HttpError(429, 'too many requests, try again later');
      if (fnName === 'submit_signup_request' || fnName === 'submit_addon_request') await requireVerifiedEmail(user.id);
      const args = await readJsonBody(req);
      const uid = user?.id || null;
      // Anything that checks a password or sets someone's PIN/password is limited per person, so a stolen session token cannot be used to guess the current password.
      if (user && ['change_my_password', 'reset_staff_password', 'staff_reset_pin', 'admin_reset_client_password'].includes(fnName) && rateLimited(`pwrpc:${user.id}`, 10, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      const result = await withAuth(uid, (client) => callRpc(client, fnName, args));
      // After a password / PIN change, old sessions must stop working at once (the person changing their own password keeps the one they are using).
      if (user && fnName === 'change_my_password') await revokeAllSessionsForUser(user.id, user.jti || null).catch(() => {});
      if (user && ['reset_staff_password', 'staff_reset_pin'].includes(fnName) && args && /^[0-9a-f-]{36}$/i.test(String(args.p_staff_id || ''))) await revokeAllSessionsForUser(args.p_staff_id).catch(() => {});
      if (user && fnName === 'staff_set_active' && args && args.p_active === false && /^[0-9a-f-]{36}$/i.test(String(args.p_staff_id || ''))) await revokeAllSessionsForUser(args.p_staff_id).catch(() => {});
      // admin_reset_client_password (db/130) now returns the owner's user_id specifically so this can run: a platform admin
      // "logging in as owner" to do setup, then generating the final handoff password, must not leave their own setup
      // session still valid after telling the owner "your old password stops working" -- that sentence was only true of
      // the password, never the still-open session, until this line.
      if (fnName === 'admin_reset_client_password' && result && /^[0-9a-f-]{36}$/i.test(String(result.user_id || ''))) await revokeAllSessionsForUser(result.user_id).catch(() => {});
      return reply(200, { data: result });
    }

    // ---- storage: POST /storage/site/:prefix (raw image body) ----
    const storageMatch = url.pathname.match(/^\/storage\/site\/([a-zA-Z0-9_-]+)$/);
    if (storageMatch && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      const profile = await myProfile(user.id);
      if (!profile?.tenant_id || profile.role !== 'owner') throw new HttpError(403, 'owner only');
      const buffer = await readRawBody(req, 8_000_000); // 8MB cap -- client already compresses to well under this
      const result = await saveSiteUpload({ tenantId: profile.tenant_id, uid: user.id, prefix: storageMatch[1], buffer });
      return reply(200, result);
    }

    // ---- storage: employee documents (private -- never under
    // Caddy's public /uploads/* file_server rule, see storage.js).
    // Payroll v2 decides with pay_doc_check(): people staff of the
    // business, or the employee themself. The old check (can this
    // session read the hr_employee record) is kept for documents of
    // the old Payroll. ----
    if (url.pathname === '/storage/doc' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      const profile = await myProfile(user.id);
      const tenantId = profile?.tenant_id;
      const empId = url.searchParams.get('empId');
      if (!tenantId || !empId) throw new HttpError(400, !tenantId ? 'could not resolve your tenant -- sign in again' : 'empId is required');
      const { rows } = await withAuth(user.id, (client) =>
        client.query(`select 1 where pay_doc_check($2) or exists (select 1 from records where tenant_id = $1 and kind = 'hr_employee' and id = $2 and not deleted)`, [tenantId, empId]),
      );
      if (!rows.length) throw new HttpError(403, 'not authorized for this employee');
      const buffer = await readRawBody(req, 10_000_000);
      const result = await saveDocUpload({ tenantId, empId, buffer });
      return reply(200, result);
    }
    const docMatch = url.pathname.match(/^\/storage\/doc\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (docMatch && req.method === 'GET') {
      if (!user) throw new HttpError(401, 'authentication required');
      const [, tenantId, empId, filename] = docMatch;
      const profile = await myProfile(user.id);
      if (profile?.tenant_id !== tenantId) throw new HttpError(403, 'not authorized');
      const { rows } = await withAuth(user.id, (client) =>
        client.query(`select 1 where pay_doc_check($2) or exists (select 1 from records where tenant_id = $1 and kind = 'hr_employee' and id = $2 and not deleted)`, [tenantId, empId]),
      );
      if (!rows.length) throw new HttpError(403, 'not authorized for this employee');
      const doc = await readDocUpload({ tenantId, empId, filename });
      if (!doc) throw new HttpError(404, 'not found');
      res.writeHead(200, { 'Content-Type': doc.type, 'Cache-Control': 'private, max-age=31536000' });
      res.end(doc.buffer);
      return;
    }

    // ---- accounting attachments: private storage (never under Caddy's public /uploads), tenant resolved from the session.
    // acc_storage_check() raises unless accounting is on for the tenant and the caller's role may attach. ----
    if (url.pathname === '/storage/acc' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      const profile = await myProfile(user.id);
      const tenantId = profile?.tenant_id;
      if (!tenantId) throw new HttpError(400, 'could not resolve your tenant -- sign in again');
      await withAuth(user.id, (client) => client.query('select acc_storage_check() as ok'));
      const buffer = await readRawBody(req, 10_000_000);
      const saved = await saveDocUpload({ tenantId, empId: 'acc', buffer });
      return reply(200, { url: `/storage/acc/${saved.path.split('/')[0]}/${saved.path.split('/')[2]}`, contentType: saved.contentType });
    }
    const accMatch = url.pathname.match(/^\/storage\/acc\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (accMatch && req.method === 'GET') {
      if (!user) throw new HttpError(401, 'authentication required');
      const [, tenantId, filename] = accMatch;
      const profile = await myProfile(user.id);
      if (profile?.tenant_id !== tenantId) throw new HttpError(403, 'not authorized');
      await withAuth(user.id, (client) => client.query(`select acc_guard('acc_view')`));
      const doc = await readDocUpload({ tenantId, empId: 'acc', filename });
      if (!doc) throw new HttpError(404, 'not found');
      res.writeHead(200, { 'Content-Type': doc.type, 'Cache-Control': 'private, max-age=31536000', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) });
      res.end(doc.buffer);
      return;
    }

    // ---- client orders: the payment screenshot (private; the secret link is the credential) ----
    const proofPost = url.pathname.match(/^\/storage\/order-proof\/([a-f0-9]{32})$/);
    if (proofPost && req.method === 'POST') {
      if (rateLimited(`orderproof:${clientIp(req)}`, 20, 60 * 60_000)) throw new HttpError(429, 'too many uploads, try again later');
      const { rows } = await pool.query('select order_proof_target($1) as id', [proofPost[1]]);
      const orderId = rows[0] && rows[0].id;
      if (!orderId) throw new HttpError(404, 'This link is not waiting for a payment.');
      const buffer = await readRawBody(req, 6_000_000);
      const saved = await saveDocUpload({ tenantId: 'orders', empId: orderId, buffer });
      await pool.query('select order_proof_record($1, $2)', [orderId, saved.path.split('/')[2]]);
      return reply(200, { ok: true });
    }
    const proofGet = url.pathname.match(/^\/storage\/order-proof\/([0-9a-f-]{36})$/);
    if (proofGet && req.method === 'GET') {
      if (!user) throw new HttpError(401, 'authentication required');
      const { rows } = await withAuth(user.id, (client) => client.query('select admin_order_proof($1) as f', [proofGet[1]]));
      const file = rows[0] && rows[0].f;
      if (!file) throw new HttpError(404, 'no screenshot');
      const doc = await readDocUpload({ tenantId: 'orders', empId: proofGet[1], filename: file });
      if (!doc) throw new HttpError(404, 'not found');
      res.writeHead(200, { 'Content-Type': doc.type, 'Cache-Control': 'private, max-age=3600', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) });
      res.end(doc.buffer);
      return;
    }

    // ---- admin: provision-owner (was a Supabase Edge Function) ----
    if (url.pathname === '/admin/provision-owner' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'unauthorized');
      // platform_admins has RLS (id = app_uid()) -- a bare pool.query here
      // never sets app.uid, so the row is invisible and this check fails
      // for every caller regardless of admin status. Must go through
      // withAuth like every other query that touches an RLS-protected table.
      const { rows } = await withAuth(user.id, (client) =>
        client.query('select 1 from platform_admins where id = $1', [user.id]),
      );
      if (!rows.length) throw new HttpError(403, 'forbidden -- not a platform admin');
      const body = await readJsonBody(req);
      if (!body.tenant_id || !body.email) throw new HttpError(400, 'tenant_id and email are required');
      const created = await createUser({
        email: body.email,
        password: crypto.randomUUID(),
        app_metadata: { tenant_id: body.tenant_id, role: 'owner' },
        user_metadata: { name: body.name || '' },
      });
      const tempPassword = await resetToRandomPassword(created.id);
      // shared with the new owner directly (e.g. over WhatsApp) -- see
      // resetToRandomPassword's own note on why this replaces a
      // recovery-link email.
      return reply(200, { user_id: created.id, temp_password: tempPassword });
    }

    // ---- salesman: owner login for a trial tenant they created, so they can
    // also open the POS itself during a pitch, not just show the branded
    // website/invoice (db/137). Same discipline as /admin/provision-owner
    // above, but gated on is_salesman() + actually owning this exact trial.
    if (url.pathname === '/admin/salesman-provision-owner' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'unauthorized');
      const body = await readJsonBody(req);
      if (!body.tenant_id || !body.email) throw new HttpError(400, 'tenant_id and email are required');
      const { rows } = await withAuth(user.id, (client) =>
        client.query('select is_salesman($1) as ok, exists(select 1 from tenants where id = $2 and created_by_salesman = $1) as owns', [user.id, body.tenant_id]),
      );
      if (!rows[0]?.ok) throw new HttpError(403, 'forbidden -- not a salesman account');
      if (!rows[0]?.owns) throw new HttpError(403, 'not your trial tenant');
      const created = await createUser({
        email: body.email,
        password: crypto.randomUUID(),
        app_metadata: { tenant_id: body.tenant_id, role: 'owner' },
        user_metadata: { name: body.name || '' },
      });
      const tempPassword = await resetToRandomPassword(created.id);
      return reply(200, { user_id: created.id, temp_password: tempPassword });
    }

    // ---- salesman: open the POS directly, already signed in -- no email
    // prompt, no password to copy (db/139). Reuses the real owner login if
    // the salesman already made one with /admin/salesman-provision-owner
    // above (never creates a second one for the same trial); otherwise
    // creates a throwaway owner login on the spot. Either way this mints a
    // real, revocable session (signToken(), same as every other sign-in
    // path) and hands it back for the client to drop straight into the
    // #auz_gt= handoff fragment every app's sb-client.js already knows how
    // to consume (see site/signin.html's own Google handoff for the exact
    // same shape) -- so opening the returned link signs them straight into
    // the real POS, with real seeded data, with zero further taps.
    if (url.pathname === '/admin/salesman-open-pos' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'unauthorized');
      const body = await readJsonBody(req);
      if (!body.tenant_id) throw new HttpError(400, 'tenant_id is required');
      const { rows } = await withAuth(user.id, (client) =>
        client.query(
          `select is_salesman($1) as ok, t.name as tenant_name, t.niche as niche,
             (t.created_by_salesman = $1) as owns,
             au.id as owner_id, au.email as owner_email, au.app_metadata as owner_meta
           from tenants t
           left join profiles p on p.tenant_id = t.id and p.role = 'owner'
           left join auth_users au on au.id = p.id
           where t.id = $2`,
          [user.id, body.tenant_id],
        ),
      );
      if (!rows[0]?.ok) throw new HttpError(403, 'forbidden -- not a salesman account');
      if (!rows[0]?.owns) throw new HttpError(403, 'not your trial tenant');
      let owner;
      if (rows[0].owner_id) {
        owner = { id: rows[0].owner_id, email: rows[0].owner_email, app_metadata: rows[0].owner_meta };
      } else {
        owner = await createUser({
          email: `pos-demo-${crypto.randomUUID().slice(0, 8)}@trial.auzslab.in`,
          password: crypto.randomUUID(),
          app_metadata: { tenant_id: body.tenant_id, role: 'owner' },
          user_metadata: { name: rows[0].tenant_name || '' },
          verified: true,
        });
      }
      // A mobile-shop trial opens AUZsMob, which needs something to show (db/147).
      if (rows[0].niche === 'mobile') await pool.query('select mob_trial_seed($1)', [body.tenant_id]);
      const access_token = await signToken(owner, meta);
      return reply(200, { access_token, niche: rows[0].niche, user: { id: owner.id, email: owner.email, app_metadata: owner.app_metadata } });
    }

    // ---- salesman: upload a logo (or any other branding image) for a
    // trial tenant they created (db/137). Reuses saveSiteUpload() exactly
    // as the owner's own /storage/site/:prefix route does -- its internal
    // tenant-slug lookup already goes through withAuth(uid,...), and the
    // t_salesman_read policy on tenants (db/137) is what makes that lookup
    // succeed for a salesman's own uid instead of only an owner's.
    const salesmanUploadMatch = url.pathname.match(/^\/storage\/salesman\/([0-9a-f-]{36})\/([a-zA-Z0-9_-]+)$/);
    if (salesmanUploadMatch && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      const [, tenantId, prefix] = salesmanUploadMatch;
      const { rows } = await withAuth(user.id, (client) =>
        client.query('select exists(select 1 from tenants where id = $1 and created_by_salesman = $2) as owns', [tenantId, user.id]),
      );
      if (!rows[0]?.owns) throw new HttpError(403, 'not your trial tenant');
      const buffer = await readRawBody(req, 8_000_000);
      const result = await saveSiteUpload({ tenantId, uid: user.id, prefix, buffer });
      return reply(200, result);
    }

    // ---- staff invite: send the verification email (Resend) ----
    // Separate from invite_staff itself because Postgres can't make an
    // outbound HTTPS call -- invite_staff (db/044) only ever creates
    // the token; this is what actually emails it, from account.html
    // right after that RPC succeeds.
    if (url.pathname === '/staff/send-invite-email' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      const profile = await myProfile(user.id);
      if (profile?.role !== 'owner') throw new HttpError(403, 'owner only');
      const body = await readJsonBody(req);
      if (!body.email || !body.verify_link) throw new HttpError(400, 'email and verify_link are required');
      // Not an open mail relay: the link in the mail must open on our own site, and one owner can only send so many a day.
      if (rateLimited(`staffinvite:${user.id}`, 30, 24 * 60 * 60_000)) throw new HttpError(429, 'too many invites sent today');
      if (safeResetBase(body.verify_link) !== (() => { try { const u = new URL(String(body.verify_link)); return u.origin + u.pathname + u.search; } catch { return null; } })()) throw new HttpError(400, 'invalid link');
      const sent = await sendStaffInviteEmail({ to: body.email, name: body.name || '', verifyLink: body.verify_link });
      return reply(200, sent);
    }

    // ---- admin: uploads disk usage (System resources panel) ----
    // Not a Postgres RPC like the rest of that panel -- Postgres has no
    // way to stat a directory on the API container's filesystem, so
    // this stays a plain HTTP endpoint the admin.html page fetches
    // alongside admin_system_stats and merges into the same display.
    if (url.pathname === '/admin/uploads-usage' && req.method === 'GET') {
      if (!user) throw new HttpError(401, 'unauthorized');
      const { rows } = await withAuth(user.id, (client) =>
        client.query('select 1 from platform_admins where id = $1', [user.id]),
      );
      if (!rows.length) throw new HttpError(403, 'forbidden -- not a platform admin');
      return reply(200, await getUploadsDiskUsage());
    }

    // ---- admin: Users directory -- list a user's active sessions (same
    // data as their own "Where you're signed in" card, listSessions is
    // already a plain function with no owner-check built in). ----
    const userSessionsMatch = url.pathname.match(/^\/admin\/users\/([0-9a-f-]{36})\/sessions$/);
    if (userSessionsMatch && req.method === 'GET') {
      if (!user) throw new HttpError(401, 'unauthorized');
      const { rows } = await withAuth(user.id, (client) =>
        client.query('select 1 from platform_admins where id = $1', [user.id]),
      );
      if (!rows.length) throw new HttpError(403, 'forbidden -- not a platform admin');
      return reply(200, { sessions: await listSessions(userSessionsMatch[1]) });
    }

    // ---- admin: Users directory -- sign a user out of every device at once
    // (db/087). Not a Postgres RPC: revoking has to update auth.js's
    // in-memory revokedJtis Set synchronously (see revokeSession's own
    // comment) or the running server keeps honouring the token until its
    // next restart -- the same reason the self-service version
    // (/auth/sessions/:jti/revoke) isn't a generic RPC either. ----
    const revokeUserSessionsMatch = url.pathname.match(/^\/admin\/users\/([0-9a-f-]{36})\/revoke-sessions$/);
    if (revokeUserSessionsMatch && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'unauthorized');
      const { rows } = await withAuth(user.id, (client) =>
        client.query('select 1 from platform_admins where id = $1', [user.id]),
      );
      if (!rows.length) throw new HttpError(403, 'forbidden -- not a platform admin');
      const targetId = revokeUserSessionsMatch[1];
      const count = await revokeAllSessionsForUser(targetId);
      await withAuth(user.id, (client) =>
        client.query('select admin_log($1, $2, $3, $4::jsonb)', ['revoke_sessions', 'user', targetId, JSON.stringify({ count })]),
      );
      return reply(200, { ok: true, count });
    }

    throw new HttpError(404, 'not found');
  } catch (err) {
    const { status, message } = httpFromError(err);
    if (status === 500) {
      console.error(err);
      captureError(err, { method: req.method, path: url.pathname, user_id: user?.id || null });
    }
    // an unexpected failure never shows its internal text (table names, SQL, paths) to the caller; it is in the server log / error tracker
    reply(status, { error: status === 500 ? 'Something went wrong on our side. Please try again.' : message });
  }
});

startRealtime(server, { onPushEvent: handlePushEvent });

server.listen(PORT, () => console.log(`auzlabs-api listening on :${PORT}`));
startMaintenance(); // daily cleanup of expired sessions / codes / links (see maintenance.js)
