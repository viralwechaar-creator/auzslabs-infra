const shippingOptions = {
  standard: { name: 'Standard delivery', estimate: '4–7 business days', fee: (subtotal) => subtotal >= 2500 ? 0 : 79 },
  express: { name: 'Express delivery', estimate: '2–3 business days', fee: () => 149 },
};
const paymentOptions = { cod: 'Cash on delivery · demo', prepaid: 'Prepaid · demo' };
const historyKey = 'kaarigari-demo-orders';
let sessionOrders = [];

function getOrders() {
  try {
    const orders = JSON.parse(localStorage.getItem(historyKey));
    return Array.isArray(orders) ? orders : sessionOrders;
  } catch { return sessionOrders; }
}

function saveOrders(orders) {
  sessionOrders = orders;
  try { localStorage.setItem(historyKey, JSON.stringify(orders)); } catch { /* Keep the receipt for this tab. */ }
}

function checkoutPage() {
  if (!total()) return page('Your bag is empty', '<p>Add an object to begin checkout.</p><a class="button" href="#/shop">Explore the shop</a>');
  return '<section class="section wrap checkout-page"><p><a href="#/shop" class="text-link">Continue shopping</a></p>' + heading('Checkout') +
    '<p class="checkout-note">Demo checkout. Use sample contact and address details. This preview won’t ask for card details or charge you.</p>' +
    '<form id="checkout-form" class="checkout-layout"><div class="checkout-fields">' +
    '<fieldset><legend>Contact</legend><div class="site-form"><label>Email<input type="email" name="email" autocomplete="email" required></label>' +
    '<label><span>Phone <small>(10 digits)</small></span><input name="phone" type="tel" autocomplete="tel-national" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" required></label></div></fieldset>' +
    '<fieldset><legend>Delivery address</legend><div class="site-form"><label>First name<input name="firstName" autocomplete="given-name" required></label>' +
    '<label>Last name<input name="lastName" autocomplete="family-name" required></label>' +
    '<label class="wide">Street address<input name="address" autocomplete="address-line1" required></label>' +
    '<label class="wide">Apartment or landmark (optional)<input name="address2" autocomplete="address-line2"></label>' +
    '<label>City<input name="city" autocomplete="address-level2" required></label><label>State or union territory<input name="state" autocomplete="address-level1" required></label>' +
    '<label>PIN code<input name="pin" autocomplete="postal-code" inputmode="numeric" pattern="[1-9][0-9]{5}" maxlength="6" required></label>' +
    '<label>Country<input name="country" value="India" autocomplete="country-name" readonly></label></div></fieldset>' +
    '<fieldset><legend>Delivery method</legend>' + Object.entries(shippingOptions).map(([key, option]) =>
      '<label class="choice"><input type="radio" name="shipping" value="' + key + '"' + (key === 'standard' ? ' checked' : '') + '><span>' + option.name + '<small>' + option.estimate + '</small></span><strong>' +
      '<span data-delivery-fee="' + key + '">' + deliveryPrice(option.fee(total())) + '</span></strong></label>').join('') + '</fieldset>' +
    '<fieldset><legend>Payment method</legend>' + Object.entries(paymentOptions).map(([key, label]) =>
      '<label class="choice"><input name="payment" type="radio" value="' + key + '"' + (key === 'cod' ? ' checked' : '') + '><span>' + label + '</span></label>').join('') +
    '</fieldset></div>' +
    '<aside class="checkout-summary"><h2>Shopping bag</h2><div class="checkout-items">' + orderItems(currentOrderItems(), true) + '</div>' +
    '<div id="checkout-totals" aria-live="polite">' + checkoutTotals(total(), shippingOptions.standard.fee(total())) + '</div>' +
    '</aside><div class="checkout-confirm"><p class="muted">See <a class="text-link" href="#/privacy">Privacy</a> and <a class="text-link" href="#/terms">Store terms</a>.</p>' +
    '<button class="button">Place demo order</button></div></form></section>';
}

const deliveryPrice = (fee) => fee ? price(fee) : 'Free';

function currentOrderItems() {
  return catalog.filter((product) => quantity(product.id)).map((product) => ({
    id: product.id, count: quantity(product.id), price: product.price,
  }));
}

function checkoutTotals(subtotal, shipping) {
  return '<dl class="totals"><div><dt>Subtotal</dt><dd>' + price(subtotal) + '</dd></div><div><dt>Delivery</dt><dd>' + deliveryPrice(shipping) +
    '</dd></div><div><dt>Total</dt><dd>' + price(subtotal + shipping) + '</dd></div></dl>';
}

