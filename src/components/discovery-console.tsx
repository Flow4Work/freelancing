"use client";

import { useEffect, useMemo, useState } from "react";
import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";
import { getCandidateViewState, getSearchStageViewState, type CandidateViewState } from "@/lib/discovery/presentation";
import type { CandidateListResponse, DiscoveryCandidate, DiscoveryResponse, SearchCategory } from "@/lib/discovery/types";
import { buildDmBatchInputPrompt } from "@/lib/dm/opencode-prompt";
import dmStyles from "./dm-workflow.module.css";

type Health = {
  ok: boolean;
  quality?: { ok: boolean; failures: string[] };
  providers: { exa: boolean; tavily: boolean; supabase: boolean };
};

type Toast = { kind: "success" | "error"; message: string } | null;
type StatusFilter = "all" | CandidateViewState | "send_confirmation";
type AutomationMode = "duplicate" | "instagram";
type DmReviewStep = "edit" | "confirm";

type AutomationRunResponse = {
  ok: boolean;
  jobId?: string;
  candidateCount?: number;
  mode?: AutomationMode;
  error?: string;
};

type DmPreparedItem = {
  handle: string;
  japaneseText: string;
  koreanText: string;
  generatedAt: string;
  provider: string;
  model: string;
};

type DmDraft = DmPreparedItem & {
  translationDirty: boolean;
  approved: boolean;
};

type DmPrepareResponse = {
  ok: boolean;
  preparedCount?: number;
  providerCounts?: Record<string, number>;
  models?: string[];
  items?: DmPreparedItem[];
  reused?: boolean;
  error?: string;
};

type DmContact = {
  id: string;
  handle: string;
  category: SearchCategory;
  japaneseText: string;
  koreanText: string;
  generatedAt: string;
  approvedAt: string;
  openCodeStatus: "pending" | "success" | "failed";
  openCodeCompletedAt: string | null;
  openCodeError: string | null;
  sentAt: string | null;
};

type DmContactsResponse = {
  ok: boolean;
  contacts?: DmContact[];
  contact?: DmContact;
  koreanText?: string;
  processId?: number;
  candidateCount?: number;
  requestedCount?: number;
  contactCount?: number;
  launcherCount?: number;
  promptCount?: number;
  openCodeRunCount?: number;
  error?: string;
};

type AutomationHistoryGroup = {
  destination: string;
  handles: string[];
  reasons: Array<{ handle: string; reason: string }>;
};

type AutomationHistoryItem = {
  id: string;
  mode: AutomationMode;
  status: "pending" | "completed" | "failed";
  candidateCount: number;
  processedCount: number;
  createdAt: string;
  completedAt: string | null;
  failedAt: string | null;
  failureMessage: string | null;
  destination: string;
  destinationCount: number;
  excludedCount: number;
  unresolvedCount: number;
  groups: AutomationHistoryGroup[];
  exactSnapshot: boolean;
};

type AutomationHistoryResponse = {
  ok: boolean;
  items?: AutomationHistoryItem[];
  error?: string;
};

type BulkDmParseResult =
  | { ok: true; messages: Map<string, string> }
  | { ok: false; error: string };

type StoredDmSession = {
  version: 1;
  category: SearchCategory;
  drafts: DmDraft[];
  bulkJapaneseText: string;
  reviewStep: DmReviewStep;
};

const PROGRESS_STAGES = [
  "새 검색 lane 실행 중",
  "Instagram URL 정리 중",
  "계정 생존 확인 중",
  "계정별 검색 근거 합치는 중",
  "일본 타깃·한국 접점 확인 중",
  "신규/보강 후보 저장 중",
];

const RECOMMENDED_BADGE_STYLE = { color: "#d6336c", background: "#fff0f6" };
const DUPLICATE_PENDING_BADGE_STYLE = { color: "#6b7684", background: "#f2f4f6" };
const ACTION_SLOT_WIDTH = 118;
const AUTOMATION_WATCH_MS = 3 * 60 * 60 * 1000;
const BULK_APPROVAL_HANDLE = "__all__";
const DM_SESSION_KEY_PREFIX = "fixup-scout:dm-session:v1:";

