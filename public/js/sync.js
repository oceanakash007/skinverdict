// Lazy-loaded: end-to-end encrypted cloud sync. The sync code never leaves the device in usable form:
// the server stores AES-GCM ciphertext + a hash of an auth token derived separately from the code.
(function (root) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  function newCode() {
    const id = hex(crypto.getRandomValues(new Uint8Array(16)));
    const secret = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => ALPH[b % 32]).join("");
    return `${id}-${secret}`;
  }
  function split(code) {
    const m = /^([a-f0-9]{32})-([A-Z2-9]{20})$/.exec(String(code).trim().replace(/\s+/g, ""));
    if (!m) throw new Error("That sync code doesn't look right. Copy the whole code.");
    return { id: m[1], secret: m[2] };
  }
  async function keyFrom(secret, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function token(secret) {
    return b64(await crypto.subtle.digest("SHA-256", enc.encode("skinverdict-auth:" + secret)));
  }

  async function push(code, payload) {
    const { id, secret } = split(code);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFrom(secret, salt);
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(payload)));
    const res = await fetch("/api/sync/" + id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ iv: b64(iv), salt: b64(salt), data: b64(data), token: await token(secret) }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Sync failed.");
    return j;
  }
  async function pull(code) {
    const { id, secret } = split(code);
    const res = await fetch(`/api/sync/${id}/get`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: await token(secret) }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Couldn't fetch synced data.");
    const key = await keyFrom(secret, unb64(j.salt));
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(j.iv) }, key, unb64(j.data));
      return { payload: JSON.parse(dec.decode(plain)), updatedAt: j.updatedAt };
    } catch {
      throw new Error("Couldn't decrypt. Check the sync code.");
    }
  }
  root.SkinSync = { newCode, push, pull, split };
})(window);
