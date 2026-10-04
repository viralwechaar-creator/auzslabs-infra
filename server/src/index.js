import http from 'node:http';
import { pool, withAuth } from './db.js';
import {
  login, verifyToken, bearerFrom, createUser, resetToRandomPassword, signToken,
  loginWithGoogle, loginWithApple, createPhoneOtp, loginWithPhone,
  createPasswordReset, resetPassword, deleteOwnAccount,
  listSessions, revokeSession, revokeAllSessionsForUser, createEmailVerification, confirmEmailVerification, emailVerificationState, emailVerificationRequired } from './auth.js';
import { saveSiteUpload, saveDocUpload, readDocUpload, getUploadsDiskUsage } from './storage.js';
import { startRealtime } from './realtime.js';
import { handlePushEvent } from './push.js';
import { sendStaffInviteEmail, sendPasswordResetEmail, sendEmailVerification } from './mail.js';
import { verifyCaptcha, captchaEnabled } from './captcha.js';
import { startMaintenance } from './maintenance.js';
import { sendOtpSms } from './sms.js';
import { handleSalon } from './salon.js';
import { paymentConfig, createOrder, verifyWebhookSignature, handleWebhookEvent } from './payments.js';
import { initErrorTracking, captureError } from './errors.js';

initErrorTracking(); // dormant unless SENTRY_DSN is set -- see errors.js