export function DiscoveryConsole() {
  const [category, setCategory] = useState<SearchCategory>("beauty");
  const [targetCount, setTargetCount] = useState(50);
  const [health, setHealth] = useState<Health | null>(null);
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(false);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmRegeneratingHandle, setDmRegeneratingHandle] = useState<string | null>(null);
  const [dmTranslatingHandle, setDmTranslatingHandle] = useState<string | null>(null);
  const [dmApprovingHandle, setDmApprovingHandle] = useState<string | null>(null);
  const [dmDrafts, setDmDrafts] = useState<DmDraft[]>([]);
  const [dmDraftCategory, setDmDraftCategory] = useState<SearchCategory | null>(null);
  const [dmBulkJapaneseText, setDmBulkJapaneseText] = useState("");
  const [dmReviewStep, setDmReviewStep] = useState<DmReviewStep>("edit");
  const [dmParseError, setDmParseError] = useState<string | null>(null);
  const [dmReviewPreparing, setDmReviewPreparing] = useState(false);
  const [dmModalOpen, setDmModalOpen] = useState(false);
  const [dmContacts, setDmContacts] = useState<DmContact[]>([]);
  const [dmContactsLoading, setDmContactsLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [progressStage, setProgressStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [automationWatchUntil, setAutomationWatchUntil] = useState<number | null>(null);
  const [watchedAutomationJobId, setWatchedAutomationJobId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<AutomationHistoryItem[]>([]);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [selectedVerificationHandles, setSelectedVerificationHandles] = useState<Set<string>>(() => new Set());
  const [deletingCandidateHandle, setDeletingCandidateHandle] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ payload }) => setHealth(payload))
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setStatusFilter("all");
    setHistoryOpen(false);
    setHistoryItems([]);
    setExpandedHistoryId(null);
    const restoredDmSession = readDmSession(category);
    if (restoredDmSession) {
      setDmDrafts(restoredDmSession.drafts);
      setDmBulkJapaneseText(restoredDmSession.bulkJapaneseText);
      setDmReviewStep(restoredDmSession.reviewStep);
    } else {
      setDmDrafts([]);
      setDmBulkJapaneseText("");
      setDmReviewStep("edit");
    }
    setDmDraftCategory(category);
    setDmParseError(null);
    setDmModalOpen(false);
    setSelectedVerificationHandles(new Set());
    setDeletingCandidateHandle(null);

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

    setDmContactsLoading(true);
    fetch(`/api/dm/contacts?category=${category}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as DmContactsResponse;
        if (!response.ok || !payload.ok) throw new Error(payload.error ?? "발송 확인 목록을 불러오지 못했습니다.");
        if (!cancelled) setDmContacts(payload.contacts ?? []);
      })
      .catch((caught) => {
        if (!cancelled) {
          setDmContacts([]);
          setToast({ kind: "error", message: caught instanceof Error ? caught.message : "발송 확인 목록 조회 실패" });
        }
      })
      .finally(() => {
        if (!cancelled) setDmContactsLoading(false);
      });

    return () => { cancelled = true; };
  }, [category]);

  useEffect(() => {
    if (dmDraftCategory !== category) return;
    const key = dmSessionKey(category);
    try {
      if (!dmDrafts.length) {
        window.sessionStorage.removeItem(key);
        return;
      }
      const stored: StoredDmSession = {
        version: 1,
        category,
        drafts: dmDrafts,
        bulkJapaneseText: dmBulkJapaneseText,
        reviewStep: dmReviewStep,
      };
      window.sessionStorage.setItem(key, JSON.stringify(stored));
    } catch {
      // sessionStorage를 사용할 수 없어도 현재 페이지의 DM 작업은 유지한다.
    }
  }, [category, dmBulkJapaneseText, dmDraftCategory, dmDrafts, dmReviewStep]);

  useEffect(() => {
    if (!dmContacts.some((contact) => contact.openCodeStatus === "pending")) return;
    const timer = window.setInterval(() => {
      reloadDmContacts(category).catch(() => {
        // 다음 주기에 다시 시도한다.
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [category, dmContacts]);

  useEffect(() => {
    if (!automationWatchUntil) return;
    const timer = window.setInterval(async () => {
      if (Date.now() > automationWatchUntil) {
        setAutomationWatchUntil(null);
        setWatchedAutomationJobId(null);
        return;
      }
      try {
        const refreshedCandidates = await reloadCandidates(category);
        const items = await fetchHistoryItems();
        if (historyOpen) setHistoryItems(items);

        const watched = watchedAutomationJobId
          ? items.find((item) => item.id === watchedAutomationJobId)
          : null;
        if (watched && watched.status !== "pending") {
          setWatchedAutomationJobId(null);
          setAutomationWatchUntil(null);
          setToast({
            kind: watched.status === "failed" ? "error" : "success",
            message: automationCompletionMessage(watched, refreshedCandidates),
          });
        }
      } catch {
        // 다음 주기에 다시 시도한다.
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [automationWatchUntil, category, historyOpen, watchedAutomationJobId]);

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
    return getCandidateViewState(candidate);
  }

  const visibleCandidates = useMemo(
    () => candidates.filter((candidate) => candidateState(candidate) !== "unmapped"),
    [candidates],
  );

  const filteredCandidates = useMemo(() => {
    if (statusFilter === "send_confirmation") return [];
    if (statusFilter === "all") return visibleCandidates;
    return visibleCandidates.filter((candidate) => candidateState(candidate) === statusFilter);
  }, [visibleCandidates, statusFilter]);

  const verificationNeededTotal = candidates.filter((candidate) => candidateState(candidate) === "verification_needed").length;
  const recommendedTotal = candidates.filter((candidate) => candidateState(candidate) === "recommended").length;
  const duplicatePassedTotal = candidates.filter((candidate) => candidateState(candidate) === "duplicate_passed").length;
  const finalVerificationTotal = candidates.filter((candidate) => candidateState(candidate) === "final_verification").length;
  const sendReadyContacts = dmContacts.filter((contact) => contact.openCodeStatus === "success" && !contact.sentAt);
  const excludedTotal = candidates.length - visibleCandidates.length;
  const pendingDmDrafts = dmDrafts.filter((draft) => !draft.approved);

  const action = statusFilter === "verification_needed" || statusFilter === "recommended"
    ? { mode: "duplicate" as const, label: "중복 확인 실행" }
    : statusFilter === "duplicate_passed"
      ? { mode: "instagram" as const, label: "최종 검증 실행" }
      : statusFilter === "final_verification"
        ? { mode: "dm" as const, label: "DM 준비" }
        : null;

  async function reloadCandidates(targetCategory: SearchCategory) {
    const response = await fetch(`/api/candidates?category=${targetCategory}`, { cache: "no-store" });
    const payload = await response.json() as CandidateListResponse & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "누적 후보를 불러오지 못했습니다.");
    setCandidates(payload.candidates);
    setSelectedVerificationHandles((current) => {
      const available = new Set(
        payload.candidates
          .filter((candidate) => getCandidateViewState(candidate) === "verification_needed")
          .map((candidate) => candidate.handle),
      );
      const next = new Set([...current].filter((handle) => available.has(handle)));
      return next.size === current.size ? current : next;
    });
    return payload.candidates;
  }

  async function reloadDmContacts(targetCategory: SearchCategory) {
    const response = await fetch(`/api/dm/contacts?category=${targetCategory}`, { cache: "no-store" });
    const payload = await response.json() as DmContactsResponse;
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? "발송 확인 목록 조회 실패");
    const contacts = payload.contacts ?? [];
    setDmContacts(contacts);
    return contacts;
  }

  async function fetchHistoryItems() {
    const response = await fetch(`/api/automation/run?category=${category}`, { cache: "no-store" });
    const payload = await response.json() as AutomationHistoryResponse;
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? "기록 조회 실패");
    return payload.items ?? [];
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      setHistoryItems(await fetchHistoryItems());
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "기록 조회 실패" });
    } finally {
      setHistoryLoading(false);
    }
  }

  async function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false);
      setExpandedHistoryId(null);
      return;
    }
    setHistoryOpen(true);
    await loadHistory();
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

  function selectVerificationBatch() {
    if (statusFilter !== "verification_needed") return;
    setSelectedVerificationHandles((current) => {
      const next = new Set(current);
      for (const candidate of filteredCandidates) {
        if (next.size >= 30) break;
        next.add(candidate.handle);
      }
      return next;
    });
  }

  function clearVerificationSelection() {
    setSelectedVerificationHandles(new Set());
  }

  function toggleVerificationSelection(handle: string) {
    setSelectedVerificationHandles((current) => {
      const next = new Set(current);
      if (next.has(handle)) {
        next.delete(handle);
        return next;
      }
      if (next.size >= 30) {
        setToast({ kind: "error", message: "중복 확인은 최대 30명까지 선택할 수 있습니다." });
        return current;
      }
      next.add(handle);
      return next;
    });
  }

  async function excludeCandidate(handle: string) {
    if ((statusFilter !== "verification_needed" && statusFilter !== "duplicate_passed") || deletingCandidateHandle) return;
    if (!window.confirm(`@${handle} 후보를 수동 제외할까요? 이후 후보 찾기에서도 다시 신규 후보로 나오지 않습니다.`)) return;

    setDeletingCandidateHandle(handle);
    setToast(null);
    try {
      const response = await fetch("/api/candidates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, handle, action: "manual_exclude" }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "수동 제외 저장 실패");

      setSelectedVerificationHandles((current) => {
        const next = new Set(current);
        next.delete(handle);
        return next;
      });
      await reloadCandidates(category);
      setToast({ kind: "success", message: `@${handle} 수동 제외 완료` });
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "수동 제외 저장 실패" });
    } finally {
      setDeletingCandidateHandle(null);
    }
  }

  async function runAutomation(mode: AutomationMode) {
    const handles = mode === "duplicate" && statusFilter === "verification_needed"
      ? filteredCandidates
          .filter((candidate) => selectedVerificationHandles.has(candidate.handle))
          .slice(0, 30)
          .map((candidate) => candidate.handle)
      : filteredCandidates.slice(0, 30).map((candidate) => candidate.handle);

    if (!handles.length) {
      setToast({
        kind: "error",
        message: statusFilter === "verification_needed" ? "검증 필요 후보를 먼저 선택하세요." : "현재 상태에서 실행할 후보가 없습니다.",
      });
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

      setWatchedAutomationJobId(payload.jobId ?? null);
      setAutomationWatchUntil(Date.now() + AUTOMATION_WATCH_MS);
      setHistoryOpen(false);
      setExpandedHistoryId(null);
      if (mode === "duplicate" && statusFilter === "verification_needed") {
        setSelectedVerificationHandles(new Set());
      }
      setToast({
        kind: "success",
        message: `${mode === "duplicate" ? "중복 확인" : "최종 검증"} 시작 · ${payload.candidateCount ?? handles.length}명`,
      });
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "OpenCode 자동 실행 실패" });
    } finally {
      setAutomationLoading(false);
    }
  }

  async function runDmPrepare(targetHandles?: string[], forceRegenerate = false) {
    const handles = targetHandles ?? filteredCandidates.slice(0, 30).map((candidate) => candidate.handle);
    if (!handles.length) {
      setToast({ kind: "error", message: "DM을 준비할 최종 검증 완료 후보가 없습니다." });
      return;
    }

    const invalidHandle = handles.find((handle) => handle !== normalizeHandle(handle) || !isValidHandle(handle) || handle.includes("\\"));
    if (invalidHandle) {
      setToast({ kind: "error", message: `실제 Instagram handle이 올바르지 않습니다: ${JSON.stringify(invalidHandle)}` });
      return;
    }

    const canReuseCurrentDrafts = !targetHandles
      && !forceRegenerate
      && dmDraftCategory === category
      && dmDrafts.some((draft) => !draft.approved)
      && sameHandleSet(handles, dmDrafts.map((draft) => draft.handle));

    if (canReuseCurrentDrafts) {
      setDmModalOpen(true);
      setToast({ kind: "success", message: `기존 DM 초안 ${dmDrafts.length}명 다시 열기 · LLM 재생성 없음` });
      return;
    }

    const singleHandle = targetHandles?.length === 1 ? targetHandles[0] : null;
    if (singleHandle) setDmRegeneratingHandle(singleHandle);
    else setDmLoading(true);
    setToast(null);

    try {
      const response = await fetch("/api/dm/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, handles, forceRegenerate }),
      });
      const payload = await response.json() as DmPrepareResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "DM 준비 실패");
      const items = payload.items ?? [];
      if (!items.length) throw new Error("생성된 DM 초안을 받지 못했습니다.");

      const invalidPreparedHandle = items.find((item) => item.handle !== normalizeHandle(item.handle) || !isValidHandle(item.handle) || item.handle.includes("\\"));
      if (invalidPreparedHandle) {
        throw new Error(`DM 준비 결과 handle이 올바르지 않습니다: ${JSON.stringify(invalidPreparedHandle.handle)}`);
      }

      setDmDraftCategory(category);
      if (singleHandle) {
        const replacement = items[0];
        setDmDrafts((current) => {
          const next = current.map((draft) => (
            draft.handle === singleHandle
              ? { ...replacement, translationDirty: false, approved: false }
              : draft
          ));
          setDmBulkJapaneseText(formatBulkDmText(next));
          return next;
        });
      } else {
        const nextDrafts = items.map((item) => ({ ...item, translationDirty: false, approved: false }));
        setDmDrafts(nextDrafts);
        setDmBulkJapaneseText(formatBulkDmText(nextDrafts));
        setDmReviewStep("edit");
        setDmParseError(null);
        setDmModalOpen(true);
      }

      const counts = payload.providerCounts ?? {};
      const details = [
        counts.groq ? `Groq ${counts.groq}` : null,
        counts.scaleway ? `Scaleway ${counts.scaleway}` : null,
        counts.fallback ? `고정 fallback ${counts.fallback}` : null,
      ].filter(Boolean).join(" · ");
      const resultMessage = payload.reused
        ? `기존 DM 초안 ${payload.preparedCount ?? items.length}명 복구 · LLM 재생성 없음`
        : `${singleHandle ? `@${singleHandle} DM 다시 생성` : `${forceRegenerate ? "DM 다시 생성" : "DM 준비"} ${payload.preparedCount ?? items.length}명 완료`}${details ? ` · ${details}` : ""}`;
      setToast({ kind: "success", message: resultMessage });
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "DM 준비 실패" });
    } finally {
      setDmLoading(false);
      setDmRegeneratingHandle(null);
    }
  }

  async function regenerateDmBatch() {
    if (!dmDrafts.length || dmLoading || dmReviewPreparing || dmApprovingHandle) return;
    if (!window.confirm(`현재 DM 초안 ${dmDrafts.length}명을 실제로 다시 생성할까요? Groq/Scaleway를 다시 호출합니다.`)) return;
    await runDmPrepare(dmDrafts.map((draft) => draft.handle), true);
  }

  async function requestDmTranslation(japaneseText: string) {
    const response = await fetch("/api/dm/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ japaneseText }),
    });
    const payload = await response.json() as DmContactsResponse;
    if (!response.ok || !payload.ok || !payload.koreanText) throw new Error(payload.error ?? "한국어 번역 갱신 실패");
    return payload.koreanText;
  }

  async function copyAllDmText() {
    try {
      await navigator.clipboard.writeText(dmBulkJapaneseText);
      setToast({ kind: "success", message: "전체 복사 완료" });
    } catch {
      setToast({ kind: "error", message: "클립보드 복사에 실패했습니다." });
    }
  }

  async function prepareDmFinalReview() {
    if (!dmDrafts.length || dmReviewPreparing || dmApprovingHandle) return;

    const parsed = parseBulkDmText(dmBulkJapaneseText, dmDrafts.map((draft) => draft.handle));
    if (!parsed.ok) {
      setDmParseError(parsed.error);
      setToast({ kind: "error", message: parsed.error });
      return;
    }

    setDmParseError(null);
    setDmReviewPreparing(true);
    setToast(null);

    let working = dmDrafts.map((draft) => {
      const japaneseText = parsed.messages.get(draft.handle) ?? "";
      return {
        ...draft,
        japaneseText,
        translationDirty: draft.translationDirty || japaneseText !== draft.japaneseText,
      };
    });
    setDmDrafts(working.map((item) => ({ ...item })));

    try {
      for (let index = 0; index < working.length; index += 1) {
        const draft = working[index];
        if (!draft.translationDirty) continue;
        setDmTranslatingHandle(draft.handle);
        const koreanText = await requestDmTranslation(draft.japaneseText);
        working[index] = { ...draft, koreanText, translationDirty: false };
        setDmDrafts(working.map((item) => ({ ...item })));
      }

      setDmTranslatingHandle(null);
      setDmDrafts(working.map((item) => ({ ...item })));
      setDmBulkJapaneseText(formatBulkDmText(working));
      setDmReviewStep("confirm");
      setToast({ kind: "success", message: "최종 확인 준비 완료 · 아직 OpenCode는 실행하지 않았습니다." });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "최종 일본어 기준 한국어 동기화 실패";
      setToast({ kind: "error", message });
    } finally {
      setDmTranslatingHandle(null);
      setDmReviewPreparing(false);
    }
  }

  async function approveAllDmDrafts() {
    if (dmReviewStep !== "confirm" || !dmDrafts.length || dmApprovingHandle) return;
    const pending = dmDrafts.filter((draft) => !draft.approved);
    if (!pending.length) return;

    const invalidHandle = pending.find((draft) => (
      draft.handle !== normalizeHandle(draft.handle)
      || !isValidHandle(draft.handle)
      || draft.handle.includes("\\")
    ));
    if (invalidHandle) {
      setToast({ kind: "error", message: `실제 Instagram handle이 올바르지 않습니다: ${JSON.stringify(invalidHandle.handle)}` });
      return;
    }
    if (new Set(pending.map((draft) => draft.handle)).size !== pending.length) {
      setToast({ kind: "error", message: "DM batch에 중복 Instagram handle이 있습니다." });
      return;
    }

    const emptyJapanese = pending.find((draft) => !draft.japaneseText.trim());
    if (emptyJapanese) {
      setToast({ kind: "error", message: `@${emptyJapanese.handle} 일본어 DM 원문이 비어 있습니다.` });
      return;
    }
    const emptyKorean = pending.find((draft) => !draft.koreanText.trim());
    if (emptyKorean) {
      setToast({ kind: "error", message: `@${emptyKorean.handle} 한국어 DM 해석이 비어 있습니다.` });
      return;
    }
    const dirty = pending.find((draft) => draft.translationDirty);
    if (dirty) {
      setToast({ kind: "error", message: `@${dirty.handle} 번역 동기화가 완료되지 않았습니다. 수정하기에서 다시 다음을 눌러주세요.` });
      return;
    }

    const approvalItems = pending.map((draft) => ({
      handle: draft.handle,
      japaneseText: draft.japaneseText,
      koreanText: draft.koreanText,
    }));
    const expectedCount = approvalItems.length;

    setDmApprovingHandle(BULK_APPROVAL_HANDLE);
    setToast(null);

    try {
      const response = await fetch("/api/dm/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, items: approvalItems }),
      });
      const payload = await response.json() as DmContactsResponse;
      const contacts = payload.contacts ?? [];
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? `DM batch 전송 준비 실패: ${contacts.length}/${expectedCount}명 승인`);
      }
      if (
        contacts.length !== expectedCount
        || payload.requestedCount !== expectedCount
        || payload.contactCount !== expectedCount
        || payload.candidateCount !== expectedCount
        || payload.launcherCount !== expectedCount
        || payload.promptCount !== expectedCount
        || payload.openCodeRunCount !== 1
      ) {
        throw new Error(
          `DM batch 수량 불일치: 화면 ${expectedCount} / 승인 ${contacts.length} / 요청 ${payload.requestedCount ?? "?"} / launcher ${payload.launcherCount ?? "?"} / prompt ${payload.promptCount ?? "?"} / OpenCode ${payload.openCodeRunCount ?? "?"}회`,
        );
      }

      const contactByHandle = new Map(contacts.map((contact) => [contact.handle, contact]));
      if (contactByHandle.size !== expectedCount || pending.some((draft) => !contactByHandle.has(draft.handle))) {
        throw new Error("DM batch 승인 contact handle이 화면 대상과 정확히 일치하지 않습니다.");
      }

      const working = dmDrafts.map((draft) => {
        const contact = contactByHandle.get(draft.handle);
        if (!contact) return draft;
        return {
          ...draft,
          japaneseText: contact.japaneseText,
          koreanText: contact.koreanText,
          translationDirty: false,
          approved: true,
        };
      });
      setDmDrafts(working);

      await reloadDmContacts(category);
      setToast({
        kind: "success",
        message: `OpenCode batch 시작 · ${expectedCount}명 · 승인 ${expectedCount} · launcher ${expectedCount} · prompt ${expectedCount} · OpenCode 1회 · 자동 전송 없음`,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "DM batch 전송 준비 실패";
      setToast({ kind: "error", message });
    } finally {
      setDmApprovingHandle(null);
    }
  }

  async function markDmSent(id: string) {
    try {
      const response = await fetch("/api/dm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json() as DmContactsResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "발송 완료 저장 실패");
      await reloadDmContacts(category);
      setToast({ kind: "success", message: "발송 완료로 기록했습니다." });
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "발송 완료 저장 실패" });
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
          <div className="candidate-summary-inline" aria-label="누적 후보 요약">
            {listLoading ? (
              <span className="summary-loading">누적 후보 불러오는 중…</span>
            ) : (
              <>
                <span className="summary-group-label">후보</span>
                <span className="summary-chip">전체 <strong>{visibleCandidates.length}</strong></span>
                <span className="summary-chip">검증 필요 <strong>{verificationNeededTotal}</strong></span>
                <span className="summary-chip">추천 <strong>{recommendedTotal}</strong></span>
                <span className="summary-group-spacer" aria-hidden="true" />
                <span className="summary-group-label">진행</span>
                <span className="summary-chip">중복 통과 <strong>{duplicatePassedTotal}</strong></span>
                <span className="summary-chip">최종 <strong>{finalVerificationTotal}</strong></span>
                <span className="summary-chip">발송 <strong>{sendReadyContacts.length}</strong></span>
                <span className="summary-chip">제외 <strong>{excludedTotal}</strong></span>
              </>
            )}
          </div>
          <div className="control-actions">
            <div className="history-control">
              <button className="history-button" onClick={toggleHistory} aria-expanded={historyOpen}>기록</button>
              {historyOpen && (
                <div className="history-popover" style={{ width: 470, maxHeight: 500, overflowY: "auto" }}>
                  <strong>처리 기록</strong>
                  {historyLoading ? (
                    <div className="history-empty">불러오는 중…</div>
                  ) : historyItems.length ? (
                    historyItems.map((item) => {
                      const expanded = expandedHistoryId === item.id;
                      return (
                        <button
                          type="button"
                          className="history-item"
                          key={item.id}
                          aria-expanded={expanded}
                          onClick={() => setExpandedHistoryId(expanded ? null : item.id)}
                          style={{
                            display: "block",
                            width: "100%",
                            borderTop: 0,
                            borderLeft: 0,
                            borderRight: 0,
                            background: "transparent",
                            color: "inherit",
                            cursor: "pointer",
                            font: "inherit",
                            textAlign: "left",
                            whiteSpace: "normal",
                          }}
                        >
                          <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                            <span style={{ color: item.status === "failed" ? "#dc2626" : "#333d4b", fontWeight: 800 }}>{historyTitle(item)}</span>
                            <span style={{ color: "#8b95a1", fontSize: 11, flex: "0 0 auto" }}>{historyTime(item)}</span>
                          </span>
                          <span style={{ display: "block", marginTop: 3, color: "#6b7684", lineHeight: 1.45 }}>{historyResultLine(item)}</span>
                          {expanded && <HistoryDetail item={item} />}
                        </button>
                      );
                    })
                  ) : (
                    <div className="history-empty">아직 실행 기록이 없습니다.</div>
                  )}
                </div>
              )}
            </div>
            <button className="primary" onClick={runDiscovery} disabled={loading}>{loading ? "찾는 중…" : candidates.length ? "+ 추가 찾기" : "후보 찾기"}</button>
          </div>
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
          <div className="results-left">
            <strong className="results-title">누적 후보</strong>
            <div className="results-workspace">
              <div className="verification-selection-slot">
                {statusFilter === "verification_needed" && (
                  <>
                    <button
                      className="secondary"
                      type="button"
                      onClick={selectVerificationBatch}
                      disabled={automationLoading || !filteredCandidates.length || selectedVerificationHandles.size >= 30}
                      style={{ padding: "7px 10px", fontSize: 12 }}
                    >30명 선택</button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={clearVerificationSelection}
                      disabled={automationLoading || selectedVerificationHandles.size === 0}
                      style={{ padding: "7px 10px", fontSize: 12 }}
                    >선택 해제</button>
                    <span style={{ color: "#6b7684", fontSize: 12 }}>{selectedVerificationHandles.size}/30</span>
                  </>
                )}
              </div>
              <div style={{ width: ACTION_SLOT_WIDTH, flex: `0 0 ${ACTION_SLOT_WIDTH}px` }}>
                {action && (
                  <button
                    className={`secondary action-button ${action.mode === "dm" ? dmStyles.dmActionButton : ""}`}
                    style={{
                      width: "100%",
                      whiteSpace: "nowrap",
                      ...(action.mode === "instagram" ? { background: "#dc2626" } : {}),
                    }}
                    onClick={() => action.mode === "dm" ? runDmPrepare() : runAutomation(action.mode)}
                    disabled={
                      automationLoading
                      || dmLoading
                      || (statusFilter === "verification_needed" && action.mode === "duplicate"
                        ? selectedVerificationHandles.size === 0
                        : !filteredCandidates.length)
                    }
                  >
                    {action.mode === "dm" && dmLoading ? "생성 중…" : automationLoading ? "실행 중…" : action.label}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="results-tabs">
            <div className="mini-segment" aria-label="상태 필터">
              <button className={statusFilter === "all" ? "active" : ""} onClick={() => setStatusFilter("all")}>전체</button>
              <button className={statusFilter === "verification_needed" ? "active" : ""} onClick={() => setStatusFilter("verification_needed")}>검증 필요</button>
              <button className={statusFilter === "recommended" ? "active" : ""} onClick={() => setStatusFilter("recommended")}>추천 후보</button>
              <span className="filter-separator" style={{ margin: "0 9.6px" }} aria-hidden="true">ㅣ</span>
              <button className={statusFilter === "duplicate_passed" ? "active" : ""} onClick={() => setStatusFilter("duplicate_passed")}>중복 통과</button>
              <button className={statusFilter === "final_verification" ? "active" : ""} onClick={() => setStatusFilter("final_verification")}>최종 검증 완료</button>
              <button className={statusFilter === "send_confirmation" ? "active" : ""} onClick={() => setStatusFilter("send_confirmation")}>발송 확인</button>
            </div>
          </div>
        </div>

        {statusFilter === "send_confirmation" ? (
          <SendConfirmationTable contacts={sendReadyContacts} loading={dmContactsLoading} onSent={markDmSent} />
        ) : filteredCandidates.length ? (
          <CandidateTable
            candidates={filteredCandidates}
            getState={candidateState}
            selectable={statusFilter === "verification_needed"}
            deletable={statusFilter === "verification_needed" || statusFilter === "duplicate_passed"}
            selectedHandles={selectedVerificationHandles}
            onToggleSelection={toggleVerificationSelection}
            onDelete={excludeCandidate}
            deletingHandle={deletingCandidateHandle}
          />
        ) : <div className="empty">{listLoading ? "누적 후보를 불러오는 중입니다." : "현재 조건의 누적 후보가 없습니다."}</div>}
      </section>

      {dmModalOpen && dmDrafts.length > 0 && (
        <div
          className={dmStyles.backdrop}
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <section className={dmStyles.modal} role="dialog" aria-modal="true" aria-label={`DM 준비 · ${dmDrafts.length}명`}>
            <div className={dmStyles.modalHead}>
              <div className={dmStyles.modalTitle}>
                <strong>{dmReviewStep === "edit" ? "DM 준비" : "DM 최종 확인"}</strong>
                <span>· {dmDrafts.length}명</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  className="secondary"
                  type="button"
                  onClick={regenerateDmBatch}
                  disabled={dmLoading || dmReviewPreparing || Boolean(dmApprovingHandle)}
                  style={{ padding: "6px 10px", fontSize: 12, whiteSpace: "nowrap" }}
                >{dmLoading ? "재생성 중…" : "다시 생성"}</button>
                <button
                  className={dmStyles.closeButton}
                  type="button"
                  aria-label="닫기"
                  onClick={() => setDmModalOpen(false)}
                  disabled={dmLoading || dmReviewPreparing || Boolean(dmApprovingHandle)}
                >×</button>
              </div>
            </div>

            {dmReviewStep === "edit" ? (
              <>
                <div className={dmStyles.reviewHead}>
                  <div className={dmStyles.reviewHeadCell}>
                    <strong>일본어 전체</strong>
                    <button className="secondary" type="button" onClick={copyAllDmText}>전체 복사</button>
                  </div>
                  <div className={dmStyles.reviewHeadCell}>
                    <strong>한국어 전체</strong>
                    <span className={dmStyles.readOnlyLabel}>다음 클릭 시 변경 후보만 갱신</span>
                  </div>
                </div>

                <div className={dmStyles.reviewBody}>
                  <div className={dmStyles.bulkEditor}>
                    <textarea
                      className={dmStyles.bulkTextarea}
                      aria-label="일본어 전체 DM 편집"
                      value={dmBulkJapaneseText}
                      disabled={dmReviewPreparing || Boolean(dmApprovingHandle)}
                      onChange={(event) => {
                        setDmBulkJapaneseText(event.target.value);
                        if (dmParseError) setDmParseError(null);
                      }}
                      spellCheck={false}
                    />
                    {dmParseError && <div className={dmStyles.parseError}>{dmParseError}</div>}
                  </div>

                  <div className={`${dmStyles.reviewStream} ${dmStyles.translationStream}`}>
                    {dmDrafts.map((draft) => (
                      <div className={dmStyles.reviewItem} key={`ko-${draft.handle}`}>
                        <div className={dmStyles.translationHead}>
                          <strong className={dmStyles.streamHandle}>@{draft.handle}</strong>
                          <span className={dmStyles.translationPending}>
                            {dmTranslatingHandle === draft.handle ? "번역 갱신 중…" : ""}
                          </span>
                        </div>
                        <div className={dmStyles.streamTranslation}>{draft.koreanText}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={dmStyles.footer}>
                  <button
                    className={dmStyles.passButton}
                    type="button"
                    onClick={prepareDmFinalReview}
                    disabled={dmReviewPreparing || Boolean(dmApprovingHandle)}
                  >
                    {dmReviewPreparing ? "확인 준비 중…" : "다음"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={dmStyles.confirmBody}>
                  <div className={dmStyles.launcherSummary}>
                    <strong>OpenCode 실행 방식</strong>
                    <code>PowerShell/OpenCode 창 1개 · opencode run 1회 · 이번 대상 {pendingDmDrafts.length}명을 후보별 별도 Instagram 탭에 입력 · 실제 Send 0회</code>
                    <span>후보 1명이 실패해도 해당 결과만 failed로 기록하고 가능한 나머지 후보는 계속 처리합니다.</span>
                  </div>

                  {pendingDmDrafts.length > 0 ? (
                    <details className={dmStyles.promptDetails}>
                      <summary>OpenCode 전체 프롬프트 확인 · {pendingDmDrafts.length}명</summary>
                      <pre className={dmStyles.promptPreview}>{buildDmBatchInputPrompt(pendingDmDrafts.map((draft) => ({
                        contactId: `<전송 시 @${draft.handle} 승인 ID>`,
                        handle: draft.handle,
                        approvedJapaneseText: draft.japaneseText,
                      })))}</pre>
                    </details>
                  ) : (
                    <div className={dmStyles.launcherSummary}>추가 OpenCode 대상이 없습니다. 현재 초안은 이미 전송 준비 처리되었습니다.</div>
                  )}

                  <div className={dmStyles.confirmLabel}>이번 전송 대상 {pendingDmDrafts.length}명</div>
                  {pendingDmDrafts.map((draft) => (
                    <section className={dmStyles.confirmItem} key={`confirm-${draft.handle}`}>
                      <strong className={dmStyles.confirmHandle}>@{draft.handle}</strong>
                      <pre className={dmStyles.confirmDm}>{draft.japaneseText}</pre>
                    </section>
                  ))}
                </div>

                <div className={dmStyles.footer}>
                  <button
                    className={dmStyles.secondaryFooterButton}
                    type="button"
                    onClick={() => setDmReviewStep("edit")}
                    disabled={Boolean(dmApprovingHandle)}
                  >수정하기</button>
                  <button
                    className={dmStyles.passButton}
                    type="button"
                    onClick={approveAllDmDrafts}
                    disabled={Boolean(dmApprovingHandle) || pendingDmDrafts.length === 0}
                  >
                    {pendingDmDrafts.length === 0
                      ? "전송 준비 완료"
                      : dmApprovingHandle === BULK_APPROVAL_HANDLE
                        ? `OpenCode batch ${pendingDmDrafts.length}명 실행 중…`
                        : `전송 · ${pendingDmDrafts.length}명`}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
    </>
  );
}

function CandidateTable({
  candidates,
  getState,
  selectable,
  deletable,
  selectedHandles,
  onToggleSelection,
  onDelete,
  deletingHandle,
}: {
  candidates: DiscoveryCandidate[];
  getState: (candidate: DiscoveryCandidate) => CandidateViewState;
  selectable: boolean;
  deletable: boolean;
  selectedHandles: Set<string>;
  onToggleSelection: (handle: string) => void;
  onDelete: (handle: string) => void;
  deletingHandle: string | null;
}) {
  return (
    <div className="table-wrap">
      <table className="candidate-table">
        <thead>
          <tr>
            <th className="candidate-selection-col">{selectable ? "선택" : ""}</th>
            <th className="candidate-instagram-col">Instagram</th>
            <th>상태</th>
            <th>팔로워 / Reels</th>
            <th>확인 근거</th>
            <th>App 검증</th>
            <th>검증</th>
            <th className="candidate-exclusion-col">{deletable ? "제외" : ""}</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => {
            const state = getState(candidate);
            const summary = evidenceSummary(candidate);
            return (
              <tr key={candidate.handle} className={state === "verification_needed" || state === "unmapped" ? "review-row" : ""}>
                <td className="candidate-selection-col">
                  {selectable && (
                    <input
                      type="checkbox"
                      aria-label={`@${candidate.handle} 선택`}
                      checked={selectedHandles.has(candidate.handle)}
                      onChange={() => onToggleSelection(candidate.handle)}
                      disabled={Boolean(deletingHandle)}
                    />
                  )}
                </td>
                <td className="candidate-instagram-col"><div className="handle">@{candidate.handle}</div><a className="link" href={candidate.profileUrl} target="_blank" rel="noreferrer">프로필 열기 ↗</a></td>
                <td><CandidateStateBadges state={state} candidate={candidate} /></td>
                <td className="status">{metricLabel(candidate)}</td>
                <td><div className="evidence-one-line" title={summary}>{summary}</div></td>
                <td className="status">{duplicateLabel(candidate)}</td>
                <td className="status">{verificationLabel(candidate)}</td>
                <td className="candidate-exclusion-col">
                  {deletable && (
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => onDelete(candidate.handle)}
                      disabled={Boolean(deletingHandle)}
                      style={{ padding: "5px 8px", fontSize: 11, whiteSpace: "nowrap" }}
                    >{deletingHandle === candidate.handle ? "처리 중" : "삭제"}</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SendConfirmationTable({
  contacts,
  loading,
  onSent,
}: {
  contacts: DmContact[];
  loading: boolean;
  onSent: (id: string) => void;
}) {
  if (loading) return <div className="empty">발송 확인 목록을 불러오는 중입니다.</div>;
  if (!contacts.length) return <div className="empty">현재 발송 대기 중인 DM이 없습니다.</div>;

  return (
    <div className="table-wrap">
      <table className="send-confirmation-table">
        <thead><tr><th>Instagram</th><th>일본어 원문</th><th>상태</th><th>확인</th></tr></thead>
        <tbody>
          {contacts.map((contact) => (
            <tr key={contact.id}>
              <td>
                <div className="handle">@{contact.handle}</div>
                <a className="link" href={`https://www.instagram.com/${contact.handle}/`} target="_blank" rel="noreferrer">프로필 열기 ↗</a>
              </td>
              <td><div className={dmStyles.sendText}>{contact.japaneseText}</div></td>
              <td><span className={dmStyles.sendStatus}>발송 대기</span></td>
              <td><button className="secondary" type="button" onClick={() => onSent(contact.id)}>발송 완료</button></td>
            </tr>
          ))}
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
  const sourceState = getSearchStageViewState(candidate);
  if (sourceState === "recommended") return { label: "추천 후보", tone: "recommended" };
  if (sourceState === "verification_needed") return { label: "검증 필요", tone: "review" };
  return null;
}

