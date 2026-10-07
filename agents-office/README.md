# AUZslab Agents Office

A dashboard where you type a task, the right AI agent drafts it using your company notes, and the result is saved back as a note.

- **5 pods of 5 agents (25)**: Engineering, Operations & Security, Product & Delivery, Customers & Growth, Business & Insight, defined in `agents.json`.
- **Add a task** → a router names the best agent → the agent reads `CLAUDE.md`, `index.md` and the 5 most relevant notes from `brain/` plus its brief → one deliverable is saved as a dated note in `brain/Agents Office/` with `[[links]]` to the notes it read.
- **Board:** Backlog, In progress, Waiting approval, Done.
- **Agent chat:** send `revise: shorter` to rewrite the latest note. Corrections are saved in `brain/Agents Office/feedback/<agent>.md` and read before every future task. `note: …` saves a lesson without rewriting.
- Built for Safari on iPhone: large tap targets, task bar at the bottom, nothing hover-only.

## Safety rules (enforced in code, covered by tests)

| Rule | Where it is enforced |
|---|---|
| Agents read and write only inside the brain folder | `lib/brain.js`: no absolute paths, no `..`, no symlink escapes, `.md` only, size limits |
| Agents write only inside `brain/Agents Office/` | `lib/brain.js` `writeNote` |
| Agents never send, post, pay, delete or call anything | Agents have **no tools**. The only code path is read notes → ask AI → this server saves a note. The only outbound call in the app is to the Anthropic API (`lib/llm.js`) |
| Anything acting outside the app waits for your tap | `lib/runner.js`: words like send/post/pay/book/delete in the task, **or** the agent flagging it, put the task in *Waiting approval* |
| No API keys in the brain or the browser | Key read only from the environment on the server. Keys/passwords are redacted from every saved note, and any brain note that looks like it contains one is ignored and logged |
| Notes cannot give orders to the agent | Notes are passed as quoted data; the prompt says to ignore instructions inside them |
| One owner, password first | `lib/auth.js`: scrypt hash, signed HttpOnly cookie, 5 wrong tries per 15 min, nothing but the login page is served before login, strict CSP |
| Cost guard | Max open tasks (default 30), max 4000 characters per task |

Run `npm test` (20 checks). `node scripts/ui-check.mjs` drives the real screens on a phone and a desktop browser (floor view) (needs Playwright).

## File structure

```
office.config.json        business name, brain path, port, model
agents.json               5 pods, 25 agents (id, name, role, job, brief)
server.js                 HTTP server, login, API
lib/brain.js              the only door to the notes folder (safety rules)
lib/context.js            what an agent reads before a task
lib/router.js             picks the agent (small AI call, keyword fallback)
lib/runner.js             queue, task life cycle, saving notes, approvals
lib/llm.js                Anthropic API call (server only)
lib/auth.js, secrets.js   login, key redaction
lib/store.js              task board + chat state (data/, outside the brain)
public/login.html, app.html   the whole front end
brain/                    your notes (seed notes for AUZslab included)
deploy/                   systemd service, nginx config
test/                     safety and flow tests
```

## Configure

`office.config.json`:

```json
{ "businessName": "AUZslab", "brainPath": "./brain", "port": 3100,
  "model": "claude-sonnet-5-5", "routerModel": "claude-haiku-4-5-20251001",
  "maxTokens": 2500, "timezone": "Asia/Kolkata", "maxOpenTasks": 30, "concurrency": 2 }
```

Secrets go in the environment, never in the config or the brain (see `.env.example`).

## Run on your computer first

```bash
cp .env.example .env
npm run set-password        # paste the two lines it prints into .env, add ANTHROPIC_API_KEY=...
npm start                   # open http://127.0.0.1:3100
```

## Deploy on an Ubuntu VPS

**Before you start:** these steps use nginx on ports 80/443. If the VPS already runs AUZslab (it uses Caddy on 80/443), do **not** install nginx. Tell me and I will give you the Caddy version instead. A second web server on the same ports will fail.

All commands run as root (or add `sudo`). Paste them one block at a time.

