# DawaiSathi deploy notes

## Production stack

| Piece | Value |
|-------|--------|
| Frontend | Render static site `dawaisathi` → https://dawaisathi.onrender.com |
| API | Render web service `dawaisathi-api` → https://dawaisathi-api.onrender.com |
| Database | **Supabase Postgres** via **IPv4 pooler** (not direct host) |
| Images | Cloudinary (`CLOUDINARY_URL`) |
| Cron | cron-job.org → `GET/POST /api/notifications/trigger-check` |

## Database URL (critical)

Supabase **direct** hosts (`db.<project>.supabase.co`) often resolve to **IPv6 only**.  
Render free/web services frequently **cannot** reach IPv6 → deploy crashes with `Network is unreachable`.

**Always use the Supabase connection pooler (IPv4):**

```text
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
```

Notes:

- Region for this project: **ap-south-1**, pooler host prefix **`aws-1-`** (not always `aws-0-`).
- Prefer **session mode port 5432** for SQLAlchemy + startup migrations.
- Transaction mode (`:6543`) needs careful pool settings; session mode is simpler.
- **Never** point production at Neon free-tier with a 1-minute cron (burns CU-hours).

### How to confirm

```bash
# Must show A (IPv4) records for pooler
nslookup aws-1-ap-south-1.pooler.supabase.com

# Direct host may be AAAA-only — do not use on Render
nslookup db.<project-ref>.supabase.co
```

Health: `GET https://dawaisathi-api.onrender.com/healthz` → `"database":{"ok":true}`.

## Required environment variables (API)

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | yes | Supabase **pooler** URL |
| `SECRET_KEY` | yes | Long random string |
| `FRONTEND_URL` | yes | `https://dawaisathi.onrender.com` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | yes | OAuth |
| `GEMINI_API_KEY` | yes | OCR |
| `CLOUDINARY_URL` | yes | `cloudinary://API_KEY:API_SECRET@CLOUD_NAME` — **no local disk fallback in production** |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_URL` | for TG | Webhook base = public API URL |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_CLAIMS_EMAIL` | for push | `python generate_vapid.py` |
| `CRON_SECRET` | **yes in production** | Header `X-Cron-Secret` or `?cron_secret=` |
| `FLASK_ENV` | recommend | `production` |
| `FLASK_APP` | yes | `app.py` |

## Cron (notifications)

1. Set `CRON_SECRET` on Render.
2. cron-job.org URL example:

   ```text
   https://dawaisathi-api.onrender.com/api/notifications/trigger-check?cron_secret=YOUR_SECRET
   ```

   Or header: `X-Cron-Secret: YOUR_SECRET`

3. Interval: **20–30 minutes** (not 1 minute). Reminders may be delayed up to the interval.
4. Without `CRON_SECRET` in production, trigger-check returns **403**.

## Images

- Production **must** use Cloudinary. Failed uploads return **502**, not `/uploads/...`.
- Old DB rows with `/uploads/...` were legacy ephemeral files; they 404 quietly if still referenced.
- New scans store `https://res.cloudinary.com/...` URLs.

## Health endpoints

| Path | Meaning |
|------|---------|
| `GET /` | Process alive |
| `GET /healthz` | Process + `SELECT 1` on DB + config flags |
| `GET /api/notifications/health` | Auth required — Telegram webhook, VAPID, last cron trigger |

## Frontend build

Set `VITE_API_URL=https://dawaisathi-api.onrender.com` at static site build time (if not using same-origin proxy).

## After secret rotation

1. Update env on Render.
2. Manual deploy (or auto-deploy from `main`).
3. Hit `/healthz` and Settings → Notification health.
