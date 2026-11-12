// AI integration ("Connectors", db/318): an MCP (Model Context Protocol) server any MCP-capable AI app (Claude,
// ChatGPT, etc.) can add as a connector, exactly the way Claude.ai already connects to GitHub/Drive -- the
// client's own AI app and subscription, nothing of ours. Transport is MCP's plain "Streamable HTTP": one POST
// endpoint carrying JSON-RPC 2.0 (initialize / tools/list / tools/call), hand-rolled -- no SDK, matching this
// codebase's "no build step, no framework" rule (see CLAUDE.md "Stack").
//
// Auth is a SEPARATE path from the rest of the API, by design: every other route trusts the JWT `user` index.js
// already resolved from the Authorization header, but an MCP client sends one of our own `auz_mcp_...` keys there
// instead (verifyToken() already returns null for it harmlessly -- it isn't a valid JWT). This module looks the
// Bearer token up for itself via mcp_resolve_key() (db/318), the same "hash it, look it up, there is no session
// yet" shape server/src/auth/password.js's login() already uses for a plain password. Since routes/oauth.js
// (db/320) added a second way in -- an OAuth access token, for AI apps like ChatGPT that require real OAuth
// discovery rather than a pasted Bearer key -- a presented token is tried against BOTH resolvers below; each
// one only recognises its own token shape (auz_mcp_ vs auz_oat_) and returns null for the other, so there's no
// ambiguity. A request with neither gets 401 + WWW-Authenticate pointing at the OAuth protected-resource
// metadata, which is what lets an OAuth-only client (ChatGPT) discover the flow at all; a Bearer-key client
// (Claude) never looks at that header and keeps working exactly as before.
//
// Every tool below is a thin wrapper around code the rest of the app already runs and already trusts
// (handleSelect/callRpc from data/queries.js, inside withAuth so RLS applies exactly as it does for a logged-in
// staff member) -- no new business logic, no new SQL beyond db/318's own key-management/draft-order functions.
import { createHash, randomUUID } from 'node:crypto';
import { pool, withAuth } from '../db.js';
import { HttpError, readJsonBody } from '../lib/http.js';
import { TABLES } from '../data/tables.js';
import { handleSelect, callRpc } from '../data/queries.js';
import { mutate, readStaffAdmin } from '../salon/storage.js';
import { addBooking, addInvoice, clientsList, cashRangeSummary } from '../salon/rules.js';
import { resolveOauthAccessToken } from './oauth.js';
import { API_URL } from '../config.js';

const sha256 = (v) => createHash('sha256').update(String(v)).digest('hex');

