import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const sourcePath = path.join(root, "src/lib/automation/dm-sync-lock.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const moduleShim = { exports: {} };
new Function("require", "module", "exports", compiled)(require, moduleShim, moduleShim.exports);
const { tryAcquireDmSyncLock, isDmSyncLockActive, releaseDmSyncLock } = moduleShim.exports;
assert.ok(tryAcquireDmSyncLock && isDmSyncLockActive && releaseDmSyncLock, "lock exports unavailable");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fixup-dm-sync-lock-"));
const lockPath = path.join(temp, "dm-sent-sync-profile-3.lock");
const tokenA = "token-a";
const tokenB = "token-b";
try {
  const results = await Promise.all([
    tryAcquireDmSyncLock(lockPath, tokenA, "Profile 3"),
    tryAcquireDmSyncLock(lockPath, tokenB, "Profile 3"),
  ]);
  assert.equal(results.filter(Boolean).length, 1, "exactly one concurrent acquisition must win");
  const winner = results[0] ? tokenA : tokenB;
  const loser = results[0] ? tokenB : tokenA;
  assert.equal(await isDmSyncLockActive(lockPath), true, "winner lock must be active");
  await releaseDmSyncLock(lockPath, loser);
  assert.equal(await isDmSyncLockActive(lockPath), true, "loser must not release winner lock");
  await releaseDmSyncLock(lockPath, winner);
  assert.equal(await isDmSyncLockActive(lockPath), false, "winner release must clear lock");
  assert.equal(await tryAcquireDmSyncLock(lockPath, "single-run", "Profile 3"), true, "normal single run must acquire");
  await releaseDmSyncLock(lockPath, "single-run");

  const launcher = fs.readFileSync(path.join(root, "src/lib/automation/opencode-dm-sync-launcher.ts"), "utf8");
  for (const needle of ["syncLockPath(root, chromeProfile)", "System.Threading.Mutex", "$Mutex.WaitOne(0)", "$env:FIXUP_SCOUT_AGENT = $OpenCodeAgent", "getOpenCodeAgent(\"dm-sync\")"]) {
    assert.ok(launcher.includes(needle), `production single-flight/agent wiring missing: ${needle}`);
  }
  assert.ok(!launcher.includes("syncLockPath(root, category)"), "lock must not be category-scoped");
  console.log("PASS dm-sync lock regression");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
