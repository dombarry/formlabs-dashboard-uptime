# Notification setup

When a check fails `ALERT_AFTER_FAILURES` times in a row (default 2, so about 10 minutes at a 5-minute schedule), the checker sends a **down** alert. When the check passes again it sends a **recovered** alert. Alerts can go to email (Resend), Slack, or both. Each channel is configured independently; leave a channel's env vars unset to turn it off.

After changing any env var in Vercel, redeploy so it takes effect:

```sh
npx vercel --prod
```

---

## Slack

Alerts post to one channel through a Slack [incoming webhook](https://api.slack.com/messaging/webhooks).

1. Go to https://api.slack.com/apps and click **Create New App**, then **From scratch**.
   - Name: `Dashboard Uptime`
   - Workspace: Formlabs
2. In the app settings, open **Incoming Webhooks** and turn it **On**.
3. Click **Add New Webhook to Workspace**, pick the channel (for example `#dashboard-status`), and click **Allow**.
   - If the Formlabs workspace requires admin approval for new apps, this step becomes a request to the Slack admins. Once they approve it, come back and finish.
4. Copy the webhook URL (`https://hooks.slack.com/services/T…/B…/…`).
5. In Vercel, go to **Project → Settings → Environment Variables** and add the following for Production:
   ```
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
   ```
   Or from the CLI: `npx vercel env add SLACK_WEBHOOK_URL production`
6. Redeploy.

Treat the webhook URL like a password: anyone who has it can post to that channel. Don't commit it. If it leaks, delete the webhook in the Slack app settings and create a new one.

**Test it** without waiting for an outage (run this in your own terminal so the URL stays out of shell history files you share):

```sh
curl -X POST -H 'Content-Type: application/json' \
  -d '{"text":"Test from Dashboard Uptime"}' "$SLACK_WEBHOOK_URL"
```

---

## Email (Resend)

| Env var | Required | Example |
|---|---|---|
| `RESEND_API_KEY` | yes | `re_...` |
| `ALERT_EMAIL_TO` | yes | `you@example.com`, or several addresses separated by commas |
| `ALERT_EMAIL_FROM` | once a domain is verified | `Dashboard Uptime <alerts@yourdomain.com>` |

### Default: only you get the email

Without `ALERT_EMAIL_FROM`, mail is sent from `onboarding@resend.dev`. Resend only delivers that address's mail to **the email on your Resend account**, so `ALERT_EMAIL_TO` must be exactly that address. Mail to any other recipient is rejected.

### Sending to other people or a Google Group

1. **Verify a domain in Resend.** Go to https://resend.com/domains, click **Add Domain**, and add the DNS records it shows (SPF, DKIM and optionally DMARC) at your DNS provider. Verification usually takes a few minutes.
   - **A domain you own:** you can do this yourself.
   - **A subdomain of formlabs.com** (for example `alerts.formlabs.com`): IT has to add the DNS records and approve sending as Formlabs.
2. Set `ALERT_EMAIL_FROM` to an address on that domain, for example `Dashboard Uptime <alerts@yourdomain.com>`.
3. Set `ALERT_EMAIL_TO` to the group address, for example `dashboard-status@formlabs.com`. You can list several addresses separated by commas.
4. Redeploy.

### Google Group settings

Using a group means people can join and leave on their own, without anyone touching env vars.

1. Create the group at https://groups.google.com, for example `dashboard-status@formlabs.com`.
2. Open **Group settings → General**. If the sender domain is outside formlabs.com, set **Who can post** to allow external posts. Workspace admins may have to permit that. Alternatively, keep posting restricted and approve the sender address once from the moderation queue.
3. Send a test alert (see below) and check that it isn't held for moderation or sent to spam.

### Limits

On Resend's free plan:
- up to 100 emails a day and 3,000 a month
- up to 50 recipients per email

An outage produces two emails (down and recovered), so the limits only matter if you list individual recipients instead of using a group.

---

## Testing an alert end to end

Alerts only fire on a state change, so a healthy system never sends one. To test, temporarily point a check at a URL that's always down:

1. In `lib/checks.ts`, change the `dashboard-web` URL to `https://down.invalid/`. The `.invalid` domain never resolves, so the check always fails.
2. Deploy with `npx vercel --prod`, then wait for two scheduled runs (about 10 minutes). Alternatively, call the checker twice yourself:
   ```sh
   npx vercel curl "https://formlabs-dashboard-uptime.vercel.app/api/check" -- -H "Authorization: Bearer $CRON_SECRET"
   ```
3. You should get a **DOWN** alert.
4. Revert the URL, deploy again and run the checker once more. You should get a **RECOVERED** alert.

If nothing arrives, check the logs:

```sh
npx vercel logs --deployment formlabs-dashboard-uptime.vercel.app --since 30m --query 'level:error'
```

Look for `Failed to send alert email` or `Failed to send Slack alert`. Resend's dashboard (**Emails** tab) also shows each send attempt and why it was rejected.

---

## Mac menu bar app

`macos/` contains a small menu bar app that polls `/api/status` every minute. It shows a coloured dot, lists each check in its menu, and posts a macOS notification when the dashboard goes down or recovers. It doesn't use Slack or email.

Build it:

```sh
STATUS_PAGE_URL=https://formlabs-dashboard-uptime.vercel.app ./macos/build.sh
```

Then share `macos/dist/DashboardStatus.zip`. The app is ad-hoc signed, so recipients need to do this the first time:
1. Unzip it and move **Dashboard Status.app** to Applications.
2. Open it. macOS blocks the first launch because the app isn't from an identified developer:
   - **macOS 15 and later:** close the warning, then go to **System Settings → Privacy & Security** and click **Open Anyway** next to "Dashboard Status".
   - **macOS 13–14:** **right-click → Open → Open**.
3. Allow notifications when asked. To have the app start automatically, choose **Launch at Login** from its menu.

For a warning-free install, the app has to be signed with a Developer ID and notarized. Build with `SIGN_IDENTITY="Developer ID Application: …"`, then notarize the zip with `xcrun notarytool`.
