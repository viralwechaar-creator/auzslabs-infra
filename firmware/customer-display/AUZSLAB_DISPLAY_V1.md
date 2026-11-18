# AUZSLAB Customer Display — V1 prototype

Target hardware: **Waveshare ESP32-S3-LCD-2.8 NON-TOUCH (SKU 30223)**, 240x320 ST7789, Arduino ESP32 board package and **LVGL 8.3.x**.

## Screen layouts
- **Idle:** actual black pixel AUZSLAB logo, centered on white, "CUSTOMER DISPLAY" below.
- **Payment:** small AUZSLAB logo at top, "SCAN TO PAY", QR code in the center, amount in INR at bottom, "Powered by AUZSLAB" footer.
- The display has **no payment processing** and **does not know if someone has paid**. The POS/backend must verify each payment independently.

## Source files
- `AUZLAB_Display_Test.ino` — firmware, USB line protocol, LVGL rendering.
- `AUZSLAB_Logo.h` — LVGL indexed 1-bit logo data recovered from the approved artwork. The old `auzlab_logo.c` is empty and is intentionally not used.
- `usb_display_test.py` — Windows test sender, generates valid QR module bitmap from provided data.
- Other `.cpp`/`.h` files are the manufacturer's drivers and were **not modified**.

## Arduino setup (before uploading)
1. Keep backup of the currently working firmware/project.
2. Open the existing `AUZLAB_Display_Test.ino` with all other manufacturer source files in the same folder. Arduino sketch folder may need to be named `AUZLAB_Display_Test` (matching the `.ino` basename).
3. Choose **ESP32S3 Dev Module**, previously **COM7** (check if Windows assigned a different port).
4. **Flash Size: 16 MB**; **PSRAM: OPI PSRAM**; **USB CDC On Boot: Enabled**; choose the previously verified **3 MB+ APP partition**.
5. Use the same working board libraries and versions used for the manufacturer's LVGL example (LVGL 8.3.10).
6. Click **Verify** first. Only after success, click **Upload**.
7. Physical hardware compilation/upload is **not tested** by the author of this commit. If compilation fails, capture the first error message.

## Windows command-line test
Install Python 3 and required libraries:

```powershell
py -m pip install pyserial qrcode
```

With Arduino Serial Monitor closed:

```powershell
py usb_display_test.py --port COM7 idle
py usb_display_test.py --port COM7 pay --amount 850.00 --payload "https://example.com/test-order-123"
```

The test QR is a harmless URL, **not a UPI payment request**. Scan using a normal phone camera/QR reader.

## Serial protocol

Baud **115200**, ASCII commands with newline terminator. Send only from the POS-controlled trusted USB port.

- `IDLE\n` or `CLEAR\n` -> full logo.
- `PAY|850.00|29|HEX...\n` -> amount and QR matrix. Actual matrix size may be 21,25,29,...45.
- Acknowledgements: `OK|IDLE`, `OK|PAY` or `ERR|...`.

The `HEX` field is packed QR matrix bits in row-major order, most significant bit first in each byte, no quiet zone included. The ESP32 adds the required 4-module white quiet border and draws 3 pixels per module.

This protocol sends **QR module bitmap** rather than arbitrary QR payload text. The **Windows host creates the QR matrix** with `qrcode`; the display only renders it. This supports legitimate provider-generated UPI payloads and avoids putting payment gateway secrets on the display.

Payload capacity is bounded to QR version 7 (45x45) to preserve comfortable scanning on the 2.8-inch screen. For longer payment payloads, use a supported short payment link from the payment provider or redesign the layout.

## Production integration, not implemented
- Generate order-specific **provider-approved payment QR** for the correct amount and payee.
- Ensure the backend validates the order, gateway status, and amount before marking an invoice paid.
- Implement QR expiration, clearing on cancel/disconnect, and prevent stale QR reuse.
- Consider device authentication and confirmation of serial connection, multiple displays, reconnection handling.
- Optimize font support for the INR rupee symbol if required; V1 displays the safe `INR` prefix.
