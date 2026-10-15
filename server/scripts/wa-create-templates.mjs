// Creates the AUZslab WhatsApp message templates in Meta (WhatsApp Manager) through the Graph API, so nobody has to type them by hand.
// Safe to run again: a template whose name already exists is skipped, never changed or duplicated.
//
// Run on the server, inside the running api container (it already holds WA_ACCESS_TOKEN; nothing is printed or stored):
//   docker compose exec -T api node --input-type=module < server/scripts/wa-create-templates.mjs
// Add `-e DRY_RUN=1` (docker compose exec -T -e DRY_RUN=1 api ...) to only list what would be created.
//
// The wording follows db/184_whatsapp.sql, except that Meta refuses a body that starts or ends with a {{variable}}, so
// invoice_link and bill_paid carry a short closing sentence and quote_payment a closing line. The server only sends the
// ordered values, so the extra words change nothing in the code.

const TOKEN = process.env.WA_ACCESS_TOKEN || '';
const WABA = process.env.WA_WABA_ID || '1106508951865658'; // the "AUZs Lab" WhatsApp account (not the phone number id)
const GRAPH = process.env.WA_GRAPH_URL || 'https://graph.facebook.com/v21.0';
const DRY = !!process.env.DRY_RUN;

const T = [
  ['auzslab_quote_payment', 'Hi {{1}}, your AUZslab quote is ready. Please review and pay here: {{2}} Thank you, team AUZslab.', ['Rahul', 'https://auzslab.in/pay.html?t=abc123']],
  ['auzslab_bill_paid', 'Thank you {{1}}. We received your payment. Your GST bill {{2}} is here: {{3}} Please keep it for your records.', ['Rahul', 'AUZ/2026-27/0001', 'https://auzslab.in/inv.html?t=abc123']],
  ['auzslab_request_update', 'Hi {{1}}, an update on your AUZslab request: {{2}}.', ['Rahul', 'your request is being checked']],
  ['auzslab_renewal_reminder', 'Hi {{1}}, your AUZslab plan for {{2}} renews in {{3}} days (on {{4}}). Reply here if you need help.', ['Rahul', 'Chapter One', '5', '20 Oct 2026']],
  ['auzslab_welcome', 'Welcome to AUZslab, {{1}}. Your business address is {{2}}. We are here if you need anything.', ['Rahul', 'chapterone.auzslab.in']],
  ['auzslab_invoice_link', 'Hi {{1}}, thank you for shopping with {{2}}. Your bill {{3}} for Rs {{4}} is ready: {{5}} Visit us again soon.', ['Rahul', 'Chapter One', 'INV-0042', '450', 'https://auzslab.in/i.html?t=abc123']],
  ['auzslab_order_received', 'Hi {{1}}, {{2}} has received your order {{3}}. We will let you know when it is ready.', ['Rahul', 'Chapter One', '#12']],
  ['auzslab_order_ready', 'Hi {{1}}, your order {{2}} at {{3}} is ready.', ['Rahul', '#12', 'Chapter One']],
  ['auzslab_booking_confirmed', 'Hi {{1}}, your booking at {{2}} is confirmed for {{3}} at {{4}}.', ['Rahul', 'Showoff Salon', '20 Oct', '4:30 pm']],
  ['auzslab_booking_reminder', 'Hi {{1}}, a reminder of your booking at {{2}} on {{3}} at {{4}}. See you soon.', ['Rahul', 'Showoff Salon', '20 Oct', '4:30 pm']],
  ['auzslab_repair_ready', 'Hi {{1}}, your {{2}} is repaired and ready to collect from {{3}}.', ['Rahul', 'Samsung A14', 'Arpit Traders']],
  ['auzslab_payment_due', 'Hi {{1}}, a friendly reminder from {{2}}: Rs {{3}} is pending. Thank you.', ['Rahul', 'Arpit Traders', '1500']],
  ['auzslab_payslip_ready', 'Hi {{1}}, your payslip for {{2}} from {{3}} is ready in the app.', ['Priya', 'October 2026', 'Showoff Salon']],
];

async function graph(path, opts = {}) {
  const r = await fetch(`${GRAPH}${path}`, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

if (!TOKEN) { console.error('WA_ACCESS_TOKEN is not set in this container.'); process.exit(1); }

const have = new Set();
let url = `/${WABA}/message_templates?fields=name,status&limit=100`;
while (url) {
  const r = await graph(url);
  if (!r.ok) { console.error('Could not read the existing templates:', r.j?.error?.message || r.status); process.exit(1); }
  (r.j.data || []).forEach((t) => have.add(t.name));
  const next = r.j.paging?.next;
  url = next ? next.replace(GRAPH, '') : '';
}

let made = 0, skipped = 0, failed = 0;
for (const [name, text, sample] of T) {
  if (have.has(name)) { console.log(`skip    ${name} (already in Meta)`); skipped++; continue; }
  if (DRY) { console.log(`would create ${name}`); continue; }
  const body = { name, language: 'en', category: 'UTILITY', components: [{ type: 'BODY', text, example: { body_text: [sample] } }] };
  const r = await graph(`/${WABA}/message_templates`, { method: 'POST', body: JSON.stringify(body) });
  if (r.ok) { console.log(`created ${name} (${r.j.status || 'submitted'}, category ${r.j.category || '?'})`); made++; }
  else { console.log(`FAILED  ${name}: ${r.j?.error?.error_user_msg || r.j?.error?.message || r.status}`); failed++; }
}
console.log(`\nDone: ${made} created, ${skipped} already there, ${failed} failed.`);
if (failed) console.log('If every failure says permission, the token needs the whatsapp_business_management permission (System users > auzslab-server > Generate token).');