// ---- tool catalogue -----------------------------------------------------------------------------------------
const TOOLS = [
  {
    name: 'list_inventory',
    description: "List this business's menu/inventory items (name, price, stock). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'max items to return (default 50, max 200)' } } },
  },
  {
    name: 'list_orders',
    description: "List this business's most recent orders/bills (items, total, status). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'max orders to return (default 20, max 100)' } } },
  },
  {
    name: 'list_staff',
    description: "List this business's staff (name, role, phone). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sales_summary',
    description: 'A quick revenue/order-count summary since a given number of days ago (default 1 = today). Approximate: based on when records were last updated, not a full accounting report.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { days: { type: 'integer', description: 'how many days back to include (default 1)' } } },
  },
  {
    name: 'business_daily_closing',
    description: "A timestamped end-of-day summary for the POS side of the business (sales, cash drawer movements, expenses, wastage entries, due/void orders) for one calendar day, with its own source and limits spelled out so figures are never mistaken for more than they are. This does NOT cover AuzsLedger or AuzsFinance -- use ledger_reports/finance_reports for those, since mixing figures from different books would misrepresent them. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD, defaults to today (server date)' } } },
  },
  {
    name: 'add_inventory_item',
    description: 'Add a new menu/inventory item. Most AI apps will ask you to confirm before running this -- it changes real data.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['name', 'price'],
      properties: { name: { type: 'string' }, price: { type: 'number' }, stock: { type: 'number', description: 'optional, for items tracked by stock count' } },
    },
  },
  {
    name: 'update_item_price',
    description: "Update an existing item's price. Most AI apps will ask you to confirm before running this -- it changes real data.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', required: ['item_id', 'price'], properties: { item_id: { type: 'string', description: 'the id from list_inventory' }, price: { type: 'number' } } },
  },
  {
    name: 'create_draft_order',
    description: "Draft a new order/bill from a list of items. This does NOT finalize a sale -- it lands in the business's existing order inbox for staff to review and accept, same as a customer's own QR order, so a wrong or made-up order never becomes a real bill unattended. Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['items'],
      properties: {
        table: { type: 'string', description: 'table/order label, e.g. "T3" or "Takeaway" (optional)' },
        items: { type: 'array', items: { type: 'object', required: ['name', 'qty', 'price'], properties: { name: { type: 'string' }, qty: { type: 'number' }, price: { type: 'number' } } } },
        note: { type: 'string', description: 'optional note for staff, e.g. who asked for this' },
      },
    },
  },
  // ---- POS: purchase orders and refunds -- same records-engine writes the real POS/Back Office UI makes,
  // just replicated exactly (push_record with the same kinds/shapes), not new business logic. ----
  {
    name: 'pos_list_purchase_orders',
    description: "List the business's purchase orders (draft or received). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['draft', 'received'] }, limit: { type: 'integer' } } },
  },
  {
    name: 'pos_create_purchase_order',
    description: 'Create a draft purchase order for a supplier/vendor (materials and quantities, not yet received). Use pos_receive_purchase_order once the goods actually arrive. Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['supplier', 'items'],
      properties: { supplier: { type: 'string' }, note: { type: 'string' }, items: { type: 'array', items: { type: 'object', required: ['ing', 'qty'], properties: { ing: { type: 'string', description: 'material/ingredient name' }, qty: { type: 'number' }, price: { type: 'number', description: 'estimated price per unit, optional' } } } } },
    },
  },
  {
    name: 'pos_receive_purchase_order',
    description: "Mark a purchase order received: adds the received quantity to each material's stock, records the actual purchase cost, and closes the order. This changes real stock levels -- most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: 'object', required: ['po_id'], properties: {
        po_id: { type: 'string', description: 'from pos_list_purchase_orders' },
        items: { type: 'array', description: 'optional: override received qty/price per material (defaults to what was ordered)', items: { type: 'object', required: ['ing', 'qty'], properties: { ing: { type: 'string' }, qty: { type: 'number' }, price: { type: 'number' } } } },
      },
    },
  },
  {
    name: 'pos_refund_order',
    description: "Record a refund against an already-paid bill (a customer return/money back). Adds to the bill's refund history -- cannot exceed the bill's total, and cannot be undone once recorded. Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: { type: 'object', required: ['order_id', 'amount'], properties: { order_id: { type: 'string', description: 'from list_orders' }, amount: { type: 'number' }, reason: { type: 'string' } } },
  },
  // ---- Reorder suggestions (café/retail raw materials): replicates, exactly, the same velocity-based math
  // the console's own Inventory Reports -> Reorder tab already computes client-side (invReport('reorder') in
  // app/public/console/p-inventory.js) -- no new table, no new business logic, just the same real calculation
  // made readable to an agent. To act on it, call pos_create_purchase_order (already exists). ----
  {
    name: 'pos_reorder_suggestions',
    description: "Raw materials that are at/below their reorder level, or will run out within 7 days at their recent daily usage rate -- the same calculation the console's own Inventory Reports -> Reorder tab shows, read-only. Use pos_create_purchase_order to actually act on one.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  // ---- CRM / marketing (café, retail, mobile-repair niches): replicates server-side what the console's
  // CRM/Marketing pages (p-crm.js, p-marketing.js) already compute client-side from `order`/`customer`
  // records -- customers are built from paid/due bills, not a separate master list. Segments are the same
  // fixed rules the console offers (no free-form audience query), and sending stays within what WhatsApp's
  // Business Platform actually allows: a pre-approved template via mcp_send_whatsapp, never free text --
  // see whatsapp_send's own note. The console's per-customer wa.me tap-through for a free-text campaign
  // message is a manual, human-in-the-loop action by design and is deliberately NOT replicated here as an
  // automated bulk-send; that would mean either inventing a "send free text" capability that does not exist
  // (and that WhatsApp would reject), or silently taking over the owner's own WhatsApp number. ----
  {
    name: 'crm_list_customers',
    description: "List customers, built the same way the console does: from this business's own paid/due bills (not a separate customer master list). Each entry has visit count, lifetime spend, first/last visit, and loyalty tier (Bronze/Silver/Gold by spend). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        segment: { type: 'string', enum: ['all', 'new', 'repeat', 'lapsed', 'gold', 'silver', 'bday'], description: 'same segment rules as the console: new = first visit in last 30 days, repeat = 2+ visits, lapsed = no visit in 30+ days, gold/silver = loyalty tier, bday = birthday this month (needs a saved birthday)' },
        limit: { type: 'integer', description: 'default 100, max 500' },
      },
    },
  },
  {
    name: 'crm_list_campaigns',
    description: 'List planned/sent marketing campaigns (name, type, target segment, planned date, message, how many customers the segment currently has, how many have been sent to so far). Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'default 50, max 200' } } },
  },
  {
    name: 'crm_create_campaign',
    description: "Plan a marketing campaign: give it a name, type, target segment and a message. This only plans it -- same as the console's \"New campaign\" -- it does NOT send anything (WhatsApp does not allow sending free-text marketing messages automatically; a human sends it from the console's own Message screen, one tap per customer, from the business's own WhatsApp). Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['name', 'segment', 'message'],
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['Offer', 'Festival', 'Win-back', 'Birthday', 'New item', 'Announcement'] },
        segment: { type: 'string', enum: ['all', 'new', 'repeat', 'lapsed', 'gold', 'silver', 'bday'] },
        date: { type: 'string', description: 'planned date, YYYY-MM-DD, optional' },
        message: { type: 'string', description: 'use {name} for the customer\'s own name' },
      },
    },
  },
  {
    name: 'crm_send_birthday_greetings',
    description: "Actually send (not just plan) a real WhatsApp birthday or anniversary greeting to every customer with a saved birthday/anniversary matching today's date, using AUZslab's own pre-approved WhatsApp template (birthday_greeting / anniversary_greeting) -- same channel as whatsapp_send, never free text. Skips anyone already sent to today (safe to re-run). Costs real money per message once past the WhatsApp free tier. Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', properties: { occasion: { type: 'string', enum: ['birthday', 'anniversary'], description: 'defaults to birthday' } } },
  },
  // ---- AuzsLedger (Accounting): thin wrappers over the already-registered acc_* functions, same
  // acc_guard()-enforced permissions a human user of the real app would hit. ----
  {
    name: 'ledger_context',
    description: "AuzsLedger's chart of accounts, tax codes, branches, warehouses and permissions -- read this first to find account_id/tax_code_id values before saving a document. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ledger_list_parties',
    description: 'Search AuzsLedger customers/suppliers by name, to find a party_id before saving a document. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { search: { type: 'string' }, kind: { type: 'string', enum: ['customer', 'supplier'] } } },
  },
  {
    name: 'ledger_list_documents',
    description: 'List AuzsLedger invoices/bills/expenses/etc, optionally filtered. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { search: { type: 'string' }, types: { type: 'array', items: { type: 'string' } }, status: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'integer' } } },
  },
  {
    name: 'ledger_reports',
    description: 'A standard AuzsLedger financial report. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', required: ['report'], properties: { report: { type: 'string', enum: ['pnl', 'balance_sheet', 'cash_flow', 'trial_balance'] }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } } },
  },
  {
    name: 'ledger_gst_summary',
    description: 'AuzsLedger GST summary for a period: output tax, input tax credit and what is payable (the same figures Analytics -> GSTR-3B shows). Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } } },
  },
  {
    name: 'ledger_ageing',
    description: 'Who owes the business money (receivable) or who the business owes (payable), broken down by how overdue. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['receivable', 'payable'] } } },
  },
  {
    name: 'ledger_save_document',
    description: "Create or update an AuzsLedger document (invoice, bill, expense, credit_note, ...). Use ledger_context and ledger_list_parties first to get real account_id/party_id values. Same validation the real app enforces (GST, balanced lines) -- a bad value is refused with a clear reason, not silently accepted. Does not finalize it (see ledger_post_document). Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['doc_type', 'lines'],
      properties: {
        doc_type: { type: 'string', enum: ['invoice', 'bill', 'expense', 'credit_note', 'debit_note', 'quotation', 'sales_order', 'purchase_order'] },
        id: { type: 'string', description: 'set to edit an existing draft/open document' },
        party_id: { type: 'string' }, doc_date: { type: 'string' }, note: { type: 'string' },
        lines: { type: 'array', items: { type: 'object', required: ['qty', 'rate'], properties: { account_id: { type: 'string' }, product_id: { type: 'string' }, description: { type: 'string' }, qty: { type: 'number' }, rate: { type: 'number' }, tax_code_id: { type: 'string' } } } },
      },
    },
  },
  {
    name: 'ledger_post_document',
    description: 'Finalize (post) an AuzsLedger document created with ledger_save_document, optionally recording payment against it immediately. Posting is final -- most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: { type: 'object', required: ['doc_id'], properties: { doc_id: { type: 'string' }, payments: { type: 'array', items: { type: 'object' }, description: 'optional payment(s) to record against this document right away' } } },
  },
  {
    name: 'ledger_record_payment',
    description: "Record money received from a customer (kind=receipt) or paid to a supplier (kind=payment) in AuzsLedger, and optionally allocate it against specific open invoices/bills straight away. Use ledger_context for account_id (a bank/cash account) and ledger_list_parties for party_id, and ledger_list_documents to find the doc_id(s) to allocate against. Most AI apps will ask you to confirm before running this -- it changes real financial records.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['kind', 'account_id', 'amount'],
      properties: {
        kind: { type: 'string', enum: ['receipt', 'payment'], description: 'receipt = money IN from a customer, payment = money OUT to a supplier' },
        account_id: { type: 'string', description: 'the bank/cash account the money moved through, from ledger_context' },
        party_id: { type: 'string', description: 'the customer or supplier, from ledger_list_parties' },
        amount: { type: 'number' }, mode: { type: 'string', description: 'e.g. cash, bank, upi, card, cheque' },
        reference: { type: 'string' }, notes: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' },
        auto_allocate: { type: 'boolean', description: 'automatically settle this party\'s oldest open invoices/bills first, oldest-due first' },
        allocations: { type: 'array', items: { type: 'object', required: ['doc_id', 'amount'], properties: { doc_id: { type: 'string' }, amount: { type: 'number' } } }, description: 'specific documents to allocate against instead of auto_allocate' },
      },
    },
  },
  {
    name: 'ledger_allocate_payment',
    description: 'Allocate more of an already-recorded AuzsLedger payment/receipt against a specific open invoice or bill (e.g. the party had an unallocated balance from a previous payment). Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', required: ['payment_id', 'doc_id', 'amount'], properties: { payment_id: { type: 'string' }, doc_id: { type: 'string' }, amount: { type: 'number' } } },
  },
  // ---- AuzsFinance: thin wrappers over the already-registered fin_* functions. ----
  {
    name: 'finance_dashboard',
    description: "AuzsFinance's dashboard summary (balances, recent activity). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
  },
  {
    name: 'finance_reports',
    description: 'A standard AuzsFinance report. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', required: ['report'], properties: { report: { type: 'string', enum: ['pnl', 'balance_sheet', 'trial_balance', 'cash'] }, from: { type: 'string' }, to: { type: 'string' } } },
  },
  {
    name: 'finance_people',
    description: 'Who owes money and who is owed, plus loans and partner balances tracked in AuzsFinance. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'finance_save_transaction',
    description: 'Record a transaction in AuzsFinance (use finance_people/finance_dashboard first to find account/person ids). Most AI apps will ask you to confirm before running this -- it changes real financial records.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', properties: { account_id: { type: 'string' }, amount: { type: 'number' }, type: { type: 'string' }, date: { type: 'string' }, note: { type: 'string' }, person_id: { type: 'string' }, category: { type: 'string' } } },
  },
  // ---- AUZsPay (Payroll): thin wrappers over the already-registered pay_* functions. Scoped to HR
  // operations (employees, attendance, leave/loan/claim approvals) -- deliberately NOT the payroll run/
  // calculate/finalize/bank-disbursal pipeline (pay_run_*/pay_batch_*), since those move real salary money
  // and deserve their own, carefully scoped pass rather than being folded in here. Employee/salary data is
  // sensitive -- tool descriptions say so, same owner-trust model as every other write tool in this file. ----
  {
    name: 'payroll_dashboard',
    description: "AUZsPay's dashboard summary (headcount, pending approvals, today's attendance). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'payroll_list_employees',
    description: 'List employees in AUZsPay. Includes salary details if the connector key belongs to someone with salary-view permission (normally the owner) -- treat this as sensitive personal/financial data. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { search: { type: 'string' }, status: { type: 'string', enum: ['current', 'all', 'onboarding', 'active', 'notice', 'exited'] } } },
  },
  {
    name: 'payroll_attendance_month',
    description: "One employee's attendance for a given month. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', required: ['employee_id', 'month'], properties: { employee_id: { type: 'string', description: 'from payroll_list_employees' }, month: { type: 'string', description: 'YYYY-MM' } } },
  },
  {
    name: 'payroll_list_pending_requests',
    description: 'Leave requests, attendance corrections, loans/advances and expense claims waiting for a decision. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'all'] }, employee_id: { type: 'string' } } },
  },
  {
    name: 'payroll_mark_attendance',
    description: "Mark an employee's attendance for one day (present/half-day/absent/weekly off/holiday, or specific in/out times). Refused if that day's payroll is already finalised. Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['employee_id', 'date'],
      properties: { employee_id: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, status: { type: 'string', enum: ['present', 'half', 'absent', 'weekly_off', 'holiday', 'auto'] }, in: { type: 'string', description: 'HH:MM, alternative to status' }, out: { type: 'string', description: 'HH:MM' } },
    },
  },
  {
    name: 'payroll_decide_leave',
    description: 'Approve or reject a pending leave request (from payroll_list_pending_requests). Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', required: ['request_id', 'approve'], properties: { request_id: { type: 'string' }, approve: { type: 'boolean' }, note: { type: 'string' } } },
  },
  {
    name: 'payroll_decide_loan',
    description: 'Approve or reject a pending loan/salary-advance request. Most AI apps will ask you to confirm before running this -- it affects real money owed.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', required: ['request_id', 'approve'], properties: { request_id: { type: 'string' }, approve: { type: 'boolean' } } },
  },
  {
    name: 'payroll_decide_claim',
    description: 'Approve or reject a pending expense claim. Most AI apps will ask you to confirm before running this -- it affects real money owed.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', required: ['request_id', 'approve'], properties: { request_id: { type: 'string' }, approve: { type: 'boolean' } } },
  },
  // ---- AUZsStyle (clothing/footwear retail): thin wrappers over the already-registered sty_* functions. ----
  {
    name: 'style_catalog',
    description: "AUZsStyle's catalogue -- styles, colour/size variants, prices and current stock. Read this first to find variant_id values before selling or returning. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { branch_id: { type: 'string' } } },
  },
  {
    name: 'style_list_sales',
    description: "List AUZsStyle bills. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { search: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'integer' } } },
  },
  {
    name: 'style_crm_overview',
    description: "AUZsStyle's customer overview (counts, segments, repeat-purchase stats). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'style_list_customers',
    description: 'Search AUZsStyle customers. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { search: { type: 'string' }, limit: { type: 'integer' } } },
  },
  {
    name: 'style_sell',
    description: "Record a real AUZsStyle sale. Use style_catalog first to get variant_id values. Stock is checked and reduced for real. Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['lines'],
      properties: {
        lines: { type: 'array', items: { type: 'object', required: ['variant_id', 'qty'], properties: { variant_id: { type: 'string' }, qty: { type: 'integer' }, price: { type: 'number', description: 'override the catalogue price, optional' } } } },
        customer_id: { type: 'string', description: 'optional, from style_list_customers' },
        branch_id: { type: 'string' },
        payments: { type: 'array', items: { type: 'object', required: ['mode', 'amount'], properties: { mode: { type: 'string', description: 'cash, upi, card, credit, ...' }, amount: { type: 'number' } } } },
      },
    },
  },
  {
    name: 'style_return',
    description: 'Process a return/exchange against an existing AUZsStyle bill. Returns past the business\'s own return-days window need a manager -- an owner connector key always qualifies as one. Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: 'object', required: ['sale_id', 'lines'],
      properties: {
        sale_id: { type: 'string', description: 'from style_list_sales' },
        lines: { type: 'array', items: { type: 'object', required: ['sale_line_id', 'qty'], properties: { sale_line_id: { type: 'string' }, qty: { type: 'integer' }, damaged: { type: 'boolean' } } } },
        mode: { type: 'string', enum: ['cash', 'credit_note', 'exchange'] }, reason: { type: 'string' },
      },
    },
  },
  // ---- AUZsMob (mobile phone retail & repair): thin wrappers over the already-registered mob_* functions.
  // No dedicated catalog/list RPC exists for this product (unlike AUZsStyle's sty_catalog) -- mob_sync_pull is
  // the one real read path (db/082's own comment), so mob_catalog/mob_list_repairs trim its full payload down
  // to what a connector caller needs instead of returning raw sync data. ----
  {
    name: 'mob_catalog',
    description: "AUZsMob's catalogue: accessories/non-serialized stock (with current quantity) and serialized phones currently in stock (by IMEI), plus vendors and customers. Read this first to find item_id/unit_id values before selling. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mob_report_dashboard',
    description: "AUZsMob's sales/profit/dues/low-stock dashboard for a date range (defaults to today). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } } },
  },
  {
    name: 'mob_list_repairs',
    description: 'List AUZsMob repair jobs with their current status (received/in_repair/ready/delivered/cancelled). Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['received', 'in_repair', 'ready', 'delivered', 'cancelled'] }, limit: { type: 'integer', description: 'default 50, max 200' } } },
  },
  {
    name: 'mob_sell',
    description: "Record a real AUZsMob sale (a serialized phone by unit_id, or accessories by item_id + qty) -- this bills immediately, it is not a draft. Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['items'],
      properties: {
        items: { type: 'array', items: { type: 'object', required: ['price'], properties: { unit_id: { type: 'string', description: 'a serialized phone, from mob_catalog' }, item_id: { type: 'string', description: 'an accessory, from mob_catalog' }, qty: { type: 'number', description: 'for item_id lines only; a unit_id line is always 1' }, price: { type: 'number' } } } },
        customer_name: { type: 'string' }, customer_phone: { type: 'string' },
        discount: { type: 'number' }, paid: { type: 'number', description: 'amount actually received now; defaults to the full total (nothing due)' },
        payment_mode: { type: 'string', enum: ['cash', 'upi', 'card', 'credit'] },
      },
    },
  },
  {
    name: 'mob_create_repair',
    description: 'Open a new AUZsMob repair job. Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['customer_name', 'customer_phone', 'device_model', 'problem'],
      properties: {
        customer_name: { type: 'string' }, customer_phone: { type: 'string' }, device_model: { type: 'string' }, imei: { type: 'string' }, problem: { type: 'string' },
        advance: { type: 'number' }, estimate: { type: 'number' }, warranty_days: { type: 'integer' },
      },
    },
  },
  {
    name: 'mob_update_repair_status',
    description: "Move an AUZsMob repair job to its next status (received -> in_repair -> ready -> delivered, or cancelled). Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', required: ['repair_id', 'status'], properties: { repair_id: { type: 'string', description: 'from mob_list_repairs' }, status: { type: 'string', enum: ['received', 'in_repair', 'ready', 'delivered', 'cancelled'] } } },
  },
  // ---- WhatsApp: only a business's own already-approved templates, never free text (a WhatsApp Business
  // Platform rule, see db/319's own comment) -- the AI fills in the blanks, it can never compose the message. ----
  {
    name: 'whatsapp_status',
    description: 'Whether WhatsApp is connected for this business, and the full list of available templates with their placeholders. Read this first to know which templates whatsapp_send can actually use. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'whatsapp_send',
    description: 'Send a WhatsApp message to a customer using one of the business\'s own approved templates (see whatsapp_status for the list and their placeholder order) -- never free text. Costs real money per message once past the WhatsApp free tier. Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['to', 'template'],
      properties: { to: { type: 'string', description: 'customer phone number' }, template: { type: 'string', description: 'a template key from whatsapp_status' }, params: { type: 'array', items: { type: 'string' }, description: 'fills the template\'s {{1}}, {{2}}, ... placeholders in order' }, ref: { type: 'string', description: 'optional: a unique reference so resending the same ref never double-sends' } },
    },
  },
  // ---- AI activity: every tool call (this one included) is written to mcp_audit (db/323) the instant it
  // finishes, success or failure -- the owner can review the same log in the console (Management -> AI
  // activity), and this tool lets the agent itself see its own recent actions. ----
  {
    name: 'mcp_my_activity',
    description: 'List this connector\'s own recent actions against this business (tool name, when, success/failure, the arguments used). Useful to check what you already did, or to show the owner what happened. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'default 50, max 200' } } },
  },
  // ---- Auzsalon: a different storage engine (salon_store, not records/RLS), so these go through
  // server/src/salon/{storage,rules}.js directly instead of callRpc -- see mcp.js's own handle() for the auth split. ----
  {
    name: 'salon_bookings',
    description: "List Auzsalon bookings/appointments, optionally for one date. Read-only. Only works for a Salon-niche business.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD, optional' } } },
  },
  {
    name: 'salon_clients',
    description: 'List Auzsalon clients (visits, amount billed, last visit). Read-only. Only works for a Salon-niche business.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'salon_staff_list',
    description: 'List Auzsalon staff logins (name, phone, designation, active status, whether linked to payroll). Read-only. Only works for a Salon-niche business. Note: Auzsalon has no staff scheduling/rota or commission tracking yet -- those are not real features to query.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'salon_revenue',
    description: "Auzsalon's billed revenue and cash summary for a date range. Read-only. Only works for a Salon-niche business.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } },
  },
  {
    name: 'salon_create_booking',
    description: 'Create a confirmed Auzsalon appointment. Only works for a Salon-niche business. Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['name', 'phone', 'date', 'time', 'services'],
      properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:MM, 24h' }, note: { type: 'string' }, services: { type: 'array', items: { type: 'string' }, description: 'service ids' } },
    },
  },
  {
    name: 'salon_create_invoice',
    description: 'Create and bill an Auzsalon invoice directly (not a draft -- this records a real bill). Only works for a Salon-niche business. Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['client', 'items'],
      properties: {
        client: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' } } },
        items: { type: 'array', items: { type: 'object', required: ['name', 'price'], properties: { name: { type: 'string' }, qty: { type: 'number' }, price: { type: 'number' } } } },
        paymentMode: { type: 'string', enum: ['cash', 'upi', 'card', 'credit'] }, note: { type: 'string' },
      },
    },
  },
];

