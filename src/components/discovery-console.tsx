"use client";

import { useEffect, useState } from "react";
import type { DiscoveryCandidate, DiscoveryResponse, SearchCategory } from "@/lib/discovery/types";

type Health = {
  providers: { exa: boolean; tavily: boolean; supabase: boolean };
};

export function DiscoveryConsole() {
  const [category, setCategory] = useState<SearchCategory>("beauty");
  const [targetCount, setTargetCount] = useState(120);
  const [health, setHealth] = useState<Health | null>(null);
  const [result, setResult] = useState<DiscoveryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  async function runDiscovery() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, targetCount }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "검색에 실패했습니다.");
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "검색에 실패했습니다.");
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
        </div>

        <div className="notice">1단계는 웹에서 실제 Instagram ID·프로필 URL·근거 URL을 확보합니다. 팔로워와 Reels는 추정하지 않고 Instagram 검증 단계에서 채웁니다.</div>
        {error && <div className="notice error">{error}</div>}
      </section>

      <section className="card results">
        <div className="results-head">
          <strong>발굴 결과</strong>
          <span>{result ? `${result.candidates.length}명 · 기존 중복 ${result.skippedDuplicates}명 · 검색 ${result.queriesRun}회` : "검색 전"}</span>
        </div>
        {result?.candidates.length ? <CandidateTable candidates={result.candidates} /> : <div className="empty">검색하면 여기서 바로 프로필과 근거를 검증할 수 있습니다.</div>}
      </section>
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
        <thead><tr><th>Instagram</th><th>장르</th><th>팔로워 / Reels</th><th>발굴 근거</th><th>주의 신호</th><th>검증</th></tr></thead>
        <tbody>
          {candidates.map((candidate) => (
            <tr key={candidate.handle}>
              <td><div className="handle">@{candidate.handle}</div><a className="link" href={candidate.profileUrl} target="_blank" rel="noreferrer">프로필 열기 ↗</a></td>
              <td>{candidate.category === "beauty" ? "미용" : "맛집"}</td>
              <td className="status">Instagram 검증 전</td>
              <td className="evidence">{candidate.evidenceText || "검색 결과에서 프로필 확인"}<br /><a className="link" href={candidate.evidenceUrl} target="_blank" rel="noreferrer">근거 열기 ↗</a></td>
              <td>{candidate.flags.length ? candidate.flags.map((flag) => <span className="flag" key={flag}>{flag}</span>) : "-"}</td>
              <td className="status">검증 필요</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
