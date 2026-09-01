"use client";

import { useEffect, useMemo, useState } from "react";
import { getCandidateViewState, type CandidateViewState } from "@/lib/discovery/presentation";
import type { CandidateListResponse, DiscoveryCandidate, DiscoveryResponse, SearchCategory } from "@/lib/discovery/types";

type Health = {
  ok: boolean;
  quality?: { ok: boolean; failures: string[] };
  providers: { exa: boolean; tavily: boolean; supabase: boolean };
};

type Toast = { kind: "success" | "error"; message: string } | null;
type StatusFilter = "all" | CandidateViewState;
type AutomationMode = "duplicate" | "instagram";

type AutomationRunResponse = {
  ok: boolean;
  jobId?: string;
  candidateCount?: number;
  mode?: AutomationMode;
  error?: string;
};

const PROGRESS_STAGES = [
  "새 검색 lane 실행 중",
  "Instagram URL 정리 중",
  "계정별 검색 근거 합치는 중",
  "공식·사업체 계정 제거 중",
  "일본 타깃·한국 접점 확인 중",
  "신규/보강 후보 저장 중",
];

const RECOMMENDED_BADGE_STYLE = { color: "#d6336c", background: "#fff0f6" };
const DUPLICATE_PENDING_BADGE_STYLE = { color: "#6b7684", background: "#f2f4f6" };
const ACTION_SLOT_WIDTH = 118;