function historyTitle(item: AutomationHistoryItem) {
  const action = item.mode === "duplicate" ? "중복 확인" : "최종 검증";
  if (item.status === "pending") return `${action} ${item.processedCount}/${item.candidateCount} 진행 중`;
  if (item.status === "failed") return `${action} ${item.processedCount}/${item.candidateCount} 실패`;
  return `${action} ${item.candidateCount}명 완료`;
}

function historyResultLine(item: AutomationHistoryItem) {
  if (item.status === "pending") {
    return item.processedCount > 0 ? `현재 ${item.processedCount}명 결과 저장 완료` : "첫 결과를 기다리는 중입니다.";
  }
  if (item.status === "failed") return item.failureMessage ?? "작업이 완료 전에 중단되었습니다.";
  if (!item.groups.length) return "처리 결과가 없습니다.";
  return item.groups.map((group) => `${group.destination} ${group.handles.length}`).join(" · ");
}

function historyTime(item: AutomationHistoryItem) {
  const value = item.status === "completed" ? item.completedAt : item.status === "failed" ? item.failedAt : null;
  if (!value) return "";
  const time = new Date(value);
  const now = new Date();
  const clock = `${pad2(time.getHours())}:${pad2(time.getMinutes())}`;
  const today = time.getFullYear() === now.getFullYear()
    && time.getMonth() === now.getMonth()
    && time.getDate() === now.getDate();
  return today ? clock : `${time.getMonth() + 1}/${time.getDate()} ${clock}`;
}

