import { execFile } from 'node:child_process';

export interface RunCommandOptions {
  timeoutMs: number;
  /** On a non-zero exit, resolve with stdout when it is non-empty instead of rejecting. */
  keepPartialStdout?: boolean;
}

/** Runs a command without a shell and resolves with its stdout. */
export function runCommand(cmd: string, args: string[], opts: RunCommandOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts.timeoutMs, encoding: 'utf8' }, (err, stdout) => {
      if (!err) return resolve(stdout);
      if (opts.keepPartialStdout && typeof stdout === 'string' && stdout.trim() !== '')
        return resolve(stdout);
      reject(err);
    });
  });
}
