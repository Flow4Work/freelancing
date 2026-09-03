import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";

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

    if (!input.approvedJapaneseText.trim()) throw new Error(`@${handle} 승인 일본어 DM이 비어 있습니다.`);

    return {
      contactId,
      handle,
      approvedJapaneseText: input.approvedJapaneseText,
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
- 후보 전용 새 Instagram 탭을 만든다.
- 정확한 대상 Instagram 프로필 및 해당 후보의 DM composer를 연다.
- approvedJapaneseText 전체를 줄바꿈 포함 문자 그대로 입력한다.
- 입력창에 승인 원문이 정확히 들어갔는지 확인한다.
- 일반 click이 실제 존재하는 메시지 버튼의 visible/stable 대기 timeout으로만 실패한 경우, 안전한 browser_evaluate로 그 동일 버튼을 한 번 click한다.

후보별 탭 규칙:
- 승인 데이터 1명당 Instagram 탭 1개를 새로 만든다.
- 기존 Instagram 탭을 다음 후보로 navigate해서 재사용하지 않는다.
- 성공 후보는 DM composer와 입력한 승인 문구가 그대로 보이는 상태로 탭을 유지한다.
- 사용자가 작업 후 탭을 직접 넘겨 보며 확인하고 Send할 수 있어야 한다.
- 후보가 실패해도 Scout 탭과 이미 성공한 Instagram 탭은 그대로 둔다.

처리 방식:
승인 데이터 배열의 순서를 그대로 따른다. 후보 1명마다 아래를 수행하고 반드시 다음 후보로 진행한다.
1. handle은 승인 JSON의 실제 문자열만 사용한다. Markdown 표시용 escape를 실제 handle에 넣지 않는다. 예: "__.izu"는 정상이고 "\\_\\_.izu"는 잘못된 값이다.
2. 후보 전용 새 탭을 만들고 https://www.instagram.com/{handle}/ 프로필을 연다.
3. snapshot에서 정확한 "메시지 보내기"/Message 버튼을 찾는다.
4. 버튼이 있으면 일반 click을 정확히 1회 시도한다.
5. 일반 click이 visible/stable 대기 timeout으로만 실패했고 snapshot/DOM에서 그 버튼이 실제 존재하는 것이 확인된 경우에만, playwright_b의 안전한 browser_evaluate를 사용해 그 동일 버튼 click을 정확히 1회 시도한다.
6. 위 두 시도 후에도 composer가 열리지 않으면 inbox → profile → inbox 같은 우회 반복을 하지 않는다. 해당 후보만 failed 처리하고 다음 후보로 간다.
7. 버튼 자체가 없거나 계정/페이지 문제면 억지로 재탐색·반복하지 않고 해당 후보만 failed 처리한다.
8. 실제 메시지 입력창을 찾는다.
9. 해당 후보 approvedJapaneseText 전체를 줄바꿈 포함 그대로 입력한다. 입력 후 Enter를 누르지 않는다.
10. 입력창의 내용이 approvedJapaneseText와 정확히 같은지 확인한다.
11. 성공하면 해당 후보 탭을 그대로 유지한 채 아래 결과 API에 해당 contactId/handle로 success를 POST한다.
12. 프로필/DM composer/입력/확인 중 해당 후보만 실패하면 failed와 실제 실패 이유를 POST한 뒤, 전체 작업을 중단하지 말고 다음 후보로 계속 진행한다.

후보별 결과 POST:
POST http://localhost:3000/api/dm/opencode-result
Content-Type: application/json
성공: {"contactId":"<해당 contactId>","handle":"<해당 handle>","status":"success"}
실패: {"contactId":"<해당 contactId>","handle":"<해당 handle>","status":"failed","error":"실제 실패 이유"}

중요:
- Scout localhost 탭은 결과 POST를 위해서도 navigate하지 않는다. 결과 API는 HTTP 요청으로만 호출한다.
- 한 후보의 실패 때문에 나머지 후보를 건너뛰지 않는다.
- 현재 Chrome 세션 자체를 더 이상 사용할 수 없는 전역 오류가 발생한 경우에만, 아직 처리하지 못한 모든 후보를 각각 failed로 기록하고 종료한다.
- 각 결과 API의 ok:true를 확인한다.
- 마지막 후보까지 처리한 뒤 종료한다.
- 성공한 모든 후보의 Instagram 탭은 입력 내용이 남은 상태로 유지한다.
- 성공한 경우에도 Send/전송은 절대 하지 않는다.`;
}

export function buildDmInputPrompt(input: DmBatchInput) {
  return buildDmBatchInputPrompt([input]);
}
