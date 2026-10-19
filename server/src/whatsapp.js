// WhatsApp automation (official WhatsApp Business Cloud API). One sending layer for every app (db/184).
//  * Messages are queued in wa_outbox by wa_enqueue() (SQL triggers or server code) and sent here by a small worker.
//  * Sender: the shop's own connected number, else the AUZslab platform number (WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN)
//    only if the platform admin allowed that shop, else the message is marked skipped (wa.me links keep working).
//  * Only approved TEMPLATES are sent (business-initiated messages must be templates). No free text.
//  * Dormant until credentials exist: no platform env vars and no connected shop = the worker finds nothing to send.
// Same "no npm dependency for a small protocol" bar as fcm.js / totp.js: it is one HTTPS POST.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { pool } from './db.js';

const GRAPH = process.env.WA_GRAPH_URL || 'https://graph.facebook.com/v21.0';
const PLATFORM_ID = process.env.WA_PHONE_NUMBER_ID || '';
const PLATFORM_TOKEN = process.env.WA_ACCESS_TOKEN || '';
const APP_SECRET = process.env.WA_APP_SECRET || '';
const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const MAX_ATTEMPTS = 5;
const RETRY_BASE_S = process.env.WA_RETRY_BASE_S !== undefined ? Number(process.env.WA_RETRY_BASE_S) : 30;

export const waPlatformConfigured = () => !!(PLATFORM_ID && PLATFORM_TOKEN);

// JS-callable wrapper over wa_enqueue() (db/184) for server code that isn't a SQL trigger -- today
// just the Salon router, since Showoff's bills/bookings are JSON blobs mutated by JS, not rows a
// Postgres trigger can watch. wa_enqueue() already checks wa_tenant_settings.enabled (the owner's
// on/off switch) and is idempotent per (tenant, template, ref), so this adds nothing but a safe,
// never-throwing JS entry point -- logs and swallows any failure so a message can never block the
// real action that queued it, same discipline as every `exception when others then null;` SQL trigger.
export async function enqueueWa(tenantId, phone, templateKey, params, ref) {
  try {
    await pool.query('select wa_enqueue($1, $2, $3, $4, $5)', [tenantId, phone, templateKey, JSON.stringify(params || []), ref || null]);
  } catch (e) { console.warn('enqueueWa failed:', e.message); }
}

// For a "Send" tap in a shop's own UI once automation is on: unlike enqueueWa() (fire-and-forget,
// used right when a sale/invoice is created), this reports back what actually happened, so the UI
// can show "sent"/"already sent" instead of silently doing nothing, and retries a message that
// previously failed (wa_enqueue's own idempotency is insert-only, so a failed row is never retried
// by calling it again -- the unique (tenant, template, ref) index just blocks the second insert).
export async function sendOrRetryWa(tenantId, phone, templateKey, params, ref) {
  const { rows: [s] } = await pool.query('select enabled from wa_tenant_settings where tenant_id = $1', [tenantId]);
  if (!s || !s.enabled) return { ok: false, reason: 'disabled' };
  const { rows: [existing] } = await pool.query(
    'select id, status from wa_outbox where tenant_id = $1 and template = $2 and ref = $3', [tenantId, templateKey, ref],
  );
  if (existing && existing.status === 'failed') {
    await pool.query("update wa_outbox set status = 'queued', attempts = 0, error = null, run_after = now(), updated_at = now() where id = $1", [existing.id]);
    return { ok: true, status: 'queued', retried: true };
  }
  if (existing) return { ok: true, status: existing.status, already: true };
  const { rows: [r] } = await pool.query(
    'select wa_enqueue($1, $2, $3, $4, $5) as id', [tenantId, phone, templateKey, JSON.stringify(params || []), ref || null],
  );
  return r.id ? { ok: true, status: 'queued' } : { ok: false, reason: 'not_queued' };
}

