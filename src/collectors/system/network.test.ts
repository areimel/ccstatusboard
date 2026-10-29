import { describe, expect, it } from 'vitest';
import { netRates, parseNetstatIbn, parseProcNetDev } from './network.js';

const PROC = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 9999999   100    0    0    0     0          0         0  9999999   100    0    0    0     0       0          0
  eth0: 1000   10    0    0    0     0          0         0     2000   20    0    0    0     0       0          0
 wlan0: 500   5    0    0    0     0          0         0     300   3    0    0    0     0       0          0
`;

const NETSTAT = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                        100     0       9999      100     0       9999     0
lo0        16384 127           127.0.0.1         100     -       9999      100     -       9999     -
en0        1500  <Link#6>    a4:83:e7:aa:bb:cc  1000     0       5000      800     0       4000     0
en0        1500  192.168.1/24  192.168.1.5      1000     -       5000      800     -       4000     -
utun0      1380  <Link#12>                        50     0        700       60     0        900     0
`;

describe('parseProcNetDev', () => {
  it('sums non-loopback interfaces', () => {
    expect(parseProcNetDev(PROC)).toEqual({ rx: 1500, tx: 2300 });
  });
  it('handles empty text', () => {
    expect(parseProcNetDev('')).toEqual({ rx: 0, tx: 0 });
  });
});

describe('parseNetstatIbn', () => {
  it('sums unique Link rows excluding lo0, including rows without address', () => {
    expect(parseNetstatIbn(NETSTAT)).toEqual({ rx: 5700, tx: 4900 });
  });
});

describe('netRates', () => {
  it('computes bytes per second', () => {
    expect(netRates({ rx: 1000, tx: 0 }, { rx: 3000, tx: 500 }, 2000)).toEqual({
      rxPerSec: 1000,
      txPerSec: 250,
    });
  });
  it('guards counter resets and missing prev', () => {
    expect(netRates({ rx: 5000, tx: 5000 }, { rx: 10, tx: 10 }, 1000)).toEqual({ rxPerSec: 0, txPerSec: 0 });
    expect(netRates(undefined, { rx: 10, tx: 10 }, 1000)).toEqual({ rxPerSec: 0, txPerSec: 0 });
  });
});
