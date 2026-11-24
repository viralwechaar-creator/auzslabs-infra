/* Theme preview data for the storefront themes (Minimal, Classic). Opened as /store.html?demo=minimal on auzslab.in: the page is a
   template filled with the AUZsStyle demo catalogue (GenX), not any business's live store. Ordering is switched off. */
(function () {
  const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  window.StoreDemo = {
    async build(theme) {
      const rows = await (await fetch('/studs-preview/catalog.json')).json();
      const img = (f) => '/store/genx-studio/' + f;
      const styles = rows.map((p) => {
        const per = Math.max(1, Math.round((p.stock || 0) / Math.max(1, p.sizes.length)));
        return {
          id: p.slug, name: p.name, category: p.category, brand: 'GenX', gender: 'Unisex', fabric: p.fabric, season: '', collection: p.collection, code: p.sku,
          description: p.description, details: [p.fabric, p.washcare].filter(Boolean).join('\n'), washcare: p.washcare, price: p.price, mrp: p.price, badge: '',
          photoUrl: img(p.files[0]), photos: p.files.map(img), colourPhotos: {},
          variants: p.sizes.map((sz) => ({ id: p.slug + '-' + slug(sz), colour: p.colour, size: sz, price: p.price, left: p.stock ? per : 0 })),
        };
      });
      const names = [...new Set(rows.map((p) => p.collection).filter(Boolean))];
      const collections = names.map((n) => ({ id: slug(n), name: n, imageUrl: img(rows.find((p) => p.collection === n).files[0]), styleIds: rows.filter((p) => p.collection === n).map((p) => p.slug) }));
      return {
        name: 'GenX Clothing', shop: { name: 'GenX Clothing', logoUrl: '', address: 'Jodhpur, Rajasthan', phone: '' },
        styles, collections,
        config: { template: theme === 'minimal' ? 'minimal' : '1', brandName: 'GenX Clothing', tagline: 'Streetwear, made loud', announce: 'Template preview: ordering is switched off', heroImages: [img(rows[0].files[0]), img(rows[3].files[0])],
          shipping: { fee: 0, freeOver: 0 }, pay: { cod: true }, policies: {}, faqs: [], stores: [], founders: [] },
      };
    },
  };
})();
