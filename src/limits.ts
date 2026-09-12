export type LimitKind = "draft" | "publish";

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface UsageStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface DailyResult {
  allowed: boolean;
  resetAt: string;
}

export interface Limits {
  perMinute(kind: LimitKind, identity: string): Promise<boolean>;
  consumeDaily(kind: LimitKind, now: Date): Promise<DailyResult>;
}

interface LimitsOptions {
  draftLimiter: RateLimiter;
  publishLimiter: RateLimiter;
  store: UsageStore;
  draftCap: number;
  publishCap: number;
}

// Counters outlive their day by one more, then expire on their own.
const COUNTER_TTL_SECONDS = 172800;

function nextUtcMidnight(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

export function createLimits(options: LimitsOptions): Limits {
  return {
    async perMinute(kind, identity) {
      const limiter = kind === "draft" ? options.draftLimiter : options.publishLimiter;
      return (await limiter.limit({ key: identity })).success;
    },

    // Not atomic: two simultaneous requests can both read the same count. With
    // one user and a per-minute limiter in front, the overshoot is a request or two.
    async consumeDaily(kind, now) {
      const cap = kind === "draft" ? options.draftCap : options.publishCap;
      const resetAt = nextUtcMidnight(now);
      if (!Number.isFinite(cap) || cap <= 0) return { allowed: false, resetAt };

      const key = `usage:${kind}:${now.toISOString().slice(0, 10)}`;
      const count = Number.parseInt((await options.store.get(key)) ?? "0", 10) || 0;
      if (count >= cap) return { allowed: false, resetAt };

      await options.store.put(key, String(count + 1), { expirationTtl: COUNTER_TTL_SECONDS });
      return { allowed: true, resetAt };
    },
  };
}
