# DawaiSathi — Architecture & Design

## Tech Stack (Implemented)

| Layer | Technology | Notes |
|---|---|---|
| **Frontend** | React 18 + TypeScript + Vite | SPA with code-split routes |
| **Styling** | Vanilla CSS | Mobile-first, glassmorphism, no framework dependency |
| **Backend** | Python Flask + SQLAlchemy | REST API with Blueprint routes |
| **Database** | SQLite | Dev environment; PostgreSQL-ready via SQLAlchemy abstraction |
| **AI / Vision** | Google Gemini 2.0 Flash | Prescription OCR with structured JSON extraction |
| **Auth** | Google OAuth 2.0 + JWT | Stateless bearer-token sessions |
| **PWA** | Service Worker (Workbox) | Offline cache, push notifications, background sync |
| **Camera** | react-webcam | Hardware camera with flash/torch support |

## Project Structure

```
version_3/
├── backend/
│   ├── app.py                 # Flask entry point, error handlers
│   ├── extensions.py          # safe_commit() helper, db init
│   ├── models.py              # SQLAlchemy models (User, Family, MedicineEntry, MedicineLog)
│   ├── scheduler.py           # Timezone-aware notification scheduler
│   ├── routes/
│   │   ├── auth.py            # Google OAuth, JWT, logout
│   │   ├── medicine.py        # Scan, add, update, delete, upload, cabinet, Gemini
│   │   ├── family.py          # Family group, join, members, inbox
│   │   └── notifications.py   # Push subs, Telegram, timezone, settings
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Router, auth provider, offline sync
│   │   ├── main.tsx           # Entry + SW registration
│   │   ├── sw.ts              # Service Worker (caching, push, notifications)
│   │   ├── api/client.ts      # Axios instance with JWT interceptor
│   │   ├── context/AuthContext.tsx  # Auth state, active member, timezone sync
│   │   ├── pages/
│   │   │   ├── Cabinet.tsx         # Medicine cabinet with per-slot delete
│   │   │   ├── Scanner.tsx         # Camera scanner with quality feedback
│   │   │   ├── ScanApproval.tsx    # Review/edit extracted medicines
│   │   │   ├── SettingsDashboard.tsx # Push, Telegram, timezone settings
│   │   │   ├── FamilySettings.tsx  # Family inbox, members
│   │   │   ├── AuthGate.tsx        # Login screen
│   │   │   └── AuthSuccess.tsx     # OAuth callback handler
│   │   └── components/
│   │       ├── AppLayout.tsx       # Layout with conditional FamilyPills
│   │       └── FamilyPills.tsx     # Member switcher pills
│   └── index.css               # All styles (2700+ lines)
```

## Data Flow

### Prescription Scan Flow

```
1. User opens Scanner → camera activates
2. User taps capture (or uploads from gallery)
3. Image quality analyzed (brightness + contrast)
4. Image sent to POST /api/medicine/scan
5. Backend validates image size → calls Gemini Flash API
6. Gemini returns structured JSON (medicines, dosages, schedule, confidence)
7. Backend validates Gemini response → returns to frontend
8. Frontend navigates to ScanApproval page
9. User reviews/edits each medicine → confirms → POST /api/medicine/add
10. Medicine saved to DB → Cabinet refreshes
```

### Family Sync Flow

```
1. User A creates family → gets 6-character code
2. User B enters code → POST /api/family/join
3. Join request appears in User A's inbox
4. User A approves → both see each other's family
5. Each member has own cabinet (filtered by family_id + user_id)
6. Active member switch: localStorage activeMemberId → cabinet reloads
```

### Notification Flow

```
1. User registers push subscription → POST /api/notifications/subscribe
2. User sets time slots in Settings
3. Backend scheduler runs every minute (scheduler.py)
4. Finds due notifications based on slot_time + user timezone
5. Sends Web Push payload to all subscribed devices
6. Service Worker receives push → shows notification
7. Notification click → opens cabinet page
```

## Key Backend Components

### Global Error Handler (`app.py`)

```python
@ app.errorhandler(Exception)
def handle_exception(e):
    # Returns JSON {error, code, retryable} for all unhandled exceptions
```

Catches all 500s and unhandled exceptions so the frontend always gets a structured JSON error instead of HTML.

### safe_commit() (`extensions.py`)

```python
def safe_commit():
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
```

Replaces 23 bare `commit()` calls across all route files. Rollback on failure + re-raise so the global error handler can serialize it.

### Gemini Extraction (`routes/medicine.py`)

- Image size validation (rejects >20MB)
- 2x retry with exponential backoff
- Structured error responses by type:
  - `GEMINI_RATE_LIMIT` (429)
  - `GEMINI_AUTH_ERROR` (401)
  - `GEMINI_EXTRACTION_FAILED` (422)
  - `GEMINI_INVALID_IMAGE` (400)
- Cabinet-contextual prompt emphasizing daily schedules and expiry

### Batch-Add (`routes/medicine.py`)

- Per-item validation with index tracking
- Returns 207 Multi-Status on partial failure
- Errors array includes index + field + message

### Update Route (`routes/medicine.py`)

- Validates schedule JSON structure and slot names
- Returns 422 with details array
- Supports per-slot delete (removes only the current slot, deletes entry only if last slot removed)

## Key Frontend Components

### AuthContext (`context/AuthContext.tsx`)

- Google OAuth login/logout
- JWT token management
- Active family member tracking with `n > 0` validation
- IANA timezone sync with retry cap (max 3 attempts)
- Logout clears localStorage and resets active member

### Scanner UI (`pages/Scanner.tsx`)

- Full-screen camera view with tap-to-capture
- Upload from gallery fallback
- Flash/torch toggle
- **Image quality analysis**: luminance + contrast check after capture
- **Multi-line hint**: 📋 "Place prescription inside frame" + "Ensure good lighting and clear text"
- **Collapsible tips**: 💡 toggle with 4 scan tips
- **Cabinet tip**: "Align prescription so medicine names and time columns are clearly visible"
- **Enhanced camera error**: step-by-step permission instructions
- **Error toast**: auto-dismiss after 4s

### Service Worker (`sw.ts`)

- `clientsClaim()` + SKIP_WAITING handler for instant updates
- NetworkFirst strategy for API calls (5 min cache)
- StaleWhileRevalidate for images (7 day cache)
- Push notification handler with notification click → focus/redirect
- Schedule sync from backend via postMessage

## Caching Strategy

| Resource | Strategy | TTL |
|---|---|---|
| API responses | NetworkFirst | 5 min |
| Images (uploads) | StaleWhileRevalidate | 7 days |
| JS/CSS/HTML | Precache at install | Until updated |
| Prescription photos | StaleWhileRevalidate | 7 days |

## Security

- JWT Bearer token for all API requests
- Token required for `/uploads/` via `?token=` query param as fallback
- Google OAuth 2.0 for authentication
- Image upload size validation (20MB limit)
- Batch-add validation per item
- Schedule JSON structure validation on update

## Future Architecture (Production)

- **Database**: Migrate from SQLite to PostgreSQL (via Supabase/Railway)
- **Background Workers**: Celery + Redis for reliable notification delivery
- **Error Tracking**: Sentry/LogRocket for production error visibility
- **Rate Limiting**: Per-user rate limits on Gemini API calls
- **Image Compression**: Client-side compression before upload
