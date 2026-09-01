"use client";

import { useEffect, useState } from "react";
import type { DiscoveryCandidate, DiscoveryResponse, SearchCategory } from "@/lib/discovery/types";

type Health = {
  ok: boolean;
  quality?: { ok: boolean; failures: string[] };
  providers: { exa: boolean; tavily: boolean; supabase: boolean };
};

type Toast = { kind: "success" | "error"; message: string } | null;

const PROGRESS_STAGES = [
  "검색 lane 실행 중",
  "Instagram URL 정리 중",
  "공식·사업체 계정 제거 중",
  "일본 타깃·한국 접점 확인 중",
  "Supabase 중복 확인 중",
  "유력 후보 정렬 중",
];

export function DiscoveryConsole() {
  const [category, setCategory] = useState<SearchCategory>("beauty");
  const [targetCount, setTargetCount] = useState(120);
  const [health, setHealth] = useState<Health | null>(null);
  const [result, setResult] = useState<DiscoveryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [progressStage, setProgressStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    fetch("/api/health")
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ payload }) => setHealth(payload))
      .catch(() => setHealth(null));
  }, []);

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
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "검색에 실패했습니다.");
      setResult(payload);
      setToast({
        kind: "success",
        message: `유력 ${payload.qualifiedCount}명 · 검토 ${payload.reviewCount}명 확보`,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "검색에 실패했습니다.";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setLoading(false);
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
            <label htmlFor="target">목표 후보</label>
            <input id="target" type="number" min={10} max={300} value={targetCount} onChange={(event) => setTargetCount(Number(event.target.value))} />
          </div>
          <button className="primary" onClick={runDiscovery} disabled={loading}>{loading ? "찾는 중…" : "후보 찾기"}</button>
        </div>

        <div className="provider-line">
          <Provider label="Exa" on={Boolean(health?.providers.exa)} />
          <Provider label="Tavily" on={Boolean(health?.providers.tavily)} />
          <Provider label="Supabase 중복검사" on={Boolean(health?.providers.supabase)} />
          <Provider label="품질 규칙" on={Boolean(health?.quality?.ok)} />
        </div>

        {loading && (
          <div className="progress-box" aria-live="polite">
            <div className="progress-track"><div className="progress-bar" /></div>
            <span>{PROGRESS_STAGES[progressStage]}</span>
          </div>
        )}

        <div className="notice">검색 결과를 바로 후보로 올리지 않습니다. URL 정화 → 개인 Creator 필터 → 일본 타깃·한국 접점 확인을 통과한 계정부터 표시합니다. 팔로워와 Reels는 Instagram 실측 단계에서 채웁니다.</div>
        {health && !health.quality?.ok && <div className="notice error">품질 규칙 자체 점검 실패: {health.quality?.failures.join(", ")}</div>}
        {error && <div className="notice error">{error}</div>}
      </section>

      <section className="card results">
        <div className="results-head">
          <strong>발굴 결과</strong>
          <span>{result ? `유력 ${result.qualifiedCount} · 검토 ${result.reviewCount} · 노이즈 제거 ${result.filteredNoise} · 중복 ${result.skippedDuplicates}` : "검색 전"}</span>
        </div>
        {result?.candidates.length ? <CandidateTable candidates={result.candidates} /> : <div className="empty">검색하면 여기서 바로 프로필과 근거를 검증할 수 있습니다.</div>}
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
        <thead><tr><th>Instagram</th><th>상태</th><th>팔로워 / Reels</th><th>확인 근거</th><th>주의 신호</th><th>검증</th></tr></thead>
        <tbody>
          {candidates.map((candidate) => (
            <tr key={candidate.handle} className={candidate.candidateStatus === "needs_review" ? "review-row" : ""}>
              <td><div className="handle">@{candidate.handle}</div><a className="link" href={candidate.profileUrl} target="_blank" rel="noreferrer">프로필 열기 ↗</a></td>
              <td>
                <span className={`candidate-state ${candidate.candidateStatus}`}>
                  {candidate.candidateStatus === "search_qualified" ? "유력" : "검토 필요"}
                </span>
              </td>
              <td className="status">Instagram 실측 대기</td>
              <td className="evidence">
                {candidate.evidenceText || "검색 결과에서 프로필 확인"}
                <div className="signal-line">
                  {[...candidate.targetSignals, ...candidate.koreaSignals].slice(0, 4).map((signal) => <span className="signal" key={signal}>{signal}</span>)}
                </div>
                <a className="link" href={candidate.evidenceUrl} target="_blank" rel="noreferrer">근거 열기 ↗</a>
              </td>
              <td>{candidate.flags.length ? candidate.flags.map((flag) => <span className="flag" key={flag}>{flag}</span>) : "-"}</td>
              <td className="status">{candidate.evidenceKind === "profile" ? "프로필 근거" : "게시물→프로필 확인"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
