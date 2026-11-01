# System Monitor Pt2: temperatures and extra metrics

## Context

The System panel currently shows CPU, memory, swap, disk, network speeds, per-core usage and load. The user wants temperature readings, as `btm` shows, plus other useful machine metrics. A scan of their Lenovo V15 G4 (Ryzen 7 7730U, Ubuntu 24.04) found that everything wanted can be read from `/sys`, `/proc` and Node's `os` module, with no root, new packages or child processes.

Outcome: the panel shows five new metric groups, each with its own on/off setting.

## User decisions

- **Groups:** Temperatures, Battery and uptime, CPU and GPU, Pressure and disk, Network. All are wanted.
- **Layout:** an extra column on wide terminals.
- **Toggles:** one per group, under a single settings entry that works like Columns.
- **Short screens:** metric groups temporarily drop out so the session table keeps a minimum height. Drop order is Network, Pressure and disk, CPU and GPU, Battery and uptime, with Temperatures last. They return when there's room.
- **Panel height:** stays steady. Each group reserves fixed rows and truncates text that doesn't fit, so live values never move the session table.

## Calls made while planning (open to correction)

- All groups are on by default, including for existing configs.
- Below 100 columns, the extra readings stack as full-width rows under the existing columns, so nothing is lost.
- Temperatures are shown in °C only.
- Metrics are sampled even when their group is off. This keeps the monitor independent of config and makes toggles instant.
- A metric with no data is omitted. A group with no data takes no rows.
- Non-Linux platforms get uptime only. macOS sensor and battery support, and NVIDIA via `nvidia-smi`, are out of scope.

## Panel layout

At 100+ columns, with everything on (illustrative: real meters keep their existing `[|||  42%]` style):

```
╭ System ───────────────────────────────────────────────────────────────────╮
│ CPU  ███░░ 42% load 1.2 0.9 0.8  ↓ 1.2M/s ▂▃▅▂  CPU 66° GPU 48° Board 53°  │
│ Mem  ████░ 66% 8.9G/13.5G        ↑ 34K/s  ▁▁▂▁  WiFi 40° SSD 34°           │
│ Swap ███░░ 52% 2.1G/4.0G         cores ▂▅▇█▃▁   98% AC  92%  up 1h9m       │
│ Disk ██░░░ 38% 118G/334G /       wlp2s0 -47dBm  4.17GHz balanced  GPU 1%   │
│ Press mem 0.6% cpu 0.6% io 0%    192.168.1.160  936M 200MHz 18W            │
│                                  R 0 W 1M 552p                             │
╰───────────────────────────────────────────────────────────────────────────╯
```

Fixed slots at 100+ columns:

| Group | Column | Rows |
|---|---|---|
| Pressure and disk | Left: pressure; middle: disk speeds and process/thread counts | 1 + 1 |
| Network | Middle (interface and signal; IP and VPN) | 2 |
| Temperatures | Right (new, 30 wide) | 2 |
| Battery and uptime | Right | 1 |
| CPU and GPU | Right | 2 |

- Middle column keeps its width of 26 and its rx, tx and cores rows.
- **Below 100 columns:** the existing two columns, then one truncated full-width row per enabled group.
- A slot is reserved when its group is enabled and the machine has any data for it. Time left or a VPN appearing fills space in an existing slot, and never adds a row.
- Height is 2 borders + the tallest column, computed by a pure function shared with rendering, so `systemPanelRows` can't drift from the output.
- Turning a group off frees height only if it was in the tallest column.

### Height budget

- `App.tsx` computes the rows available to the System panel: terminal rows, minus the header, usage panel, table chrome, footer and spare row, minus `DETAIL_ROWS` when the Detail pane is eligible, minus a new `MIN_SESSION_ROWS = 3`.
- A pure `visibleSystemGroups(stats, metrics, columns, maxPanelRows)` drops enabled groups in the order above until the panel fits.
- The base panel (meters, network speeds, cores) is never dropped, and `SYSTEM_MIN_ROWS` stays 30. If the base alone doesn't fit, behavior is the same as today.
- By calculation, a typical 100×30 terminal keeps today's 6-row panel, showing Temperatures and Battery and uptime, plus 3 session rows and the Detail pane. Roughly 32+ rows fit everything at that width.

