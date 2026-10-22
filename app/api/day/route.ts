import { NextResponse } from "next/server";
import { CHECKS } from "@/lib/checks";
import { summarizeDay } from "@/lib/dayDetails";
import { HISTORY_DAYS, dayBounds, dayKey, getIncidents, getSamples, shiftDay } from "@/lib/store";

export const dynamic = "force-dynamic";

// Per-day detail for the hover popover on the status page: /api/day?check=api-groups&date=2026-10-22
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const check = params.get("check") ?? "";
  const date = params.get("date") ?? "";
  const today = dayKey(Date.now());

  if (!CHECKS.some((c) => c.id === check)) {
    return NextResponse.json({ error: "unknown check" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < shiftDay(today, -HISTORY_DAYS)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD within the last 90 days" }, { status: 400 });
  }

  const [samples, incidents] = await Promise.all([getSamples(check, date), getIncidents()]);
  const [start, end] = dayBounds(date);
  const isToday = date === today;
  const details = summarizeDay(date, samples, incidents.filter((i) => i.check === check), start, end, isToday);

  return NextResponse.json(details, {
    headers: {
      // Past days never change, so cache them hard; today refreshes with the checker
      "Cache-Control": isToday ? "public, s-maxage=120, stale-while-revalidate=180" : "public, s-maxage=86400, max-age=3600",
    },
  });
}
