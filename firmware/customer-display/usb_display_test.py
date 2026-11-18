"""Send an AUZSLAB logo/QR screen to Waveshare ESP32-S3 over USB.
Test only. Live UPI QR payload must come from a verified payment provider.
Dependencies: python -m pip install pyserial qrcode
Examples:
  python usb_display_test.py --port COM7 idle
  python usb_display_test.py --port COM7 pay --amount 850.00 --payload https://example.com/test-order-123
"""
import argparse
import re
import time

import qrcode
import serial

MAX_QR_SIZE = 45  # QR version <= 7, 3px modules + 4-module border on screen


def qr_wire(payload: str) -> tuple[int, str]:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=1,
        border=0,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    n = len(matrix)
    if n > MAX_QR_SIZE:
        raise ValueError(
            f"QR is {n}x{n}; maximum is {MAX_QR_SIZE}x{MAX_QR_SIZE}. "
            "Use a shorter provider-approved QR payload or payment link."
        )
    out = bytearray((n * n + 7) // 8)
    for y, row in enumerate(matrix):
        for x, on in enumerate(row):
            if on:
                ix = y * n + x
                out[ix // 8] |= 0x80 >> (ix % 8)
    return n, out.hex()


def main() -> None:
    parser = argparse.ArgumentParser(description="AUZSLAB ESP32-S3 USB display test")
    parser.add_argument("--port", required=True, help="Windows COM port, e.g. COM7")
    args_sub = parser.add_subparsers(dest="action", required=True)
    args_sub.add_parser("idle", help="Show default full AUZSLAB logo")
    pay = args_sub.add_parser("pay", help="Show QR + amount (no payment verification)")
    pay.add_argument("--amount", required=True, help="Amount, e.g. 850.00")
    pay.add_argument("--payload", required=True, help="Exact QR string from provider")
    args = parser.parse_args()

    if args.action == "idle":
        command = "IDLE\n"
    else:
        if not re.fullmatch(r"[0-9]{1,10}(?:\.[0-9]{1,2})?", args.amount):
            parser.error("Amount must be decimal digits with up to 2 decimals")
        if not args.payload.strip():
            parser.error("QR payload cannot be blank")
        size, packed = qr_wire(args.payload)
        command = f"PAY|{args.amount}|{size}|{packed}\n"

    with serial.Serial(args.port, baudrate=115200, timeout=0.4, write_timeout=5) as dev:
        # Opening a CDC port may reset the board on some Windows drivers.
        time.sleep(1.5)
        dev.reset_input_buffer()
        dev.write(command.encode("ascii"))
        dev.flush()
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            response = dev.readline().decode("ascii", errors="replace").strip()
            if not response:
                continue
            print("Display response:", response)
            if response.startswith("OK|"):
                return
            if response.startswith("ERR|"):
                raise SystemExit(f"Display rejected command: {response}")
        raise SystemExit("No acknowledgement. Confirm USB CDC On Boot is Enabled, and close Serial Monitor.")


if __name__ == "__main__":
    main()
