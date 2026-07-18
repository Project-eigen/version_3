# DawaiSathi — production deploy guide

## Live URLs

| Piece | Service | URL |
|-------|---------|-----|
| App (PWA) | Render static `dawaisathi` | https://dawaisathi.onrender.com |
| API | Render web `dawaisathi-api` | https://dawaisathi-api.onrender.com |
| Database | Supabase Postgres (**IPv4 pooler only**) | see below |
| Images | Cloudinary | `CLOUDINARY_URL` |
| Dose cron | cron-job.org → trigger-check | every **20–30 min** |

Repo: https://github.com/Project-eigen/version_3

---

## Database URL (critical)

Supabase **direct** hosts (`db.<project>.supabase.co`) often resolve to **IPv6 only**.  
Render frequently cannot reach IPv6 → worker crash: `Network is unreachable`.

**Always use the connection pooler (IPv4):**

```text
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
```

| Rule | Detail |
|------|--------|
| Region (this project) | `ap-south-1` |
| Pooler host prefix | `aws-1-…` (not always `aws-0-`) |
| Port | Prefer **5432** (session mode) for SQLAlchemy + boot migrations |
| Port 6543 | Transaction mode — only if you understand PgBouncer limits |
| Neon free tier | Avoid with a 1‑minute cron (burns CU-hours) |

### Confirm DNS

```bash
# Pooler should have IPv4 (A)
nslookup aws-1-ap-south-1.pooler.supabase.com

# Direct host may be AAAA-only — do not use on Render
nslookup db.<project-ref>.supabase.co
```

---

## Required environment variables (API / Render)

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | yes | Supabase **pooler** URL |
| `SECRET_KEY` | yes | Long random string |
| `FRONTEND_URL` | yes | `https://dawaisathi.onrender.com` |
| `GOOGLE_CLIENT_ID` | yes | OAuth |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth |
| `GOOGLE_REDIRECT_URI` | yes | `https://dawaisathi-api.onrender.com/api/auth/callback` |
| `GEMINI_API_KEY` | yes | Prescription OCR |
| `CLOUDINARY_URL` | **yes in production** | `cloudinary://API_KEY:API_SECRET@CLOUD_NAME` — no local disk fallback |
| `TELEGRAM_BOT_TOKEN` | for Telegram | From @BotFather |
| `TELEGRAM_WEBHOOK_URL` | for Telegram | Public API base, e.g. `https://dawaisathi-api.onrender.com` |
| `VAPID_PUBLIC_KEY` | for web push | `python generate_vapid.py` |
| `VAPID_PRIVATE_KEY` | for web push | |
| `VAPID_CLAIMS_EMAIL` | for web push | e.g. `admin@dawaisathi.com` |
| `CRON_SECRET` | **yes in production** | Required for trigger-check (403 without it) |
| `FLASK_ENV` | recommend | `production` |
| `FLASK_APP` | yes | `app.py` |
| `PYTHON_VERSION` | Render | e.g. `3.11.6` |

Local template: [`backend/.env.example`](backend/.env.example).

---

## Curl cheat sheet

Replace `YOUR_CRON_SECRET` with the value of `CRON_SECRET` on Render.  
Replace `YOUR_JWT` when calling authenticated endpoints.

### Liveness & readiness

```bash
# Process up
curl -sS "https://dawaisathi-api.onrender.com/"

# Process + database SELECT 1 + config flags
curl -sS "https://dawaisathi-api.onrender.com/healthz"
```

Expected `healthz` (abbreviated):

```json
{
  "status": "ok",
  "checks": {
    "database": { "ok": true },
    "cloudinary_configured": true,
    "cron_secret_configured": true,
    "vapid_configured": true,
    "telegram_token_configured": true
  }
}
```

`status` is `degraded` and HTTP **503** if the DB check fails.

### Notification cron (production)

```bash
# Query param (easy for cron-job.org)
curl -sS -X GET \
  "https://dawaisathi-api.onrender.com/api/notifications/trigger-check?cron_secret=YOUR_CRON_SECRET"

# Header instead of query
curl -sS -X GET \
  "https://dawaisathi-api.onrender.com/api/notifications/trigger-check" \
  -H "X-Cron-Secret: YOUR_CRON_SECRET"

# Without secret → HTTP 403
curl -sS -i \
  "https://dawaisathi-api.onrender.com/api/notifications/trigger-check"
```

**cron-job.org settings**

| Setting | Value |
|---------|--------|
| URL | `https://dawaisathi-api.onrender.com/api/notifications/trigger-check?cron_secret=YOUR_CRON_SECRET` |
| Method | GET (or POST) |
| Interval | **20–30 minutes** (not 1 minute) |
| Optional header | `X-Cron-Secret: YOUR_CRON_SECRET` |

Reminders can be delayed up to the cron interval.

### Notification health (logged-in user)

```bash
curl -sS \
  "https://dawaisathi-api.onrender.com/api/notifications/health" \
  -H "Authorization: Bearer YOUR_JWT"
```

Also available in the app: **Settings → Notification health**.

### PowerShell

```powershell
curl.exe -sS "https://dawaisathi-api.onrender.com/healthz"
curl.exe -sS "https://dawaisathi-api.onrender.com/api/notifications/trigger-check?cron_secret=YOUR_CRON_SECRET"
```

---

## Images (Cloudinary)

- Production **must** set `CLOUDINARY_URL`.
- Format: `cloudinary://<api_key>:<api_secret>@<cloud_name>`
- Failed CDN uploads return **502** (`CLOUDINARY_UPLOAD_FAILED`) — the API does **not** write to Render’s ephemeral disk.
- Legacy DB paths `/uploads/...` are cleared or return quiet **404**; frontend does not request them.
- New scans use `https://res.cloudinary.com/...`.

---

## Health & ops endpoints

| Path | Auth | Meaning |
|------|------|---------|
| `GET /` | no | Process alive |
| `GET /healthz` | no | DB + config readiness |
| `GET/POST /api/notifications/trigger-check` | `CRON_SECRET` | Run due dose notifications |
| `GET /api/notifications/health` | JWT | Telegram webhook, VAPID, last cron / last send |

---

## Frontend (Render static site)

Build env (if API is on another origin):

```text
VITE_API_URL=https://dawaisathi-api.onrender.com
```

Publish directory: `frontend/dist` (after `npm run build`).

---

## After rotating secrets

1. Update env vars on Render (and Cloudinary / Supabase / Google as needed).
2. Redeploy API (and static site if `VITE_*` changed).
3. Smoke test:

```bash
curl -sS "https://dawaisathi-api.onrender.com/healthz"
curl -sS "https://dawaisathi-api.onrender.com/api/notifications/trigger-check?cron_secret=YOUR_CRON_SECRET"
```

4. Open Settings → Notification health in the app.
5. Update cron-job.org if `CRON_SECRET` changed.

---

## Local development (quick)

```bash
# Backend
cd backend
cp .env.example .env   # fill keys; SQLite is fine for local
pip install -r requirements.txt
python app.py          # http://localhost:5000

# Frontend
cd frontend
npm install
npm run dev            # http://localhost:5173
```

`CRON_SECRET` is optional locally (not production). Production always requires it when `RENDER=true` or `FLASK_ENV=production`.

---

## Related docs

- [README.md](README.md) — features, local setup, stack
- [Architecture_Design.md](Architecture_Design.md) — system design
- [UPGRADES.md](UPGRADES.md) — product roadmap
