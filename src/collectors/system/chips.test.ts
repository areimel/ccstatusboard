import { describe, expect, it } from 'vitest';
import { fakeSysfs } from '../../../test/helpers/system.js';
import { readCpuFreq, readGpu, readPowerProfile } from './chips.js';

const C = '/sys/devices/system/cpu';
const D = '/sys/class/drm';
const AMD = {
  [`${D}/version`]: 'drm\n',
  [`${D}/card1-eDP-1/device/gpu_busy_percent`]: '77\n',
  [`${D}/card1/device/power/runtime_status`]: 'active\n',
  [`${D}/card1/device/gpu_busy_percent`]: '1\n',
  [`${D}/card1/device/mem_info_vram_used`]: '981929984\n',
  [`${D}/card1/device/hwmon/hwmon6/freq1_input`]: '200000000\n',
  [`${D}/card1/device/hwmon/hwmon6/power1_input`]: '18000000\n',
};

describe('readCpuFreq', () => {
  it('reports the fastest core and the rated maximum', async () => {
    const f = await readCpuFreq(
      fakeSysfs({
        [`${C}/cpu0/cpufreq/scaling_cur_freq`]: '1200000\n',
        [`${C}/cpu0/cpufreq/cpuinfo_max_freq`]: '4547946\n',
        [`${C}/cpu1/cpufreq/scaling_cur_freq`]: '4167329\n',
        [`${C}/cpufreq/ignored`]: 'x',
      }),
    );
    expect(f).toEqual({ curHz: 4167329000, maxHz: 4547946000 });
  });
  it('returns undefined without cpufreq', async () => {
    expect(await readCpuFreq(fakeSysfs({ [`${C}/cpu0/online`]: '1' }))).toBeUndefined();
  });
});

describe('readPowerProfile', () => {
  it('reads the ACPI profile', async () => {
    expect(await readPowerProfile(fakeSysfs({ '/sys/firmware/acpi/platform_profile': 'balanced\n' }))).toBe(
      'balanced',
    );
  });
  it('returns undefined when absent', async () => {
    expect(await readPowerProfile(fakeSysfs({}))).toBeUndefined();
  });
});

describe('readGpu', () => {
  it('reads an AMD GPU and ignores display connector entries', async () => {
    expect(await readGpu(fakeSysfs(AMD))).toEqual({
      busyPercent: 1,
      vramUsed: 981929984,
      clockHz: 200000000,
      watts: 18,
    });
  });

  it('falls back to average power', async () => {
    const g = await readGpu(
      fakeSysfs({
        [`${D}/card0/device/gpu_busy_percent`]: '5',
        [`${D}/card0/device/hwmon/hwmon1/power1_average`]: '9000000',
      }),
    );
    expect(g).toEqual({ busyPercent: 5, watts: 9 });
  });

  it('reads the Intel clock', async () => {
    const g = await readGpu(
      fakeSysfs({ [`${D}/card0/gt_cur_freq_mhz`]: '350\n', [`${D}/card0/device/vendor`]: '0x8086' }),
    );
    expect(g).toEqual({ clockHz: 350e6 });
  });

  it('never reads a suspended GPU, using the next active one', async () => {
    const fs = fakeSysfs({
      [`${D}/card0/device/power/runtime_status`]: 'suspended\n',
      [`${D}/card0/device/gpu_busy_percent`]: '0',
      [`${D}/card1/device/gpu_busy_percent`]: '7',
    });
    expect(await readGpu(fs)).toEqual({ busyPercent: 7 });
    expect(fs.reads).not.toContain(`${D}/card0/device/gpu_busy_percent`);
  });

  it('returns undefined when only suspended or empty cards exist', async () => {
    const fs = fakeSysfs({
      [`${D}/card0/device/power/runtime_status`]: 'suspended\n',
      [`${D}/card2/device/vendor`]: '0x10de',
    });
    expect(await readGpu(fs)).toBeUndefined();
  });
});
