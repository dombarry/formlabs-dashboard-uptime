"use client";

import { useState } from "react";
import type { DayDetails, ProblemWindow } from "@/lib/dayDetails";
import type { DayCounts } from "@/lib/store";

type Day = { date: string; counts: DayCounts | null };

// Shared across all checks' bars so re-hovering a day never refetches
const cache = new Map<string, DayDetails | "error">();

const TZ = "America/New_York";
const fmtClock = (t: number) => new Date(t).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const fmtDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const fmtMinutes = (m: number) => (m < 60 ? `${Math.max(1, m)} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

export function dayClass(c: DayCounts | null) {
  if (!c) return "none";
  const total = c.up + c.degraded + c.down;
  if (!total) return "none";
  if (c.down === 0) return c.degraded === 0 ? "up" : "degraded";
  return c.down / total < 0.05 ? "partial" : "down";
}

function WindowRow({ w }: { w: ProblemWindow }) {
  const range = `${fmtClock(w.start)} – ${w.end ? fmtClock(w.end) : "now"}`;
  const minutes = Math.round(((w.end ?? Date.now()) - w.start) / 60_000);
  const detail = w.kind === "down" ? (w.error ?? "Failed") : `slowest ${fmtMs(w.worstMs)}`;
  return (
    <li>
      <span className={`dot ${w.kind}`} />
      <span>
        <strong>{range}</strong> · {fmtMinutes(minutes)}
        <span className="muted"> · {detail}</span>
      </span>
    </li>
  );
}

function Popover({ day, details }: { day: Day; details: DayDetails | "error" | undefined }) {
  const c = day.counts;
  const total = c ? c.up + c.degraded + c.down : 0;
  const uptime = total ? ((total - c!.down) / total) * 100 : null;

  return (
    <>
      <div className="pop-head">
        <strong>{fmtDate(day.date)}</strong>
        {uptime !== null && <span className="muted">{uptime >= 99.995 ? "100" : uptime.toFixed(2)}% up</span>}
      </div>
      {!total && <div className="muted">No data recorded</div>}
      {total > 0 && details === undefined && <div className="muted">Loading details…</div>}
      {details === "error" && <div className="muted">Couldn&apos;t load details</div>}
      {details && details !== "error" && details.samples === 0 && total > 0 && (
        <div className="muted">
          {c!.down} failed, {c!.degraded} slow of {total} checks. Detailed timeline wasn&apos;t recorded for this day.
        </div>
      )}
      {details && details !== "error" && details.samples > 0 && (
        <>
          {details.windows.length === 0 ? (
            <div className="ok">No problems recorded</div>
          ) : (
            <>
              <div className="pop-summary">
                {details.downMinutes > 0 && <span className="down-text">Down {fmtMinutes(details.downMinutes)}</span>}
                {details.degradedMinutes > 0 && <span className="degraded-text">Slow {fmtMinutes(details.degradedMinutes)}</span>}
              </div>
              <ul className="windows">
                {details.windows.slice(0, 6).map((w) => (
                  <WindowRow key={w.start} w={w} />
                ))}
              </ul>
              {details.windows.length > 6 && <div className="muted">+{details.windows.length - 6} more</div>}
            </>
          )}
          {details.errors.length > 0 && (
            <div className="pop-section">
              <div className="muted">Errors</div>
              {details.errors.slice(0, 3).map((e) => (
                <div key={e.error} className="mono">
                  {e.error} ×{e.count}
                </div>
              ))}
            </div>
          )}
          {details.latency && (
            <div className="pop-section muted">
              Response: typical {fmtMs(details.latency.p50)} · p95 {fmtMs(details.latency.p95)} · slowest{" "}
              {fmtMs(details.latency.max)}
            </div>
          )}
          {details.incidents.length > 0 && (
            <div className="pop-section muted">
              {details.incidents.length} alert{details.incidents.length > 1 ? "s" : ""} sent
            </div>
          )}
          <div className="pop-foot muted">
            {details.samples} checks · times ET
          </div>
        </>
      )}
    </>
  );
}

export default function DayBars({ checkId, days }: { checkId: string; days: Day[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [, rerender] = useState(0);

  function show(i: number) {
    setActive(i);
    const day = days[i];
    const key = `${checkId}|${day.date}`;
    if (!day.counts || cache.has(key)) return;
    fetch(`/api/day?check=${encodeURIComponent(checkId)}&date=${day.date}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: DayDetails) => cache.set(key, d))
      .catch(() => cache.set(key, "error"))
      .finally(() => rerender((n) => n + 1));
  }

  // Keep the popover inside the bars' width: anchor left, centered, or right depending on position
  const align = active === null ? "" : active < days.length * 0.2 ? "left" : active > days.length * 0.8 ? "right" : "center";
  const leftPct = active === null ? 0 : ((active + 0.5) / days.length) * 100;

  return (
    <div className="bars-wrap" onMouseLeave={() => setActive(null)}>
      <div className="bars" aria-label={`${days.length} day history`}>
        {days.map((d, i) => (
          <button
            type="button"
            key={d.date}
            className={`bar ${dayClass(d.counts)}${active === i ? " active" : ""}`}
            aria-label={`${d.date} details`}
            onMouseEnter={() => show(i)}
            onFocus={() => show(i)}
            onClick={() => (active === i ? setActive(null) : show(i))}
          />
        ))}
      </div>
      {active !== null && (
        <div className={`popover ${align}`} style={{ left: `${leftPct}%` }} role="tooltip">
          <Popover day={days[active]} details={cache.get(`${checkId}|${days[active].date}`)} />
        </div>
      )}
    </div>
  );
}
