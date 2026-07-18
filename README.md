# DawaiSathi — AI-Powered Family Medicine Cabinet

> Scan prescriptions, manage medicines, share with family — all from one phone.

## Production

| | URL |
|--|-----|
| **App** | https://dawaisathi.onrender.com |
| **API** | https://dawaisathi-api.onrender.com |
| **Deploy guide** | [DEPLOY.md](DEPLOY.md) (env vars, Supabase pooler, Cloudinary, cron, **curl**) |

```bash
# Quick smoke tests
curl -sS "https://dawaisathi-api.onrender.com/healthz"
curl -sS "https://dawaisathi-api.onrender.com/api/notifications/trigger-check?cron_secret=YOUR_CRON_SECRET"
```

## Features

- **AI Prescription Scanner** — Point your camera at a prescription; Gemini Vision AI extracts medicine names, dosages, schedules, and instructions
- **Medicine Cabinet** — Daily schedule organized by time slots (Morning, Afternoon, Evening, Night)
- **Family Mode** — Multiple family members with individual cabinets, join via invite
- **Push Notifications** — Web Push + Telegram reminders at each time slot
- **Offline-First PWA** — Works offline with cached cabinet data; IndexedDB queue for offline sync
- **Google OAuth** — Sign in with Google, JWT session management
- **Notification health** — Settings panel for Telegram webhook, VAPID, last cron trigger
- **Real-Time Quality Feedback** — Image brightness/contrast analysis before scan submission
- **Camera Error Guidance** — Step-by-step instructions when camera permissions are denied

## Prerequisites

- Python 3.10+
- Node.js 18+
- Google Cloud project with OAuth 2.0 credentials
- Google Gemini API key
- Cloudinary account (required for production image uploads)
- Supabase (or other Postgres) for production — see [DEPLOY.md](DEPLOY.md)

## Setup

### 1. Clone

```bash
git clone https://github.com/Project-eigen/version_3.git
cd version_3
```

### 2. Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env` (see [`.env.example`](backend/.env.example) for the full list):

| Variable | Value |
|---|---|
| `SECRET_KEY` | Random secret string |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `http://localhost:5000/api/auth/callback` |
| `FRONTEND_URL` | `http://localhost:5173` |
| `GEMINI_API_KEY` | From Google AI Studio |
| `CLOUDINARY_URL` | `cloudinary://API_KEY:API_SECRET@CLOUD_NAME` (prod required) |
| `CRON_SECRET` | Optional locally; **required** in production for dose cron |

```bash
python app.py
```

Backend runs on **http://localhost:5000**

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on **http://localhost:5173**

### 4. Google OAuth Configuration

In Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 Client:

**Authorized JavaScript origins:**
```
http://localhost:5173
http://localhost:5000
```

**Authorized redirect URIs:**
```
http://localhost:5000/api/auth/callback
```

For production, also add your Render origins/redirects (see [DEPLOY.md](DEPLOY.md)).

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, PWA |
| **Styling** | Vanilla CSS (mobile-first, glassmorphism) |
| **Backend** | Python Flask + Gunicorn (Render) |
| **Database** | SQLite (dev) / Supabase Postgres pooler (prod) |
| **Images** | Cloudinary (no ephemeral disk in production) |
| **AI / Vision** | Google Gemini Flash |
| **Auth** | Google OAuth 2.0 + JWT |
| **Notifications** | Web Push (VAPID) + Telegram webhook + external cron |
| **Service Worker** | vite-plugin-pwa / Workbox |
| **Camera** | react-webcam |

## Architecture

```
+-----------------------------+
|     React PWA Frontend      |
|  (Vite + TypeScript + CSS)  |
|                             |
|  Scanner, Cabinet, Family,  |
|  Settings, Scan Approval    |
+----------|------------------+
           |  REST API (Bearer JWT)
           v
+-----------------------------+
|      Flask Backend          |
|                             |
|  /api/medicine/*            |
|  /api/auth/*                |
|  /api/family/*              |
|  /api/notifications/*       |
|  Global error handler       |
|  safe_commit() helper       |
+------|----------------------+
       |
   ----+----
   |       |
   v       v
 SQLite / Supabase    Gemini + Cloudinary
 (dev / prod pooler)  Flash + CDN images
```

## Ops endpoints

| Path | Purpose |
|------|---------|
| `GET /` | Liveness |
| `GET /healthz` | Readiness (DB + config flags) |
| `GET /api/notifications/trigger-check` | Dose cron (needs `CRON_SECRET` in prod) |
| `GET /api/notifications/health` | Telegram / VAPID / last trigger (JWT) |

Full curl examples: [DEPLOY.md](DEPLOY.md#curl-cheat-sheet).

## Recent Improvements

Production reliability (see [DEPLOY.md](DEPLOY.md)):

- Cloudinary-only uploads in production (no `/uploads` disk fallback on Render)
- Supabase **IPv4 pooler** required (direct host is IPv6-only and breaks Render)
- `CRON_SECRET` for `/api/notifications/trigger-check` (403 without secret in production)
- `/healthz` database check; quieter handling of expected 404s
- Settings → **Notification health** (webhook, VAPID, last cron)

Earlier product work — see [summary.md](summary.md):

- Global JSON error handler for unhandled exceptions
- `safe_commit()` helper replacing bare `commit()` calls
- Structured Gemini error responses with retry logic
- Image quality analysis (brightness/contrast) before scan
- Enhanced scanner UI, camera permission guidance
- Dynamic IANA timezone picker
- Service worker: clientsClaim, SKIP_WAITING, reduced cache TTLs
