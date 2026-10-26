import { percentile } from "./percentile";
import type { Sample } from "./store";

export const WINDOW_DAYS = 7;
export const WINDOW_MS = WINDOW_DAYS * 86_400_000;
// Below these counts the percentile is just "the slowest check or two", so it isn't shown
export const MIN_SAMPLES_P95 = 20;
export const MIN_SAMPLES_P99 = 100;
// A window counts as a full week if its oldest sample is within one check interval of 7 days ago
const FULL_WINDOW_SLACK_MS = 10 * 60_000;

export type LatencyWindow = {
  samples: number;
  failed: number;
  firstAt: number | null;
  now: number;
  p95: number | null;
  p99: number | null;
  timeoutMs: number;
};

// Rolling window of the last WINDOW_MS. Failed checks (timeouts or errors) count as the timeout limit
// rather than being dropped, so slow-to-the-point-of-failing doesn't make the numbers look better.
export function summarizeWindow(samples: Sample[], now: number, timeoutMs: number): LatencyWindow {
  const inWindow = samples.filter((s) => s.t > now - WINDOW_MS && s.t <= now);
  const values = inWindow.map((s) => (s.s === "down" ? timeoutMs : Math.min(s.ms, timeoutMs)));
  return {
    samples: inWindow.length,
    failed: inWindow.filter((s) => s.s === "down").length,
    firstAt: inWindow.length ? Math.min(...inWindow.map((s) => s.t)) : null,
    now,
    p95: values.length >= MIN_SAMPLES_P95 ? percentile(values, 0.95) : null,
    p99: values.length >= MIN_SAMPLES_P99 ? percentile(values, 0.99) : null,
    timeoutMs,
  };
}

// Rounds up so "under X s" stays true for the value it describes
export function fmtSeconds(ms: number) {
  return `${(Math.ceil(ms / 100) / 10).toFixed(1)} s`;
}

export function fmtSpan(ms: number) {
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (days === 0) return hours === 0 ? "under 1 hour" : plural(hours, "hour");
  return rest === 0 ? plural(days, "day") : `${plural(days, "day")} ${plural(rest, "hour")}`;
}

const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

export type LatencyLabels = {
  heading: string;
  p95: string;
  p99: string;
};

export function latencyLabels(w: LatencyWindow): LatencyLabels {
  const checks = `${w.samples.toLocaleString("en-US")} check${w.samples === 1 ? "" : "s"}`;
  const full = w.firstAt !== null && w.now - w.firstAt >= WINDOW_MS - FULL_WINDOW_SLACK_MS;
  const heading =
    w.firstAt === null
      ? "Response time: no checks recorded yet"
      : full
        ? `Response time, last ${WINDOW_DAYS} days (${checks})`
        : `Response time, last ${fmtSpan(w.now - w.firstAt)} (${checks} since ${fmtDate(w.firstAt)})`;

  const line = (share: number, value: number | null, min: number) => {
    if (value === null) return `Not enough checks yet (needs ${min})`;
    if (value >= w.timeoutMs) return `${share}% of checks finished in ${w.timeoutMs / 1000} s+ (timeout)`;
    return `${share}% of checks finished in under ${fmtSeconds(value)}`;
  };

  return {
    heading,
    p95: line(95, w.p95, MIN_SAMPLES_P95),
    p99: line(99, w.p99, MIN_SAMPLES_P99),
  };
}
