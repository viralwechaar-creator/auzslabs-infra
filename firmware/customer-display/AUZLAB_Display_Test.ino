/*
 * AUZSLAB Customer Display V1
 * Board: Waveshare ESP32-S3-LCD-2.8 (NON-TOUCH), SKU 30223.
 * LVGL 8.3.x, 240x320 ST7789.
 *
 * USB CDC protocol (115200 baud):
 *   IDLE\n
 *   PAY|850.00|29|<packed QR bits as hex>\n
 *
 * QR bitmap comes from the host, never from an untrusted device amount.
 * No live payment status is inferred by this firmware.
 */
#include "Display_ST7789.h"
#include "Audio_PCM5101.h"
#include "RTC_PCF85063.h"
#include "Gyro_QMI8658.h"
#include "LVGL_Driver.h"
#include "PWR_Key.h"
#include "SD_Card.h"
#include "LVGL_Example.h"
#include "BAT_Driver.h"
#include "Wireless.h"
#include "Simulated_Gesture.h"
#include "AUZSLAB_Logo.h"

static constexpr uint16_t QR_CANVAS = 176;
static lv_color_t qrPixels[QR_CANVAS * QR_CANVAS];
static lv_obj_t *qrCanvas = nullptr;
static lv_obj_t *amountLabel = nullptr;
static String usbLine;

static void showLogo(lv_obj_t *parent, int y, uint16_t zoom = 256) {
  lv_obj_t *logo = lv_img_create(parent);
  lv_img_set_src(logo, &auzLogoDescriptor);
  lv_img_set_zoom(logo, zoom); // 256 = natural size; 128 = half size
  lv_obj_align(logo, LV_ALIGN_TOP_MID, 0, y);
}

static lv_obj_t *makeLabel(lv_obj_t *parent, const char *text,
                           lv_color_t color, int y) {
  lv_obj_t *obj = lv_label_create(parent);
  lv_label_set_text(obj, text);
  lv_obj_set_style_text_color(obj, color, 0);
  lv_obj_align(obj, LV_ALIGN_TOP_MID, 0, y);
  return obj;
}

static lv_obj_t *resetScreen() {
  lv_obj_t *scr = lv_scr_act();
  lv_obj_clean(scr);
  lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(scr, lv_color_white(), 0);
  lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);
  qrCanvas = nullptr;
  amountLabel = nullptr;
  return scr;
}

static void showIdle() {
  lv_obj_t *scr = resetScreen();
  showLogo(scr, 115);
  makeLabel(scr, "CUSTOMER DISPLAY", lv_color_hex(0x3D536D), 231);
}

static void showPaymentLayout(const char *amount) {
  lv_obj_t *scr = resetScreen();
  showLogo(scr, 5, 128);
  makeLabel(scr, "SCAN TO PAY", lv_color_hex(0x1C3859), 48);

  qrCanvas = lv_canvas_create(scr);
  lv_canvas_set_buffer(qrCanvas, qrPixels, QR_CANVAS, QR_CANVAS,
                       LV_IMG_CF_TRUE_COLOR);
  lv_obj_align(qrCanvas, LV_ALIGN_TOP_MID, 0, 75);

  amountLabel = makeLabel(scr, "", lv_color_hex(0x10223D), 262);
  // LVGL's compiled-in default fonts do not always include the rupee symbol.
  lv_label_set_text_fmt(amountLabel, "INR %s", amount);
  lv_obj_align(amountLabel, LV_ALIGN_TOP_MID, 0, 262);
  makeLabel(scr, "Powered by AUZSLAB", lv_color_hex(0x6A7A8C), 298);
}