const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.DOMAIN || '';
// where links in emails point (the marketing site)
const SITE_URL = process.env.PUBLIC_SITE_URL || (DOMAIN && DOMAIN !== 'localhost' ? `https://${DOMAIN}` : 'http://localhost');
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
  profiles: { columns: ['id', 'tenant_id', 'email', 'role', 'role_id', 'name', 'phone'], writable: ['role', 'role_id', 'name', 'phone'] },
  guest_orders: { columns: ['id', 'tenant_id', 'tbl', 'name', 'phone', 'note', 'items', 'status', 'created_at'], writable: ['status'] },
  push_subs: { columns: ['id', 'tenant_id', 'user_id', 'endpoint', 'p256dh', 'auth', 'created_at'], insertable: ['user_id', 'endpoint', 'p256dh', 'auth'] },
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
  public_menu: { params: ['tenant_slug'], auth: false },
  public_page: { params: ['tenant_slug', 'page_slug'], auth: false },
  public_salon_page: { params: ['tenant_slug'], auth: false },
  public_salon_slots: { params: ['tenant_slug', 'p_date'], auth: false },
  // p_service_ids is a Postgres text[] param, not jsonb -- a JS array is
  // already sent as a native array literal by default (see the comment
  // on RPC/jsonb above), so it's deliberately absent from a jsonb list here.
  public_create_booking: { params: ['tenant_slug', 'p_name', 'p_phone', 'p_email', 'p_date', 'p_time', 'p_service_ids'], auth: false },
  place_order: { params: ['tenant_slug', 't', 'n', 'p', 'nt', 'its'], jsonb: ['its'], auth: false },
  call_waiter: { params: ['tenant_slug', 't'], auth: false },
  public_invoice: { params: ['oid'], auth: false },
  submit_feedback: { params: ['oid', 'rating', 'comment'], auth: false },
  submit_lead: { params: ['p_name', 'p_contact', 'p_business', 'p_message', 'p_niche'], auth: false },
  demo_context: { params: ['p_kind', 'p_id'], auth: false },
  list_clients: { params: [], auth: true },
  update_client: { params: ['p_tenant_id', 'p_monthly_fee', 'p_renewal_date', 'p_notes', 'p_status'], auth: true },
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
  admin_list_audit: { params: ['p_limit'], defaults: { p_limit: 100 }, auth: true },

  // --- Client dashboard: own account, staff, feature toggles ---
  my_dashboard: { params: [], auth: true },
  update_my_features: { params: ['p_enabled'], jsonb: ['p_enabled'], auth: true },
  change_my_password: { params: ['p_old_password', 'p_new_password'], auth: true },
  invite_staff: { params: ['p_email', 'p_name', 'p_phone', 'p_role_id'], auth: true },
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
  mob_create_repair: { params: ['p_id', 'p'], jsonb: ['p'], auth: true },
  mob_push_repair_event: { params: ['p_id', 'p_repair_id', 'p'], jsonb: ['p'], auth: true },
  mob_push_payment: { params: ['p_id', 'p'], jsonb: ['p'], auth: true },
  mob_adjust_stock: { params: ['p_id', 'p_item_id', 'p_qty_delta', 'p_note'], defaults: { p_note: null }, auth: true },
  mob_staff_list: { params: [], auth: true },
  mob_sync_pull: { params: ['p_since'], defaults: { p_since: null }, auth: true },
  mob_report_dashboard: { params: ['p_from', 'p_to'], defaults: { p_from: null, p_to: null }, auth: true },
  mob_report_activity: { params: ['p_from', 'p_to'], defaults: { p_from: null, p_to: null }, auth: true },
  mob_report_ledger: { params: ['p_from', 'p_to', 'p_staff_id'], defaults: { p_from: null, p_to: null, p_staff_id: null }, auth: true },
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
  if (fwd) return fwd.split(',')[0].trim();
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
    // ---- auth ----
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
      const result = await login(email, password, meta);
      if (!result) throw new HttpError(401, 'invalid credentials');
      if (result.unverified) throw new HttpError(403, 'Please verify your email first -- check your inbox for the verification link, or ask your manager to resend it.');
      return reply(200, result);
    }
    // ---- public self-serve signup: creates a bare login with no
    // tenant_id yet (on_signup's guard skips the profiles row for it,
    // same as a platform_admin) -- becomes a real tenant owner only
    // once a platform_admin approves their signup_request. ----
    if (url.pathname === '/auth/signup' && req.method === 'POST') {
      // 10 accounts / hour per IP -- loose enough for a shared cafe/office
      // IP, tight enough to block scripted account-spam.
      if (rateLimited(`signup:${ip}`, 10, 60 * 60_000)) throw new HttpError(429, 'too many signups from this network, try again later');
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
      const token = await createPasswordReset(email);
      if (token) {
        const resetLink = `${reset_link_base}${reset_link_base.includes('?') ? '&' : '?'}token=${token}`;
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
      return reply(200, paymentConfig());
    }
    if (url.pathname === '/payments/create-order' && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      // Each call hits Razorpay's own API -- worth a modest per-caller cap.
      if (rateLimited(`payorder:${ip}`, 20, 15 * 60_000)) throw new HttpError(429, 'too many attempts, try again later');
      await requireVerifiedEmail(user.id);
      const { signup_request_id, addon_request_id } = await readJsonBody(req);
      let result;
      try {
        result = await createOrder({ userId: user.id, signupRequestId: signup_request_id, addonRequestId: addon_request_id });
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
      if (fnName === 'submit_signup_request' || fnName === 'submit_addon_request') await requireVerifiedEmail(user.id);
      const args = await readJsonBody(req);
      const uid = user?.id || null;
      const result = await withAuth(uid, (client) => callRpc(client, fnName, args));
      return reply(200, { data: result });
    }

    // ---- storage: POST /storage/site/:prefix (raw image body) ----
    const storageMatch = url.pathname.match(/^\/storage\/site\/([a-zA-Z0-9_-]+)$/);
    if (storageMatch && req.method === 'POST') {
      if (!user) throw new HttpError(401, 'authentication required');
      const profile = await myProfile(user.id);
      if (!profile?.tenant_id || profile.role !== 'owner') throw new HttpError(403, 'owner only');
      const buffer = await readRawBody(req, 8_000_000); // 8MB cap -- client already compresses to well under this
      const result = await saveSiteUpload({ tenantId: profile.tenant_id, prefix: storageMatch[1], buffer });
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
      if (err.code === 'P0001' || /^(AC|PY)\d{3}$/.test(err.code) || /^(22|23)/.test(err.code)) { status = 400; message = err.message; }
      else if (err.code === '42501') { status = 403; message = err.message; }
      else if (err.code === '28000') { status = 401; message = err.message; }
    }
    if (status === 500) {
      console.error(err);
      captureError(err, { method: req.method, path: url.pathname, user_id: user?.id || null });
    }
    reply(status, { error: message });
  }
});

startRealtime(server, { onPushEvent: handlePushEvent });

server.listen(PORT, () => console.log(`auzlabs-api listening on :${PORT}`));
startMaintenance(); // daily cleanup of expired sessions / codes / links (see maintenance.js)
