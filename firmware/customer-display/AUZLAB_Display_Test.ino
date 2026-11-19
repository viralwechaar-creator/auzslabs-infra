/*
 * AUZSLAB Customer Display V2
 * Board: Waveshare ESP32-S3-LCD-2.8 (NON-TOUCH), SKU 30223.
 * LVGL 8.3.x, 240x320 ST7789.
 *
 * USB CDC protocol (115200 baud) -- unchanged from V1, this is still how every bill's QR
 * actually reaches the screen, over the till's own USB cable, never WiFi:
 *   IDLE\n
 *   PAY|850.00|29|<packed QR bits as hex>\n
 *   PAID|850.00\n              (new in V3 -- green checkmark, bounces in)
 *   FAILED\n                   (new in V3 -- red cross, shakes)
 *   WIFI|<ssid>|<password>\n   (new in V2 -- see below)
 *   STATUS\n                   (new in V2 -- see below)
 *
 * QR bitmap comes from the host, never from an untrusted device amount.
 * PAID/FAILED are exactly as manual as the rest of this protocol: the app sends them only on
 * the cashier's own explicit tap (Payment received, or backing out of the QR screen) -- this
 * firmware still never infers a payment's outcome on its own.
 *
 * WiFi + OTA (new in V2): this is ONLY for pulling future firmware updates automatically,
 * so the owner never has to open Arduino IDE and plug a USB cable into the board again --
 * billing itself stays on the USB serial link above, completely unaffected by whether WiFi
 * is connected or not. WiFi credentials are set once, either by typing them into
 * Settings -> Customer-facing screen in the browser (sent over the same USB serial link as
 * a `WIFI|ssid|password\n` command -- no Arduino involved) or, if that's never done, left
 * unset and OTA simply never runs. See ota/README.md in this folder for how to ship an
 * update once this is flashed.
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
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <Preferences.h>

// Bump this on every firmware change that gets shipped through ota/latest.json --
// see ota/README.md. The device never downgrades (only updates when the server's
// version is strictly greater than this).
static constexpr uint16_t FW_VERSION = 3;
static constexpr const char *OTA_VERSION_URL = "https://auzslab.in/ota/customer-display/latest.json";
static constexpr unsigned long OTA_FIRST_CHECK_MS = 15000;       // give WiFi time to associate after boot
static constexpr unsigned long OTA_RECHECK_MS = 6UL * 60 * 60 * 1000; // then every 6 hours
static Preferences prefs;
static unsigned long nextOtaCheckAt = OTA_FIRST_CHECK_MS;

static constexpr uint16_t QR_CANVAS = 200;
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
  // No logo here (unlike the idle screen) -- every pixel of vertical room on a 240x320
  // panel goes to the QR itself, which is the only thing that matters on this screen.
  makeLabel(scr, "SCAN TO PAY", lv_color_hex(0x1C3859), 8);

  qrCanvas = lv_canvas_create(scr);
  lv_canvas_set_buffer(qrCanvas, qrPixels, QR_CANVAS, QR_CANVAS,
                       LV_IMG_CF_TRUE_COLOR);
  lv_obj_align(qrCanvas, LV_ALIGN_TOP_MID, 0, 34);

  amountLabel = makeLabel(scr, "", lv_color_hex(0x10223D), 244);
  // LVGL's compiled-in default fonts do not always include the rupee symbol.
  lv_label_set_text_fmt(amountLabel, "INR %s", amount);
  lv_obj_align(amountLabel, LV_ALIGN_TOP_MID, 0, 244);
  makeLabel(scr, "Powered by AUZSLAB", lv_color_hex(0x6A7A8C), 288);
}

// ---- Payment result screens (PAID / FAILED) -- a coloured badge that animates in, a short
// label, then nothing further happens here: the device just sits on this screen until the
// host's next command (usually IDLE once the cashier moves on). No auto-timeout on the
// device side, matching the rest of this firmware's "host drives every transition" design.
static void animExecY(void *obj, int32_t v) { lv_obj_set_y((lv_obj_t *)obj, v); }
static void animExecX(void *obj, int32_t v) { lv_obj_set_x((lv_obj_t *)obj, v); }

static lv_obj_t *makeBadge(lv_obj_t *parent, lv_color_t color, int y) {
  lv_obj_t *badge = lv_obj_create(parent);
  lv_obj_remove_style_all(badge);
  lv_obj_set_size(badge, 72, 72);
  lv_obj_set_style_radius(badge, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_color(badge, color, 0);
  lv_obj_set_style_bg_opa(badge, LV_OPA_COVER, 0);
  lv_obj_clear_flag(badge, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_align(badge, LV_ALIGN_TOP_MID, 0, y);
  return badge;
}
static lv_obj_t *badgeLine(lv_obj_t *badge, lv_point_t *pts, uint16_t n) {
  lv_obj_t *line = lv_line_create(badge);
  lv_line_set_points(line, pts, n);
  lv_obj_set_style_line_width(line, 6, 0);
  lv_obj_set_style_line_color(line, lv_color_white(), 0);
  lv_obj_set_style_line_rounded(line, true, 0);
  return line;
}

static void showPaid(const char *amount) {
  lv_obj_t *scr = resetScreen();
  static lv_point_t checkPts[3] = { { 16, 38 }, { 30, 52 }, { 56, 20 } };
  lv_obj_t *badge = makeBadge(scr, lv_color_hex(0x1F8A3D), 70);
  badgeLine(badge, checkPts, 3);
  lv_coord_t targetY = lv_obj_get_y(badge);
  lv_anim_t a; lv_anim_init(&a);
  lv_anim_set_var(&a, badge);
  lv_anim_set_exec_cb(&a, animExecY);
  lv_anim_set_values(&a, targetY - 50, targetY);
  lv_anim_set_time(&a, 420);
  lv_anim_set_path_cb(&a, lv_anim_path_overshoot);
  lv_anim_start(&a);
  makeLabel(scr, "PAYMENT RECEIVED", lv_color_hex(0x1F8A3D), 170);
  lv_obj_t *amt = makeLabel(scr, "", lv_color_hex(0x10223D), 202);
  lv_label_set_text_fmt(amt, "INR %s", amount);
  lv_obj_align(amt, LV_ALIGN_TOP_MID, 0, 202);
  makeLabel(scr, "Powered by AUZSLAB", lv_color_hex(0x6A7A8C), 288);
}

static void showFailed() {
  lv_obj_t *scr = resetScreen();
  static lv_point_t p1[2] = { { 20, 20 }, { 52, 52 } };
  static lv_point_t p2[2] = { { 52, 20 }, { 20, 52 } };
  lv_obj_t *badge = makeBadge(scr, lv_color_hex(0xD70015), 70);
  badgeLine(badge, p1, 2);
  badgeLine(badge, p2, 2);
  lv_coord_t baseX = lv_obj_get_x(badge);
  lv_anim_t a; lv_anim_init(&a);
  lv_anim_set_var(&a, badge);
  lv_anim_set_exec_cb(&a, animExecX);
  lv_anim_set_values(&a, baseX - 14, baseX + 14);
  lv_anim_set_time(&a, 90);
  lv_anim_set_playback_time(&a, 90);
  lv_anim_set_repeat_count(&a, 5);
  lv_anim_set_path_cb(&a, lv_anim_path_ease_in_out);
  lv_anim_start(&a);
  makeLabel(scr, "PAYMENT FAILED", lv_color_hex(0xD70015), 170);
  makeLabel(scr, "Please try again", lv_color_hex(0x3D536D), 202);
  makeLabel(scr, "Powered by AUZSLAB", lv_color_hex(0x6A7A8C), 288);
}

// Input bitmap: row-major 1-bit data, high bit first, no quiet zone. The module size (px)
// is not fixed -- it's worked out from how many modules this QR actually has (n), so a
// shorter UPI string (fewer modules) still draws as large as a longer one: both fill the
// same QR_CANVAS square, just with chunkier or finer squares.
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

  const unsigned quiet = 4;
  unsigned px = QR_CANVAS / (n + quiet * 2);
  if (px < 2) px = 2; // n=45 (the largest we accept) still gives px=3 on a 200px canvas; this floor only matters if QR_CANVAS is ever shrunk
  const unsigned all = (n + quiet * 2) * px;
  const unsigned offset = (QR_CANVAS - all) / 2;
  for (unsigned y = 0; y < n; ++y) {
    for (unsigned x = 0; x < n; ++x) {
      size_t bitIndex = (size_t)y * n + x;
      bool dark = (bitsBuf[bitIndex / 8] & (0x80 >> (bitIndex % 8))) != 0;
      if (!dark) continue;
      unsigned xp = offset + (x + quiet) * px, yp = offset + (y + quiet) * px;
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

// ---- WiFi (OTA only -- billing never touches this) ----
static void wifiConnectSaved() {
  String ssid = prefs.getString("ssid", ""), pass = prefs.getString("pass", "");
  if (ssid.isEmpty()) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());
}

// Tiny hand-rolled reader for the one fixed-shape JSON object the server ever sends --
// {"version":N,"bin":"/ota/customer-display/latest.bin"} -- avoids pulling in a whole JSON
// library for two fields. Returns false if either field is missing/malformed.
static bool parseOtaJson(const String &body, long &version, String &binPath) {
  int vAt = body.indexOf("\"version\"");
  int bAt = body.indexOf("\"bin\"");
  if (vAt < 0 || bAt < 0) return false;
  int vColon = body.indexOf(':', vAt); if (vColon < 0) return false;
  version = body.substring(vColon + 1).toInt();
  int bColon = body.indexOf(':', bAt); if (bColon < 0) return false;
  int q1 = body.indexOf('"', bColon); if (q1 < 0) return false;
  int q2 = body.indexOf('"', q1 + 1); if (q2 < 0) return false;
  binPath = body.substring(q1 + 1, q2);
  return binPath.length() > 0;
}

// Checked rarely (OTA_FIRST_CHECK_MS after boot, then every OTA_RECHECK_MS) and only while
// WiFi is actually connected. A real update blocks for several seconds then reboots the
// device on success -- that's expected and fine for something that happens a few times a
// year, not something a cashier is staring at mid-bill. Status only ever goes to Serial
// (prefixed OTA|, never OK|/ERR|) so it can never be mistaken for a billing response.
static void checkOta() {
  WiFiClientSecure client; client.setInsecure(); // see ota/README.md: no cert pinning in V1, integrity leans on this being our own domain + the owner controlling what gets built into latest.bin
  HTTPClient http;
  if (!http.begin(client, OTA_VERSION_URL)) { Serial.println("OTA|CHECK_FAILED"); return; }
  int code = http.GET();
  if (code != 200) { Serial.printf("OTA|CHECK_HTTP_%d\n", code); http.end(); return; }
  String body = http.getString(); http.end();
  long version; String binPath;
  if (!parseOtaJson(body, version, binPath)) { Serial.println("OTA|CHECK_BAD_JSON"); return; }
  if (version <= FW_VERSION) { Serial.println("OTA|UP_TO_DATE"); return; }
  String url = String("https://auzslab.in") + binPath;
  Serial.printf("OTA|UPDATING_TO_%ld\n", version);
  t_httpUpdate_return r = httpUpdate.update(client, url);
  switch (r) {
    case HTTP_UPDATE_FAILED: Serial.printf("OTA|FAILED_%d\n", httpUpdate.getLastError()); break;
    case HTTP_UPDATE_NO_UPDATES: Serial.println("OTA|NO_UPDATE"); break;
    case HTTP_UPDATE_OK: Serial.println("OTA|OK"); break; // device reboots itself on success; this line may never actually be seen
  }
}

static void handleCommand(const String &line) {
  if (line == "IDLE" || line == "CLEAR") {
    showIdle(); Serial.println("OK|IDLE"); return;
  }
  if (line == "STATUS") {
    Serial.printf("OK|STATUS|%d|%s|%u\n", WiFi.status() == WL_CONNECTED ? 1 : 0,
                  WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "-", FW_VERSION);
    return;
  }
  if (line == "FAILED") {
    showFailed(); Serial.println("OK|FAILED"); return;
  }
  if (line.startsWith("PAID|")) {
    String amount = line.substring(5);
    if (!validAmount(amount)) { Serial.println("ERR|AMOUNT"); return; }
    showPaid(amount.c_str()); Serial.println("OK|PAID"); return;
  }
  if (line.startsWith("WIFI|")) {
    int sep = line.indexOf('|', 5);
    if (sep < 0) { Serial.println("ERR|FORMAT"); return; }
    String ssid = line.substring(5, sep), pass = line.substring(sep + 1);
    if (ssid.isEmpty() || ssid.length() > 32 || pass.length() > 64) { Serial.println("ERR|WIFI_FORMAT"); return; }
    prefs.putString("ssid", ssid); prefs.putString("pass", pass);
    WiFi.disconnect(true); wifiConnectSaved();
    nextOtaCheckAt = millis() + OTA_FIRST_CHECK_MS; // give the new creds a chance before the next check
    Serial.println("OK|WIFI"); return;
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
  prefs.begin("auz", false);
  wifiConnectSaved(); // no-op if no SSID has ever been saved
  Serial.printf("AUZSLAB|READY|V%u\n", FW_VERSION);
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
  if (WiFi.status() == WL_CONNECTED && millis() >= nextOtaCheckAt) {
    nextOtaCheckAt = millis() + OTA_RECHECK_MS;
    checkOta(); // rare (hours apart) and only runs on an actual newer version -- see checkOta()'s own comment
  }
  Lvgl_Loop();
  delay(5);
}
