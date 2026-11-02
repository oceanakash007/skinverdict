// Small in-memory fixed-window rate limiter (no dependencies). Good enough for one server instance.
function rateLimit({ windowMs, max, name }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const key = req.ip || "unknown";
    const now = Date.now();
    let h = hits.get(key);
    if (!h || now - h.start > windowMs) {
      h = { start: now, count: 0 };
      hits.set(key, h);
    }
    h.count += 1;
    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", Math.max(0, max - h.count));
    if (h.count > max) {
      const retry = Math.ceil((h.start + windowMs - now) / 1000);
      res.setHeader("Retry-After", retry);
      return res.status(429).json({ error: `Too many requests. Please wait ${retry}s and try again.`, code: "rate_limited", limiter: name });
    }
    next();
  };
}

module.exports = { rateLimit };
