/** Splits a stream of text chunks into complete lines, buffering any partial trailing line. */
export class LineSplitter {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const parts = this.buffer.split('\n');
    this.buffer = parts.pop() ?? '';
    return parts.map(stripCr).filter(isNonBlank);
  }

  flush(): string[] {
    const rest = stripCr(this.buffer);
    this.buffer = '';
    return isNonBlank(rest) ? [rest] : [];
  }

  get pending(): string {
    return this.buffer;
  }
}

function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function isNonBlank(line: string): boolean {
  return line.trim().length > 0;
}

/** JSON.parse that never throws; returns undefined on bad input. */
export function safeParse(line: string): unknown | undefined {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}
