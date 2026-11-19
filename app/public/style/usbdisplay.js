'use strict';
/* AUZsStyle: USB customer display. Talks to the Waveshare ESP32-S3-LCD-2.8 (AUZSLAB Customer
   Display firmware, firmware/customer-display/ in this repo) over the Web Serial API --
   plugged into the same computer/phone the till runs on, no WiFi, no server round trip.
   Chrome/Edge on desktop or Android only (Web Serial does not exist in Safari/Firefox, and
   never will on iOS) -- every call here is a no-op (not an error) when it's unsupported, so
   the rest of the till is completely unaffected on a browser that can't do this.
   Protocol (115200 baud, ASCII, newline-terminated, matches the firmware exactly):
     IDLE\n                         -> full logo
     PAY|<amt>|<n>|<hex bits>\n     -> amount + an n x n QR matrix, packed 1 bit/module,
                                      row-major, MSB first, no quiet zone (firmware adds it)
     PAID|<amt>\n                   -> green checkmark bounce-in + amount (manual: the
                                      cashier's own "Payment received" tap, same as custSend's
                                      {type:'paid'} on the window display -- never inferred)
     FAILED\n                       -> red cross shake (manual: the cashier backed out of the
                                      QR screen without confirming received)
   The firmware replies OK|... / ERR|... on its own line; we only use that for a toast, never
   to block a sale -- the physical screen is a nice-to-have, never the path a bill depends on. */
const usbDisplaySupported = () => 'serial' in navigator;
let _usbPort = null, _usbWriter = null, _usbConnecting = null;
let _usbStatus = null; // last {wifi, ip, fw} from a STATUS reply, or null if never asked
let _usbStatusWaiters = [];

async function _usbOpen(port) {
  await port.open({ baudRate: 115200 });
  _usbPort = port; _usbWriter = port.writable.getWriter();
  // read loop: toasts an ERR| line, records a STATUS reply for usbDisplayStatus(), and
  // otherwise just drains the port -- never awaited by a caller, the till never blocks on it.
  (async () => {
    const reader = port.readable.getReader(); let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (line.startsWith('ERR|')) toast(t('Customer display') + ': ' + line.slice(4), { err: true });
          else if (line.startsWith('OK|STATUS|')) {
            const [, , wifi, ip, fw] = line.split('|');
            _usbStatus = { wifi: wifi === '1', ip, fw: Number(fw) || null };
            _usbStatusWaiters.splice(0).forEach((fn) => fn(_usbStatus));
          }
        }
      }
    } catch { /* port closed/unplugged -- next send just re-fails quietly */ }
    finally { try { reader.releaseLock(); } catch { /* already released */ } }
  })();
  port.addEventListener('disconnect', () => { _usbPort = null; _usbWriter = null; });
}
// Called once, early (no prompt): reattaches to a port the cashier already approved earlier,
// so the screen keeps working after a reload without asking again.
async function usbDisplayAutoConnect() {
  if (!usbDisplaySupported() || _usbPort) return;
  try { const ports = await navigator.serial.getPorts(); if (ports[0]) await _usbOpen(ports[0]); } catch { /* not connected yet -- fine */ }
}
// Called from a tap (Web Serial requires a user gesture) -- the one-time "pick the device" prompt.
async function usbDisplayConnect() {
  if (!usbDisplaySupported()) { toast(t('This browser cannot use a USB customer display. Use Chrome or Edge.'), { err: true }); return false; }
  try {
    const port = await navigator.serial.requestPort();
    await _usbOpen(port);
    await usbDisplaySendIdle();
    toast(t('Customer display connected'));
    return true;
  } catch (e) { if (e && e.name !== 'NotFoundError') toast(e.message || t('Could not connect'), { err: true }); return false; }
}
function usbDisplayConnected() { return !!_usbWriter; }
async function _usbWrite(line) {
  if (!_usbWriter) { if (_usbConnecting) return; _usbConnecting = usbDisplayAutoConnect().finally(() => { _usbConnecting = null; }); await _usbConnecting; }
  if (!_usbWriter) return;
  try { await _usbWriter.write(new TextEncoder().encode(line)); } catch { _usbPort = null; _usbWriter = null; }
}
async function usbDisplaySendIdle() { await _usbWrite('IDLE\n'); }
// n must land on a real QR version size (21,25,29,...,177); the firmware caps at 45 (version 7)
// to stay comfortably scannable on a 2.8" screen -- same cap the Python prototype used.
function _qrBits(payload) {
  const q = qrcode(0, 'M'); q.addData(payload); q.make();
  const n = q.getModuleCount();
  if (n > 45) throw new Error(t('That UPI id/amount makes too large a QR for the customer display'));
  const bytes = new Uint8Array(Math.ceil((n * n) / 8));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) {
    const i = r * n + c; bytes[i >> 3] |= 0x80 >> (i % 8);
  }
  return { n, hex: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') };
}
async function usbDisplaySendPay(amount, upiPayload) {
  let bits; try { bits = _qrBits(upiPayload); } catch (e) { toast(e.message, { err: true }); return; }
  await _usbWrite('PAY|' + Number(amount).toFixed(2) + '|' + bits.n + '|' + bits.hex + '\n');
}
async function usbDisplaySendPaid(amount) { await _usbWrite('PAID|' + Number(amount).toFixed(2) + '\n'); }
async function usbDisplaySendFailed() { await _usbWrite('FAILED\n'); }
// Sets the display's WiFi (for automatic future firmware updates only -- billing itself
// stays on this USB link regardless of WiFi). The one serial command that replaces ever
// having to open Arduino IDE again just to change WiFi.
async function usbDisplaySetWifi(ssid, password) {
  if (!usbDisplayConnected() || !ssid) return false;
  await _usbWrite('WIFI|' + ssid + '|' + (password || '') + '\n');
  return true;
}
// Asks the display for {wifi, ip, fw} and waits (briefly) for its reply; null if not
// connected or it didn't answer in time -- never throws, Settings just shows "unknown".
function usbDisplayStatus(timeoutMs = 2000) {
  if (!usbDisplayConnected()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { _usbStatusWaiters = _usbStatusWaiters.filter((f) => f !== onStatus); resolve(null); }, timeoutMs);
    const onStatus = (s) => { clearTimeout(timer); resolve(s); };
    _usbStatusWaiters.push(onStatus);
    _usbWrite('STATUS\n');
  });
}