export function DiscoveryConsole() {
  const [category, setCategory] = useState<SearchCategory>("beauty");
  const [targetCount, setTargetCount] = useState(50);
  const [health, setHealth] = useState<Health | null>(null);
  const [result, setResult] = useState<DiscoveryResponse | null>(null);
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(false);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [progressStage, setProgressStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [automationWatchUntil, setAutomationWatchUntil] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ payload }) => setHealth(payload))
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setResult(null);
    setStatusFilter("all");

    fetch(`/api/candidates?category=${category}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as CandidateListResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "누적 후보를 불러오지 못했습니다.");
        if (!cancelled) setCandidates(payload.candidates);
      })
      .catch((caught) => {
        if (!cancelled) {
          setCandidates([]);
          setToast({ kind: "error", message: caught instanceof Error ? caught.message : "누적 후보 조회 실패" });
        }
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });

    return () => { cancelled = true; };
  }, [category]);

  useEffect(() => {
    if (!automationWatchUntil) return;
    const timer = window.setInterval(async () => {
      if (Date.now() > automationWatchUntil) {
        setAutomationWatchUntil(null);
        return;
      }
      try {
        await reloadCandidates(category);
      } catch {
        // 다음 주기에 다시 시도한다.
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [automationWatchUntil, category]);

  useEffect(() => {
    if (!loading) return;
    setProgressStage(0);
    const timer = window.setInterval(() => {
      setProgressStage((current) => Math.min(current + 1, PROGRESS_STAGES.length - 1));
    }, 1400);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function candidateState(candidate: DiscoveryCandidate): CandidateViewState {
    const state = getCandidateViewState(candidate);
    if (
      state === "verification_needed"
      && (
        candidate.evidenceKind !== "profile"
        || candidate.flags.includes("개인 Creator 근거 추가확인")
      )
    ) {
      return "unmapped";
    }
    return state;
  }

  const filteredCandidates = useMemo(() => {
    if (statusFilter === "all") return candidates;
    return candidates.filter((candidate) => candidateState(candidate) === statusFilter);
  }, [candidates, statusFilter]);

  const verificationNeededTotal = candidates.filter((candidate) => candidateState(candidate) === "verification_needed").length;
  const recommendedTotal = candidates.filter((candidate) => candidateState(candidate) === "recommended").length;
  const duplicatePassedTotal = candidates.filter((candidate) => candidateState(candidate) === "duplicate_passed").length;
  const finalVerificationTotal = candidates.filter((candidate) => candidateState(candidate) === "final_verification").length;
  const dmReadyTotal = candidates.filter((candidate) => candidateState(candidate) === "dm_ready").length;

  const action = statusFilter === "verification_needed" || statusFilter === "recommended"
    ? { mode: "duplicate" as const, label: "중복 확인 실행" }
    : statusFilter === "duplicate_passed"
      ? { mode: "instagram" as const, label: "최종 검증 실행" }
      : null;

  async function reloadCandidates(targetCategory: SearchCategory) {
    const response = await fetch(`/api/candidates?category=${targetCategory}`, { cache: "no-store" });
    const payload = await response.json() as CandidateListResponse & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "누적 후보를 불러오지 못했습니다.");
    setCandidates(payload.candidates);
  }

  async function runDiscovery() {
    setLoading(true);
    setError(null);
    setToast(null);
    try {
      const response = await fetch("/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, targetCount }),
      });
      const payload = await response.json() as DiscoveryResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "검색에 실패했습니다.");
      setResult(payload);
      await reloadCandidates(category);
      setToast({ kind: "success", message: `${payload.runNo}차 검색 · ${payload.candidates.length}명 신규/근거 보강` });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "검색에 실패했습니다.";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setLoading(false);
    }
  }

  async function runAutomation(mode: AutomationMode) {
    const handles = filteredCandidates.slice(0, 30).map((candidate) => candidate.handle);
    if (!handles.length) {
      setToast({ kind: "error", message: "현재 상태에서 실행할 후보가 없습니다." });
      return;
    }

    setAutomationLoading(true);
    setToast(null);
    try {
      const response = await fetch("/api/automation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, mode, handles }),
      });
      const payload = await response.json() as AutomationRunResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "OpenCode 자동 실행 실패");

      setAutomationWatchUntil(Date.now() + 10 * 60 * 1000);
      setToast({
        kind: "success",
        message: `PowerShell + OpenCode 실행 · ${payload.candidateCount ?? handles.length}명`,
      });
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "OpenCode 자동 실행 실패" });
    } finally {
      setAutomationLoading(false);
    }
  }

  return (
    <>
      <section className="card controls">
        <div className="control-row">
          <div className="segment" aria-label="검색 장르">
            <button className={category === "beauty" ? "active" : ""} onClick={() => setCategory("beauty")}>💄 미용</button>
            <button className={category === "food" ? "active" : ""} onClick={() => setCategory("food")}>🍜 맛집</button>
          </div>
          <div className="field">
            <label htmlFor="target">이번 추가 목표</label>
            <input id="target" type="number" min={10} max={300} value={targetCount} onChange={(event) => setTargetCount(Number(event.target.value))} />
          </div>
          <button className="primary" onClick={runDiscovery} disabled={loading}>{loading ? "찾는 중…" : candidates.length ? "+ 추가 찾기" : "후보 찾기"}</button>
        </div>

        {loading && (
          <div className="progress-box" aria-live="polite">
            <div className="progress-track"><div className="progress-bar" /></div>
            <span>{PROGRESS_STAGES[progressStage]}</span>
          </div>
        )}

        {health && !health.quality?.ok && <div className="notice error">품질 규칙 자체 점검 실패: {health.quality?.failures.join(", ")}</div>}
        {error && <div className="notice error">{error}</div>}
      </section>

      <section className="card results">
        <div className="results-head">
          <div className="results-summary">
            <strong>누적 후보</strong>
            <span>{listLoading ? "불러오는 중…" : `전체 ${candidates.length} · 검증 필요 ${verificationNeededTotal} · 추천 후보 ${recommendedTotal} · 중복 통과 ${duplicatePassedTotal} · 최종 검증 완료 ${finalVerificationTotal} · DM 준비 ${dmReadyTotal}${result ? ` · 이번 ${result.candidates.length}` : ""}`}</span>
          </div>
          <div className="results-actions">
            <div className="mini-segment" aria-label="상태 필터">
              <button className={statusFilter === "all" ? "active" : ""} onClick={() => setStatusFilter("all")}>전체</button>
              <button className={statusFilter === "verification_needed" ? "active" : ""} onClick={() => setStatusFilter("verification_needed")}>검증 필요</button>
              <button className={statusFilter === "recommended" ? "active" : ""} onClick={() => setStatusFilter("recommended")}>추천 후보</button>
              <span className="filter-separator" style={{ margin: "0 9.6px" }} aria-hidden="true">ㅣ</span>
              <button className={statusFilter === "duplicate_passed" ? "active" : ""} onClick={() => setStatusFilter("duplicate_passed")}>중복 통과</button>
              <button className={statusFilter === "final_verification" ? "active" : ""} onClick={() => setStatusFilter("final_verification")}>최종 검증 완료</button>
              <button className={statusFilter === "dm_ready" ? "active" : ""} onClick={() => setStatusFilter("dm_ready")}>DM 준비</button>
            </div>
            <div style={{ width: ACTION_SLOT_WIDTH, flex: `0 0 ${ACTION_SLOT_WIDTH}px` }}>
              {action && (
                <button
                  className="secondary action-button"
                  style={{
                    width: "100%",
                    whiteSpace: "nowrap",
                    ...(action.mode === "instagram" ? { background: "#dc2626" } : {}),
                  }}
                  onClick={() => runAutomation(action.mode)}
                  disabled={automationLoading || !filteredCandidates.length}
                >
                  {automationLoading ? "실행 중…" : action.label}
                </button>
              )}
            </div>
          </div>
        </div>
        {filteredCandidates.length ? <CandidateTable candidates={filteredCandidates} getState={candidateState} /> : <div className="empty">{listLoading ? "누적 후보를 불러오는 중입니다." : "현재 조건의 누적 후보가 없습니다."}</div>}
      </section>

      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
    </>
  );
}

function CandidateTable({ candidates, getState }: { candidates: DiscoveryCandidate[]; getState: (candidate: DiscoveryCandidate) => CandidateViewState }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Instagram</th><th style={{ width: 154 }}>상태</th><th>팔로워 / Reels</th><th>확인 근거</th><th>중복</th><th>검증</th></tr></thead>
        <tbody>
          {candidates.map((candidate) => {
            const state = getState(candidate);
            return (
              <tr key={candidate.handle} className={state === "verification_needed" || state === "unmapped" ? "review-row" : ""}>
                <td><div className="handle">@{candidate.handle}</div><a className="link" href={candidate.profileUrl} target="_blank" rel="noreferrer">프로필 열기 ↗</a></td>
                <td><CandidateStateBadges state={state} candidate={candidate} /></td>
                <td className="status">{metricLabel(candidate)}</td>
                <td><div className="evidence-one-line" title={candidate.verificationNote ?? candidate.evidenceText}>{evidenceSummary(candidate)}</div></td>
                <td className="status">{duplicateLabel(candidate)}</td>
                <td className="status">{verificationLabel(candidate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CandidateStateBadges({ state, candidate }: { state: CandidateViewState; candidate: DiscoveryCandidate }) {
  const source = state === "duplicate_passed" ? duplicateSourceBadge(candidate) : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "nowrap" }}>
      <span className={`candidate-state ${stateTone(state)}`} style={state === "recommended" ? RECOMMENDED_BADGE_STYLE : undefined}>{stateLabel(state)}</span>
      {source && (
        <span
          className={`candidate-state ${source.tone}`}
          style={source.tone === "recommended" ? RECOMMENDED_BADGE_STYLE : DUPLICATE_PENDING_BADGE_STYLE}
        >
          {source.label}
        </span>
      )}
    </div>
  );
}

function duplicateSourceBadge(candidate: DiscoveryCandidate) {
  if (candidate.candidateStatus === "search_qualified") return { label: "추천 후보", tone: "recommended" };
  if (candidate.candidateStatus === "needs_review") return { label: "검증 필요", tone: "review" };
  return null;
}

function stateLabel(state: CandidateViewState) {
  if (state === "verification_needed") return "검증 필요";
  if (state === "recommended") return "추천 후보";
  if (state === "duplicate_passed") return "중복 통과";
  if (state === "final_verification") return "최종 검증 완료";
  if (state === "dm_ready") return "DM 준비";
  return "기존 상태";
}

function stateTone(state: CandidateViewState) {
  if (state === "recommended") return "recommended";
  if (state === "dm_ready") return "qualified";
  if (state === "duplicate_passed" || state === "final_verification") return "priority";
  return "review";
}

function evidenceSummary(candidate: DiscoveryCandidate) {
  if (candidate.verificationNote) return candidate.verificationNote;
  const topic = candidate.category === "beauty" ? "미용" : "맛집";
  const target = candidate.targetSignals[0] ?? null;
  const korea = candidate.koreaSignals.filter((signal) => !(target === "한국거주 일본인" && signal === "한국 거주")).slice(0, 2);
  if (target && korea.length) return `${target} · ${korea.join("·")} · ${topic} 콘텐츠 확인`;
  if (target) return `${target} 확인 · 한국 ${topic} 접점 추가 확인 필요`;
  if (korea.length) return `${korea.join("·")} ${topic} 콘텐츠 확인 · 일본 타깃 여부 확인 필요`;
  return `${topic} 후보 · Instagram 원본 확인 필요`;
}

function metricLabel(candidate: DiscoveryCandidate) {
  const followers = candidate.followers === null ? "-" : candidate.followers.toLocaleString();
  if (candidate.reelAverage === null) return candidate.followers === null ? "실측 대기" : `${followers} / Reels -`;
  const checked = candidate.reelCheckedCount ?? candidate.reelSampleSize ?? 0;
  const total = candidate.reelTotalConsidered ?? checked;
  const suffix = candidate.reelMetricsStatus === "insufficient" ? " · 표본 부족" : "";
  return `${followers} / 평균 ${candidate.reelAverage.toLocaleString()} (${checked}/${total})${suffix}`;
}

function duplicateLabel(candidate: DiscoveryCandidate) {
  if (candidate.duplicateCheckStatus === "available") return "진행가능(미등록)";
  if (candidate.duplicateCheckStatus === "unknown") return "확인 불가";
  if (candidate.duplicateCheckStatus === "duplicate") return "중복";
  if (candidate.duplicateCheckStatus === "protected") return "보호 목록";
  return "미확인";
}

function verificationLabel(candidate: DiscoveryCandidate) {
  if (candidate.verificationStatus === "verified") return "검증 완료";
  if (candidate.verificationStatus === "insufficient") return "일부 확인불가";
  return "실측 대기";
}
