export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 50,
  windowSeconds: 60,
};

// Check if request is allowed
export function isRequestAllowed(
  identifier: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): boolean {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  if (!rateLimitStore.has(identifier)) {
    rateLimitStore.set(identifier, { timestamps: [] });
  }

  const entry = rateLimitStore.get(identifier)!;

  // Remove old timestamps outside the window
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

  // Check if under limit
  if (entry.timestamps.length < config.maxRequests) {
    entry.timestamps.push(now);
    return true;
  }

  return false;
}

// Get remaining quota for identifier
export function getRemainingQuota(
  identifier: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): number {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  if (!rateLimitStore.has(identifier)) {
    return config.maxRequests;
  }

  const entry = rateLimitStore.get(identifier)!;
  const validTimestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

  return Math.max(0, config.maxRequests - validTimestamps.length);
}

// Get time until next request allowed (ms)
export function getRetryAfter(
  identifier: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): number {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  if (!rateLimitStore.has(identifier)) {
    return 0;
  }

  const entry = rateLimitStore.get(identifier)!;
  const validTimestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

  if (validTimestamps.length < config.maxRequests) {
    return 0;
  }

  // Return time until oldest request leaves the window
  const oldestTimestamp = validTimestamps[0];
  return Math.ceil(windowMs - (now - oldestTimestamp));
}

export default {
  isRequestAllowed,
  getRemainingQuota,
  getRetryAfter,
};
