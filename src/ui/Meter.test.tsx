import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Meter } from './Meter.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

const frame = (el: React.ReactElement) => stripAnsi(render(el).lastFrame());

describe('Meter', () => {
  it('renders an htop-style bar with right-aligned percent and suffix', () => {
    // width 22 → 20 inner cells; 50% → 10 bars, then 7 spaces, then "50%"
    const out = frame(<Meter label="5h" labelWidth={4} percent={50} width={22} suffix="resets 2h14m" />);
    expect(out).toContain('5h   [||||||||||       50%] resets 2h14m');
  });

  it('lets the percent text cover the bar at 100%', () => {
    const out = frame(<Meter label="Week" percent={100} width={22} />);
    expect(out).toContain('[||||||||||||||||100%]');
  });

  it('clamps the bar above 100% but prints the real number', () => {
    const out = frame(<Meter label="Week" percent={112} width={22} />);
    expect(out).toContain('[||||||||||||||||112%]');
  });

  it('renders 0% as an empty bar', () => {
    const out = frame(<Meter label="5h" percent={0} width={12} />);
    expect(out).toContain('[        0%]');
  });

  it('renders an em dash when percent is unknown', () => {
    const out = frame(<Meter label="5h" percent={undefined} width={22} />);
    expect(out).toContain('[         —          ]');
  });
});
