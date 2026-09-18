"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isValidHandle, normalizeHandle } from "@/lib/discovery/instagram";
import { getCandidateViewState, getSearchStageViewState, type CandidateViewState } from "@/lib/discovery/presentation";
import type { CandidateListResponse, DiscoveryCandidate, DiscoveryResponse, SearchCategory } from "@/lib/discovery/types";
import { selectLatestDmContactByHandle } from "@/lib/dm/contact-history";
import { sortByEventTimestampDesc } from "@/lib/automation/history-order";
import { formatBulkDmText, isJapaneseDmText, parseBulkDmText, repairLegacyBulkDmHandles } from "@/lib/dm/bulk-text";
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

type OpenCodeModelPreset = "A" | "B" | "C" | "D";

type ModelPresetResponse = {
  ok: boolean;
  activePreset?: OpenCodeModelPreset;
  presets?: Array<{ id: OpenCodeModelPreset; models: string[] }>;
  error?: string;
};

type ApiConnection = {
  id: string;
  label: string;
  group: "search" | "google-search" | "opencode";
  requirement: "required-one-of" | "recommended" | "optional";
  requirementLabel: string;
  note: string;
  connected: boolean;
  storage: "env.local" | "opencode";
};

type AutomationSettingsResponse = {
  ok: boolean;
  connections?: ApiConnection[];
  error?: string;
};

type DmPreparedItem = {
  handle: string;
  japaneseText: string;
  generatedAt: string;
  provider: string;
  model: string;
};

type DmDraft = DmPreparedItem & {
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
  generatedAt: string;
  approvedAt: string;
  openCodeStatus: "pending" | "success" | "failed";
  openCodeCompletedAt: string | null;
  openCodeError: string | null;
  sentAt: string | null;
  createdAt: string;
};

type DmContactsResponse = {
  ok: boolean;
  contacts?: DmContact[];
  contact?: DmContact;
  processId?: number;
  candidateCount?: number;
  requestedCount?: number;
  contactCount?: number;
  launcherCount?: number;
  promptCount?: number;
  openCodeRunCount?: number;
  error?: string;
};

type DmSyncStatus = {
  ok: boolean; running: boolean; status?: "idle" | "running" | "completed" | "failed";
  pendingCount?: number; processedCount?: number; candidateCount?: number; sentCount?: number;
  notSentCount?: number; uncertainCount?: number; startedAt?: string | null; updatedAt?: string | null;
  failureMessage?: string | null; error?: string;
};

type AutomationHistoryGroup = {
  destination: string;
  handles: string[];
  reasons: Array<{ handle: string; reason: string }>;
};

type AutomationHistoryItem = {
  id: string;
  mode: AutomationMode | "discovery";
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
  runNo?: number;
  discoverySummary?: string;
};

type AutomationHistoryResponse = {
  ok: boolean;
  items?: AutomationHistoryItem[];
  error?: string;
};

type PlannedVisitItem = {
  id: string; candidateId: string | null; instagramHandle: string; plannedFor: string; memo: string;
  reminderAt: string; reminderSeenAt: string | null; createdAt: string; updatedAt: string;
};
type PlannedResponse = { ok: boolean; items?: PlannedVisitItem[]; item?: PlannedVisitItem; dueCount?: number; error?: string };
type PlannedForm = { instagramHandle: string; plannedFor: string; memo: string };

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
  "신규 후보 저장 중",
];

const RECOMMENDED_BADGE_STYLE = { color: "#d6336c", background: "#fff0f6" };
const DUPLICATE_PENDING_BADGE_STYLE = { color: "#6b7684", background: "#f2f4f6" };
const ACTION_SLOT_WIDTH = 118;
const AUTOMATION_WATCH_MS = 3 * 60 * 60 * 1000;
const BULK_APPROVAL_HANDLE = "__all__";
const DM_SESSION_KEY_PREFIX = "fixup-scout:dm-session:v1:";
const DM_AUTO_SYNC_RECENT_MS = 3 * 60 * 60 * 1000;
const MODEL_PRESET_IDS: OpenCodeModelPreset[] = ["A", "B", "C", "D"];
const MODEL_PRESET_LABELS: Record<OpenCodeModelPreset, string> = {
  A: "Spark 우선",
  B: "Nemotron 우선",
  C: "GLM 우선",
  D: "B.AI 우선",
};

