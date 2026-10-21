/* Website designs that have their own editor.
   HOW TO ADD A NEW DESIGN (do this for every new template, same piece of work):
   1. Build the page (like site-kiln.html). Mark everything an owner should be able to change:
        text:   data-ed="page.key" data-ed-label="What the owner sees" data-ed-group="Page name" data-ed-type="text|long"
        image:  data-ed-img="page.key" data-ed-label="..." data-ed-group="Page name"   (on an <img>)
      and apply the saved values at load: read cfg.siteData[key] (see applyEd() in site-kiln.html).
   2. Add one line below: design id (the settings.siteTemplate value) -> its file and name.
   The edit page (site-edit.html) builds its form from the markers, so nothing else changes.
   Values are stored in the business settings as siteData { key: text or image address }. */
window.SITE_SCHEMAS = {
  kiln: { file: '/site-kiln.html', name: 'Kiln' }
};
