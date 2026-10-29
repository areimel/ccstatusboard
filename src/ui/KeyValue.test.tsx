import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Box } from 'ink';
import { KeyValue } from './KeyValue.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

describe('KeyValue', () => {
  it('pads the label to labelWidth and prints the value after it', () => {
    const out = stripAnsi(render(<KeyValue label="week" value="$96.10" labelWidth={7} />).lastFrame());
    expect(out).toBe('week   $96.10');
  });

  it('defaults labelWidth to label.length + 1', () => {
    const out = stripAnsi(render(<KeyValue label="block" value="$1.00" />).lastFrame());
    expect(out).toBe('block $1.00');
  });

  it('truncates a value that overflows its container', () => {
    const out = stripAnsi(
      render(
        <Box width={12}>
          <KeyValue label="block" value="$123456.78" labelWidth={7} />
        </Box>,
      ).lastFrame(),
    );
    expect(out).toHaveLength(12);
    expect(out.endsWith('…')).toBe(true);
    expect(out.startsWith('block  ')).toBe(true);
  });
});