function automationCompletionMessage(item: AutomationHistoryItem, currentCandidates: DiscoveryCandidate[]) {
  const action = item.mode === "duplicate" ? "중복 확인" : "최종 검증";
  if (item.status === "failed") return `${action} 실패 · ${item.failureMessage ?? "작업이 완료되지 않았습니다."}`;

  if (item.mode === "instagram") {
    const targetHandles = new Set(item.groups.flatMap((group) => group.handles));
    let first = 0;
    let second = 0;
    let third = 0;
    for (const candidate of currentCandidates) {
      if (!targetHandles.has(candidate.handle) || candidate.verificationStatus !== "verified") continue;
      const note = candidate.verificationNote ?? "";
      if (note.startsWith("1순위")) first += 1;
      else if (note.startsWith("2순위")) second += 1;
      else if (note.startsWith("3순위")) third += 1;
    }
    const priorityParts = [
      first ? `1순위 ${first}` : null,
      second ? `2순위 ${second}` : null,
      third ? `3순위 ${third}` : null,
    ].filter(Boolean) as string[];
    const otherParts = item.groups
      .filter((group) => group.destination !== "최종 검증 완료")
      .map((group) => `${group.destination} ${group.handles.length}`);
    const details = [...priorityParts, ...otherParts].join(" / ");
    return `최종 검증 ${item.candidateCount}명 완료${details ? ` · ${details}` : ""}`;
  }

  const details = item.groups.map((group) => `${group.destination} ${group.handles.length}`).join(" / ");
  return `중복 확인 ${item.candidateCount}명 완료${details ? ` · ${details}` : ""}`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function HistoryDetail({ item }: { item: AutomationHistoryItem }) {
  if (item.status === "pending") return null;
  return (
    <span style={{ display: "block", marginTop: 10, paddingTop: 9, borderTop: "1px solid #edf0f2" }}>
      <span style={{ display: "block", marginBottom: 7, color: "#6b7684", fontSize: 11 }}>
        {historyTime(item)} · 저장 {item.processedCount}/{item.candidateCount}명
      </span>
      {item.status === "failed" && item.failureMessage && (
        <span style={{ display: "block", marginBottom: 7, color: "#dc2626", lineHeight: 1.45 }}>
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

function formatBulkDmText(drafts: Array<Pick<DmDraft, "handle" | "japaneseText">>) {
  return drafts.map((draft) => `@${draft.handle}\n${draft.japaneseText}`).join("\n\n");
}

function sameHandleSet(first: string[], second: string[]) {
  if (first.length !== second.length) return false;
  const firstSet = new Set(first);
  const secondSet = new Set(second);
  if (firstSet.size !== first.length || secondSet.size !== second.length) return false;
  return first.every((handle) => secondSet.has(handle));
}

function dmSessionKey(category: SearchCategory) {
  return `${DM_SESSION_KEY_PREFIX}${category}`;
}

function readDmSession(category: SearchCategory): StoredDmSession | null {
  try {
    const raw = window.sessionStorage.getItem(dmSessionKey(category));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredDmSession>;
    if (value.version !== 1 || value.category !== category || !Array.isArray(value.drafts) || !value.drafts.length) return null;
    if (value.reviewStep !== "edit" && value.reviewStep !== "confirm") return null;

    const drafts: DmDraft[] = [];
    for (const item of value.drafts) {
      if (!item || typeof item !== "object") return null;
      const draft = item as Partial<DmDraft>;
      if (
        typeof draft.handle !== "string"
        || draft.handle !== normalizeHandle(draft.handle)
        || !isValidHandle(draft.handle)
        || draft.handle.includes("\\")
        || typeof draft.japaneseText !== "string"
        || typeof draft.koreanText !== "string"
        || typeof draft.generatedAt !== "string"
        || typeof draft.provider !== "string"
        || typeof draft.model !== "string"
        || typeof draft.translationDirty !== "boolean"
        || typeof draft.approved !== "boolean"
      ) {
        return null;
      }
      drafts.push(draft as DmDraft);
    }
    if (new Set(drafts.map((draft) => draft.handle)).size !== drafts.length) return null;

    return {
      version: 1,
      category,
      drafts,
      bulkJapaneseText: typeof value.bulkJapaneseText === "string" ? value.bulkJapaneseText : formatBulkDmText(drafts),
      reviewStep: value.reviewStep,
    };
  } catch {
    return null;
  }
}

function parseBulkDmText(value: string, expectedHandles: string[]): BulkDmParseResult {
  const normalized = value.replace(/\r\n?/g, "\n");
  const expected = new Set(expectedHandles.map((handle) => handle.toLowerCase()));
  const messages = new Map<string, string>();
  const lines = normalized.split("\n");
  let currentHandle: string | null = null;
  let currentBody: string[] = [];
  let prefixHasContent = false;

  const commitCurrent = (): BulkDmParseResult | null => {
    if (!currentHandle) return null;
    const bodyLines = [...currentBody];
    while (bodyLines.length && bodyLines[0] === "") bodyLines.shift();
    while (bodyLines.length && bodyLines[bodyLines.length - 1] === "") bodyLines.pop();
    const body = bodyLines.join("\n");
    if (!body.trim()) {
      return { ok: false, error: `DM 본문이 비어 있습니다: @${currentHandle}` };
    }
    if (messages.has(currentHandle)) {
      return { ok: false, error: `중복 handle이 있습니다: @${currentHandle}` };
    }
    messages.set(currentHandle, body);
    return null;
  };

  for (const line of lines) {
    const handleMatch = line.match(/^\s*@([A-Za-z0-9._]{1,80})\s*$/);
    if (handleMatch) {
      const previousError = commitCurrent();
      if (previousError) return previousError;

      const handle = handleMatch[1].toLowerCase();
      if (!expected.has(handle)) {
        return { ok: false, error: `선택된 후보에 없는 handle입니다: @${handle}` };
      }
      if (messages.has(handle)) {
        return { ok: false, error: `중복 handle이 있습니다: @${handle}` };
      }
      currentHandle = handle;
      currentBody = [];
      continue;
    }

    if (!currentHandle) {
      if (line.trim()) prefixHasContent = true;
      continue;
    }
    currentBody.push(line);
  }

  const finalError = commitCurrent();
  if (finalError) return finalError;

  if (prefixHasContent) {
    return { ok: false, error: "첫 @handle 앞에 분리할 수 없는 내용이 있습니다. 전체 텍스트는 @handle 줄부터 시작해야 합니다." };
  }
  if (!messages.size) {
    return { ok: false, error: `@handle 구분자를 찾지 못했습니다. 필요한 후보: ${expectedHandles.map((handle) => `@${handle}`).join(", ")}` };
  }

  const missing = expectedHandles.filter((handle) => !messages.has(handle.toLowerCase()));
  if (missing.length) {
    return { ok: false, error: `선택된 후보가 빠졌습니다: ${missing.map((handle) => `@${handle}`).join(", ")}` };
  }

  return { ok: true, messages };
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
  return `${koreaEvidenceLabel(candidate)} · ${contentFitLabel(candidate)} · ${coreDecisionLabel(candidate)}`;
}

function koreaEvidenceLabel(candidate: DiscoveryCandidate) {
  if (candidate.koreaAffinity === "none") return "한국 접점 없음";
  if (candidate.koreaAffinity === "unknown") return "한국 접점 미확인";
  if (candidate.targetSignals.includes("일한 배경")) return "한일부부/한일 배경";
  if (candidate.koreaSignals.includes("한국 거주")) return "한국 거주";
  if (candidate.koreaSignals.includes("방한")) return candidate.koreaAffinity === "strong" ? "반복 방한" : "한국 방문 확인";
  if (candidate.koreaSignals.includes("한국 여행")) return "한국 방문 확인";
  return candidate.koreaAffinity === "strong" ? "한국 접점 강함" : "한국 접점 확인";
}

function contentFitLabel(candidate: DiscoveryCandidate) {
  if (candidate.contentFit === "beauty") return "뷰티";
  if (candidate.contentFit === "food") return "맛집";
  if (candidate.contentFit === "korea_travel") return "한국 여행";
  if (candidate.contentFit === "lifestyle") return "라이프";
  return "콘텐츠 미확인";
}

function coreDecisionLabel(candidate: DiscoveryCandidate) {
  if (candidate.accountAvailability === "unavailable") return "계정 없음";
  if (candidate.accountAvailability === "unknown") return "계정 존재 추가 확인";
  if (candidate.accountType === "business") return "개인 KOL 아님";
  if (candidate.accountType === "unknown") return "개인 크리에이터 여부 확인 필요";
  if (candidate.koreaAffinity === "none") return "한국 접점 없음";
  if (candidate.koreaAffinity === "unknown") return "한국 접점 추가 검증 필요";
  if (candidate.eligibility === "fail") return "현재 후보 조건 부적합";
  if (candidate.contentFit !== candidate.category) return `${candidate.category === "beauty" ? "뷰티" : "맛집"} 적합성 추가 확인`;
  if (candidate.eligibility === "possible") return candidate.category === "beauty" ? "K뷰티 콘텐츠 적합" : "한국 맛집 콘텐츠 적합";
  return "추가 검증 필요";
}

function metricLabel(candidate: DiscoveryCandidate) {
  const rawFollowers = candidate.followers === null ? "-" : candidate.followers.toLocaleString();
  const followers = candidate.followers !== null && candidate.followersSource === "search"
    ? `${rawFollowers} (검색 참고)`
    : rawFollowers;
  if (candidate.reelAverage === null) return candidate.followers === null ? "실측 대기" : `${followers} / Reels -`;
  const checked = candidate.reelCheckedCount ?? candidate.reelSampleSize ?? 0;
  const total = candidate.reelTotalConsidered ?? checked;
  const suffix = candidate.reelMetricsStatus === "insufficient" ? " · 표본 부족" : "";
  return `${followers} / 평균 ${candidate.reelAverage.toLocaleString()} (${checked}/${total})${suffix}`;
}

function duplicateLabel(candidate: DiscoveryCandidate) {
  if (candidate.duplicateCheckStatus === "available") {
    const state = getCandidateViewState(candidate);
    return state === "duplicate_passed" || state === "final_verification" || state === "dm_ready" ? "진행 가능" : "미등록";
  }
  if (candidate.duplicateCheckStatus === "duplicate") return "이미 등록됨";
  if (candidate.duplicateCheckStatus === "protected") return "보호 목록";
  if (candidate.duplicateCheckStatus === "unknown") return "확인 불가";
  return "미확인";
}

function verificationLabel(candidate: DiscoveryCandidate) {
  if (candidate.verificationStatus === "verified") return "검증 완료";
  if (candidate.verificationStatus === "insufficient") return "일부 확인불가";
  return "실측 대기";
}
