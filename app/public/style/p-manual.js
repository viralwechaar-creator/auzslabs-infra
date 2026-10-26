/* AUZsStyle: offline user manual. Plain text built into this file (service worker precaches it like any other
   script), so it opens with zero internet -- exactly the situation someone reaching for a manual is often in.
   Search just filters the sections below; nothing here calls the server. */
'use strict';
const MANUAL = [
  { h: 'Getting started', body: [
    'Sign in with the email and password (or phone) your owner set up for you. The app remembers you are signed in, so you do not sign in again every day.',
    'If your shop has more than one branch or warehouse, pick the right one from the branch switcher at the top -- stock counts and today\'s sales are shown per branch.',
    'The first time you open AUZsStyle with internet, it quietly saves everything it needs so it keeps working even with no signal later (a changing room, a basement, a power cut with mobile data off).',
  ] },
  { h: 'Selling a bill', body: [
    'Open Sell. Tap a product\'s picture (or the + button) to add it to the cart. If it comes in more than one colour or size, a picker opens first -- pick the colour, then the size.',
    'A product with a dot under its photo has more than one picture; a "Sold out" or "Limited stock" label shows when stock is low or zero.',
    'In the cart, tap a line to change its quantity, give a line discount, or remove it. A whole-bill discount and the customer can be set from the cart screen too.',
    'Tap Pay to collect money. Cash, UPI (shows a QR with the exact amount once UPI is set up in Settings), card, store credit and exchange credit are all supported; a bill can be split across more than one mode.',
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
    'Transfers move stock between branches/warehouses without it ever looking like a sale or a loss.',
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
    'Pay by UPI: your UPI id so a QR with the exact amount appears automatically at checkout.',
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
];
function manualSheet() {
  let q = '';
  const body = h('div', { class: 'grid manual' });
  const paint = () => {
    const k = q.trim().toLowerCase();
    const list = !k ? MANUAL : MANUAL.map((sec) => ({ h: sec.h, body: sec.body.filter((p) => p.toLowerCase().includes(k) || sec.h.toLowerCase().includes(k)) })).filter((sec) => sec.body.length || sec.h.toLowerCase().includes(k));
    clear(body).append(!list.length ? h('div', { class: 'muted small', style: { padding: '14px' } }, t('No match')) :
      list.map((sec) => h('div', { class: 'man-sec' }, h('h3', null, sec.h), sec.body.length ? sec.body.map((p) => h('p', null, p)) : sec.body.map((p) => h('p', null, p)))));
  };
  paint();
  sheet({ title: t('User manual'), full: true, closeLabel: t('Close'), body: h('div', { class: 'grid' },
    searchField(t('Search the manual'), (v) => { q = v; paint(); }),
    h('div', { class: 'muted small' }, t('Works fully offline -- no internet needed to read this.')),
    body) });
}
