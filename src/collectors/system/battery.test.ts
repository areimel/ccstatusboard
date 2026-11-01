import { describe, expect, it } from 'vitest';
import { fakeSysfs } from '../../../test/helpers/system.js';
import { readBattery } from './battery.js';

const P = '/sys/class/power_supply';
const LENOVO = {
  [`${P}/ADP0/type`]: 'Mains\n',
  [`${P}/ADP0/online`]: '1\n',
  [`${P}/BAT0/type`]: 'Battery\n',
  [`${P}/BAT0/status`]: 'Not charging\n',
  [`${P}/BAT0/capacity`]: '98\n',
  [`${P}/BAT0/energy_now`]: '34390000\n',
  [`${P}/BAT0/energy_full`]: '35090000\n',
  [`${P}/BAT0/energy_full_design`]: '38000000\n',
  [`${P}/BAT0/power_now`]: '0\n',
  [`${P}/BAT0/voltage_now`]: '8468000\n',
  [`${P}/BAT0/cycle_count`]: '40\n',
};

describe('readBattery', () => {
  it('reads an idle battery on AC, hiding watts and time left', async () => {
    const b = await readBattery(fakeSysfs(LENOVO));
    expect(b).toEqual({
      percent: 98,
      status: 'Not charging',
      healthPercent: expect.closeTo(92.34, 1),
      cycles: 40,
    });
  });

  it('computes time left while discharging', async () => {
    const b = await readBattery(
      fakeSysfs({
        ...LENOVO,
        [`${P}/BAT0/status`]: 'Discharging',
        [`${P}/BAT0/energy_now`]: '20000000',
        [`${P}/BAT0/power_now`]: '10000000',
      }),
    );
    expect(b?.watts).toBe(10);
    expect(b?.secondsLeft).toBe(7200);
  });

  it('computes time to full while charging', async () => {
    const b = await readBattery(
      fakeSysfs({
        ...LENOVO,
        [`${P}/BAT0/status`]: 'Charging',
        [`${P}/BAT0/energy_now`]: '25090000',
        [`${P}/BAT0/power_now`]: '20000000',
      }),
    );
    expect(b?.secondsLeft).toBe(1800);
  });

  it('supports the charge_ and current_ variant, including negative current', async () => {
    const b = await readBattery(
      fakeSysfs({
        [`${P}/BAT1/type`]: 'Battery',
        [`${P}/BAT1/status`]: 'Discharging',
        [`${P}/BAT1/charge_now`]: '2000000',
        [`${P}/BAT1/charge_full`]: '4000000',
        [`${P}/BAT1/charge_full_design`]: '5000000',
        [`${P}/BAT1/current_now`]: '-1000000',
        [`${P}/BAT1/voltage_now`]: '10000000',
      }),
    );
    expect(b).toEqual({
      percent: 50,
      status: 'Discharging',
      watts: 10,
      secondsLeft: 7200,
      healthPercent: 80,
    });
  });

  it('ignores a peripheral battery', async () => {
    const b = await readBattery(
      fakeSysfs({
        [`${P}/hidpp_battery_0/type`]: 'Battery',
        [`${P}/hidpp_battery_0/scope`]: 'Device',
        [`${P}/hidpp_battery_0/capacity`]: '50',
      }),
    );
    expect(b).toBeUndefined();
  });

  it('returns undefined with no battery', async () => {
    expect(await readBattery(fakeSysfs({ [`${P}/ADP0/type`]: 'Mains' }))).toBeUndefined();
    expect(await readBattery(fakeSysfs({}))).toBeUndefined();
  });
});
