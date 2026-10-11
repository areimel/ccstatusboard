// Renders an Ink element into a fake TTY whose columns/rows match the requested size.
// ink-testing-library's stdout is fixed at 100 columns, so layout-height tests use this instead.
import { EventEmitter } from 'node:events';
import type { ReactElement } from 'react';
import { render, type Instance } from 'ink';
import { stripAnsi } from './ansi.js';

export interface SizedRender {
  /** Last non-empty frame, ANSI-stripped, without the trailing newline. */
  lastFrame: () => string;
  unmount: () => void;
  instance: Instance;
}

export function renderSized(el: ReactElement, size: { columns: number; rows: number }): SizedRender {
  const frames: string[] = [];
  const stdout = Object.assign(new EventEmitter(), {
    columns: size.columns,
    rows: size.rows,
    isTTY: true,
    write: (chunk: string) => {
      frames.push(chunk);
      return true;
    },
  });
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    setRawMode: () => {},
    setEncoding: () => {},
    read: () => null,
    ref: () => {},
    unref: () => {},
  });
  const instance = render(el, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  return {
    lastFrame: () => stripAnsi(frames.filter((f) => f.trim() !== '').at(-1) ?? '').replace(/\n$/, ''),
    unmount: () => instance.unmount(),
    instance,
  };
}
