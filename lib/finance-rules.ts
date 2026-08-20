import { FINANCE_CATEGORY_GROUPS, INCOME_PURPOSE_OPTIONS } from "./finance-categories.ts";

export const PROJECT_EXPENSE_CATEGORIES = FINANCE_CATEGORY_GROUPS.PROJECT.map((item) => item.code);
export const ADMIN_EXPENSE_CATEGORIES = FINANCE_CATEGORY_GROUPS.ADMIN.map((item) => item.code);
export const INCOME_PURPOSES = INCOME_PURPOSE_OPTIONS.map((item) => item.code);

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

export function validateAllocations(totalKopecks: number, allocations: { projectId: string; amountKopecks: number }[]) {
  if (allocations.length < 2) return "Для распределения выберите минимум два объекта.";
  if (allocations.some((item) => !item.projectId || !Number.isSafeInteger(item.amountKopecks) || item.amountKopecks <= 0)) return "У каждого объекта должна быть положительная сумма.";
  if (new Set(allocations.map((item) => item.projectId)).size !== allocations.length) return "Один объект нельзя добавить в распределение дважды.";
  if (allocations.reduce((sum, item) => sum + item.amountKopecks, 0) !== totalKopecks) return "Сумма распределения должна совпадать с общей суммой расхода.";
  return null;
}

export function projectPurposeBalances(values: { materialsIncomeKopecks: number; materialsExpenseKopecks: number; worksIncomeKopecks: number; worksExpenseKopecks: number }) {
  return {
    materialsBalanceKopecks: values.materialsIncomeKopecks - values.materialsExpenseKopecks,
    worksBalanceKopecks: values.worksIncomeKopecks - values.worksExpenseKopecks,
  };
}
