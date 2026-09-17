import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";
import { formatApprovedJapaneseDm } from "@/lib/dm/text-format";

export type DmBatchInput = {
  contactId: string;
  handle: string;
  approvedJapaneseText: string;
};

export function validateDmBatchInputs(inputs: DmBatchInput[]) {
  if (!inputs.length) throw new Error("OpenCode에 전달할 DM 승인 데이터가 없습니다.");
  if (inputs.length > 30) throw new Error("OpenCode DM batch는 최대 30명까지 가능합니다.");

  const handles = new Set<string>();
  const contactIds = new Set<string>();

  return inputs.map((input) => {
    const handle = input.handle;
    if (handle !== normalizeHandle(handle) || !isValidHandle(handle)) {
      throw new Error(`Instagram handle이 올바르지 않습니다: ${JSON.stringify(handle)}`);
    }
    if (handle.includes("\\")) {
      throw new Error(`Instagram handle에 backslash가 포함되어 있습니다: ${JSON.stringify(handle)}`);
    }
    if (handles.has(handle)) throw new Error(`DM batch에 중복 handle이 있습니다: @${handle}`);
    handles.add(handle);

    const contactId = input.contactId.trim();
    if (!contactId || /[\r\n]/.test(contactId)) throw new Error(`@${handle} contactId가 올바르지 않습니다.`);
    if (contactIds.has(contactId)) throw new Error(`DM batch에 중복 contactId가 있습니다: ${contactId}`);
    contactIds.add(contactId);

    const approvedJapaneseText = formatApprovedJapaneseDm(input.approvedJapaneseText);
    if (!approvedJapaneseText.trim()) throw new Error(`@${handle} 승인 일본어 DM이 비어 있습니다.`);

    return {
      contactId,
      handle,
      approvedJapaneseText,
    };
  });
}

export function serializeDmBatchInputPayload(inputs: DmBatchInput[]) {
  return JSON.stringify(validateDmBatchInputs(inputs), null, 2);
}

