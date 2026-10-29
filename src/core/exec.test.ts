import { describe, expect, it } from 'vitest';
import { runCommand } from './exec.js';

const node = (code: string): [string, string[]] => [process.execPath, ['-e', code]];

describe('runCommand', () => {
  it('resolves with stdout on success', async () => {
    const [cmd, args] = node("process.stdout.write('hi')");
    expect(await runCommand(cmd, args, { timeoutMs: 5000 })).toBe('hi');
  });
  it('rejects on non-zero exit by default', async () => {
    const [cmd, args] = node("process.stdout.write('x'); process.exit(1)");
    await expect(runCommand(cmd, args, { timeoutMs: 5000 })).rejects.toThrow();
  });
  it('keeps partial stdout on non-zero exit when asked', async () => {
    const [cmd, args] = node("process.stdout.write('x'); process.exit(1)");
    expect(await runCommand(cmd, args, { timeoutMs: 5000, keepPartialStdout: true })).toBe('x');
  });
  it('still rejects when partial stdout is empty', async () => {
    const [cmd, args] = node('process.exit(1)');
    await expect(runCommand(cmd, args, { timeoutMs: 5000, keepPartialStdout: true })).rejects.toThrow();
  });
});
