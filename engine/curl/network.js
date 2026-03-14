import dns from "node:dns";
import net from "node:net";
import {
  BLOCKED_HOSTNAMES,
  BLOCKED_IPV4_CIDRS,
  BLOCKED_IPV6_CIDRS,
} from "./constants.js";

export function defaultDnsLookup(hostname) {
  return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet < 0 || octet > 255) {
      return null;
    }
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function isIpv4InCidr(ip, base, prefix) {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt == null || baseInt == null) {
    return false;
  }

  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0) & 0xffffffff;
  return (ipInt & mask) === (baseInt & mask);
}

function isValidHextet(segment) {
  return /^[0-9a-f]{1,4}$/i.test(segment);
}

function ipv6ToBigInt(inputAddress) {
  let address = inputAddress.toLowerCase();

  if (address.includes("%")) {
    [address] = address.split("%");
  }

  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    if (lastColon === -1) {
      return null;
    }

    const ipv4Part = address.slice(lastColon + 1);
    const ipv4Int = ipv4ToInt(ipv4Part);
    if (ipv4Int == null) {
      return null;
    }

    const high = ((ipv4Int >>> 16) & 0xffff).toString(16);
    const low = (ipv4Int & 0xffff).toString(16);
    address = `${address.slice(0, lastColon)}:${high}:${low}`;
  }

  const pieces = address.split("::");
  if (pieces.length > 2) {
    return null;
  }

  const left = pieces[0] ? pieces[0].split(":").filter(Boolean) : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":").filter(Boolean) : [];

  if (left.some((segment) => !isValidHextet(segment))) {
    return null;
  }
  if (right.some((segment) => !isValidHextet(segment))) {
    return null;
  }

  if (pieces.length === 1 && left.length !== 8) {
    return null;
  }

  const missing = 8 - (left.length + right.length);
  if (missing < 0) {
    return null;
  }

  const full = pieces.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (full.length !== 8) {
    return null;
  }

  let value = 0n;
  for (const segment of full) {
    value = (value << 16n) + BigInt(parseInt(segment, 16));
  }
  return value;
}

function isIpv6InCidr(ip, base, prefix) {
  const ipValue = ipv6ToBigInt(ip);
  const baseValue = ipv6ToBigInt(base);
  if (ipValue == null || baseValue == null) {
    return false;
  }

  if (prefix === 0) {
    return true;
  }

  const shift = BigInt(128 - prefix);
  return (ipValue >> shift) === (baseValue >> shift);
}

export function isBlockedIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) {
    return BLOCKED_IPV4_CIDRS.some(([base, prefix]) => isIpv4InCidr(ip, base, prefix));
  }
  if (family === 6) {
    return BLOCKED_IPV6_CIDRS.some(([base, prefix]) => isIpv6InCidr(ip, base, prefix));
  }
  return true;
}

export function isBlockedHostname(hostname) {
  const normalized = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }
  if (normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
    return true;
  }
  if (normalized.endsWith(".internal")) {
    return true;
  }
  return false;
}

export function isLocalDevTarget(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isBlockedHostname(hostname)) {
    return true;
  }

  const ipFamily = net.isIP(hostname);
  if (ipFamily > 0) {
    return isBlockedIp(hostname);
  }

  return false;
}

export async function validateTargetUrl(url, { isDev = false, dnsLookup = defaultDnsLookup } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only http/https URLs are allowed";
  }

  if (isDev) {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return "Invalid URL host";
  }

  if (isBlockedHostname(hostname)) {
    return "URL host is blocked in production mode";
  }

  const ipFamily = net.isIP(hostname);
  if (ipFamily > 0) {
    if (isBlockedIp(hostname)) {
      return "URL target is blocked in production mode";
    }
    return null;
  }

  let records;
  try {
    records = await dnsLookup(hostname);
  } catch {
    return "Unable to resolve hostname";
  }

  const resolvedRecords = Array.isArray(records) ? records : [records];
  if (resolvedRecords.length === 0) {
    return "Unable to resolve hostname";
  }

  for (const record of resolvedRecords) {
    if (!record || typeof record.address !== "string") {
      return "Unable to resolve hostname";
    }

    if (isBlockedIp(record.address)) {
      return "URL resolves to a blocked network target";
    }
  }

  return null;
}