// Shop tokens are stored encrypted (AES-256-GCM, own HKDF subkey of JWT_SECRET), never returned to a browser.
const KEY = Buffer.from(hkdfSync('sha256', Buffer.from(JWT_SECRET), Buffer.alloc(0), 'auzslab-whatsapp-token-v1', 32));
export function encryptToken(t) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(t), 'utf8'), c.final()]);
  return `enc:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
export function decryptToken(v) {
  const [, iv, tag, data] = String(v).split(':');
  const d = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

// One Graph call. Returns { ok, id } or { ok:false, status, error, retry }.
export async function sendTemplate({ phoneNumberId, token, to, name, language = 'en', params = [] }) {
  const body = {
    messaging_product: 'whatsapp', to, type: 'template',
    template: { name, language: { code: language }, ...(params.length ? { components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t ?? '').slice(0, 1000) })) }] } : {}) },
  };
  let res;
  try {
    res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) { return { ok: false, status: 0, error: `network: ${e.message}`, retry: true }; }
  let j = {};
  try { j = await res.json(); } catch { /* not json */ }
  if (res.ok && j.messages?.[0]?.id) return { ok: true, id: j.messages[0].id };
  const msg = j.error?.message || `HTTP ${res.status}`;
  // 5xx, rate limits (429 / Meta code 80007 / 130429) are worth retrying; a bad number, missing template or bad token are not.
  const retry = res.status >= 500 || res.status === 429 || [4, 17, 80007, 130429, 131056].includes(j.error?.code);
  return { ok: false, status: res.status, error: msg.slice(0, 300), retry };
}

async function senderFor(tenantId) {
  if (tenantId) {
    const a = await pool.query('select phone_number_id, token_enc from wa_accounts where tenant_id = $1 and active', [tenantId]);
    if (a.rows[0]) return { kind: 'own', phoneNumberId: a.rows[0].phone_number_id, token: decryptToken(a.rows[0].token_enc) };
    const s = await pool.query('select allow_platform from wa_tenant_settings where tenant_id = $1', [tenantId]);
    if (s.rows[0]?.allow_platform && waPlatformConfigured()) return { kind: 'platform', phoneNumberId: PLATFORM_ID, token: PLATFORM_TOKEN };
    return null;
  }
  return waPlatformConfigured() ? { kind: 'platform', phoneNumberId: PLATFORM_ID, token: PLATFORM_TOKEN } : null;
}

// Sends up to `limit` due messages. Safe to run concurrently (rows are claimed with SKIP LOCKED).
export async function processOutbox(limit = 20) {
  const claimed = await pool.query(
    `update wa_outbox set status = 'sending', attempts = attempts + 1, updated_at = now()
     where id in (select id from wa_outbox where status = 'queued' and run_after <= now() order by run_after limit $1 for update skip locked)
     returning id, tenant_id, to_phone, template, params, attempts`, [limit]);
  let sent = 0;
  for (const m of claimed.rows) {
    try {
      const t = (await pool.query('select name, language from wa_templates where key = $1', [m.template])).rows[0];
      const snd = t ? await senderFor(m.tenant_id) : null;
      if (!t || !snd) {
        await pool.query(`update wa_outbox set status = 'skipped', error = $2, updated_at = now() where id = $1`, [m.id, !t ? 'unknown template' : 'no WhatsApp number connected']);
        continue;
      }
      const r = await sendTemplate({ phoneNumberId: snd.phoneNumberId, token: snd.token, to: m.to_phone, name: t.name, language: t.language, params: m.params });
      if (r.ok) {
        sent++;
        await pool.query(`update wa_outbox set status = 'sent', wa_message_id = $2, sender = $3, error = null, updated_at = now() where id = $1`, [m.id, r.id, snd.kind]);
      } else if (r.retry && m.attempts < MAX_ATTEMPTS) {
        await pool.query(`update wa_outbox set status = 'queued', error = $2, run_after = now() + ($3 || ' seconds')::interval, updated_at = now() where id = $1`, [m.id, r.error, String(RETRY_BASE_S * 2 ** m.attempts)]);
      } else {
        await pool.query(`update wa_outbox set status = 'failed', error = $2, sender = $3, updated_at = now() where id = $1`, [m.id, r.error, snd.kind]);
      }
    } catch (e) {
      await pool.query(`update wa_outbox set status = 'failed', error = $2, updated_at = now() where id = $1`, [m.id, String(e.message).slice(0, 300)]).catch(() => {});
    }
  }
  return { claimed: claimed.rowCount, sent };
}

// Meta signs every webhook POST: X-Hub-Signature-256 = "sha256=" + HMAC_SHA256(raw body, app secret).
export function verifyWebhookSignature(raw, header) {
  if (!APP_SECRET || !header) return false;
  const want = Buffer.from('sha256=' + createHmac('sha256', APP_SECRET).update(raw).digest('hex'));
  const got = Buffer.from(String(header));
  return want.length === got.length && timingSafeEqual(want, got);
}
export const verifyChallenge = (mode, token) => mode === 'subscribe' && !!VERIFY_TOKEN && token === VERIFY_TOKEN;

// Delivery receipts update the log; a customer replying STOP opts out of that sender's messages.
export async function handleWebhookEvent(body) {
  for (const entry of body?.entry || []) for (const ch of entry.changes || []) {
    const v = ch.value || {};
    for (const s of v.statuses || []) {
      const st = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' }[s.status];
      if (!st || !s.id) continue;
      const rank = `case status when 'queued' then 0 when 'sending' then 1 when 'sent' then 2 when 'delivered' then 3 when 'read' then 4 else 5 end`;
      const next = { sent: 2, delivered: 3, read: 4, failed: 6 }[st];
      await pool.query(`update wa_outbox set status = $2, error = case when $2 = 'failed' then $3 else error end, updated_at = now()
                        where wa_message_id = $1 and (${rank}) < $4`, [s.id, st, s.errors?.[0]?.title || null, next]);
    }
    for (const m of v.messages || []) {
      const text = String(m.text?.body || '').trim().toUpperCase();
      if (!['STOP', 'UNSUBSCRIBE', 'BAND'].includes(text) || !m.from) continue;
      const pid = v.metadata?.phone_number_id;
      let tenant = null;
      if (pid && pid !== PLATFORM_ID) tenant = (await pool.query('select tenant_id from wa_accounts where phone_number_id = $1', [pid])).rows[0]?.tenant_id || null;
      await pool.query(`insert into wa_optouts (tenant_id, phone) values ($1, $2) on conflict do nothing`, [tenant, m.from]);
    }
  }
}

// Connect a shop's own number: checks the credentials against Meta first so a typo is caught now, not at the first bill.
export async function connectShopNumber({ tenantId, phoneNumberId, wabaId, token }) {
  if (!/^\d{5,20}$/.test(String(phoneNumberId || ''))) throw new Error('Phone number ID should be digits only');
  if (String(token || '').length < 20) throw new Error('That access token looks too short');
  const r = await fetch(`${GRAPH}/${phoneNumberId}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!r) throw new Error('Could not reach WhatsApp. Try again.');
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message ? `WhatsApp said: ${j.error.message}` : 'WhatsApp refused those details');
  await pool.query(
    `insert into wa_accounts (tenant_id, phone_number_id, waba_id, display_phone, token_enc, active, connected_at)
     values ($1,$2,$3,$4,$5,true,now())
     on conflict (tenant_id) do update set phone_number_id = excluded.phone_number_id, waba_id = excluded.waba_id,
       display_phone = excluded.display_phone, token_enc = excluded.token_enc, active = true, connected_at = now()`,
    [tenantId, String(phoneNumberId), wabaId ? String(wabaId) : null, j.display_phone_number || null, encryptToken(token)]);
  return { number: j.display_phone_number || null, name: j.verified_name || null };
}

let timer = null;
export function startWhatsAppWorker() {
  if (process.env.DISABLE_WHATSAPP === '1' || timer) return;
  timer = setInterval(() => { processOutbox().catch((e) => console.warn('whatsapp worker:', e.message)); }, Number(process.env.WA_WORKER_MS) || 10_000);
  timer.unref();
}
