import type { AccountAvailability, AccountType, CandidateStatus, ContentFit, Eligibility, KoreaAffinity, SearchCategory } from "./types";

export type SearchStageClassificationInput = {
  category: SearchCategory;
  accountAvailability: AccountAvailability;
  accountType: AccountType;
  koreaAffinity: KoreaAffinity;
  contentFit: ContentFit;
  eligibility: Eligibility;
};

export function classifySearchStage(input: SearchStageClassificationInput): CandidateStatus {
  if (
    input.accountAvailability === "unavailable"
    || input.accountType === "business"
    || input.koreaAffinity === "none"
    || input.eligibility === "fail"
  ) {
    return "hard_reject";
  }

  if (
    input.accountAvailability === "active"
    && input.accountType === "creator"
    && (input.koreaAffinity === "strong" || input.koreaAffinity === "yes")
    && input.contentFit === input.category
    && input.eligibility === "possible"
  ) {
    return "search_qualified";
  }

  return "needs_review";
}