## Implementation

### 1. Types (`src/domain/types.ts`, first)

- Add `SYSTEM_METRIC_KEYS = ['temps', 'power', 'chips', 'pressure', 'network']` and `SystemMetricKey`.
- Add `systemMetrics: SystemMetricKey[]` to `Config`.
- Extend `SystemStats` with **optional** fields so `makeSystemStats` and darwin keep working:
  - `temps?: TempReading[]`, where `TempReading` is `{ label, celsius, warn?, crit? }`
  - `battery?`: percent, status, watts, secondsLeft, healthPercent, cycles
  - `uptimeSec?`
  - `cpuFreq?`: curHz, maxHz
  - `powerProfile?`
  - `gpu?`: busyPercent, vramUsed, clockHz, watts
  - `pressure?`: mem, cpu, io
  - `diskIo?`: readPerSec, writePerSec
  - `procs?`: processes, threads
  - `link?`: iface, ip, signalDbm, vpn

### 2. Collectors (new files in `src/collectors/system/`, one test file each)

Each exports a pure parser where possible plus a reader taking injected deps. Add `readdir`, `uptime` and `networkInterfaces` to `SystemMonitorDeps`.

- **`temps.ts`:** walk `/sys/class/hwmon/*`, reading `name`, `temp*_input`, `temp*_label`, `temp*_max`, `temp*_crit`.
  - Friendly names: `k10temp`/`coretemp` → CPU, `amdgpu`/`i915`/`nouveau` → GPU, `acpitz*` → Board (real name here is `acpitz_0`), `mt7*`/`iwlwifi*`/`ath*`/`rtw*` → WiFi (real name here is `mt7921_phy0`), `nvme` → SSD, otherwise the raw name. Suffix duplicates (`SSD2`).
  - Keep one reading per chip: NVMe Composite, k10temp Tdie then Tctl, coretemp Package. This drops NVMe `Sensor 1`, giving 5 on this machine.
  - Discard readings and limits outside -20 to 150°C. Real data includes a 65,261°C max.
- **`battery.ts`:** from `/sys/class/power_supply/*`, use the first `type=Battery` that doesn't have `scope=Device` (excludes mice and keyboards).
  - Support both `energy_*`/`power_now` and `charge_*`/`current_now` (multiply by voltage).
  - Time left is computed only while charging or discharging. Hide watts when 0. Health is full ÷ design.
- **`chips.ts`:** highest `scaling_cur_freq` across cores, `cpuinfo_max_freq`, `/sys/firmware/acpi/platform_profile`, and GPU values from `/sys/class/drm/card*/device` (`gpu_busy_percent`, `mem_info_vram_used`, hwmon `freq1_input`, `power1_input` or `power1_average`). Match entries with `^card\d+$`, since the glob also matches display connectors such as `card1-eDP-1`.
  - Check the device's `power/runtime_status` first, and skip a GPU that's `suspended`, so monitoring doesn't wake a sleeping discrete GPU or drain the battery.
  - `temps.ts` applies the same check to GPU sensors through one shared helper.
- **`pressure.ts`:** `some avg10` from `/proc/pressure/{memory,cpu,io}`.
- **`diskIo.ts`:** sectors × 512 from `/proc/diskstats`, whole disks only (`nvmeXnY`, `sdX`, `vdX`, `mmcblkX`), never loop devices or partitions. First sample is 0, as with network.
- **`procs.ts`:** thread total from `/proc/loadavg`, process count from numeric `/proc` entries.
- **`link.ts`:** default-route interface from `/proc/net/route` (lowest metric), IPv4 from `networkInterfaces()`, signal from `/proc/net/wireless`, VPN from interfaces named `tailscale*`, `wg*`, `tun*` or `tap*` that have an address.

Wire these into `SystemMonitor.sample()` in `systemMonitor.ts` following its existing pattern: one try/catch per group, and a failure leaves that field undefined. Keep `prevDisk` state alongside `prevNet`. Uptime runs on every platform; everything else is gated on `platform === 'linux'`.

### 3. Store (`src/store/sanitize.ts`)

