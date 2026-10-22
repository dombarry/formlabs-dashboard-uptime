import { NextResponse } from "next/server";
import { CHECKS, type CheckStatus } from "@/lib/checks";
import { getIncidents, getLastRun, getLatest } from "@/lib/store";

export const dynamic = "force-dynamic";

// Treat data as stale if the scheduler hasn't run recently (it runs every 5 min)
const STALE_MS = 15 * 60_000;

// Public summary for the menu bar app and anything else that wants to poll status
export async function GET() {
  const now = Date.now();
  const [lastRun, incidents, latest] = await Promise.all([
    getLastRun(),
    getIncidents(),
    Promise.all(CHECKS.map((c) => getLatest(c.id))),
  ]);

  const checks = CHECKS.map((c, i) => ({
    id: c.id,
    name: c.name,
    status: (latest[i]?.s ?? "unknown") as CheckStatus | "unknown",
    ms: latest[i]?.ms ?? null,
    error: latest[i]?.e ?? null,
  }));
  const stale = !lastRun || now - lastRun > STALE_MS;
  const statuses = checks.map((c) => c.status);
  const overall: CheckStatus | "unknown" = stale
    ? "unknown"
    : statuses.includes("down")
      ? "down"
      : statuses.includes("degraded")
        ? "degraded"
        : "up";

  return NextResponse.json(
    {
      overall,
      lastRun,
      stale,
      checks,
      openIncidents: incidents.filter((i) => !i.end).map((i) => ({ check: i.check, start: i.start, error: i.error ?? null })),
    },
    {
      headers: {
        // Cache at Vercel's edge so many menu bar clients cost ~1 Redis read per minute
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
