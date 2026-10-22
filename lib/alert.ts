import { Resend } from "resend";
import type { CheckDef, CheckResult } from "./checks";

export type Transition = { check: CheckDef; result: CheckResult; kind: "down" | "recovered"; since?: number };

const fmtDuration = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export async function sendAlert(transitions: Transition[], now: number) {
  if (!transitions.length) return;
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  if (!key || !to) {
    console.warn("RESEND_API_KEY / ALERT_EMAIL_TO not set; skipping alert", transitions.map((t) => t.check.id));
    return;
  }

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
  const page = process.env.STATUS_PAGE_URL;
  const text = [...lines, "", `Checked at ${new Date(now).toISOString()}`, ...(page ? [page] : [])].join("\n");

  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: process.env.ALERT_EMAIL_FROM ?? "Dashboard Uptime <onboarding@resend.dev>",
    to: to.split(",").map((s) => s.trim()),
    subject,
    text,
  });
  if (error) console.error("Failed to send alert email", error);
}
