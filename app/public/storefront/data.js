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
  { id: 'orders', name: 'Orders', icon: 'bag', children: [['drafts', 'Drafts'], ['abandoned-checkouts', 'Abandoned checkouts'], ['returns', 'Returns'], ['shipping', 'Shipping'], ['taxes', 'Taxes']] },
  { id: 'products', name: 'Products', icon: 'box', children: [['collections', 'Collections'], ['inventory', 'Inventory'], ['transfers', 'Transfers'], ['categories', 'Categories and tags']] },
  { id: 'customers', name: 'Customers', icon: 'user', children: [['segments', 'Segments'], ['companies', 'Companies']] },
  { id: 'growth', name: 'Growth', icon: 'spark' },
  { id: 'discounts', name: 'Discounts', icon: 'tag' },
  { id: 'content', name: 'Content', icon: 'file', children: [['pages', 'Pages and menus'], ['blog', 'Blog'], ['redirects', 'Redirects'], ['versions', 'Saved versions'], ['files', 'Files'], ['data', 'Custom data'], ['custom-fields', 'Typed fields']] },
  { id: 'markets', name: 'Markets', icon: 'globe' },
  { id: 'analytics', name: 'Analytics', icon: 'chart', children: [['reports', 'Reports'], ['insights', 'Insights'], ['live-view', 'Live view']] },
  { label: 'Sales channels' },
  { id: 'channels', name: 'All channels', icon: 'swap' },
  { id: 'website', name: 'Online store', icon: 'store', children: [['builder', 'Themes'], ['store-pages', 'Pages'], ['store-directory', 'Stores'], ['domains', 'Domains'], ['checkout', 'Payments']] },
  { id: 'apps', name: 'Apps and plans', icon: 'grid' },
  { label: 'Business' },
  { id: 'team', name: 'Staff and access', icon: 'team', children: [['roles', 'Roles'], ['locations', 'Locations']] },
  { id: 'settings', name: 'Settings', icon: 'settings', children: [['notifications', 'Notifications'], ['policies', 'Store policies'], ['privacy-settings', 'Customer privacy'], ['billing', 'Billing and renewals'], ['activity', 'Activity log'], ['staff-security', 'Staff security'], ['messages', 'Customer messages'], ['security', 'Sign-in and support'], ['switch-apps', 'Switch apps']] },
];

export const icons = {
  accountCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6.500 18.500a6.500 6.500 0 0 1 11 0',
  store: 'M3 9l1.5-5h15L21 9v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0V9z M5 13v8h14v-8 M10 21v-5h4v5',
  team: 'M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2 20v-1a6 6 0 0 1 12 0v1 M16 4.500a3 3 0 0 1 0 6 M18 14a5 5 0 0 1 4 5v1',
  swap: 'M4 8h15 M15 4l4 4-4 4 M20 16H5 M9 12l-4 4 4 4',
  business: 'M4 21V5l8-3 8 3v16 M9 8h2 M13 8h2 M9 12h2 M13 12h2 M10 21v-4h4v4',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6',
  shield: 'M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z M9 12l2 2 4-4',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1 M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  palette: 'M12 3a9 9 0 1 0 0 18c1.500 0 2-1 1.500-2s0-2.500 1.500-2.500H17a4 4 0 0 0 4-4C21 6 17 3 12 3z M7.500 11h.01 M10 7.500h.01 M14.500 7.500h.01',
  scroll: 'M8 4h10a2 2 0 0 1 2 2v12H6V6a2 2 0 0 1 2-2z M6 18a2 2 0 0 0 4 0 M10 9h6 M10 13h6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  key: 'M15 8a4 4 0 1 1-1 2.500L4 20v-3l2-2v-2h2l2-2 M17 7h.01',
  shirt: 'M8 3l-5 3 2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z',
  ledger: 'M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2V3z M9 8h6 M9 12h6 M9 16h3',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.500 7.500L20 18 M8.500 16.500L20 6',
  logout: 'M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9',
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
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.400 15a1.700 1.700 0 0 0 .3 1.800l.1.100a2 2 0 1 1-2.800 2.800l-.1-.1a1.700 1.700 0 0 0-1.800-.3 1.700 1.700 0 0 0-1 1.500V21a2 2 0 1 1-4 0v-.1a1.700 1.700 0 0 0-1.100-1.500 1.700 1.700 0 0 0-1.800.3l-.1.100a2 2 0 1 1-2.800-2.800l.1-.1a1.700 1.700 0 0 0 .3-1.800 1.700 1.700 0 0 0-1.500-1H3a2 2 0 1 1 0-4h.1a1.700 1.700 0 0 0 1.500-1.100 1.700 1.700 0 0 0-.3-1.800l-.1-.1a2 2 0 1 1 2.800-2.800l.1.100a1.700 1.700 0 0 0 1.800.3H9a1.700 1.700 0 0 0 1-1.500V3a2 2 0 1 1 4 0v.1a1.700 1.700 0 0 0 1 1.500 1.700 1.700 0 0 0 1.800-.3l.1-.1a2 2 0 1 1 2.800 2.800l-.1.100a1.700 1.700 0 0 0-.3 1.800V9a1.700 1.700 0 0 0 1.500 1H21a2 2 0 1 1 0 4h-.1a1.700 1.700 0 0 0-1.500 1z',
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
  inventory: [],
  drafts: [],
  returns: [],
  abandoned: [],
  checkout: { shipping: {}, abandonCapture: false },
  companies: [],
  segments: [],
  campaigns: [],
  segmentMembers: {},
  locations: [],
  stockMoves: [],
  categories: { categories: [], tags: [] },
  productTags: {},
  plan: { plan_status: 'trial', blocked: false },
  domains: [],
  marketplace: [],  // sfx_theme_marketplace_list(): every approved theme (built-in + developer), db/375
  installs: [],     // sfx_theme_install_list(): this store's own installed copies
  notifications: [],
  campaigns: [],
  analyticsReports: [],
  analyticsPins: [],
  perms: { sfx_view: true, sfx_manage: false },
  counts: { products: 0, activeProducts: 0, collections: 0, toFulfill: 0, lowStock: 0, salesTotal: 0 },
});