const itemFilters = (extra) => { const p = new URLSearchParams({ 'eq.kind': 'item', 'eq.deleted': 'false', order: 'updated_at', ...extra }); return p; };

const phoneKey = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);
const dayOf = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '');
const tierOf = (spend) => (spend >= 10000 ? 'Gold' : spend >= 3000 ? 'Silver' : 'Bronze');
const netOf = (data) => {
  const total = Number(data.t?.total ?? data.total) || 0;
  const refunded = (data.refunds || []).reduce((s, r) => s + (Number(r.amt) || 0), 0);
  return Math.round((total - refunded) * 100) / 100;
};

// Replicates allCustomers()/customerStats() from app/public/console/p-crm.js + p-reports.js: a customer isn't
// a separate master record, it's built from this tenant's own paid/due bills, same as the real console shows.
async function crmCustomers(client) {
  const orderRows = await handleSelect(client, 'records', TABLES.records, new URLSearchParams({ 'eq.kind': 'order', 'eq.deleted': 'false', limit: '5000' }));
  const byPhone = {};
  for (const r of orderRows) {
    const d = r.data || {};
    if (!['paid', 'due'].includes(d.status)) continue;
    const k = phoneKey(d.cust?.phone);
    if (!k) continue;
    const c = (byPhone[k] = byPhone[k] || { phone: k, name: '', visits: 0, spend: 0, first: null, last: null });
    c.name = c.name || d.cust?.name || '';
    c.visits++;
    c.spend = Math.round((c.spend + netOf(d)) * 100) / 100;
    const day = dayOf(d.paidAt || d.created);
    if (day && (!c.first || day < c.first)) c.first = day;
    if (day && (!c.last || day > c.last)) c.last = day;
  }
  const customerRows = await handleSelect(client, 'records', TABLES.records, new URLSearchParams({ 'eq.kind': 'customer', 'eq.deleted': 'false', limit: '2000' }));
  for (const r of customerRows) {
    const d = r.data || {};
    const k = phoneKey(d.phone);
    if (!k) continue;
    const c = (byPhone[k] = byPhone[k] || { phone: k, name: '', visits: 0, spend: 0, first: null, last: null });
    c.name = c.name || d.name || '';
    c.email = d.email;
    c.dob = d.dob;
    c.anniv = d.anniv;
  }
  return Object.values(byPhone).map((c) => ({ ...c, tier: tierOf(c.spend) }));
}

