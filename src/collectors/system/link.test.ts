import { describe, expect, it } from 'vitest';
import { fakeSysfs } from '../../../test/helpers/system.js';
import { parseDefaultIface, parseWirelessDbm, readLink, type NetIfaces } from './link.js';

const ROUTE_HEAD = 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n';
const route = (iface: string, dest: string, metric: number): string =>
  `${iface}\t${dest}\t0101A8C0\t0003\t0\t0\t${metric}\t00000000\t0\t0\t0\n`;
const WIRELESS = `Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE
 face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22
wlp2s0: 0000   63.  -47.  -256        0      0      0      1      8        0
`;
const v4 = (address: string) => ({ address, family: 'IPv4', internal: false });
const IFACES: NetIfaces = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  wlp2s0: [{ address: 'fe80::1', family: 'IPv6', internal: false }, v4('192.168.1.160')],
  tailscale0: [v4('100.127.210.98')],
  docker0: [v4('172.17.0.1')],
};

describe('parseDefaultIface', () => {
  it('picks the default route with the lowest metric', () => {
    const text = `${ROUTE_HEAD}${route('enp1s0', '00000000', 600)}${route('wlp2s0', '00000000', 100)}${route('docker0', '000011AC', 0)}`;
    expect(parseDefaultIface(text)).toBe('wlp2s0');
  });
  it('returns undefined with no default route', () => {
    expect(parseDefaultIface(`${ROUTE_HEAD}${route('docker0', '000011AC', 0)}`)).toBeUndefined();
  });
});

describe('parseWirelessDbm', () => {
  it('reads the signal level of an interface', () => {
    expect(parseWirelessDbm(WIRELESS, 'wlp2s0')).toBe(-47);
  });
  it('returns undefined for wired interfaces and non-dBm levels', () => {
    expect(parseWirelessDbm(WIRELESS, 'enp1s0')).toBeUndefined();
    expect(parseWirelessDbm(WIRELESS.replace('-47.', ' 60.'), 'wlp2s0')).toBeUndefined();
  });
});

describe('readLink', () => {
  const deps = (files: Record<string, string>, ifaces: NetIfaces = IFACES) => ({
    ...fakeSysfs(files),
    networkInterfaces: () => ifaces,
  });

  it('combines interface, address, signal and VPN', async () => {
    const out = await readLink(
      deps({
        '/proc/net/route': `${ROUTE_HEAD}${route('wlp2s0', '00000000', 600)}`,
        '/proc/net/wireless': WIRELESS,
      }),
    );
    expect(out).toEqual({ iface: 'wlp2s0', ip: '192.168.1.160', signalDbm: -47, vpn: 'tailscale0' });
  });

  it('works on a wired machine without /proc/net/wireless or a VPN', async () => {
    const out = await readLink(
      deps(
        { '/proc/net/route': `${ROUTE_HEAD}${route('enp1s0', '00000000', 100)}` },
        { enp1s0: [v4('10.0.0.2')] },
      ),
    );
    expect(out).toEqual({ iface: 'enp1s0', ip: '10.0.0.2' });
  });

  it('reports offline as an empty object so the row stays reserved', async () => {
    expect(await readLink(deps({ '/proc/net/route': ROUTE_HEAD }, {}))).toEqual({});
  });

  it('ignores a VPN interface with no address', async () => {
    const out = await readLink(deps({ '/proc/net/route': ROUTE_HEAD }, { wg0: [] }));
    expect(out).toEqual({});
  });

  it('throws when routes are unreadable', async () => {
    await expect(readLink(deps({}))).rejects.toThrow();
  });
});