// Input bitmap: row-major 1-bit data, high bit first, no quiet zone.
// QR modules are drawn at 3x3 pixels, with four white modules on every side.
static bool showQRCode(const char *hex, unsigned n) {
  if (!qrCanvas || n < 21 || n > 45 || ((n - 21) % 4) != 0) return false;
  size_t bits = (size_t)n * n;
  size_t byteCount = (bits + 7) / 8;
  if (strlen(hex) != byteCount * 2) return false;
  static uint8_t bitsBuf[(45 * 45 + 7) / 8];

  auto digit = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  for (size_t i = 0; i < byteCount; ++i) {
    int a = digit(hex[2 * i]), b = digit(hex[2 * i + 1]);
    if (a < 0 || b < 0) return false;
    bitsBuf[i] = (uint8_t)((a << 4) | b);
  }
  const lv_color_t white = lv_color_white();
  const lv_color_t black = lv_color_black();
  for (size_t i = 0; i < QR_CANVAS * QR_CANVAS; ++i) qrPixels[i] = white;

  const unsigned px = 3;
  const unsigned all = (n + 8) * px;
  const unsigned offset = (QR_CANVAS - all) / 2;
  for (unsigned y = 0; y < n; ++y) {
    for (unsigned x = 0; x < n; ++x) {
      size_t bitIndex = (size_t)y * n + x;
      bool dark = (bitsBuf[bitIndex / 8] & (0x80 >> (bitIndex % 8))) != 0;
      if (!dark) continue;
      unsigned xp = offset + (x + 4) * px, yp = offset + (y + 4) * px;
      for (unsigned dy = 0; dy < px; ++dy)
        for (unsigned dx = 0; dx < px; ++dx)
          qrPixels[(yp + dy) * QR_CANVAS + xp + dx] = black;
    }
  }
  lv_obj_invalidate(qrCanvas);
  return true;
}

static bool validAmount(const String &s) {
  if (s.isEmpty() || s.length() > 12) return false;
  bool dot = false; unsigned decimals = 0;
  for (unsigned i = 0; i < s.length(); ++i) {
    char c = s[i];
    if (c == '.') {
      if (dot || i == 0) return false;
      dot = true;
    } else if (c >= '0' && c <= '9') {
      if (dot) ++decimals;
    } else return false;
  }
  return decimals <= 2 && s[s.length() - 1] != '.';
}

static void handleCommand(const String &line) {
  if (line == "IDLE" || line == "CLEAR") {
    showIdle(); Serial.println("OK|IDLE"); return;
  }
  if (!line.startsWith("PAY|")) {
    Serial.println("ERR|UNKNOWN_COMMAND"); return;
  }
  int sep1 = line.indexOf('|', 4);
  if (sep1 < 0) { Serial.println("ERR|FORMAT"); return; }
  int sep2 = line.indexOf('|', sep1 + 1);
  if (sep2 < 0) { Serial.println("ERR|FORMAT"); return; }
  String amount = line.substring(4, sep1);
  String sizeText = line.substring(sep1 + 1, sep2);
  String bitsText = line.substring(sep2 + 1);
  if (!validAmount(amount) || sizeText.isEmpty() || sizeText.length() > 2) {
    Serial.println("ERR|AMOUNT_OR_SIZE"); return;
  }
  for (unsigned i = 0; i < sizeText.length(); ++i)
    if (sizeText[i] < '0' || sizeText[i] > '9') {
      Serial.println("ERR|SIZE"); return;
    }
  unsigned n = sizeText.toInt();
  if (n < 21 || n > 45 || (n - 21) % 4 || bitsText.length() != ((n * n + 7) / 8) * 2) {
    Serial.println("ERR|QR_SIZE"); return;
  }
  // Build the UI only for structurally valid requests.
  showPaymentLayout(amount.c_str());
  if (!showQRCode(bitsText.c_str(), n)) {
    showIdle(); Serial.println("ERR|QR_DATA"); return;
  }
  Serial.println("OK|PAY");
}

void setup() {
  // USB CDC On Boot must be enabled in Arduino Tools.
  Serial.begin(115200);
  Flash_test();
  Button_Init();
  PWR_Init();
  BAT_Init();
  I2C_Init();
  PCF85063_Init();
  QMI8658_Init();
  Backlight_Init();
  SD_Init();
  Audio_Init();
  LCD_Init();
  Lvgl_Init();
  buildAuzLogo();
  showIdle();
  usbLine.reserve(1200);
  Serial.println("AUZSLAB|READY|V1");
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      usbLine.trim();
      if (usbLine.length()) handleCommand(usbLine);
      usbLine = "";
    } else if (c != '\r') {
      if (usbLine.length() >= 1199) {
        usbLine = "";
        Serial.println("ERR|LINE_TOO_LONG");
      } else usbLine += c;
    }
  }
  Lvgl_Loop();
  delay(5);
}
