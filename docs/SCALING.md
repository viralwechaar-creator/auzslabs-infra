# Scaling runbook: when to grow, and how

Today: one server (2 CPU, 4 GB, 75 GB) runs the web server, the API and the database. That is plenty for a few dozen businesses. Look at
Admin -> System resources before deciding anything; the daily health notice ("Server health: needs a look") also warns you.

## Signs it is time
| Sign (from the health report) | Meaning | First action |
|---|---|---|
| Database memory reads under 95% for several days | database needs more memory | bigger server (step 1) |
| Connections stay above 20 of 35 | too many parallel requests | find the slow query (Slowest database work), then step 1 |
| Slowest 5% of requests over 1.5 s for a product | that product is heavy | fix the query or index first; then step 1 |
| Disk above 70% | running out of space | prune old backups, move pictures to cloud storage (S3 settings in .env.example), then grow the disk |
| API memory above 1.5 GB or API delayed over 200 ms | the API is overloaded | step 1 |

## Step 1: a bigger server (no code change)
1. Take a fresh backup and run `bash tools/restore-test.sh`.
2. In the hosting panel resize the machine (4 CPU / 8 GB is the next size). Resizing keeps data and addresses; expect a few minutes of downtime.
3. Raise the database settings in `docker-compose.yml` for the new memory: shared_buffers about 25% of RAM, effective_cache_size about 60%.
4. `docker compose up -d --force-recreate postgres`, then `docker compose restart api`.

## Step 2: more than one API copy (needs work first)
The API keeps these in its own memory, so two copies would disagree: the signed-out session list (`auth/sessions.js`), rate limits (`lib/http.js`),
the answer cache (`lib/pubcache.js`), the salon page cache (`salon/storage.js`), live WebSocket tills (`realtime.js`) and request metrics (`metrics.js`).
Before running two copies move the first three to a shared store (Redis, or a small database table with a short expiry), and give WebSockets
sticky routing. Do not add a load balancer before that is done.

## Step 3: a separate database server
Only when one machine is clearly too small even at the largest size, or you need failover. Use a managed Postgres (backups and failover included),
point `PGHOST`/`DATABASE_URL` in `.env` at it, keep the API in Docker. `pg_stat_statements` is available on managed services; ask for it.

## Routine
- Deploys: `git pull`, `bash tools/migrate.sh apply`, `docker compose up -d --build api` (the API now stops cleanly, finishing requests in progress).
- Weekly restore test and daily .env copy are scheduled by `bash tools/install-cron.sh`.
