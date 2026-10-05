# Digital launch checklist (everything except company registration, tax and the bank)

Written for the owner. The company registration, GST, bank account and Razorpay KYC are handled by your partner and are not covered here.
Each item says who does it: **Claude** (already built, in this repo), **You** (a few clicks or one command on the server), or **Partner** (needs the company's details).

Tick items off as they are done. Order matters: do the numbered sections in order.

## 1. What is already built (Claude)

| Item | Where | State |
|---|---|---|
| Email confirmation for new owner signups (one-time link, 24 h, stored hashed) | `server/src/auth.js`, `db/092_email_verification.sql`, `site/verify-email.html` | built; the **requirement** is off until you switch it on (section 4) |
| Free CAPTCHA (Cloudflare Turnstile) on signup | `server/src/captcha.js`, `site/signup.html` | built; **dormant** until you add the keys (section 3) |
| Account hijack guard: if someone pre-registers a victim's email and the victim later signs in with Google/Apple, the stranger's password is removed | `findOrCreateIdentityUser` | built |
| Health check for monitors: `https://api.auzslab.in/health` | `server/src/index.js` | built |
| Daily cleanup of expired sessions, codes and links | `server/src/maintenance.js` | built |
| Backup restore test (proves last night's backup really restores) | `tools/restore-test.sh` | built (section 7) |
| 60-shop load test, deadlock and sync fixes | `tests/suites/local/loadmob.mjs`, `db/091_mob_scale.sql` | on branch `mob-scale-loadtest`, not merged yet |
| Nightly backup, off-site copy to Backblaze, Uptime Kuma at `status.auzslab.in` | `docker-compose.yml` | already running |

## 2. Deploy this release (You, on the server)

```bash
cd auzslabs-infra && git pull origin main && git log -1 --oneline
set -a; source .env; set +a
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < db/092_email_verification.sql
docker compose up -d --build api
curl -s https://api.auzslab.in/health
```
The last command should print `{"ok":true,"db":true,...}`. If `db/091_mob_scale.sql` has not been applied yet, run it the same way **before** 092.

Everything stays as it was until you do sections 3 and 4: existing accounts are marked verified by the migration, and the requirement is off.

## 3. Real email sending and the CAPTCHA (You)

### 3a. Make email actually reach people (Resend)
Today the sender is Resend's test address, which can only email the Resend account's own owner. Real customers would get nothing.
1. resend.com -> Domains -> Add Domain -> `auzslab.in`.
2. Resend shows about 3 to 4 DNS records (SPF, DKIM, and sometimes a return-path/MX). Add each at GoDaddy: My Products -> auzslab.in -> DNS -> Add. Copy the Type, Name and Value exactly.
3. Back in Resend press Verify. It can take a few minutes to a few hours.
4. On the server edit `.env`: `MAIL_FROM=AUZslab <hello@auzslab.in>` and make sure `RESEND_API_KEY=` has your key. Then `docker compose up -d --build api`.
5. Test: create a throw-away account at auzslab.in/signup.html with a Gmail address. The confirmation email should arrive within a minute. Check spam too.

### 3b. Turn on the CAPTCHA (Cloudflare Turnstile, free)
1. dash.cloudflare.com -> sign up (free) -> Turnstile -> Add site. Name `AUZslab signup`, domain `auzslab.in`, widget mode **Managed**.
2. Copy the **Site key** (public) and **Secret key** (private).
3. On the server add to `.env`: `TURNSTILE_SECRET_KEY=<secret key>` then `docker compose up -d --build api`.
4. Send the **Site key** to Claude (it is public, it goes into `site/signup.html` as `turnstileSiteKey`), or paste it yourself there. Then `git pull`.
5. Test: the sign-up page now shows a small "verify you are human" box. Signing up without it is refused.

## 4. Switch on "confirm your email" (You)

Do this only after 3a works (a real email arrived).

```bash
set -a; source .env; set +a
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "update platform_flags set value = 'on' where key = 'require_email_verification';"
```
From now on a new self-signup account can sign in and look around, but cannot send a signup request, an add-on request or pay until its email is confirmed. Existing accounts are unaffected. Nothing needs restarting.

To switch it off again (for example if email breaks): the same command with `'off'`.

## 5. Clean out the fake and test accounts (You)

First look (this only reads, it changes nothing):
```bash
set -a; source .env; set +a
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select au.email, au.created_at::date as created, au.email_verified_at is not null as verified, (select count(*) from auth_sessions s where s.user_id = au.id) as sign_ins from auth_users au left join profiles p on p.id = au.id where au.deleted_at is null and p.id is null and not exists (select 1 from platform_admins a where a.id = au.id) order by au.created_at desc;"
```
That lists accounts that never became a business (no shop attached, not a team member). Real prospects who simply have not bought yet are in it too, so read it before deleting anything.

To remove ones that are clearly fake, put their emails in the list (this signs them out and blocks sign-in; the row stays, so it can be undone):
```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "update auth_users set deleted_at = now() where email in ('fake1@example.com','fake2@example.com');"
```
Do **not** delete the demo logins (`demo@auzslab.in`, `demo-salon@auzslab.in`) or any real client.

## 6. Protect the accounts that could ruin you (You and Partner)

Turn on two-step login (an authenticator app, not SMS) on each, and store the backup codes somewhere safe (a password manager such as Bitwarden, free):

- [ ] GitHub (the code lives here)
- [ ] GoDaddy (the domain: whoever controls it controls email and every login)
- [ ] The server host (DigitalOcean or similar)
- [ ] Resend, Cloudflare, Sentry, Backblaze
- [ ] Razorpay (Partner)
- [ ] The Google account that owns the Play Store listing, and the Apple Developer account (when created)

Rotate (create new, delete old) any key that was ever shown in a screenshot or pasted into a chat: GoDaddy API key, Backblaze key, Resend key, the Razorpay keys. After changing one, update `.env` on the server and run `docker compose up -d`.

## 7. Prove the backups work (You)

Run this once now, and then once a week (put a repeating reminder in your phone):
```bash
cd auzslabs-infra && bash tools/restore-test.sh
```
It restores the newest backup into a scratch database, compares row counts with the live one, prints PASS or FAIL and deletes the scratch copy. It never touches live data. It also shows the newest off-site (Backblaze) copy.

A FAIL means the backups cannot be trusted. Send Claude the output.

## 8. Know when something is down (You)

Uptime Kuma is already running at `https://status.auzslab.in`. Add these monitors (Add New Monitor -> HTTP(s)) with a 60 second interval:

| Name | URL | Expected |
|---|---|---|
| API | `https://api.auzslab.in/health` | 200 |
| Website | `https://auzslab.in` | 200 |
| Demo shop | `https://demo.auzslab.in` | 200 |
| Salon | `https://showoffsalon.auzslab.in` | 200 |

Then Settings -> Notifications -> Setup Notification: choose **Telegram** (free, instant on your phone: create a bot with @BotFather, paste the token and your chat id) or **Email**. Tick "Default enabled" so every monitor uses it. Also add a monitor for the status page itself from a second place (for example a free account at uptimerobot.com pointing at `https://status.auzslab.in`), so you hear about it if the whole server is down.

## 9. A safe place to try changes before shops see them (staging)

Today every change goes straight to the live server. Cheapest safe setup, when you are ready (Claude builds the compose file, you create the server):
1. Create a second small server (about 1 vCPU, 2 GB, roughly Rs 600 a month at most; it can be switched off when not in use).
2. Add DNS `staging.auzslab.in` and `*.staging.auzslab.in` pointing to it.
3. Run the same stack there with a copy of last night's backup (`tools/restore-test.sh` shows how to restore one).
4. Try every database change and deploy there first.
Say "build staging" when you want this and Claude will prepare the files and exact steps.

## 10. What your partner needs from the digital side

- The business name, address and PAN/GST details to put on invoices and in the legal pages (`docs/LEGAL.md` lists exactly what is missing: legal entity, registered address, a named grievance officer, jurisdiction city, refund rules).
- Razorpay: the website already has pricing, terms and privacy pages. After KYC, send Claude the **Key ID** (public). The **Key Secret** and **Webhook Secret** go only into the server `.env` (see `.env.example`), never into a chat.
- The privacy policy and terms drafts are on branch `legal-policies` (PR #142). Merge them only after the points in `docs/LEGAL.md` are filled in and a lawyer has read them.

## 11. Still to build later (Claude, on request)

- A custom domain for a client's own address (for example `book.theirshop.com`). Say "build custom domains".
- A staging server setup (section 9).
- Phone-number login as the main login for local shops (needs an SMS provider and the DLT registration, which Partner would do).
- Google and Apple login (needs the Google client id and Apple developer account).
- The Android app (a thin wrapper around the existing web app) and later the iPhone app.
