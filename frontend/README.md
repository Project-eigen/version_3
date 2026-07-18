# DawaiSathi frontend

React + TypeScript + Vite PWA for the family medicine cabinet.

## Local

```bash
npm install
npm run dev
```

Default: http://localhost:5173 — API via Vite proxy or `VITE_API_URL`.

## Production build

```bash
# Point the SPA at the Render API (if not same-origin)
export VITE_API_URL=https://dawaisathi-api.onrender.com

npm run build
# Output: dist/  → deploy as Render static site
```

## App routes (high level)

| Path | Page |
|------|------|
| `/` | Auth gate |
| `/home` | Family |
| `/cabinet` | Medicine cabinet |
| `/scanner` | Prescription scan |
| `/settings` | Alerts + **Notification health** |

## Ops docs

Backend deploy, env vars, Supabase pooler, Cloudinary, and **curl** examples:

→ [../DEPLOY.md](../DEPLOY.md)

Main project readme: [../README.md](../README.md)
