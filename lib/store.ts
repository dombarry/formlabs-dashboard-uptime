import { Redis } from "@upstash/redis";
import type { CheckResult, CheckStatus } from "./checks";

// The Vercel Marketplace Upstash integration sets KV_*; a direct Upstash setup uses UPSTASH_*
export const redis = new Redis({
  url: process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const HISTORY_DAYS = 90;
// Days are Eastern time so a bar is midnight-to-midnight in Boston, not UTC
export const TIME_ZONE = "America/New_York";

export type Sample = { t: number; s: CheckStatus; ms: number; e?: string };
export type DayCounts = { up: number; degraded: number; down: number; msSum: number };
export type CheckState = { failStreak: number; alerting: boolean; since?: number };
export type Incident = { check: string; start: number; end?: number; error?: string };
export type StatusSummary = {
  lastRun: number;
  checks: { id: string; name: string; status: CheckStatus; ms: number; error: string | null }[];
  openIncidents: { check: string; start: number; error: string | null }[];
};

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
export const dayKey = (t: number) => dayFormat.format(t); // en-CA formats as YYYY-MM-DD

// Calendar arithmetic on YYYY-MM-DD strings, so DST's 23/25-hour days can't skip or repeat a date
export function shiftDay(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
});

// Milliseconds TIME_ZONE is ahead of UTC at instant t (negative for Eastern time)
function zoneOffset(t: number) {
  const p = Object.fromEntries(partsFormat.formatToParts(t).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}

function zonedMidnight(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Second pass corrects for the offset differing across a DST switch
  const first = guess - zoneOffset(guess);
  return guess - zoneOffset(first);
}

// [start, end) epoch ms of a TIME_ZONE calendar day
export const dayBounds = (date: string) => [zonedMidnight(date), zonedMidnight(shiftDay(date, 1))] as const;

const samplesKey = (id: string, date: string) => `samples:${id}:${date}`;
const parse = <T>(r: T | string): T => (typeof r === "string" ? JSON.parse(r) : r);

export async function recordResults(results: CheckResult[], t: number) {
  const today = dayKey(t);
  const expired = shiftDay(today, -HISTORY_DAYS);
  const p = redis.pipeline();
  for (const r of results) {
    const sample: Sample = { t, s: r.status, ms: r.ms, ...(r.error ? { e: r.error } : {}) };
    // Every sample is kept for the history window; a day is ~288 samples (~17 KB) per check
    p.rpush(samplesKey(r.id, today), JSON.stringify(sample));
    p.expire(samplesKey(r.id, today), (HISTORY_DAYS + 1) * 86_400);
    // Daily counters drive the 90 bars with one HGETALL per check
    p.hincrby(`daily:${r.id}`, `${today}|${r.status}`, 1);
    if (r.status !== "down") p.hincrby(`daily:${r.id}`, `${today}|msSum`, r.ms);
    p.hdel(`daily:${r.id}`, ...["up", "degraded", "down", "msSum"].map((f) => `${expired}|${f}`));
  }
  await p.exec();
}

export async function setSummary(summary: StatusSummary) {
  await redis.set("status:summary", summary);
}

export async function getSummary(): Promise<StatusSummary | null> {
  return redis.get<StatusSummary>("status:summary");
}

export async function getState(id: string): Promise<CheckState> {
  return (await redis.get<CheckState>(`state:${id}`)) ?? { failStreak: 0, alerting: false };
}

export async function setState(id: string, state: CheckState) {
  await redis.set(`state:${id}`, state);
}

export async function openIncident(incident: Incident) {
  await redis.lpush("incidents", JSON.stringify(incident));
  await redis.ltrim("incidents", 0, 49);
}

export async function closeIncident(check: string, end: number) {
  const list = await getIncidents();
  const idx = list.findIndex((i) => i.check === check && !i.end);
  if (idx === -1) return;
  await redis.lset("incidents", idx, JSON.stringify({ ...list[idx], end }));
}

export async function getIncidents(): Promise<Incident[]> {
  const raw = await redis.lrange<Incident | string>("incidents", 0, -1);
  return raw.map(parse);
}

export async function getSamples(id: string, date: string): Promise<Sample[]> {
  const raw = await redis.lrange<Sample | string>(samplesKey(id, date), 0, -1);
  return raw.map(parse);
}

export async function getDailyHistory(id: string, now: number): Promise<{ date: string; counts: DayCounts | null }[]> {
  const row = (await redis.hgetall<Record<string, number | string>>(`daily:${id}`)) ?? {};
  const today = dayKey(now);
  return Array.from({ length: HISTORY_DAYS }, (_, i) => {
    const date = shiftDay(today, i - (HISTORY_DAYS - 1));
    const get = (f: string) => Number(row[`${date}|${f}`] ?? 0);
    const counts = { up: get("up"), degraded: get("degraded"), down: get("down"), msSum: get("msSum") };
    return { date, counts: counts.up + counts.degraded + counts.down ? counts : null };
  });
}
