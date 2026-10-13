

// ---- whitelist: the only tables/columns this API will ever touch.
// Mirrors exactly what app/public's client code actually calls (see
// index.html/site.html/i.html) -- not a generic open-ended DB proxy. ----
export const TABLES = {
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

export const OPS = { eq: '=', gte: '>=', lte: '<=', gt: '>', lt: '<' };