function crmSegmentFilter(all, segment, today = new Date().toLocaleDateString('en-CA')) {
  const addDays = (iso, n) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  const month = new Date().getMonth() + 1;
  switch (segment) {
    case 'new': return all.filter((c) => c.first && c.first >= addDays(today, -30));
    case 'repeat': return all.filter((c) => c.visits > 1);
    case 'lapsed': return all.filter((c) => c.last && c.last < addDays(today, -30));
    case 'gold': return all.filter((c) => c.tier === 'Gold');
    case 'silver': return all.filter((c) => c.tier === 'Silver');
    case 'bday': return all.filter((c) => c.dob && Number(String(c.dob).slice(5, 7)) === month);
    default: return all;
  }
}

// Fire-and-forget: a failure to write the audit row must never break the tool call itself (same spirit as
// pos_audit's own "a failure to audit writes an audit_error row instead of blocking the sale" -- here there's
// nothing else to block, so this just logs to the server console and moves on).
function logMcpAudit(tenantId, keyId, tool, ok, error, args) {
  let trimmedArgs = null;
  try {
    const s = JSON.stringify(args ?? {});
    trimmedArgs = s.length > 4000 ? { truncated: true, preview: s.slice(0, 2000) } : JSON.parse(s);
  } catch { trimmedArgs = null; }
  pool.query('select mcp_audit_add($1, $2, $3, $4, $5, $6)', [tenantId, keyId, tool || '(unknown)', ok, error, trimmedArgs])
    .catch((e) => console.error('mcp_audit_add failed:', e.message));
}

