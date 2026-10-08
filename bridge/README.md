# AUZslab Bridge Server

Lets AUZsPOS print to a printer on the restaurant's own network (a kitchen printer, or any
printer the browser itself cannot reach) -- the browser can bill, take orders and everything
else exactly as today; this one small program only carries the print job the last few feet to
the printer.

## Why this exists

A web browser cannot open a direct connection to a network printer by itself. This program runs
quietly on one PC at the restaurant and does that one job: it receives a print job from the POS
and sends it on to the printer over the restaurant's own network.

## What you need

- One Windows (or Mac/Linux) PC at the restaurant that stays switched on during business hours.
- [Node.js](https://nodejs.org) installed on that PC (the free "LTS" version).
- The printer's IP address on the restaurant's WiFi/network (most receipt/kitchen printers show
  this on their own settings screen, or print it on a "network status" test page). The printer
  must support "raw" network printing on port 9100 -- true for almost every network thermal
  printer sold today.

## Setup

1. Copy this `bridge` folder onto that PC (a USB drive, email, anything).
2. Open a terminal/command prompt in that folder and run:
   ```
   node server.js
   ```
3. The first run creates `config.json` next to `server.js` and prints an access token to the
   screen, like:
   ```
   First run: created config.json next to this file.
   Your access token (enter this in the POS): AbCdEf123...
   Add your printer(s) to config.json, then run this again.
   ```
   **Write down that token** -- you'll type it into the POS in a moment.
4. Open `config.json` in any text editor and add your printer(s), using their real IP address:
   ```json
   {
     "port": 7777,
     "token": "AbCdEf123...",
     "printers": {
       "Kitchen": { "host": "192.168.1.50", "port": 9100 },
       "Counter": { "host": "192.168.1.51", "port": 9100 }
     }
   }
   ```
5. Run `node server.js` again (or leave the first run going -- it already picks up printers you
   add while editing, the next time it restarts). You should see:
   ```
   AUZslab Bridge Server listening on http://127.0.0.1:7777
   Printers configured: Kitchen, Counter
   ```
6. **On the SAME PC**, open the POS in the browser, go to **Staff & settings -> Receipt
   printer -> Bridge Server (network printer)**, and enter:
   - Port: `7777` (unless you changed it in `config.json`)
   - Access token: the one from step 3
   - Printer name: `Kitchen` or `Counter` (exactly as written in `config.json`)
7. Tap Connect, then "Print a test slip" to confirm it reaches the real printer.

## Important limitation (said plainly)

This only works when **the POS and this program run on the same PC**. Browsers are only allowed
to talk to `http://127.0.0.1` (this same computer) from an `https://` page without a security
warning -- that's a browser rule, not something we can turn off. If staff bill from a separate
tablet or phone, that tablet's own POS cannot reach a Bridge Server running on a different PC yet.
(A fix for that specific case exists -- a shared trusted address instead of `127.0.0.1` -- but it
needs a real setup step on our side and is not built yet.)

## Keeping it running

This is the first working version -- it runs only while the terminal/command window is open and
`node server.js` is running. Closing that window stops it. Turning it into a proper background
service that starts automatically when the PC turns on (so nobody has to remember to start it
every morning) is the next step, not built yet.

## If something doesn't work

- **"Could not reach the Bridge Server"** in the POS: `node server.js` isn't running on this PC,
  or the port in the POS doesn't match `config.json`.
- **"Wrong access token"**: retype the token from `config.json` exactly (it's long on purpose).
- **"Could not reach the printer at ...":** the printer's IP address in `config.json` is wrong,
  the printer is switched off, or it isn't on the same network as this PC. Most printers have a
  "print network status" button that shows their current IP address -- check it hasn't changed.