function orderItems(items, editable = false) {
  return items.map(({ id, count, price: amount }) => {
    const p = catalog.find((product) => product.id === id);
    if (!p || !Number.isFinite(count) || !Number.isFinite(amount)) return '';
    const controls = editable ? '<div class="checkout-qty"><button type="button" data-checkout-item="' + id + '" data-quantity="-1" aria-label="Remove one ' + p.title + '">−</button><span>' + count +
      '</span><button type="button" data-checkout-item="' + id + '" data-quantity="1" aria-label="Add one ' + p.title + '">+</button></div>' : '<small>Quantity ' + count + '</small>';
    const remove = editable ? '<button type="button" class="checkout-remove" data-checkout-item="' + id + '" data-quantity="0" aria-label="Remove ' + p.title + '">×</button>' : '';
    return '<div class="summary-item"><img src="' + asset(p.id) + '" alt="" loading="lazy"><div><strong>' + p.title + '</strong>' + controls + '</div><div class="summary-tail"><span class="price">' + price(count * amount) + '</span>' + remove + '</div></div>';
  }).join('');
}

function ordersPage(id) {
  const orders = getOrders().filter((order) => order && /^KG-[A-F0-9]{8}$/.test(order.id) && Array.isArray(order.items));
  const order = orders.find((entry) => entry.id === id);
  if (id && !order) return page('Order not found', '<a href="#/orders" class="text-link">View demo order history</a>');
  if (order) {
    const shipping = Object.hasOwn(shippingOptions, order.shipping) ? shippingOptions[order.shipping].name : 'Delivery';
    const payment = Object.hasOwn(paymentOptions, order.payment) ? paymentOptions[order.payment] : 'Demo payment';
    return page('Demo order ' + order.id, '<p>Your test order is complete. Nothing will be charged or shipped.</p><div class="receipt">' + orderItems(order.items) +
      checkoutTotals(Number(order.subtotal), Number(order.delivery)) + '<p>' + shipping + ' · ' + payment + '</p></div><a href="#/orders" class="text-link">View order history</a>');
  }
  return page('Demo order history', orders.length
    ? '<div class="drawer-links">' + orders.map((entry) => '<a href="#/orders/' + entry.id + '">' + entry.id + ' · ' + price(Number(entry.subtotal) + Number(entry.delivery)) + '</a>').join('') + '</div><p><button class="button" data-clear-orders>Clear demo history</button></p>'
    : '<p>Demo orders placed in this browser will appear here.</p><a href="#/shop" class="button">Explore the shop</a>');
}

document.addEventListener('change', (event) => {
  if (event.target.form?.id !== 'checkout-form' || event.target.name !== 'shipping') return;
  const subtotal = total();
  document.querySelector('#checkout-totals').innerHTML = checkoutTotals(subtotal, shippingOptions[event.target.value].fee(subtotal));
});

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'checkout-form') return;
  event.preventDefault();
  const form = event.target;
  if (!form.reportValidity()) return;
  const subtotal = total();
  if (!subtotal) { render(); return; }
  const data = new FormData(form);
  const shipping = data.get('shipping');
  const payment = data.get('payment');
  if (!Object.hasOwn(shippingOptions, shipping) || !Object.hasOwn(paymentOptions, payment)) return;
  const code = Array.from(crypto.getRandomValues(new Uint8Array(4)), (value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  const order = {
    id: 'KG-' + code,
    items: currentOrderItems(),
    subtotal,
    delivery: shippingOptions[shipping].fee(subtotal),
    shipping,
    payment,
  };
  saveOrders([order, ...getOrders()].slice(0, 25));
  bag = {};
  updateBag();
  location.hash = '/orders/' + order.id;
});

document.addEventListener('click', (event) => {
  const control = event.target.closest('[data-checkout-item]');
  if (control) {
    const { checkoutItem, quantity: change } = control.dataset;
    bag[checkoutItem] = change === '0' ? 0 : quantity(checkoutItem) + Number(change);
    updateBag();
    const subtotal = total();
    if (!subtotal) { render(); main.focus(); return; }
    const items = document.querySelector('.checkout-items');
    const scroll = items.scrollTop;
    items.innerHTML = orderItems(currentOrderItems(), true);
    const shipping = document.querySelector('input[name="shipping"]:checked').value;
    for (const [key, option] of Object.entries(shippingOptions)) {
      document.querySelector('[data-delivery-fee="' + key + '"]').textContent = deliveryPrice(option.fee(subtotal));
    }
    document.querySelector('#checkout-totals').innerHTML = checkoutTotals(subtotal, shippingOptions[shipping].fee(subtotal));
    const next = items.querySelector('[data-checkout-item="' + checkoutItem + '"][data-quantity="' + change + '"]') || items.querySelector('button');
    next?.focus({ preventScroll: true });
    items.scrollTop = scroll;
    return;
  }
  if (!event.target.closest('[data-clear-orders]')) return;
  saveOrders([]);
  render();
  main.focus();
});

render();
updateBag();
