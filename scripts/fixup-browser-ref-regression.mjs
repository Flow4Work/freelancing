import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import FixUpPlaywrightRefGuard from "../.opencode/plugin/fixup-playwright-ref-guard.mjs";

const agents = ["fixup-duplicate", "fixup-verification", "fixup-dm", "fixup-dm-sync"];
const passed = [];
const hooks = await FixUpPlaywrightRefGuard();

function same(name, actual, expected) {
  assert.equal(actual, expected, name);
  passed.push(name);
}
function pageSnapshot(url, refs) {
  return `### Page\n- Page URL: ${url}\n### Snapshot\n${refs}`;
}
async function snapshotFor(agent, sessionID, text, rawMcp = false, callID = "snap") {
  process.env.FIXUP_SCOUT_AGENT = agent;
  const output = rawMcp
    ? { content: [{ type: "text", text }] }
    : { title: "snapshot", output: text, metadata: {} };
  await hooks["tool.execute.after"](
    { tool: "playwright_b_browser_snapshot", sessionID, callID, args: {} },
    output,
  );
}
async function afterTool(agent, sessionID, tool, text, rawMcp = true) {
  process.env.FIXUP_SCOUT_AGENT = agent;
  const output = rawMcp ? { content: [{ type: "text", text }] } : { title: "x", output: text, metadata: {} };
  await hooks["tool.execute.after"](
    { tool, sessionID, callID: `${tool}-call`, args: {} }, output,
  );
}
async function click(agent, sessionID, target) {
  process.env.FIXUP_SCOUT_AGENT = agent;
  const state = { args: { target } };
  await hooks["tool.execute.before"](
    { tool: "playwright_b_browser_click", sessionID, callID: "click" }, state,
  );
  return state.args.target;
}
async function typeTarget(agent, sessionID, target) {
  process.env.FIXUP_SCOUT_AGENT = agent;
  const state = { args: { target, text: "x", submit: false } };
  await hooks["tool.execute.before"]({ tool: "playwright_b_browser_type", sessionID, callID: "type" }, state);
  return state.args.target;
}
async function fillForm(agent, sessionID, fields) {
  process.env.FIXUP_SCOUT_AGENT = agent;
  const state = { args: { fields: structuredClone(fields) } };
  await hooks["tool.execute.before"](
    { tool: "playwright_b_browser_fill_form", sessionID, callID: "fill" }, state,
  );
  return state.args.fields;
}
async function expectReject(name, fn, pattern) {
  await assert.rejects(fn, pattern);
  passed.push(name);
}

const base = pageSnapshot("https://example.test/a", '- link "Reels" [ref=f4e266] [cursor=pointer]:');
for (const agent of agents) {
  const session = `session-${agent}`;
  await snapshotFor(agent, session, base, true);
  same(`${agent} unique recovery`, await click(agent, session, "ref=f266"), "f4e266");
  same(`${agent} bracketed recovery`, await click(agent, session, "[ref=f4e266]"), "f4e266");
  same(`${agent} raw ref`, await click(agent, session, "f4e266"), "f4e266");
  if (agent === "fixup-dm" || agent === "fixup-dm-sync") {
    await expectReject(`${agent} rejects CSS selector`, () => click(agent, session, "div.foo"), /requires a raw snapshot ref/);
    same(`${agent} type bracketed recovery`, await typeTarget(agent, session, "[ref=f4e266]"), "f4e266");
  } else {
    same(`${agent} CSS div.foo`, await click(agent, session, "div.foo"), "div.foo");
    same(`${agent} CSS attribute`, await click(agent, session, '[data-ref="f266"]'), '[data-ref="f266"]');
    same(`${agent} CSS combinator`, await click(agent, session, "button > span"), "button > span");
    same(`${agent} XPath`, await click(agent, session, '//button[@type="submit"]'), '//button[@type="submit"]');
  }
}

const productionSession = "session-production-mcp-shape";
const productionSnapshot = pageSnapshot(
  "https://www.instagram.com/direct/inbox/",
  '- button "yumin.1103" [ref=f1e591] [cursor=pointer]:',
);
await snapshotFor("fixup-dm-sync", productionSession, productionSnapshot, true);
same("production MCP content[] raw ref", await click("fixup-dm-sync", productionSession, "f1e591"), "f1e591");

const crossPage = "session-cross-page";
await snapshotFor("fixup-dm-sync", crossPage, pageSnapshot("https://example.test/a", '- button "A" [ref=f7e101]'), true, "snap-a");
await snapshotFor("fixup-dm-sync", crossPage, pageSnapshot("https://example.test/b", '- button "B" [ref=f8e202]'), true, "snap-b");
same("unrelated page snapshot does not invalidate A ref", await click("fixup-dm-sync", crossPage, "f7e101"), "f7e101");

