import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";

export type DmSentSyncInput = {
  contactId: string;
  handle: string;
  approvedJapaneseText: string;
  approvedAt: string;
};

export function validateDmSentSyncInputs(inputs: DmSentSyncInput[]) {
  if (!inputs.length) throw new Error("DM sent sync input is empty");
  if (inputs.length > 30) throw new Error("DM sent sync supports at most 30 contacts");
  const handles = new Set<string>();
  const ids = new Set<string>();
  return inputs.map((input) => {
    const handle = normalizeHandle(input.handle);
    if (input.handle !== handle || !isValidHandle(handle) || handle.includes("\\")) throw new Error(`Invalid Instagram handle: ${input.handle}`);
    if (handles.has(handle)) throw new Error(`Duplicate sync handle: @${handle}`);
    if (!input.contactId.trim() || ids.has(input.contactId)) throw new Error(`Invalid/duplicate sync contactId: @${handle}`);
    if (!input.approvedJapaneseText.trim()) throw new Error(`Empty approved Japanese DM: @${handle}`);
    if (!Number.isFinite(Date.parse(input.approvedAt))) throw new Error(`Invalid approvedAt: @${handle}`);
    handles.add(handle);
    ids.add(input.contactId);
    return { contactId: input.contactId.trim(), handle, approvedJapaneseText: input.approvedJapaneseText, approvedAt: input.approvedAt };
  });
}


export function buildDmSentSyncPrompt(inputs: DmSentSyncInput[]) {
  const contacts = validateDmSentSyncInputs(inputs).map(({ contactId, handle }) => ({
    contactId,
    handle,
  }));

  return `Use playwright_b with Chrome Profile 3. Check whether each DM was actually sent. Never send a message.

Browser connection / tab lifecycle — mandatory before processing contacts:
- The first browser call must be playwright_b_browser_tabs with action:"list". Treat a successful list as the browser/context health preflight.
- Preserve every chrome-extension://.../connect.html relay tab. Never navigate or close a relay tab and never use it as the Instagram work tab.
- If an Instagram Direct inbox tab already exists, select and reuse that tab.
- Otherwise select an existing non-relay normal work tab and navigate it to https://www.instagram.com/direct/inbox/.
- If no non-relay work tab exists (including relay-only startup), create exactly one work tab with playwright_b_browser_tabs action:"new", url:"https://www.instagram.com/direct/inbox/". Do not browser_navigate the relay tab.
- After selecting/creating the work tab, take one fresh full snapshot before any search action.
- Direct inbox readiness is bounded. If that snapshot does not contain the inbox search UI and the conversation list is still loading, wait 5 seconds, take one fresh full snapshot, then reload https://www.instagram.com/direct/inbox/ exactly once, wait 10 seconds, and take one final fresh full snapshot.
- If the search UI is still absent after that single bounded readiness recovery, output the exact marker FIXUP_DM_SYNC_INBOX_UNAVAILABLE and stop the attempt with every unprocessed contact untouched. Do not keep waiting or reloading.
- If tabs list itself reports browser/context unavailable, stop without submitting or changing any contact; do not retry blindly.

Contacts:
${JSON.stringify(contacts, null, 2)}

For each contact, do only this:
1. Open Instagram Direct inbox.
2. Take a fresh full snapshot.
3. Type the exact handle into the inbox search box using its raw ref from that snapshot.
4. Take a fresh full snapshot.
5. In the unique exact matching account result, prefer the raw ref of the nested text node whose visible text is exactly the handle. Click that raw ref. Only if that exact-handle child ref is not exposed, click the result container raw ref.
6. Take a fresh full snapshot and confirm the exact handle.
7. Inspect only whether this Instagram conversation contains any message history at all.
8. If there is no message history, submit not_sent with fixup_result_sync.
9. If there is at least one message in the conversation, regardless of whether it was sent by us or received from them, submit sent with fixup_result_sync.
10. Continue to the next handle.

Rules:
- There are only two business outcomes: no conversation history = not_sent, any conversation history = sent.
- Do not compare message text with the approved DM. Do not inspect direction, current attempt, approval time, or exact-message matching.
- Search only inside Instagram Direct inbox. Do not visit profiles.
- A search result by itself is not proof of conversation history. Open the exact result and inspect the conversation pane.
- Allowed browser actions are browser_tabs (list/select/new), navigate, full snapshot, type into inbox search, and click the exact search result. Do not use browser_evaluate, browser_run_code, DOM/HTML inspection, or custom JavaScript.
- Use one inbox tab.
- Never type in the message composer. Never click Send. Never press Enter.
- For browser_type/click, target must be the raw ref token from the latest snapshot, such as f1e244. Never use a label like textbox/search box as target.
- Never reuse refs after typing, navigation, or opening a conversation.
- Every browser_snapshot must be a new full snapshot with no target/ref argument.
- If browser_type or browser_click fails because its raw snapshot ref is stale/not found, take one fresh full snapshot and retry that intended action exactly once with a new raw ref.
- Prefer clicking the nested raw ref whose visible text equals the exact handle because Instagram's outer result container can remain actionability-unstable while the handle node is stable.
- If that exact-handle click hits the 5-second actionability timeout, take one fresh full snapshot. If the refreshed exact result exposes a new exact-handle child ref, retry once with that child ref; otherwise retry once with the exact result container ref.
- If the retry still fails, or the exact result is absent/ambiguous, do not guess sent/not_sent and do not submit uncertain. Stop the attempt with that contact and every remaining contact untouched so the supervisor can retry/fallback.
- Any other real playwright_b/MCP failure also stops the attempt and leaves unprocessed contacts untouched.
- The payload contract for fixup_result_sync is exact:

Conversation history exists:
{
  "contactId": "<exact contactId>",
  "handle": "<exact handle>",
  "status": "sent"
}

No conversation history:
{
  "contactId": "<exact contactId>",
  "handle": "<exact handle>",
  "status": "not_sent"
}

- Submit every confirmed contact with fixup_result_sync({payload: ...}) and require ok:true.
- Never submit uncertain for a normal business outcome. uncertain remains only a backward-compatible API value and is not part of this workflow.

Finish after the last contact.`;
}
