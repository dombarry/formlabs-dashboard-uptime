import { Redis } from "@upstash/redis";
import type { CheckResult, CheckStatus } from "./checks";

// The Vercel Marketplace Upstash integration sets KV_*; a direct Upstash setup uses UPSTASH_*
export const redis = new Redis({
  url: process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const HISTORY_DAYS = 90;
const RECENT_SAMPLES = 288; // 24h at a 5-minute interval

export type Sample = { t: number; s: CheckStatus; ms: number; e?: string };
export type DayCounts = { up: number; degraded: number; down: number };
export type CheckState = { failStreak: number; alerting: boolean; since?: number };
export type Incident = { check: string; start: number; end?: number; error?: string };

export const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

export async function recordResults(results: CheckResult[], t: number) {
  const p = redis.pipeline();
  for (const r of results) {
    const sample: Sample = { t, s: r.status, ms: r.ms, ...(r.error ? { e: r.error } : {}) };
    p.lpush(`recent:${r.id}`, JSON.stringify(sample));
    p.ltrim(`recent:${r.id}`, 0, RECENT_SAMPLES - 1);
    // One hash per check with fields like "2026-10-22|down"; drop the day that just fell out of the window
    p.hincrby(`daily:${r.id}`, `${dayKey(t)}|${r.status}`, 1);
    const expired = dayKey(t - HISTORY_DAYS * 86_400_000);
    p.hdel(`daily:${r.id}`, `${expired}|up`, `${expired}|degraded`, `${expired}|down`);
  }
  p.set("lastRun", t);
  await p.exec();
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
  return raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r));
}

export async function getRecent(id: string): Promise<Sample[]> {
  const raw = await redis.lrange<Sample | string>(`recent:${id}`, 0, -1);
  return raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r));
}

export async function getLatest(id: string): Promise<Sample | null> {
  const [raw] = await redis.lrange<Sample | string>(`recent:${id}`, 0, 0);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export async function getDailyHistory(id: string, now: number): Promise<{ date: string; counts: DayCounts | null }[]> {
  const row = (await redis.hgetall<Record<string, number | string>>(`daily:${id}`)) ?? {};
  return Array.from({ length: HISTORY_DAYS }, (_, i) => {
    const date = dayKey(now - (HISTORY_DAYS - 1 - i) * 86_400_000);
    const get = (s: CheckStatus) => Number(row[`${date}|${s}`] ?? 0);
    const counts = { up: get("up"), degraded: get("degraded"), down: get("down") };
    return { date, counts: counts.up + counts.degraded + counts.down ? counts : null };
  });
}

export async function getLastRun(): Promise<number | null> {
  return redis.get<number>("lastRun");
}
