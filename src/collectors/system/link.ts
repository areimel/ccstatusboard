import type { LinkStats } from '../../domain/types.js';
import { readText, type SysfsDeps } from './sysfs.js';

export type NetIfaces = Record<string, { address: string; family: string; internal: boolean }[] | undefined>;

export interface LinkDeps extends SysfsDeps {
  networkInterfaces: () => NetIfaces;
}

const VPN_NAME = /^(tailscale|wg|tun|tap)/;

/** Interface of the lowest-metric default route in /proc/net/route. */
export function parseDefaultIface(text: string): string | undefined {
  let best: { iface: string; metric: number } | undefined;
  for (const line of text.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f[1] !== '00000000' || !f[0]) continue;
    const metric = Number(f[6]);
    if (Number.isFinite(metric) && (!best || metric < best.metric)) best = { iface: f[0], metric };
  }
  return best?.iface;
}

/** Signal level from /proc/net/wireless; only negative values are dBm, some drivers use other scales. */
export function parseWirelessDbm(text: string, iface: string): number | undefined {
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i === -1 || line.slice(0, i).trim() !== iface) continue;
    const level = Number.parseFloat(
      line
        .slice(i + 1)
        .trim()
        .split(/\s+/)[2] ?? '',
    );
    return level < 0 ? level : undefined;
  }
  return undefined;
}

/** Throws if routes are unreadable; returns `{}` when simply offline. */
export async function readLink(deps: LinkDeps): Promise<LinkStats> {
  const iface = parseDefaultIface(await deps.readFile('/proc/net/route'));
  const ifaces = deps.networkInterfaces();
  const ip = iface ? ifaces[iface]?.find((a) => a.family === 'IPv4' && !a.internal)?.address : undefined;
  const wireless = iface ? await readText(deps, '/proc/net/wireless') : undefined;
  const vpn = Object.keys(ifaces).find(
    (name) => VPN_NAME.test(name) && (ifaces[name] ?? []).some((a) => !a.internal),
  );
  return {
    iface,
    ip,
    signalDbm: iface && wireless !== undefined ? parseWirelessDbm(wireless, iface) : undefined,
    vpn,
  };
}