async function runTool(client, name, args) {
  args = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'list_inventory': {
      const limit = Math.min(Math.max(parseInt(args.limit, 10) || 50, 1), 200);
      const rows = await handleSelect(client, 'records', TABLES.records, itemFilters({ limit: String(limit) }));
      return rows.map((r) => ({ id: r.id, ...r.data }));
    }
    case 'list_orders': {
      const limit = Math.min(Math.max(parseInt(args.limit, 10) || 20, 1), 100);
      const p = new URLSearchParams({ 'eq.kind': 'order', 'eq.deleted': 'false', order: 'updated_at', limit: String(limit) });
      const rows = await handleSelect(client, 'records', TABLES.records, p);
      return rows.map((r) => ({ id: r.id, updated_at: r.updated_at, ...r.data }));
    }
    case 'list_staff': {
      const p = new URLSearchParams({ select: 'id,email,role,name,phone' });
      return handleSelect(client, 'profiles', TABLES.profiles, p);
    }
    case 'sales_summary': {
      const days = Math.min(Math.max(parseInt(args.days, 10) || 1, 1), 90);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const p = new URLSearchParams({ 'eq.kind': 'order', 'eq.deleted': 'false', 'gte.updated_at': since, limit: '2000' });
      const rows = await handleSelect(client, 'records', TABLES.records, p);
      const billed = rows.filter((r) => r.data && ['paid', 'due'].includes(r.data.status));
      const revenue = billed.reduce((sum, r) => sum + (Number(r.data.total) || 0), 0);
      return { since_days: days, orders_seen: rows.length, bills: billed.length, revenue_sum: Math.round(revenue * 100) / 100 };
    }
    case 'business_daily_closing': {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(args.date || '') ? args.date : new Date().toISOString().slice(0, 10);
      const dayStart = `${day}T00:00:00.000Z`, dayEnd = `${day}T23:59:59.999Z`;
      const forKind = async (kind) => handleSelect(client, 'records', TABLES.records, new URLSearchParams({ 'eq.kind': kind, 'eq.deleted': 'false', 'gte.updated_at': dayStart, 'lte.updated_at': dayEnd, limit: '5000' }));
      const [orders, cashmoves, expenses, waste] = await Promise.all([forKind('order'), forKind('cashmove'), forKind('exp'), forKind('waste')]);
      const notes = ['Day boundary is UTC updated_at, not necessarily the business\'s own local trading day -- cross-check against the POS app for a date near midnight.'];

      const billed = orders.filter((r) => r.data && ['paid', 'due'].includes(r.data.status));
      const voided = orders.filter((r) => r.data?.status === 'void');
      const due = orders.filter((r) => r.data?.status === 'due');
      const revenue_total = Math.round(billed.reduce((s, r) => s + (Number(r.data.total) || 0), 0) * 100) / 100;
      const by_payment_mode = {};
      for (const r of billed) for (const p of (r.data.pays || [])) by_payment_mode[p.m] = Math.round(((by_payment_mode[p.m] || 0) + (Number(p.amt) || 0)) * 100) / 100;
      if (!billed.some((r) => Array.isArray(r.data.pays) && r.data.pays.length)) notes.push('No per-payment-mode breakdown found on these orders (pays[] missing or empty) -- by_payment_mode may be incomplete.');

      const cash_in = cashmoves.filter((r) => r.data?.type === 'in').reduce((s, r) => s + (Number(r.data.amt) || 0), 0);
      const cash_out = cashmoves.filter((r) => r.data?.type === 'out').reduce((s, r) => s + (Number(r.data.amt) || 0), 0);
      if (!cashmoves.length) notes.push('No cash drawer activity recorded for this day -- the register may not have been opened, or this business does not use it.');

      const expenses_total = Math.round(expenses.reduce((s, r) => s + (Number(r.data.amt) || 0), 0) * 100) / 100;
      const expenses_by_category = {};
      for (const r of expenses) { const c = r.data.cat || 'Uncategorised'; expenses_by_category[c] = Math.round(((expenses_by_category[c] || 0) + (Number(r.data.amt) || 0)) * 100) / 100; }

      const cash_sales = by_payment_mode.cash || 0;
      const expected_cash_in_drawer = Math.round((cash_sales + cash_in - cash_out - expenses_total) * 100) / 100;
      if (!by_payment_mode.cash) notes.push('expected_cash_in_drawer assumes 0 cash sales (no cash payments found) -- treat it as a lower bound, not a confirmed figure, if that seems wrong.');

      return {
        date: day, generated_at: new Date().toISOString(), source: 'records (kind: order, cashmove, exp, waste) -- POS side of the business only',
        sales: { orders_billed: billed.length, revenue_total, by_payment_mode, orders_due: due.length, due_amount: Math.round(due.reduce((s, r) => s + (Number(r.data.total) || 0), 0) * 100) / 100, orders_void: voided.length, void_amount: Math.round(voided.reduce((s, r) => s + (Number(r.data.total) || 0), 0) * 100) / 100 },
        cash_drawer: { cash_in: Math.round(cash_in * 100) / 100, cash_out: Math.round(cash_out * 100) / 100, moves_count: cashmoves.length, expected_cash_in_drawer },
        expenses: { total: expenses_total, by_category: expenses_by_category, count: expenses.length },
        wastage: { entries: waste.length, note: 'Count only -- wastage records a quantity of ingredient, not a rupee value, so no total is computed here.' },
        notes,
      };
    }
    case 'add_inventory_item': {
      if (!args.name || args.price == null) throw new HttpError(400, 'name and price are required');
      const rid = randomUUID();
      return callRpc(client, 'push_record', { rid, rkind: 'item', rdata: { name: String(args.name), price: Number(args.price), ...(args.stock != null ? { stock: Number(args.stock) } : {}) }, rdeleted: false, base: null, force: true });
    }
    case 'update_item_price': {
      if (!args.item_id || args.price == null) throw new HttpError(400, 'item_id and price are required');
      const p = new URLSearchParams({ 'eq.id': String(args.item_id), 'eq.kind': 'item', limit: '1' });
      const rows = await handleSelect(client, 'records', TABLES.records, p);
      const existing = rows[0];
      if (!existing) throw new HttpError(404, 'no such item (check the id from list_inventory)');
      return callRpc(client, 'push_record', { rid: args.item_id, rkind: 'item', rdata: { ...existing.data, price: Number(args.price) }, rdeleted: false, base: null, force: true });
    }
    case 'create_draft_order':
      if (!Array.isArray(args.items) || !args.items.length) throw new HttpError(400, 'items must be a non-empty array of {name,qty,price}');
      return callRpc(client, 'mcp_create_draft_order', { p_table: args.table || null, p_items: args.items, p_note: args.note || null });

    case 'pos_list_purchase_orders': {
      const p = new URLSearchParams({ 'eq.kind': 'po', 'eq.deleted': 'false', order: 'updated_at', limit: String(Math.min(args.limit || 100, 2000)) });
      const rows = await handleSelect(client, 'records', TABLES.records, p);
      const filtered = args.status ? rows.filter((r) => r.data?.status === args.status) : rows;
      return filtered.map((r) => ({ id: r.id, ...r.data }));
    }
    case 'pos_create_purchase_order': {
      if (!args.supplier || !Array.isArray(args.items) || !args.items.length) throw new HttpError(400, 'supplier and a non-empty items array are required');
      const existing = await handleSelect(client, 'records', TABLES.records, new URLSearchParams({ 'eq.kind': 'po' }));
      const no = 'PO-' + String(existing.length + 1).padStart(4, '0');
      const rid = randomUUID();
      const items = args.items.map((i) => ({ ing: i.ing, qty: Number(i.qty), price: Number(i.price) || 0 }));
      await callRpc(client, 'push_record', { rid, rkind: 'po', rdata: { supplier: args.supplier, note: args.note || '', items, status: 'draft', createdAt: new Date().toISOString(), no }, rdeleted: false, base: null, force: true });
      return { id: rid, no, status: 'draft' };
    }
    case 'pos_receive_purchase_order': {
      if (!args.po_id) throw new HttpError(400, 'po_id is required');
      const poRows = await handleSelect(client, 'records', TABLES.records, new URLSearchParams({ 'eq.id': args.po_id, 'eq.kind': 'po', limit: '1' }));
      const po = poRows[0];
      if (!po) throw new HttpError(404, 'no such purchase order (check the id from pos_list_purchase_orders)');
      if (po.data.status === 'received') throw new HttpError(400, 'this purchase order was already received');
      const toReceive = Array.isArray(args.items) && args.items.length ? args.items : po.data.items;
      const ingRows = await handleSelect(client, 'records', TABLES.records, new URLSearchParams({ 'eq.kind': 'ing' }));
      const purchaseItems = []; let amount = 0;
      for (const it of toReceive) {
        const q = Number(it.qty); if (!(q > 0)) continue;
        const p = Number(it.price) || 0;
        const existingIng = ingRows.find((r) => (r.data?.name || '').trim().toLowerCase() === String(it.ing).trim().toLowerCase());
        const cc = existingIng ? { ...existingIng.data } : { name: it.ing, unit: '', qty: 0, low: 0 };
        cc.qty = Math.round(((cc.qty || 0) + q) * 1000) / 1000;
        if (p > 0) cc.cost = p;
        cc.purchases = [...(cc.purchases || []), { vendor: args.supplier || po.data.supplier || '', qty: q, price: p, tax: 0, amt: Math.round(q * p * 100) / 100, d: new Date().toISOString().slice(0, 10), at: new Date().toISOString() }];
        await callRpc(client, 'push_record', { rid: existingIng ? existingIng.id : randomUUID(), rkind: 'ing', rdata: cc, rdeleted: false, base: null, force: true });
        purchaseItems.push({ desc: it.ing, qty: q, unit: cc.unit || '', unitPrice: p });
        amount += q * p;
      }
      amount = Math.round(amount * 100) / 100;
      const purchaseId = randomUUID();
      await callRpc(client, 'push_record', { rid: purchaseId, rkind: 'purchase', rdata: { vendorId: null, vendorName: po.data.supplier || 'Unknown', items: purchaseItems, amount, date: new Date().toISOString().slice(0, 10), notes: 'Received ' + (po.data.no || 'PO'), poId: args.po_id }, rdeleted: false, base: null, force: true });
      await callRpc(client, 'push_record', { rid: args.po_id, rkind: 'po', rdata: { ...po.data, status: 'received', receivedAt: new Date().toISOString() }, rdeleted: false, base: null, force: true });
      return { po_id: args.po_id, purchase_id: purchaseId, amount, items_received: purchaseItems.length, status: 'received' };
    }
    case 'pos_refund_order': {
      if (!args.order_id || !(Number(args.amount) > 0)) throw new HttpError(400, 'order_id and a positive amount are required');
      const rows = await handleSelect(client, 'records', TABLES.records, new URLSearchParams({ 'eq.id': args.order_id, 'eq.kind': 'order', limit: '1' }));
      const order = rows[0];
      if (!order) throw new HttpError(404, 'no such order (check the id from list_orders)');
      if (order.data.status !== 'paid') throw new HttpError(400, `only a paid bill can be refunded (this one is "${order.data.status}")`);
      const already = (order.data.refunds || []).reduce((s, r) => s + (Number(r.amt) || 0), 0);
      const total = Number(order.data.t?.total ?? order.data.total) || 0;
      if (already + Number(args.amount) > total + 0.5) throw new HttpError(400, `refunds so far (₹${already}) plus this amount would exceed the bill total (₹${total})`);
      const refunds = [...(order.data.refunds || []), { amt: Number(args.amount), at: new Date().toISOString(), reason: args.reason || null }];
      await callRpc(client, 'push_record', { rid: args.order_id, rkind: 'order', rdata: { ...order.data, refunds }, rdeleted: false, base: null, force: true });
      return { order_id: args.order_id, refunded_now: Number(args.amount), refunded_total: already + Number(args.amount), bill_total: total };
    }

    case 'pos_reorder_suggestions': {
      const rows = await handleSelect(client, 'records', TABLES.records, new URLSearchParams({ 'eq.kind': 'ing', 'eq.deleted': 'false', limit: '2000' }));
      const cutoff = new Date(Date.now() - 14 * 86_400_000);
      const now = Date.now();
      const out = [];
      for (const r of rows) {
        const g = r.data || {};
        const usage = (g.usage || []).filter((u) => u.d && new Date(u.d) >= cutoff);
        const span = usage.length ? Math.max(1, Math.min(14, Math.round((now - new Date(usage[0].d)) / 86_400_000) + 1)) : 0;
        const vel = usage.length ? Math.round((usage.reduce((a, u) => a + (Number(u.q) || 0), 0) / span) * 100) / 100 : 0;
        const daysLeft = vel > 0 ? Math.floor((g.qty || 0) / vel) : null;
        const low = (g.qty || 0) <= (g.low || 0);
        if (!low && !(daysLeft != null && daysLeft <= 7)) continue;
        const suggestedQty = vel > 0 ? Math.ceil(vel * 7) : Math.max(0, (g.low || 0) * 2 - (g.qty || 0));
        out.push({ id: r.id, name: g.name, unit: g.unit || '', on_hand: g.qty || 0, reorder_level: g.low || 0, daily_usage: vel, days_left: daysLeft, suggested_order_qty: suggestedQty, vendor: g.vendor || null, cost_per_unit: g.cost || 0 });
      }
      return out;
    }

    case 'crm_list_customers': {
      const limit = Math.min(Math.max(parseInt(args.limit, 10) || 100, 1), 500);
      const all = await crmCustomers(client);
      const filtered = crmSegmentFilter(all, args.segment || 'all').sort((a, b) => b.spend - a.spend);
      return filtered.slice(0, limit);
    }
    case 'crm_list_campaigns': {
      const limit = Math.min(Math.max(parseInt(args.limit, 10) || 50, 1), 200);
      const rows = await handleSelect(client, 'records', TABLES.records, new URLSearchParams({ 'eq.kind': 'campaign', 'eq.deleted': 'false', order: 'updated_at', limit: String(limit) }));
      const all = await crmCustomers(client);
      return rows.map((r) => ({ id: r.id, ...r.data, audience_now: crmSegmentFilter(all, r.data?.rule || 'all').length, sent_count: (r.data?.sent || []).length }));
    }
    case 'crm_create_campaign': {
      if (!args.name || !args.segment || !args.message) throw new HttpError(400, 'name, segment and message are required');
      const rid = randomUUID();
      const data = { name: String(args.name), type: args.type || 'Offer', rule: args.segment, date: args.date || null, msg: String(args.message), sent: [], createdAt: new Date().toISOString() };
      await callRpc(client, 'push_record', { rid, rkind: 'campaign', rdata: data, rdeleted: false, base: null, force: true });
      return { id: rid, ...data };
    }
    case 'crm_send_birthday_greetings': {
      const occasion = args.occasion === 'anniversary' ? 'anniversary' : 'birthday';
      const field = occasion === 'anniversary' ? 'anniv' : 'dob';
      const template = occasion === 'anniversary' ? 'anniversary_greeting' : 'birthday_greeting';
      const today = new Date().toLocaleDateString('en-CA');
      const all = await crmCustomers(client);
      const todays = all.filter((c) => c[field] && String(c[field]).slice(5, 10) === today.slice(5, 10) && c.phone);
      const settingsRows = await handleSelect(client, 'records', TABLES.records, new URLSearchParams({ 'eq.kind': 'settings', 'eq.id': 'settings', limit: '1' }));
      const shopName = settingsRows[0]?.data?.name || '';
      const results = [];
      for (const c of todays) {
        const ref = `${template}-${today}-${c.phone}`;
        try {
          await callRpc(client, 'mcp_send_whatsapp', { p_to: c.phone, p_template: template, p_params: [c.name || 'there', shopName], p_ref: ref });
          results.push({ phone: c.phone, name: c.name, sent: true });
        } catch (err) {
          results.push({ phone: c.phone, name: c.name, sent: false, reason: err.message || String(err) });
        }
      }
      return { occasion, matched_today: todays.length, results };
    }

    case 'ledger_context':
      return callRpc(client, 'acc_context', {});
    case 'ledger_list_parties':
      return callRpc(client, 'acc_list_parties', { p: { kind: args.kind || null, search: args.search || null } });
    case 'ledger_list_documents':
      return callRpc(client, 'acc_list_documents', { p: { search: args.search || null, types: args.types || [], status: args.status || null, from: args.from || null, to: args.to || null, limit: args.limit || 50 } });
    case 'ledger_reports': {
      const r = args.report;
      if (r === 'pnl') return callRpc(client, 'acc_pnl', { p_from: args.from || null, p_to: args.to || null });
      if (r === 'balance_sheet') return callRpc(client, 'acc_balance_sheet', { p_asof: args.to || null });
      if (r === 'cash_flow') return callRpc(client, 'acc_cash_flow', { p_from: args.from || null, p_to: args.to || null });
      if (r === 'trial_balance') return callRpc(client, 'acc_trial_balance', { p_from: args.from || null, p_to: args.to || null, p_all: false });
      throw new HttpError(400, 'report must be one of pnl, balance_sheet, cash_flow, trial_balance');
    }
    case 'ledger_gst_summary':
      if (!args.from || !args.to) throw new HttpError(400, 'from and to (YYYY-MM-DD) are required');
      return callRpc(client, 'acc_gst_summary', { p_from: args.from, p_to: args.to });
    case 'ledger_ageing':
      return callRpc(client, 'acc_ageing', { p: { kind: args.kind || 'receivable' } });
    case 'ledger_save_document':
      if (!args.doc_type || !Array.isArray(args.lines) || !args.lines.length) throw new HttpError(400, 'doc_type and a non-empty lines array are required');
      return callRpc(client, 'acc_save_document', { p: args });
    case 'ledger_post_document':
      if (!args.doc_id) throw new HttpError(400, 'doc_id is required');
      return callRpc(client, 'acc_post_document', { p_doc_id: args.doc_id, p_payments: args.payments || [] });

    case 'ledger_record_payment':
      if (!['receipt', 'payment'].includes(args.kind)) throw new HttpError(400, 'kind must be receipt or payment');
      if (!args.account_id || !(Number(args.amount) > 0)) throw new HttpError(400, 'account_id and a positive amount are required');
      return callRpc(client, 'acc_save_payment', { p: { kind: args.kind, account_id: args.account_id, party_id: args.party_id || null, amount: args.amount, mode: args.mode || null, reference: args.reference || null, notes: args.notes || null, date: args.date || null, auto_allocate: args.auto_allocate || false, allocations: args.allocations || [] } });
    case 'ledger_allocate_payment':
      if (!args.payment_id || !args.doc_id || !(Number(args.amount) > 0)) throw new HttpError(400, 'payment_id, doc_id and a positive amount are required');
      return callRpc(client, 'acc_allocate', { p_payment: args.payment_id, p_doc: args.doc_id, p_amount: args.amount });

    case 'finance_dashboard':
      return callRpc(client, 'fin_dashboard', { p_from: args.from || null, p_to: args.to || null });
    case 'finance_reports': {
      const r = args.report;
      if (r === 'pnl') return callRpc(client, 'fin_report_pl', { p_from: args.from || null, p_to: args.to || null });
      if (r === 'balance_sheet') return callRpc(client, 'fin_report_bs', { p_to: args.to || null });
      if (r === 'trial_balance') return callRpc(client, 'fin_report_tb', { p_to: args.to || null });
      if (r === 'cash') return callRpc(client, 'fin_report_cash', { p_from: args.from || null, p_to: args.to || null });
      throw new HttpError(400, 'report must be one of pnl, balance_sheet, trial_balance, cash');
    }
    case 'finance_people': {
      const [people, partners, loans] = await Promise.all([
        callRpc(client, 'fin_people_balances', {}),
        callRpc(client, 'fin_partner_list', {}),
        callRpc(client, 'fin_loan_list', {}),
      ]);
      return { people, partners, loans };
    }
    case 'finance_save_transaction':
      return callRpc(client, 'fin_save_txn', { p: args });

    case 'payroll_dashboard':
      return callRpc(client, 'pay_dashboard', {});
    case 'payroll_list_employees':
      return callRpc(client, 'pay_list_employees', { p: { q: args.search || null, status: args.status || null } });
    case 'payroll_attendance_month':
      if (!args.employee_id || !args.month) throw new HttpError(400, 'employee_id and month are required');
      return callRpc(client, 'pay_attendance_month', { p_emp: args.employee_id, p_month: args.month });
    case 'payroll_list_pending_requests':
      return callRpc(client, 'pay_list_requests', { p: { status: args.status || 'pending', employee_id: args.employee_id || null } });
    case 'payroll_mark_attendance':
      if (!args.employee_id || !args.date) throw new HttpError(400, 'employee_id and date are required');
      if (!args.status && !args.in) throw new HttpError(400, 'provide either status or an in time');
      return callRpc(client, 'pay_mark_attendance', { p_emp: args.employee_id, p_date: args.date, p: { status: args.status || null, in: args.in || null, out: args.out || null } });
    case 'payroll_decide_leave':
      if (!args.request_id || args.approve == null) throw new HttpError(400, 'request_id and approve are required');
      return callRpc(client, 'pay_leave_decide', { p_id: args.request_id, p_approve: !!args.approve, p_note: args.note || null });
    case 'payroll_decide_loan':
      if (!args.request_id || args.approve == null) throw new HttpError(400, 'request_id and approve are required');
      return callRpc(client, 'pay_loan_decide', { p_id: args.request_id, p_approve: !!args.approve, p: {} });
    case 'payroll_decide_claim':
      if (!args.request_id || args.approve == null) throw new HttpError(400, 'request_id and approve are required');
      return callRpc(client, 'pay_claim_decide', { p_id: args.request_id, p_approve: !!args.approve, p: {} });

    case 'style_catalog':
      return callRpc(client, 'sty_catalog', { p_branch: args.branch_id || null });
    case 'style_list_sales':
      return callRpc(client, 'sty_list_sales', { p: { search: args.search || null, from: args.from || null, to: args.to || null, limit: args.limit || 60 } });
    case 'style_crm_overview':
      return callRpc(client, 'sty_crm_overview', {});
    case 'style_list_customers':
      return callRpc(client, 'sty_list_customers', { p_q: args.search || null, p_limit: args.limit || 200 });
    case 'style_sell':
      if (!Array.isArray(args.lines) || !args.lines.length) throw new HttpError(400, 'lines must be a non-empty array of {variant_id,qty}');
      return callRpc(client, 'sty_sell', {
        p: {
          id: randomUUID(), branchId: args.branch_id || null, customerId: args.customer_id || null,
          lines: args.lines.map((l) => ({ variantId: l.variant_id, qty: l.qty, price: l.price })),
          payments: args.payments || [],
        },
      });
    case 'style_return':
      if (!args.sale_id || !Array.isArray(args.lines) || !args.lines.length) throw new HttpError(400, 'sale_id and a non-empty lines array are required');
      return callRpc(client, 'sty_return', {
        p: { id: randomUUID(), saleId: args.sale_id, mode: args.mode || 'cash', reason: args.reason || null, lines: args.lines.map((l) => ({ saleLineId: l.sale_line_id, qty: l.qty, damaged: l.damaged || false })) },
      });

    case 'mob_catalog': {
      const data = await callRpc(client, 'mob_sync_pull', { p_since: null });
      const stockByItem = {};
      for (const m of data.stock_movements || []) stockByItem[m.item_id] = (stockByItem[m.item_id] || 0) + Number(m.qty || 0);
      const items = (data.items || []).filter((i) => i.active).map((i) => ({
        id: i.id, name: i.name, category: i.category, serialized: i.serialized,
        cost_price: i.cost_price, selling_price: i.selling_price,
        ...(i.serialized ? {} : { stock: stockByItem[i.id] || 0, low_stock_at: i.low_stock_at }),
      }));
      const units_in_stock = (data.units || []).filter((u) => u.status === 'in_stock').map((u) => ({ id: u.id, item_id: u.item_id, imei: u.imei, condition: u.condition, cost_price: u.cost_price, selling_price: u.selling_price }));
      return {
        items, units_in_stock,
        vendors: (data.vendors || []).map((v) => ({ id: v.id, name: v.name, phone: v.phone })),
        customers: (data.customers || []).map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
      };
    }
    case 'mob_report_dashboard':
      return callRpc(client, 'mob_report_dashboard', { p_from: args.from || null, p_to: args.to || null });
    case 'mob_list_repairs': {
      const limit = Math.min(Math.max(parseInt(args.limit, 10) || 50, 1), 200);
      const data = await callRpc(client, 'mob_sync_pull', { p_since: null });
      const latestStatus = {};
      for (const e of (data.repair_events || []).filter((e) => e.type === 'status').sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))) {
        latestStatus[e.repair_id] = e.status;
      }
      let repairs = (data.repairs || []).map((r) => ({ id: r.id, customer_name: r.customer_name, customer_phone: r.customer_phone, device_model: r.device_model, imei: r.imei, problem: r.problem, advance: r.advance, estimate: r.estimate, status: latestStatus[r.id] || 'received', created_at: r.created_at }));
      if (args.status) repairs = repairs.filter((r) => r.status === args.status);
      return repairs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, limit);
    }
    case 'mob_sell': {
      if (!Array.isArray(args.items) || !args.items.length) throw new HttpError(400, 'items must be a non-empty array');
      for (const it of args.items) {
        if (!it.unit_id && !it.item_id) throw new HttpError(400, 'each item needs unit_id or item_id');
        if (it.price == null) throw new HttpError(400, 'each item needs a price');
      }
      const p = {
        items: args.items.map((it) => (it.unit_id ? { unitId: it.unit_id, qty: 1, price: Number(it.price) } : { itemId: it.item_id, qty: Number(it.qty) || 1, price: Number(it.price) })),
        customerName: args.customer_name || null, customerPhone: args.customer_phone || null,
        discount: args.discount || 0, paid: args.paid != null ? Number(args.paid) : undefined, paymentMode: args.payment_mode || 'cash',
      };
      return callRpc(client, 'mob_push_sale', { p_id: randomUUID(), p });
    }
    case 'mob_create_repair': {
      if (!args.customer_name || !args.customer_phone || !args.device_model || !args.problem) throw new HttpError(400, 'customer_name, customer_phone, device_model and problem are required');
      return callRpc(client, 'mob_create_repair', {
        p_id: randomUUID(),
        p: { customerName: args.customer_name, customerPhone: args.customer_phone, deviceModel: args.device_model, imei: args.imei || null, problem: args.problem, advance: args.advance || 0, estimate: args.estimate || null, warrantyDays: args.warranty_days || 0 },
      });
    }
    case 'mob_update_repair_status':
      if (!args.repair_id || !args.status) throw new HttpError(400, 'repair_id and status are required');
      return callRpc(client, 'mob_push_repair_event', { p_id: randomUUID(), p_repair_id: args.repair_id, p: { type: 'status', status: args.status } });

    case 'whatsapp_status':
      return callRpc(client, 'wa_my_status', {});
    case 'whatsapp_send':
      if (!args.to || !args.template) throw new HttpError(400, 'to and template are required');
      return callRpc(client, 'mcp_send_whatsapp', { p_to: args.to, p_template: args.template, p_params: args.params || [], p_ref: args.ref || null });

    case 'mcp_my_activity':
      return callRpc(client, 'mcp_audit_list', { p_limit: args.limit || 50 });

    default:
      throw new HttpError(404, `unknown tool: ${name}`);
  }
}