Extend `sanitizeSystem`. It spreads unknown fields through, so each new field needs explicit handling: `sanitizeText` on every sysfs string (temp labels, interface, VPN, profile, battery status), and a new helper on optional numbers that keeps `undefined`. `nonNeg` itself turns `undefined` into 0, which would show missing data as a real `GPU 0%`. Temperatures and signal dBm can be legitimately negative, so use a finite check for those.

### 4. Config and settings

- `src/config/schema.ts`: `systemMetrics` default is all keys, schema is an array of the enum. Empty is allowed, unlike `columns`.
- `src/ui/options/optionsModel.ts`: add `{ key: 'systemMetrics', label: 'System metrics', kind: 'metrics' }` directly after `System panel`. `formatValue` returns `3/5 shown`.
- `src/ui/options/OptionsMenu.tsx`: add a `'metrics'` mode alongside `'columns'`, reusing `MultiSelect`, with readable labels (Temperatures, Battery & uptime, CPU & GPU, Pressure & disk, Network). Save in canonical order and allow an empty selection: `MultiSelect` already submits empty, and the `v.length > 0` guard at `OptionsMenu.tsx:80` must not be copied.

### 5. UI

- New `src/ui/systemMetrics.ts` (pure, no IO): `visibleSystemGroups`, the slot and height calculation, and the builders that fill each slot's fixed rows, truncating with `truncateDisplay`. Uses existing `formatRate`, `formatBytes`, `formatDuration` (takes milliseconds, so convert `uptimeSec`), `formatPercent`.
- `src/ui/layout.ts`: add `SYSTEM_WIDE_COLUMNS = 100` and `MIN_SESSION_ROWS = 3`. `SystemPanel` passes 26 + 2 + 30 as the reserved right width to `splitColumns`.
- `src/ui/SystemPanel.tsx`: takes the visible groups as a prop, and adds the third column and stacked mode. `systemPanelRows` takes the same inputs. `src/ui/App.tsx` computes the budget before `computeLayout` and passes the result to both (`App.tsx:76`, `App.tsx:141`).
- `MeterStack` is meter-only, so render the pressure row beneath it as text in the left column.
- Colors use existing `levelColor(theme, value, [warn, crit])`. Temperature thresholds are the sensor's own limits when valid, otherwise 85/95 for CPU and GPU and 70/85 for others (Ryzen U chips run hot under normal boost). Battery is colored by low charge only.

### 6. Docs

Update the README or config docs if they list config keys. On approval, save this design as `docs/superpowers/specs/2026-11-01-system-metrics-design.md`.

## Tests

TDD with injected fakes, following `systemMonitor.test.ts`. Extend `test/helpers/system.ts` with a fully populated stats fixture. Use real values from this scan as fixtures:

- **Temps:** bogus NVMe max is discarded; Composite is kept and Sensor 1 dropped; duplicate labels are suffixed.
- **Battery:** `Not charging` at 0 W; `charge_*` variant; peripheral battery ignored; no battery gives undefined.
- **Chips:** suspended GPU is never read.
- **Monitor:** one group failing leaves the others intact; darwin yields only uptime.
- **Sanitize:** control characters are stripped from new strings; negative temperature survives.
- **Config:** old config without the key gets all groups; empty array is valid; unknown key is rejected.
- **Options:** menu entry shows `n/5 shown`; toggling persists.
- **UI:** each toggle removes its content; 100- and 99-column layouts; `systemPanelRows` equals the rendered height.
- **Budget:** groups drop in the agreed order and return when there's room; the table keeps at least 3 rows where the base panel fits. `App.height.test.tsx` gains max-content cases at 30 rows and at 60, 80, 100 and 160 columns via `expectFits`.
- **Steady height:** frames with changing values (GPU 1% to 100%, unplugging, VPN connecting) produce the same panel height and the same session row count.

## Verification

1. `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
2. `npm run dev` on this machine: compare temperatures with `btm`, and battery with `upower -i /org/freedesktop/UPower/devices/battery_BAT0`.
3. Resize across 100 columns and through 30–40 rows: no clipping, footer stays visible, and groups drop and return in order.
4. Toggle each group in Options, restart, and confirm the choice persists.
5. Unplug AC: watts and time left appear, and status changes.
