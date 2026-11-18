# AUZsStyle customer display firmware (Waveshare ESP32-S3-LCD-2.8)

Flash this once onto a **Waveshare ESP32-S3-LCD-2.8, non-touch, SKU 30223** (240x320 ST7789,
LVGL 8.3.x) and plug it into the till's computer over USB — AUZsStyle talks to it directly
from the browser via the Web Serial API from then on (`app/public/style/usbdisplay.js`), no
server round trip, no re-flashing per bill. **Billing never uses WiFi at all** — it's always
this USB link. WiFi (optional) is only so the device can fetch its *own future firmware
updates* automatically — see "Over-the-air updates" below — so flashing it manually is a
one-time thing, not something that recurs every time the screen's look or behavior changes.

- `AUZLAB_Display_Test.ino` — the sketch. Listens on USB serial (115200 baud) for `IDLE\n` or
  `PAY|<amount>|<n>|<hex bits>\n` and draws the idle/payment screen with LVGL.
- `AUZSLAB_Logo.h` — the idle-screen logo (LVGL indexed bitmap).
- `Display_ST7789.*`, `LVGL_Driver.*`, `I2C_Driver.*`, `Gyro_QMI8658.*`, `RTC_PCF85063.*`,
  `BAT_Driver.*`, `PWR_Key.*`, `Button_Driver.*`, `SD_Card.*`, `Audio_PCM5101.*`,
  `LVGL_Music.*`, `LVGL_Example.*`, `Simulated_Gesture.*`, `Wireless.*`, `auzlab_logo.c` —
  Waveshare's own board support files, unmodified. Keep them in the same sketch folder.
- `usb_display_test.py` — a standalone Python test sender (not used by AUZsStyle itself; keep
  it for bench-testing the board on its own, outside the browser).
- `AUZSLAB_DISPLAY_V1.md` — the original build notes (Arduino IDE settings, protocol details).

## Flashing

1. Open `AUZLAB_Display_Test.ino` in Arduino IDE with every other file in this folder in the
   same sketch directory (the folder itself may need to be named `AUZLAB_Display_Test` to
   match the `.ino` basename).
2. Board: **ESP32S3 Dev Module**. Settings: **Flash Size 16 MB**, **PSRAM: OPI PSRAM**,
   **USB CDC On Boot: Enabled**, the same partition scheme used for Waveshare's own LVGL demo
   (3 MB+ app partition). LVGL library version **8.3.10**.
3. Verify, then Upload.

## Protocol (what `app/public/style/usbdisplay.js` actually sends)

115200 baud, ASCII, newline-terminated:

- `IDLE\n` → full logo screen. Sent whenever there's no bill-in-progress QR to show.
- `PAY|<amount>|<n>|<hex>\n` → amount + an `n`×`n` QR matrix. `n` is 21, 25, 29, ... up to 45
  (QR versions 1–7 — kept small enough to read comfortably on a 2.8" screen). `<hex>` is the
  matrix packed 1 bit per module, row-major, most-significant-bit first, **no quiet zone**
  (the firmware draws its own border; the per-module pixel size is worked out from `n` so the
  QR always fills as much of the 200x200 on-screen canvas as it can, not a fixed small scale).
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
   normal flash, below). This produces a `.bin` file next to the sketch.
3. Copy that `.bin` to `site/ota/customer-display/latest.bin` in this repo (overwriting the
   previous one — only the newest is ever kept; devices never roll back).
4. Edit `site/ota/customer-display/latest.json` to the same new version number (the `bin`
   path inside it never needs to change). Commit, push, `git pull` on the VPS as usual — it's
   a plain static file under `site/`, so nothing else needs restarting.
5. Every paired screen on the shop's WiFi picks it up within 6 hours (or immediately, if it's
   power-cycled, since the first check is ~15s after boot).

**This still needs Arduino IDE once per firmware change** (step 2 — compiling C++ for this
chip isn't something that happens outside a toolchain like that), but it's the *only* step
that does, and the device itself never needs a cable or a manual upload again after the
first flash. If that compile-and-copy step itself should become fully automatic too (e.g. a
CI job that compiles on every push to this folder), that's a real but separate piece of work,
not built yet.

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
