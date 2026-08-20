export const PROJECT_STATUSES = [
  { value: "PLANNING", label: "Подготовка" },
  { value: "ACTIVE", label: "В работе" },
  { value: "PAUSED", label: "Приостановлен" },
  { value: "COMPLETED", label: "Завершён" },
  { value: "ARCHIVED", label: "Архив" },
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]["value"];

export function buildProjectName(residentialComplex: string | null, address: string, apartment: string) {
  return residentialComplex ? `ЖК ${residentialComplex} · кв. ${apartment}` : `${address} · кв. ${apartment}`;
}
