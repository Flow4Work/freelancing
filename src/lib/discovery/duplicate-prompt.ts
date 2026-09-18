import { FIXUP_DUPLICATE_CHECK_URL } from "@/lib/automation/config";
import type { DiscoveryCandidate, SearchCategory } from "./types";

export function buildDuplicateCheckPrompt(candidates: DiscoveryCandidate[], category: SearchCategory, jobId: string) {
  const candidateRows = candidates.map((candidate, index) => JSON.stringify({
    index: index + 1,
    handle: candidate.handle,
  })).join("\n");
  const canonicalHandles = candidates.map((candidate) => JSON.stringify(candidate.handle)).join(", ");
  const browserCandidates = JSON.stringify(candidates.map((candidate, index) => ({ index: index + 1, handle: candidate.handle })));
  const checkpointKey = `fixup-scout:duplicate-checkpoint:${jobId}`;
  const loginId = process.env.FIXUP_DUPLICATE_LOGIN_ID?.trim();
  const loginPassword = process.env.FIXUP_DUPLICATE_LOGIN_PASSWORD?.trim();

  if (!loginId || !loginPassword) {
    throw new Error("FixUp 중복 페이지 로그인 ID/PW가 .env.local에 설정되지 않았습니다.");
  }

  return `playwright_b의 현재 Chrome 세션만 사용한다.

BROWSER CONNECTION / TAB LIFECYCLE - mandatory:
- 첫 browser call은 반드시 playwright_b_browser_tabs action:"list"다. 이 호출이 정상 반환되는지로 playwright_b MCP connection health를 확인한 뒤에만 form 작업을 시작한다.
- URL이 chrome-extension://.../connect.html 인 탭은 playwright_b extension relay 연결 유지 전용 탭이다. 해당 탭을 절대 navigate/close하지 말고, form 입력/로그인/중복확인 작업에도 사용하지 않는다.
- tabs list에 ${FIXUP_DUPLICATE_CHECK_URL} 작업 탭이 이미 있으면 playwright_b_browser_tabs action:"select", index:<그 탭 index>로 선택해 재사용한다. 기존 Apps Script work tab이 있는데 새 탭을 추가하지 않는다.
- Apps Script work tab이 없으면 playwright_b_browser_tabs action:"new", url:${FIXUP_DUPLICATE_CHECK_URL} 로 별도 work tab을 정확히 하나 생성한다. 특히 relay/connect 탭만 있는 fresh start에서는 browser_navigate를 호출하지 않는다.
- work tab을 확보한 뒤 fresh snapshot을 받아 login/form 상태와 최신 ref를 확인한다. relay 탭은 전체 작업 종료까지 그대로 남겨둔다.
- 작업 도중 Not connected / Extension not connected / MCP connection closed가 발생하면 같은 fill_form/click/evaluate를 반복하지 않고 stale ref를 즉시 폐기한다. 연결이 이미 복구되어 browser_tabs list가 다시 정상 반환되는 경우에만 fresh tabs → work tab select/new → fresh snapshot 순서로 상태를 재확보한다. 불확실한 inFlight는 기존 checkpoint contract대로 unknown 처리하며 중복 클릭하지 않는다. 연결이 복구되지 않으면 즉시 attempt를 종료한다.

EXECUTION OWNERSHIP - mandatory:
- This main OpenCode agent must execute the browser work itself.
- Never call task, subagent, delegate, agent-handoff, or any equivalent delegation tool.
- Never use playwright_b_browser_run_code_unsafe.
- Never read .playwright-mcp snapshot files from disk. Use browser tool output directly.

목적: 아래 후보 전원을 FixUp 중복 페이지에서만 판정하고, 결과 전부를 정확히 1회 batch POST한 뒤 종료한다.
중복 페이지: ${FIXUP_DUPLICATE_CHECK_URL}
checkpoint key: ${checkpointKey}
Instagram은 이 작업에서 절대 열지 않는다. followers, BIO, Reels, 게시물, DM은 최종 검증 단계의 책임이다.

로그인:
- 사용자 이름: ${loginId}
- 비밀번호: ${loginPassword}
- 위 값은 로그인 입력에만 사용한다. 출력/저장/결과 JSON 포함 금지.
- Browser calls are sequential. After filling the login fields, take a fresh snapshot: if the Instagram ID form is already present, skip login activation.
- For login activation inside nested iframes, use one browser_evaluate anchored to the current loginName textbox ref. In that input.ownerDocument locate the existing button whose onclick is login(), call its DOM click once, and return only whether submitted. Do not use browser_click for this nested-frame login button. Then take a fresh snapshot for the Instagram ID textbox.
- Do not click a stale login ref after the form has changed.

후보(JSON Lines), 위에서 아래 순서 그대로:
${candidateRows}

CANONICAL HANDLES - mandatory:
- POST용 handle의 유일한 원본은 아래 배열이다.
$canonicalHandles = @(${canonicalHandles})
- 결과는 handle 문자열이 아니라 candidate index 기준으로 보관한다.
- POST payload의 handle은 반드시 $canonicalHandles[index - 1]에서 가져온다. 직접 다시 타이핑하거나 정규화/추정/철자수정하지 않는다.
- Before POST, verify every result handle against $canonicalHandles with a case-sensitive exact match.
- 하나라도 불일치하면 POST하지 말고 HANDLE_MISMATCH_BEFORE_POST로 즉시 종료한다.

CHECKPOINT / RESUME - mandatory:
- job 상태 GET의 processedHandles가 비어 있어도 처음부터 재검사하지 않는다.
- Apps Script origin localStorage의 ${checkpointKey}를 durable checkpoint로 사용한다.
- checkpoint에 완료된 index/handle은 절대 다시 입력하거나 중복 확인 버튼을 다시 클릭하지 않는다.
- 각 canonical ID의 click 직전에는 inFlight(index/handle/clickIntentAt)를 먼저 checkpoint에 저장한다. click 후 결과가 확정되면 result를 저장하면서 inFlight를 지운다.
- fallback에서 valid inFlight가 발견되면 이전 click이 실제 실행됐는지 불명확한 상태이므로 절대 재클릭하지 않는다. 해당 ID를 unknown으로 회수해 result checkpoint로 확정하고 다음 미처리 ID로 진행한다.
- fallback attempt는 현재 페이지가 이미 중복 확인 form이면 그대로 재사용하고, 첫 미처리 index부터 이어서 처리한다.
- 현재 페이지가 실제 form이 아니거나 session이 유실된 경우에만 중복 페이지 navigate/login을 한다.

STRICT ORDER - mandatory:
- index 1부터 마지막 index까지 오름차순으로 처리한다.
- checkpoint에 이미 있는 index만 skip한다. 그 외 index는 정확히 1회 조회한다.
- 현재 index의 결과가 available / duplicate / protected / unknown 중 하나로 checkpoint에 저장되기 전에는 다음 index로 가지 않는다.
- checkpoint가 없으면 정상 fresh-start다. 다른 job, 파싱 불가, 잘못된 schema, 현재 canonical index/handle/status와 명백히 불일치하는 checkpoint도 crash시키지 말고 안전한 fresh-start로 처리한다. 손상된 checkpoint의 결과는 사용하지 않으며 첫 새 결과가 확정되는 즉시 정상 checkpoint로 덮어쓴다.

FAST DOM LOOP - mandatory:
- Never repeat browser_fill_form / browser_click / browser_find / browser_snapshot / browser_wait_for per candidate.
- The FixUp Apps Script form is inside nested cross-origin iframes. Never locate the form from the top document with document.querySelector(...).
- After login, obtain the current ref for the real "Instagram ID" textbox from the latest snapshot.
- Call playwright_b_browser_evaluate in bounded chunks of at most 6 remaining candidates per tool call, with that Instagram ID textbox ref passed as the target/element anchor and the async (input) => { ... } function below.
- Never run the candidate loop with an unanchored browser_evaluate. Reuse the same current textbox anchor and function only while that ref remains current; every chunk resumes only from the durable checkpoint.
- input.ownerDocument inside the anchored evaluate is the actual form document. Process at most 6 unfinished candidates sequentially inside one tool call, then return before the MCP request timeout and invoke the same anchored evaluate again only if hasMore=true.
- For each remaining candidate, set the canonical handle exactly, dispatch input/change, DOM-click the duplicate-check button exactly once, classify the post-click result mutation, persist checkpoint immediately, then continue.
- Observe only DOM mutations caused after the click. Accept a result only when the mutated result text contains the exact current @handle; ignore late responses for earlier handles so they can never be assigned to the next candidate. Never treat the static page guidance about already-registered accounts as a result.
- The 6.5 second timeout is only a safety deadline, not a fixed sleep. Resolve immediately when the correctly correlated current-handle result mutation appears.

browser_evaluate call shape - mandatory:
- target: the latest Instagram ID textbox ref from the form snapshot
- element: "Instagram ID textbox"
- function: use the function below for each bounded anchored evaluate chunk until hasMore=false.

async (input) => {
  const jobId = ${JSON.stringify(jobId)};
  const checkpointKey = ${JSON.stringify(checkpointKey)};
  const candidates = ${browserCandidates};
  const maxPerCall = 6;
  const allowedStatuses = new Set(["available", "duplicate", "protected", "unknown"]);
  const statusTokens = [
    { duplicateStatus: "available", texts: ["등록 가능", "登録可能"] },
    { duplicateStatus: "duplicate", texts: ["이미 등록", "登録済み"] },
    { duplicateStatus: "protected", texts: ["보호 목록", "保護リスト"] },
  ];
  const doc = input && input.ownerDocument;
  const win = doc && doc.defaultView;
  if (!doc || !win || !(input instanceof win.HTMLInputElement)) throw new Error("FORM_CONTROL_NOT_FOUND");

  const normalizeText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const isVisible = (element) => {
    if (!(element instanceof win.HTMLElement)) return false;
    const style = win.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const controlText = (element) => normalizeText([
    element.getAttribute("aria-label"), element.getAttribute("name"), element.id, element.value, element.textContent,
  ].filter(Boolean).join(" "));
  const button = Array.from(doc.querySelectorAll("button,input[type='button'],input[type='submit']")).find((element) => {
    const text = controlText(element);
    return isVisible(element) && (text.includes("중복 확인") || text.includes("重複確認"));
  });
  if (!(button instanceof win.HTMLElement)) throw new Error("FORM_CONTROL_NOT_FOUND");

  const classifyText = (text) => {
    const normalized = normalizeText(text);
    if (!normalized || normalized.length > 500) return null;
    for (const item of statusTokens) {
      if (item.texts.some((token) => normalized.includes(token))) {
        return { duplicateStatus: item.duplicateStatus, duplicateMessage: normalized };
      }
    }
    return null;
  };
  const classifyMutations = (mutations, expectedHandle) => {
    const elements = [];
    const pushNode = (node) => {
      if (node instanceof win.Element) elements.push(node);
      else if (node && node.parentElement instanceof win.Element) elements.push(node.parentElement);
    };
    for (const mutation of mutations) {
      pushNode(mutation.target);
      for (const node of mutation.addedNodes || []) pushNode(node);
    }
    const seen = new Set();
    for (const element of elements) {
      for (const candidate of [element, ...Array.from(element.querySelectorAll?.("*") || [])]) {
        if (!(candidate instanceof win.HTMLElement) || seen.has(candidate) || !isVisible(candidate)) continue;
        seen.add(candidate);
        const resultText = normalizeText(candidate.textContent);
        const result = classifyText(resultText);
        if (result && resultText.includes("@" + expectedHandle)) return result;
      }
    }
    return null;
  };

  let checkpoint = { jobId, results: [], inFlight: null };
  let checkpointResetReason = null;
  const rawCheckpoint = win.localStorage.getItem(checkpointKey);
  if (rawCheckpoint) {
    try {
      const parsed = JSON.parse(rawCheckpoint);
      if (parsed && parsed.jobId === jobId && Array.isArray(parsed.results)) {
        checkpoint = { ...parsed, inFlight: parsed.inFlight ?? null };
      } else {
        checkpointResetReason = "job_or_schema_mismatch";
      }
    } catch {
      checkpointResetReason = "parse_error";
    }
  }

  const resultByIndex = new Map();
  if (!checkpointResetReason) {
    for (const result of checkpoint.results) {
      const expectedIndex = resultByIndex.size + 1;
      const expected = candidates[expectedIndex - 1];
      if (!result || typeof result !== "object" || !Number.isInteger(result.index) || result.index !== expectedIndex
        || !expected || result.handle !== expected.handle || !allowedStatuses.has(result.duplicateStatus)) {
        checkpointResetReason = "candidate_mismatch";
        resultByIndex.clear();
        break;
      }
      resultByIndex.set(result.index, result);
    }
  }

  let inFlight = checkpointResetReason ? null : (checkpoint.inFlight ?? null);
  if (!checkpointResetReason && inFlight) {
    const expected = candidates[resultByIndex.size];
    if (!inFlight || typeof inFlight !== "object" || !Number.isInteger(inFlight.index)
      || !expected || inFlight.index !== expected.index || inFlight.handle !== expected.handle) {
      checkpointResetReason = "inflight_mismatch";
      resultByIndex.clear();
      inFlight = null;
    }
  }
  if (checkpointResetReason) checkpoint = { jobId, results: [], inFlight: null };

  const persistCheckpoint = () => {
    const results = candidates.flatMap((candidate) => resultByIndex.has(candidate.index) ? [resultByIndex.get(candidate.index)] : []);
    win.localStorage.setItem(checkpointKey, JSON.stringify({ jobId, updatedAt: new Date().toISOString(), results, inFlight }));
    return results;
  };
  const recoveredInFlight = [];
  if (inFlight) {
    const recovered = {
      jobId,
      index: inFlight.index,
      handle: inFlight.handle,
      duplicateStatus: "unknown",
      duplicateMessage: "previous attempt ended with an indeterminate click; duplicate click suppressed",
      checkedAt: new Date().toISOString(),
      lookupCount: 0,
      recoveredFromInFlight: true,
    };
    resultByIndex.set(recovered.index, recovered);
    recoveredInFlight.push({ index: recovered.index, handle: recovered.handle, duplicateStatus: recovered.duplicateStatus });
    inFlight = null;
    persistCheckpoint();
  }
  const setInputValue = (value) => {
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("INPUT_SETTER_NOT_FOUND");
    setter.call(input, value);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
  };
  const waitForClickedResult = (expectedHandle) => new Promise((resolve) => {
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      win.clearTimeout(deadline);
      resolve(value);
    };
    const observer = new win.MutationObserver((mutations) => {
      const observed = classifyMutations(mutations, expectedHandle);
      if (observed) finish(observed);
    });
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true });
    const deadline = win.setTimeout(() => finish({
      duplicateStatus: "unknown",
      duplicateMessage: "duplicate result was not observed before the safety deadline",
    }), 6500);
    button.click();
  });

  const firstRemaining = candidates.find((candidate) => !resultByIndex.has(candidate.index));
  const resumedFromIndex = firstRemaining?.index ?? null;
  const processedThisAttempt = [];
  let clickCount = 0;

  for (const candidate of candidates) {
    if (resultByIndex.has(candidate.index)) continue;
    if (processedThisAttempt.length >= maxPerCall) break;
    setInputValue(candidate.handle);
    inFlight = { index: candidate.index, handle: candidate.handle, clickIntentAt: new Date().toISOString() };
    persistCheckpoint();
    clickCount += 1;
    const outcome = await waitForClickedResult(candidate.handle);
    const result = {
      jobId,
      index: candidate.index,
      handle: candidate.handle,
      duplicateStatus: outcome.duplicateStatus,
      duplicateMessage: normalizeText(outcome.duplicateMessage).slice(0, 500) || null,
      checkedAt: new Date().toISOString(),
      lookupCount: 1,
    };
    resultByIndex.set(candidate.index, result);
    inFlight = null;
    persistCheckpoint();
    processedThisAttempt.push({ index: candidate.index, handle: candidate.handle, duplicateStatus: result.duplicateStatus, lookupCount: 1 });
  }

  const results = persistCheckpoint();
  return {
    checkpointKey,
    checkpointResetReason,
    recoveredInFlight,
    resumedFromIndex,
    processedThisAttempt,
    processedThisAttemptCount: processedThisAttempt.length,
    clickCount,
    totalCheckpointCount: results.length,
    hasMore: results.length < candidates.length,
    results,
  };
}

FORM / NAVIGATION - mandatory:
1. After the one job GET required by the launcher, call playwright_b_browser_tabs action:"list" first. Do not start with browser_snapshot.
2. Identify every chrome-extension://.../connect.html relay tab and preserve it. Never select it for form work, never navigate it, and never close it.
3. If an existing ${FIXUP_DUPLICATE_CHECK_URL} Apps Script work tab exists, select that existing tab and reuse it. Otherwise create exactly one work tab with playwright_b_browser_tabs action:"new", url:${FIXUP_DUPLICATE_CHECK_URL}.
4. Only after the work tab is current, take a fresh snapshot. If the real Instagram ID textbox is already visible, use that latest ref as the evaluate anchor.
5. If the work-tab snapshot is the FixUp login form, use its latest refs to log in, then take one fresh snapshot to obtain the Instagram ID textbox ref.
6. browser_navigate is allowed only on a non-relay work tab when genuine recovery requires it. It must never be used while the current page is chrome-extension://.../connect.html.
7. Do not navigate directly to iframe src when the normal snapshot already exposes usable nested iframe refs. iframe-src navigation is only an exceptional recovery when the form ref truly cannot be obtained.
8. As soon as the Instagram ID textbox ref exists, run the anchored FAST DOM LOOP in bounded chunks. If hasMore=true, immediately invoke the same anchored evaluate again with the same current textbox ref; stop only when hasMore=false and totalCheckpointCount equals the canonical handle count.
9. On FORM_CONTROL_NOT_FOUND or evaluate tool error, end the attempt. Never fall back to per-candidate fill/find/snapshot/click/evaluate calls. Invalid/corrupt checkpoint 자체는 위 safe fresh-start 규칙으로 처리한다.
10. During candidate processing, do not navigate, find, snapshot, fill_form, click, or wait_for. The only repeated browser call allowed is the same anchored bounded browser_evaluate while hasMore=true.

Result mapping:
- 등록 가능 / 登録可能 -> available
- 이미 등록 / 登録済み -> duplicate
- 보호 목록 / 保護リスト -> protected
- no trustworthy match -> unknown
- duplicateMessage must be the actual post-click result text observed from the mutation.

EVALUATE RETURN 검증:
- Each chunk must report totalCheckpointCount and hasMore. While hasMore=true, do not POST; continue the same anchored bounded evaluate. The final chunk must have hasMore=false and totalCheckpointCount equal to the canonical handle count.
- results는 index 1..N이 하나씩 정확히 존재해야 한다.
- 각 results[index - 1].handle은 canonical handle과 case-sensitive exact match여야 한다.
- lookupCount는 이번 attempt에서 실제 조회한 항목마다 정확히 1이어야 한다.
- recoveredInFlight 항목은 이번 attempt click 0회이며 duplicateStatus=unknown이어야 한다. click 여부가 불명확한 이전 attempt를 재시도하지 않는다.
- checkpoint에서 skip한 항목은 이번 attempt에서 button click 0회여야 한다.
- 하나라도 불일치하면 POST하지 않고 즉시 종료한다.

POST 안정성:
- 후보별 POST 금지. 모든 결과를 마지막에 정확히 1회 batch POST한다.
- followers와 instagramAvailable 필드는 보내지 않는다.
- Do not use shell, bash, PowerShell, pwsh, cmd, curl, Python, temp files, or command-line HTTP for the batch POST.
- Keep the completed checkpoint results exactly as returned by the final bounded candidate chunk; do not re-click or rebuild them.
- Use fixup_result_duplicate({payload: JSON_OBJECT}) with the exact {jobId: "${jobId}", category: "${category}", results:RESULTS} payload. This tool alone POSTs to your fixed endpoint; do not navigate to localhost or use browser fetch.
- RESULTS must be the exact full canonical checkpoint result array, in original index order and with exact case-sensitive handles.
- Require response.ok === true, response.completed === true, and processedCount === totalCount. If POST fails or the response is lost, stop the attempt; never repeat candidate lookups.
- The checkpoint key is job-scoped. Never clear it before confirmed completed:true; after completion it may remain because it cannot affect another job.

POST 성공 후 checkpoint 삭제:
- completed:true와 processedCount === totalCount를 확인한 뒤에만, 후보 loop에 사용했던 동일한 최신 Instagram ID textbox ref를 target/element anchor로 전달한 playwright_b_browser_evaluate 1회에서 input.ownerDocument.defaultView.localStorage.removeItem(${JSON.stringify(checkpointKey)})을 실행한다. unanchored evaluate로 다른 origin의 localStorage를 지우지 않는다.
- POST 전이나 POST 실패 상태에서는 checkpoint를 삭제하지 않는다.

금지:
- Instagram 열기 또는 Instagram 계정/팔로워 확인
- BIO/Reels/게시물/DM 검증
- 후보 재검사 또는 목록에 없는 테스트 계정 입력
- 후보별 browser find/snapshot/fill/click/wait 반복
- fixed 2~5초 sleep 반복
- "등록하기 / 登録する" 클릭
- handle 변형/정규화/추정/철자수정
- 결과/숫자 추정

완료 기준:
- 후보 전원의 FixUp duplicateStatus가 checkpoint 및 최종 results에 기록되어 있다.
- 정상 완료된 canonical ID의 실제 중복 확인 버튼 click은 전체 fallback chain 통틀어 정확히 1회다. checkpoint에 이미 완료된 ID는 이후 attempt에서 0회다. click 직후 중단되어 실행 여부가 불명확한 inFlight ID는 안전 우선으로 재클릭하지 않고 unknown 처리한다.
- handle 배열과 결과 배열 개수/index/case가 정확히 일치한다.
- 단 한 번의 batch POST가 성공했다.
- 마지막 응답에서 completed:true와 processedCount === totalCount를 확인했다.
- 성공 확인 뒤 checkpoint가 삭제됐다.`;
}
