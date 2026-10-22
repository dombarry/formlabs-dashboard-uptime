import { NextResponse } from "next/server";
import { CHECKS } from "@/lib/checks";
import { sendAlert, type Transition } from "@/lib/alert";
import { closeIncident, getIncidents, getState, openIncident, recordResults, setState, setSummary } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALERT_AFTER = Number(process.env.ALERT_AFTER_FAILURES ?? 2);

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const results = await Promise.all(CHECKS.map((c) => c.run()));
  await recordResults(results, now);

  const transitions: Transition[] = [];
  for (const [i, check] of CHECKS.entries()) {
    const result = results[i];
    const state = await getState(check.id);

    if (result.status === "down") {
      const failStreak = state.failStreak + 1;
      const since = state.since ?? now;
      // Require consecutive failures so a single blip doesn't page you
      if (failStreak >= ALERT_AFTER && !state.alerting) {
        transitions.push({ check, result, kind: "down" });
        await openIncident({ check: check.id, start: since, error: result.error });
        await setState(check.id, { failStreak, alerting: true, since });
      } else {
        await setState(check.id, { ...state, failStreak, since });
      }
    } else {
      if (state.alerting) {
        transitions.push({ check, result, kind: "recovered", since: state.since });
        await closeIncident(check.id, now);
      }
      if (state.failStreak || state.alerting) await setState(check.id, { failStreak: 0, alerting: false });
    }
  }

  // Precomputed so /api/status (polled by every menu bar app) costs a single Redis read
  const incidents = await getIncidents();
  await setSummary({
    lastRun: now,
    checks: CHECKS.map((c, i) => ({
      id: c.id,
      name: c.name,
      status: results[i].status,
      ms: results[i].ms,
      error: results[i].error ?? null,
    })),
    openIncidents: incidents.filter((i) => !i.end).map((i) => ({ check: i.check, start: i.start, error: i.error ?? null })),
  });

  await sendAlert(transitions, now);

  return NextResponse.json({
    at: new Date(now).toISOString(),
    results,
    alerts: transitions.map((t) => ({ check: t.check.id, kind: t.kind })),
  });
}
