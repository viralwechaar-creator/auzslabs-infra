/* AUZsFinance: English only for now. t() keeps the same call shape as the other apps so Hindi can be added later. */
'use strict';
let S_LANG = 'en';
function setLang(l) { S_LANG = 'en'; document.documentElement.lang = 'en'; }
function t(s, vars) { let r = s; if (vars) for (const k in vars) r = r.replace('{' + k + '}', vars[k]); return r; }
document.addEventListener('gesturestart', (e) => e.preventDefault()); document.addEventListener('dblclick', (e) => e.preventDefault());
