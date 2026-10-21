/* AUZsStyle: English text is the key; Hindi is looked up from HI. A missing Hindi word falls back to English. */
'use strict';
let S_LANG = 'en';
const HI = {
  'Overview': 'सारांश', 'Sell': 'बिक्री', 'Stock': 'स्टॉक', 'Buy': 'ख़रीद', 'People': 'लोग', 'Reports': 'रिपोर्ट', 'Settings': 'सेटिंग्स', 'More': 'और',
  'Customers': 'ग्राहक', 'Suppliers': 'सप्लायर', 'Staff': 'स्टाफ', 'Branches': 'शाखाएँ', 'Transfers': 'ट्रांसफर', 'Sales': 'बिक्री', 'Analytics': 'विश्लेषण',
  'Search styles, scan a barcode': 'स्टाइल खोजें या बारकोड स्कैन करें', 'Search or scan a tag': 'खोजें या टैग स्कैन करें', 'All': 'सभी', 'Bill': 'बिल', 'Bills': 'बिल', 'Cart is empty': 'कार्ट ख़ाली है', 'Total': 'कुल', 'Subtotal': 'उप-योग',
  'Discount': 'छूट', 'Tax': 'टैक्स', 'Round off': 'राउंड ऑफ़', 'Pay': 'भुगतान', 'Cash': 'नकद', 'UPI': 'UPI', 'Card': 'कार्ड', 'Store credit': 'स्टोर क्रेडिट', 'Due': 'बकाया',
  'Customer': 'ग्राहक', 'Walk-in': 'वॉक-इन', 'Hold': 'होल्ड', 'Held bills': 'होल्ड बिल', 'Clear': 'हटाएँ', 'Add': 'जोड़ें', 'Save': 'सहेजें', 'Cancel': 'रद्द', 'Done': 'हो गया',
  'Colour': 'रंग', 'Size': 'साइज़', 'Price': 'क़ीमत', 'Cost': 'लागत', 'Qty': 'मात्रा', 'In stock': 'स्टॉक में', 'Out of stock': 'स्टॉक ख़त्म', 'Low stock': 'कम स्टॉक',
  'New style': 'नया स्टाइल', 'Edit style': 'स्टाइल बदलें', 'Name': 'नाम', 'Category': 'श्रेणी', 'Brand': 'ब्रांड', 'Gender': 'जेंडर', 'Season': 'सीज़न', 'HSN code': 'HSN कोड',
  'Selling price': 'बिक्री मूल्य', 'MRP': 'MRP', 'Opening stock per size': 'हर साइज़ का शुरुआती स्टॉक', 'Colours': 'रंग', 'Sizes': 'साइज़',
  'Receive stock': 'माल प्राप्त करें', 'Adjust stock': 'स्टॉक सुधारें', 'Count': 'गिनती', 'Damaged': 'ख़राब', 'Lost': 'खोया', 'Remove': 'घटाएँ',
  'Returns': 'वापसी', 'Return': 'वापसी', 'Exchange': 'एक्सचेंज', 'Refund': 'रिफ़ंड', 'Reason': 'कारण', 'Find bill': 'बिल खोजें',
  'Today': 'आज', 'Yesterday': 'कल', 'This week': 'इस हफ़्ते', 'This month': 'इस महीने', 'Last 30 days': 'पिछले 30 दिन', 'Pick dates': 'तारीख़ें चुनें',
  'Revenue': 'आमदनी', 'Profit': 'मुनाफ़ा', 'Units': 'नग', 'Average bill': 'औसत बिल', 'Best sellers': 'सबसे ज़्यादा बिकने वाले', 'Sales by category': 'श्रेणी के अनुसार बिक्री',
  'Sales by size': 'साइज़ के अनुसार बिक्री', 'Sales by colour': 'रंग के अनुसार बिक्री', 'Fast movers': 'तेज़ बिकने वाले', 'Reorder': 'दोबारा मँगाएँ', 'Slow stock': 'धीमा स्टॉक',
  'Sign in': 'साइन इन', 'Sign out': 'साइन आउट', 'Language': 'भाषा', 'Appearance': 'दिखावट', 'Help': 'मदद', 'Phone': 'फ़ोन', 'Notes': 'नोट', 'Shop name': 'दुकान का नाम',
  'Open shift': 'शिफ़्ट शुरू करें', 'Close shift': 'शिफ़्ट बंद करें', 'Opening cash': 'शुरुआती नकद', 'Counted cash': 'गिना हुआ नकद',
  'Points': 'पॉइंट', 'Use points': 'पॉइंट इस्तेमाल करें', 'Print': 'प्रिंट', 'WhatsApp': 'WhatsApp', 'New bill': 'नया बिल', 'Cancel bill': 'बिल रद्द करें',
};
function setLang(l) { S_LANG = l === 'hi' ? 'hi' : 'en'; try { localStorage['sty.lang'] = S_LANG; } catch { /* private mode */ } document.documentElement.lang = S_LANG; }
function t(s, vars) {
  let r = S_LANG === 'hi' && HI[s] ? HI[s] : s;
  if (vars) for (const k in vars) r = r.replace('{' + k + '}', vars[k]);
  return r;
}
