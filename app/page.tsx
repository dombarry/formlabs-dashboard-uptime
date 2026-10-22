import { CHECKS, type CheckStatus } from "@/lib/checks";
import {
  HISTORY_DAYS,
  getDailyHistory,
  getIncidents,
  getLastRun,
  getRecent,
  type DayCounts,
} from "@/lib/store";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<CheckStatus | "unknown", string> = {
  up: "Operational",
  degraded: "Slow",
  down: "Down",
  unknown: "No data",
};

function dayClass(c: DayCounts | null) {
  if (!c) return "none";
  const total = c.up + c.degraded + c.down;
  if (!total) return "none";
  if (c.down === 0) return c.degraded === 0 ? "up" : "degraded";
  return c.down / total < 0.05 ? "partial" : "down";
}

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
  const [lastRun, incidents, checks] = await Promise.all([
    getLastRun(),
    getIncidents(),
    Promise.all(
      CHECKS.map(async (c) => {
        const [days, recent] = await Promise.all([getDailyHistory(c.id, now), getRecent(c.id)]);
        const totals = days.reduce(
          (a, d) => {
            if (!d.counts) return a;
            return { ok: a.ok + d.counts.up + d.counts.degraded, all: a.all + d.counts.up + d.counts.degraded + d.counts.down };
          },
          { ok: 0, all: 0 },
        );
        const latest = recent[0];
        const okRecent = recent.filter((s) => s.s !== "down");
        const avgMs = okRecent.length ? Math.round(okRecent.reduce((a, s) => a + s.ms, 0) / okRecent.length) : null;
        return {
          ...c,
          days,
          latest,
          avgMs,
          uptime: totals.all ? (totals.ok / totals.all) * 100 : null,
        };
      }),
    ),
  ]);

  const statuses = checks.map((c) => c.latest?.s);
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
      <header>
        <h1>Formlabs Dashboard Status</h1>
        <p className="muted">Unofficial monitor for dashboard.formlabs.com and the APIs behind it</p>
      </header>

      <section className={`banner ${overall}`}>
        <span className={`dot ${overall}`} />
        <strong>{banner}</strong>
        {lastRun && <span className="muted small">Last checked {fmtTime(lastRun)} ET</span>}
      </section>
      {stale && <p className="warn small">The checker hasn&apos;t run in over 15 minutes, so this data may be stale.</p>}

      <section className="card">
        {checks.map((c) => {
          const status = c.latest?.s ?? "unknown";
          return (
            <div className="check" key={c.id}>
              <div className="check-head">
                <div>
                  <div className="name">{c.name}</div>
                  <div className="muted small">{c.description}</div>
                </div>
                <div className={`pill ${status}`}>{STATUS_LABEL[status]}</div>
              </div>
              <div className="bars" aria-label={`${HISTORY_DAYS} day history`}>
                {c.days.map((d) => {
                  const total = d.counts ? d.counts.up + d.counts.degraded + d.counts.down : 0;
                  const tip = total
                    ? `${d.date}: ${pct(((total - d.counts!.down) / total) * 100)}% up (${d.counts!.down} failed of ${total} checks)`
                    : `${d.date}: no data`;
                  return <span key={d.date} className={`bar ${dayClass(d.counts)}`} title={tip} />;
                })}
              </div>
              <div className="check-foot muted small">
                <span>{HISTORY_DAYS} days ago</span>
                <span>
                  {c.uptime !== null ? `${pct(c.uptime)}% uptime` : "—"}
                  {c.avgMs !== null && ` · ${c.avgMs} ms avg (24h)`}
                </span>
                <span>Today</span>
              </div>
              {c.latest?.e && status === "down" && <div className="err small">{c.latest.e}</div>}
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
