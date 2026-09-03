export type DmBatchInput = {
  contactId: string;
  handle: string;
  approvedJapaneseText: string;
};

export function buildDmBatchInputPrompt(inputs: DmBatchInput[]) {
  const payload = JSON.stringify(inputs, null, 2);

  return `playwright_b의 현재 Chrome 세션만 사용한다.

목적: 아래 승인된 Instagram DM 원문들을 후보 순서대로 각 대상의 DM 입력창에 정확히 입력하고, 절대 실제 전송하지 않는다.

승인 데이터(JSON 배열):
${payload}

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

허용되는 행동은 각 후보에 대해 아래 범위뿐이다.
- 정확한 대상 Instagram 프로필 및 해당 후보의 DM composer를 연다.
- approvedJapaneseText 전체를 줄바꿈 포함 문자 그대로 입력한다.
- 입력창에 승인 원문이 정확히 들어갔는지 확인한다.

처리 방식:
승인 데이터 배열의 순서를 그대로 따른다. 후보 1명마다 아래를 수행하고 반드시 다음 후보로 진행한다.
1. https://www.instagram.com/{handle}/ 프로필을 연다.
2. 해당 계정과의 DM 대화창을 연다.
3. 실제 메시지 입력창을 찾는다.
4. 해당 후보 approvedJapaneseText 전체를 줄바꿈 포함 그대로 입력한다.
5. 입력창의 내용이 approvedJapaneseText와 정확히 같은지 확인한다.
6. 성공하면 아래 결과 API에 해당 contactId/handle로 success를 POST한다.
7. 프로필/DM composer/입력/확인 중 해당 후보만 실패하면 failed와 실제 실패 이유를 POST한 뒤, 전체 작업을 중단하지 말고 다음 후보로 계속 진행한다.

후보별 결과 POST:
POST http://localhost:3000/api/dm/opencode-result
Content-Type: application/json
성공: {"contactId":"<해당 contactId>","handle":"<해당 handle>","status":"success"}
실패: {"contactId":"<해당 contactId>","handle":"<해당 handle>","status":"failed","error":"실제 실패 이유"}

중요:
- 한 후보의 실패 때문에 나머지 후보를 건너뛰지 않는다.
- 현재 Chrome 세션 자체를 더 이상 사용할 수 없는 전역 오류가 발생한 경우에만, 아직 처리하지 못한 모든 후보를 각각 failed로 기록하고 종료한다.
- 각 결과 API의 ok:true를 확인한다.
- 마지막 후보까지 처리한 뒤 종료한다.
- 성공한 경우에도 Send/전송은 절대 하지 않는다.`;
}

export function buildDmInputPrompt(input: DmBatchInput) {
  return buildDmBatchInputPrompt([input]);
}
