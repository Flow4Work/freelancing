
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import ts from "typescript";
const require = createRequire(import.meta.url);
const authPath = path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
let stored = {};
let calls = 0;
let response = null;
const fakeKey = "fixture-bai-not-a-real-key";
const mockedFs = {
  readFileSync(p) { if (p === authPath) return JSON.stringify(stored); throw new Error("missing"); },
  mkdirSync() {},
  writeFileSync(p, value) { assert.equal(p, authPath); stored = JSON.parse(value); },
};
const source = ts.transpileModule(fs.readFileSync("src/lib/automation/api-connections.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const module = { exports: {} };
vm.runInNewContext("(function(require,module,exports){" + source + "})", {
  process, AbortSignal, console: { info() {} },
  fetch: async (url, options) => {
    calls++;
    assert.equal(url, "https://api.b.ai/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer " + fakeKey);
    assert.equal(JSON.parse(options.body).model, "deepseek-v4.1-flash");
    if (response instanceof Error) throw response;
    return { ok: response.status === 200, status: response.status, json: async () => response.body };
  },
})(id => id === "node:fs" ? mockedFs : require(id), module, module.exports);
const api = module.exports;
assert.equal((await api.testBaiConnection()).code, "not_configured");
assert.equal(calls, 0);
const publicSettings = api.saveApiConnection("bai", fakeKey);
assert.equal(stored.bai.key, fakeKey);
assert.equal(publicSettings.find(x => x.id === "bai").connected, true);
assert.ok(!JSON.stringify(publicSettings).includes(fakeKey));
assert.ok(!publicSettings.some(x => x.id === "vercel"));
assert.throws(() => api.saveApiConnection("bai", "bad\nkey"), /API Key/);
for (const [status,code] of [[401,"auth"],[403,"auth"],[402,"quota"],[429,"rate_limit"],[404,"invalid_model"],[400,"malformed_request"],[503,"provider_unavailable"]]) {
  response = {status, body:{error:{message:fakeKey}}};
  const result = await api.testBaiConnection();
  assert.equal(result.code, code);
  assert.ok(!JSON.stringify(result).includes(fakeKey));
}
response = {status:200,body:{choices:[{message:{content:"ok"}}],usage:{prompt_tokens:4,completion_tokens:1}}};
assert.equal((await api.testBaiConnection()).ok, true);
response = {status:200,body:{choices:[]}};
assert.equal((await api.testBaiConnection()).code, "invalid_response");
const config = JSON.parse(fs.readFileSync("opencode.json","utf8"));
assert.equal(config.provider.bai.options.baseURL,"https://api.b.ai/v1");
assert.ok(config.disabled_providers.includes("vercel"));
assert.ok(!config.provider.bai.options.apiKey);
for (const agent of ["fixup-duplicate","fixup-verification","fixup-dm","fixup-dm-sync"]) assert.ok(config.agent[agent]);
const fixture = path.join(os.tmpdir(),"fixup-bai-classify-"+Date.now()+".ps1");
fs.writeFileSync(fixture, [
  "$ErrorActionPreference='Stop'",
  "$tokens=$null; $errors=$null",
  "$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/fixup-opencode-wrapper.ps1'),[ref]$tokens,[ref]$errors)",
  "if($errors.Count){throw 'wrapper syntax'}",
  "$names=@('Get-BaiFailureCode','Test-ProviderBillingQuota','Test-ProviderRateLimit')",
  "$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in $names},$true) | ForEach-Object {Invoke-Expression $_.Extent.Text}",
  "$Provider='bai'",
  "$cases=@(@('401 Unauthorized',181),@('402 insufficient credits',174),@('model not found',182),@('invalid_request 400',183),@('tools not supported',184),@('ETIMEDOUT',185),@('429 rate limit',186),@('503 service unavailable',0),@('FIXUP_LOCAL_tool_execution TimeoutError browserBackend',0))",
  "foreach($case in $cases){if((Get-BaiFailureCode $case[0]) -ne $case[1]){throw ('classification: '+$case[0])}}",
  "'B.AI provider error classification: PASS'",
].join("\n"));
try {
  const run=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",fixture],{encoding:"utf8",windowsHide:true});
  assert.equal(run.status,0,run.stdout+run.stderr);
} finally { fs.rmSync(fixture,{force:true}); }
console.log("B.AI missing key, masked settings, direct request/model, safe error taxonomy, response validation, wrapper classification: PASS");
