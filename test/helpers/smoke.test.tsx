// Confirmed add-on APIs (read from README + .d.ts, verified by the tests below):
// - TitledBox (@mishieck/ink-titled-box): props `borderStyle` (required, as Ink Box), `titles: string[]`,
//   optional `titleStyles` ({ start, end }; presets in `titleStyles` export); otherwise Ink Box props.
//   Works on Ink 7, but the title row only appears on the SECOND render (it measures width in an effect):
//   the first lastFrame() has no top border, so tests must wait a tick before asserting on the title.
// - Sparkline (@pppp606/ink-chart): props `data: number[]`, `width?: number` (see Sparkline.d.ts).
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { TitledBox } from '@mishieck/ink-titled-box';
import { Sparkline } from '@pppp606/ink-chart';
import { ProgressBar } from '@inkjs/ui';
import Gradient from 'ink-gradient';

describe('ink add-on smoke test (Ink 7)', () => {
  it('renders TitledBox with title in the border', async () => {
    const { lastFrame } = render(
      <TitledBox borderStyle="round" titles={['Usage']}>
        <Text>hi</Text>
      </TitledBox>,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lastFrame()).toContain('Usage');
    expect(lastFrame()).toContain('hi');
  });
  it('renders Sparkline, ProgressBar and Gradient without throwing', () => {
    expect(() => render(<Sparkline data={[1, 3, 2, 5]} width={4} />)).not.toThrow();
    expect(() => render(<ProgressBar value={40} />)).not.toThrow();
    const { lastFrame } = render(
      <Gradient name="pastel">
        <Text>ccstatusboard</Text>
      </Gradient>,
    );
    expect(lastFrame()).toContain('ccstatusboard');
  });
});
