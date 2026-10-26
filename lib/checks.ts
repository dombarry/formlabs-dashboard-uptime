import { redis } from "./store";

export type CheckStatus = "up" | "degraded" | "down";

export type CheckResult = {
  id: string;
  status: CheckStatus;
  ms: number;
  httpStatus?: number;
  error?: string;
};

export type CheckDef = {
  id: string;
  name: string;
  description: string;
  run: () => Promise<CheckResult>;
};

const API = "https://api.formlabs.com";
export const TIMEOUT_MS = 20_000;
// Slower than this counts as degraded rather than up
const SLOW_MS = 8_000;

async function timedFetch(
  id: string,
  url: string,
  init: RequestInit,
  isHealthy: (status: number) => boolean,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - start;
    if (!isHealthy(res.status)) {
      return { id, status: "down", ms, httpStatus: res.status, error: `HTTP ${res.status}` };
    }
    return { id, status: ms > SLOW_MS ? "degraded" : "up", ms, httpStatus: res.status };
  } catch (err) {
    const ms = Date.now() - start;
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      id,
      status: "down",
      ms,
      error: timedOut ? `Timed out after ${TIMEOUT_MS / 1000}s` : String(err),
    };
  }
}

// Developer API tokens last a day, so cache them in Redis instead of minting one per run
async function getToken(): Promise<string> {
  const cached = await redis.get<string>("formlabs:token");
  if (cached) return cached;

  const res = await fetch(`${API}/developer/v1/o/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.FORMLABS_CLIENT_ID!,
      client_secret: process.env.FORMLABS_CLIENT_SECRET!,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  const ttl = Math.max(60, (body.expires_in ?? 86_400) - 600);
  await redis.set("formlabs:token", body.access_token, { ex: ttl });
  return body.access_token;
}

async function authedCheck(id: string, path: string): Promise<CheckResult> {
  let token: string;
  const start = Date.now();
  try {
    token = await getToken();
  } catch (err) {
    return { id, status: "down", ms: Date.now() - start, error: String(err) };
  }
  const result = await timedFetch(
    id,
    `${API}${path}`,
    { headers: { Authorization: `bearer ${token}` } },
    (s) => s >= 200 && s < 300,
  );
  // A stale/revoked token shouldn't keep reporting an outage
  if (result.httpStatus === 401) await redis.del("formlabs:token");
  return result;
}

const hasApiCreds = Boolean(process.env.FORMLABS_CLIENT_ID && process.env.FORMLABS_CLIENT_SECRET);

export const CHECKS: CheckDef[] = [
  {
    id: "dashboard-web",
    name: "Dashboard website",
    description: "dashboard.formlabs.com loads",
    run: () =>
      timedFetch("dashboard-web", "https://dashboard.formlabs.com/", {}, (s) => s >= 200 && s < 400),
  },
  {
    id: "printernet-gateway",
    name: "Printernet API",
    description: "The API PreForm and Dashboard use for printer groups (expects a fast 401 when unauthenticated)",
    // Unauthenticated, a healthy backend answers 401; a 5xx/timeout means the gateway or backend is in trouble
    run: () =>
      timedFetch(
        "printernet-gateway",
        `${API}/printernet/v1/my/groups/`,
        {},
        (s) => s === 401 || s === 403 || (s >= 200 && s < 300),
      ),
  },
  ...(hasApiCreds
    ? [
        {
          id: "api-groups",
          name: "Printer groups",
          description: "Developer API: list printer groups",
          run: () => authedCheck("api-groups", "/developer/v1/groups/"),
        },
        {
          id: "api-printers",
          name: "Printers",
          description: "Developer API: list printers",
          run: () => authedCheck("api-printers", "/developer/v1/printers/"),
        },
      ]
    : []),
];
