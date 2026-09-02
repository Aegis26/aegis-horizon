import { isIP } from "node:net";
import type { Request } from "express";

function canonicalIp(raw: string): string | null {
  let value = raw.trim().replace(/^\[|\]$/g, "").split("%", 1)[0]!.toLowerCase();
  if (value.startsWith("::ffff:") && isIP(value.slice(7)) === 4) value = value.slice(7);
  return isIP(value) ? value : null;
}

/** Uses Express's trusted-proxy calculation; never parses X-Forwarded-For here. */
export function getClientIp(req: Request): string | null {
  return canonicalIp(req.ip ?? req.socket.remoteAddress ?? "");
}

function ipv4ToBigInt(ip: string): bigint {
  return ip.split(".").reduce((result, octet) => (result << 8n) | BigInt(octet), 0n);
}

function ipv6ToBigInt(ip: string): bigint {
  const mapped = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const v4 = ipv4ToBigInt(mapped[2]!);
    ip = `${mapped[1]}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) throw new Error("Invalid IPv6 address");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const groups =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;
  if (groups.length !== 8) throw new Error("Invalid IPv6 address");
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group || "0"}`), 0n);
}

/** Matches canonical IPv4/IPv6 addresses against a validated CIDR string. */
export function ipMatchesCidr(ip: string, cidr: string): boolean {
  const [networkRaw, prefixRaw] = cidr.trim().split("/");
  const network = canonicalIp(networkRaw ?? "");
  const candidate = canonicalIp(ip);
  if (!network || !candidate || isIP(network) !== isIP(candidate)) return false;
  const bits = isIP(network) === 4 ? 32 : 128;
  const prefix = prefixRaw === undefined ? bits : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return false;
  try {
    const networkValue = bits === 32 ? ipv4ToBigInt(network) : ipv6ToBigInt(network);
    const candidateValue = bits === 32 ? ipv4ToBigInt(candidate) : ipv6ToBigInt(candidate);
    const shift = BigInt(bits - prefix);
    return (networkValue >> shift) === (candidateValue >> shift);
  } catch {
    return false;
  }
}

export function isIpAllowed(ip: string | null, cidrs: readonly string[]): boolean {
  return ip !== null && cidrs.some((cidr) => ipMatchesCidr(ip, cidr));
}