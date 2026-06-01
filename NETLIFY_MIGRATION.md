# Netlify Migration Guide

This document describes how to deploy the EWS (Apocalypse Early Warning System) project to Netlify, migrating from its original Cloudflare Pages + D1 setup.

---

## Architecture Overview

| Component | Cloudflare (Original) | Netlify (Target) |
|-----------|----------------------|------------------|
| Static Site | Cloudflare Pages | Netlify Sites |
| Serverless Functions | Pages Functions (`functions/api/`) | Netlify Functions (`netlify/functions/`) |
| Database | Cloudflare D1 (SQLite) | Turso / PlanetScale / Neon / Supabase |
| Object Storage | Cloudflare R2 | Keep R2 (public URLs still work) or migrate to S3 |
| Deployment | Wrangler CLI | Netlify CLI / Git-based |

---

## What Works Immediately

The **client-side SPA** (React + Vite) will build and deploy with zero changes:

- `netlify.toml` is configured with the correct build command (`npm ci && npm run build`)
- Output directory is `client/dist`
- Redirects for `/military`, `/untracked`, SPA fallback, and `/api/*` proxy are configured
- Security headers and caching are set

---

## What Requires Migration

### 1. Database (Cloudflare D1 → Turso/libSQL)

The serverless functions use Cloudflare D1 (edge SQLite) via `env.EWS_NOTIFY_DB`. The Netlify deployment includes a **D1-compatible adapter** (`netlify/functions/lib/db-adapter.js`) that wraps [Turso](https://turso.tech/) (libSQL) to expose the same API.

**Setup your Turso database:**

```bash
# Quick setup (applies all migrations automatically)
./scripts/setup_turso_db.sh

# Or manual setup:
npm install -g @turso/cli
turso auth login
turso db create ews-notifications
# Apply migrations
for f in migrations/*.sql; do turso db shell ews-notifications < "$f"; done
```

The adapter is already wired into the function router (`netlify/functions/api.js`). Just set these env vars in Netlify:

```
TURSO_DATABASE_URL=libsql://ewsnotifications-aratamagna.aws-us-east-1.turso.io
TURSO_AUTH_TOKEN=<your-auth-token-from-turso-dashboard>
```

### 2. Serverless Functions (Already Implemented)

The original Cloudflare Pages Functions use file-based routing:
- `functions/api/stripe/webhook.js` → `POST /api/stripe/webhook`
- `functions/api/manage/subscriber.js` → `GET|POST /api/manage/subscriber`

On Netlify, a single catch-all function (`netlify/functions/api.js`) routes all `/api/*` requests to the appropriate handler. The router:

1. Receives the Netlify event
2. Converts it to a standard Web API `Request`
3. Maps Netlify headers (e.g., `x-nf-client-connection-ip` → `cf-connecting-ip`)
4. Builds the `env` object with all `process.env` vars + the D1 database adapter
5. Calls the original handler with `{ request, env }`
6. Converts the Web API `Response` back to Netlify format

The redirect rule in `netlify.toml` proxies all `/api/*` traffic to the function:

```toml
[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api"
  status = 200
```

### 3. Environment Variables

Set these in Netlify UI → Site Settings → Environment Variables:

#### Build-time (Vite)
| Variable | Description |
|----------|-------------|
| `VITE_DASHBOARD_URL` | URL to main dashboard JSON snapshot |
| `VITE_MILITARY_DASHBOARD_URL` | URL to military dashboard JSON snapshot |
| `VITE_UNTRACKED_DASHBOARD_URL` | URL to untracked dashboard JSON snapshot |

#### Runtime (Functions)
| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRODUCT_ID` | Stripe product ID |
| `STRIPE_PRICE_ID` | (Optional) Stripe price ID |
| `SENDGRID_API_KEY` | SendGrid API key for emails |
| `SENDGRID_FROM_EMAIL` | SendGrid sender email |
| `SENDGRID_FROM_NAME` | SendGrid sender name |
| `TELNYX_API_KEY` | Telnyx API key for SMS |
| `TELNYX_NUMBER` | Telnyx sender phone number |
| `TELNYX_PUBLIC_KEY` | Telnyx public key for webhook verification |
| `INTERNAL_ALERT_TOKEN` | Bearer token for internal API calls |
| `NOTIFICATION_HASH_SECRET` | Secret for contact hashing |
| `NOTIFICATION_ENCRYPTION_KEY` | Key for contact encryption |
| `APP_BASE_URL` | Base URL of the deployed site |
| `EWS_PUBLIC_URL` | Public URL for the EWS site |
| `EWS_NOTIFICATION_URL` | Short URL used in notifications |
| `TURSO_DATABASE_URL` | Turso/libSQL database URL (e.g. `libsql://your-db.turso.io`) |
| `TURSO_AUTH_TOKEN` | Turso auth token for database access |

---

## Deployment Steps

### Option A: Git-based Deployment (Recommended)

1. Connect your GitHub repo to Netlify
2. Netlify auto-detects `netlify.toml`
3. Set environment variables in Netlify UI
4. Push to `main` to trigger deploy

### Option B: CLI Deployment

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login and link site
netlify login
netlify link

# Deploy (preview)
netlify deploy

# Deploy (production)
netlify deploy --prod
```

### Option C: GitHub Actions (included)

See `.github/workflows/deploy-netlify.yml` for automated CI/CD deployment.

---

## GitHub Actions Workflows to Update

The existing workflows call Cloudflare-hosted functions. Update the endpoint URLs:

| Workflow | Change |
|----------|--------|
| `refresh-live-data.yml` | Update `EWS_INTERNAL_ALERT_TOKEN` endpoint to Netlify URL |
| `send-renewal-reminders.yml` | Update endpoint to `https://<your-site>.netlify.app/api/internal/renewal-reminders` |

---

## Testing the Migration

### 1. Static Site Only (Quick Start)

Deploy without functions to verify the SPA works:

```bash
cd client && npm run build
netlify deploy --dir=client/dist
```

### 2. Functions (After DB Migration)

```bash
# Local development with Netlify Dev
netlify dev

# Test endpoints
curl -X POST http://localhost:8888/api/signup/create-checkout-session \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","phone":"+15551234567","smsConsent":true}'
```

---

## Known Limitations & Notes

1. **Stripe Webhook URL:** Update the webhook endpoint URL in Stripe Dashboard to `https://<your-site>.netlify.app/api/stripe/webhook`

2. **Telnyx Webhook URL:** Update in Telnyx portal to `https://<your-site>.netlify.app/api/telnyx/webhook`

3. **Function Timeout:** Netlify Functions have a 10s timeout (free) or 26s (Pro). The level 5 alert sends to all subscribers concurrently — ensure this completes within limits or use Netlify Background Functions.

4. **Cold Starts:** Netlify Functions may have cold starts. For the webhook endpoints (Stripe, Telnyx), this is usually acceptable.

5. **Request IP Header:** The code reads `cf-connecting-ip` for client IP. On Netlify, use `x-nf-client-connection-ip` or `x-forwarded-for`. Update `functions/_lib/http.js`:

   ```javascript
   export function getRequestIp(request) {
     return (
       request.headers.get("x-nf-client-connection-ip") ||
       request.headers.get("cf-connecting-ip") ||
       request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
       null
     );
   }
   ```

6. **Background Functions:** For the renewal reminders batch (which may take longer), consider using [Netlify Background Functions](https://docs.netlify.com/functions/background-functions/) by renaming the handler to `api-background.js`.

---

## File Structure After Migration

```
ews/
├── netlify.toml                          # Netlify build + deploy config
├── netlify/
│   ├── package.json                      # ESM module type for functions
│   └── functions/
│       ├── api.js                        # Unified API router
│       └── lib/
│           ├── db-adapter.js             # D1→Turso compatibility layer
│           └── request-context.js        # Netlify request helpers
├── client/                               # Vite React SPA (unchanged)
├── functions/                            # Original CF Pages Functions (imported by router)
│   ├── _lib/                             # Shared utilities
│   └── api/                              # Route handlers
├── scripts/
│   └── setup_turso_db.sh                 # Database setup automation
├── .github/workflows/
│   ├── deploy-netlify.yml                # CI/CD for Netlify
│   └── deploy-pages.yml                  # Original Cloudflare deploy (kept)
└── NETLIFY_MIGRATION.md                  # This file
```
