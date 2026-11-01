// Access and cost control for the demo API: a shared demo code, a per-IP limit and a daily cap. The limits live
// in memory, so they are best effort: each serverless instance counts on its own and a restart clears them.
// The hard guards are the demo code, the per-run image budget and the 270 second run limit.
import { timingSafeEqual } from "node:crypto";

export type CodeCheck = "ok" | "unset" | "bad";

/** Compares the code a request sent with the configured one, in constant time. Unset means every run is refused. */
export function checkDemoCode(provided: unknown, expected: string | undefined): CodeCheck {
  if (!expected || !expected.trim()) return "unset";
  if (typeof provided !== "string" || !provided) return "bad";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "bad";
}

// Every run needs the demo code, so these limits only ever apply to people who have it. 40 an hour lets one person
// make ads for a full catalogue of 12 products, revise a few, and still have room; 150 a day covers a few such people.
export const DEFAULT_IP_PER_HOUR = 40;
export const DEFAULT_DAILY_CAP = 150;

export interface LimitOptions {
  ipPerHour: number;
  dailyCap: number;
  now?: () => number;
}

export type LimitResult = { ok: true } | { ok: false; error: string };

export class RunLimiter {
  private readonly perIp = new Map<string, number[]>();
  private day = "";
  private today = 0;
  private readonly ipPerHour: number;
  private readonly dailyCap: number;
  private readonly now: () => number;

  constructor(opts: LimitOptions) {
    this.ipPerHour = opts.ipPerHour;
    this.dailyCap = opts.dailyCap;
    this.now = opts.now ?? Date.now;
  }

  /** Counts one run for this IP, or says why not. A refused run is not counted. */
  take(ip: string): LimitResult {
    const now = this.now();
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.today = 0;
      this.perIp.clear();
    }
    if (this.today >= this.dailyCap) return { ok: false, error: `The demo has reached its daily limit of ${this.dailyCap} runs. Please try again tomorrow.` };
    const recent = (this.perIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= this.ipPerHour) return { ok: false, error: `Limit of ${this.ipPerHour} runs an hour reached for your connection. Please wait a while.` };
    recent.push(now);
    this.perIp.set(ip, recent);
    this.today += 1;
    return { ok: true };
  }
}

/** The caller's IP as the host reports it. */
export function clientIp(headers: Record<string, string | string[] | undefined>, fallback = "unknown"): string {
  const fwd = headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  const real = headers["x-real-ip"];
  return first || (Array.isArray(real) ? real[0] : real) || fallback;
}

export const positiveInt = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
