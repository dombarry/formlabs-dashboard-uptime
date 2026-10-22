import { Resend } from "resend";
import type { CheckDef, CheckResult } from "./checks";

export type Transition = { check: CheckDef; result: CheckResult; kind: "down" | "recovered"; since?: number };

type Message = { subject: string; lines: string[]; checkedAt: string; page?: string };

const fmtDuration = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

function buildMessage(transitions: Transition[], now: number): Message {
  const anyDown = transitions.some((t) => t.kind === "down");
  const subject = anyDown
    ? `🔴 Formlabs Dashboard DOWN: ${transitions.filter((t) => t.kind === "down").map((t) => t.check.name).join(", ")}`
    : `🟢 Formlabs Dashboard recovered: ${transitions.map((t) => t.check.name).join(", ")}`;

  const lines = transitions.map((t) => {
    if (t.kind === "down") {
      const detail = t.result.error ?? `HTTP ${t.result.httpStatus}`;
      return `DOWN: ${t.check.name} (${t.check.description})\n  ${detail}, ${t.result.ms} ms`;
    }
    const dur = t.since ? ` after ${fmtDuration(now - t.since)}` : "";
    return `RECOVERED${dur}: ${t.check.name}\n  ${t.result.ms} ms`;
  });
  return { subject, lines, checkedAt: new Date(now).toISOString(), page: process.env.STATUS_PAGE_URL };
}

async function sendEmail(msg: Message) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  if (!key || !to) {
    console.warn("RESEND_API_KEY / ALERT_EMAIL_TO not set; skipping email alert");
    return;
  }
  const text = [...msg.lines, "", `Checked at ${msg.checkedAt}`, ...(msg.page ? [msg.page] : [])].join("\n");
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: process.env.ALERT_EMAIL_FROM ?? "Dashboard Uptime <onboarding@resend.dev>",
    to: to.split(",").map((s) => s.trim()),
    subject: msg.subject,
    text,
  });
  if (error) console.error("Failed to send alert email", error);
}

async function sendSlack(msg: Message) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  const body = msg.lines.map((l) => l.replace(/^(DOWN|RECOVERED[^:]*):/, "*$1:*")).join("\n");
  const footer = msg.page ? `<${msg.page}|Status page> · checked ${msg.checkedAt}` : `Checked ${msg.checkedAt}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // `text` is the fallback shown in notifications; blocks are what renders in the channel
      text: msg.subject,
      blocks: [
        { type: "header", text: { type: "plain_text", text: msg.subject, emoji: true } },
        { type: "section", text: { type: "mrkdwn", text: body } },
        { type: "context", elements: [{ type: "mrkdwn", text: footer }] },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) console.error("Failed to send Slack alert", res.status, await res.text());
}

export async function sendAlert(transitions: Transition[], now: number) {
  if (!transitions.length) return;
  const msg = buildMessage(transitions, now);
  // One channel failing shouldn't stop the other from going out
  const results = await Promise.allSettled([sendEmail(msg), sendSlack(msg)]);
  for (const r of results) if (r.status === "rejected") console.error("Alert delivery failed", r.reason);
}
