import Link from "next/link";
import { CHECKS, type CheckStatus } from "@/lib/checks";
import { latencyLabels, type LatencyLabels } from "@/lib/latency";
import { getLatencyWindow } from "@/lib/latencyWindow";
import { HISTORY_DAYS, getDailyHistory, getSummary } from "@/lib/store";
import DayBars from "./DayBars";

export const dynamic = "force-dynamic";

// The only check with P95/P99 shown; requested for tracking database performance work
const LATENCY_CHECK = "api-printers";

const STATUS_LABEL: Record<CheckStatus | "unknown", string> = {
  up: "Operational",
  degraded: "Slow",
  down: "Down",
  unknown: "No data",
};

const pct = (n: number) => (n >= 99.995 ? "100" : n.toFixed(2));

const fmtTime = (t: number) =>
  new Date(t).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default async function Page() {
  const now = Date.now();
  const hasLatencyCheck = CHECKS.some((c) => c.id === LATENCY_CHECK);
  const [summary, latencyWindow, checks] = await Promise.all([
    getSummary(),
    hasLatencyCheck ? getLatencyWindow(LATENCY_CHECK) : null,
    Promise.all(
      CHECKS.map(async (c) => {
        const days = await getDailyHistory(c.id, now);
        const totals = days.reduce(
          (a, d) => {
            if (!d.counts) return a;
            return { ok: a.ok + d.counts.up + d.counts.degraded, all: a.all + d.counts.up + d.counts.degraded + d.counts.down };
          },
          { ok: 0, all: 0 },
        );
        const today = days[days.length - 1].counts;
        const okToday = today ? today.up + today.degraded : 0;
        return {
          ...c,
          days,
          avgMs: today && okToday ? Math.round(today.msSum / okToday) : null,
          uptime: totals.all ? (totals.ok / totals.all) * 100 : null,
        };
      }),
    ),
  ]);

  const lastRun = summary?.lastRun ?? null;
  const latest = new Map(summary?.checks.map((c) => [c.id, c]));
  const statuses = checks.map((c) => latest.get(c.id)?.status);
  const overall: CheckStatus | "unknown" = !lastRun
    ? "unknown"
    : statuses.includes("down")
      ? "down"
      : statuses.includes("degraded")
        ? "degraded"
        : "up";
  const banner = {
    up: "All systems operational",
    degraded: "Dashboard is responding slowly",
    down: "Dashboard is having problems",
    unknown: "Waiting for the first check",
  }[overall];
  const stale = lastRun && now - lastRun > 15 * 60_000;

  return (
    <main>
      <header className="page-head">
        <div>
          <h1>Formlabs Dashboard Status</h1>
          <p className="muted">
            Unofficial monitor for Formlabs Dashboard. Checks run every 5 minutes; printers-endpoint response times
            show P95 and P99.
          </p>
        </div>
        <Link className="btn secondary" href="/mac">
          Get the Mac menu bar app
        </Link>
      </header>

      <section className={`banner ${overall}`}>
        <span className={`dot ${overall}`} />
        <strong>{banner}</strong>
        {lastRun && <span className="muted small">Last checked {fmtTime(lastRun)} ET</span>}
      </section>
      {stale && <p className="warn small">The checker hasn&apos;t run in over 15 minutes, so this data may be stale.</p>}

      <section className="card">
        {checks.map((c) => {
          const current = latest.get(c.id);
          const status = current?.status ?? "unknown";
          return (
            <div className="check" key={c.id}>
              <div className="check-head">
                <div>
                  <div className="name">{c.name}</div>
                  <div className="muted small">{c.description}</div>
                </div>
                <div className={`pill ${status}`}>{STATUS_LABEL[status]}</div>
              </div>
              <DayBars checkId={c.id} days={c.days} />
              <div className="check-foot muted small">
                <span>{HISTORY_DAYS} days ago</span>
                <span>
                  {c.uptime !== null ? `${pct(c.uptime)}% uptime` : "—"}
                  {c.avgMs !== null && ` · ${c.avgMs} ms avg today`}
                </span>
                <span>Today</span>
              </div>
              {current?.error && status === "down" && <div className="err small">{current.error}</div>}
              {c.id === LATENCY_CHECK && latencyWindow && <LatencyBlock labels={latencyLabels(latencyWindow)} />}
            </div>
          );
        })}
      </section>

      <section className="how">
        <h2>How this is measured</h2>
        <ul className="muted small">
          <li>
            Every 5 minutes, one request is sent to each endpoint above, including the printers endpoint (
            <code>api.formlabs.com/developer/v1/printers/</code>), from a single Vercel server in US-East.
          </li>
          <li>
            P95: 95% of checks finished faster than this. P99: 99% did. Both cover the same rolling 7 days, and checks
            that time out (or fail) count as 20 s.
          </li>
          <li>
            Alerts fire after 2 failed checks in a row (an error or a 20 s timeout). Slow responses alone never trigger
            an alert.
          </li>
          <li>Short spikes that happen between checks can be missed.</li>
        </ul>
      </section>
    </main>
  );
}

function LatencyBlock({ labels }: { labels: LatencyLabels }) {
  return (
    <div className="latency small">
      <div className="muted">{labels.heading}</div>
      <div className="latency-row">
        <span>{labels.p95}</span>
        <span className="muted">P95</span>
      </div>
      <div className="latency-row">
        <span>{labels.p99}</span>
        <span className="muted">P99</span>
      </div>
    </div>
  );
}
