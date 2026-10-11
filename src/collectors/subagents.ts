import { readdir as fsReaddir, readFile as fsReadFile, stat as fsStat } from 'node:fs/promises';
import { join } from 'node:path';

export interface AgentActivity {
  activeCount: number;
  names: string[];
  files: string[];
}

export interface SubagentDeps {
  readdir?: (dir: string) => Promise<string[]>;
  stat?: (p: string) => Promise<{ mtimeMs: number }>;
  readFile?: (p: string) => Promise<string>;
}

/** Inspect `<session>/subagents/`: every agent transcript path, plus which agents wrote recently. */
export async function scanSubagents(
  dir: string,
  now: number,
  deps: SubagentDeps = {},
  activeWindowMs = 30_000,
): Promise<AgentActivity> {
  const readdir = deps.readdir ?? ((d: string) => fsReaddir(d));
  const stat = deps.stat ?? ((p: string) => fsStat(p));
  const readFile = deps.readFile ?? ((p: string) => fsReadFile(p, 'utf8'));

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { activeCount: 0, names: [], files: [] };
  }

  const files = names
    .filter((n) => n.startsWith('agent-') && n.endsWith('.jsonl'))
    .sort()
    .map((n) => join(dir, n));

  const activeNames: string[] = [];
  for (const file of files) {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(file)).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs < now - activeWindowMs) continue;
    activeNames.push(await agentName(file, readFile));
  }
  return { activeCount: activeNames.length, names: activeNames, files };
}

async function agentName(file: string, readFile: (p: string) => Promise<string>): Promise<string> {
  try {
    const meta: unknown = JSON.parse(await readFile(file.replace(/\.jsonl$/, '.meta.json')));
    if (meta && typeof meta === 'object') {
      const t = (meta as Record<string, unknown>).agentType;
      if (typeof t === 'string' && t.length > 0) return t;
    }
  } catch {
    // missing or malformed meta: fall through
  }
  return 'agent';
}
