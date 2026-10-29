export interface DiskUsage {
  used: number;
  total: number;
  mount: string;
}

export interface DiskDeps {
  statfs: (
    path: string,
  ) => Promise<{ blocks: number | bigint; bfree: number | bigint; bsize: number | bigint }>;
}

export async function readDisk(mount: string, deps: DiskDeps): Promise<DiskUsage> {
  const s = await deps.statfs(mount);
  const bsize = Number(s.bsize);
  return { used: (Number(s.blocks) - Number(s.bfree)) * bsize, total: Number(s.blocks) * bsize, mount };
}
