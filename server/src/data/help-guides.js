// Real, accurate "how do I do X" guides for an AI agent to answer with, instead of guessing at UI steps it has
// never seen. Each app's guide here is kept byte-identical in content to that app's own in-app manual (where one
// exists) -- same discipline as app/public/ds/help.js's own "keep site/tool/help.js identical to this file"
// comment, just split across server/client instead of two client copies. If the in-app manual changes, update
// the matching entry here in the same change (and vice versa).
//
// style: mirrors the MANUAL array in app/public/style/p-manual.js exactly.
export const GUIDES = {
  style: [
    { h: 'Getting started', body: [
      'Sign in with the email and password (or phone) your owner set up for you. The app remembers you are signed in, so you do not sign in again every day.',
      'If your shop has more than one branch or warehouse, pick the right one from the branch switcher at the top -- stock counts and today\'s sales are shown per branch.',
      'The first time you open AUZsStyle with internet, it quietly saves everything it needs so it keeps working even with no signal later (a changing room, a basement, a power cut with mobile data off).',
    ] },
    { h: 'Selling a bill', body: [
      'Open Sell. Tap a product\'s picture (or the + button) to add it to the cart. If it comes in more than one colour or size, a picker opens first -- pick the colour, then the size.',
      'A product with a dot under its photo has more than one picture; a "Sold out" or "Limited stock" label shows when stock is low or zero.',
      'In the cart, tap a line to change its quantity, give a line discount, or remove it. A whole-bill discount and the customer can be set from the cart screen too.',
      'Tap Pay to collect money. Cash, UPI (shows a QR with the exact amount once UPI is set up in Settings -- more than one UPI id can be saved there, and the cashier can switch which one this bill\'s QR uses right from the Pay screen), card, store credit and exchange credit are all supported; a bill can be split across more than one mode.',
      'Store credit and exchange credit are the same balance on the customer\'s account -- a return or exchange adds to it, and it is always checked against what the customer actually has, never trusted blindly from the bill.',
      'After payment, print the bill, or share it on WhatsApp with a link the customer can open any time. The bill\'s look (Classic/Compact/Formal) is whatever is chosen in Settings -> Bill template.',
    ] },
    { h: 'Cash drawer: opening, cash in/out, closing', body: [
      'Before selling for the day, open a shift and enter the opening cash in the drawer (Sell screen -> the cash drawer button, or it is asked automatically on your first sale of the day).',
      'During the day, use "Cash in" / "Cash out" for money that is not a sale -- change brought in, petty cash taken out, a bank deposit run. Every one needs a short reason.',
      'At close, count the actual notes and coins: the Close shift screen now has one row per note/coin value (500, 200, 100, 50, 20, 10, 5, 2, 1) -- enter how many of each you have, and the total is added up for you, not typed by hand.',
      'The app already knows what cash it expects (opening + cash sales + cash in - cash out) and shows the difference against what you actually counted, so a shortage or an extra amount is caught the same day, not weeks later.',
    ] },
    { h: 'Stock and inventory', body: [
      'Stock lists every style. Tap one to see its colours x sizes grid with stock for each. Tap a number in the grid to adjust it (add, remove, mark damaged/lost, or do a physical count).',
      'New style: give it a name, category, price/MRP, pick its colours and sizes, and AUZsStyle creates one row (a "variant") with its own barcode for every colour+size combination automatically.',
      'Barcode tags: Stock -> a style -> Print tags. Choose how many of each size to print (by stock on hand, 1 each, or your own number), pick a label size (50x25mm, 2-across, 38x25mm, or A4 sheet of 40) and a tag design (GenX premium, Classic, Minimal or Detailed) -- every design\'s barcode is already sized with a safety margin so it will not print past the edge of the label.',
      'Transfers move stock between branches/warehouses without it ever looking like a sale or a loss (Stock screen -> page tools -> Transfers -> New transfer; the receiving branch then taps Receive).',
      'Export Excel (Stock screen) downloads every product\'s colour/size/barcode/price/stock as one real Excel file. Import Excel reads a corrected sheet back in and updates Price and Stock for every matching row (matched by Barcode, or by Style+Colour+Size) -- useful for a yearly stock count done on paper first, or bulk price changes done in Excel.',
    ] },
    { h: 'Bills, returns and exchanges', body: [
      'Bills lists every bill. Open one to print it again, share it, void it (needs a manager and a reason, and restores the stock and any credit used), or start a return/exchange from it.',
      'A return gives money back or store credit; an exchange swaps the item and settles any price difference. Both are tied to the original bill, so stock and the books always agree.',
    ] },
    { h: 'Customers (CRM)', body: [
      'People lists every customer: name, phone, birthday/anniversary, usual size, and their running loyalty points and store credit.',
      'Points are earned automatically on a bill (set the earn % and what one point is worth in Settings -> Loyalty) and can be redeemed against a future bill.',
      'WhatsApp messages (if turned on in Settings) can send the bill link automatically, plus birthday/anniversary wishes and a "we miss you" nudge for customers who have not been back in a while.',
    ] },
    { h: 'Reports and buying intelligence', body: [
      'Analytics shows sales, profit and stock trends; export any table as CSV to check it in Excel.',
      'Buying intelligence suggests what to reorder (and how much) from real sell-through speed, warns about slow stock, and tracks requests from customers for things you did not have.',
    ] },
    { h: 'Online store (if turned on)', body: [
      'A public page where customers browse your catalogue and place an order (cash on delivery or UPI) without visiting the shop. New orders land in Requests/Store for staff to confirm.',
    ] },
    { h: 'Coupons and festive/special offers', body: [
      'Online store -> Coupon codes -> Add a coupon. Give it a code (e.g. DIWALI20), a type (percent off, a flat rupee amount off, or free shipping for the online store), a minimum order, an optional end date and a maximum number of uses.',
      'The same coupon also works on an in-person bill: in the cart, open Discount and type the code into "Coupon code", then Apply -- it shows the exact saving before you charge the customer.',
      'A coupon is always re-checked at the moment the bill is saved (expired, already used by this customer, below the minimum order, fully used up) -- never trusted blindly, so what is shown when applying is exactly what the bill will actually charge.',
      'For a festive sale on everything (not a code a customer has to type), make a coupon and simply tell staff/customers the code, or run it as the shop-wide "Bill discount %" for the sale period instead -- both are the same safe, server-checked discount path.',
    ] },
    { h: 'Settings', body: [
      'Shop: name, address, phone, GSTIN, logo, bill footer and prefix.',
      'Bill template: pick how every printed/shared bill looks (Classic, Compact, or a Formal tax invoice with GSTIN and item-wise tax) -- changes instantly for every device at the shop, with a live preview right there.',
      'Pay by UPI: add one or more UPI ids (each with its own label and the name shown to the customer); pick one as the default. At billing, the cashier can switch between them before showing the QR.',
      'Selling rules: how much discount staff can give without a manager, how many days returns are allowed, whether selling with no stock is allowed.',
      'Backup: one button downloads your inventory, customers and bills as a single Excel file (not a code/database file) -- open it directly in Excel or Google Sheets, and keep a copy somewhere safe.',
      'Branches/warehouses, day close (locks bills up to a date so nothing old can be changed by mistake), and a health check that confirms bill totals, stock and returns all agree with each other.',
    ] },
    { h: 'Common problems and how to fix them', body: [
      'A box (□) shows instead of the ₹ rupee sign on an older Windows computer: that one PC is missing a specific Windows update for the rupee symbol (search Windows Update for "KB2496898" and install it); it is not a bug in AUZsStyle.',
      'Barcode will not scan with a scanner gun: make sure the right label size is chosen before printing (a barcode printed too small or stretched will not scan) -- every tag design in this app is already sized to fit; if it still fails, try the Classic or Minimal design, or a bigger label size.',
      'The app says "not responding" or a licence code never finishes: close and reopen the app; if it still hangs, there may be no internet the very first time a licence is activated (activation needs internet once; after that it works fully offline). Contact support if it keeps happening.',
      'The printer cannot be found: check the printer is switched on, the correct one is selected as default in Windows, and (for an older Windows 7 computer) that Windows updates and the printer\'s own driver are fully installed.',
      'Prices/stock look wrong after an Excel import: re-check the sheet\'s Barcode column against the one Stock -> Export Excel produced -- a typed barcode that does not exactly match an existing product is skipped, not guessed.',
      'Still stuck: open the side menu -> Help & report a problem to send a screenshot and a short description straight to support.',
    ] },
  ],

  // ledger: AuzsLedger (Accounting) has no in-app manual to mirror (unlike Style) -- written from scratch,
  // grounded in the real nav (shell.js NAV_LEDGER) and the real editor/posting/GST/import behavior.
  ledger: [
    { h: 'Setting up the business', body: [
      'Settings -> Organisation: legal name, trade name, GSTIN (checked for a valid format and checksum, which also fills in the state), PAN, address, registration type (regular, composition, or unregistered), bank details, logo/signature/stamp, and the invoice layout (8 designs, with a live preview). Nothing can be posted until this is filled in -- the document editor shows a warning banner until it is.',
      'Settings -> Financial years and locks: "Add year" works out the next year from the last one automatically. A document can only be posted into a date that falls inside an existing financial year.',
      'Books -> Chart of accounts -> New account, for any account beyond the ones already set up (the core ones like Accounts Receivable/Payable can be renamed but not deleted or retyped).',
      'Opening balances: Books -> "Opening balances" for account-level opening debits/credits; a customer/supplier\'s own opening balance is set from their own page ("Opening balance" action); opening stock is entered from Stock -> Adjust stock with "This is opening stock" switched on.',
      'Settings -> GST rates to add the tax rates the business actually charges; Settings -> Numbering to set the prefix each document type gets (invoices, credit notes, bills, etc.) -- numbers are assigned only when a document is posted, and never skip or repeat.',
    ] },
    { h: 'Adding a customer or supplier', body: [
      'Customers -> New customer, or Suppliers -> New supplier (also possible right inside a sales/purchase document: type a new name into the customer/supplier field and pick "+ New customer/supplier" without leaving the bill).',
      'A customer can be marked B2C (just name + phone number, nothing else needed) or given a full profile: GSTIN (typing one automatically fills in the state and switches the registration type to "regular"), PAN, address, credit limit and credit days, tags.',
      'A supplier\'s page also has bank details and a "GST mode" switch: either each item carries its own GST rate, or the whole bill is taxed at one single rate.',
    ] },
    { h: 'Creating and posting a sales invoice', body: [
      'Sales -> Invoices -> New invoice (or the keyboard shortcut N then I). Pick or type the customer, the date, and the place of supply (this decides whether CGST+SGST or IGST applies).',
      'Add items by typing into the item picker (it fills in the HSN code, unit and rate automatically from the product), or paste a list copied from Excel and it reads the columns in.',
      'Before saving, the "What this will post" panel shows the exact accounting entry and stock movement this bill will make -- a good way to check it is right before committing to it.',
      'Save draft keeps it as a DRAFT-xxxx number with no effect on the books yet. Post invoice is the real, final action: it gets the next real gapless invoice number, and from then on it can only be changed with "Cancel with reversal" followed by a corrected reissue, or edited in place for an invoice specifically (bills and expenses can also still be edited in place after posting; most other document types cannot).',
      'A customer over their credit limit, or a GST rate that is not set up, or a date inside a locked/filed period, all show a clear reason and refuse to post -- never silently accepted.',
    ] },
    { h: 'Creating and posting a purchase bill', body: [
      'Purchases -> Bills -> New bill works the same way as an invoice, with the supplier in place of the customer, plus a supplier invoice number/date and reverse-charge/input-tax-credit checkboxes where relevant.',
      '"Scan invoice" reads a photo or PDF of a real supplier bill and fills in a draft automatically -- nothing is saved to the books until it is checked and saved.',
      'Delivery or other charges on a bill (freight, packing) can be added as their own taxed line on the same bill, or billed separately to the transporter with one click.',
    ] },
    { h: 'Recording payments and receipts', body: [
      'Receipts (money coming in from a customer) and Payments (money going out to a supplier) each have their own screen -- "Receive money" / "Pay money" -- reachable from the nav, from that party\'s own page, or the shortcuts N then R / N then P.',
      'Pick the party, amount, date, account and method, then "Settle against" lists every one of their open invoices/bills. "Settle oldest first" applies the money automatically to the oldest ones; or type exact amounts against specific bills by hand. Anything left over becomes an advance on their account, which can be applied to a later bill at any time.',
      'A write-off or a discount given/received for a small shortfall is its own action from the party\'s page, not a manual journal entry.',
    ] },
    { h: 'Quotations, orders, and converting them into a real bill', body: [
      'A quotation or sales/purchase order never affects the books by itself -- it is Sales -> Quotations/Orders or Purchases -> Orders/Requests, and becomes a real invoice/bill only when someone opens it and chooses "Convert to..." from its own menu, which copies its lines into a brand-new document ready to post.',
      'The usual chain is: quotation -> sales order -> delivery challan -> invoice (and the purchase side mirrors it: purchase request -> purchase order -> goods receipt -> bill).',
    ] },
    { h: 'Returns, credit notes and debit notes', body: [
      'From a posted invoice, the "Create credit note" action (in its More menu) opens a new credit note already linked to it with the same lines, ready to adjust down to what is actually being returned. The same works from a bill to create a debit note.',
      'A credit/debit note cannot be edited after it is posted (unlike an invoice or bill) -- only cancelled and reissued, since quietly changing a return that has already been settled against the original bill would be unsafe.',
      'The Returns page is a read-only report of every return, flagging a same-day replacement as an exchange rather than two unrelated transactions.',
    ] },
    { h: 'Reports', body: [
      'Reports lists every standard report in groups: Financial (trial balance, profit and loss, balance sheet, cash flow), Sales and Purchases (registers by customer/item/month/branch/tax rate), Receivable and payable (who owes what, and how overdue), Analysis and Audit.',
      'Every report can be exported as CSV, Excel or PDF, and clicking into a number drills down to the actual ledger entries or documents behind it.',
      'Settings -> Books health check (also under Reports -> Audit) runs a real live check that journals balance, every ledger ties back to a real document, and stock/GST figures reconcile -- not just a static report, an actual re-verification of the books as they stand right now.',
    ] },
    { h: 'GST', body: [
      'GST -> Summary shows output tax, input tax credit and what is actually payable for a chosen month, in the same shape as a GSTR-3B filing.',
      'GST -> Registers has the detailed breakdowns (B2B, B2C, credit/debit notes, HSN summary, ITC) that map onto a GSTR-1 filing -- every one of these can be exported.',
      'AUZslab prepares all of this and builds the e-invoice/e-way bill data file to download, but it does not call the government GST portal, IRP or e-way system itself -- that upload step, and pasting the resulting IRN or e-way bill number back in, is still done by the business on the actual government site.',
      'GST -> GSTR-2B match: upload the GSTR-2B file downloaded from the government portal, and it is automatically compared against purchase bills already entered, flagging anything that differs or is missing on either side.',
      'GST -> Filing lock marks a month as filed (owner only) so nothing in that month can be posted or cancelled afterwards by mistake.',
    ] },
    { h: 'Bank reconciliation', body: [
      'Banking -> pick a bank account -> import a bank statement (CSV/Excel, with a one-time column mapping that is remembered after the first time). Re-importing a file that overlaps an earlier one is safe -- duplicates are skipped, not doubled.',
      'Each statement line is matched to an existing entry in the books, or a brand-new entry (bank charges, interest, a payment tied to a party) is created right there and matched in the same step.',
      '"Reconcile" compares the book balance against the real statement closing balance (accounting for anything still in transit) and shows plainly whether they agree.',
    ] },
    { h: 'Staff permissions and approvals', body: [
      'Settings -> Rules and approvals sets a rupee threshold: a document above it can still be saved by regular staff, but needs someone with approval rights to actually post it -- it sits as "pending approval" until then.',
      'What a role can do (view, sell, buy, manage inventory, banking, post, approve, cancel, see reports, import, administer, see the audit log) is set per role, but the roles themselves are changed from the main AUZslab account page, not from inside AuzsLedger -- Settings -> "Your access" only shows what the signed-in person currently has.',
      'A staff member needing money for something raises it as an Expense request (a plain description + amount), a manager approves or rejects it, and only once someone with pay rights actually pays it does it touch the books at all.',
    ] },
    { h: 'Importing data in bulk', body: [
      'Bulk import (for a single invoice or bill from a spreadsheet, auto-creating any product that does not exist yet) is the fast path for one-off entry; Data -> Import is the full engine for a proper migration -- customers, suppliers, products, chart of accounts, opening balances, and historical sales/purchases/receipts/payments, with built-in column-guessing for Busy and Tally exports.',
      'Every import has a "Check the file" dry run (the same real logic, rolled back afterwards, so nothing is actually saved) before the real "Import" -- bad rows are reported in a downloadable list rather than silently skipped.',
      'Importing historical sales/purchases really posts them through the normal engine (so stock and GST are affected exactly as if they had been entered on the day) -- opening stock should be imported first, and a financial year has to already exist covering every date being imported or those rows fail.',
    ] },
    { h: 'Closing a financial year / locking the books', body: [
      'Settings -> Financial years and locks -> an open year -> Close year checks there are no unposted drafts or unbalanced journals left, locks every date up to the end of that year, and opens the next year automatically with balances carried forward. A closed year can be reopened later if genuinely needed.',
      '"Lock the books" is a separate, explicit date an owner can set any time (e.g. to freeze a month that has already been reviewed) -- independent of financial-year closing, and removable later (and logged either way).',
      'A GST filing lock (see the GST section above) is a third, separate lock that only affects GST document posting for one calendar month -- these three locks are not the same thing and do not substitute for each other.',
    ] },
    { h: 'Common problems and how to fix them', body: [
      '"Books are locked up to <date>": pick a later date, or ask the owner to unlock that period in Settings -> Financial years and locks.',
      '"GST return period is marked filed": use a date in a month that is not filed yet, or have an owner unlock it in GST -> Filing lock.',
      'Credit limit exceeded: shown as a clear warning before saving -- either collect payment first or raise that customer\'s credit limit on their own page.',
      '"Insufficient stock": add real stock first (Stock -> Adjust), lower the quantity on the bill, or (an owner\'s choice, off by default on purpose) turn on "Allow selling below zero stock" in Settings -> Rules and approvals.',
      '"GST rate X% is not configured": pick a rate that is actually set up, or add it in Settings -> GST rates.',
      '"Your role does not allow this": this is changed on the main AUZslab account page, not inside AuzsLedger itself.',
      '"No financial year covers this date": add that year in Settings -> Financial years and locks.',
      'A document shown as "pending approval" after saving is expected when it is above the approval threshold -- not an error, it is waiting for someone with approval rights to post it.',
      'A posted document cannot simply be deleted -- it is cancelled instead (with a real reversal), so the books always keep an honest record of what actually happened.',
    ] },
  ],
};

// Keyword overlap, not a real search engine: enough for an AI agent to pull the right section(s) for a plain
// question ("how do I give a refund") without needing a vector index or calling out to another model. Falls
// back to the whole guide when nothing matches, so the agent still has real material to work from rather than
// an empty result it might paper over with a guess.
const STOPWORDS = new Set(['how', 'the', 'and', 'for', 'you', 'can', 'does', 'what', 'where', 'when', 'give', 'get', 'make', 'with', 'from', 'this', 'that', 'into', 'out', 'use', 'using', 'app', 'auzsstyle', 'auzstyle', 'auzslab', 'auzsledger']);

export function searchGuide(appKey, question) {
  const sections = GUIDES[appKey] || [];
  if (!question || !String(question).trim()) return sections;
  const words = String(question).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  if (!words.length) return sections;
  const scored = sections.map((sec) => {
    const hay = (sec.h + ' ' + sec.body.join(' ')).toLowerCase();
    const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    return { sec, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.length ? scored.map((x) => x.sec) : sections;
}