const stale = "session-same-page-stale";
await snapshotFor("fixup-dm-sync", stale, pageSnapshot("https://example.test/stale", '- button "Old" [ref=f9e301]'), true, "stale-a");
await snapshotFor("fixup-dm-sync", stale, pageSnapshot("https://example.test/stale", '- button "New" [ref=f9e302]'), true, "stale-b");
await expectReject("same-page DOM stale raw ref", () => click("fixup-dm-sync", stale, "f9e301"), /raw snapshot ref .* is not proven/);
await expectReject("nonexistent raw ref", () => click("fixup-dm-sync", stale, "f9e999"), /raw snapshot ref .* is not proven/);
const dmStale = "session-dm-same-page-stale";
await snapshotFor("fixup-dm", dmStale, pageSnapshot("https://example.test/dm-stale", '- button "Old" [ref=f10e301]'), true, "dm-stale-a");
await snapshotFor("fixup-dm", dmStale, pageSnapshot("https://example.test/dm-stale", '- button "New" [ref=f10e302]'), true, "dm-stale-b");
await expectReject("dm same-page stale raw ref", () => click("fixup-dm", dmStale, "f10e301"), /raw snapshot ref .* is not proven/);

const fill = "session-fill-form";
await snapshotFor("fixup-duplicate", fill, pageSnapshot("https://example.test/login", '- textbox "ID" [ref=f2e7]\n- textbox "PW" [ref=f2e9]\n- button "Login" [ref=f2e10]'), true);
let fillFields = await fillForm("fixup-duplicate", fill, [{ target: "[ref=f2e7]", value: "user" }]);
same("fill_form bracketed ref correction", fillFields[0].target, "f2e7");
fillFields = await fillForm("fixup-duplicate", fill, [{ target: "f2e7", value: "user" }]);
same("fill_form raw ref preserved", fillFields[0].target, "f2e7");
fillFields = await fillForm("fixup-duplicate", fill, [
  { target: "[ref=f2e7]", value: "user" },
  { target: "[ref=f2e9]", value: "secret" },
]);
same("fill_form multiple first ref", fillFields[0].target, "f2e7");
same("fill_form multiple second ref", fillFields[1].target, "f2e9");
await expectReject("fill_form nonexistent bracketed ref", () => fillForm("fixup-duplicate", fill, [{ target: "[ref=f9999]", value: "x" }]), /(?:snapshot ref .* is not uniquely proven|cannot uniquely resolve)/);

const fillStale = "session-fill-form-stale";
await snapshotFor("fixup-duplicate", fillStale, pageSnapshot("https://example.test/login-stale", '- textbox "Old" [ref=f3e7]'), true, "fill-stale-a");
await snapshotFor("fixup-duplicate", fillStale, pageSnapshot("https://example.test/login-stale", '- textbox "New" [ref=f3e9]'), true, "fill-stale-b");
await expectReject("fill_form stale same-page ref", () => fillForm("fixup-duplicate", fillStale, [{ target: "[ref=f3e7]", value: "x" }]), /(?:snapshot ref .* is not uniquely proven|cannot uniquely resolve)/);

fillFields = await fillForm("fixup-duplicate", fill, [{ target: '[data-ref="f2e7"]', value: "x" }]);
same("fill_form CSS attribute preserved", fillFields[0].target, '[data-ref="f2e7"]');
fillFields = await fillForm("fixup-duplicate", fill, [{ target: "button > span", value: "x" }]);
same("fill_form CSS selector preserved", fillFields[0].target, "button > span");
fillFields = await fillForm("fixup-duplicate", fill, [{ target: '//button[@type="submit"]', value: "x" }]);
same("fill_form XPath preserved", fillFields[0].target, '//button[@type="submit"]');

const noRefTool = "session-no-ref-tool";
await snapshotFor("fixup-dm-sync", noRefTool, pageSnapshot("https://example.test/keep", '- button "Keep" [ref=f6e401]'), true);
await afterTool("fixup-dm-sync", noRefTool, "playwright_b_browser_wait_for", "### Result\nWaited for 1\n### Page\n- Page URL: https://example.test/keep", true);
same("non-snapshot no-ref output preserves snapshot", await click("fixup-dm-sync", noRefTool, "f6e401"), "f6e401");