// Auzsalon tools: a different storage engine entirely (salon_store JSON documents or the generic engine,
// picked per-tenant -- see salon/storage.js's own comment), not RLS/app_uid-scoped, so these never go through
// withAuth()/callRpc() above. mcp_resolve_key already proved the caller IS this tenant's owner (db/318's own
// owner-only check at key creation time), so looking the tenant up directly by id here -- the same one-line
// computation salon_tenant(slug) does (db/170), just by id instead of slug since that's what we have -- is safe.
// Reads via withAuth (app.uid = this owner), not a bare pool query: `tenants`/`tenant_settings` have their own
// RLS, which a plain `app`-role connection with no app.uid set fails silently (zero rows, not an error) -- the
// exact "RLS policy keyed on app_uid() invisible without it" trap db/072's own session notes already hit once.
async function salonTenantFor(userId, tenantId) {
  const row = await withAuth(userId, (client) => client.query(
    `select t.id, t.name, t.slug, t.is_demo, coalesce(ts.business_rules->>'salonEngine', 'store') as engine
     from tenants t left join tenant_settings ts on ts.tenant_id = t.id where t.id = $1 and t.niche = 'salon'`,
    [tenantId],
  ).then((r) => r.rows[0]));
  if (!row) throw new HttpError(400, 'This business is not set up as a Salon (Auzsalon) tenant.');
  return row;
}

