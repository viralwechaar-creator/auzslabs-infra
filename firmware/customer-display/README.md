# AUZsStyle customer display firmware (Waveshare ESP32-S3-LCD-2.8)

Flash this once onto a **Waveshare ESP32-S3-LCD-2.8, non-touch, SKU 30223** (240x320 ST7789,
LVGL 8.3.x) and plug it into the till's computer over USB — AUZsStyle talks to it directly
from the browser via the Web Serial API from then on (`app/public/style/usbdisplay.js`), no
server round trip, no re-flashing per bill. **Billing never uses WiFi at all** — it's always
this USB link. WiFi (optional) is only so the device can fetch its *own future firmware
updates* automatically — see "Over-the-air updates" below — so flashing it manually is a
one-time thing, not something that recurs every time the screen's look or behavior changes.

- `AUZLAB_Display_Test.ino` — the sketch. Listens on USB serial (115200 baud) for `IDLE\n`,
  `PAY|<amount>|<n>|<hex bits>\n`, `PAID|<amount>\n` or `FAILED\n` and draws the idle, payment,
  payment-received or payment-failed screen with LVGL.
- `AUZSLAB_Logo.h` — the idle-screen logo (LVGL indexed bitmap).
- `Display_ST7789.*`, `LVGL_Driver.*`, `I2C_Driver.*`, `Gyro_QMI8658.*`, `RTC_PCF85063.*`,
  `BAT_Driver.*`, `PWR_Key.*`, `Button_Driver.*`, `SD_Card.*`, `Audio_PCM5101.*`,
  `LVGL_Music.*`, `LVGL_Example.*`, `Simulated_Gesture.*`, `Wireless.*`, `auzlab_logo.c` —
  Waveshare's own board support files, unmodified. Keep them in the same sketch folder.
- `usb_display_test.py` — a standalone Python test sender (not used by AUZsStyle itself; keep
  it for bench-testing the board on its own, outside the browser).
- `AUZSLAB_DISPLAY_V1.md` — the original build notes (Arduino IDE settings, protocol details).

## Flashing a brand-new board (one-time, browser-based -- no Arduino IDE upload step)

The owner explicitly doesn't want Arduino IDE involved in actually putting firmware onto a
board, including the very first time. Here's the version of that story that's actually true:
**compiling** this sketch into a `.bin` still needs a real C++ toolchain (Arduino IDE, in
practice), but **uploading** that `.bin` onto the chip over USB does not -- it can be done
entirely from a browser page, same as everything else in this project.

1. Someone (anyone, once, per firmware version) opens `AUZLAB_Display_Test.ino` in Arduino
   IDE with every other file in this folder in the same sketch directory (the folder itself
   may need to be named `AUZLAB_Display_Test` to match the `.ino` basename), sets: Board
   **ESP32S3 Dev Module**, **Flash Size 16 MB**, **PSRAM: OPI PSRAM**, **USB CDC On Boot:
   Enabled** (the same partition scheme used for Waveshare's own LVGL demo, 3 MB+ app
   partition), LVGL library **8.3.10** -- then **Sketch -> Export Compiled Binary** (not
   Upload). This produces several files next to the sketch; the one that matters here is the
   one ending in **`.merged.bin`** (bootloader + partition table + app combined into one
   image flashable at offset 0, which recent Arduino-ESP32 core versions export
   automatically). If there's no `.merged.bin`, update the "esp32" board package in Boards
   Manager to a current version.
2. Anyone, from then on, with just a Chrome/Edge browser and that one `.merged.bin` file:
   open `https://auzslab.in/flash-display.html`, plug the (blank or already-flashed) board
   in over USB, pick the file, press Flash. This page uses
   [`esptool-js`](https://github.com/espressif/esptool-js) (Espressif's own official,
   Apache-2.0 browser port of `esptool`, vendored at `app/public/vendor/esptool-js.bundle.js`)
   over the Web Serial API -- the exact same browser requirement as everything else here
   (Chrome/Edge, desktop or Android; never Safari/Firefox/iOS). No Python, no Arduino IDE,
   nothing installed, for this step.
3. After flashing, press the board's own RESET button (or unplug/replug the USB cable).

**This is the one step that will never fully disappear**: turning C++ source into a `.bin`
needs a real compiler, and nothing in this repo runs one automatically yet (a CI job that
compiles on every push to this folder is a real option, just not built). Everything *after*
that compile -- flashing a blank board, and updating an already-flashed one -- needs no
software outside a browser, ever again.

## Protocol (what `app/public/style/usbdisplay.js` actually sends)

115200 baud, ASCII, newline-terminated:

