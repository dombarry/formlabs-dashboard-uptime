import { unstable_cache } from "next/cache";
import { TIMEOUT_MS } from "./checks";
import { WINDOW_DAYS, summarizeWindow } from "./latency";
import { dayKey, getSamples, shiftDay } from "./store";

// Reads the stored per-day sample lists covering the rolling window. Cached for 5 minutes (the check
// interval) so page views don't each cost ~8 Redis reads.
export const getLatencyWindow = unstable_cache(
  async (checkId: string) => {
    const now = Date.now();
    const today = dayKey(now);
    // Today plus 7 earlier ET days fully covers the last 7 x 24h
    const dates = Array.from({ length: WINDOW_DAYS + 1 }, (_, i) => shiftDay(today, -i));
    const samples = (await Promise.all(dates.map((d) => getSamples(checkId, d)))).flat();
    return summarizeWindow(samples, now, TIMEOUT_MS);
  },
  ["latency-window-v1"],
  { revalidate: 300 },
);
