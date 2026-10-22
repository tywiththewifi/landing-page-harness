import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a.startsWith("::ffff:")) return isPrivateAddress(a.slice(7));
    return a === "::1" || a === "::" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80");
  }
  return PRIVATE_V4.some((r) => r.test(address));
}

/**
 * The extractor drives a real browser to whatever URL it is given, so the
 * API refuses internal addresses (SSRF). Set LPH_ALLOW_PRIVATE_URLS=1 for
 * local fixtures.
 */
export async function assertPublicUrl(raw: string, allowPrivate = process.env.LPH_ALLOW_PRIVATE_URLS === "1"): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlRejected("That doesn't look like a URL. Include https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UrlRejected("Only http and https URLs are supported.");
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new UrlRejected(`Couldn't resolve ${url.hostname}.`);
  if (addresses.some(isPrivateAddress)) throw new UrlRejected("Internal and private network addresses can't be imported.");
  return url;
}

export class UrlRejected extends Error {}

/**
 * Extractor options that hold the page's own requests to the same rule (see
 * ExtractOptions.allowAddress), so a page can't redirect or load its way inside.
 */
export const browserGuard = (allowPrivate = process.env.LPH_ALLOW_PRIVATE_URLS === "1") =>
  allowPrivate ? {} : { allowAddress: (ip: string) => !isPrivateAddress(ip) };
