/**
 * Prints the address to open the terminal on a phone, and a QR code for it.
 *
 * The dev server already listens on every interface; the only thing missing is
 * knowing which address to type. Guessing between en0, Wi-Fi and a dozen
 * virtual adapters is exactly the sort of thing worth doing once, in code.
 *
 *   node scripts/lan-url.mjs [port]
 */
import { networkInterfaces } from "node:os";

const port = Number(process.argv[2]) || 3000;

/** Virtual adapters answer like real ones but are unreachable from a phone. */
const VIRTUAL = /^(docker|br-|veth|vmnet|vboxnet|utun|tun|tap|zt|wg|lo)/i;

const candidates = Object.entries(networkInterfaces())
  .flatMap(([name, addrs]) => (addrs ?? []).map((a) => ({ ...a, name })))
  .filter((a) => a.family === "IPv4" && !a.internal && !VIRTUAL.test(a.name));

if (candidates.length === 0) {
  console.log("\nNo LAN address found — the machine may be on Wi-Fi that is off, or only on a VPN.\n");
  process.exit(1);
}

// Prefer the ordinary private ranges a home router hands out.
const rank = (ip) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2);
candidates.sort((a, b) => rank(a.address) - rank(b.address));

const url = `http://${candidates[0].address}:${port}`;

console.log(`\n  Open this on your phone — same Wi-Fi as this machine:\n`);
console.log(`      ${url}\n`);

try {
  const { default: qr } = await import("qrcode-terminal");
  qr.generate(url, { small: true });
} catch {
  // The QR is a convenience; the URL above is the actual answer.
}

if (candidates.length > 1) {
  console.log("  Other interfaces, if that one does not answer:");
  for (const c of candidates.slice(1)) console.log(`      http://${c.address}:${port}   (${c.name})`);
}

console.log(
  "\n  Note: anyone on this network can now reach the desk, including its\n" +
    "  controls — kill switch, approvals, reset. Fine on a home network for\n" +
    "  paper trading; think again before doing this on café Wi-Fi.\n",
);
