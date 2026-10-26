import { describe, expect, it } from "vitest";
import { WINDOW_MS, fmtSeconds, fmtSpan, latencyLabels, summarizeWindow } from "./latency";
import type { Sample } from "./store";

const TIMEOUT = 20_000;
const FIVE_MIN = 5 * 60_000;
// 2026-10-26 12:00 ET
const NOW = Date.UTC(2026, 9, 26, 16, 0, 0);

// `count` checks every 5 minutes ending at NOW, with response times from `msAt(i)`
function series(count: number, msAt: (i: number) => number, status: (i: number) => Sample["s"] = () => "up"): Sample[] {
  return Array.from({ length: count }, (_, i) => ({ t: NOW - (count - 1 - i) * FIVE_MIN, s: status(i), ms: msAt(i) }));
}

describe("summarizeWindow", () => {
  it("only uses samples from the last 7 days", () => {
    const old: Sample = { t: NOW - WINDOW_MS - 1, s: "up", ms: 1 };
    const w = summarizeWindow([old, ...series(30, () => 5_000)], NOW, TIMEOUT);
    expect(w.samples).toBe(30);
    expect(w.firstAt).toBe(NOW - 29 * FIVE_MIN);
  });

  it("counts failed checks as the timeout instead of dropping them", () => {
    // 98 fast checks and 2 timeouts (recorded at ~20.003 s): P99 must land on the timeout
    const samples = series(100, (i) => (i < 98 ? 10_000 : 20_003), (i) => (i < 98 ? "up" : "down"));
    const w = summarizeWindow(samples, NOW, TIMEOUT);
    expect(w.failed).toBe(2);
    expect(w.p99).toBe(TIMEOUT);
    expect(w.p95).toBe(10_000);
  });

  it("counts a fast error as a timeout too, so failures never improve the numbers", () => {
    const samples = series(100, (i) => (i < 98 ? 10_000 : 150), (i) => (i < 98 ? "up" : "down"));
    expect(summarizeWindow(samples, NOW, TIMEOUT).p99).toBe(TIMEOUT);
  });

  it("withholds percentiles below the minimum sample counts", () => {
    expect(summarizeWindow(series(19, () => 1_000), NOW, TIMEOUT).p95).toBeNull();
    expect(summarizeWindow(series(20, () => 1_000), NOW, TIMEOUT).p95).toBe(1_000);
    expect(summarizeWindow(series(99, () => 1_000), NOW, TIMEOUT).p99).toBeNull();
    expect(summarizeWindow(series(100, () => 1_000), NOW, TIMEOUT).p99).toBe(1_000);
  });
});

describe("formatting", () => {
  it("rounds seconds up so 'under X s' stays true", () => {
    expect(fmtSeconds(14_620)).toBe("14.7 s");
    expect(fmtSeconds(14_600)).toBe("14.6 s");
    expect(fmtSeconds(950)).toBe("1.0 s");
  });

  it("describes spans in days and hours", () => {
    expect(fmtSpan(30 * 60_000)).toBe("under 1 hour");
    expect(fmtSpan(5 * 3_600_000)).toBe("5 hours");
    expect(fmtSpan(24 * 3_600_000)).toBe("1 day");
    expect(fmtSpan((4 * 24 + 4) * 3_600_000 + 59 * 60_000)).toBe("4 days 4 hours");
  });
});

describe("latencyLabels", () => {
  it("labels a full week as 'last 7 days'", () => {
    const week = series(2016, (i) => 9_000 + (i % 100) * 50);
    const labels = latencyLabels(summarizeWindow(week, NOW, TIMEOUT));
    expect(labels.heading).toBe("Response time, last 7 days (2,016 checks)");
    expect(labels.p95).toBe("95% of checks finished in under 13.7 s");
    expect(labels.p99).toBe("99% of checks finished in under 13.9 s");
  });

  it("shows the real count and span when there is less than a week of data", () => {
    // 1,200 checks at 5-minute intervals: 4 days 3 hours 55 minutes, starting Oct 22 at 8:05 AM ET
    const partial = series(1_200, () => 10_000);
    const labels = latencyLabels(summarizeWindow(partial, NOW, TIMEOUT));
    expect(labels.heading).toBe("Response time, last 4 days 3 hours (1,200 checks since Oct 22)");
    expect(labels.heading).not.toContain("7 days");
  });

  it("shows '20 s+ (timeout)' instead of a number when P99 lands on a timeout", () => {
    const samples = series(200, (i) => (i < 196 ? 10_000 : 20_001), (i) => (i < 196 ? "up" : "down"));
    const labels = latencyLabels(summarizeWindow(samples, NOW, TIMEOUT));
    expect(labels.p99).toBe("99% of checks finished in 20 s+ (timeout)");
    expect(labels.p95).toBe("95% of checks finished in under 10.0 s");
  });

  it("says when there are not enough checks yet", () => {
    const labels = latencyLabels(summarizeWindow(series(50, () => 3_000), NOW, TIMEOUT));
    expect(labels.p95).toBe("95% of checks finished in under 3.0 s");
    expect(labels.p99).toBe("Not enough checks yet (needs 100)");
    expect(latencyLabels(summarizeWindow([], NOW, TIMEOUT)).heading).toBe("Response time: no checks recorded yet");
  });
});
