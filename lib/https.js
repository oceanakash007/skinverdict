// Local HTTPS so phones on your Wi-Fi get the live camera (browsers only allow it on HTTPS).
// Generates a self-signed certificate for localhost + this computer's LAN IPs, cached in .cert/.
const fs = require("fs");
const os = require("os");
const path = require("path");

function lanIPs() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

function getCert(rootDir) {
  const dir = path.join(rootDir, ".cert");
  const keyFile = path.join(dir, "key.pem");
  const certFile = path.join(dir, "cert.pem");
  const ipsFile = path.join(dir, "ips.txt");
  const ips = lanIPs();
  const want = ["127.0.0.1", ...ips].join(",");
  if (fs.existsSync(keyFile) && fs.existsSync(certFile) && fs.existsSync(ipsFile) && fs.readFileSync(ipsFile, "utf8") === want) {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), ips };
  }
  const selfsigned = require("selfsigned");
  const pems = selfsigned.generate([{ name: "commonName", value: "SkinVerdict local" }], {
    days: 365,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, ...want.split(",").map((ip) => ({ type: 7, ip }))] },
    ],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(ipsFile, want);
  return { key: pems.private, cert: pems.cert, ips };
}

module.exports = { getCert, lanIPs };
