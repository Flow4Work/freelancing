"use client";

import { useEffect, useMemo, useState } from "react";
import type { CandidateListResponse, DiscoveryCandidate, DiscoveryResponse, SearchCategory, VerificationPromptResponse } from "@/lib/discovery/types";

type Health = {
  ok: boolean;
  quality?: { ok: boolean; failures: string[] };
  providers: { exa: boolean; tavily: boolean; supabase: boolean };
};

type Toast = { kind: "success" | "error"; message: string } | null;
type StatusFilter = "all" | "search_qualified" | "needs_review";

const PROGRESS_STAGES = [
  "새 검색 lane 실행 중",
  "Instagram URL 정리 중",
  "계정별 검색 근거 합치는 중",
  "공식·사업체 계정 제거 중",
  "일본 타깃·한국 접점 확인 중",
  "신규/보강 후보 저장 중",
];

export function DiscoveryConsole() {
  const [category, setCategory] = useState<SearchCategory>("beauty");
  const [targetCount, setTargetCount] = useState(50);
  const [health, setHealth] = useState<Health | null>(null);
  const [result, setResult] = useState<DiscoveryResponse | null>(null);
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [progressStage, setProgressStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [verificationWatchUntil, setVerificationWatchUntil] = useState<number | null>(null);

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
    if (!verificationWatchUntil) return;
    const timer = window.setInterval(async () => {
      if (Date.now() > verificationWatchUntil) {
        setVerificationWatchUntil(null);
        return;
      }
      try {
        const response = await fetch(`/api/candidates?category=${category}`, { cache: "no-store" });
        const payload = await response.json() as CandidateListResponse;
        if (response.ok) setCandidates(payload.candidates);
      } catch {
        // 자동 새로고침 실패는 다음 주기에 재시도한다.
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [verificationWatchUntil, category]);

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

  const filteredCandidates = useMemo(() => {
    if (statusFilter === "all") return candidates;
    return candidates.filter((candidate) => candidate.candidateStatus === statusFilter);
  }, [candidates, statusFilter]);

  const qualifiedTotal = candidates.filter((candidate) => candidate.candidateStatus === "search_qualified").length;
  const reviewTotal = candidates.filter((candidate) => candidate.candidateStatus === "needs_review").length;
  const verifiedTotal = candidates.filter((candidate) => candidate.verificationStatus === "verified" || candidate.verificationStatus === "insufficient").length;

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

  async function copyVerificationPrompt() {
    const handles = filteredCandidates
      .filter((candidate) => candidate.verificationStatus === "needs_instagram")
      .slice(0, 30)
      .map((candidate) => candidate.handle);

    if (!handles.length) {
      setToast({ kind: "error", message: "현재 필터에 검증할 후보가 없습니다." });
      return;
    }

    try {
      const response = await fetch("/api/verification/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, handles }),
      });
      const payload = await response.json() as VerificationPromptResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "검증 프롬프트 생성 실패");

      await navigator.clipboard.writeText(payload.prompt);
      setVerificationWatchUntil(Date.now() + 10 * 60 * 1000);
      setToast({ kind: "success", message: `OpenCode ${payload.candidateCount}명 복사 · 결과 자동 반영 대기` });
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "클립보드 복사 실패" });
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

        <div className="provider-line">
          <Provider label="Exa" on={Boolean(health?.providers.exa)} />
          <Provider label="Tavily" on={Boolean(health?.providers.tavily)} />
          <Provider label="Supabase 누적·중복" on={Boolean(health?.providers.supabase)} />
          <Provider label="품질 규칙" on={Boolean(health?.quality?.ok)} />
        </div>

        {loading && (
          <div className="progress-box" aria-live="polite">
            <div className="progress-track"><div className="progress-bar" /></div>
            <span>{PROGRESS_STAGES[progressStage]}</span>
          </div>
        )}

        {verificationWatchUntil && <div className="notice">OpenCode가 localhost로 검증 결과를 제출하면 이 화면에 자동 반영됩니다.</div>}
        {health && !health.quality?.ok && <div className="notice error">품질 규칙 자체 점검 실패: {health.quality?.failures.join(", ")}</div>}
        {error && <div className="notice error">{error}</div>}
      </section>

      <section className="card results">
        <div className="results-head">
          <div className="results-summary">
            <strong>누적 후보</strong>
            <span>{listLoading ? "불러오는 중…" : `전체 ${candidates.length} · 유력 ${qualifiedTotal} · 검토 ${reviewTotal} · 검증 ${verifiedTotal}${result ? ` · 이번 처리 ${result.candidates.length}` : ""}`}</span>
          </div>
          <div className="results-actions">
            <div className="mini-segment" aria-label="상태 필터">
              <button className={statusFilter === "all" ? "active" : ""} onClick={() => setStatusFilter("all")}>전체</button>
              <button className={statusFilter === "search_qualified" ? "active" : ""} onClick={() => setStatusFilter("search_qualified")}>유력</button>
              <button className={statusFilter === "needs_review" ? "active" : ""} onClick={() => setStatusFilter("needs_review")}>검토</button>
            </div>
            <button className="secondary" onClick={copyVerificationPrompt} disabled={!filteredCandidates.length}>OpenCode 검증 프롬프트 복사</button>
          </div>
        </div>
        {filteredCandidates.length ? <CandidateTable candidates={filteredCandidates} /> : <div className="empty">{listLoading ? "누적 후보를 불러오는 중입니다." : "현재 조건의 누적 후보가 없습니다."}</div>}
      </section>

      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
    </>
  );
}

