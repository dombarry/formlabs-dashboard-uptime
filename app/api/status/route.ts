import { NextResponse } from "next/server";
import { CHECKS, type CheckStatus } from "@/lib/checks";
import { getSummary } from "@/lib/store";

export const dynamic = "force-dynamic";

// Treat data as stale if the scheduler hasn't run recently (it runs every 5 min)
const STALE_MS = 15 * 60_000;

// Public summary for the menu bar app and anything else that wants to poll status
export async function GET() {
  const summary = await getSummary();
  const stale = !summary || Date.now() - summary.lastRun > STALE_MS;
  const checks =
    summary?.checks ??
    CHECKS.map((c) => ({ id: c.id, name: c.name, status: "unknown" as const, ms: null, error: null }));
  const statuses: (CheckStatus | "unknown")[] = checks.map((c) => c.status);
  const overall: CheckStatus | "unknown" = stale
    ? "unknown"
    : statuses.includes("down")
      ? "down"
      : statuses.includes("degraded")
        ? "degraded"
        : "up";

  return NextResponse.json(
    { overall, lastRun: summary?.lastRun ?? null, stale, checks, openIncidents: summary?.openIncidents ?? [] },
    {
      headers: {
        // Data only changes every 5 minutes; edge caching keeps Redis reads flat no matter how many clients poll
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=180",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