**1. DNS.** Add an A record `agents.yourdomain.in` → your VPS IP. Wait a few minutes.

**2. Install Node 20, nginx and certbot**
```bash
apt update && apt install -y nginx certbot python3-certbot-nginx curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
node -v   # should show v20 or higher
```

**3. Create a user and copy the app**
```bash
useradd --system --home /opt/auzslab-agents-office --shell /usr/sbin/nologin agentsoffice
git clone <YOUR-REPO-URL> /opt/auzslab-agents-office     # or upload the folder with scp/rsync
cd /opt/auzslab-agents-office
mkdir -p data && chown -R agentsoffice:agentsoffice brain data
```

**4. Password and keys**
```bash
sudo -u agentsoffice npm run set-password   # type a 12+ character password; it prints two lines
nano /etc/auzslab-agents-office.env
```
Put this in the file (use the two lines printed above), then save:
```
ANTHROPIC_API_KEY=sk-ant-...your key...
OFFICE_PASSWORD_HASH=...printed line...
OFFICE_SESSION_SECRET=...printed line...
OFFICE_TRUST_PROXY=1
```
```bash
chmod 600 /etc/auzslab-agents-office.env && chown root:root /etc/auzslab-agents-office.env
```

**5. Start the service**
```bash
cp deploy/auzslab-agents-office.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now auzslab-agents-office
systemctl status auzslab-agents-office --no-pager
curl -s http://127.0.0.1:3100/healthz        # should print {"ok":true}
```

**6. nginx and HTTPS**
```bash
cp deploy/nginx-agents-office.conf /etc/nginx/sites-available/agents-office
sed -i 's/agents.example.com/agents.yourdomain.in/g' /etc/nginx/sites-available/agents-office
ln -s /etc/nginx/sites-available/agents-office /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d agents.yourdomain.in      # answer the questions; choose to redirect HTTP to HTTPS
```
certbot adds the certificate and HTTPS to the same config and renews it automatically.

**7. Check it works.** Open `https://agents.yourdomain.in` on your iPhone, log in, add a task. Tap Share → Add to Home Screen to get an app icon.

**Logs:** `journalctl -u auzslab-agents-office -f`. **Update:** `cd /opt/auzslab-agents-office && git pull && systemctl restart auzslab-agents-office`.

## Run with the AUZslab stack (Docker + Caddy), opened from the admin panel

If this runs on the same VPS as AUZslab, use this instead of nginx. The admin panel's "Agents Office" link opens `https://agents.auzslab.in`.

```bash
cd /root/auzslabs-infra && git pull origin main      # this folder (agents-office) comes with the AUZslab repo
cd agents-office
cp .env.example .env && npm run set-password          # paste the two lines into .env, add ANTHROPIC_API_KEY=...
chmod 600 .env && chown -R 1000:1000 brain            # the container runs as user 1000
cd .. && docker compose --profile agents up -d --build agents-office
docker compose restart caddy                          # picks up the agents.auzslab.in address
```
It needs the DNS name `agents.auzslab.in` (the existing `*.auzslab.in` wildcard already covers it). Check: `docker compose logs agents-office --tail 20`, then open `https://agents.auzslab.in`.
The service is off by default (compose profile), so a normal `docker compose up -d` never touches it. Update: `git pull` in `/root/auzslabs-infra`, then `docker compose --profile agents up -d --build agents-office`.

## Your notes (the brain)

Edit the Markdown files in `brain/` any time (they are plain `.md`). Fill the `TODO`s in `Pricing.md`, `About.md` and `FAQ.md`: agents repeat what is there and write `TODO` for what is missing, so the better the notes, the better the drafts. Agents never change these files, only `brain/Agents Office/`. Back up the whole `brain/` folder (for example `tar czf` into another place daily); it is your company memory.

## Limits to know

- Agents work only from notes and what you paste into the task. They cannot look at your servers, database or the internet.
- A draft is a draft: read it before you send, post or pay anything.
- Task state (the board) lives in `data/state.json`. Tasks interrupted by a restart run again on start.
- Each task costs a small AI charge; revisions cost one more call.
