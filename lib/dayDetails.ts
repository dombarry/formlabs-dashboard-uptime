import type { CheckStatus } from "./checks";
import { percentile } from "./percentile";
import type { Incident, Sample } from "./store";

export type ProblemWindow = {
  kind: "down" | "degraded";
  start: number;
  // null while the problem is still ongoing
  end: number | null;
  samples: number;
  worstMs: number;
  error: string | null;
};

export type DayDetails = {
  date: string;
  samples: number;
  counts: Record<CheckStatus, number>;
  downMinutes: number;
  degradedMinutes: number;
  windows: ProblemWindow[];
  errors: { error: string; count: number }[];
  latency: { p50: number; p95: number; max: number } | null;
  incidents: Incident[];
};

const DEFAULT_INTERVAL_MS = 5 * 60_000;

function mostCommon(values: string[]) {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([error, count]) => ({ error, count }));
}

export function summarizeDay(
  date: string,
  samples: Sample[],
  incidents: Incident[],
  dayStart: number,
  dayEnd: number,
  isToday: boolean,
): DayDetails {
  const sorted = [...samples].sort((a, b) => a.t - b.t);

  // Typical spacing between checks, used to close a window that runs to the end of the day
  const gaps = sorted.slice(1).map((s, i) => s.t - sorted[i].t);
  const interval = percentile(gaps, 0.5) ?? DEFAULT_INTERVAL_MS;

  // Group consecutive non-up samples of the same kind into windows; a window ends at the next sample that differs
  const windows: ProblemWindow[] = [];
  const errorsByWindow: string[][] = [];
  for (const [i, s] of sorted.entries()) {
    if (s.s === "up") continue;
    const prev = sorted[i - 1];
    if (!prev || prev.s !== s.s) {
      windows.push({ kind: s.s, start: s.t, end: null, samples: 0, worstMs: 0, error: null });
      errorsByWindow.push([]);
    }
    const w = windows[windows.length - 1];
    w.samples++;
    w.worstMs = Math.max(w.worstMs, s.ms);
    if (s.e) errorsByWindow[errorsByWindow.length - 1].push(s.e);
    const next = sorted[i + 1];
    if (next && next.s !== s.s) w.end = next.t;
    else if (!next) w.end = isToday ? null : Math.min(s.t + interval, dayEnd);
  }
  windows.forEach((w, i) => (w.error = mostCommon(errorsByWindow[i])[0]?.error ?? null));

  const minutes = (kind: ProblemWindow["kind"]) =>
    Math.round(windows.filter((w) => w.kind === kind).reduce((a, w) => a + ((w.end ?? Date.now()) - w.start), 0) / 60_000);

  const okMs = sorted.filter((s) => s.s !== "down").map((s) => s.ms).sort((a, b) => a - b);
  const counts = { up: 0, degraded: 0, down: 0 };
  for (const s of sorted) counts[s.s]++;

  return {
    date,
    samples: sorted.length,
    counts,
    downMinutes: minutes("down"),
    degradedMinutes: minutes("degraded"),
    windows,
    errors: mostCommon(sorted.flatMap((s) => (s.e ? [s.e] : []))),
    latency: okMs.length ? { p50: percentile(okMs, 0.5)!, p95: percentile(okMs, 0.95)!, max: okMs[okMs.length - 1] } : null,
    incidents: incidents.filter((i) => i.start < dayEnd && (i.end ?? Infinity) > dayStart),
  };
}
