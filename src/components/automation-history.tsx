"use client";

import { useState } from "react";
import type { SearchCategory } from "@/lib/discovery/types";

type Group = {
  destination: string;
  handles: string[];
  reasons: Array<{ handle: string; reason: string }>;
};

type Item = {
  id: string;
  mode: "duplicate" | "instagram";
  status: "pending" | "completed" | "failed";
  candidateCount: number;
  processedCount: number;
  createdAt: string;
  completedAt: string | null;
  failedAt: string | null;
  failureMessage: string | null;
  groups: Group[];
  exactSnapshot: boolean;
};

const COMPLETED_ORANGE = "#f59e0b";
const FAILED_RED = "#dc2626";

export function AutomationHistory({ category }: { category: SearchCategory }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      setExpandedId(null);
      return;
    }

    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/automation/history?category=${category}`, { cache: "no-store" });
      const payload = await response.json() as { ok: boolean; items?: Item[]; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "기록 조회 실패");
      setItems(payload.items ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "기록 조회 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: "relative", flex: "0 0 auto", marginRight: 18 }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          border: 0,
          borderRadius: 10,
          padding: "12px 20px",
          color: "#4e5968",
          background: "#f2f4f6",
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 400,
        }}
      >
        기록
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 80,
            width: 470,
            maxWidth: "calc(100vw - 48px)",
            maxHeight: 500,
            overflowY: "auto",
            border: "1px solid #e5e8eb",
            borderRadius: 14,
            padding: "11px 12px",
            color: "#4e5968",
            background: "#fff",
            boxShadow: "0 12px 34px rgba(0,0,0,.12)",
            fontSize: 12,
          }}
        >
          <strong style={{ color: "#191f28" }}>처리 기록</strong>
          {loading ? (
            <div style={{ paddingTop: 8, color: "#6b7684" }}>불러오는 중…</div>
          ) : error ? (
            <div style={{ paddingTop: 8, color: "#d64545" }}>{error}</div>
          ) : items.length ? (
            items.map((item) => {
              const expanded = expandedId === item.id;
              const completed = item.status === "completed";
              const failed = item.status === "failed";
              const recordColor = completed ? COMPLETED_ORANGE : failed ? FAILED_RED : "#333d4b";
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "9px 0",
                    border: 0,
                    borderBottom: "1px solid #f0f2f4",
                    background: "transparent",
                    color: "inherit",
                    cursor: "pointer",
                    font: "inherit",
                    textAlign: "left",
                    whiteSpace: "normal",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: recordColor, fontWeight: 800 }}>{title(item)}</span>
                    {item.status !== "pending" && (
                      <span style={{ flex: "0 0 auto", color: recordColor, fontSize: 11, fontWeight: 400 }}>
                        {terminalTime(item)}
                      </span>
                    )}
                  </span>
                  <span style={{ display: "block", marginTop: 3, color: failed ? FAILED_RED : completed ? COMPLETED_ORANGE : "#6b7684", lineHeight: 1.45 }}>
                    {resultLine(item)}
                  </span>
                  {expanded && <Detail item={item} />}
                </button>
              );
            })
          ) : (
            <div style={{ paddingTop: 8, color: "#6b7684" }}>아직 실행 기록이 없습니다.</div>
          )}
        </div>
      )}
    </div>
  );
}

function title(item: Item) {
  const action = item.mode === "duplicate" ? "중복 확인" : "최종 검증";
  if (item.status === "pending") return `${action} ${item.processedCount}/${item.candidateCount} 진행 중`;
  if (item.status === "failed") return `${action} ${item.processedCount}/${item.candidateCount} 실패`;
  return `${action} ${item.candidateCount}명 완료`;
}

function resultLine(item: Item) {
  if (item.status === "pending") {
    return item.processedCount > 0 ? `현재 ${item.processedCount}명 결과 저장 완료` : "첫 결과를 기다리는 중입니다.";
  }
  if (item.status === "failed") return item.failureMessage ?? "작업이 완료 전에 중단되었습니다.";
  if (!item.groups.length) return "처리 결과가 없습니다.";
  return item.groups.map((group) => `${group.destination} ${group.handles.length}`).join(" · ");
}

function Detail({ item }: { item: Item }) {
  if (item.status === "pending") return null;
  return (
    <span style={{ display: "block", marginTop: 10, paddingTop: 9, borderTop: "1px solid #edf0f2" }}>
      <span style={{ display: "block", marginBottom: 7, color: "#6b7684", fontSize: 11 }}>
        {time(item)} · 저장 {item.processedCount}/{item.candidateCount}명
      </span>
      {item.status === "failed" && item.failureMessage && (
        <span style={{ display: "block", marginBottom: 7, color: FAILED_RED, lineHeight: 1.45 }}>
          {item.failureMessage}
        </span>
      )}
      {!item.exactSnapshot && item.status === "completed" && (
        <span style={{ display: "block", marginBottom: 7, color: "#8b95a1", fontSize: 11 }}>
          이전 실행 기록 · 현재 저장 상태 기준
        </span>
      )}
      {item.groups.map((group) => (
        <span key={group.destination} style={{ display: "block", marginBottom: 9 }}>
          <span style={{ display: "block", color: "#333d4b", fontWeight: 800 }}>{group.destination} {group.handles.length}명</span>
          <span style={{ display: "block", marginTop: 2, color: "#6b7684", lineHeight: 1.45 }}>
            {group.handles.map((handle) => `@${handle}`).join(", ")}
          </span>
          {group.reasons.length > 0 && (
            <span style={{ display: "block", marginTop: 4, color: "#8a5b00", lineHeight: 1.45 }}>
              {group.reasons.map((row) => `@${row.handle} — ${row.reason}`).join(" · ")}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

function terminalTime(item: Item) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(item.completedAt ?? item.failedAt ?? item.createdAt));
}

function time(item: Item) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(item.completedAt ?? item.failedAt ?? item.createdAt));
}
