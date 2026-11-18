# AUZsStyle customer display firmware (Waveshare ESP32-S3-LCD-2.8)

Flash this once onto a **Waveshare ESP32-S3-LCD-2.8, non-touch, SKU 30223** (240x320 ST7789,
LVGL 8.3.x) and plug it into the till's computer over USB — AUZsStyle talks to it directly
from the browser via the Web Serial API from then on (`app/public/style/usbdisplay.js`), no
server, no WiFi, no re-flashing per bill.

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
  (the firmware draws its own 4-module white border and 3px-per-module scale).
- The firmware replies `OK|IDLE`, `OK|PAY`, or `ERR|...` on its own line. `usbdisplay.js` only
  uses this for a toast — a serial hiccup never blocks a sale.

The QR payload is always the shop's own real UPI deep link (`upi://pay?pa=...`), the exact
same one already shown as an in-app QR to the cashier (`p-sell.js`'s `paySheet`/`openQr`) —
the display only renders pixels; it never decides what to charge or knows whether anyone
actually paid. There is no "payment received" screen on this hardware yet (V1): a completed
or cancelled sale just sends `IDLE` again.
