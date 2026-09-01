# FixUp Scout

일본 인플루언서 후보를 대량 발굴하고, 이미 확인한 계정을 다시 찾지 않도록 저장하는 FixUp 전용 도구입니다.

## Phase 1에 들어간 것

- 미용 / 맛집 검색 파이프라인 분리
- Exa + Tavily 검색 provider와 자동 fallback
- Instagram ID / 프로필 URL 정규화
- 실제 검색 결과 URL과 근거 문구 보존
- 맛집의 레시피·집밥 계열 제외 검토 신호 표시
- Supabase `normalized_handle` unique 기반 중복 차단
- 한 번에 10~300명 목표 수량 설정
- Vercel 배포 가능한 Next.js 16 App Router 구조
- 작은 Toss 스타일 UI

**중요:** Phase 1은 팔로워·Reels 숫자를 검색 스니펫에서 추정하지 않습니다. 해당 필드는 DB와 타입에 미리 마련했고, 다음 단계에서 로그인된 Instagram 원본/Agent Reach fallback을 통해 채웁니다.

## 구조

```text
UI
 └─ POST /api/discovery
      ├─ beauty / food query plan
      ├─ Exa / Tavily round-robin + fallback
      ├─ Instagram handle normalization
      ├─ Supabase duplicate check
      └─ 검증 가능한 profile URL + evidence URL 반환

Next phase
 └─ Instagram verifier
      ├─ profile / followers
      ├─ recent Reels 8~12개
      ├─ 평균 + 중앙값 + 표본수
      └─ 실패 시 Playwright 검증 큐
```

## 환경변수

`.env.example`을 `.env.local`로 복사하고 필요한 값을 입력합니다.

- `EXA_API_KEY` — 선택. Tavily만 있어도 실행 가능
- `TAVILY_API_KEY` — 선택. Exa만 있어도 실행 가능
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase 사용 시
- `SUPABASE_SERVICE_ROLE_KEY` — 서버 전용. 브라우저에 노출 금지
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — 향후 브라우저 인증용 자리

검색 API는 **Exa/Tavily 중 최소 하나**가 필요합니다.

## Supabase

Supabase SQL Editor에서 아래 파일을 한 번 실행합니다.

```text
supabase/migrations/202609010001_candidates.sql
```

RLS는 켜져 있고 공개 policy는 만들지 않았습니다. Phase 1 저장/중복검사는 서버의 service role만 사용합니다.

## 로컬 실행 (PowerShell)

```powershell
git clone https://github.com/Flow4Work/freelancing.git
cd freelancing
git switch feat/fixup-scout-foundation
.\scripts\dev.ps1
```

처음 실행하면 `.env.local`이 자동 생성됩니다. 키를 넣은 뒤 다시 실행하면 됩니다.

이미 `npm install`을 끝냈다면:

```powershell
.\scripts\dev.ps1 -SkipInstall
```

## 다음 단계

1. 실제 Instagram 후보 표본으로 Exa/Tavily 검색 recall 측정
2. 로그인된 Instagram에서 팔로워 + 최근 Reels 8~12개 수집 adapter 추가
3. 평균만으로 탈락시키지 않고 raw Reels 배열을 함께 저장
4. `통과 / 검증필요 / 명백한 미달` 규칙을 실제 FixUp 피드백으로 calibration
5. 하루 100명 컨택을 위해 120~150명 검증 가능 후보를 안정적으로 확보하는지 반복 테스트

DM 생성은 이 도구에 넣지 않습니다. 최종 후보 근거를 ChatGPT에 넘겨 개인화 DM을 만드는 흐름으로 분리합니다.
