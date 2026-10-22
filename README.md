# Formlabs Dashboard Uptime

Unofficial status page and email alerting for Formlabs Dashboard.

- `GET /api/check`: runs the health checks, records the results in Redis and sends an email when a check goes down or recovers. Requires `Authorization: Bearer $CRON_SECRET`.
- `/`: the status page, with 90-day uptime bars, current status, average latency and recent incidents.

## Checks

| Check | What it hits | Healthy when |
|---|---|---|
| Dashboard website | `https://dashboard.formlabs.com/` | 2xx/3xx |
| Printernet API | `api.formlabs.com/printernet/v1/my/groups/`, unauthenticated | 401/403 (anything 5xx or a timeout counts as down) |
| Printer groups* | `api.formlabs.com/developer/v1/groups/` | 2xx |
| Printers* | `api.formlabs.com/developer/v1/printers/` | 2xx |

\* These checks only run when `FORMLABS_CLIENT_ID` and `FORMLABS_CLIENT_SECRET` are set. Create the credentials in Dashboard under Developer Tools. See https://developer.formlabs.com/.

A response slower than 8s counts as **degraded**. A failed request or a timeout after 20s counts as **down**. An alert email goes out after `ALERT_AFTER_FAILURES` consecutive failures (default 2). A recovery email follows when the check passes again.

## Setup

1. **Deploy to Vercel.** Push this folder to a GitHub repo and import it into Vercel. You can also run `npx vercel` from this folder.
2. **Add Redis.** In the Vercel project, go to Storage, then Marketplace, then Upstash for Redis (the free plan). Connect it to the project; this sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. **Set up email.** Sign up at https://resend.com and create an API key. Set `RESEND_API_KEY` and `ALERT_EMAIL_TO`. Without a verified domain, Resend only delivers to the email address you signed up with, so use that address.
4. **Set the remaining env vars** from `.env.example`: `CRON_SECRET` (generate one with `openssl rand -hex 32`), `STATUS_PAGE_URL`, and the optional Formlabs credentials. Redeploy afterwards.
5. **Schedule the checker.** Vercel Hobby cron jobs can only run once a day, so use an external scheduler:
   - **cron-job.org** (free, recommended): create a job that sends a GET to `https://<your-app>.vercel.app/api/check` every 5 minutes, with the header `Authorization: Bearer <CRON_SECRET>`.
   - **GitHub Actions** (backup, already in `.github/workflows/uptime.yml`): add `CRON_SECRET` and `STATUS_PAGE_URL` as repo secrets. GitHub's cron often runs late, so don't rely on it alone.

Run every 5 minutes, the checker uses about 200k Redis commands a month, which fits Upstash's free tier. Running every minute would go over it.

## Local dev

```sh
cp .env.example .env.local   # fill in
npm install
npm run dev
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/check
```
