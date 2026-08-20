export const CLIENT_SOURCES = [
  { value: "WEBSITE", label: "Сайт" },
  { value: "FARPOST", label: "FarPost" },
  { value: "AVITO", label: "Avito" },
  { value: "REFERRAL", label: "Сарафанное радио" },
  { value: "OTHER", label: "Другое" },
] as const;

export type ClientSource = (typeof CLIENT_SOURCES)[number]["value"];

export function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}