- `IDLE\n` → full logo screen. Sent whenever there's no bill-in-progress QR to show.
- `PAY|<amount>|<n>|<hex>\n` → amount + an `n`×`n` QR matrix. `n` is 21, 25, 29, ... up to 45
  (QR versions 1–7 — kept small enough to read comfortably on a 2.8" screen). `<hex>` is the
  matrix packed 1 bit per module, row-major, most-significant-bit first, **no quiet zone**
  (the firmware draws its own border; the per-module pixel size is worked out from `n` so the
  QR always fills as much of the 200x200 on-screen canvas as it can, not a fixed small scale).
- `PAID|<amount>\n` → a green checkmark badge bounces in, plus the amount. Sent only on the
  cashier's own explicit "Payment received" tap -- never inferred from anything.
- `FAILED\n` → a red cross badge shakes. Sent only when the cashier backs out of the QR screen
  (Change payment / closes it) without having confirmed Payment received.
- `WIFI|<ssid>|<password>\n` → saves WiFi credentials to flash (NVS) and tries to connect.
  Only used for OTA updates below, never for billing. Settings -> Customer-facing screen in
  AUZsStyle sends this; there's no reason to ever type it into Arduino IDE.
- `STATUS\n` → replies `OK|STATUS|<0 or 1 connected>|<ip or ->|<firmware version>`.
- The firmware replies `OK|...` or `ERR|...` on its own line for every command above (a
  WiFi/OTA status line is prefixed `OTA|` instead, so it's never mistaken for a billing
  response). `usbdisplay.js` only uses `ERR|` for a toast — a serial hiccup never blocks a sale.

The QR payload is always the shop's own real UPI deep link (`upi://pay?pa=...`), the exact
same one already shown as an in-app QR to the cashier (`p-sell.js`'s `paySheet`/`openQr`) —
the display only renders pixels; it never decides what to charge or knows whether anyone
actually paid. There is no "payment received" screen on this hardware yet: a completed or
cancelled sale just sends `IDLE` again.

## Over-the-air updates (so Arduino IDE is a one-time thing, not a recurring one)

Once a board is running firmware V2 or later, **it can update itself** without ever being
plugged into a computer running Arduino IDE again — it checks `auzslab.in/ota/customer-display/latest.json`
over WiFi (shortly after boot, then every 6 hours) and, if that file's `version` is higher
than its own, downloads and flashes the `.bin` it points to, then reboots on its own.

**To ship a future firmware change** (edit this sketch, then):
1. Bump `FW_VERSION` in `AUZLAB_Display_Test.ino`.
2. In Arduino IDE: **Sketch -> Export Compiled Binary** (needs the same board/settings as a
   normal flash, below). This produces several files; OTA needs a **different one** from the
   `.merged.bin` used for a first-time flash via `flash-display.html` -- use the plain app
   binary, the one named `<sketch>.ino.bin` (no "bootloader"/"partitions"/"merged" in the
   name). **Do not put the merged image here**: `Update.h` (the OTA library) writes straight
   into the device's existing app partition and expects only app code at that offset --
   feeding it a merged bootloader+partition-table+app image would corrupt the device, since
   a bootloader/partition-table doesn't belong inside an app partition.
3. Copy that plain app `.bin` to `site/ota/customer-display/latest.bin` in this repo
   (overwriting the previous one — only the newest is ever kept; devices never roll back).
4. Edit `site/ota/customer-display/latest.json` to the same new version number (the `bin`
   path inside it never needs to change). Commit, push, `git pull` on the VPS as usual — it's
   a plain static file under `site/`, so nothing else needs restarting.
5. Every paired screen on the shop's WiFi picks it up within 6 hours (or immediately, if it's
   power-cycled, since the first check is ~15s after boot).

**This still needs Arduino IDE once per firmware change** (step 2 — compiling C++ for this
chip isn't something that happens outside a toolchain like that), but it's the *only* step
that does: uploading, for a first-time flash or any later one, never needs Arduino IDE again
(see "Flashing a brand-new board" above and the OTA mechanism itself). If the compile step
itself should become fully automatic too (e.g. a CI job that compiles on every push to this
folder and publishes both the `.merged.bin` and the OTA `.bin` on its own), that's a real but
separate piece of work, not built yet.

**Known limits, flagged honestly (V2, not yet verified on real hardware by the author of this
change — the earlier V1 firmware's own note about this still applies):**
- The OTA/WiFi code (`WiFi.h`/`WiFiClientSecure.h`/`HTTPClient.h`/`HTTPUpdate.h`/`Preferences.h`
  additions, the `WIFI`/`STATUS` serial commands, `checkOta()`) has not been compiled or run
  on the actual board. Verify it compiles and connects before relying on it; capture the
  first error if it doesn't.
- `client.setInsecure()` is used for the HTTPS connection to `auzslab.in` — there is no
  certificate pinning. This is the standard, common ESP32-OTA trade-off (getting an embedded
  root CA chain exactly right is its own frequent source of failures), not an oversight, but
  it means the integrity of an update rests on auzslab.in itself and on nobody else being able
  to put a file at that path — not on TLS certificate validation.
- WiFi credentials are stored in plaintext in the ESP32's NVS flash (via `Preferences`) —
  normal for this class of device, but worth knowing if the board is ever physically handed
  to someone outside the shop.
- `app/public/flash-display.html` (the browser-based first-flash page) is built on
  Espressif's own official `esptool-js` demo shape (connect, `loader.main()`, `writeFlash`
  with `flashSize/flashMode/flashFreq: 'keep'`) and loads without error in a real browser,
  but the actual USB flash of a real chip has **not** been exercised here — there's no ESP32
  hardware attached to this environment to test against. If it fails partway through writing,
  the board is not necessarily bricked (the bootloader it's flashing over is itself part of
  the same merged image, so a clean retry from this same page should recover it), but this
  has not been verified either — report back the exact error message if Flash fails.
