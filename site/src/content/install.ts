// Transcribed from README.md (the source of truth). Update both together.

export interface NpmCommand {
  cmd: string;
  note: string;
}

export interface EnvVar {
  name: string;
  meaning: string;
  default: string;
}

export interface MethodCommand {
  method: string;
  cmd: string;
}

export interface Platforms {
  supported: string[];
  notes: string[];
}

export const NPM_COMMANDS: readonly NpmCommand[] = [
  {
    cmd: "sudo npm i -g ccstatusboard",
    note: "install globally. If your Node comes from nvm, fnm, Volta or Homebrew, leave out sudo: your global directory is already user-owned, and sudo may not find npm.",
  },
  { cmd: "ccstatusboard", note: "after a global install" },
  { cmd: "npx ccstatusboard", note: "or try it without installing" },
];

export const CURL_INSTALL: string =
  "curl -fsSL https://raw.githubusercontent.com/areimel/ccstatusboard/main/install.sh | sh";

export const PLATFORMS: Platforms = {
  supported: ["Linux x64", "macOS Apple Silicon (arm64)", "macOS Intel (x64)"],
  notes: [
    "ccstatusboard runs on Linux or macOS. Windows is not supported.",
    "Linux arm64 users should install with npm instead.",
  ],
};

export const INSTALL_ENV_VARS: readonly EnvVar[] = [
  {
    name: "CCSTATUSBOARD_VERSION",
    meaning: "Release tag to install (for example v0.2.0)",
    default: "latest release",
  },
  {
    name: "CCSTATUSBOARD_INSTALL_DIR",
    meaning: "Directory to install the binary into",
    default: "~/.local/bin",
  },
];

export const UPDATE: readonly MethodCommand[] = [
  { method: "npm", cmd: "sudo npm i -g ccstatusboard@latest" },
  {
    method: "standalone binary (re-run the same curl command)",
    cmd: "curl -fsSL https://raw.githubusercontent.com/areimel/ccstatusboard/main/install.sh | sh",
  },
];

export const UNINSTALL: readonly MethodCommand[] = [
  { method: "npm", cmd: "sudo npm rm -g ccstatusboard" },
  {
    method: "standalone binary (respects CCSTATUSBOARD_INSTALL_DIR; or just delete the file)",
    cmd: "curl -fsSL https://raw.githubusercontent.com/areimel/ccstatusboard/main/install.sh | sh -s -- --uninstall",
  },
];

export const REQUIREMENTS: string = "Node 22+ for npm";
