export function buildDmInputPrompt(input: { contactId: string; handle: string; approvedJapaneseText: string }) {
  const payload = JSON.stringify({ handle: input.handle, approvedJapaneseText: input.approvedJapaneseText });

  return `playwright_b의 현재 Chrome 세션만 사용한다.

목적: 승인된 Instagram DM 원문을 해당 후보의 DM 입력창에 정확히 입력하고, 절대 전송하지 않는다.

승인 데이터(JSON):
${payload}

허용되는 행동은 아래 두 범위뿐이다.
- 정확한 대상 Instagram 프로필 및 해당 후보의 DM composer를 연다.
- JSON의 approvedJapaneseText 전체를 줄바꿈 포함 문자 그대로 입력한다.

작업 순서:
1. https://www.instagram.com/${input.handle}/ 프로필을 연다.
2. 해당 계정과의 DM 대화창을 연다.
3. 실제 메시지 입력창을 찾는다.
4. JSON의 approvedJapaneseText 전체를 줄바꿈 포함 그대로 입력한다.
5. 입력창에 승인 원문이 정확히 들어간 것을 확인한다.
6. 성공 즉시 아래 결과 API에 success를 POST하고 종료한다.

절대 금지:
- Send/전송 버튼 클릭
- Enter 키로 메시지 전송
- Follow/팔로우 버튼 클릭 또는 팔로우 상태 변경
- Like/좋아요 클릭 또는 좋아요 상태 변경
- Comment/댓글 작성·게시·수정·삭제
- Profile edit/프로필 수정
- 그 밖의 Instagram 계정, 게시물, 관계, 메시지 상태를 변경하는 모든 행동
- 승인 원문 수정, 요약, 재작성
- 다른 후보 처리
- 다른 게시물/BIO/Reels 추가 조사
- playwright_b_browser_run_code_unsafe 사용
- 실제 발송 시도

성공 POST:
POST http://localhost:3000/api/dm/opencode-result
Content-Type: application/json
{"contactId":"${input.contactId}","handle":"${input.handle}","status":"success"}

DM 대화창을 열 수 없거나 입력창을 찾지 못하거나 원문 입력/확인이 실패하면 실패 이유를 짧게 적어 같은 API에 아래 형식으로 POST하고 종료한다.
{"contactId":"${input.contactId}","handle":"${input.handle}","status":"failed","error":"실제 실패 이유"}

결과 API의 ok:true를 확인한다. 성공한 경우에도 전송 버튼을 포함한 Instagram 상태 변경 행동은 절대 하지 않는다.`;
}
