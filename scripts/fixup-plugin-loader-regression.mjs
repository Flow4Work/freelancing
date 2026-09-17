import assert from "node:assert/strict";
import * as pluginModule from "../.opencode/plugin/fixup-playwright-ref-guard.mjs";

const passed = [];
const ok = (name, value) => {
  assert.ok(value, name);
  passed.push(name);
};

assert.deepEqual(Object.keys(pluginModule).sort(), ["default"]);
passed.push("plugin entry exports default only");
assert.equal(typeof pluginModule.default, "function");
passed.push("plugin entry is function");

const hooks = await pluginModule.default();
ok("plugin initializes hooks object", hooks && typeof hooks === "object");
assert.equal(typeof hooks["tool.execute.before"], "function");
passed.push("tool.execute.before exists");
assert.equal(typeof hooks["tool.execute.after"], "function");
passed.push("tool.execute.after exists");
assert.equal(pluginModule.collectSnapshotRefs, undefined);
assert.equal(pluginModule.normalizeClickTarget, undefined);
passed.push("helpers are not plugin exports");

process.env.FIXUP_SCOUT_AGENT = "fixup-duplicate";
const relaySession = "plugin-loader-relay";
await hooks["tool.execute.after"](
  { tool: "playwright_b_browser_tabs", sessionID: relaySession },
  { output: "- 0: (current) [Welcome](chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html?token=x)" },
);await assert.rejects(
  () => hooks["tool.execute.before"](
    { tool: "playwright_b_browser_navigate", sessionID: relaySession },
    { args: { url: "https://script.google.com/macros/s/test/exec" } },
  ),
  /FIXUP_RELAY_GUARD/,
);
passed.push("relay guard fixture");

const refSession = "plugin-loader-ref";
await hooks["tool.execute.after"](
  { tool: "playwright_b_browser_snapshot", sessionID: refSession },
  { output: '- button "Check" [ref=f4e266]' },
);
const clickState = { args: { target: "ref=f266" } };
await hooks["tool.execute.before"](
  { tool: "playwright_b_browser_click", sessionID: refSession },
  clickState,
);
assert.equal(clickState.args.target, "f4e266");
passed.push("ref guard fixture");

delete process.env.FIXUP_SCOUT_AGENT;
console.log(`PASS ${passed.length}/${passed.length}`);
for (const name of passed) console.log(`PASS ${name}`);