function Provider({ label, on }: { label: string; on: boolean }) {
  return <span className="pill"><span className={`dot ${on ? "on" : ""}`} />{label}</span>;
}

function CandidateTable({ candidates }: { candidates: DiscoveryCandidate[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Instagram</th><th>상태</th><th>팔로워 / Reels</th><th>확인 근거</th><th>주의</th><th>검증</th></tr></thead>
        <tbody>
          {candidates.map((candidate) => (
            <tr key={candidate.handle} className={candidate.candidateStatus === "needs_review" ? "review-row" : ""}>
              <td><div className="handle">@{candidate.handle}</div><a className="link" href={candidate.profileUrl} target="_blank" rel="noreferrer">프로필 열기 ↗</a></td>
              <td><span className={`candidate-state ${candidate.candidateStatus}`}>{candidate.candidateStatus === "search_qualified" ? "유력" : "검토 필요"}</span></td>
              <td className="status">{metricLabel(candidate)}</td>
              <td><div className="evidence-one-line" title={candidate.verificationNote ?? candidate.evidenceText}>{evidenceSummary(candidate)}</div></td>
              <td><div className="flag-one-line" title={candidate.flags.join(" · ")}>{candidate.flags.length ? candidate.flags.join(" · ") : "-"}</div></td>
              <td className="status">{verificationLabel(candidate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function evidenceSummary(candidate: DiscoveryCandidate) {
  if (candidate.verificationNote) return candidate.verificationNote;
  const topic = candidate.category === "beauty" ? "미용" : "맛집";
  const target = candidate.targetSignals[0] ?? null;
  const korea = candidate.koreaSignals.filter((signal) => !(target === "한국거주 일본인" && signal === "한국 거주")).slice(0, 2);
  if (target && korea.length) return `${target} · ${korea.join("·")} · ${topic} 콘텐츠 확인`;
  if (target) return `${target} 확인 · 한국 ${topic} 접점 추가 확인 필요`;
  if (korea.length) return `${korea.join("·")} ${topic} 콘텐츠 확인 · 일본 타깃 여부 확인 필요`;
  return `${topic} 후보 · Instagram 프로필 원본 확인 필요`;
}

function metricLabel(candidate: DiscoveryCandidate) {
  const followers = candidate.followers === null ? "-" : candidate.followers.toLocaleString();
  if (candidate.reelAverage === null) return candidate.followers === null ? "실측 대기" : `${followers} / Reels -`;
  const checked = candidate.reelCheckedCount ?? candidate.reelSampleSize ?? 0;
  const total = candidate.reelTotalConsidered ?? checked;
  const suffix = candidate.reelMetricsStatus === "insufficient" ? " · 표본 부족" : "";
  return `${followers} / 평균 ${candidate.reelAverage.toLocaleString()} (${checked}/${total})${suffix}`;
}

function verificationLabel(candidate: DiscoveryCandidate) {
  if (candidate.verificationStatus === "verified") return "Instagram 검증 완료";
  if (candidate.verificationStatus === "insufficient") return "검증 완료 · 일부 확인불가";
  return "Instagram 실측 대기";
}
