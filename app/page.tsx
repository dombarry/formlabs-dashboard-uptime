import Link from "next/link";
import { CHECKS, type CheckStatus } from "@/lib/checks";
import { HISTORY_DAYS, getDailyHistory, getIncidents, getSummary } from "@/lib/store";
import DayBars from "./DayBars";

export const dynamic = "force-dynamic";

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

const fmtDuration = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

export default async function Page() {
  const now = Date.now();
  const [summary, incidents, checks] = await Promise.all([
    getSummary(),
    getIncidents(),
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
          <p className="muted">Unofficial monitor for dashboard.formlabs.com and the APIs behind it</p>
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
            </div>
          );
        })}
      </section>

      <section>
        <h2>Recent incidents</h2>
        {incidents.length === 0 ? (
          <p className="muted">No incidents recorded.</p>
        ) : (
          <ul className="incidents">
            {incidents.map((i) => {
              const check = CHECKS.find((c) => c.id === i.check);
              return (
                <li key={`${i.check}-${i.start}`}>
                  <span className={`dot ${i.end ? "up" : "down"}`} />
                  <div>
                    <strong>{check?.name ?? i.check}</strong>{" "}
                    <span className="muted">
                      {i.end ? `resolved after ${fmtDuration(i.end - i.start)}` : `ongoing for ${fmtDuration(now - i.start)}`}
                    </span>
                    <div className="muted small">
                      Started {fmtTime(i.start)} ET{i.error ? ` · ${i.error}` : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
