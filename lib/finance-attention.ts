export const FINANCE_ATTENTION_ISSUE_DEFINITIONS = {
  MISSING_RECEIPT: { acceptanceAllowed: true },
  NEGATIVE_CASHBOX: { acceptanceAllowed: false },
  NEGATIVE_MATERIALS_BALANCE: { acceptanceAllowed: false },
  UNALLOCATED_EXPENSE: { acceptanceAllowed: false },
  INACTIVE_CASHBOX_BALANCE: { acceptanceAllowed: false },
} as const;

export type FinanceAttentionIssueType = keyof typeof FINANCE_ATTENTION_ISSUE_DEFINITIONS;
export type FinanceAttentionStatus = "OPEN" | "ACCEPTED" | "RESOLVED";

export function isFinanceAttentionIssueType(value: string): value is FinanceAttentionIssueType {
  return Object.hasOwn(FINANCE_ATTENTION_ISSUE_DEFINITIONS, value);
}

export function financeAttentionAcceptanceAllowed(type: FinanceAttentionIssueType) {
  return FINANCE_ATTENTION_ISSUE_DEFINITIONS[type].acceptanceAllowed;
}

export function deriveFinanceAttentionStatus(detected: boolean, persistedStatus: string | null | undefined): FinanceAttentionStatus {
  if (!detected) return "RESOLVED";
  return persistedStatus === "ACCEPTED" ? "ACCEPTED" : "OPEN";
}

export function countOpenFinanceAttentionIssues(issues: { status: FinanceAttentionStatus }[]) {
  return issues.filter((issue) => issue.status === "OPEN").length;
}