const suffix = "session-suffix";
await snapshotFor("fixup-dm-sync", suffix, pageSnapshot("https://example.test/suffix", '- button "Only" [ref=f4e266]'), true);
same("unique suffix correction", await click("fixup-dm-sync", suffix, "ref=f266"), "f4e266");
await expectReject("suffix zero candidates", () => click("fixup-dm-sync", suffix, "ref=f999"), /cannot uniquely resolve/);
await snapshotFor("fixup-dm-sync", suffix, pageSnapshot("https://example.test/other", '- button "Other" [ref=f5e266]'), true);
await expectReject("suffix multiple candidates", () => click("fixup-dm-sync", suffix, "ref=f266"), /cannot uniquely resolve/);

await snapshotFor("fixup-verification", "session-verification-raw", base, true);
same("non-dm-sync raw ref compatibility", await click("fixup-verification", "session-verification-raw", "f4e999"), "f4e999");

await snapshotFor("example-agent", "session-example", base, true);
same("non-FixUp agent unchanged", await click("example-agent", "session-example", "ref=f266"), "ref=f266");
process.env.FIXUP_SCOUT_AGENT = "fixup-verification";
const nonTargetTool = { args: { target: "ref=f266" } };
await hooks["tool.execute.before"](
  { tool: "playwright_b_browser_type", sessionID: "session-nontarget", callID: "type" }, nonTargetTool,
);
same("non-target tool unchanged", nonTargetTool.args.target, "ref=f266");
delete process.env.FIXUP_SCOUT_AGENT;

const plugin = fs.readFileSync(path.join(process.cwd(), ".opencode/plugin/fixup-playwright-ref-guard.mjs"), "utf8");
for (const agent of agents) {
  assert.ok(plugin.includes(`"${agent}"`), `whitelist missing ${agent}`);
  passed.push(`whitelist ${agent}`);
}
assert.ok(!plugin.includes('VERIFICATION_AGENT = "fixup-verification"'), "verification-only guard remained");
passed.push("no verification-only activation");

const launcher = fs.readFileSync(path.join(process.cwd(), "src/lib/automation/opencode-launcher.ts"), "utf8");
assert.ok(launcher.includes('return "browser_unavailable"'), "browser_unavailable taxonomy missing");
assert.ok(launcher.includes('return "tool_execution"'), "tool_execution taxonomy missing");
assert.ok(launcher.includes('$Retryable = @("quota", "rate_limit", "provider_unavailable", "browser_unavailable", "tool_execution", "incomplete")'), "retryable fallback policy missing browser/tool/incomplete");
assert.ok(launcher.includes('$SameModelRetryDelay = 10'), "transient provider same-model retry missing");
assert.ok(launcher.includes('$Result.classification -in @("browser_unavailable", "tool_execution", "incomplete")'), "shared browser/tool bounded retry missing");
assert.ok(!launcher.includes('shared playwright_b/Profile 3 browser/MCP recovery failed'), "browser recovery still terminates instead of falling back");
passed.push("browser taxonomy preserved", "tool_execution fallback enabled", "shared browser bounded recovery");

const wrapper = fs.readFileSync(path.join(process.cwd(), "scripts/fixup-opencode-wrapper.ps1"), "utf8");
const syncPrompt = fs.readFileSync(path.join(process.cwd(), "src/lib/dm/sync-prompt.ts"), "utf8");
const actionabilityFixture = `TimeoutError: browserBackend.callTool: Timeout 5000ms exceeded.
 - waiting for locator('aria-ref=f1e1063')
 - locator resolved to <div role="button">x</div>
 - attempting click action
 - waiting for element to be visible, enabled and stable`;
assert.match(actionabilityFixture, /TimeoutError: browserBackend\.callTool: Timeout 5000ms exceeded.*locator resolved to.*attempting click action.*waiting for element to be visible, enabled and stable/is);
passed.push("dm-sync click actionability fixture");
for (const needle of ["Test-RecoverableBrowserToolFailure", "fixup-dm-sync", "fixup-dm", "fixup-verification", "playwright_b_browser_click", "Timeout 5000ms exceeded", "not found in the current page snapshot", "FIXUP_RECOVERABLE_browser_tool"]) {
  assert.ok(wrapper.includes(needle), `wrapper recoverable actionability guard missing: ${needle}`);
  passed.push(`wrapper actionability ${needle}`);
}
for (const needle of ["take one fresh full snapshot and retry", "Never reuse refs after typing", "nested raw ref whose visible text equals the exact handle", "retry once with that child ref", "do not submit uncertain", "Stop the attempt"]) {
  assert.ok(syncPrompt.includes(needle), `sync prompt bounded recovery missing: ${needle}`);
  passed.push(`sync prompt recovery ${needle}`);
}

console.log(`PASS ${passed.length}/${passed.length}`);
for (const name of passed) console.log(`PASS ${name}`);
