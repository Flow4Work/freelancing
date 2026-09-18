import assert from "node:assert/strict";
import { formatApprovedJapaneseDm } from "../src/lib/dm/text-format.ts";
import { parseBulkDmText } from "../src/lib/dm/bulk-text.ts";

const passed = [];
const same = (name, actual, expected) => {
  assert.equal(actual, expected, name);
  passed.push(name);
};
const chars = (value) => value.replace(/\s/gu, "");

const cases = [
  ["single newlines", "A\nB\nC", "A\n\nB\n\nC"],
  ["mixed existing blanks", "A\n\nB\nC", "A\n\nB\n\nC"],
  ["CRLF", "A\r\nB\r\nC", "A\n\nB\n\nC"],
  ["many blank lines", "A\n\n\n\nB", "A\n\nB"],
  ["edge blanks", "\n\nA\nB\n\n", "A\n\nB"],
  ["trailing whitespace only", "A  \nB\t \nC", "A\n\nB\n\nC"],
];

for (const [name, input, expected] of cases) {
  const formatted = formatApprovedJapaneseDm(input);
  same(name, formatted, expected);
  same(`${name} idempotent`, formatApprovedJapaneseDm(formatted), formatted);
  same(`${name} non-whitespace content`, chars(formatted), chars(input));
}

const parsed = parseBulkDmText("@alpha\nA\n\nB\n\n@beta\nC\n\nD", ["alpha", "beta"]);
assert.equal(parsed.ok, true, "bulk parser should accept paragraph blanks");
if (parsed.ok) {
  same("bulk alpha blank preservation", parsed.messages.get("alpha"), "A\n\nB");
  same("bulk beta blank preservation", parsed.messages.get("beta"), "C\n\nD");
}

console.log(`fixup dm text-format regression: ${passed.length}/${passed.length} passed`);
