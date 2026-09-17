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

function formatApprovedAtKst(value: string) {
  const date = new Date(Date.parse(value) + 9 * 60 * 60 * 1000);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} (${weekdays[date.getUTCDay()]}) ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} KST`;
}

export function buildDmSentSyncPrompt(inputs: DmSentSyncInput[]) {
  const contacts = validateDmSentSyncInputs(inputs).map(({ contactId, handle, approvedJapaneseText, approvedAt }) => ({
    contactId,
    handle,
    approvedJapaneseText,
    approvedAtKst: formatApprovedAtKst(approvedAt),
  }));

  return `Use playwright_b with Chrome Profile 3. Check whether each DM was actually sent. Never send a message.

Browser connection / tab lifecycle — mandatory before processing contacts:
- The first browser call must be playwright_b_browser_tabs with action:"list". Treat a successful list as the browser/context health preflight.
- Preserve every chrome-extension://.../connect.html relay tab. Never navigate or close a relay tab and never use it as the Instagram work tab.
- If an Instagram Direct inbox tab already exists, select and reuse that tab.
- Otherwise select an existing non-relay normal work tab and navigate it to https://www.instagram.com/direct/inbox/.
- If no non-relay work tab exists (including relay-only startup), create exactly one work tab with playwright_b_browser_tabs action:"new", url:"https://www.instagram.com/direct/inbox/". Do not browser_navigate the relay tab.
- After selecting/creating the work tab, take one fresh full snapshot before any search action.
- If tabs list itself reports browser/context unavailable, stop without submitting or changing any contact; do not retry blindly.

Contacts:
${JSON.stringify(contacts, null, 2)}

For each contact, do only this:
1. Open Instagram Direct inbox.
2. Take a fresh full snapshot.
3. Type the exact handle into the inbox search box using its raw ref from that snapshot.
4. Take a fresh full snapshot.
5. Click the exact matching search result using its raw ref from that new snapshot.
6. Take a fresh full snapshot, confirm the handle, and inspect the visible conversation for this contact's exact approvedJapaneseText. Do not assume the newest outgoing bubble is the approved DM.
7. Submit sent, not_sent, or uncertain with fixup_result_sync.
8. Continue to the next handle.

Rules:
- Search only inside Instagram Direct inbox. Do not visit profiles.
- Allowed browser actions are browser_tabs (list/select/new), navigate, full snapshot, type into inbox search, and click the exact search result. Do not use browser_evaluate, browser_run_code, DOM/HTML inspection, or custom JavaScript.
- Use one inbox tab.
- Never type in the message composer. Never click Send. Never press Enter.
- For browser_type/click, target must be the raw ref token from the latest snapshot, such as f1e244. Never use a label like textbox/search box as target.
- Never reuse refs after typing, navigation, or opening a conversation.
- Every browser_snapshot must be a new full snapshot with no target/ref argument.
- If an exact search-result click fails only because a resolved locator does not become visible/enabled/stable within the 5-second actionability timeout, immediately take one fresh full snapshot. Never reuse the failed ref.
- From that fresh snapshot, retry the click once only when exactly one search result matches the exact handle, using that result's new raw ref. This is state revalidation, not a blind retry.
- If the exact result is absent/ambiguous in the fresh snapshot, or the one revalidated click also has the same actionability timeout, submit uncertain for that contact with a concise browser-confirmation reason and continue to the next contact.
- Any other real playwright_b/MCP failure still stops the run and leaves unprocessed contacts untouched.
- approvedJapaneseText is the exact DB-approved Japanese DM for this contact. Compare against that exact text; never summarize, rewrite, shorten, or replace it with a follow-up.
- A contact may have replies and later outgoing follow-ups after the approved DM. The newest outgoing message is not automatically the approved DM.
- Submit status "sent" only when all of these are directly supported by the current conversation: exact handle, outgoing direction, text matching approvedJapaneseText under the server's exact-text normalization semantics, and evidence that this bubble belongs to the current approved attempt.
- If a later follow-up is newest but an older visible outgoing bubble exactly matches approvedJapaneseText and is tied to the current approved attempt, submit sent using the approved DM bubble text, never the follow-up text.
- If follow-up conversation exists but the approvedJapaneseText outgoing bubble cannot be directly proven from the current UI, submit uncertain and continue. Never use the follow-up itself as sent evidence.
- Submit not_sent only when the UI gives clear evidence this approved attempt was not sent, such as only older pre-approval conversation and no current-attempt outgoing evidence. If ambiguous, use uncertain.
- An incoming bubble that matches approvedJapaneseText is never sent evidence.
- approvedAtKst is a timing aid for distinguishing the current approved attempt from older conversation; it does not override the exact-text requirement.
- The payload contract for fixup_result_sync is exact. Use one of these JSON shapes:

Sent:
{
  "contactId": "<exact contactId>",
  "handle": "<exact handle>",
  "status": "sent",
  "evidence": {
    "text": "<full outgoing bubble text>",
    "direction": "outgoing",
    "currentAttempt": "yes"
  }
}

Not sent:
{
  "contactId": "<exact contactId>",
  "handle": "<exact handle>",
  "status": "not_sent"
}

Uncertain:
{
  "contactId": "<exact contactId>",
  "handle": "<exact handle>",
  "status": "uncertain",
  "error": "<why it cannot be confirmed>"
}

- For sent, evidence.text alone is invalid. evidence.direction must be the exact literal "outgoing" and evidence.currentAttempt must be the exact literal "yes".
- Never submit sent with incoming/unknown direction or no/unknown currentAttempt. If the evidence is insufficient, submit uncertain instead.
- Submit every contact with fixup_result_sync({payload: ...}) and require ok:true.
- Do not treat the specifically bounded search-result click actionability case above as a general MCP failure; all other real playwright_b/MCP failures must stop and leave unprocessed contacts untouched.

Finish after the last contact.`;
}
