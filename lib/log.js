// Structured logging: one JSON object per line (easy to grep and to read in Render's log viewer).
// LOG_FORMAT=pretty gives human-friendly lines for local development.
const PRETTY = process.env.LOG_FORMAT === "pretty" || process.argv.includes("--pretty");

function write(level, event, fields = {}) {
  const entry = { ts: new Date().toISOString(), level, event, ...fields };
  const line = PRETTY
    ? `${entry.ts.slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${event} ${Object.keys(fields).length ? JSON.stringify(fields) : ""}`
    : JSON.stringify(entry);
  (level === "error" ? console.error : console.log)(line);
}

module.exports = {
  info: (e, f) => write("info", e, f),
  warn: (e, f) => write("warn", e, f),
  error: (e, f) => write("error", e, f),
};
