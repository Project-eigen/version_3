# DawaiSathi — AI-Powered Family Medicine Cabinet

> Scan prescriptions, manage medicines, share with family — all from one phone.

## Features

- **AI Prescription Scanner** — Point your camera at a prescription; Gemini Vision AI extracts medicine names, dosages, schedules, and instructions
- **Medicine Cabinet** — Daily schedule organized by time slots (Morning, Afternoon, Evening, Night)
- **Family Mode** — Multiple family members with individual cabinets, join via invite
- **Push Notifications** — Web Push reminders at each time slot (requires service worker registration)
- **Offline-First PWA** — Works offline with cached cabinet data; IndexedDB queue for offline sync
- **Google OAuth** — Sign in with Google, JWT session management
- **Real-Time Quality Feedback** — Image brightness/contrast analysis before scan submission
- **Camera Error Guidance** — Step-by-step instructions when camera permissions are denied

## Prerequisites

- Python 3.10+
- Node.js 18+
- Google Cloud project with OAuth 2.0 credentials
- Google Gemini API key

## Setup

### 1. Clone

```bash
git clone <repo-url>
cd version_3
```

### 2. Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env`:

| Variable | Value |
|---|---|
| `SECRET_KEY` | Random secret string |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `http://localhost:5000/api/auth/callback` |
| `FRONTEND_URL` | `http://localhost:5173` |
| `GEMINI_API_KEY` | From Google AI Studio |

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

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, TypeScript, Vite |
| **Styling** | Vanilla CSS (mobile-first, glassmorphism) |
| **Backend** | Python Flask |
| **Database** | SQLite (dev) / PostgreSQL (prod) |
| **AI / Vision** | Google Gemini 2.0 Flash |
| **Auth** | Google OAuth 2.0 + JWT |
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
 SQLite   Google Gemini
 (dev)    Flash API
```

## Recent Improvements

See [summary.md](summary.md) for the full list of 40+ fixes, including:

- Global JSON error handler for all unhandled exceptions
- `safe_commit()` helper replacing 23 bare `commit()` calls
- Structured Gemini error responses with retry logic
- Image quality analysis (brightness/contrast) before scan
- Enhanced scanner UI with multi-line guidance, tips toggle, cabinet tip
- Step-by-step camera permission instructions
- Dynamic IANA timezone picker (400+ timezones vs 8 hardcoded)
- Service worker: clientsClaim, SKIP_WAITING, reduced cache TTLs
- OAuth failure logging, logout audit, per-slot delete, batch-add 207 responses
