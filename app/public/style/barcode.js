/* AUZsStyle: Code 128 barcode drawn as SVG (no library). Numeric codes of even length use subset C (the shortest);
   anything else uses subset B. Patterns are the standard 107 bar/space width strings. */
'use strict';
const C128 = '212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,114131,311141,411131,211412,211214,211232,2331112'.split(',');
function code128Values(text) {
  const s = String(text); const vals = [];
  if (/^\d+$/.test(s) && s.length % 2 === 0) { vals.push(105); for (let i = 0; i < s.length; i += 2) vals.push(parseInt(s.slice(i, i + 2), 10)); }
  else { vals.push(104); for (const ch of s) { const c = ch.charCodeAt(0) - 32; vals.push(c >= 0 && c < 95 ? c : 0); } }
  let sum = vals[0]; for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103, 106);
  return vals;
}
function barcodeSvg(text, o = {}) {
  const vals = code128Values(text);
  // Every Code 128 character is 11 modules wide; the quiet zone is 10 modules each side. Total module count is fixed
  // by the text length alone, so when a caller asks for a specific pixel width (e.g. to fit a label), the module size
  // is solved for that width -- never stretched non-uniformly afterward. A barcode squeezed or stretched unevenly to
  // hit a fixed box size still looks right but throws off the bar-width ratios, which a real scanner (unlike a lenient
  // software decoder) refuses to read -- this is why printed tags scanned fine in testing but not with a real gun.
  const units = vals.length * 11 + 20;
  const mod = o.width ? o.width / units : (o.module || 1.6), hgt = o.height || 40, quiet = 10 * mod;
  let x = quiet, bars = '';
  for (const v of vals) {
    const p = C128[v]; let dark = true;
    for (const ch of p) { const w = +ch * mod; if (dark) bars += `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${hgt}"/>`; x += w; dark = !dark; }
  }
  const W = x + quiet;
  const wrap = document.createElement('span');
  // preserveAspectRatio is spelled out (not left to the default) so an older print engine can never interpret a
  // missing attribute as "none" and stretch the bars unevenly -- the one thing that actually breaks a real scanner.
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(2)} ${hgt}" width="${W.toFixed(0)}" height="${hgt}" preserveAspectRatio="xMidYMid meet" fill="#000" role="img" aria-label="${String(text).replace(/[^0-9A-Za-z-]/g, '')}">${bars}</svg>`;
  return wrap.firstChild;
}
