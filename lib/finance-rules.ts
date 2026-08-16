export const PROJECT_EXPENSE_CATEGORIES = ["Материалы", "Работа / подряд", "Доставка и логистика", "Аренда оборудования", "Переделка / брак", "Прочее"] as const;
export const ADMIN_EXPENSE_CATEGORIES = ["Реклама", "Офис", "Бухгалтерия", "Программное обеспечение", "Инструмент", "Транспорт", "Связь", "Прочее"] as const;
export const INCOME_PURPOSES = ["MATERIALS", "WORKS", "ADDITIONAL_WORKS", "OTHER"] as const;

export type ExpenseKind = "PROJECT" | "ADMIN";
export type FinanceOperationType = "INCOME" | "EXPENSE" | "TRANSFER" | "REFUND";

export function parseAmountKopecks(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).replaceAll("\u00a0", "").replaceAll(" ", "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function validateExpense(expenseType: ExpenseKind, category: string, projectId?: string | null) {
  if (expenseType === "PROJECT") {
    if (!projectId) return "Для объектного расхода выберите объект.";
    if (!(PROJECT_EXPENSE_CATEGORIES as readonly string[]).includes(category)) return "Выберите категорию объектного расхода.";
    return null;
  }
  if (!(ADMIN_EXPENSE_CATEGORIES as readonly string[]).includes(category)) return "Выберите категорию административного расхода.";
  return null;
}

export function transferPreview(fromBalanceKopecks: number, toBalanceKopecks: number, amountKopecks: number) {
  return {
    fromAfterKopecks: fromBalanceKopecks - amountKopecks,
    toAfterKopecks: toBalanceKopecks + amountKopecks,
    warning: fromBalanceKopecks - amountKopecks < 0 ? "После перемещения баланс кассы-источника будет отрицательным." : null,
  };
}

export function cashboxDelta(type: FinanceOperationType, side: "SOURCE" | "DESTINATION" = "SOURCE") {
  if (type === "TRANSFER") return side === "SOURCE" ? -1 : 1;
  if (type === "EXPENSE") return -1;
  return 1;
}

export function projectLedgerTotals(incomeKopecks: number, expenseKopecks: number, refundKopecks: number) {
  const actualExpenseKopecks = expenseKopecks - refundKopecks;
  return { actualExpenseKopecks, clientBalanceKopecks: incomeKopecks - actualExpenseKopecks };
}
