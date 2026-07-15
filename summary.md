## Summary of all fixes & enhancements — DawaiSathi (Jul 2026)

### Objective
Fix all silent failures, logging gaps, caching issues, error-handling gaps, and flaky frontend-toasts across backend and frontend before production deployment. Then enhance scanner UI with quality feedback and contextual guidance.

### Important details
- Backend: Flask + SQLAlchemy + SQLite; Frontend: React/TypeScript + Vite
- Added global `@app.errorhandler(Exception)` in `app.py` for JSON 500s
- Created `safe_commit()` in `extensions.py` — wraps commit in try/except/rollback
- All 21 `commit()` callers use `safe_commit()`, relying on global error handler for JSON
- SW now calls `clientsClaim()` + handles `SKIP_WAITING` — updates activate immediately
- API cache TTL: 24h → 5min; images: CacheFirst 30d → StaleWhileRevalidate 7d
- Timezone picker: 8 hardcoded → all ~400 IANA via `Intl.supportedValuesOf`

### All issues fixed & enhancements

#### Backend fixes

| Fix | File(s) | Change |
|---|---|---|
| Silent bare excepts (6x) | routes/medicine.py, notifications.py | `current_app.logger.warning()/error()` on schedule parse, image token decode, delete, custom time parse, getMe failure, reply failure |
| OAuth failure logging | routes/auth.py | Logged token-exchange and userinfo-fetch failures before redirect |
| Global JSON error handler | app.py | `@app.errorhandler(Exception)` returns `{error, code, retryable}` |
| Logout auth check | routes/auth.py | Calls `get_current_user()`, logs user id |
| `safe_commit()` | extensions.py | Helper wraps commit + rollback on error |
| 23 bare `commit()` calls | medicine.py, notifications.py, auth.py, family.py | Replaced with `safe_commit()` |
| Gemini errors silent | routes/medicine.py | Image size validation, 2x retry with backoff, structured error codes, proper HTTP statuses |
| Batch-add silent skip | routes/medicine.py | Per-item validation with index tracking, returns `207 Multi-Status` |
| Update route silent JSON ignore | routes/medicine.py | Validates JSON + slot names, returns `422` with `details` |
| Missing index | models.py | Added `idx_med_log_user_id` on `MedicineLog.logged_by_user_id` |
| Scheduler timezone crash | scheduler.py | Attaches timezone info to `slot_time` for offset-aware comparison |
| `/uploads` unauthenticated | routes/medicine.py | Added `?token=` JWT query-param auth |
| `synchronize_session=False` | routes/family.py | Added to bulk update |
| Test push 400 | routes/notifications.py | Now accepts `{ endpoint }` body |
| IANA timezone saved | routes/notifications.py | Backend saves `user.timezone_name` |

#### Backend enhancements

| Enhancement | File(s) | Change |
|---|---|---|
| Enhanced Gemini prompt | routes/medicine.py | Cabinet context header, expiry emphasis, refined confidence rules, more abbreviation examples |

#### Frontend fixes

| Fix | File(s) | Change |
|---|---|---|
| Bot username not shown | SettingsDashboard.tsx | Reads `res.data.bot_username` from API response |
| Test push body | SettingsDashboard.tsx | Sends `{ endpoint }` |
| Edit medicine drops today_logs | Cabinet.tsx | `onSave` preserves `m.today_logs` |
| activeMemberId stuck at 0 | AuthContext.tsx | `n > 0` check, validates vs `user.family_id`; clears on logout |
| Empty catch in Cabinet.tsx | Cabinet.tsx | DEV log + toast on fetch failure |
| 8 hardcoded timezones | SettingsDashboard.tsx | Dynamic via `Intl.supportedValuesOf` + GMT offset |
| IANA timezone name sent | AuthContext.tsx | `syncTimezone` sends `tz_name` |
| Family pills outside cabinet | AppLayout.tsx | Only renders on `currentTab === 'cabinet'`; dead `<FamilySettings/>` removed |
| Inbox blank name/email | FamilySettings.tsx | `req.user_name` → `req.requester.name` |
| Delete removes entire medicine | Cabinet.tsx | Removes only current slot; deletes entry only if last slot gone |
| Empty catch in FamilySettings | FamilySettings.tsx | DEV logs + toasts on fetchFamilyData and leave-family |
| SW not activating | sw.ts | `clientsClaim()` + `SKIP_WAITING` handler |
| SW night time 21:00→22:00 | sw.ts | Matched backend defaults |
| `includeTriggered` removed | sw.ts | Non-standard; removed |
| API cache 24h→5min | sw.ts | `maxAgeSeconds: 300` |
| Image cache CacheFirst→SWR 7d | sw.ts | StaleWhileRevalidate strategy |
| syncTimezone infinite retry | AuthContext.tsx | `maxRetries = 3` cap |
| Offline sync race | App.tsx | IndexedDB delete wrapped in try/catch |
| Logout bare catch | AuthContext.tsx | DEV log added |
| SW sync bare catch | Cabinet.tsx | DEV log added |
| Members fetch silent fail | ScanApproval.tsx | DEV log added |
| SW registration query fail | SettingsDashboard.tsx | DEV log added |
| Telegram polling silent fail | SettingsDashboard.tsx | Toast on failure |

#### Frontend enhancements

| Enhancement | File(s) | Change |
|---|---|---|
| Scanner error toast | Scanner.tsx | `errorMsg` state + UI for scan/upload failures, 4s auto-dismiss |
| Enhanced user prompt | Scanner.tsx | Multi-line hint with 📋 icon, "Place prescription inside frame" + "Ensure good lighting and clear text" subtext; changes to ⏳ "Analyzing with AI…" during capture |
| Collapsible tips badge | Scanner.tsx | 💡 "Tips for better scans" toggle with 4 tips (lighting, steady, full capture, no shadows) |
| Camera error steps | Scanner.tsx | Step-by-step instructions (lock icon → Camera → Allow → Refresh) |
| Image quality analysis | Scanner.tsx | Luminance + contrast check via canvas after capture/upload; shows green "Good lighting" or red "Too dark/bright/low contrast" badge at top of camera area, auto-dismisses after 3s |
| Cabinet tip | Scanner.tsx | "Tip: Align prescription so medicine names and time columns are clearly visible" between error area and capture dock |
| Accessibility | Scanner.tsx | `role="status"`, `aria-live="polite"`, `aria-label` on hint container; `aria-expanded` on tips toggle |
| CSS (26 new selectors) | index.css | `.scanner-hint-container`, `.hint-icon`, `.hint-text-group`, `.hint-text`, `.hint-subtext`, `.scanner-tips-badge`, `.tips-toggle-btn`, `.tips-content`, `.tips-list`, `.quality-badge[data-quality]`, `.cabinet-tip`, `.error-steps`, `.error-step-label`, `.error-steps-list` + keyframes `slideUpFade`, `slideDownFade` |

### Known gaps
- No production error tracker (Sentry/LogRocket) — frontend errors are DEV-only
- `family.py` query for family members resets on every render — should be in `useCallback`
- Some `finally` blocks may swallow secondary errors (e.g. `setLoading(false)` after reject)
