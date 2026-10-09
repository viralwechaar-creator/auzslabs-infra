/* Barcode scanner for the browser (AUZsLedger "Scan to bill" and the AUZsScan app).
   auzScanner.open({ title, onCode(code, ctl) -> string|void, onClose }) opens a full-screen camera view and keeps scanning until it is closed.
   The camera decodes with the browser's own BarcodeDetector where it exists (Chrome and Android), and with the bundled ZXing reader
   (/vendor/zxing, loaded only when needed) everywhere else, which includes Safari on iPhone. Nothing is sent anywhere: frames are
   decoded on the device. A barcode is only an ID: price, HSN and GST always come from the product list, never from the code.
   Also handles: the same code seen twice in a row (ignored for a moment), torch where the phone allows it, typing a code by hand,
   a Bluetooth/USB scanner (it types the code and presses Enter), and a camera that is blocked or missing (typing still works). */
(function (root) {
  'use strict';
  const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code', 'codabar'];
  const REPEAT_MS = 1600;      // the same code is ignored for this long after it was accepted
  const GAP_MS = 500;          // any code is ignored for this long after the last accepted one

  // ---------- helpers ----------
  const el = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    for (const k in (props || {})) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'style') Object.assign(n.style, v); else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  };
  const injectCss = () => {
    if (document.getElementById('asc-css')) return;
    const s = el('style', { id: 'asc-css' });
    s.textContent = `
.asc{position:fixed;inset:0;z-index:400;background:#000;color:#fff;display:flex;flex-direction:column;font:16px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif}
.asc-top{display:flex;align-items:center;gap:8px;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;background:linear-gradient(#000a,#0000);position:absolute;left:0;right:0;top:0;z-index:2}
.asc-top h2{flex:1;margin:0;text-align:center;font-size:17px;font-weight:600}
.asc-btn{min-height:44px;min-width:44px;padding:0 14px;border:0;border-radius:22px;background:#ffffff26;color:#fff;font:inherit;font-weight:600;cursor:pointer;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.asc-btn[aria-pressed=true]{background:#fff;color:#000}
.asc-btn[hidden]{display:none}
.asc video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.asc-frame{position:absolute;left:50%;top:42%;width:min(78vw,380px);height:min(42vw,200px);transform:translate(-50%,-50%);border-radius:18px;box-shadow:0 0 0 100vmax #0006;border:2px solid #fffc;pointer-events:none;transition:border-color .15s}
.asc-frame.ok{border-color:#34c759}
.asc-msg{position:absolute;left:16px;right:16px;top:42%;transform:translateY(calc(min(21vw,100px) + 18px));text-align:center;font-size:15px;color:#fffd;pointer-events:none}
.asc-last{position:absolute;left:16px;right:16px;bottom:calc(150px + env(safe-area-inset-bottom));text-align:center;pointer-events:none}
.asc-last span{display:inline-block;max-width:100%;padding:10px 16px;border-radius:16px;background:#000b;font-weight:600;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.asc-last span.bad{background:#ff3b30d9}
.asc-bot{position:absolute;left:0;right:0;bottom:0;padding:14px 14px calc(14px + env(safe-area-inset-bottom));background:linear-gradient(#0000,#000c);z-index:2;display:grid;gap:10px}
.asc-row{display:flex;gap:8px}
.asc-in{flex:1;min-height:48px;padding:0 16px;border:0;border-radius:14px;background:#ffffff2e;color:#fff;font:inherit;outline:none}
.asc-in::placeholder{color:#fff9}
.asc-in:focus{background:#ffffff42}
.asc-blocked{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px;text-align:center;background:#111}
.asc-blocked p{margin:0;max-width:22em;color:#fffc}
@media(prefers-reduced-motion:reduce){.asc-frame{transition:none}}`;
    document.head.append(s);
  };
  // The beep. The audio context is made (and woken) inside the first tap, because iPhone and Chrome keep audio silent until a tap has
  // happened; a context first made later by the camera loop stayed suspended and played nothing. ok = one clear beep, not ok = low double.
  let audio = null;
  const wake = () => {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) { /* no audio */ }
  };
  const tone = (at, hz, len, vol) => {
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + at;
    o.type = 'square'; o.frequency.value = hz; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len); o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + len + 0.02);
  };
  const beep = (ok) => {
    try { wake(); if (ok === false) { tone(0, 220, 0.16, 0.25); tone(0.2, 180, 0.22, 0.25); } else { tone(0, 1800, 0.12, 0.3); } } catch (e) { /* silent is fine */ }
    try { navigator.vibrate && navigator.vibrate(ok === false ? [60, 40, 60] : 30); } catch (e) { /* not on iPhone */ }
  };

  // ---------- decoding ----------
  let zxingP = null;
  const loadZXing = () => zxingP || (zxingP = new Promise((res, rej) => {
    if (root.ZXing) return res(root.ZXing);
    const s = document.createElement('script'); s.src = '/vendor/zxing/index.min.js'; s.onload = () => res(root.ZXing); s.onerror = () => { zxingP = null; rej(new Error('Could not load the scanner')); }; document.head.append(s);
  }));
  let zxReader = null;
  function zxingDecode(ZX, imgData) {
    if (!zxReader) {
      const hints = new Map();
      hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E, ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.CODE_39, ZX.BarcodeFormat.ITF, ZX.BarcodeFormat.QR_CODE, ZX.BarcodeFormat.CODABAR]);
      hints.set(ZX.DecodeHintType.TRY_HARDER, true);
      zxReader = new ZX.MultiFormatReader(); zxReader.setHints(hints);
    }
    const { data, width, height } = imgData, lum = new Uint8ClampedArray(width * height);
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (data[j] * 306 + data[j + 1] * 601 + data[j + 2] * 117) >> 10;
    const bmp = new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.RGBLuminanceSource(lum, width, height)));
    try { return zxReader.decode(bmp).getText(); } catch (e) { return null; }     // NotFoundException = no barcode in this frame
  }

  // ---------- the scanner ----------
  function open(opts) {
    opts = opts || {};
    wake();
    injectCss();
    let stream = null, track = null, raf = 0, timer = 0, closed = false, paused = false, detector = null, zx = null;
    let lastCode = '', lastAt = 0, lastAny = 0, torchOn = false, busy = false;
    const video = el('video', { playsinline: true, muted: true, autoplay: true, 'aria-hidden': 'true' });
    video.muted = true;
    const frame = el('div', { class: 'asc-frame' });
    const msg = el('div', { class: 'asc-msg', role: 'status' }, 'Point the camera at a barcode');
    const lastEl = el('div', { class: 'asc-last', 'aria-live': 'polite' });
    const torchBtn = el('button', { type: 'button', class: 'asc-btn', hidden: true, 'aria-pressed': 'false', 'aria-label': 'Torch', onclick: () => setTorch(!torchOn) }, 'Torch');
    const doneBtn = el('button', { type: 'button', class: 'asc-btn', onclick: () => close() }, opts.doneLabel || 'Done');
    const manual = el('input', { class: 'asc-in', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', placeholder: 'Type or scan a code', 'aria-label': 'Barcode' });
    const addBtn = el('button', { type: 'button', class: 'asc-btn', onclick: () => submitManual() }, 'Add');
    const root_ = el('div', { class: 'asc', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Scan barcode' },
      video, frame, msg, lastEl,
      el('div', { class: 'asc-top' }, doneBtn, el('h2', null, opts.title || 'Scan'), torchBtn),
      el('div', { class: 'asc-bot' }, opts.footer || null, el('div', { class: 'asc-row' }, manual, addBtn)));
    document.body.append(root_);
    const prevOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden';

    const ctl = {
      close, pause() { paused = true; }, resume() { paused = false; },
      show(text, bad) { lastEl.replaceChildren(text ? el('span', { class: bad ? 'bad' : '' }, text) : ''); },
      get el() { return root_; },
    };

    function accept(code, from) {
      code = String(code || '').trim(); if (!code || closed || paused) return;
      const now = Date.now();
      if (from === 'camera') {
        if (code === lastCode && now - lastAt < REPEAT_MS) { lastAt = now; return; }      // same barcode still in view
        if (now - lastAny < GAP_MS) return;
      }
      lastCode = code; lastAt = lastAny = now;
      frame.classList.add('ok'); setTimeout(() => frame.classList.remove('ok'), 350);
      beep(true);                                           // the beep is the scan acknowledgement: it sounds the instant a code is read, not after anything is saved
      let out; try { out = opts.onCode && opts.onCode(code, ctl, from); } catch (e) { ctl.show(e.message || 'Could not use that code', true); beep(false); return; }
      Promise.resolve(out).then((t) => { if (t && typeof t === 'object') { ctl.show(t.text, t.bad); if (t.bad) beep(false); } else if (t) ctl.show(t); }, (e) => { ctl.show(e.message || 'Could not use that code', true); beep(false); });
    }
    function submitManual() { const v = manual.value.trim(); if (!v) return; manual.value = ''; accept(v, 'manual'); manual.focus(); }
    manual.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitManual(); } });
    // a hardware scanner types into the focused field and presses Enter, which the field above already handles; if focus is elsewhere
    // (the camera view has none) capture the burst of characters ourselves
    let buf = '', bufAt = 0;
    const onKey = (e) => {
      if (closed || e.target === manual || e.metaKey || e.ctrlKey || e.altKey) return;
      const now = Date.now(); if (now - bufAt > 80) buf = ''; bufAt = now;
      if (e.key === 'Enter') { if (buf.length >= 4) { const c = buf; buf = ''; e.preventDefault(); accept(c, 'wedge'); } buf = ''; }
      else if (e.key.length === 1) buf += e.key;
      else if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey, true);

    async function setTorch(on) {
      try { await track.applyConstraints({ advanced: [{ torch: on }] }); torchOn = on; torchBtn.setAttribute('aria-pressed', String(on)); } catch (e) { torchBtn.hidden = true; }
    }
    function blocked(title, text) {
      msg.remove(); frame.remove();
      root_.append(el('div', { class: 'asc-blocked' }, el('h3', { style: { margin: 0, fontSize: '20px' } }, title), el('p', null, text), el('p', null, 'You can still type or scan a code with the box below.')));
    }

    async function start() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return blocked('Camera not available', 'This browser cannot open the camera here. Use Safari or Chrome over a secure (https) address.');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) {
        const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
        return blocked(denied ? 'Camera is blocked' : 'No camera found', denied ? 'Allow camera access for this site: on iPhone open Settings > Safari > Camera, on Android tap the lock icon in the address bar > Permissions. Then reopen this screen.' : 'This device has no usable camera.');
      }
      if (closed) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream; track = stream.getVideoTracks()[0];
      try { const caps = track.getCapabilities ? track.getCapabilities() : {}; if (caps.torch) torchBtn.hidden = false; if (caps.focusMode && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}); } catch (e) { /* optional */ }
      try { await video.play(); } catch (e) { /* autoplay can be refused until a tap; the loop below waits for frames */ }
      // prefer the browser's own detector
      try {
        if ('BarcodeDetector' in root) {
          const have = await root.BarcodeDetector.getSupportedFormats();
          const use = FORMATS.filter((f) => have.includes(f));
          if (use.length >= 3) detector = new root.BarcodeDetector({ formats: use });
        }
      } catch (e) { detector = null; }
      if (!detector) { try { zx = await loadZXing(); } catch (e) { return blocked('Scanner could not load', 'Check your connection and try again.'); } }
      loop();
    }
    const canvas = document.createElement('canvas'), ctx2 = canvas.getContext('2d', { willReadFrequently: true });
    function loop() {
      if (closed) return;
      if (detector) { raf = requestAnimationFrame(async function tick() {
        if (closed) return;
        if (!paused && !busy && video.readyState >= 2) { busy = true; try { const r = await detector.detect(video); if (r && r[0] && r[0].rawValue) accept(r[0].rawValue, 'camera'); } catch (e) { /* frame not ready */ } busy = false; }
        timer = setTimeout(() => { raf = requestAnimationFrame(tick); }, 90);
      }); return; }
      const step = () => {
        if (closed) return;
        if (!paused && video.readyState >= 2 && video.videoWidth) {
          // decode the middle of the picture, scaled down: faster and the barcode sits in the frame box anyway
          const vw = video.videoWidth, vh = video.videoHeight, cw = Math.min(vw, 960), ch = Math.round(cw * (vh / vw));
          canvas.width = cw; canvas.height = ch; ctx2.drawImage(video, 0, 0, cw, ch);
          const code = zxingDecode(zx, ctx2.getImageData(0, 0, cw, ch)); if (code) accept(code, 'camera');
        }
        timer = setTimeout(step, 140);
      };
      step();
    }

    function close() {
      if (closed) return; closed = true;
      cancelAnimationFrame(raf); clearTimeout(timer);
      try { stream && stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* already stopped */ }
      document.removeEventListener('keydown', onKey, true);
      document.documentElement.style.overflow = prevOverflow;
      root_.remove(); opts.onClose && opts.onClose();
    }
    start();
    return ctl;
  }

  // 12-digit UPC-A and the same code as 13-digit EAN-13 with a leading 0 are the same product
  const variants = (code) => { const c = String(code || '').trim(), v = [c]; if (/^\d{12}$/.test(c)) v.push('0' + c); if (/^0\d{12}$/.test(c)) v.push(c.slice(1)); return v; };
  ['pointerdown', 'keydown', 'touchend'].forEach((ev) => addEventListener(ev, wake, { once: true, passive: true }));     // a typed or Bluetooth scan can beep too
  root.auzScanner = { open, variants, beep, _decode: async (imgData) => zxingDecode(await loadZXing(), imgData) };
})(window);
