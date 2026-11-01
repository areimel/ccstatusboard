import { describe, expect, it } from 'vitest';
import { fakeSysfs } from '../../../test/helpers/system.js';
import { readTemps } from './temps.js';

const H = '/sys/class/hwmon';
/** Names and values copied from a Lenovo V15 G4 (Ryzen 7 7730U). */
const LENOVO: Record<string, string> = {
  [`${H}/hwmon0/name`]: 'ADP0\n',
  [`${H}/hwmon1/name`]: 'acpitz_0\n',
  [`${H}/hwmon1/temp1_input`]: '53000\n',
  [`${H}/hwmon3/name`]: 'nvme\n',
  [`${H}/hwmon3/temp1_input`]: '33850\n',
  [`${H}/hwmon3/temp1_label`]: 'Composite\n',
  [`${H}/hwmon3/temp1_max`]: '78850\n',
  [`${H}/hwmon3/temp1_crit`]: '83850\n',
  [`${H}/hwmon3/temp2_input`]: '33850\n',
  [`${H}/hwmon3/temp2_label`]: 'Sensor 1\n',
  [`${H}/hwmon3/temp2_max`]: '65261850\n',
  [`${H}/hwmon4/name`]: 'k10temp\n',
  [`${H}/hwmon4/temp1_input`]: '65750\n',
  [`${H}/hwmon4/temp1_label`]: 'Tctl\n',
  [`${H}/hwmon5/name`]: 'mt7921_phy0\n',
  [`${H}/hwmon5/temp1_input`]: '40000\n',
  [`${H}/hwmon6/name`]: 'amdgpu\n',
  [`${H}/hwmon6/temp1_input`]: '48000\n',
  [`${H}/hwmon6/temp1_label`]: 'edge\n',
};

describe('readTemps', () => {
  it('maps real chip names to friendly labels in a fixed order, one reading per chip', async () => {
    expect(await readTemps(fakeSysfs(LENOVO))).toEqual([
      { label: 'CPU', celsius: 65.75 },
      { label: 'GPU', celsius: 48 },
      { label: 'Board', celsius: 53 },
      { label: 'WiFi', celsius: 40 },
      { label: 'SSD', celsius: 33.85, warn: 78.85, crit: 83.85 },
    ]);
  });

  it('discards an implausible limit but keeps the reading', async () => {
    const out = await readTemps(
      fakeSysfs({
        [`${H}/hwmon0/name`]: 'nvme',
        [`${H}/hwmon0/temp1_input`]: '33850',
        [`${H}/hwmon0/temp1_max`]: '65261850',
      }),
    );
    expect(out).toEqual([{ label: 'SSD', celsius: 33.85 }]);
  });

  it('discards an implausible reading', async () => {
    const out = await readTemps(
      fakeSysfs({ [`${H}/hwmon0/name`]: 'k10temp', [`${H}/hwmon0/temp1_input`]: '500000' }),
    );
    expect(out).toEqual([]);
  });

  it('prefers Tdie over Tctl', async () => {
    const out = await readTemps(
      fakeSysfs({
        [`${H}/hwmon0/name`]: 'k10temp',
        [`${H}/hwmon0/temp1_input`]: '70000',
        [`${H}/hwmon0/temp1_label`]: 'Tctl',
        [`${H}/hwmon0/temp2_input`]: '60000',
        [`${H}/hwmon0/temp2_label`]: 'Tdie',
      }),
    );
    expect(out).toEqual([{ label: 'CPU', celsius: 60 }]);
  });

  it('uses the coretemp package sensor, not a core', async () => {
    const out = await readTemps(
      fakeSysfs({
        [`${H}/hwmon0/name`]: 'coretemp',
        [`${H}/hwmon0/temp1_input`]: '51000',
        [`${H}/hwmon0/temp1_label`]: 'Core 0',
        [`${H}/hwmon0/temp2_input`]: '55000',
        [`${H}/hwmon0/temp2_label`]: 'Package id 0',
      }),
    );
    expect(out).toEqual([{ label: 'CPU', celsius: 55 }]);
  });

  it('suffixes duplicate labels', async () => {
    const out = await readTemps(
      fakeSysfs({
        [`${H}/hwmon0/name`]: 'nvme',
        [`${H}/hwmon0/temp1_input`]: '30000',
        [`${H}/hwmon1/name`]: 'nvme',
        [`${H}/hwmon1/temp1_input`]: '31000',
      }),
    );
    expect(out.map((t) => t.label)).toEqual(['SSD', 'SSD2']);
  });

  it('keeps unknown chips under their raw name, after known ones', async () => {
    const out = await readTemps(
      fakeSysfs({
        [`${H}/hwmon0/name`]: 'weird_chip',
        [`${H}/hwmon0/temp1_input`]: '30000',
        [`${H}/hwmon1/name`]: 'nvme',
        [`${H}/hwmon1/temp1_input`]: '31000',
      }),
    );
    expect(out.map((t) => t.label)).toEqual(['SSD', 'weird_chip']);
  });

  it('never reads the sensors of a suspended device', async () => {
    const fs = fakeSysfs({
      [`${H}/hwmon0/name`]: 'amdgpu',
      [`${H}/hwmon0/temp1_input`]: '48000',
      [`${H}/hwmon0/device/power/runtime_status`]: 'suspended\n',
    });
    expect(await readTemps(fs)).toEqual([]);
    expect(fs.reads).not.toContain(`${H}/hwmon0/temp1_input`);
  });

  it('returns an empty list when hwmon is missing', async () => {
    expect(await readTemps(fakeSysfs({}))).toEqual([]);
  });
});
