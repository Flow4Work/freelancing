export const FIXUP_DUPLICATE_CHECK_URL = "https://script.google.com/macros/s/AKfycbywng5Sy2xPHt3wbrG6U37BGVBaCFcdv-rq_dBfFG1cxitSeqADtAOTF_iOq55z_Sv6oA/exec";
export const AUTOMATION_BATCH_SIZE = 30;

export function getOpenCodeCommand() {
  return process.env.OPENCODE_COMMAND?.trim() || "opencode";
}
