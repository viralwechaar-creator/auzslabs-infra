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
import { HttpError, readJsonBody, rateLimited, clientIp } from '../lib/http.js';
import { TABLES } from '../data/tables.js';
import { handleSelect, callRpc } from '../data/queries.js';
import { mutate, readStaffAdmin } from '../salon/storage.js';
import { addBooking, addInvoice, clientsList, cashRangeSummary } from '../salon/rules.js';
import { resolveOauthAccessToken } from './oauth.js';
import { API_URL } from '../config.js';
import { searchGuide } from '../data/help-guides.js';

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
  // ---- Due-payment follow-up queue (db/324): the console's "Due Payment" page already lists unpaid bills
  // with the real balance due -- these tools add the one thing it doesn't have, a persisted "did we already
  // work this one" state, so an agent (or a human) never re-starts from zero on a bill someone already called
  // about. scan flags, list reads, mark moves a flag through its lifecycle. ----
  {
    name: 'pos_duefollowup_scan',
    description: "Find due bills that don't already have an open follow-up and flag them for collection. Safe to call repeatedly -- never re-flags a bill that's already pending or contacted. Returns only the newly flagged ones.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'pos_duefollowup_list',
    description: 'List due-payment follow-ups. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'contacted', 'settled', 'dismissed'], description: 'omit for all statuses' } } },
  },
  {
    name: 'pos_duefollowup_mark',
    description: "Move a follow-up to its next state: 'contacted' after reaching the customer, 'settled' once they've paid (check the real bill first -- this does not record a payment itself), or 'dismissed' to drop it. Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', required: ['id', 'status'], properties: { id: { type: 'string', description: 'from pos_duefollowup_list' }, status: { type: 'string', enum: ['contacted', 'settled', 'dismissed'] }, note: { type: 'string' } } },
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
    name: 'ledger_save_party',
    description: "Create a new AuzsLedger customer or supplier, or update an existing one by id. Use ledger_list_parties first to check it doesn't already exist. Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['name', 'kind'],
      properties: {
        id: { type: 'string', description: 'set to update an existing party' }, name: { type: 'string' }, kind: { type: 'string', enum: ['customer', 'supplier'] },
        gstin: { type: 'string' }, pan: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' },
        billing_address: { type: 'string' }, shipping_address: { type: 'string' }, state_code: { type: 'string', description: 'two-digit GST state code; inferred from the GSTIN if omitted' },
        credit_limit: { type: 'number' }, credit_days: { type: 'integer' }, category: { type: 'string' }, notes: { type: 'string' }, active: { type: 'boolean' },
      },
    },
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
    description: "Create or update an AuzsLedger document (invoice, bill, expense, credit_note, ...). Use ledger_context and ledger_list_parties first to get real account_id/party_id values. For each line, check ledger_list_products -- if the product isn't in the catalogue yet (common when copying an invoice from an uploaded PDF), call ledger_save_product to create it first and use its id; a line with no product_id is saved as plain free text, with no product record and no stock effect. Same validation the real app enforces (GST, balanced lines) -- a bad value is refused with a clear reason, not silently accepted. Does not finalize it (see ledger_post_document). Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['doc_type', 'lines'],
      properties: {
        doc_type: { type: 'string', enum: ['invoice', 'bill', 'expense', 'credit_note', 'debit_note', 'quotation', 'sales_order', 'purchase_order'] },
        id: { type: 'string', description: 'set to edit an existing draft/open document' },
        party_id: { type: 'string' }, doc_date: { type: 'string' }, note: { type: 'string' },
        price_includes_tax: { type: 'boolean', description: 'true if the rate on each line already includes GST (tax is backed out of it); false (the default) if GST is added on top of the rate. Check ledger_get_document or ledger_list_products if unsure which the business actually uses.' },
        lines: { type: 'array', items: { type: 'object', required: ['qty', 'rate'], properties: { account_id: { type: 'string' }, product_id: { type: 'string', description: 'IMPORTANT: a line with no product_id is saved as plain free text and never touches the product catalogue or stock -- it does NOT create a product. If a line is for a product that is not in ledger_list_products yet (e.g. reading it off an uploaded invoice PDF), call ledger_save_product FIRST to create it, then put the id it returns here.' }, description: { type: 'string' }, qty: { type: 'number' }, rate: { type: 'number' }, tax_code_id: { type: 'string' } } } },
      },
    },
  },
  {
    name: 'ledger_save_product',
    description: "Create a new product/service in AuzsLedger's catalogue, or update an existing one by id. Use ledger_list_products first to check it doesn't already exist (match by name/SKU/HSN) -- creating a duplicate for the same real item makes stock and reports split across two rows. Call this before ledger_save_document whenever a line is for something not yet in the catalogue (e.g. a new item read off an uploaded invoice/bill PDF) -- ledger_save_document never creates products on its own. Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['name', 'sku'],
      properties: {
        id: { type: 'string', description: 'set to update an existing product' },
        name: { type: 'string' }, sku: { type: 'string' }, barcode: { type: 'string' }, category: { type: 'string' }, brand: { type: 'string' },
        unit: { type: 'string', description: 'e.g. Nos, Kg, Box; defaults to Nos' }, hsn: { type: 'string' },
        tax_rate: { type: 'number', description: 'GST %, must be a rate already configured for this business (check ledger_list_products for rates already in use); defaults to 18' },
        tax_inclusive: { type: 'boolean', description: 'true if this product\'s own price already includes GST' },
        purchase_price: { type: 'number' }, sale_price: { type: 'number' }, mrp: { type: 'number' },
        is_service: { type: 'boolean', description: 'true for a service with no stock to track' },
        track_stock: { type: 'boolean' }, reorder_level: { type: 'number' }, reorder_qty: { type: 'number' }, notes: { type: 'string' },
      },
    },
  },
  {
    name: 'ledger_get_document',
    description: "Full detail of one AuzsLedger document by id: every line, the tax breakdown (CGST/SGST/IGST/cess), and whether its prices include or exclude GST (price_includes_tax). Use this to check how an existing invoice/bill was actually taxed -- ledger_list_documents' summary rows don't carry that detail. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', required: ['doc_id'], properties: { doc_id: { type: 'string', description: 'from ledger_list_documents' } } },
  },
  {
    name: 'ledger_list_products',
    description: "AuzsLedger's product/service catalogue -- price, HSN code, GST rate, whether that product's own price includes GST by default (tax_inclusive), and current stock. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { search: { type: 'string' }, category: { type: 'string' } } },
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
  {
    name: 'ledger_list_payments',
    description: "List AuzsLedger receipts (money in) and payments (money out), with how much of each is still unallocated against an invoice/bill. Use this before ledger_allocate_payment to find a payment_id, or to answer 'what payments has this customer made'. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['receipt', 'payment'] }, party_id: { type: 'string' }, search: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'integer' } } },
  },
  {
    name: 'ledger_get_payment',
    description: 'Full detail of one AuzsLedger payment/receipt, including exactly which invoices/bills it has been allocated against. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', required: ['payment_id'], properties: { payment_id: { type: 'string' } } },
  },
  {
    name: 'ledger_account_ledger',
    description: "An account's or a party's running ledger -- every journal line against it with the running balance, exactly what 'why is this balance X' needs. Give either account_id (from ledger_context) or party_id (from ledger_list_parties), not both. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { account_id: { type: 'string', description: 'from ledger_context' }, party_id: { type: 'string', description: 'from ledger_list_parties -- use this for a customer/supplier ledger' }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, limit: { type: 'integer' } } },
  },
  {
    name: 'ledger_journal_detail',
    description: 'Full detail of one AuzsLedger journal entry (voucher): every debit/credit line, the account and party on each, and (if it was reversed, or is itself a reversal) the linked journal. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', required: ['journal_id'], properties: { journal_id: { type: 'string' } } },
  },
  {
    name: 'ledger_product_stock',
    description: "One product's current stock, broken down by warehouse. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', required: ['product_id'], properties: { product_id: { type: 'string', description: 'from ledger_list_products' } } },
  },
  {
    name: 'ledger_stock_summary',
    description: 'Stock valuation across every product as of a date (or today): quantity on hand, average cost, total value, and which products are at or below their reorder level. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { as_of: { type: 'string', description: 'YYYY-MM-DD, defaults to today' }, warehouse_id: { type: 'string' } } },
  },
  {
    name: 'ledger_stock_moves',
    description: "Line-by-line stock movement history -- exactly what changed, when, why (purchase/sale/return/transfer/adjustment), the quantity before and after each move, and the real invoice/bill number behind it when the move came from a document. This is the tool to answer 'why did stock go up/down' or 'which bill caused this stock change', not ledger_stock_summary (which only gives a current total). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { product_id: { type: 'string' }, warehouse_id: { type: 'string' }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, kind: { type: 'string', enum: ['opening', 'purchase', 'sale', 'sale_return', 'purchase_return', 'stock_in', 'stock_out', 'transfer_out', 'transfer_in', 'adjustment', 'reversal'] } } },
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
    description: 'Record a transaction in AuzsFinance (use finance_people/finance_dashboard first to find account/person/partner/loan ids). Most AI apps will ask you to confirm before running this -- it changes real financial records.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['kind', 'amount'],
      properties: {
        kind: { type: 'string', enum: ['money_in', 'expense', 'capital_in', 'drawing', 'loan_taken', 'loan_given', 'loan_repay', 'loan_collect', 'transfer', 'credit_sale', 'credit_purchase', 'dues_in', 'dues_out', 'asset_buy'], description: 'money_in/expense/asset_buy need account_id; capital_in/drawing need account_id + partner_id; loan_* need account_id + loan_id; transfer needs account_id + to_account_id; credit_sale/credit_purchase need person_id; dues_in/dues_out need account_id + person_id' },
        amount: { type: 'number' }, interest: { type: 'number', description: 'extra paid/received on a loan_repay or loan_collect, on top of amount' },
        date: { type: 'string', description: 'YYYY-MM-DD, defaults to today' },
        account_id: { type: 'string' }, to_account_id: { type: 'string', description: 'for a transfer' },
        person_id: { type: 'string' }, partner_id: { type: 'string' }, loan_id: { type: 'string' }, category_id: { type: 'string', description: 'an account_id from finance_dashboard\'s by_category or ledger_context, to categorise an expense/income' },
        purpose: { type: 'string' }, method: { type: 'string' }, note: { type: 'string' }, due_date: { type: 'string' },
        evidence: { type: 'string', enum: ['have', 'none'], description: 'whether a receipt/bill exists for this' },
      },
    },
  },
  {
    name: 'finance_list_transactions',
    description: "Search/list individual AuzsFinance transactions (not just the dashboard totals) -- by date range, account, person, partner, loan, a text search in the purpose/note, whether it needs review, or whether evidence (a receipt/bill) is attached. Use this to find a specific transaction, or to answer 'what did we spend on X'. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, kind: { type: 'string' }, account_id: { type: 'string' }, person_id: { type: 'string' }, partner_id: { type: 'string' }, loan_id: { type: 'string' }, q: { type: 'string', description: 'text search in purpose/note' }, review: { type: 'string', enum: ['needs_review', 'reviewed'] }, evidence: { type: 'string', enum: ['have', 'missing'] }, with_reversed: { type: 'boolean', description: 'include reversed/cancelled transactions, default true' }, limit: { type: 'integer' } } },
  },
  {
    name: 'finance_list_loans',
    description: 'Every loan taken or given tracked in AuzsFinance, with its running balance. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'finance_reconciliation',
    description: "One AuzsFinance account's bank-reconciliation view: the book balance, the cleared balance (only transactions marked as cleared), and every transaction on that account with whether it's cleared yet. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', required: ['account_id'], properties: { account_id: { type: 'string' } } },
  },
  {
    name: 'finance_list_assets',
    description: 'Every fixed asset tracked in AuzsFinance, with its cost, accumulated depreciation and current book value. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'finance_list_recurring',
    description: "AuzsFinance's repeating entries (rent, salary, EMI, subscriptions) -- amount, frequency, next due date, and whether one is due now. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'finance_anomalies',
    description: "Things in AuzsFinance that look wrong and are worth a second look: the same amount entered twice, an expense far above that category's usual size, a large payment with no bill/receipt attached, an account balance below zero, a loan past its due date, or money owed to the business for a long time. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'finance_bank_import_preview',
    description: "Check a bank statement against AuzsFinance before importing it, without changing anything -- each row comes back marked 'matched' (an existing transaction on the books looks like this bank line, give its txn_id/txn_title), 'duplicate' (already imported or already has this reference), 'new' (no match, would create a transaction), or 'skip' (no usable date/amount). Always run this before finance_bank_import_commit so a human can review the matches. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object', required: ['account_id', 'rows'],
      properties: {
        account_id: { type: 'string', description: 'the AuzsFinance account this statement is for' },
        rows: {
          type: 'array', description: 'up to 2000 bank statement lines',
          items: { type: 'object', required: ['date'], properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, credit: { type: 'number' }, debit: { type: 'number' }, ref: { type: 'string' }, desc: { type: 'string' } } },
        },
      },
    },
  },
  {
    name: 'finance_bank_import_commit',
    description: "Actually import a bank statement into AuzsFinance: for each row, either 'match' it to an existing transaction (marks that transaction cleared) or create it as a new transaction (anything not explicitly marked 'match' or 'skip' is created new) -- always run finance_bank_import_preview first and pass back its row statuses/txn_ids so matches land correctly. Most AI apps will ask you to confirm before running this -- it changes real financial records.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['account_id', 'rows'],
      properties: {
        account_id: { type: 'string' },
        rows: {
          type: 'array', description: 'the same rows from finance_bank_import_preview, each with an action added',
          items: {
            type: 'object', required: ['date'],
            properties: {
              date: { type: 'string', description: 'YYYY-MM-DD' }, credit: { type: 'number' }, debit: { type: 'number' }, ref: { type: 'string' }, desc: { type: 'string' },
              action: { type: 'string', enum: ['new', 'match', 'skip'], description: "default 'new'; 'match' requires txn_id from the preview" },
              txn_id: { type: 'string', description: 'required when action is match' },
              kind: { type: 'string', enum: ['money_in', 'expense'], description: 'for a new row, default money_in for a credit / expense for a debit' },
              category_id: { type: 'string' },
            },
          },
        },
      },
    },
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
  // ---- AUZsStyle, continued: inventory, purchasing, transfers, sales actions, customers, coupons, reports,
  // buying intelligence, online store orders and staff -- the rest of the real sty_* surface, same thin-wrapper
  // discipline as style_sell/style_return above. A few real gotchas from the actual SQL (not the registry alone):
  // sty_delete_styles is a genuine hard delete (no soft-hide fallback); sty_void_sale needs sty_manage, not
  // sty_sell; sty_save_supplier/sty_pay_supplier/sty_transfer*/sty_receive_transfer/sty_cancel_transfer all
  // return the WHOLE list they belong to, not just the one row touched. ----
  {
    name: 'style_save_style',
    description: "Create a new AUZsStyle style, or update an existing one by id. Creating one builds every colour x size combination given as real, sellable variants (with opening stock if given). Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['name', 'price'],
      properties: {
        id: { type: 'string', description: 'omit to create a new style' }, name: { type: 'string' }, category: { type: 'string' }, brand: { type: 'string' },
        cost: { type: 'number' }, price: { type: 'number' }, mrp: { type: 'number', description: 'defaults to price' },
        colours: { type: 'array', items: { type: 'string' } }, sizes: { type: 'array', items: { type: 'string' } },
        opening: { type: 'object', properties: { branch_id: { type: 'string' }, qty: { type: 'number' }, unit_cost: { type: 'number' } }, description: 'opening stock, optional' },
        active: { type: 'boolean' },
      },
    },
  },
  {
    name: 'style_adjust_stock',
    description: "Adjust a variant's stock directly (add/remove/damage/lost/count -- 'count' sets the absolute stock on hand, the others change it by qty). Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['variant_id', 'qty', 'mode'],
      properties: { variant_id: { type: 'string' }, qty: { type: 'number' }, mode: { type: 'string', enum: ['add', 'remove', 'damage', 'lost', 'count'] }, note: { type: 'string' }, branch_id: { type: 'string' } },
    },
  },
  {
    name: 'style_set_variant',
    description: "Change one variant's own price override, reorder level, active status or barcode (not the whole style). Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', required: ['variant_id'], properties: { variant_id: { type: 'string' }, price: { type: 'number', description: 'set null-equivalent by omitting to fall back to the style price' }, reorder_at: { type: 'number' }, active: { type: 'boolean' }, barcode: { type: 'string' } } },
  },
  {
    name: 'style_delete_styles',
    description: 'PERMANENTLY delete one or more styles and their variants -- a genuine hard delete, not a hide/archive, and cannot be undone (old bills keep their frozen line data, but the link to the style is gone). Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: { type: 'object', required: ['style_ids'], properties: { style_ids: { type: 'array', items: { type: 'string' }, description: 'from style_catalog' } } },
  },
  {
    name: 'style_list_suppliers',
    description: "List AUZsStyle's suppliers with how much has been bought, paid and is due to each. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'style_save_supplier',
    description: 'Add a new AUZsStyle supplier, or update an existing one by id. Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', required: ['name'], properties: { id: { type: 'string' }, name: { type: 'string' }, contact: { type: 'string' }, phone: { type: 'string' }, gstin: { type: 'string' }, category: { type: 'string' }, active: { type: 'boolean' } } },
  },
  {
    name: 'style_list_purchases',
    description: 'List recent AUZsStyle purchases (goods received from suppliers). Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'default 60' } } },
  },
  {
    name: 'style_receive_purchase',
    description: "Record stock actually received from a supplier (there is no separate 'purchase order' step in AUZsStyle -- receiving IS the purchase record). Adds to stock and recomputes weighted-average cost per variant. Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['lines'],
      properties: {
        supplier_id: { type: 'string', description: 'from style_list_suppliers' }, branch_id: { type: 'string' }, invoice_no: { type: 'string' }, paid: { type: 'number', description: 'amount paid to the supplier now, if any' }, pay_mode: { type: 'string' }, note: { type: 'string' },
        lines: { type: 'array', items: { type: 'object', required: ['variant_id', 'qty', 'unit_cost'], properties: { variant_id: { type: 'string' }, qty: { type: 'number' }, unit_cost: { type: 'number' } } } },
      },
    },
  },
  {
    name: 'style_pay_supplier',
    description: "Pay an AUZsStyle supplier. The amount is automatically applied against their oldest unpaid purchases first -- it cannot be aimed at one specific invoice. Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', required: ['supplier_id', 'amount'], properties: { supplier_id: { type: 'string' }, amount: { type: 'number' }, mode: { type: 'string', description: 'default cash' }, note: { type: 'string' } } },
  },
  {
    name: 'style_list_transfers',
    description: 'List AUZsStyle stock transfers between branches. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'style_create_transfer',
    description: 'Start a stock transfer of specific variants/quantities from one AUZsStyle branch to another. Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['from_branch', 'to_branch', 'lines'],
      properties: { from_branch: { type: 'string' }, to_branch: { type: 'string' }, note: { type: 'string' }, lines: { type: 'array', items: { type: 'object', required: ['variant_id', 'qty'], properties: { variant_id: { type: 'string' }, qty: { type: 'number' } } } } },
    },
  },
  {
    name: 'style_receive_transfer',
    description: 'Mark an in-transit AUZsStyle transfer as received at its destination. Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', required: ['transfer_id'], properties: { transfer_id: { type: 'string', description: 'from style_list_transfers' } } },
  },
  {
    name: 'style_cancel_transfer',
    description: 'Cancel an AUZsStyle transfer that is still in transit. Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: { type: 'object', required: ['transfer_id'], properties: { transfer_id: { type: 'string', description: 'from style_list_transfers' } } },
  },
  {
    name: 'style_get_sale',
    description: 'Get one AUZsStyle bill by id, in full. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', required: ['sale_id'], properties: { sale_id: { type: 'string' } } },
  },
  {
    name: 'style_find_sale',
    description: 'Find an AUZsStyle bill by its bill number (exact or trailing-digits match). Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', required: ['number'], properties: { number: { type: 'string' } } },
  },
  {
    name: 'style_void_sale',
    description: 'Void an AUZsStyle bill entirely (not a partial return -- use style_return for that). Refused if the bill already has returns against it. Cannot be undone. Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: { type: 'object', required: ['sale_id'], properties: { sale_id: { type: 'string' }, reason: { type: 'string' }, restock: { type: 'boolean', description: 'put the stock back (default true) -- set false if the goods were damaged' } } },
  },
  {
    name: 'style_collect_due',
    description: "Record a payment against an AUZsStyle bill's outstanding balance (a bill left partly/fully on credit). Capped automatically at the real balance due. Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', required: ['sale_id', 'amount'], properties: { sale_id: { type: 'string' }, amount: { type: 'number' }, mode: { type: 'string', enum: ['cash', 'upi', 'card'] } } },
  },
  {
    name: 'style_customer_detail',
    description: "Full profile of one AUZsStyle customer: visits, spend, tier, dues, loyalty points/credit, recent bills, liked styles/sizes/colours. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', required: ['customer_id'], properties: { customer_id: { type: 'string', description: 'from style_list_customers' } } },
  },
  {
    name: 'style_save_customer',
    description: 'Add a new AUZsStyle customer, or update one by id. If id is omitted and the phone number already belongs to an existing customer, that customer is updated instead of creating a duplicate. Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['name', 'phone'],
      properties: { id: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' }, usual_size: { type: 'string' }, birthday: { type: 'string' }, anniversary: { type: 'string' }, notes: { type: 'string' }, gender: { type: 'string' }, city: { type: 'string' }, gstin: { type: 'string' }, address: { type: 'string' } },
    },
  },
  {
    name: 'style_list_coupons',
    description: 'List AUZsStyle discount coupons. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'style_save_coupon',
    description: 'Create a new AUZsStyle coupon, or update one by id. Most AI apps will ask you to confirm before running this.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['code', 'kind', 'value'],
      properties: { id: { type: 'string' }, code: { type: 'string', description: '3-24 letters/numbers' }, kind: { type: 'string', enum: ['pct', 'flat', 'ship'] }, value: { type: 'number' }, min_order: { type: 'number' }, max_uses: { type: 'integer' }, first_only: { type: 'boolean' }, starts_on: { type: 'string' }, ends_on: { type: 'string' }, active: { type: 'boolean' }, note: { type: 'string' } },
    },
  },
  {
    name: 'style_dashboard',
    description: "AUZsStyle's dashboard: sales/profit/units vs. the prior period, inventory value, returns, payment split, top styles, receivable/payable. Cost/profit fields come back null for a cashier who isn't allowed to see cost. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, branch_id: { type: 'string' } } },
  },
  {
    name: 'style_analytics',
    description: 'AUZsStyle sales analytics: by category/style/size/colour/weekday/hour, sell-through and cover-days per variant, staff performance, top customers. Defaults to the last 30 days. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, branch_id: { type: 'string' } } },
  },
  {
    name: 'style_shift_status',
    description: "Whether a till shift is currently open (opening cash, cash sales, cash in/out, expected cash in the drawer). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { branch_id: { type: 'string' } } },
  },
  {
    name: 'style_intel_overview',
    description: "AUZsStyle's buying-intelligence overview: sell-through, return rate, markdown share, gross margin (where visible), stock at risk/slow, GMROI. Defaults to the last 60 days (max 180). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, branch_id: { type: 'string' }, category: { type: 'string' } } },
  },
  {
    name: 'style_intel_reorder',
    description: "What to reorder: per variant, daily sell rate, days of cover left, suggested order quantity and the reasoning, based on real sales velocity (own, or a similar size/category curve where a variant is too new). Note: incoming purchase orders are not tracked, so 'incoming' is always 0 -- check style_list_purchases separately if that matters. A suggested qty of 0 means don't reorder yet (e.g. the season is ending). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, branch_id: { type: 'string' }, style_id: { type: 'string' } } },
  },
  {
    name: 'style_intel_lost',
    description: 'Estimated lost sales from stockouts (conservative -- only counted where there is real confidence), plus real customer requests for styles/sizes that were not in stock. Estimated lost sales are never added into revenue anywhere else. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, branch_id: { type: 'string' } } },
  },
  {
    name: 'style_list_web_orders',
    description: "List AUZsStyle's online store orders. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['new', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'] } } },
  },
  {
    name: 'style_update_web_order',
    description: "Update an AUZsStyle online order's status/payment status/note. If this makes the order paid and not cancelled, it is automatically billed as a real sale -- check the response's billed/billError fields (a billing failure here does not raise an error, it's reported back quietly). Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['order_id'],
      properties: { order_id: { type: 'string' }, status: { type: 'string', enum: ['new', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'] }, payment_status: { type: 'string', enum: ['pending', 'submitted', 'paid', 'cod'] }, staff_note: { type: 'string' } },
    },
  },
  {
    name: 'style_staff_list',
    description: 'List everyone with a login on this AUZsStyle tenant. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'style_how_to',
    description: "The real AUZsStyle user manual -- the same content shown in-app (Settings -> User manual), written for a shop owner/staff member, not for an API caller. Use this to answer a plain question like \"how do I give a refund\" or \"how do I print barcode tags\" with exact, real steps instead of guessing. Pass a question/topic to get the most relevant section(s); omit it to get the whole manual. Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { question: { type: 'string', description: 'e.g. "how do I process a return", "barcode printing", "cash drawer"' } } },
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

    case 'pos_duefollowup_scan':
      return callRpc(client, 'pos_duefollowup_scan', {});
    case 'pos_duefollowup_list':
      return callRpc(client, 'pos_duefollowup_list', { p_status: args.status || null });
    case 'pos_duefollowup_mark':
      if (!args.id || !args.status) throw new HttpError(400, 'id and status are required');
      return callRpc(client, 'pos_duefollowup_mark', { p_id: args.id, p_status: args.status, p_note: args.note || null });

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
      const todays = all.filter((c) => c[field] && String(c[field]).slice(5, 10) === today.slice(5, 10) && c.phone).slice(0, 100);
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
    case 'ledger_save_product':
      if (!args.name || !args.sku) throw new HttpError(400, 'name and sku are required');
      return callRpc(client, 'acc_save_product', { p: args });
    case 'ledger_get_document':
      if (!args.doc_id) throw new HttpError(400, 'doc_id is required');
      return callRpc(client, 'acc_get_document', { p_id: args.doc_id });
    case 'ledger_list_products':
      return callRpc(client, 'acc_list_products', { p: { search: args.search || null, category: args.category || null } });
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
    case 'ledger_list_payments':
      return callRpc(client, 'acc_list_payments', { p: args });
    case 'ledger_get_payment':
      if (!args.payment_id) throw new HttpError(400, 'payment_id is required');
      return callRpc(client, 'acc_get_payment', { p_id: args.payment_id });
    case 'ledger_account_ledger':
      if (!args.account_id && !args.party_id) throw new HttpError(400, 'account_id or party_id is required');
      return callRpc(client, 'acc_ledger', { p: args });
    case 'ledger_journal_detail':
      if (!args.journal_id) throw new HttpError(400, 'journal_id is required');
      return callRpc(client, 'acc_journal_detail', { p_id: args.journal_id });
    case 'ledger_product_stock':
      if (!args.product_id) throw new HttpError(400, 'product_id is required');
      return callRpc(client, 'acc_product_stock', { p_product: args.product_id });
    case 'ledger_stock_summary':
      return callRpc(client, 'acc_stock_summary', { p: args });
    case 'ledger_stock_moves':
      return callRpc(client, 'acc_stock_moves_list', { p: args });
    case 'ledger_save_party':
      if (!args.name || !args.kind) throw new HttpError(400, 'name and kind are required');
      return callRpc(client, 'acc_save_party', {
        p: {
          id: args.id || null, name: args.name, kind: args.kind, gstin: args.gstin || null, pan: args.pan || null, phone: args.phone || null, email: args.email || null,
          billing_address: args.billing_address || null, shipping_address: args.shipping_address || null, state_code: args.state_code || null,
          credit_limit: args.credit_limit, credit_days: args.credit_days, category: args.category || null, notes: args.notes || null, active: args.active,
        },
      });

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
      if (!args.kind || !(Number(args.amount) > 0)) throw new HttpError(400, 'kind and a positive amount are required');
      return callRpc(client, 'fin_save_txn', { p: args });
    case 'finance_list_transactions':
      return callRpc(client, 'fin_txn_list', { p: args });
    case 'finance_list_loans':
      return callRpc(client, 'fin_loan_list', {});
    case 'finance_reconciliation':
      if (!args.account_id) throw new HttpError(400, 'account_id is required');
      return callRpc(client, 'fin_recon_list', { p_account: args.account_id });
    case 'finance_list_assets':
      return callRpc(client, 'fin_asset_list', {});
    case 'finance_list_recurring':
      return callRpc(client, 'fin_recurring_list', {});
    case 'finance_anomalies':
      return callRpc(client, 'fin_anomalies', {});
    case 'finance_bank_import_preview':
      if (!args.account_id) throw new HttpError(400, 'account_id is required');
      return callRpc(client, 'fin_import_preview', { p_account: args.account_id, p_rows: args.rows || [] });
    case 'finance_bank_import_commit':
      if (!args.account_id) throw new HttpError(400, 'account_id is required');
      for (const r of (args.rows || [])) { if (r.action === 'match' && !r.txn_id) throw new HttpError(400, "a 'match' row needs txn_id"); }
      return callRpc(client, 'fin_import_commit', { p_account: args.account_id, p_rows: args.rows || [] });

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

    case 'style_save_style': {
      if (!args.name || args.price == null) throw new HttpError(400, 'name and price are required');
      const p = { name: args.name, category: args.category, brand: args.brand, cost: args.cost, price: args.price, mrp: args.mrp, colours: args.colours, sizes: args.sizes, active: args.active };
      if (args.id) p.id = args.id; else p.newId = randomUUID();
      if (args.opening) p.opening = { branchId: args.opening.branch_id, qty: args.opening.qty, unitCost: args.opening.unit_cost };
      return callRpc(client, 'sty_save_style', { p });
    }
    case 'style_adjust_stock':
      if (!args.variant_id || args.qty == null || !args.mode) throw new HttpError(400, 'variant_id, qty and mode are required');
      return callRpc(client, 'sty_adjust', { p: { branchId: args.branch_id || null, variantId: args.variant_id, qty: args.qty, mode: args.mode, note: args.note || null } });
    case 'style_set_variant':
      if (!args.variant_id) throw new HttpError(400, 'variant_id is required');
      return callRpc(client, 'sty_set_variant', { p_id: args.variant_id, p: { price: args.price, reorderAt: args.reorder_at, active: args.active, barcode: args.barcode } });
    case 'style_delete_styles':
      if (!Array.isArray(args.style_ids) || !args.style_ids.length) throw new HttpError(400, 'style_ids must be a non-empty array');
      return callRpc(client, 'sty_delete_styles', { p: { ids: args.style_ids } });

    case 'style_list_suppliers':
      return callRpc(client, 'sty_list_suppliers', {});
    case 'style_save_supplier': {
      if (!args.name) throw new HttpError(400, 'name is required');
      const p = { name: args.name, contact: args.contact, phone: args.phone, gstin: args.gstin, category: args.category, active: args.active };
      if (args.id) p.id = args.id; else p.newId = randomUUID();
      return callRpc(client, 'sty_save_supplier', { p });
    }
    case 'style_list_purchases':
      return callRpc(client, 'sty_list_purchases', { p_limit: args.limit || 60 });
    case 'style_receive_purchase':
      if (!Array.isArray(args.lines) || !args.lines.length) throw new HttpError(400, 'lines must be a non-empty array of {variant_id, qty, unit_cost}');
      return callRpc(client, 'sty_receive', {
        p: {
          id: randomUUID(), supplierId: args.supplier_id || null, branchId: args.branch_id || null, invoiceNo: args.invoice_no || null, paid: args.paid || 0, payMode: args.pay_mode || null, note: args.note || null,
          lines: args.lines.map((l) => ({ variantId: l.variant_id, qty: l.qty, unitCost: l.unit_cost })),
        },
      });
    case 'style_pay_supplier':
      if (!args.supplier_id || !(Number(args.amount) > 0)) throw new HttpError(400, 'supplier_id and a positive amount are required');
      return callRpc(client, 'sty_pay_supplier', { p: { supplierId: args.supplier_id, amount: args.amount, mode: args.mode || 'cash', note: args.note || null } });

    case 'style_list_transfers':
      return callRpc(client, 'sty_list_transfers', {});
    case 'style_create_transfer':
      if (!args.from_branch || !args.to_branch || !Array.isArray(args.lines) || !args.lines.length) throw new HttpError(400, 'from_branch, to_branch and a non-empty lines array are required');
      if (args.from_branch === args.to_branch) throw new HttpError(400, 'from_branch and to_branch must differ');
      return callRpc(client, 'sty_transfer', { p: { id: randomUUID(), fromBranch: args.from_branch, toBranch: args.to_branch, note: args.note || null, lines: args.lines.map((l) => ({ variantId: l.variant_id, qty: l.qty })) } });
    case 'style_receive_transfer':
      if (!args.transfer_id) throw new HttpError(400, 'transfer_id is required');
      return callRpc(client, 'sty_receive_transfer', { p_id: args.transfer_id });
    case 'style_cancel_transfer':
      if (!args.transfer_id) throw new HttpError(400, 'transfer_id is required');
      return callRpc(client, 'sty_cancel_transfer', { p_id: args.transfer_id });

    case 'style_get_sale':
      if (!args.sale_id) throw new HttpError(400, 'sale_id is required');
      return callRpc(client, 'sty_get_sale', { p_id: args.sale_id });
    case 'style_find_sale':
      if (!args.number) throw new HttpError(400, 'number is required');
      return callRpc(client, 'sty_find_sale', { p_number: args.number });
    case 'style_void_sale':
      if (!args.sale_id) throw new HttpError(400, 'sale_id is required');
      return callRpc(client, 'sty_void_sale', { p_id: args.sale_id, p_reason: args.reason || null, p_restock: args.restock !== false });
    case 'style_collect_due':
      if (!args.sale_id || !(Number(args.amount) > 0)) throw new HttpError(400, 'sale_id and a positive amount are required');
      return callRpc(client, 'sty_collect_due', { p_id: args.sale_id, p_amount: args.amount, p_mode: args.mode || 'cash' });

    case 'style_customer_detail':
      if (!args.customer_id) throw new HttpError(400, 'customer_id is required');
      return callRpc(client, 'sty_customer_detail', { p_id: args.customer_id });
    case 'style_save_customer': {
      if (!args.name || !args.phone) throw new HttpError(400, 'name and phone are required');
      const p = { name: args.name, phone: args.phone, usualSize: args.usual_size, birthday: args.birthday, anniversary: args.anniversary, notes: args.notes, gender: args.gender, city: args.city, gstin: args.gstin, address: args.address };
      if (args.id) p.id = args.id; else p.newId = randomUUID();
      return callRpc(client, 'sty_save_customer', { p });
    }

    case 'style_list_coupons':
      return callRpc(client, 'sty_coupons_list', {});
    case 'style_save_coupon': {
      if (!args.code || !args.kind || args.value == null) throw new HttpError(400, 'code, kind and value are required');
      const p = { code: args.code, kind: args.kind, value: args.value, minOrder: args.min_order, maxUses: args.max_uses, firstOnly: args.first_only, startsOn: args.starts_on, endsOn: args.ends_on, active: args.active, note: args.note };
      if (args.id) p.id = args.id; else p.newId = randomUUID();
      return callRpc(client, 'sty_coupon_save', { p });
    }

    case 'style_dashboard':
      return callRpc(client, 'sty_dashboard', { p: { from: args.from || null, to: args.to || null, branchId: args.branch_id || null } });
    case 'style_analytics':
      return callRpc(client, 'sty_analytics', { p: { from: args.from || null, to: args.to || null, branchId: args.branch_id || null } });
    case 'style_shift_status':
      return callRpc(client, 'sty_shift_current', { p_branch: args.branch_id || null });

    case 'style_intel_overview':
      return callRpc(client, 'sty_intel_overview', { p: { from: args.from || null, to: args.to || null, branchId: args.branch_id || null, category: args.category || null } });
    case 'style_intel_reorder':
      return callRpc(client, 'sty_intel_reorder', { p: { from: args.from || null, to: args.to || null, branchId: args.branch_id || null, styleId: args.style_id || null } });
    case 'style_intel_lost':
      return callRpc(client, 'sty_intel_lost', { p: { from: args.from || null, to: args.to || null, branchId: args.branch_id || null } });

    case 'style_list_web_orders':
      return callRpc(client, 'sty_web_orders_list', { p: { status: args.status || null } });
    case 'style_update_web_order':
      if (!args.order_id) throw new HttpError(400, 'order_id is required');
      return callRpc(client, 'sty_web_order_update', { p_id: args.order_id, p: { status: args.status || null, paymentStatus: args.payment_status || null, staffNote: args.staff_note || null } });

    case 'style_staff_list':
      return callRpc(client, 'sty_staff_list', {});
    case 'style_how_to':
      return searchGuide('style', args.question);

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

// Tools that only read. Anything NOT listed here counts as a change: a connection made read-only (a read-only key, or an
// OAuth grant without "write") can neither see nor call it, and a new tool defaults to "change" until it is marked
// readOnlyHint: true. Enforced here on the server, not left to the AI app's own confirmation prompts.
const READ_TOOLS = new Set(TOOLS.filter((t) => t.annotations && t.annotations.readOnlyHint === true).map((t) => t.name));
const canWrite = (scope) => scope === 'full' || /\bwrite\b/.test(String(scope || ''));
// Per business, so one runaway AI cannot message the whole customer list or flood the books: any change at all
// (100 an hour), WhatsApp sends (30 an hour) and the birthday/anniversary broadcast (2 runs an hour, 100 people each).
const TOOL_LIMITS = { whatsapp_send: ['mcpwa', 30, 3_600_000, 'WhatsApp messages (30 an hour)'], crm_send_birthday_greetings: ['mcpbd', 2, 3_600_000, 'birthday message runs (2 an hour)'] };

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
  if (!resolved) {
    // wrong guesses are limited per address (a real key has 256 bits, so this is about noise and load, not safety)
    if (rateLimited('mcpbad:' + clientIp(req), 30, 60_000)) throw new HttpError(429, 'too many attempts, slow down');
    return unauthorized('invalid, expired or revoked token');
  }
  if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
  const { user_id, tenant_id } = resolved;
  const writeOk = canWrite(resolved.scope);
  if (rateLimited('mcp:' + (keyId || user_id), 240, 60_000)) throw new HttpError(429, 'too many requests, slow down');

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
  if (method === 'tools/list') return reply(200, rpcOk(id, { tools: writeOk ? TOOLS : TOOLS.filter((t) => READ_TOOLS.has(t.name)) }));
  if (method === 'tools/call') {
    const name = params?.name;
    try {
      if (!READ_TOOLS.has(name)) {
        if (!writeOk) throw new HttpError(403, 'This connection is read-only, so it cannot make changes. The owner can create a key or connection that allows changes in the account page.');
        if (rateLimited('mcpw:' + tenant_id, 100, 3_600_000)) throw new HttpError(429, 'The AI connector reached its limit of 100 changes an hour. Try again later.');
        const lim = TOOL_LIMITS[name];
        if (lim && rateLimited(lim[0] + ':' + tenant_id, lim[1], lim[2])) throw new HttpError(429, 'The AI connector reached its limit of ' + lim[3] + '. Try again later.');
      }
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
