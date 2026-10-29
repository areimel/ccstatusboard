import { readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../core/exec.js';

export type CredentialsResult =
  | { kind: 'ok'; accessToken: string; expiresAt?: number }
  | { kind: 'missing' }
  | { kind: 'expired'; expiresAt: number };

export interface CredentialsDeps {
  readFile?: (p: string) => Promise<string>;
  exec?: (cmd: string, args: string[], timeoutMs: number) => Promise<string>;
  platform?: NodeJS.Platform;
  now?: () => number;
}

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const KEYCHAIN_TIMEOUT_MS = 2000;

interface OAuthToken {
  accessToken: string;
  expiresAt?: number;
}

function defaultExec(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return runCommand(cmd, args, { timeoutMs });
}

function extractToken(raw: string): OAuthToken | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return undefined;
  }
  const oauth = (parsed as { claudeAiOauth?: unknown } | null)?.claudeAiOauth as
    { accessToken?: unknown; expiresAt?: unknown } | undefined;
  if (!oauth || typeof oauth.accessToken !== 'string' || oauth.accessToken.length === 0) return undefined;
  return typeof oauth.expiresAt === 'number'
    ? { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt }
    : { accessToken: oauth.accessToken };
}

async function fromFile(
  claudeDir: string,
  readFile: (p: string) => Promise<string>,
): Promise<OAuthToken | undefined> {
  try {
    return extractToken(await readFile(join(claudeDir, '.credentials.json')));
  } catch {
    return undefined;
  }
}

async function fromKeychain(
  exec: (cmd: string, args: string[], timeoutMs: number) => Promise<string>,
): Promise<OAuthToken | undefined> {
  try {
    const out = await exec(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      KEYCHAIN_TIMEOUT_MS,
    );
    return extractToken(out);
  } catch {
    return undefined;
  }
}

/** Reads the Claude Code OAuth token. Read-only: never refreshes or writes credentials. */
export async function readCredentials(
  claudeDir: string,
  deps: CredentialsDeps = {},
): Promise<CredentialsResult> {
  const readFile = deps.readFile ?? ((p: string) => fsReadFile(p, 'utf8'));
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? Date.now;

  let token = await fromFile(claudeDir, readFile);
  if (!token && platform === 'darwin') token = await fromKeychain(deps.exec ?? defaultExec);
  if (!token) return { kind: 'missing' };
  if (token.expiresAt !== undefined && token.expiresAt < now()) {
    return { kind: 'expired', expiresAt: token.expiresAt };
  }
  return token.expiresAt === undefined
    ? { kind: 'ok', accessToken: token.accessToken }
    : { kind: 'ok', accessToken: token.accessToken, expiresAt: token.expiresAt };
}
