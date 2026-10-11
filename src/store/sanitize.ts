// Strings from disk/network are rendered raw by the UI; strip control characters
// so a crafted session file cannot inject ANSI/OSC escape sequences into the terminal.

function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/** Removes C0 controls (tab becomes a space), DEL and C1 controls. */
export function sanitizeText(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x09) out += ' ';
    else if (!isControl(code)) out += ch;
  }
  return out;
}

export function sanitizeOptional(s: string | undefined): string | undefined {
  return s === undefined ? undefined : sanitizeText(s);
}
