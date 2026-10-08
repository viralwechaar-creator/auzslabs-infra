#!/usr/bin/env node
/*
 * AUZslab Bridge Server
 * ----------------------
 * A tiny program that runs on one PC at the restaurant. The POS (running in the browser, same
 * as always) sends a print job here instead of trying to print directly -- this program then
 * forwards the raw bytes to a network/LAN printer (kitchen printer, counter printer, etc.) over
 * a plain TCP socket on port 9100, the "raw printing" port almost every network thermal printer
 * listens on. No printer driver, no special software on the printer's side.
 *
 * Why this exists: a browser cannot open a TCP socket to a printer on the LAN by itself (that is
 * exactly the gap between what AUZslab's web-based POS can do and what a printer needs). This
 * program is the one piece that bridges that gap. Everything else -- billing, KOT, menu -- stays
 * exactly as it is today; this only carries print jobs the last few feet to the printer.
 *
 * Setup (no installer yet -- this is the first working version, see bridge/README.md):
 *   1. Install Node.js on the restaurant's PC (nodejs.org).
 *   2. Put this folder somewhere on that PC.
 *   3. Run once:  node server.js
 *      It creates config.json next to this file with a random access token and prints it --
 *      copy that token into the POS (Staff & settings -> Receipt printer -> Bridge Server).
 *   4. Edit config.json to add your printer(s): the printer's IP address on the network and its
 *      port (9100 for almost every network thermal printer).
 *   5. Run  node server.js  again (or leave the first run going) -- it listens on
 *      http://127.0.0.1:7777 by default.
 *   6. In the POS, open Staff & settings -> Receipt printer -> Bridge Server, enter the same
 *      port (7777) and the token, pick the printer, and send a test print.
 *
 * Known limitation (said plainly, not hidden): this only works when the POS and this program run
 * on the SAME PC (the browser can only safely reach "localhost" from an https:// page without a
 * security warning). If the POS runs on a separate tablet from the PC holding this program, that
 * needs a different setup (a real certificate for a shared hostname) -- flagged as a later step,
 * not built yet.
 */
'use strict';
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const VERSION = '1.0.0';

function loadOrCreateConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
    catch (e) { console.error('config.json exists but could not be read as JSON: ' + e.message); process.exit(1); }
  }
  const token = crypto.randomBytes(24).toString('base64url');
  const cfg = {
    port: 7777,
    token,
    printers: {
      // Example -- replace with your printer's real IP address.
      // "Kitchen": { "host": "192.168.1.50", "port": 9100 },
      // "Counter": { "host": "192.168.1.51", "port": 9100 }
    },
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
  console.log('\nFirst run: created config.json next to this file.');
  console.log('Your access token (enter this in the POS): ' + token);
  console.log('Add your printer(s) to config.json, then run this again.\n');
  return cfg;
}

const cfg = loadOrCreateConfig();
if (!cfg.token) { console.error('config.json has no token. Delete it and run this again to generate one.'); process.exit(1); }

function corsHeaders(origin) {
  const allow = origin && /^https:\/\/([a-z0-9-]+\.)*auzslab\.in$/.test(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
  };
}

function send(res, status, body, extraHeaders) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
  res.writeHead(status, headers);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function authed(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer (.+)$/.exec(h);
  return !!m && m[1] === cfg.token;
}

/** Forwards raw bytes to a network printer over a plain TCP socket (the "raw/9100" printing
 *  protocol almost every network thermal printer understands -- no driver needed). */
function sendToPrinter(host, port, bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: port || 9100 }, () => {
      sock.end(bytes);
    });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('The printer did not answer within 5 seconds.')); }, 5000);
    sock.on('close', () => { clearTimeout(timer); resolve(); });
    sock.on('error', (e) => { clearTimeout(timer); reject(new Error('Could not reach the printer at ' + host + ':' + (port || 9100) + ' -- ' + e.message)); });
  });
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const cors = corsHeaders(origin);
  if (req.method === 'OPTIONS') return send(res, 204, '', cors);

  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { ok: true, name: 'AUZslab Bridge Server', version: VERSION }, cors);
  }

  if (!authed(req)) return send(res, 401, { error: 'Missing or wrong access token.' }, cors);

  if (req.method === 'GET' && url.pathname === '/printers') {
    return send(res, 200, { printers: Object.keys(cfg.printers) }, cors);
  }

  if (req.method === 'POST' && url.pathname === '/print') {
    const name = url.searchParams.get('printer');
    const printer = cfg.printers[name];
    if (!printer) return send(res, 400, { error: name ? ('No printer named "' + name + '" in config.json.') : 'Add ?printer=<name> to the request.' }, cors);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const bytes = Buffer.concat(chunks);
      if (!bytes.length) return send(res, 400, { error: 'No print data received.' }, cors);
      try {
        await sendToPrinter(printer.host, printer.port, bytes);
        send(res, 200, { ok: true }, cors);
      } catch (e) {
        send(res, 502, { error: e.message }, cors);
      }
    });
    return;
  }

  send(res, 404, { error: 'Unknown request.' }, cors);
});

server.listen(cfg.port, '127.0.0.1', () => {
  console.log('AUZslab Bridge Server listening on http://127.0.0.1:' + cfg.port);
  console.log('Printers configured: ' + (Object.keys(cfg.printers).length ? Object.keys(cfg.printers).join(', ') : '(none yet -- edit config.json)'));
});
