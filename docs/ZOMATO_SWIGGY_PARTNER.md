# Zomato and Swiggy: getting AUZslab connected (owner checklist)

Nothing here can be sent by Claude. Each application needs the company's own details and signature. This sheet is what to
prepare and what to ask for. Details below come from public pages found in October 2026; confirm each with the other company,
because their rules change.

## The two routes (do both in parallel)
- **A. Direct (Zomato and Swiggy POS partnership).** Free of middle fees, needs the company registered and a technical review.
- **B. Connector (e.g. UrbanPiper).** Faster start; the connector already has Zomato/Swiggy approvals and charges its own fee.

## What to prepare first (both routes)
- Business name, address, PAN, GST number (if registered), website https://auzslab.in, a working company email and phone.
  (The proprietorship details are enough to start; say that a Pvt Ltd will follow, and ask how a change of entity is handled.)
- A one-page description: AUZslab is a multi-tenant POS (billing, kitchen, stock) used by cafes and restaurants; many outlets under one platform.
- A public webhook address for incoming orders, which I will provide once the format is known (they will ask for it).
- A test outlet: ask a friendly cafe (or use the demo shop) that is already on Zomato/Swiggy, to be used for testing.
- Someone who can sign an NDA.

## Route A: Zomato
1. Email **pos-partnership@zomato.com** asking to become a POS integration partner. Mention the website, what the product does and how many outlets you expect.
2. Zomato's developer pages describe a vendor onboarding form (company details, the web addresses where you receive orders and status updates, and the authentication header you want them to use), an NDA, and whitelisting of your web addresses, test-store email IDs and server IP. After that they create a POS ID and give you API keys.
3. Our server IP for whitelisting: the VPS IP (ask me to confirm the exact address before sending).
4. Testing on their test stores, then they certify the integration.

## Route A: Swiggy
1. Swiggy's public flow for restaurants is "Partner with us"; for POS vendors, ask the same account contact or their partner/integration team for the POS integration programme and its onboarding form.
2. Expect legal documents and a verification step before access is given.
3. Expect similar needs as Zomato: web addresses, keys, test store, certification.

## Route B: connector (e.g. UrbanPiper)
1. Create a developer / partner account with the connector and ask for their POS-integration documentation and a sandbox.
2. Ask: price per outlet or per order, who bills the cafe (them or us), how a cafe is linked, and whether we can switch to another connector later.
3. Their approach (from their public docs): they send each new order to a web address we provide (a webhook), and we call their API to update order status and mark items sold out.
4. When you have their documentation PDF and sandbox keys, send them to me and I can build the link (it should take days, not weeks).

## What the cafe has to do (all routes)
- Ask their Zomato / Swiggy account manager to link their outlet to AUZslab (or to the connector).
- Give us their outlet IDs and match the menu item by item once.

## Charging for it
Sell it as a separate add-on ("Online orders: Zomato and Swiggy") priced per outlet. Say plainly that any connector or platform fees are separate. The site now says this on the pricing page (Integrations).

## What exists in the product today
Staff can enter a Zomato/Swiggy order by hand in the POS with the source set (commission, settlements and reports already work). Automatic arrival of orders is what the application above unlocks.
