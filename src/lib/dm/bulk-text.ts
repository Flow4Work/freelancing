export type BulkDmParseResult =
  | { ok: true; messages: Map<string, string> }
  | { ok: false; error: string };

export type BulkDmDraftLike = { handle: string; japaneseText: string };

export function formatBulkDmText(drafts: readonly BulkDmDraftLike[]) {
  return drafts.map((draft) => `@${draft.handle}\n${draft.japaneseText}`).join("\n\n");
}

export function repairLegacyBulkDmHandles(value: string, expectedHandles: readonly string[]) {
  const replacements = new Map<string, string>();
  for (const handle of expectedHandles) {
    const canonical = `@${handle}`;
    const legacyMarkdown = `@${handle
      .replace(/^(_+)/, (underscores) => "*".repeat(underscores.length))
      .replace(/(_+)$/, (underscores) => "*".repeat(underscores.length))}`;
    if (legacyMarkdown !== canonical) replacements.set(legacyMarkdown, canonical);
  }

  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => replacements.get(line.trim()) ?? line)
    .join("\n");
}
export function parseBulkDmText(value: string, expectedHandles: readonly string[]): BulkDmParseResult {
  const normalized = repairLegacyBulkDmHandles(value, expectedHandles);
  const expected = new Set(expectedHandles);
  const messages = new Map<string, string>();
  const lines = normalized.split("\n");
  let currentHandle: string | null = null;
  let currentBody: string[] = [];
  let prefixHasContent = false;

  const commitCurrent = (): BulkDmParseResult | null => {
    if (!currentHandle) return null;
    const bodyLines = [...currentBody];
    while (bodyLines.length && bodyLines[0] === "") bodyLines.shift();
    while (bodyLines.length && bodyLines[bodyLines.length - 1] === "") bodyLines.pop();
    const body = bodyLines.join("\n");
    if (!body.trim()) return { ok: false, error: `DM 본문이 비어 있습니다: @${currentHandle}` };
    if (messages.has(currentHandle)) return { ok: false, error: `중복 handle이 있습니다: @${currentHandle}` };
    messages.set(currentHandle, body);
    return null;
  };

  for (const line of lines) {
    const handleMatch = line.match(/^\s*@([A-Za-z0-9._]{1,80})\s*$/);
    if (handleMatch) {
      const previousError = commitCurrent();
      if (previousError) return previousError;
      const handle = handleMatch[1];
      if (!expected.has(handle)) return { ok: false, error: `선택된 후보에 없는 handle입니다: @${handle}` };
      if (messages.has(handle)) return { ok: false, error: `중복 handle이 있습니다: @${handle}` };
      currentHandle = handle;
      currentBody = [];
      continue;
    }
    if (!currentHandle) {
      if (line.trim()) prefixHasContent = true;
      continue;
    }
    currentBody.push(line);
  }
  const finalError = commitCurrent();
  if (finalError) return finalError;
  if (prefixHasContent) {
    return { ok: false, error: "첫 @handle 앞에 분리할 수 없는 내용이 있습니다. 전체 텍스트는 @handle 줄부터 시작해야 합니다." };
  }
  if (!messages.size) {
    return { ok: false, error: `@handle 구분자를 찾지 못했습니다. 필요한 후보: ${expectedHandles.map((handle) => `@${handle}`).join(", ")}` };
  }
  const missing = expectedHandles.filter((handle) => !messages.has(handle));
  if (missing.length) return { ok: false, error: `선택된 후보가 빠졌습니다: ${missing.map((handle) => `@${handle}`).join(", ")}` };
  return { ok: true, messages };
}

export function isJapaneseDmText(value: string) {
  const text = value.trim();
  if (!text || text.length > 3000) return false;
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text);
}
