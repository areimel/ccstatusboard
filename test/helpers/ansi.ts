// Strips ANSI SGR/CSI sequences so UI tests can assert on plain text.
const ESC = String.fromCharCode(27);
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g');

export function stripAnsi(s: string | undefined): string {
  return (s ?? '').replace(CSI, '');
}