async function runSalonTool(userId, tenantId, name, args) {
  args = args && typeof args === 'object' ? args : {};
  const tenant = await salonTenantFor(userId, tenantId);
  switch (name) {
    case 'salon_bookings':
      return mutate(tenant, (db) => (db.bookings || []).filter((b) => !args.date || b.date === args.date), ['site', 'data'], []);
    case 'salon_clients':
      return mutate(tenant, (db) => clientsList(db), ['site', 'data'], []);
    case 'salon_staff_list': {
      const staff = (await readStaffAdmin(tenant, 'staff')) || { list: [] };
      return staff.list.map((s) => ({ id: s.id, name: s.name, phone: s.phone || '', designation: s.designation || '', active: s.active !== false, linked_to_payroll: !!s.employeeId }));
    }
    case 'salon_revenue':
      if (!args.from || !args.to) throw new HttpError(400, 'from and to (YYYY-MM-DD) are required');
      return mutate(tenant, (db) => cashRangeSummary(db, args.from, args.to), ['site', 'data'], []);
    case 'salon_create_booking':
      return mutate(tenant, (db) => addBooking(db, { ...args, website: '' }, true), ['site', 'data'], ['data']);
    case 'salon_create_invoice':
      if (!args.client || !Array.isArray(args.items) || !args.items.length) throw new HttpError(400, 'client and a non-empty items array are required');
      return mutate(tenant, (db) => addInvoice(db, args, { role: 'owner' }), ['site', 'data'], ['data']);
    default:
      throw new HttpError(404, `unknown tool: ${name}`);
  }
}

