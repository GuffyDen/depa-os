export const ORDER_TYPES = [
  { value: "INSPECTION", label: "Приёмка квартиры" },
  { value: "RENOVATION", label: "Ремонт квартиры" },
] as const;

export const ORDER_STATUSES = [
  { value: "NEW", label: "Новый" },
  { value: "SCHEDULED", label: "Назначен" },
  { value: "IN_PROGRESS", label: "В работе" },
  { value: "COMPLETED", label: "Выполнен" },
  { value: "CANCELLED", label: "Отменён" },
] as const;

export const PAYMENT_STATUSES = [
  { value: "UNPAID", label: "Не оплачен" },
  { value: "PARTIALLY_PAID", label: "Оплачен частично" },
  { value: "PAID", label: "Оплачен" },
] as const;

export const DEFECT_CATEGORIES = [
  ["WALLS", "Стены"], ["FLOOR", "Пол"], ["CEILING", "Потолок"], ["WINDOWS", "Окна"], ["DOORS", "Двери"],
  ["ELECTRICAL", "Электрика"], ["PLUMBING", "Сантехника"], ["VENTILATION", "Вентиляция"], ["FINISHING", "Отделка"], ["OTHER", "Другое"],
] as const;

export const DEFECT_SEVERITIES = [["LOW", "Незначительное"], ["MEDIUM", "Требует устранения"], ["HIGH", "Критичное"]] as const;
export type OrderType = (typeof ORDER_TYPES)[number]["value"];
export type OrderStatus = (typeof ORDER_STATUSES)[number]["value"];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]["value"];
