import { open, readFile, rm, stat } from "node:fs/promises";

const STARTUP_GRACE_MS = 30_000;
const LEGACY_STALE_MS = 10 * 60 * 1000;

type LockState = {
  token: string;
  profile: string;
  processId: number | null;
  createdAt: string;
};

export async function tryAcquireDmSyncLock(filePath: string, token: string, profile: string) {
  if (await createLock(filePath, { token, profile, processId: null, createdAt: new Date().toISOString() })) return true;
  if (await isDmSyncLockActive(filePath)) return false;
  await rm(filePath, { force: true });
  return createLock(filePath, { token, profile, processId: null, createdAt: new Date().toISOString() });
}

export async function isDmSyncLockActive(filePath: string) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LockState>;
    if (typeof parsed.token === "string" && parsed.token && typeof parsed.createdAt === "string") {
      if (Number.isInteger(parsed.processId) && Number(parsed.processId) > 0) return isProcessAlive(Number(parsed.processId));
      const created = Date.parse(parsed.createdAt);
      return Number.isFinite(created) && Date.now() - created <= STARTUP_GRACE_MS;
    }
  } catch {}
  try {
    const info = await stat(filePath);
    return Date.now() - info.mtimeMs <= LEGACY_STALE_MS;
  } catch {
    return false;
  }
}

export async function releaseDmSyncLock(filePath: string, token: string) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<LockState>;
    if (parsed.token === token) await rm(filePath, { force: true });
  } catch {}
}

async function createLock(filePath: string, state: LockState) {
  try {
    const handle = await open(filePath, "wx");
    try { await handle.writeFile(JSON.stringify(state), "utf8"); }
    finally { await handle.close(); }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function isProcessAlive(processId: number) {
  try { process.kill(processId, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