function rpcOk(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcErr(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

export async function handle(ctx) {
  const { req, res, url, reply } = ctx;
  if (url.pathname !== '/mcp') return false;

  // Auth is checked before the method check: an unauthenticated GET or POST alike must get 401 +
  // WWW-Authenticate, or an OAuth-only client (ChatGPT) has nothing to discover the flow from. Once
  // authenticated, only POST is actually supported (plain JSON-RPC, no SSE stream -- see the file's own
  // header comment), so an authenticated GET still gets a 405.
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const unauthorized = (msg) => {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${API_URL}/.well-known/oauth-protected-resource"`);
    throw new HttpError(401, msg);
  };
  if (!token) return unauthorized('missing bearer token');
  let resolved = null;
  let keyId = null;
  if (token.startsWith('auz_oat_')) {
    resolved = await resolveOauthAccessToken(token);
  } else {
    const { rows } = await pool.query('select mcp_resolve_key($1) as r', [sha256(token)]);
    resolved = rows[0]?.r;
    keyId = resolved?.id || null;
  }
  if (!resolved) return unauthorized('invalid, expired or revoked token');
  if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
  const { user_id, tenant_id } = resolved;

  const body = await readJsonBody(req, 500_000);
  const { id = null, method, params = {} } = body || {};

  if (method === 'initialize') {
    return reply(200, rpcOk(id, {
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'auzslab', version: '1.0.0' },
      capabilities: { tools: {} },
    }));
  }
  if (method === 'notifications/initialized') { res.statusCode = 202; res.end(); return; } // no reply expected for a notification
  if (method === 'tools/list') return reply(200, rpcOk(id, { tools: TOOLS }));
  if (method === 'tools/call') {
    const name = params?.name;
    try {
      const data = name && name.startsWith('salon_')
        ? await runSalonTool(user_id, tenant_id, name, params?.arguments)
        : await withAuth(user_id, (client) => runTool(client, name, params?.arguments));
      logMcpAudit(tenant_id, keyId, name, true, null, params?.arguments);
      return reply(200, rpcOk(id, { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false }));
    } catch (err) {
      const message = err instanceof HttpError ? err.message : (err?.message || 'tool call failed');
      logMcpAudit(tenant_id, keyId, name, false, message, params?.arguments);
      return reply(200, rpcOk(id, { content: [{ type: 'text', text: message }], isError: true }));
    }
  }
  return reply(200, rpcErr(id, -32601, `method not found: ${method}`));
}
