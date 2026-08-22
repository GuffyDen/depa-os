import { CLIENT_SOURCES } from "./client-config";

export const LEAD_SOURCES = CLIENT_SOURCES;
export const LEAD_STAGES = [
  { value: "NEW", label: "Новая заявка" }, { value: "CONTACTED", label: "Связались" },
  { value: "INSPECTION", label: "Приёмка" }, { value: "CALCULATION", label: "Расчёт ремонта" },
  { value: "PROPOSAL", label: "КП" }, { value: "CONTRACT", label: "Договор" },
  { value: "WON", label: "Успешно" }, { value: "LOST", label: "Отказ" },
] as const;
export const ACTIVE_LEAD_STAGES = LEAD_STAGES.filter((item) => !["WON", "LOST"].includes(item.value));
export const LEAD_ACTIONS = [
  ["CALL", "Позвонить"], ["SEND_PROPOSAL", "Отправить КП"], ["FOLLOW_UP_PROPOSAL", "Уточнить решение по КП"], ["FOLLOW_UP_CONTRACT", "Уточнить подписание договора"],
  ["SEND_CONTRACT", "Отправить договор"], ["FOLLOW_UP_CONTRACT", "Уточнить решение по договору"], ["REQUEST_PAYMENT", "Запросить оплату"],
  ["INSPECTION", "Приёмка"], ["MEETING", "Встреча"], ["OTHER", "Другое"],
] as const;
export const LOST_REASONS = [
  ["PRICE", "Цена"], ["COMPETITOR", "Выбрал другую компанию"], ["POSTPONED", "Отложил ремонт"],
  ["NO_CONTACT", "Не удалось связаться"], ["UNQUALIFIED", "Нецелевой лид"], ["OTHER", "Другое"],
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number]["value"];
export type LeadActionType = (typeof LEAD_ACTIONS)[number][0];
