/* AUZsFinance: English and Hindi. Screens are written in English; when Hindi is on, a small translator swaps every label that has an entry
   below (exact text match, also placeholders and aria-labels) and keeps doing it as screens change. Text with names or numbers inside stays English.
   The Hindi wording is not reviewed by a Hindi speaker yet. */
'use strict';
const HI = {
  'Today': 'आज', 'Activity': 'गतिविधि', 'Dues': 'बकाया', 'Owner & loans': 'मालिक और कर्ज', 'Accounts': 'खाते', 'Reports': 'रिपोर्ट', 'Assets': 'संपत्ति', 'Budget': 'बजट',
  'Approvals': 'मंज़ूरी', 'Repeating': 'दोहराव', 'Bank import': 'बैंक आयात', 'Insights': 'जानकारी', 'Settings': 'सेटिंग्स', 'More': 'और', 'Tools': 'औज़ार', 'Tax': 'टैक्स',
  'Add entry': 'प्रविष्टि जोड़ें', 'Money you have': 'आपके पास पैसा', 'This month': 'इस महीने', 'This week': 'इस हफ़्ते', 'This year': 'इस साल', 'In': 'आया', 'Out': 'गया', 'Left': 'बचा',
  'To receive': 'लेना है', 'To pay': 'देना है', 'Customers owe you': 'ग्राहकों से लेना', 'You owe suppliers': 'सप्लायर को देना', 'Owner capital': 'मालिक की पूंजी', 'Owner and loans': 'मालिक और कर्ज',
  'Where it went': 'पैसा कहाँ गया', 'Recent': 'हाल का', 'Nothing yet': 'अभी कुछ नहीं', 'Save': 'सहेजें', 'Cancel': 'रद्द करें', 'Done': 'हो गया', 'Close': 'बंद करें', 'Back': 'वापस',
  'What happened?': 'क्या हुआ?', 'Everyday': 'रोज़ का', 'Money received': 'पैसा मिला', 'Paid out': 'पैसा दिया', 'Move between accounts': 'खातों के बीच भेजें',
  'Owner and partners': 'मालिक और साझेदार', 'Owner put money in': 'मालिक ने पैसा लगाया', 'Owner took money out': 'मालिक ने पैसा निकाला', 'Loans': 'कर्ज', 'Loan received': 'कर्ज मिला', 'Loan repaid': 'कर्ज चुकाया',
  'Loan given': 'कर्ज दिया', 'Loan money back': 'कर्ज वापस मिला', 'Credit and dues': 'उधार और बकाया', 'Sold on credit': 'उधार बेचा', 'Bought on credit': 'उधार खरीदा', 'They paid me': 'उन्होंने चुकाया', 'I paid them': 'मैंने चुकाया',
  'Bought an asset': 'संपत्ति खरीदी', 'Amount': 'रकम', 'Date': 'तारीख', 'Note': 'टिप्पणी', 'Proof': 'सबूत', 'Paid from': 'कहाँ से दिया', 'Received into': 'कहाँ मिला', 'Kind of expense': 'ख़र्च का प्रकार',
  'What for': 'किसलिए', 'Add photo or file': 'फ़ोटो या फ़ाइल जोड़ें', 'Scan a bill': 'बिल स्कैन करें', 'I have the bill or proof': 'मेरे पास बिल है', 'Bill will come later': 'बिल बाद में आएगा', 'No bill': 'बिल नहीं',
  'Not sure about this one. Ask a manager to check it.': 'पक्का नहीं। मैनेजर से जँचवाएँ।', 'Enter an amount above zero': 'शून्य से ऊपर रकम डालें', 'Saved': 'सहेजा गया', 'Entry': 'प्रविष्टि',
  'Needs a check': 'जाँच चाहिए', 'Check': 'जाँच', 'Cancelled': 'रद्द', 'Mark as checked': 'जाँचा हुआ मानें', 'Ask for a check': 'जाँच माँगें', 'Correct this entry': 'प्रविष्टि सुधारें', 'Cancel this entry': 'प्रविष्टि रद्द करें',
  'Reference / UTR': 'संदर्भ / UTR', 'Add reference / UTR': 'संदर्भ / UTR जोड़ें', 'Account': 'खाता', 'Category': 'श्रेणी', 'Person': 'व्यक्ति', 'Time': 'समय', 'Type': 'प्रकार', 'Method': 'तरीका', 'Journal': 'जर्नल',
  'Owes you': 'आपसे लेना', 'You owe': 'आपको देना', 'Record payment received': 'मिला हुआ भुगतान दर्ज करें', 'Record payment made': 'किया हुआ भुगतान दर्ज करें', 'Remind': 'याद दिलाएँ', 'History': 'इतिहास',
  'No one owes you': 'आपसे कोई लेना नहीं', 'You owe no one': 'आपको किसी को देना नहीं', 'New credit entry': 'नई उधार प्रविष्टि', 'Oldest entry': 'सबसे पुरानी प्रविष्टि', 'Phone': 'फ़ोन',
  'Profit': 'मुनाफ़ा', 'Loss': 'नुकसान', 'Balance': 'बैलेंस', 'Cash': 'नकद', 'Earned': 'कमाया', 'Spent': 'ख़र्च', 'Worth today': 'आज की कुल क़ीमत', 'You have': 'आपके पास', 'Owner side': 'मालिक की तरफ़',
  'Money now': 'अभी पैसा', 'At the start': 'शुरू में', 'Change': 'बदलाव', 'Where it moved': 'पैसा कहाँ हिला', 'Dues age': 'बकाया की उम्र', 'Download': 'डाउनलोड',
  'Nothing waiting': 'कुछ इंतज़ार में नहीं', 'Approve': 'मंज़ूर करें', 'Reject': 'अस्वीकार करें', 'Approval limit': 'मंज़ूरी सीमा', 'Waiting for a check': 'जाँच के इंतज़ार में', 'Limits': 'सीमाएँ',
  'New repeating entry': 'नई दोहराने वाली प्रविष्टि', 'Nothing repeats yet': 'अभी कुछ दोहराता नहीं', 'Paused': 'रुका हुआ', 'Pause': 'रोकें', 'Resume': 'फिर चालू करें', 'How often': 'कितनी बार',
  'Every week': 'हर हफ़्ते', 'Every month': 'हर महीने', 'Every year': 'हर साल', 'First on': 'पहली बार', 'Next on': 'अगली बार', 'Repeating entry': 'दोहराने वाली प्रविष्टि',
  'Choose statement file (CSV)': 'स्टेटमेंट फ़ाइल चुनें (CSV)', 'Bank account': 'बैंक खाता', 'Matched': 'मिलान हुआ', 'New': 'नया', 'Skipped': 'छोड़ा गया', 'Statement row': 'स्टेटमेंट पंक्ति',
  'Outlook': 'अनुमान', 'Comes in each day': 'रोज़ आता है', 'Goes out each day': 'रोज़ जाता है', 'Worth a look': 'देखने लायक', 'Money to ask for': 'माँगने वाला पैसा', 'Nothing looks wrong': 'कुछ गड़बड़ नहीं दिखी',
  'Send WhatsApp reminder': 'WhatsApp याद दिलाएँ', 'Open in WhatsApp': 'WhatsApp में खोलें', 'No one is late': 'कोई देर नहीं कर रहा', 'Look at this': 'इसे देखें',
  'Appearance': 'दिखावट', 'Auto': 'ऑटो', 'Light': 'हल्का', 'Dark': 'गहरा', 'Help': 'मदद', 'Sign out': 'साइन आउट', 'Sign in': 'साइन इन', 'Email': 'ईमेल', 'Password': 'पासवर्ड', 'Staff': 'स्टाफ़',
  'Books health': 'बही की सेहत', 'Everything adds up': 'सब हिसाब मिलता है', 'Language': 'भाषा', 'Help & report a problem': 'मदद और समस्या बताएँ', 'Backup, export or clear data': 'बैकअप, एक्सपोर्ट या डेटा साफ़',
  'Add account': 'खाता जोड़ें', 'Name': 'नाम', 'Total in all accounts': 'सभी खातों में कुल', 'Match with statement': 'स्टेटमेंट से मिलाएँ', 'Statement balance': 'स्टेटमेंट बैलेंस',
  'Add asset': 'संपत्ति जोड़ें', 'No assets yet': 'अभी कोई संपत्ति नहीं', 'Set a limit': 'सीमा तय करें', 'No budget yet': 'अभी कोई बजट नहीं', 'Monthly limit': 'मासिक सीमा', 'Likely by month end': 'महीने के अंत तक अनुमान',
  'All': 'सब', 'No entries': 'कोई प्रविष्टि नहीं', 'Search notes': 'टिप्पणी खोजें', 'Export': 'एक्सपोर्ट', 'Time': 'समय', 'Status': 'स्थिति',
  'Add owner or partner': 'मालिक या साझेदार जोड़ें', 'Put money in': 'पैसा लगाएँ', 'Take money out': 'पैसा निकालें', 'Put in': 'लगाया', 'Took out': 'निकाला', 'Net capital': 'शुद्ध पूंजी',
  'Record repayment': 'चुकौती दर्ज करें', 'Borrow more': 'और उधार लें', 'Lend more': 'और उधार दें', 'Borrowed': 'उधार लिया', 'Lent': 'उधार दिया', 'Interest': 'ब्याज',
  'GST': 'जीएसटी', 'TDS': 'टीडीएस', 'Tax (optional)': 'टैक्स (वैकल्पिक)', 'None': 'कोई नहीं', 'GST in this amount': 'इस रकम में जीएसटी', 'TDS cut': 'कटा हुआ टीडीएस',
  'Sales GST (collected)': 'बिक्री पर जीएसटी (लिया)', 'Purchase GST (paid)': 'ख़रीद पर जीएसटी (दिया)', 'GST to pay': 'जीएसटी देना है', 'Taxable sales': 'कर योग्य बिक्री', 'Taxable purchases': 'कर योग्य ख़रीद',
  'Cut from your payments': 'आपके भुगतान से कटा', 'Cut by you': 'आपने काटा', 'Less': 'कम', 'Sales': 'बिक्री',
};
let S_LANG = (() => { try { return localStorage.getItem('fin.lang') || 'en'; } catch { return 'en'; } })();
function tr(s) { return S_LANG === 'hi' && HI[s] ? HI[s] : s; }
function t(s, vars) { let r = tr(s); if (vars) for (const k in vars) r = r.replace('{' + k + '}', vars[k]); return r; }
function setLang(l) { S_LANG = l === 'hi' ? 'hi' : 'en'; try { localStorage.setItem('fin.lang', S_LANG); } catch { /* ignore */ } document.documentElement.lang = S_LANG; if (S_LANG === 'hi') hiPass(document.body); }
function hiNode(n) {
  if (n.nodeType === 3) { const k = n.nodeValue.trim(); if (k && HI[k]) n.nodeValue = n.nodeValue.replace(k, HI[k]); return; }
  if (n.nodeType !== 1 || /^(SCRIPT|STYLE|INPUT|TEXTAREA)$/.test(n.tagName) && n.tagName !== 'INPUT') return;
  for (const a of ['placeholder', 'aria-label', 'title']) { const v = n.getAttribute && n.getAttribute(a); if (v && HI[v]) n.setAttribute(a, HI[v]); }
}
function hiPass(root) {
  if (S_LANG !== 'hi' || !root) return;
  const w = document.createTreeWalker(root, 5); let n = w.currentNode;
  while (n) { hiNode(n); n = w.nextNode(); }
}
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.lang = S_LANG;
  new MutationObserver((ms) => { if (S_LANG !== 'hi') return; for (const m of ms) { if (m.type === 'characterData') hiNode(m.target); else m.addedNodes.forEach((x) => { hiNode(x); if (x.nodeType === 1) hiPass(x); }); } }).observe(document.body, { childList: true, subtree: true, characterData: true });
  if (S_LANG === 'hi') hiPass(document.body);
});
document.addEventListener('gesturestart', (e) => e.preventDefault()); document.addEventListener('dblclick', (e) => e.preventDefault());