export function DiscoveryConsole() {
  const [category, setCategory] = useState<SearchCategory>("beauty");
  const [targetCount, setTargetCount] = useState(50);
  const [health, setHealth] = useState<Health | null>(null);
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmRegeneratingHandle, setDmRegeneratingHandle] = useState<string | null>(null);
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
  const [dmSyncing, setDmSyncing] = useState(false);
  const [dmSyncStatus, setDmSyncStatus] = useState<DmSyncStatus | null>(null);
  const [dmSyncWatchUntil, setDmSyncWatchUntil] = useState<number | null>(null);
  const dmSyncInFlightRef = useRef(false);
  const dmSyncCooldownUntilRef = useRef(0);
  const [listLoading, setListLoading] = useState(false);
  const [progressStage, setProgressStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [discoverySummary, setDiscoverySummary] = useState<string | null>(null);
  const [googleDiscoverySummary, setGoogleDiscoverySummary] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [automationWatchUntil, setAutomationWatchUntil] = useState<number | null>(null);
  const [watchedAutomationJobId, setWatchedAutomationJobId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<AutomationHistoryItem[]>([]);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [selectedVerificationHandles, setSelectedVerificationHandles] = useState<Set<string>>(() => new Set());
  const [selectedSendConfirmationIds, setSelectedSendConfirmationIds] = useState<Set<string>>(() => new Set());
  const [sendConfirmationMoving, setSendConfirmationMoving] = useState(false);
  const [deletingCandidateHandle, setDeletingCandidateHandle] = useState<string | null>(null);

  const [modelPreset, setModelPreset] = useState<OpenCodeModelPreset>("A");
  const [modelPresetDraft, setModelPresetDraft] = useState<OpenCodeModelPreset>("A");
  const [modelPresetOpen, setModelPresetOpen] = useState(false);
  const [modelPresetSaving, setModelPresetSaving] = useState(false);
  const [apiConnectionsOpen, setApiConnectionsOpen] = useState(false);
  const [apiConnectionsLoading, setApiConnectionsLoading] = useState(false);
  const [apiConnections, setApiConnections] = useState<ApiConnection[]>([]);
  const [apiConnectionDrafts, setApiConnectionDrafts] = useState<Record<string, string>>({});
  const [apiConnectionSavingId, setApiConnectionSavingId] = useState<string | null>(null);
  const [plannedOpen, setPlannedOpen] = useState(false);
  const [plannedLoading, setPlannedLoading] = useState(false);
  const [plannedItems, setPlannedItems] = useState<PlannedVisitItem[]>([]);
  const [plannedDueCount, setPlannedDueCount] = useState(0);
  const [plannedAdding, setPlannedAdding] = useState(false);
  const [plannedSaving, setPlannedSaving] = useState(false);
  const [plannedEditingId, setPlannedEditingId] = useState<string | null>(null);
  const [plannedForm, setPlannedForm] = useState<PlannedForm>({ instagramHandle: "", plannedFor: "", memo: "" });
  const [plannedEditForm, setPlannedEditForm] = useState({ plannedFor: "", memo: "" });

  useEffect(() => {
    fetch("/api/health")
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ payload }) => setHealth(payload))
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/automation/model-preset", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as ModelPresetResponse;
        if (!response.ok || !payload.ok || !payload.activePreset) {
          throw new Error(payload.error ?? "모델 순서를 불러오지 못했습니다.");
        }
        return payload.activePreset;
      })
      .then((preset) => {
        if (!cancelled) {
          setModelPreset(preset);
          setModelPresetDraft(preset);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModelPreset("A");
          setModelPresetDraft("A");
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/planned", { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() as PlannedResponse }))
      .then(({ response, payload }) => {
        if (!response.ok || !payload.ok) throw new Error(payload.error ?? "예정 목록 조회 실패");
        if (!cancelled) { setPlannedItems(payload.items ?? []); setPlannedDueCount(payload.dueCount ?? 0); }
      })
      .catch(() => { if (!cancelled) { setPlannedItems([]); setPlannedDueCount(0); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setStatusFilter("all");
    setHistoryOpen(false);
    setHistoryItems([]);
    setExpandedHistoryId(null);
    setError(null);
    setGoogleError(null);
    setDiscoverySummary(null);
    setGoogleDiscoverySummary(null);
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
    // DM 초안은 새로고침 후 복구하되, 모달은 사용자 액션으로만 연다.
    setDmModalOpen(false);
    setSelectedVerificationHandles(new Set());
    setSelectedSendConfirmationIds(new Set());
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
    if (!dmDrafts.length) return;
    const expectedHandles = dmDrafts.map((draft) => draft.handle);
    setDmBulkJapaneseText((current) => repairLegacyBulkDmHandles(current, expectedHandles));
  }, [dmDrafts]);

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
    if (!dmSyncWatchUntil) return;
    const timer = window.setInterval(async () => {
      if (Date.now() > dmSyncWatchUntil) {
        setDmSyncWatchUntil(null);
        return;
      }
      try {
        await reloadDmContacts(category);
        const sync = await fetchDmSyncStatus(category);
        if (sync.status === "running") return;
        setDmSyncWatchUntil(null);
        if (sync.status === "completed") {
          setToast({ kind: "success", message: `발송 확인 완료 · ${sync.processedCount ?? 0}/${sync.candidateCount ?? 0}명 · 발송 ${sync.sentCount ?? 0}명` });
        } else if (sync.status === "failed") {
          setToast({ kind: "error", message: `발송 확인 실패 · ${sync.processedCount ?? 0}/${sync.candidateCount ?? 0}명 · ${sync.failureMessage ?? "OpenCode 작업 실패"}` });
        }
      } catch {
        // 다음 polling 주기에서 다시 확인한다.
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [category, dmSyncWatchUntil]);

  useEffect(() => {
    let cancelled = false;
    fetchDmSyncStatus(category).then((sync) => {
      if (!cancelled && sync.running) setDmSyncWatchUntil(Date.now() + AUTOMATION_WATCH_MS);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [category]);

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
          const completionCandidates = watched.status === "completed"
            ? await reloadCandidates(category)
            : refreshedCandidates;
          setWatchedAutomationJobId(null);
          setAutomationWatchUntil(null);
          setToast({
            kind: watched.status === "failed" ? "error" : "success",
            message: automationCompletionMessage(watched, completionCandidates),
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

  const latestDmContactByHandle = useMemo(
    () => selectLatestDmContactByHandle(dmContacts),
    [dmContacts],
  );
  function candidateState(candidate: DiscoveryCandidate): CandidateViewState {
    const state = getCandidateViewState(candidate);
    if (state === "final_verification" && latestDmContactByHandle.get(candidate.handle)?.sentAt) return "dm_ready";
    return state;
  }

  const visibleCandidates = useMemo(
    () => candidates.filter((candidate) => getCandidateViewState(candidate) !== "unmapped"),
    [candidates],
  );

  const finalVerificationHandleSet = useMemo(
    () => new Set(visibleCandidates
      .filter((candidate) => getCandidateViewState(candidate) === "final_verification")
      .map((candidate) => candidate.handle)),
    [visibleCandidates],
  );
  const sendConfirmationContacts = useMemo(
    () => [...latestDmContactByHandle.values()].filter((contact) => (
      contact.openCodeStatus === "success"
      && !contact.sentAt
      && finalVerificationHandleSet.has(contact.handle)
    )),
    [latestDmContactByHandle, finalVerificationHandleSet],
  );
  const sendConfirmationHandleSet = useMemo(
    () => new Set(sendConfirmationContacts.map((contact) => contact.handle)),
    [sendConfirmationContacts],
  );

  useEffect(() => {
    const availableIds = new Set(sendConfirmationContacts.map((contact) => contact.id));
    setSelectedSendConfirmationIds((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [sendConfirmationContacts]);

  const filteredCandidates = useMemo(() => {
    if (statusFilter === "send_confirmation") return [];
    if (statusFilter === "all") return visibleCandidates;
    return visibleCandidates.filter((candidate) => (
      candidateState(candidate) === statusFilter
      && (statusFilter !== "final_verification" || !sendConfirmationHandleSet.has(candidate.handle))
    ));
  }, [visibleCandidates, statusFilter, latestDmContactByHandle, sendConfirmationHandleSet]);

  const verificationNeededTotal = candidates.filter((candidate) => candidateState(candidate) === "verification_needed").length;
  const recommendedTotal = candidates.filter((candidate) => candidateState(candidate) === "recommended").length;
  const duplicatePassedTotal = candidates.filter((candidate) => candidateState(candidate) === "duplicate_passed").length;
  const finalVerificationTotal = candidates.filter((candidate) => candidateState(candidate) === "final_verification" && !sendConfirmationHandleSet.has(candidate.handle)).length;
  const pendingDmDrafts = dmDrafts.filter((draft) => !draft.approved);

  const action = statusFilter === "verification_needed" || statusFilter === "recommended"
    ? { mode: "duplicate" as const, label: "중복 확인 실행" }
    : statusFilter === "duplicate_passed"
      ? { mode: "instagram" as const, label: "최종 검증 실행" }
      : statusFilter === "final_verification"
        ? { mode: "dm" as const, label: "DM 생성하기" }
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

  async function fetchDmSyncStatus(targetCategory: SearchCategory) {
    const response = await fetch(`/api/dm/sync?category=${targetCategory}`, { cache: "no-store" });
    const payload = await response.json() as DmSyncStatus;
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? "발송 확인 상태 조회 실패");
    setDmSyncStatus(payload);
    return payload;
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
      const [items] = await Promise.all([fetchHistoryItems(), fetchDmSyncStatus(category)]);
      setHistoryItems(items);
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

  async function reloadPlanned() {
    const response = await fetch("/api/planned", { cache: "no-store" });
    const payload = await response.json() as PlannedResponse;
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? "예정 목록 조회 실패");
    setPlannedItems(payload.items ?? []);
    setPlannedDueCount(payload.dueCount ?? 0);
    return payload;
  }

  async function togglePlanned() {
    if (plannedOpen) {
      setPlannedOpen(false);
      setPlannedAdding(false);
      setPlannedEditingId(null);
      return;
    }
    setPlannedOpen(true);
    setHistoryOpen(false);
    setModelPresetOpen(false);
    setPlannedLoading(true);
    try {
      const payload = await reloadPlanned();
      if ((payload.dueCount ?? 0) > 0) {
        setPlannedDueCount(0);
        const response = await fetch("/api/planned", { method: "PUT" });
        const seen = await response.json() as PlannedResponse;
        if (!response.ok || !seen.ok) throw new Error(seen.error ?? "예정 읽음 처리 실패");
        setPlannedItems(seen.items ?? []);
        setPlannedDueCount(seen.dueCount ?? 0);
      }
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "예정 목록 조회 실패" });
    } finally {
      setPlannedLoading(false);
    }
  }

  async function createPlanned(event: React.FormEvent) {
    event.preventDefault();
    setPlannedSaving(true);
    try {
      const response = await fetch("/api/planned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plannedForm),
      });
      const payload = await response.json() as PlannedResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "예정 등록 실패");
      setPlannedForm({ instagramHandle: "", plannedFor: "", memo: "" });
      setPlannedAdding(false);
      await reloadPlanned();
      setToast({ kind: "success", message: "예정을 등록했습니다." });
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "예정 등록 실패" });
    } finally { setPlannedSaving(false); }
  }

  function beginPlannedEdit(item: PlannedVisitItem) {
    setPlannedEditingId(item.id);
    setPlannedEditForm({ plannedFor: item.plannedFor, memo: item.memo });
  }

  async function savePlannedEdit(id: string) {
    setPlannedSaving(true);
    try {
      const response = await fetch("/api/planned", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...plannedEditForm }),
      });
      const payload = await response.json() as PlannedResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "예정 수정 실패");
      setPlannedEditingId(null);
      await reloadPlanned();
      setToast({ kind: "success", message: "예정을 수정했습니다." });
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "예정 수정 실패" });
    } finally { setPlannedSaving(false); }
  }

  async function removePlanned(item: PlannedVisitItem) {
    if (!window.confirm(`@${item.instagramHandle} 예정 기록을 삭제할까요?`)) return;
    setPlannedSaving(true);
    try {
      const response = await fetch("/api/planned", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const payload = await response.json() as PlannedResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "예정 삭제 실패");
      await reloadPlanned();
      setToast({ kind: "success", message: "예정 기록을 삭제했습니다." });
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "예정 삭제 실패" });
    } finally { setPlannedSaving(false); }
  }

  async function loadApiConnections() {
    setApiConnectionsLoading(true);
    try {
      const response = await fetch("/api/automation/settings", { cache: "no-store" });
      const payload = await response.json() as AutomationSettingsResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "API 연결 상태 조회 실패");
      setApiConnections(payload.connections ?? []);
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "API 연결 상태 조회 실패" });
    } finally {
      setApiConnectionsLoading(false);
    }
  }

  async function toggleApiConnections() {
    const next = !apiConnectionsOpen;
    setApiConnectionsOpen(next);
    if (!next) return;
    setModelPresetOpen(false);
    setHistoryOpen(false);
    setPlannedOpen(false);
    await loadApiConnections();
  }

  async function saveApiConnectionValue(connectionId: string) {
    const apiKey = apiConnectionDrafts[connectionId]?.trim() ?? "";
    if (!apiKey) return;
    setApiConnectionSavingId(connectionId);
    try {
      const response = await fetch("/api/automation/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, apiKey }),
      });
      const payload = await response.json() as AutomationSettingsResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "API 연결 저장 실패");
      setApiConnections(payload.connections ?? []);
      setApiConnectionDrafts((current) => ({ ...current, [connectionId]: "" }));
      const label = (payload.connections ?? []).find((item) => item.id === connectionId)?.label ?? connectionId;
      setToast({ kind: "success", message: `${label} 연결을 저장했습니다.` });
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "API 연결 저장 실패" });
    } finally {
      setApiConnectionSavingId(null);
    }
  }

  async function testBaiConnectionValue() {
    setApiConnectionSavingId("bai-test");
    try {
      const response = await fetch("/api/automation/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: "bai", action: "test" }),
      });
      const payload = await response.json() as { ok: boolean; error?: string; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "B.AI 연결 실패");
      setToast({ kind: "success", message: payload.message ?? "B.AI 연결 성공" });
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "B.AI 연결 실패" });
    } finally { setApiConnectionSavingId(null); }
  }

  async function activateModelPreset() {
    setModelPresetSaving(true);
    try {
      const response = await fetch("/api/automation/model-preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset: modelPresetDraft }),
      });
      const payload = await response.json() as ModelPresetResponse;
      if (!response.ok || !payload.ok || !payload.activePreset) {
        throw new Error(payload.error ?? "모델 순서를 변경하지 못했습니다.");
      }
      setModelPreset(payload.activePreset);
      setModelPresetDraft(payload.activePreset);
      setModelPresetOpen(false);
      setToast({ kind: "success", message: `모델 순서 ${payload.activePreset}로 활성화했습니다.` });
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "모델 순서 변경 실패" });
    } finally {
      setModelPresetSaving(false);
    }
  }

  async function runDiscovery() {
    setLoading(true);
    setError(null);
    setDiscoverySummary(null);
    setToast(null);
    try {
      const response = await fetch("/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, targetCount, source: "standard" }),
      });
      const payload = await response.json() as DiscoveryResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "검색에 실패했습니다.");
      await reloadCandidates(category);
      if (historyOpen) setHistoryItems(await fetchHistoryItems());
      const summary = discoveryResultSummary(payload, "기존 검색");
      setDiscoverySummary(summary);
      setToast({ kind: "success", message: summary });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "검색에 실패했습니다.";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setLoading(false);
    }
  }

  async function runGoogleDiscovery() {
    setGoogleLoading(true);
    setGoogleError(null);
    setGoogleDiscoverySummary(null);
    setToast(null);
    try {
      const response = await fetch("/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, targetCount, source: "google" }),
      });
      const payload = await response.json() as DiscoveryResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Google 검색에 실패했습니다.");
      await reloadCandidates(category);
      if (historyOpen) setHistoryItems(await fetchHistoryItems());
      const summary = discoveryResultSummary(payload, "Google 검색");
      setGoogleDiscoverySummary(summary);
      setToast({ kind: "success", message: summary });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Google 검색에 실패했습니다.";
      setGoogleError(message);
      setToast({ kind: "error", message });
    } finally {
      setGoogleLoading(false);
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
    const retryCurrentDrafts = !targetHandles
      && !forceRegenerate
      && dmDraftCategory === category
      && dmDrafts.length > 0
      && dmDrafts.some((draft) => latestDmContactByHandle.get(draft.handle)?.openCodeStatus === "failed")
      && dmDrafts.every((draft) => !latestDmContactByHandle.get(draft.handle)?.sentAt);
    const handles = targetHandles
      ?? (retryCurrentDrafts ? dmDrafts.map((draft) => draft.handle) : filteredCandidates.slice(0, 30).map((candidate) => candidate.handle));
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
      && (dmDrafts.some((draft) => !draft.approved) || retryCurrentDrafts)
      && sameHandleSet(handles, dmDrafts.map((draft) => draft.handle));

    if (canReuseCurrentDrafts) {
      if (retryCurrentDrafts) {
        setDmDrafts((current) => current.map((draft) => ({ ...draft, approved: false })));
      }
      setDmModalOpen(true);
      setToast({
        kind: "success",
        message: retryCurrentDrafts
          ? `이전 DM 입력 실패 batch ${dmDrafts.length}명 재시도 준비 · 기존 원문 유지`
          : `기존 DM 초안 ${dmDrafts.length}명 다시 열기 · LLM 재생성 없음`,
      });
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
              ? { ...replacement, approved: false }
              : draft
          ));
          setDmBulkJapaneseText(formatBulkDmText(next));
          return next;
        });
      } else {
        const nextDrafts = items.map((item) => ({ ...item, approved: false }));
        setDmDrafts(nextDrafts);
        setDmBulkJapaneseText(formatBulkDmText(nextDrafts));
        setDmReviewStep("edit");
        setDmParseError(null);
        setDmModalOpen(true);
      }

      const resultMessage = payload.reused
        ? `\uAE30\uC874 DM \uCD08\uC548 ${payload.preparedCount ?? items.length}\uBA85 \uC7AC\uC0AC\uC6A9`
        : `${singleHandle ? `@${singleHandle} DM \uCD08\uC548 \uC7AC\uC0DD\uC131` : `${forceRegenerate ? "DM \uCD08\uC548 \uC7AC\uC0DD\uC131" : "DM \uCD08\uC548 \uC0DD\uC131"} ${payload.preparedCount ?? items.length}\uBA85 \uC644\uB8CC`} \u00B7 \uCD94\uAC00 LLM 0\uD68C`;
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

  async function copyAllDmText() {
    try {
      const copyText = repairLegacyBulkDmHandles(dmBulkJapaneseText, dmDrafts.map((draft) => draft.handle));
      if (copyText !== dmBulkJapaneseText) setDmBulkJapaneseText(copyText);
      await navigator.clipboard.writeText(copyText);
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

    const working = dmDrafts.map((draft) => ({
      ...draft,
      japaneseText: parsed.messages.get(draft.handle) ?? "",
    }));
    const invalidJapanese = working.find((draft) => !isJapaneseDmText(draft.japaneseText));
    if (invalidJapanese) {
      const message = `@${invalidJapanese.handle} 일본어 DM 형식을 확인해 주세요.`;
      setDmParseError(message);
      setToast({ kind: "error", message });
      return;
    }

    setDmParseError(null);
    setDmReviewPreparing(true);
    try {
      setDmDrafts(working);
      setDmBulkJapaneseText(formatBulkDmText(working));
      setDmReviewStep("confirm");
      setToast({ kind: "success", message: "최종 확인 준비 완료 · 아직 승인 저장/OpenCode 실행 전입니다." });
    } finally {
      setDmReviewPreparing(false);
    }
  }
  async function approveAllDmDrafts(sourceDrafts: DmDraft[] = dmDrafts) {
    if (dmReviewStep !== "confirm" || !sourceDrafts.length || dmApprovingHandle) return false;
    const pending = sourceDrafts.filter((draft) => !draft.approved);
    if (!pending.length) {
      setDmReviewStep("confirm");
      return true;
    }

    const invalidHandle = pending.find((draft) => draft.handle !== normalizeHandle(draft.handle) || !isValidHandle(draft.handle) || draft.handle.includes("\\"));
    if (invalidHandle) {
      setToast({ kind: "error", message: `Instagram handle이 올바르지 않습니다: ${JSON.stringify(invalidHandle.handle)}` });
      return false;
    }
    if (new Set(pending.map((draft) => draft.handle)).size !== pending.length) {
      setToast({ kind: "error", message: "DM batch에 중복 Instagram handle이 있습니다." });
      return false;
    }
    const emptyJapanese = pending.find((draft) => !draft.japaneseText.trim());
    if (emptyJapanese) {
      setToast({ kind: "error", message: `@${emptyJapanese.handle} 일본어 DM 본문이 비어 있습니다.` });
      return false;
    }

    const approvalItems = pending.map((draft) => ({ handle: draft.handle, japaneseText: draft.japaneseText }));
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
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? `DM 전송 준비 실패: ${contacts.length}/${expectedCount}명 승인`);
      if (contacts.length !== expectedCount || payload.requestedCount !== expectedCount || payload.contactCount !== expectedCount || payload.candidateCount !== expectedCount || payload.launcherCount !== expectedCount || payload.promptCount !== expectedCount || payload.openCodeRunCount !== 1) {
        throw new Error(`DM batch 수량 불일치: 화면 ${expectedCount} / 승인 ${contacts.length} / 요청 ${payload.requestedCount ?? "?"} / launcher ${payload.launcherCount ?? "?"} / prompt ${payload.promptCount ?? "?"} / OpenCode ${payload.openCodeRunCount ?? "?"}`);
      }
      const contactByHandle = new Map(contacts.map((contact) => [contact.handle, contact]));
      if (contactByHandle.size !== expectedCount || pending.some((draft) => !contactByHandle.has(draft.handle))) throw new Error("DM batch contact handle이 화면 입력과 정확히 일치하지 않습니다.");

      const updated = sourceDrafts.map((draft) => contactByHandle.has(draft.handle) ? { ...draft, japaneseText: contactByHandle.get(draft.handle)!.japaneseText, approved: true } : draft);
      setDmDrafts(updated);
      setDmReviewStep("confirm");
      await reloadDmContacts(category);
      setToast({ kind: "success", message: `전송 준비 완료 · ${expectedCount}명 · OpenCode batch 1회 시작 · 실제 Send 0회` });
      return true;
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "DM 전송 준비 실패" });
      return false;
    } finally {
      setDmApprovingHandle(null);
    }
  }

  function toggleSendConfirmationSelection(contactId: string) {
    setSelectedSendConfirmationIds((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  function toggleAllSendConfirmations() {
    setSelectedSendConfirmationIds((current) => {
      const allIds = sendConfirmationContacts.map((contact) => contact.id);
      const allSelected = allIds.length > 0 && allIds.every((id) => current.has(id));
      return allSelected ? new Set() : new Set(allIds);
    });
  }

  async function returnSelectedSendConfirmations() {
    const selected = sendConfirmationContacts.filter((contact) => selectedSendConfirmationIds.has(contact.id));
    if (!selected.length || sendConfirmationMoving) {
      if (!selected.length) setToast({ kind: "error", message: "최종 검증 후보로 보낼 계정을 선택하세요." });
      return;
    }

    setSendConfirmationMoving(true);
    setToast(null);
    try {
      const response = await fetch("/api/dm/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, contactIds: selected.map((contact) => contact.id) }),
      });
      const payload = await response.json() as { ok?: boolean; movedCount?: number; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "최종 검증 후보 되돌리기 실패");
      if (payload.movedCount !== selected.length) throw new Error(`되돌리기 수량 불일치: ${payload.movedCount ?? 0}/${selected.length}`);
      await reloadDmContacts(category);
      setSelectedSendConfirmationIds(new Set());
      setToast({ kind: "success", message: `최종 검증 후보로 이동 완료 · ${selected.length}명` });
    } catch (caught) {
      setToast({ kind: "error", message: caught instanceof Error ? caught.message : "최종 검증 후보 되돌리기 실패" });
    } finally {
      setSendConfirmationMoving(false);
    }
  }

  async function runDmSentSync(manual = false) {
    const allPending = sendConfirmationContacts;
    const now = Date.now();
    const pending = manual
      ? allPending
      : allPending.filter((contact) => {
          const approvedMs = Date.parse(contact.approvedAt);
          return Number.isFinite(approvedMs) && now - approvedMs >= 0 && now - approvedMs <= DM_AUTO_SYNC_RECENT_MS;
        });
    if (!pending.length) {
      if (manual) setToast({ kind: "success", message: "\uBC1C\uC1A1 \uD655\uC778\uD560 \uBBF8\uD655\uC778 \uAC74\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." });
      return;
    }
    if (dmSyncInFlightRef.current) return;
    if (!manual && Date.now() < dmSyncCooldownUntilRef.current) return;
    dmSyncInFlightRef.current = true;
    dmSyncCooldownUntilRef.current = Date.now() + 30_000;
    setDmSyncing(true);
    try {
      const response = await fetch("/api/dm/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, contactIds: pending.slice(0, 30).map((contact) => contact.id) }),
      });
      const payload = await response.json() as DmSyncStatus & { launched?: boolean; alreadyRunning?: boolean; processId?: number };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "발송 상태 동기화 시작 실패");
      if (payload.launched || payload.alreadyRunning) {
        setDmSyncWatchUntil(Date.now() + AUTOMATION_WATCH_MS);
        setDmSyncStatus({ ...payload, running: true, status: "running", processedCount: payload.processedCount ?? 0, candidateCount: payload.candidateCount ?? pending.length });
        void fetchDmSyncStatus(category).catch(() => {});
      }
      if (manual) setToast({ kind: "success", message: payload.launched ? `발송 확인 시작 · ${payload.candidateCount ?? pending.length}명` : payload.alreadyRunning ? "발송 확인 작업이 진행 중입니다. 상태 추적을 계속합니다." : "동기화할 미확인 발송 건이 없습니다." });
    } catch (caught) {
      if (manual) setToast({ kind: "error", message: caught instanceof Error ? caught.message : "발송 상태 동기화 실패" });
    } finally {
      dmSyncInFlightRef.current = false;
      setDmSyncing(false);
    }
  }

  const processingHistory = buildProcessingHistory(historyItems, dmSyncStatus);

  return (
    <>
      <div className="controls-layout">
        <aside className="candidate-summary-box" aria-label="누적 후보 요약">
          {listLoading ? (
            <span className="summary-loading">누적 후보 불러오는 중…</span>
          ) : (
            <>
              <div className="summary-main-list">
                <span className="summary-stat"><span>전체</span><strong>{visibleCandidates.length}</strong></span>
                <span className="summary-stat"><span>검증 필요</span><strong>{verificationNeededTotal}</strong></span>
                <span className="summary-stat"><span>추천</span><strong>{recommendedTotal}</strong></span>
                <span className="summary-stat"><span>중복 통과</span><strong>{duplicatePassedTotal}</strong></span>
              </div>
              <div className="summary-highlight-group">
                <span className="summary-stat summary-final"><span>최종</span><strong>{finalVerificationTotal}</strong></span>
                <span className="summary-model"><span>{"\uBAA8\uB378 \uC21C\uC11C"}</span><strong>{modelPreset}</strong></span>
              </div>
            </>
          )}
        </aside>
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
          <div className="control-actions">
            <div className="history-control">
              <button className="history-button planned-action-button" type="button" onClick={togglePlanned} aria-expanded={plannedOpen}>
                예정
                {plannedDueCount > 0 && <span className="planned-due-badge"><span className="planned-due-dot" />{plannedDueCount}</span>}
              </button>
              {plannedOpen && (
                <div className="history-popover planned-popover">
                  <div className="planned-popover-header">
                    <strong>방한 예정 관리</strong>
                    <button type="button" className="planned-add-toggle" onClick={() => setPlannedAdding((open) => !open)}>+ 추가</button>
                  </div>
                  {plannedAdding && (
                    <form className="planned-form" onSubmit={createPlanned}>
                      <label>Instagram 계정<input required value={plannedForm.instagramHandle} onChange={(event) => setPlannedForm((current) => ({ ...current, instagramHandle: event.target.value }))} placeholder="@handle" /></label>
                      <label>방한 예정 시기<input required value={plannedForm.plannedFor} onChange={(event) => setPlannedForm((current) => ({ ...current, plannedFor: event.target.value }))} placeholder="2026-12 또는 2026-12-18" /></label>
                      <label className="planned-memo-field">메모<textarea value={plannedForm.memo} onChange={(event) => setPlannedForm((current) => ({ ...current, memo: event.target.value }))} placeholder="선택" /></label>
                      <div className="planned-form-actions"><button type="submit" className="planned-save-button" disabled={plannedSaving}>등록</button><button type="button" onClick={() => setPlannedAdding(false)}>취소</button></div>
                    </form>
                  )}
                  {plannedLoading ? <div className="history-empty">불러오는 중…</div> : plannedItems.length ? (
                    <div className="planned-list">
                      <div className="planned-list-head"><span>Instagram 계정</span><span>방한 예정 시기</span><span>메모</span><span /></div>
                      {plannedItems.map((item) => (
                        <div className="planned-row" key={item.id}>
                          <div className="planned-handle">@{item.instagramHandle}{item.candidateId && <span className="planned-linked">후보 연결</span>}</div>
                          {plannedEditingId === item.id ? (
                            <>
                              <input className="planned-inline-input" value={plannedEditForm.plannedFor} onChange={(event) => setPlannedEditForm((current) => ({ ...current, plannedFor: event.target.value }))} />
                              <textarea className="planned-inline-memo" value={plannedEditForm.memo} onChange={(event) => setPlannedEditForm((current) => ({ ...current, memo: event.target.value }))} />
                              <div className="planned-row-actions"><button type="button" onClick={() => savePlannedEdit(item.id)} disabled={plannedSaving}>저장</button><button type="button" onClick={() => setPlannedEditingId(null)}>취소</button></div>
                            </>
                          ) : (
                            <>
                              <div>{item.plannedFor}</div>
                              <div className="planned-memo-text">{item.memo || "—"}</div>
                              <div className="planned-row-actions"><button type="button" onClick={() => beginPlannedEdit(item)}>수정</button><button type="button" className="planned-delete-button" onClick={() => removePlanned(item)} disabled={plannedSaving}>삭제</button></div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : <div className="history-empty">등록된 예정이 없습니다.</div>}
                </div>
              )}
            </div>
            <div className="history-control">
              <button
                className="history-button model-action-button"
                type="button"
                aria-expanded={modelPresetOpen}
                onClick={() => {
                  setModelPresetDraft(modelPreset);
                  setModelPresetOpen((open) => !open);
                }}
              >
                <span className="action-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3 4h10M3 12h10M6 2v4M10 10v4" /></svg></span>
                모델 변경
              </button>
              {modelPresetOpen && (
                <div className="history-popover" style={{ width: 250 }}>
                  <strong>모델 순서 변경</strong>
                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    {MODEL_PRESET_IDS.map((preset) => (
                      <label key={preset} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="open-code-model-preset"
                          checked={modelPresetDraft === preset}
                          onChange={() => setModelPresetDraft(preset)}
                        />
                        <span><strong>{preset}</strong> · {MODEL_PRESET_LABELS[preset]}</span>
                      </label>
                    ))}
                  </div>
                  <button
                    className="primary"
                    type="button"
                    onClick={activateModelPreset}
                    disabled={modelPresetSaving || modelPresetDraft === modelPreset}
                    style={{ marginTop: 12, width: "100%" }}
                  >{modelPresetSaving ? "활성화 중…" : "활성화"}</button>
                </div>
              )}
            </div>
            <div className="history-control">
              <button className="history-button" type="button" onClick={toggleApiConnections} aria-expanded={apiConnectionsOpen}>
                <span className="action-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M6.2 8.8 9.8 5.2M5 4.2l-1.4 1.4a2 2 0 0 0 2.8 2.8L7.8 7M11 11.8l1.4-1.4a2 2 0 0 0-2.8-2.8L8.2 9" /></svg></span>
                API 연결
              </button>
              {apiConnectionsOpen && (
                <div className="history-popover" style={{ width: 440, maxHeight: 620, overflowY: "auto" }}>
                  <strong>API 연결</strong>
                  <div style={{ marginTop: 6, color: "#6b7684", fontSize: 12, lineHeight: 1.5 }}>
                    필수: Exa 또는 Tavily 중 1개 · 권장: B.AI · 나머지 fallback은 선택
                  </div>
                  {apiConnectionsLoading ? <div className="history-empty">연결 상태 확인 중…</div> : (
                    (["search", "google-search", "opencode"] as const).map((group) => {
                      const items = apiConnections.filter((item) => item.group === group);
                      if (!items.length) return null;
                      const title = group === "search" ? "기본 검색" : group === "google-search" ? "Google 추가 찾기" : "OpenCode Provider";
                      return (
                        <div key={group} style={{ marginTop: 14 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: "#4e5968", marginBottom: 7 }}>{title}</div>
                          <div style={{ display: "grid", gap: 8 }}>
                            {items.map((connection) => (
                              <div key={connection.id} style={{ border: "1px solid #e5e8eb", borderRadius: 10, padding: 10 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                  <div><strong>{connection.label}</strong> <span style={{ color: connection.requirement === "required-one-of" ? "#d9480f" : "#8b95a1", fontSize: 11 }}>{connection.requirementLabel}</span></div>
                                  <span style={{ color: connection.connected ? "#16883f" : "#8b95a1", fontSize: 11, fontWeight: 700 }}>{connection.connected ? "연결됨" : "미연결"}</span>
                                </div>
                                <div style={{ color: "#8b95a1", fontSize: 11, marginTop: 3 }}>{connection.note}</div>
                                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                                  <input
                                    type="password"
                                    autoComplete="off"
                                    aria-label={connection.label + " API Key"}
                                    placeholder={connection.connected ? "새 키로 교체할 때만 입력" : "API Key 입력"}
                                    value={apiConnectionDrafts[connection.id] ?? ""}
                                    onChange={(event) => setApiConnectionDrafts((current) => ({ ...current, [connection.id]: event.target.value }))}
                                    style={{ flex: 1, minWidth: 0 }}
                                  />
                                  <button type="button" className="secondary" onClick={() => saveApiConnectionValue(connection.id)} disabled={!apiConnectionDrafts[connection.id]?.trim() || Boolean(apiConnectionSavingId)}>
                                    {apiConnectionSavingId === connection.id ? "저장 중…" : connection.connected ? "교체" : "연결"}
                                  </button>
                                  {connection.id === "bai" && <button type="button" className="secondary" onClick={testBaiConnectionValue} disabled={!connection.connected || Boolean(apiConnectionSavingId)}>{apiConnectionSavingId === "bai-test" ? "확인 중…" : "연결 테스트"}</button>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div style={{ marginTop: 12, color: "#8b95a1", fontSize: 11, lineHeight: 1.5 }}>
                    저장된 키 원문은 화면에 다시 표시하지 않습니다. OpenCode 키는 OpenCode credential store에 저장됩니다.
                  </div>
                </div>
              )}
            </div>
            <div className="history-control">
              <button className="history-button notification-action-button" onClick={toggleHistory} aria-expanded={historyOpen}>
                <span className="action-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M5.1 6.1a2.9 2.9 0 0 1 5.8 0c0 3.4 1.4 3.8 1.4 3.8H3.7s1.4-.4 1.4-3.8ZM6.7 12.1a1.4 1.4 0 0 0 2.6 0" /></svg></span>
                알림
              </button>
              {historyOpen && (
                <div className="history-popover" style={{ width: 470, maxHeight: 500, overflowY: "auto" }}>
                  <strong>처리 기록</strong>
                  {historyLoading ? (
                    <div className="history-empty">불러오는 중…</div>
                  ) : processingHistory.length ? (
                    processingHistory.map((entry) => entry.kind === "dm-sync" ? (
                      <div className="history-item" style={{ cursor: "default" }} key={entry.key}>
                        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                          <span style={{ color: entry.sync.status === "failed" ? "#dc2626" : entry.sync.status === "completed" ? "#3182f6" : "#333d4b", fontWeight: 800 }}>
                            {entry.sync.status === "running" ? `발송 확인 ${entry.sync.processedCount ?? 0}/${entry.sync.candidateCount ?? 0} 진행 중` : entry.sync.status === "completed" ? `발송 확인 ${entry.sync.candidateCount ?? 0}명 완료` : `발송 확인 ${entry.sync.processedCount ?? 0}/${entry.sync.candidateCount ?? 0} 실패`}
                          </span>
                          <span style={{ color: "#8b95a1", fontSize: 11, flex: "0 0 auto" }}>{entry.sync.updatedAt ? new Date(entry.sync.updatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                        </span>
                        <span style={{ display: "block", marginTop: 3, color: "#6b7684", lineHeight: 1.45 }}>발송 {entry.sync.sentCount ?? 0} · 미발송 {entry.sync.notSentCount ?? 0} · 확인 필요 {entry.sync.uncertainCount ?? 0}</span>
                        {entry.sync.status === "failed" && entry.sync.failureMessage && <span style={{ display: "block", marginTop: 3, color: "#dc2626", lineHeight: 1.45 }}>{entry.sync.failureMessage}</span>}
                      </div>
                    ) : (() => {
                      const item = entry.item;
                      const expanded = expandedHistoryId === item.id;
                      return (
                        <button type="button" className="history-item" key={entry.key} aria-expanded={expanded}
                          onClick={() => setExpandedHistoryId(expanded ? null : item.id)}
                          style={{ display: "block", width: "100%", borderTop: 0, borderLeft: 0, borderRight: 0, background: "transparent", color: "inherit", cursor: "pointer", font: "inherit", textAlign: "left", whiteSpace: "normal" }}>
                          <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                            <span style={{ color: item.status === "failed" ? "#dc2626" : item.status === "completed" ? "#3182f6" : "#333d4b", fontWeight: 800 }}>{historyTitle(item)}</span>
                            <span style={{ color: "#8b95a1", fontSize: 11, flex: "0 0 auto" }}>{historyTime(item)}</span>
                          </span>
                          <span style={{ display: "block", marginTop: 3, color: "#6b7684", lineHeight: 1.45 }}>{historyResultLine(item)}</span>
                          {expanded && <HistoryDetail item={item} />}
                        </button>
                      );
                    })())
                  ) : (
                    <div className="history-empty">아직 실행 기록이 없습니다.</div>
                  )}
                </div>
              )}
            </div>
            <button className="secondary search-action-button google-action-button" onClick={runGoogleDiscovery} disabled={googleLoading || loading}>
              <svg className="google-g-icon" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.715v2.258h2.909c1.702-1.567 2.684-3.874 2.684-6.614Z"/><path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.18l-2.91-2.259c-.806.54-1.835.859-3.046.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.963 10.706A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.168.281-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.038l3.007-2.332Z"/><path fill="#EA4335" d="M9 3.58c1.322 0 2.508.454 3.442 1.346l2.582-2.582C13.464.892 11.427 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z"/></svg>
              {googleLoading ? "찾는 중…" : "구글 찾기"}
            </button>
            <button className="primary search-action-button primary-discovery-button" onClick={runDiscovery} disabled={loading || googleLoading}>
              {loading ? "찾는 중…" : candidates.length ? <><span className="action-plus" aria-hidden="true">+</span>추가 찾기</> : "후보 찾기"}
            </button>
          </div>
        </div>

        {loading && (
          <div className="progress-box" aria-live="polite">
            <div className="progress-track"><div className="progress-bar" /></div>
            <span>{PROGRESS_STAGES[progressStage]}</span>
          </div>
        )}
        {googleLoading && (
          <div className="progress-box" aria-live="polite">
            <div className="progress-track"><div className="progress-bar" /></div>
            <span>Serper + SerpApi 독립 검색 · 신규 Instagram 후보 판정 중</span>
          </div>
        )}

        {health && !health.quality?.ok && <div className="notice error">품질 규칙 자체 점검 실패: {health.quality?.failures.join(", ")}</div>}
        {error && <div className="notice error">기존 검색: {error}</div>}
        {googleError && <div className="notice error">Google 검색: {googleError}</div>}
        {discoverySummary && <div className="notice">{discoverySummary}</div>}
        {googleDiscoverySummary && <div className="notice">{googleDiscoverySummary}</div>}
        </section>
      </div>

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
                {statusFilter === "send_confirmation" ? (
                  <button
                    className="secondary action-button send-confirmation-action-button"
                    style={{ width: "100%", whiteSpace: "nowrap" }}
                    type="button"
                    onClick={() => void runDmSentSync(true)}
                    disabled={dmSyncing || Boolean(dmSyncStatus?.running)}
                  >
                    {dmSyncing || dmSyncStatus?.running ? "확인 중…" : "발송 확인"}
                  </button>
                ) : action && (
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
          <div className="results-tabs" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {statusFilter === "send_confirmation" && (
              <>
                <button className="secondary" type="button" onClick={() => void returnSelectedSendConfirmations()} disabled={sendConfirmationMoving || selectedSendConfirmationIds.size === 0}>
                  {sendConfirmationMoving ? "이동 중…" : "최종 검증 후보로 보내기"}
                </button>
                <button className="secondary" type="button" onClick={toggleAllSendConfirmations} disabled={sendConfirmationMoving || sendConfirmationContacts.length === 0}>
                  전체 선택하기
                </button>
              </>
            )}
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
          <>
            {dmSyncStatus?.status === "running" && <div className="notice">발송 확인 진행 중 · {dmSyncStatus.processedCount ?? 0}/{dmSyncStatus.candidateCount ?? 0}명 · 발송 {dmSyncStatus.sentCount ?? 0}명</div>}
            {dmSyncStatus?.status === "failed" && <div className="notice error">발송 확인 실패 · {dmSyncStatus.processedCount ?? 0}/{dmSyncStatus.candidateCount ?? 0}명 · {dmSyncStatus.failureMessage ?? "OpenCode 작업 실패"}</div>}
            <SendConfirmationTable
              contacts={sendConfirmationContacts}
              loading={dmContactsLoading}
              selectedIds={selectedSendConfirmationIds}
              moving={sendConfirmationMoving}
              onToggle={toggleSendConfirmationSelection}
            />
          </>
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
                <strong>{dmReviewStep === "edit" ? "DM 생성하기" : pendingDmDrafts.length ? "최종 확인" : "전송 준비 완료"}</strong>
                <span>· {dmDrafts.length}명</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  className="secondary"
                  type="button"
                  onClick={regenerateDmBatch}
                  disabled={dmLoading || dmReviewPreparing || Boolean(dmApprovingHandle)}
                  style={{ padding: "6px 10px", fontSize: 12, whiteSpace: "nowrap" }}
                >{dmLoading ? "재생성 중…" : "핵심정보 다시 생성"}</button>
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
                <div className={dmStyles.reviewHead} style={{ gridTemplateColumns: "1fr" }}>
                  <div className={dmStyles.reviewHeadCell}>
                    <strong>ChatGPT용 후보 핵심정보 / 최종 일본어 DM</strong>
                    <button className="secondary" type="button" onClick={copyAllDmText}>전체 복사</button>
                  </div>
                </div>

                <div className={dmStyles.reviewBody} style={{ gridTemplateColumns: "1fr" }}>
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


                </div>

                <div className={dmStyles.footer}>
                  <button
                    className={dmStyles.passButton}
                    type="button"
                    onClick={prepareDmFinalReview}
                    disabled={dmReviewPreparing || Boolean(dmApprovingHandle)}
                  >
                    {dmReviewPreparing ? "확인 중…" : "다음"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={dmStyles.confirmBody}>
                  <div className={dmStyles.launcherSummary}>
                    <strong>{pendingDmDrafts.length ? "DM 전송 전 최종 확인" : "전송 준비 완료"}</strong>
                    <code>{pendingDmDrafts.length ? `승인 저장/OpenCode 실행 전 · ${dmDrafts.length}명 · 실제 Send 0회` : `OpenCode batch 시작 · ${dmDrafts.length}명 · Instagram 입력창까지만 입력 · 실제 Send 0회`}</code>
                    <span>실제 Send/Enter는 자동 실행하지 않습니다. Instagram에서 최종 발송은 사용자가 직접 합니다.</span>
                  </div>
                  {dmDrafts.map((draft) => (
                    <section className={dmStyles.confirmItem} key={`confirm-${draft.handle}`}>
                      <strong className={dmStyles.confirmHandle}>@{draft.handle}</strong>
                      <pre className={dmStyles.confirmDm}>{draft.japaneseText}</pre>
                    </section>
                  ))}
                </div>
                <div className={dmStyles.footer}>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setDmReviewStep("edit")}
                    disabled={Boolean(dmApprovingHandle)}
                  >수정하기</button>
                  <button
                    className={dmStyles.passButton}
                    type="button"
                    onClick={() => void approveAllDmDrafts()}
                    disabled={Boolean(dmApprovingHandle) || pendingDmDrafts.length === 0}
                  >
                    {dmApprovingHandle === BULK_APPROVAL_HANDLE ? "전송 준비 중…" : pendingDmDrafts.length ? `DM 전송 · ${dmDrafts.length}명` : "전송 준비 완료"}
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
  selectedIds,
  moving,
  onToggle,
}: {
  contacts: DmContact[];
  loading: boolean;
  selectedIds: Set<string>;
  moving: boolean;
  onToggle: (contactId: string) => void;
}) {
  if (loading) return <div className="empty">{"\uBC1C\uC1A1 \uD655\uC778 \uBAA9\uB85D\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4."}</div>;
  if (!contacts.length) return <div className="empty">{"\uBC1C\uC1A1 \uD655\uC778\uD560 \uC900\uBE44\uB41C DM\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</div>;
  return (
    <div>
      <div className="table-wrap">
        <table className="send-confirmation-table">
          <thead>
            <tr>
              <th className="send-confirmation-select-col" aria-label="선택" />
              <th>Instagram 아이디</th>
              <th>{"\uC0C1\uD0DC"}</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id}>
                <td className="send-confirmation-select-col">
                  <input
                    type="checkbox"
                    aria-label={`@${contact.handle} 선택`}
                    checked={selectedIds.has(contact.id)}
                    onChange={() => onToggle(contact.id)}
                    disabled={moving}
                  />
                </td>
                <td><div className="handle">@{contact.handle}</div></td>
                <td><span className={dmStyles.sendStatus}>{"\uC0AC\uC6A9\uC790 \uBC1C\uC1A1 \uB300\uAE30"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

function buildProcessingHistory(items: AutomationHistoryItem[], sync: DmSyncStatus | null) {
  const entries: Array<
    | { kind: "dm-sync"; key: string; timestamp: string | null; sync: DmSyncStatus }
    | { kind: "automation"; key: string; timestamp: string; item: AutomationHistoryItem }
  > = items.map((item) => ({
    kind: "automation",
    key: `automation-${item.id}`,
    timestamp: item.status === "completed" ? item.completedAt ?? item.createdAt : item.status === "failed" ? item.failedAt ?? item.createdAt : item.createdAt,
    item,
  }));
  if (sync && sync.status && sync.status !== "idle") {
    entries.push({ kind: "dm-sync", key: `dm-sync-${sync.startedAt ?? sync.updatedAt ?? "current"}`, timestamp: sync.updatedAt ?? sync.startedAt ?? null, sync });
  }
  return sortByEventTimestampDesc(entries);
}

function historyTitle(item: AutomationHistoryItem) {
  if (item.mode === "discovery") return `후보 찾기 ${item.runNo ?? "?"}차 · ${item.destinationCount}명 신규 후보`;
  const action = item.mode === "duplicate" ? "중복 확인" : "최종 검증";
  if (item.status === "pending") return `${action} ${item.processedCount}/${item.candidateCount} 진행 중`;
  if (item.status === "failed") return `${action} ${item.processedCount}/${item.candidateCount} 실패`;
  return `${action} ${item.candidateCount}명 완료`;
}

function historyResultLine(item: AutomationHistoryItem) {
  if (item.mode === "discovery") return item.discoverySummary ?? `신규 후보 ${item.destinationCount}명`;
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
  if (item.mode === "discovery") {
    return (
      <span style={{ display: "block", marginTop: 10, paddingTop: 9, borderTop: "1px solid #edf0f2", color: "#6b7684", lineHeight: 1.45 }}>
        {item.discoverySummary ?? `신규 후보 ${item.destinationCount}명`}
      </span>
    );
  }
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

function discoveryResultSummary(payload: DiscoveryResponse, label: string) {
  const googleMetrics = payload.source === "google"
    ? ` · query ${payload.queriesRun} · 추가 lane ${payload.additionalLaneCount}`
    : "";
  return `${label} ${payload.runNo}차${googleMetrics} · 원천 ${payload.sourceResultCount} · Instagram handle ${payload.instagramHandleCount} · 기존 재발견 ${payload.existingExcludedCount} · 신규 handle ${payload.newCandidateCount} · 저장 신규 ${payload.newSavedCount} · 추천 ${payload.recommendedCount} · 검증 필요 ${payload.needsReviewCount} · 품질 제외 ${payload.excludedCount}`;
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
        || typeof draft.generatedAt !== "string"
        || typeof draft.provider !== "string"
        || typeof draft.model !== "string"
        || typeof draft.approved !== "boolean"
      ) {
        return null;
      }
      drafts.push(draft as DmDraft);
    }
    if (new Set(drafts.map((draft) => draft.handle)).size !== drafts.length) return null;

    const restoredBulkText = typeof value.bulkJapaneseText === "string"
      ? repairLegacyBulkDmHandles(value.bulkJapaneseText, drafts.map((draft) => draft.handle))
      : formatBulkDmText(drafts);

    return {
      version: 1,
      category,
      drafts,
      bulkJapaneseText: restoredBulkText,
      reviewStep: value.reviewStep,
    };
  } catch {
    return null;
  }
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
