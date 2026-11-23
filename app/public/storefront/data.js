// Static reference data for the AUZslab storefront owner hub: the left-nav menu, icon paths, and the
// two first-party themes. Adapted from Codex's ecosystem-preview/data.js -- the menu/icon/nav shape is
// kept exactly as designed; the fabricated "GenX Cloths" demo catalog/orders/customers/campaigns/etc. are
// NOT carried over (a brand-new tenant must start from a genuinely empty store, never someone else's demo
// products) -- those now come from the real backend (api.js's boot(), via sfx_context()).
export const templates = [
  { id: 'minimal', name: 'Minimal', description: 'An image-led storefront with swipeable rails and editorial product pages.', image: '/storefront/assets/theme-minimal.svg' },
  { id: 'classic', name: 'Classic', description: 'A catalog-first storefront with familiar navigation, collections and checkout.', image: '/storefront/assets/theme-classic.svg' },
];

// Every section Codex's workspace.js designed. Phase 1 wires catalog (Products, Collections), Orders, the
// theme picker (Online store), Domains and a slim Business profile/Payments to the real backend below;
// every other entry still appears (nothing removed from the nav) but opens a page that is honestly marked
// "Coming soon" rather than a form that quietly saves nowhere -- see workspace.js's REAL_SECTIONS.
export const menu = [
  { id: 'home', name: 'Home', icon: 'home' },
  { id: 'orders', name: 'Orders', icon: 'bag', children: [['drafts', 'Drafts'], ['abandoned-checkouts', 'Abandoned checkouts'], ['returns', 'Returns'], ['shipping', 'Shipping']] },
  { id: 'products', name: 'Products', icon: 'box', children: [['collections', 'Collections'], ['inventory', 'Inventory'], ['transfers', 'Transfers'], ['categories', 'Categories and tags']] },
  { id: 'customers', name: 'Customers', icon: 'user', children: [['segments', 'Segments'], ['companies', 'Companies']] },
  { id: 'growth', name: 'Growth', icon: 'spark' },
  { id: 'discounts', name: 'Discounts', icon: 'tag' },
  { id: 'content', name: 'Content', icon: 'file', children: [['pages', 'Pages and menus'], ['files', 'Files'], ['data', 'Custom data']] },
  { id: 'markets', name: 'Markets', icon: 'globe' },
  { id: 'analytics', name: 'Analytics', icon: 'chart', children: [['reports', 'Reports'], ['live-view', 'Live view']] },
  { label: 'Sales channels' },
  { id: 'website', name: 'Online store', icon: 'globe', children: [['builder', 'Theme'], ['templates', 'Themes'], ['store-pages', 'Pages'], ['domains', 'Domains'], ['checkout', 'Payments']] },
  { id: 'apps', name: 'Apps and plans', icon: 'grid' },
  { label: 'Business' },
  { id: 'team', name: 'Staff and access', icon: 'user', children: [['roles', 'Roles'], ['locations', 'Locations']] },
  { id: 'settings', name: 'Settings', icon: 'settings', children: [['notifications', 'Notifications'], ['billing', 'Billing and renewals'], ['security', 'Sign-in and support']] },
];

export const icons = {
  tag: 'M3 4h7l10 10-6 6L3 9z M7 7h.01',
  pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  lock: 'M6 10h12v10H6z M8 10V7a4 4 0 0 1 8 0v3',
  card: 'M3 6h18v12H3z M3 10h18 M7 15h4',
  home: 'M3 10l9-7 9 7v10h-6v-6H9v6H3z', bag: 'M5 8h14l1 12H4z M8 9V6a4 4 0 0 1 8 0v3',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M4 21v-2a8 7 0 0 1 16 0v2',
  spark: 'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z',
  file: 'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h7',
  chart: 'M4 20h16 M7 16v-4 M12 16V8 M17 16V4',
  globe: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M2 12h20 M12 2a4 10 0 1 0 0 20 4 10 0 0 0 0-20z',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  settings: 'M12 2v4m0 12v4M2 12h4m12 0h4m-3-7-3 3m-8 8-3 3m0-14 3 3m8 8 3 3 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0zm-2 4 5 5',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  bell: 'M18 8a6 6 0 0 0-12 0c0 6-2 7-2 9h16c0-2-2-3-2-9 M10 21h4',
  moon: 'M20 15a8.5 8.5 0 0 1-11-11 8.5 8.5 0 1 0 11 11z',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M19 5l-1 1 M6 18l-1 1',
};

// The in-memory shape every page in workspace.js/analytics.js reads from, seeded empty -- api.js's boot()
// fills business/products/collections/orders/store from the real backend (sfx_context + sfx_product_list +
// sfx_collection_list + sfx_order_list) right after this module loads, before the first render.
export const emptyState = () => ({
  business: { name: '', email: '', phone: '', currency: 'INR' },
  store: { theme: 'minimal', published: false, razorpayConnected: false },
  products: [],
  collections: [],
  orders: [],
  customers: [],
  discounts: [],
  domains: [],
  notifications: [],
  campaigns: [],
  analyticsReports: [],
  analyticsPins: [],
  perms: { sfx_view: true, sfx_manage: false },
  counts: { products: 0, activeProducts: 0, collections: 0, toFulfill: 0, lowStock: 0, salesTotal: 0 },
});
