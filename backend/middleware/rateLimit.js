import rateLimit from "express-rate-limit";

/**
 * Rate limits for the Node API.
 *
 * In-memory and per process (counters reset on restart and are not shared
 * between instances). A limit of 0 disables it. The numbers are starting
 * points, not tuned values; override them with the environment variables
 * below once real traffic is known.
 *
 * Per-IP limits are deliberately generous because a whole campus can share one
 * public IP. The per-user limits (keyed by the verified Firebase uid) are the
 * real control; the per-IP query limit exists because accounts are free to
 * create.
 */
function intEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function makeLimiter({ max, message, byUser = false }) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => max <= 0,
    // Per-user limiters run after requireAuth/requireAdmin, so req.uid is set.
    ...(byUser ? { keyGenerator: (req) => req.uid } : {}),
    handler: (req, res) => {
      const resetTime = req.rateLimit?.resetTime;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(((resetTime ? resetTime.getTime() : Date.now() + 60000) - Date.now()) / 1000)
      );
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: message, retryAfterSeconds });
    },
  });
}

const SLOW_DOWN = "Too many requests. Please wait a moment and try again.";

/** Coarse limit on every request, by IP. */
export const ipLimiter = makeLimiter({
  max: intEnv("IP_RATE_PER_MINUTE", 600),
  message: SLOW_DOWN,
});

/** Asking questions, by IP (accounts are free to create). */
export const queryIpLimiter = makeLimiter({
  max: intEnv("QUERY_RATE_PER_MINUTE_PER_IP", 60),
  message: "Too many questions from your network. Please wait a moment and try again.",
});

/** Asking questions, by user. */
export const queryUserLimiter = makeLimiter({
  max: intEnv("QUERY_RATE_PER_MINUTE", 10),
  byUser: true,
  message: "You're asking questions too quickly. Please wait a moment and try again.",
});

/** Calendar actions, by user. */
export const calendarUserLimiter = makeLimiter({
  max: intEnv("CALENDAR_RATE_PER_MINUTE", 30),
  byUser: true,
  message: SLOW_DOWN,
});

/** Deleting one's own account, by user (a handful of tries is plenty). */
export const accountUserLimiter = makeLimiter({
  max: intEnv("ACCOUNT_RATE_PER_MINUTE", 5),
  byUser: true,
  message: SLOW_DOWN,
});

/** Admin actions, by user. */
export const adminUserLimiter = makeLimiter({
  max: intEnv("ADMIN_RATE_PER_MINUTE", 120),
  byUser: true,
  message: SLOW_DOWN,
});
