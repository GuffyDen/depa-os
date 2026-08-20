export const FINANCE_CATEGORY_GROUPS = {
  PROJECT: [
    { code: "MATERIALS", label: "Материалы", receiptRequired: true },
    { code: "CONTRACTOR_WORK", label: "Работа / подряд", receiptRequired: true },
    { code: "DELIVERY", label: "Доставка и логистика", receiptRequired: true },
    { code: "EQUIPMENT_RENTAL", label: "Аренда оборудования", receiptRequired: true },
    { code: "REWORK", label: "Переделка / брак", receiptRequired: true },
    { code: "OTHER", label: "Прочее", receiptRequired: false },
  ],
  ADMIN: [
    { code: "ADVERTISING", label: "Реклама", receiptRequired: true },
    { code: "OFFICE", label: "Офис", receiptRequired: true },
    { code: "ACCOUNTING", label: "Бухгалтерия", receiptRequired: true },
    { code: "SOFTWARE", label: "Программное обеспечение", receiptRequired: true },
    { code: "TOOLS", label: "Инструмент", receiptRequired: true },
    { code: "TRANSPORT", label: "Транспорт", receiptRequired: true },
    { code: "COMMUNICATION", label: "Связь", receiptRequired: true },
    { code: "OTHER", label: "Прочее", receiptRequired: false },
  ],
} as const;

export type ProjectExpenseCategory = (typeof FINANCE_CATEGORY_GROUPS.PROJECT)[number]["code"];
export type AdminExpenseCategory = (typeof FINANCE_CATEGORY_GROUPS.ADMIN)[number]["code"];
export type ExpenseCategory = ProjectExpenseCategory | AdminExpenseCategory;

export const INCOME_PURPOSE_OPTIONS = [
  { code: "MATERIALS", label: "Материалы" },
  { code: "WORKS", label: "Работы" },
  { code: "ADDITIONAL_WORKS", label: "Дополнительные работы" },
  { code: "OTHER", label: "Другое" },
] as const;

export function financeCategoryLabel(code: string) {
  return [...FINANCE_CATEGORY_GROUPS.PROJECT, ...FINANCE_CATEGORY_GROUPS.ADMIN].find((item) => item.code === code)?.label ?? code;
}

export function financePurposeLabel(code: string | null | undefined) {
  return INCOME_PURPOSE_OPTIONS.find((item) => item.code === code)?.label ?? code ?? "";
}

export function categoryRequiresReceipt(code: string) {
  return [...FINANCE_CATEGORY_GROUPS.PROJECT, ...FINANCE_CATEGORY_GROUPS.ADMIN].some((item) => item.code === code && item.receiptRequired);
}
