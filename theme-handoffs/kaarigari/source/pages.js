const supportPages = {
  shipping: ['Shipping & delivery', [
    ['Delivery options', 'The demo offers standard and express delivery. Checkout calculates a sample delivery fee from the option you choose.'],
    ['Delivery estimates', 'Standard delivery shows an estimate of 4–7 business days. Express shows 2–3 business days. These estimates are illustrative.'],
    ['Tracking', 'Demo orders appear under Order history with their reference number and status. They are not dispatched.'],
  ]],
  returns: ['Returns & exchanges', [
    ['Request a return', 'Use the contact form and include your order reference. The preview validates your request and shows a local confirmation.'],
    ['Merchant policy', 'A live merchant sets return windows, eligibility, and refund terms before accepting orders.'],
  ]],
  privacy: ['Privacy', [
    ['Checkout details', 'Contact and delivery fields are used in the current preview to demonstrate checkout. They are not sent over the network or saved in order history.'],
    ['Cookies and browser storage', 'The preview uses browser storage for your bag, demo order summaries, and whether you have dismissed the cookie notice. It sets no optional tracking cookies. Clear demo history from the Order history page or clear this site’s browser storage.'],
    ['Contact form', 'The contact form shows a local confirmation. It does not send a message or retain the contents after you leave the page.'],
  ]],
  terms: ['Store terms', [
    ['Sample catalogue', 'Kaarigari is an AUZslab storefront concept. Product details, prices and delivery estimates illustrate how a real shop could work.'],
    ['Demo checkout', 'Placing a preview order does not charge you, send a confirmation email or create a shipment.'],
  ]],
  faq: ['Frequently asked questions', [
    ['Can I buy these products?', 'The catalogue is a demo. You can explore the bag, shipping options and order confirmation with sample details.'],
    ['How do I care for an object?', 'Each product has its own care section. The care guide groups this advice by material.'],
    ['Where do I find my order reference?', 'Open Demo order history to view orders placed in this browser.'],
  ]],
};

function infoPage(key) {
  const [title, sections] = supportPages[key];
  return page(title, sections.map(([label, copy]) => '<details open><summary>' + label + '</summary><p>' + copy + '</p></details>').join(''));
}

function contactPage() {
  return page('Contact', '<p>Questions about materials, gifting or an order? Choose a topic below. This preview keeps your message on this page.</p>' +
    '<form id="contact-form" class="site-form"><label>Your name<input name="name" autocomplete="name" maxlength="100" required></label>' +
    '<label>Email<input name="email" type="email" autocomplete="email" required></label>' +
    '<label>Topic<select name="topic"><option>Product enquiry</option><option>Gifting</option><option>Delivery or returns</option><option>Other</option></select></label>' +
    '<label>Order reference (optional)<input name="reference" maxlength="40"></label>' +
    '<label class="wide">How can we help?<textarea name="message" rows="5" maxlength="1500" required></textarea></label>' +
    '<div class="wide"><button class="button">Preview enquiry</button><p data-contact-status role="status"></p></div></form>');
}

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'contact-form') return;
  event.preventDefault();
  event.target.querySelector('[data-contact-status]').textContent = 'Your enquiry passed validation. No message was sent from this preview.';
  event.target.reset();
});