export function buildDmBatchInputPrompt(inputs: DmBatchInput[]) {
  const validatedInputs = validateDmBatchInputs(inputs);
  const payload = JSON.stringify(validatedInputs, null, 2);

  return `playwright_b의 현재 Chrome 세션만 사용한다.

EXECUTION OWNERSHIP - mandatory:
- This main OpenCode agent must execute every browser action and every candidate itself.
- Never call task, subagent, delegate, agent-handoff, or any equivalent delegation tool. Never hand candidates or browser work to another agent.
- Never use playwright_b_browser_run_code_unsafe.
- Never read .playwright-mcp snapshot files from disk. Use playwright_b browser snapshot output directly.

목적: 아래 승인된 Instagram DM 원문들을 후보 순서대로 각 대상의 DM 입력창에 정확히 입력하고, 절대 실제 전송하지 않는다.

승인 데이터(JSON 배열):
${payload}

가장 먼저 할 일 — Scout 탭 보호:
1. 현재 Chrome tabs를 먼저 확인한다.
2. URL이 http://localhost:3000 으로 시작하는 FixUp Scout 탭을 식별한다.
3. 그 Scout 탭은 작업이 끝날 때까지 절대 navigate, close, reload, URL 변경하지 않는다.
4. Scout 화면/DM 팝업 상태를 작업용 브라우징에 사용하지 않는다.
5. Instagram 작업은 후보마다 새로 만든 별도 탭에서만 수행한다.

전역 안전 규칙:
- Send/전송 버튼 클릭 금지
- Enter 키로 메시지 전송 금지
- Follow/팔로우 버튼 클릭 또는 팔로우 상태 변경 금지
- Like/좋아요 클릭 또는 좋아요 상태 변경 금지
- Comment/댓글 작성·게시·수정·삭제 금지
- Profile edit/프로필 수정 금지
- 메시지 삭제/전송을 포함해 그 밖의 Instagram 계정, 게시물, 관계, 메시지 상태를 변경하는 모든 행동 금지
- approvedJapaneseText 수정, 요약, 번역, 재작성 금지
- 다른 게시물/BIO/Reels 추가 조사 금지
- playwright_b_browser_run_code_unsafe 사용 금지
- 성공한 후보의 Instagram 탭을 닫거나 다른 후보용으로 재사용 금지

허용되는 행동은 각 후보에 대해 아래 범위뿐이다.
- 동일 handle 탭이 있으면 재사용하고 없을 때만 후보 전용 Instagram 탭을 만든다.
- 정확한 대상 Instagram 프로필 및 해당 후보의 DM composer를 연다.
- 최신 snapshot의 raw ref만 click/type target으로 사용한다.
- approvedJapaneseText 전체를 줄바꿈 포함 문자 그대로 입력한다.
- 입력창에 승인 원문이 정확히 들어갔는지 확인한다.
- click stale/actionability 실패는 fresh snapshot으로 새 raw ref를 resolve한 뒤 같은 후보에서 정확히 1회만 재시도한다.

후보별 탭 규칙:
- 후보는 반드시 한 명씩 순차 처리한다. 다음 후보 탭을 미리 여러 개 열어 두지 않는다.
- 동일 handle의 Instagram 탭이 이미 열려 있으면 그 탭을 재사용한다. 없을 때만 후보 전용 새 탭을 만든다.
- 기존 Instagram 탭을 다른 후보로 navigate해서 재사용하지 않는다.
- 성공 후보는 DM composer와 입력한 승인 문구가 그대로 보이는 상태로 탭을 유지한다.
- 사용자가 작업 후 탭을 직접 넘겨 보며 확인하고 Send할 수 있어야 한다.
- 후보가 영구 실패해도 Scout 탭과 이미 성공한 Instagram 탭은 그대로 둔다.

처리 방식:
승인 데이터 배열의 순서를 그대로 따른다. 후보 1명마다 아래를 끝낸 뒤에만 다음 후보로 진행한다.
1. handle은 승인 JSON의 실제 문자열만 사용한다. Markdown escape를 실제 handle에 넣지 않는다.
2. 동일 handle Instagram 탭이 이미 있으면 선택하고, 없으면 https://www.instagram.com/{handle}/ 전용 탭을 새로 만든다. 다른 후보 탭을 navigate해서 재사용하지 않는다.
3. 후보 프로필에서 fresh full snapshot을 1회 얻는다. browser_click target에는 snapshot의 raw ref token만 사용한다. 예: e205 또는 f12e205. "[ref=e205]", "ref=e205", label 문자열, CSS, XPath를 target으로 만들지 않는다.
4. 이미 DM composer가 열려 있으면 입력 단계로 간다. 아니면 최신 snapshot에서 accessible name이 정확히 "메시지 보내기", "Message", "メッセージ" 중 하나인 button을 고르고 그 raw ref를 즉시 click한다.
5. click이 Ref not found, does not match any elements, detached/stale, visible/enabled/stable actionability timeout 중 하나로 실패하면 같은 후보 안에서만 bounded recovery를 한다: 현재 URL/handle 확인 -> fresh full snapshot -> 동일 의미의 message button을 새 raw ref로 다시 resolve -> 정확히 1회 재시도. 실패한 ref는 재사용하지 않는다. 그래도 실패하면 이 run을 종료하고 해당 후보와 남은 후보는 pending으로 둔다. provider fallback으로 browser 오류를 우회하지 않는다.
6. composer가 열리면 fresh full snapshot에서 실제 editable message input의 raw ref를 찾는다. Send 버튼은 찾더라도 절대 click하지 않는다.
7. 현재 draft가 approvedJapaneseText와 정확히 같으면 다시 입력하지 않고 success 처리한다. draft가 비어 있거나 일부/다른 텍스트라면 browser_type을 사용해 해당 editor raw ref에 approvedJapaneseText 전체를 한 번 fill한다. submit:false로 호출하고 Enter를 누르지 않는다.
8. 입력 직후 fresh full snapshot으로 draft를 다시 확인한다. 줄바꿈 포함 승인 원문과 exact match일 때만 success를 POST한다. 불일치하면 같은 텍스트를 반복 입력하지 말고 현재 run을 종료해 해당 후보와 남은 후보를 pending으로 둔다.
9. success 저장 뒤 해당 Instagram 탭을 composer와 draft가 그대로 보이는 상태로 유지하고 다음 후보로 진행한다.
10. 계정이 실제로 존재하지 않음, 안정적으로 로드된 프로필에 message button 자체가 없음처럼 후보 자체의 명확한 영구 사유만 failed POST한다. Instagram/Playwright의 일시 오류는 failed로 확정하지 않는다.

브라우저 오류 분류:
- browser_tabs/snapshot 자체가 연결 불가, Extension not connected, MCP transport/server failure이면 browser_unavailable로 종료한다.
- stale/ref/actionability/button click 문제는 provider/model 문제가 아니다. 같은 후보의 fresh resolve 1회 안에서만 복구한다.
- Muse -> Nemotron -> Qwen -> GLM처럼 모델을 바꿔 deterministic browser action failure를 반복하지 않는다.
- Scout localhost 탭과 Profile 3 로그인 세션은 보존한다. 실제 Send는 항상 0건이어야 한다.

후보별 결과 POST:
Use fixup_result_dm({payload: JSON_OBJECT}) only; it POSTs to http://localhost:3000/api/dm/opencode-result. Never assemble shell commands.
Content-Type: application/json
성공: {"contactId":"<해당 contactId>","handle":"<해당 handle>","status":"success"}
영구 실패만: {"contactId":"<해당 contactId>","handle":"<해당 handle>","status":"failed","error":"실제 영구 실패 이유"}

중요:
- Scout localhost 탭은 결과 POST를 위해서도 navigate하지 않는다. 결과 API는 HTTP 요청으로만 호출한다.
- 한 후보의 영구 실패 때문에 나머지 후보를 건너뛰지 않는다.
- 일시적인 Instagram/Playwright 제한이 발생하면 아직 처리하지 않은 후보는 pending 상태로 그대로 남기고 이번 run만 종료한다.
- 각 결과 API의 ok:true를 확인한다.
- 마지막 후보까지 처리한 뒤 종료한다.
- 성공한 모든 후보의 Instagram 탭은 입력 내용이 남은 상태로 유지한다.
- 성공한 경우에도 Send/전송은 절대 하지 않는다.`;
}

export function buildDmInputPrompt(input: DmBatchInput) {
  return buildDmBatchInputPrompt([input]);
}
