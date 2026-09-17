export type InstagramDmMessageEvidence = {
  text: string;
  direction: "outgoing" | "incoming" | "unknown";
  currentAttempt: "yes" | "no" | "unknown";
};

export function normalizeInstagramDmExactText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .trim()
    .replace(/\s+/g, " ");
}

export function isConfirmedSentEvidence(approvedText: string, messages: readonly InstagramDmMessageEvidence[]) {
  const approved = normalizeInstagramDmExactText(approvedText);
  if (!approved) return false;
  return messages.some((message) => (
    message.direction === "outgoing"
    && message.currentAttempt === "yes"
    && normalizeInstagramDmExactText(message.text) === approved
  ));
}
