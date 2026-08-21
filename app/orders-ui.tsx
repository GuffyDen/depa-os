"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { AuthUser } from "../lib/auth";
import type { AccessProfile } from "../lib/permission-definitions";
import { calendarRange, InspectionCalendar } from "./inspection-calendar";

export type User = { id: string; name: string };
type Client = { id: string; fullName: string; phone: string };
export type SchedulePreset = {
  date: string;
  startTime: string;
  endTime: string;
};
export type ScheduleConflict = {
  orderId: string | null;
  orderNumber: string | null;
  clientName: string | null;
  residentialComplex: string | null;
  address: string | null;
  apartmentNumber: string | null;
  scheduledStartAt: number;
  scheduledEndAt: number;
  detailsRestricted: boolean;
};
export type Order = {
  id: string;
  orderNumber: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  type: string;
  title: string;
  priceKopecks: number;
  status: string;
  responsibleUserId: string;
  responsibleName: string;
  scheduledAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  cancelledAt: number | null;
  comment: string | null;
  internalComment: string | null;
  createdAt: number;
  updatedAt: number;
  paidKopecks: number;
  remainingKopecks: number;
  overpaymentKopecks: number;
  paymentStatus: string;
  inspection: {
    id: string;
    residentialComplex: string | null;
    address: string;
    apartmentNumber: string;
    areaSqm: number | null;
    scheduledAt: number | null;
    scheduledStartAt: number | null;
    scheduledEndAt: number | null;
    inspectorUserId: string;
    inspectorName: string;
    resultComment: string | null;
  } | null;
  defectCount: number;
  photoCount: number;
};
type Defect = {
  id: string;
  room: string;
  category: string;
  description: string;
  severity: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  photoCount: number;
};
type Detail = {
  order: Order;
  defects: Defect[];
  files: {
    id: string;
    originalFilename: string;
    entityType: string;
    entityId: string | null;
    createdAt: number;
  }[];
  finances: {
    id: string;
    amountKopecks: number;
    transactionDate: number;
    title: string;
    cashboxName: string;
  }[];
  history: {
    id: string;
    action: string;
    occurredAt: number;
    actorName: string;
    metadata: unknown;
  }[];
  capabilities: { edit: boolean; addPayment: boolean; upload: boolean };
};
type ListData = {
  items: Order[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
  responsibleUsers: User[];
  types: { value: string; label: string }[];
  statuses: { value: string; label: string }[];
};
export type CalendarData = {
  items: Order[];
  inspectors: User[];
  rangeStart: number;
  rangeEnd: number;
};
const VLADIVOSTOK_OFFSET_SECONDS = 10 * 3600;
const STATUS: Record<string, string> = {
  NEW: "Новый",
  SCHEDULED: "Назначен",
  IN_PROGRESS: "В работе",
  COMPLETED: "Выполнен",
  CANCELLED: "Отменён",
};
const PAYMENT: Record<string, string> = {
  UNPAID: "Не оплачен",
  PARTIALLY_PAID: "Оплачен частично",
  PAID: "Оплачен",
};
const TYPE: Record<string, string> = {
  INSPECTION: "Приёмка квартиры",
  RENOVATION: "Ремонт квартиры",
};
const CATEGORY: Record<string, string> = {
  WALLS: "Стены",
  FLOOR: "Пол",
  CEILING: "Потолок",
  WINDOWS: "Окна",
  DOORS: "Двери",
  ELECTRICAL: "Электрика",
  PLUMBING: "Сантехника",
  VENTILATION: "Вентиляция",
  FINISHING: "Отделка",
  OTHER: "Другое",
};
const SEVERITY: Record<string, string> = {
  LOW: "Незначительное",
  MEDIUM: "Требует устранения",
  HIGH: "Критичное",
};
const HISTORY: Record<string, string> = {
  ORDER_CREATED: "Заказ создан",
  ORDER_UPDATED: "Заказ обновлён",
  ORDER_CANCELLED: "Заказ отменён",
  INSPECTION_CREATED: "Приёмка создана",
  INSPECTION_STARTED: "Приёмка начата",
  INSPECTION_COMPLETED: "Приёмка завершена",
  INSPECTION_DEFECT_CREATED: "Добавлено замечание",
  INSPECTION_DEFECT_STATUS_CHANGED: "Изменён статус замечания",
  ATTACHMENT_LINKED: "Добавлен файл",
};
function money(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value / 100);
}
function date(value: number | null, time = false) {
  return value
    ? new Date(value * 1000).toLocaleString(
        "ru-RU",
        time
          ? {
              timeZone: "Asia/Vladivostok",
              day: "2-digit",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }
          : {
              timeZone: "Asia/Vladivostok",
              day: "2-digit",
              month: "short",
              year: "numeric",
            },
      )
    : "—";
}
export function clock(value: number | null) {
  return value
    ? new Date(value * 1000).toLocaleTimeString("ru-RU", {
        timeZone: "Asia/Vladivostok",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
export function dateKeyFromEpoch(value: number) {
  return new Date((value + VLADIVOSTOK_OFFSET_SECONDS) * 1000)
    .toISOString()
    .slice(0, 10);
}
export function todayKey() {
  return dateKeyFromEpoch(Math.floor(Date.now() / 1000));
}
export function dateKeyToEpoch(value: string, time = "00:00") {
  return Math.floor(new Date(`${value}T${time}:00+10:00`).getTime() / 1000);
}
function timeFromMinutes(minutes: number) {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}
export function schedulePreset(
  dateValue = todayKey(),
  startTime = "10:00",
): SchedulePreset {
  const [hours, minutes] = startTime.split(":").map(Number);
  return {
    date: dateValue,
    startTime,
    endTime: timeFromMinutes(hours * 60 + minutes + 90),
  };
}
export function rangeLabel(order: Order) {
  return `${clock(order.inspection?.scheduledStartAt ?? order.scheduledAt)}–${clock(order.inspection?.scheduledEndAt ?? null)}`;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public conflict?: ScheduleConflict,
  ) {
    super(message);
  }
}
async function json<T>(response: Response) {
  const data = (await response.json()) as T & {
    error?: string;
    code?: string;
    conflict?: ScheduleConflict;
  };
  if (!response.ok)
    throw new ApiError(
      data.error || "Не удалось выполнить операцию.",
      response.status,
      data.code,
      data.conflict,
    );
  return data;
}

function ConflictWarning({
  conflict,
  busy,
  onChangeTime,
  onConfirm,
}: {
  conflict: ScheduleConflict;
  busy: boolean;
  onChangeTime: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="schedule-conflict" role="alert">
      <span className="eyebrow">КОНФЛИКТ РАСПИСАНИЯ</span>
      <h4>Специалист уже назначен на это время</h4>
      <p>
        <b>
          {clock(conflict.scheduledStartAt)}–{clock(conflict.scheduledEndAt)}
        </b>
        {conflict.detailsRestricted
          ? " · детали другой приёмки скрыты правами доступа"
          : ` · ${conflict.residentialComplex ? `ЖК ${conflict.residentialComplex} · ` : ""}${conflict.address} · кв. ${conflict.apartmentNumber}`}
      </p>
      <div>
        <button type="button" className="secondary" onClick={onChangeTime}>
          Изменить время
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "Сохраняем…" : "Сохранить всё равно"}
        </button>
      </div>
    </section>
  );
}

async function compressPhoto(file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size < 1_500_000
  )
    return file;
  try {
    const bitmap = await createImageBitmap(file),
      scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    return blob
      ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
          type: "image/jpeg",
        })
      : file;
  } catch {
    return file;
  }
}
async function uploadPhoto(
  file: File,
  entityType: "Inspection" | "InspectionDefect",
  entityId: string,
) {
  const prepared = await compressPhoto(file),
    mimeType = prepared.type.toLowerCase(),
    ext: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "image/heif": "heif",
    };
  if (!ext[mimeType]) throw new Error("Разрешены JPG, PNG, WebP и HEIC/HEIF.");
  if (prepared.size > 20 * 1024 * 1024)
    throw new Error("Фотография должна быть не больше 20 МБ.");
  const attachmentId = crypto.randomUUID(),
    digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", await prepared.arrayBuffer()),
    ),
    checksumSha256 = Array.from(digest, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
    pathname = `depa-os/inspection/${attachmentId}.${ext[mimeType]}`,
    { upload } = await import("@vercel/blob/client");
  await upload(pathname, prepared, {
    access: "private",
    handleUploadUrl: "/api/files/upload",
    contentType: mimeType,
    multipart: prepared.size > 5 * 1024 * 1024,
    clientPayload: JSON.stringify({
      attachmentId,
      originalFilename: prepared.name,
      mimeType,
      sizeBytes: prepared.size,
      checksumSha256,
      category: "INSPECTION",
      visibility: "INTERNAL",
      entityType,
      entityId,
      projectId: null,
    }),
  });
  return attachmentId;
}

function OrderForm({
  currentUser,
  access,
  users,
  initialClientId,
  initialSchedule,
  onClose,
  onSaved,
}: {
  currentUser: AuthUser;
  access: AccessProfile;
  users: User[];
  initialClientId?: string | null;
  initialSchedule?: SchedulePreset | null;
  onClose: () => void;
  onSaved: (detail: Detail) => void;
}) {
  const [query, setQuery] = useState(""),
    [clients, setClients] = useState<Client[]>([]),
    [clientId, setClientId] = useState(initialClientId || ""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [conflict, setConflict] = useState<ScheduleConflict | null>(null),
    formRef = useRef<HTMLFormElement>(null),
    startRef = useRef<HTMLInputElement>(null),
    preset = initialSchedule || schedulePreset();
  useEffect(() => {
    if (initialClientId) return;
    if (!query.trim()) return;
    const controller = new AbortController(),
      timer = setTimeout(
        () =>
          fetch(
            `/api/clients?search=${encodeURIComponent(query)}&status=ACTIVE&limit=8`,
            { signal: controller.signal },
          )
            .then((r) => json<{ items: Client[] }>(r))
            .then((d) => setClients(d.items))
            .catch(() => undefined),
        220,
      );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, initialClientId]);
  async function save(form: HTMLFormElement, allowConflict: boolean) {
    setSaving(true);
    setError("");
    if (!allowConflict) setConflict(null);
    const values = Object.fromEntries(new FormData(form)),
      scheduledStartAt = dateKeyToEpoch(
        String(values.scheduleDate),
        String(values.startTime),
      ),
      scheduledEndAt = dateKeyToEpoch(
        String(values.scheduleDate),
        String(values.endTime),
      );
    try {
      onSaved(
        await json<Detail>(
          await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...values,
              clientId,
              scheduledStartAt,
              scheduledEndAt,
              allowConflict,
              type: "INSPECTION",
            }),
          }),
        ),
      );
    } catch (reason) {
      if (
        reason instanceof ApiError &&
        reason.code === "SCHEDULE_CONFLICT" &&
        reason.conflict
      )
        setConflict(reason.conflict);
      else
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось создать приёмку.",
        );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div
      className="modal-wrap order-drawer-wrap"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="order-drawer">
        <header>
          <div>
            <span className="eyebrow">НОВЫЙ ЗАКАЗ</span>
            <h3>Приёмка квартиры</h3>
          </div>
          <button aria-label="Закрыть форму" onClick={onClose}>×</button>
        </header>
        <form
          ref={formRef}
          className="order-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save(event.currentTarget, false);
          }}
        >
          <label className="wide">
            <span>Клиент *</span>
            {initialClientId ? (
              <input value="Клиент выбран из карточки" readOnly />
            ) : (
              <>
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setClientId("");
                    if (!e.target.value.trim()) setClients([]);
                  }}
                  placeholder="ФИО или телефон"
                  required={!clientId}
                />
                {clients.map((c) => (
                  <button
                    type="button"
                    className={
                      clientId === c.id
                        ? "client-option selected"
                        : "client-option"
                    }
                    key={c.id}
                    onClick={() => {
                      setClientId(c.id);
                      setQuery(`${c.fullName} · ${c.phone}`);
                      setClients([]);
                    }}
                  >
                    <b>{c.fullName}</b>
                    <span>{c.phone}</span>
                  </button>
                ))}
              </>
            )}
          </label>
          <label>
            <span>ЖК</span>
            <input name="residentialComplex" />
          </label>
          <label>
            <span>Адрес *</span>
            <input name="address" required />
          </label>
          <label>
            <span>Квартира *</span>
            <input name="apartmentNumber" required />
          </label>
          <label>
            <span>Площадь, м²</span>
            <input name="areaSqm" inputMode="decimal" />
          </label>
          <fieldset className="wide schedule-fields">
            <legend>Расписание</legend>
            <label>
              <span>Дата *</span>
              <input
                name="scheduleDate"
                type="date"
                defaultValue={preset.date}
                required
              />
            </label>
            <label>
              <span>Начало *</span>
              <input
                ref={startRef}
                name="startTime"
                type="time"
                step="900"
                defaultValue={preset.startTime}
                required
              />
            </label>
            <label>
              <span>Окончание *</span>
              <input
                name="endTime"
                type="time"
                step="900"
                defaultValue={preset.endTime}
                required
              />
            </label>
          </fieldset>
          <label>
            <span>Стоимость *</span>
            <input
              name="price"
              inputMode="decimal"
              required
              placeholder="7 000"
            />
          </label>
          <label>
            <span>Ответственный *</span>
            <select
              name="responsibleUserId"
              defaultValue={currentUser.id}
              disabled={!access.actions["orders.edit"]}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Приёмку проводит *</span>
            <select name="inspectorUserId" defaultValue={currentUser.id}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            <span>Комментарий клиента / менеджера</span>
            <textarea name="comment" rows={4} />
          </label>
          <label className="wide">
            <span>Внутренний комментарий</span>
            <textarea name="internalComment" rows={3} />
          </label>
          {conflict ? (
            <div className="wide">
              <ConflictWarning
                conflict={conflict}
                busy={saving}
                onChangeTime={() => {
                  setConflict(null);
                  startRef.current?.focus();
                }}
                onConfirm={() => {
                  if (formRef.current) void save(formRef.current, true);
                }}
              />
            </div>
          ) : null}
          {error ? (
            <div className="form-error wide" role="alert">
              {error}
            </div>
          ) : null}
          <div className="order-form-actions wide">
            <button type="button" className="secondary" onClick={onClose}>
              Отмена
            </button>
            <button className="primary" disabled={saving || !clientId}>
              {saving ? "Создаём…" : "Создать приёмку"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function ScheduleEditor({
  order,
  users,
  busy,
  onSave,
}: {
  order: Order;
  users: User[];
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<Detail | null>;
}) {
  const inspection = order.inspection,
    formRef = useRef<HTMLFormElement>(null),
    startRef = useRef<HTMLInputElement>(null),
    [conflict, setConflict] = useState<ScheduleConflict | null>(null),
    [error, setError] = useState("");
  if (!inspection?.scheduledStartAt || !inspection.scheduledEndAt) return null;
  const preset = {
    date: dateKeyFromEpoch(inspection.scheduledStartAt),
    startTime: clock(inspection.scheduledStartAt),
    endTime: clock(inspection.scheduledEndAt),
  };
  async function save(form: HTMLFormElement, allowConflict: boolean) {
    setError("");
    if (!allowConflict) setConflict(null);
    const values = Object.fromEntries(new FormData(form));
    try {
      const saved = await onSave({
        inspectorUserId: values.inspectorUserId,
        scheduledStartAt: dateKeyToEpoch(
          String(values.scheduleDate),
          String(values.startTime),
        ),
        scheduledEndAt: dateKeyToEpoch(
          String(values.scheduleDate),
          String(values.endTime),
        ),
        allowConflict,
      });
      if (saved) setConflict(null);
    } catch (reason) {
      if (
        reason instanceof ApiError &&
        reason.code === "SCHEDULE_CONFLICT" &&
        reason.conflict
      )
        setConflict(reason.conflict);
      else
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось изменить расписание.",
        );
    }
  }
  return (
    <form
      ref={formRef}
      className="panel schedule-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save(event.currentTarget, false);
      }}
    >
      <div>
        <span className="eyebrow">ДАТА И ВРЕМЯ ПРИЁМКИ</span>
        <p>Перенос выполняется здесь, без drag &amp; drop.</p>
      </div>
      <div className="schedule-editor-fields">
        <label>
          <span>Дата</span>
          <input
            name="scheduleDate"
            type="date"
            defaultValue={preset.date}
            required
          />
        </label>
        <label>
          <span>Начало</span>
          <input
            ref={startRef}
            name="startTime"
            type="time"
            step="900"
            defaultValue={preset.startTime}
            required
          />
        </label>
        <label>
          <span>Окончание</span>
          <input
            name="endTime"
            type="time"
            step="900"
            defaultValue={preset.endTime}
            required
          />
        </label>
        <label>
          <span>Специалист</span>
          <select
            name="inspectorUserId"
            defaultValue={inspection.inspectorUserId}
          >
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {conflict ? (
        <ConflictWarning
          conflict={conflict}
          busy={busy}
          onChangeTime={() => {
            setConflict(null);
            startRef.current?.focus();
          }}
          onConfirm={() => {
            if (formRef.current) void save(formRef.current, true);
          }}
        />
      ) : null}
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <button className="secondary" disabled={busy}>
        {busy ? "Сохраняем…" : "Сохранить расписание"}
      </button>
    </form>
  );
}

function OrderCard({
  id,
  users,
  onClose,
  onChanged,
  onPayment,
}: {
  id: string;
  users: User[];
  onClose: () => void;
  onChanged: () => void;
  onPayment: (order: Order) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null),
    [tab, setTab] = useState("overview"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [defectForm, setDefectForm] = useState(false);
  async function load() {
    setDetail(
      await json<Detail>(
        await fetch(`/api/orders/${id}`, { cache: "no-store" }),
      ),
    );
  }
  useEffect(() => {
    let active = true;
    fetch(`/api/orders/${id}`, { cache: "no-store" })
      .then((r) => json<Detail>(r))
      .then((next) => {
        if (active) setDetail(next);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function patch(payload: Record<string, unknown>, throwError = false) {
    setBusy(true);
    setError("");
    try {
      const next = await json<Detail>(
        await fetch(`/api/orders/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      setDetail(next);
      onChanged();
      return next;
    } catch (e) {
      if (throwError) throw e;
      setError(e instanceof Error ? e.message : "Не удалось сохранить.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function filesChanged(files: FileList | null, defectId?: string) {
    if (!detail?.order.inspection || !files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const attachmentId = await uploadPhoto(
          file,
          defectId ? "InspectionDefect" : "Inspection",
          defectId || detail.order.inspection.id,
        );
        await patch({ action: "LINK_ATTACHMENT", attachmentId, defectId });
      }
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить фотографию.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function createDefect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      files = form.elements.namedItem("photos") as HTMLInputElement,
      next = await patch({
        action: "CREATE_DEFECT",
        ...Object.fromEntries(new FormData(form)),
      });
    if (next) {
      const created = next.defects[0];
      if (files.files?.length && created)
        await filesChanged(files.files, created.id);
      setDefectForm(false);
    }
  }
  if (!detail)
    return (
      <div className="modal-wrap order-drawer-wrap">
        <aside className="order-card">
          <header>
            <h3>Заказ</h3>
            <button aria-label="Закрыть карточку" onClick={onClose}>×</button>
          </header>
          <div className={error ? "form-error" : "finance-loading"}>
            {error || "Загружаем заказ…"}
          </div>
        </aside>
      </div>
    );
  const o = detail.order,
    i = o.inspection,
    tabs = [
      ["overview", "Обзор"],
      ["inspection", "Приёмка"],
      ["finance", "Финансы"],
      ["files", "Файлы"],
      ["history", "История"],
    ];
  return (
    <div
      className="modal-wrap order-drawer-wrap"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="order-card">
        <header className="order-card-head">
          <button className="back" onClick={onClose}>
            ← Заказы
          </button>
          <div>
            <span className={`order-status status-${o.status.toLowerCase()}`}>
              {STATUS[o.status]}
            </span>
            <span className="eyebrow">{TYPE[o.type]}</span>
            <h2>{o.orderNumber}</h2>
            <span className="client-link">
              {o.clientName} · {o.clientPhone}
            </span>
          </div>
          <div className="order-card-actions">
            {detail.capabilities.addPayment && o.remainingKopecks > 0 ? (
              <button className="primary" onClick={() => onPayment(o)}>
                ＋ Добавить оплату
              </button>
            ) : null}
            {detail.capabilities.edit &&
            ["NEW", "SCHEDULED"].includes(o.status) ? (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void patch({ action: "START" })}
              >
                Начать приёмку
              </button>
            ) : null}
            {detail.capabilities.edit && o.status === "IN_PROGRESS" ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      `Завершить приёмку?\nЗамечаний: ${o.defectCount}\nФотографий: ${o.photoCount}\nКомментарий: ${i?.resultComment ? "заполнен" : "нет"}`,
                    )
                  )
                    void patch({ action: "COMPLETE" });
                }}
              >
                Завершить приёмку
              </button>
            ) : null}
            <button aria-label="Закрыть карточку" onClick={onClose}>×</button>
          </div>
        </header>
        {error ? <div className="form-error order-error">{error}</div> : null}
        <nav className="order-tabs">
          {tabs.map(([key, label]) => (
            <button
              className={tab === key ? "active" : ""}
              key={key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="order-card-content">
          {tab === "overview" ? (
            <div className="order-overview">
              <section className="panel order-facts">
                <div>
                  <span>Клиент</span>
                  <b>{o.clientName}</b>
                </div>
                <div>
                  <span>Услуга</span>
                  <b>{TYPE[o.type]}</b>
                </div>
                <div>
                  <span>Дата и время</span>
                  <b>
                    {date(i?.scheduledStartAt ?? o.scheduledAt)} ·{" "}
                    {rangeLabel(o)}
                  </b>
                </div>
                <div>
                  <span>Проводит</span>
                  <b>{i?.inspectorName || "—"}</b>
                </div>
                <div>
                  <span>Ответственный</span>
                  <b>{o.responsibleName}</b>
                </div>
                <div>
                  <span>Статус</span>
                  <b>{STATUS[o.status]}</b>
                </div>
              </section>
              <section className="order-money">
                <article className="panel">
                  <span>Стоимость</span>
                  <b>{money(o.priceKopecks)}</b>
                </article>
                <article className="panel">
                  <span>Оплачено</span>
                  <b>{money(o.paidKopecks)}</b>
                </article>
                <article className="panel">
                  <span>{o.overpaymentKopecks ? "Переплата" : "Остаток"}</span>
                  <b>{money(o.overpaymentKopecks || o.remainingKopecks)}</b>
                  <small>{PAYMENT[o.paymentStatus]}</small>
                </article>
              </section>
              <section className="panel order-address">
                <span className="eyebrow">АДРЕС УСЛУГИ</span>
                <h3>
                  {i?.residentialComplex ? `ЖК ${i.residentialComplex} · ` : ""}
                  кв. {i?.apartmentNumber}
                </h3>
                <p>
                  {i?.address} {i?.areaSqm ? `· ${i.areaSqm} м²` : ""}
                </p>
              </section>
              <section className="panel order-comment">
                <span className="eyebrow">КОММЕНТАРИЙ КЛИЕНТА / МЕНЕДЖЕРА</span>
                <p>{o.comment || "Комментарий не добавлен."}</p>
              </section>
              <section className="panel order-comment">
                <span className="eyebrow">ВНУТРЕННИЙ КОММЕНТАРИЙ</span>
                <p>
                  {o.internalComment || "Внутренний комментарий не добавлен."}
                </p>
              </section>
            </div>
          ) : null}
          {tab === "inspection" ? (
            <div className="inspection-tab">
              <section className="panel inspection-summary">
                <div>
                  <span>Дата и время</span>
                  <b>
                    {date(i?.scheduledStartAt ?? o.scheduledAt)} ·{" "}
                    {rangeLabel(o)}
                  </b>
                </div>
                <div>
                  <span>Адрес</span>
                  <b>
                    {i?.address} · кв. {i?.apartmentNumber}
                  </b>
                </div>
                <div>
                  <span>Площадь</span>
                  <b>{i?.areaSqm ? `${i.areaSqm} м²` : "—"}</b>
                </div>
                <div>
                  <span>Проводит</span>
                  <b>{i?.inspectorName}</b>
                </div>
                <div>
                  <span>Статус</span>
                  <b>{STATUS[o.status]}</b>
                </div>
              </section>
              {detail.capabilities.edit ? (
                <ScheduleEditor
                  order={o}
                  users={users}
                  busy={busy}
                  onSave={(payload) => patch(payload, true)}
                />
              ) : null}
              <form
                className="panel inspection-result"
                onSubmit={(e) => {
                  e.preventDefault();
                  void patch({
                    resultComment: new FormData(e.currentTarget).get(
                      "resultComment",
                    ),
                  });
                }}
              >
                <span className="eyebrow">РЕЗУЛЬТАТ ПРИЁМКИ</span>
                <textarea
                  name="resultComment"
                  defaultValue={i?.resultComment || ""}
                  rows={5}
                  placeholder="Комментарий / заключение"
                  disabled={!detail.capabilities.edit}
                />
                {detail.capabilities.edit ? (
                  <button className="secondary">Сохранить результат</button>
                ) : null}
              </form>
              <section className="defects-head">
                <div>
                  <span className="eyebrow">ЗАМЕЧАНИЯ</span>
                  <h3>{o.defectCount}</h3>
                </div>
                {detail.capabilities.edit ? (
                  <button
                    className="primary"
                    onClick={() => setDefectForm(!defectForm)}
                  >
                    ＋ Добавить замечание
                  </button>
                ) : null}
              </section>
              {defectForm ? (
                <form className="panel defect-form" onSubmit={createDefect}>
                  <input name="room" required placeholder="Помещение" />
                  <select name="category" defaultValue="WALLS">
                    {Object.entries(CATEGORY).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <select name="severity" defaultValue="MEDIUM">
                    {Object.entries(SEVERITY).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <textarea
                    name="description"
                    required
                    placeholder="Описание замечания"
                  />
                  <label className="order-upload">
                    <input
                      name="photos"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                    />
                    <span>＋ Фотографии</span>
                  </label>
                  <button className="primary" disabled={busy}>
                    Сохранить замечание
                  </button>
                </form>
              ) : null}
              <div className="defect-list">
                {detail.defects.map((d) => (
                  <article className="panel" key={d.id}>
                    <header>
                      <span
                        className={`severity severity-${d.severity.toLowerCase()}`}
                      >
                        {SEVERITY[d.severity]}
                      </span>
                      <b>
                        {d.room} · {CATEGORY[d.category]}
                      </b>
                    </header>
                    <p>{d.description}</p>
                    <footer>
                      <span>{d.photoCount} фото</span>
                      {detail.capabilities.upload ? (
                        <label className="link">
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            multiple
                            onChange={(e) =>
                              void filesChanged(e.target.files, d.id)
                            }
                          />
                          ＋ Фото
                        </label>
                      ) : null}
                      {detail.capabilities.edit ? (
                        <button
                          className="link"
                          onClick={() =>
                            void patch({
                              action: "UPDATE_DEFECT",
                              defectId: d.id,
                              status: d.status === "OPEN" ? "RESOLVED" : "OPEN",
                            })
                          }
                        >
                          {d.status === "OPEN"
                            ? "Отметить устранённым"
                            : "Вернуть в работу"}
                        </button>
                      ) : null}
                    </footer>
                  </article>
                ))}
              </div>
              {!detail.defects.length && !defectForm ? (
                <div className="order-empty-small">Замечаний пока нет.</div>
              ) : null}
            </div>
          ) : null}
          {tab === "finance" ? (
            <div className="order-finance">
              <section className="order-money">
                <article className="panel">
                  <span>Стоимость</span>
                  <b>{money(o.priceKopecks)}</b>
                </article>
                <article className="panel">
                  <span>Оплачено</span>
                  <b>{money(o.paidKopecks)}</b>
                </article>
                <article className="panel">
                  <span>Остаток</span>
                  <b>{money(o.remainingKopecks)}</b>
                </article>
              </section>
              {detail.finances.map((f) => (
                <article className="panel finance-order-row" key={f.id}>
                  <div>
                    <b>{f.title}</b>
                    <span>
                      {f.cashboxName} · {date(f.transactionDate)}
                    </span>
                  </div>
                  <strong>{money(f.amountKopecks)}</strong>
                </article>
              ))}
              {!detail.finances.length ? (
                <div className="order-empty-small">
                  Поступлений по заказу пока нет.
                </div>
              ) : null}
            </div>
          ) : null}
          {tab === "files" ? (
            <div className="order-files">
              {detail.capabilities.upload ? (
                <label className="panel order-photo-upload">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    onChange={(e) => void filesChanged(e.target.files)}
                  />
                  <span>＋ Добавить фотографии приёмки</span>
                  <small>Камера или галерея · несколько файлов</small>
                </label>
              ) : null}
              {detail.files.map((f) => (
                <a
                  className="panel order-file"
                  href={`/api/files/${f.id}`}
                  target="_blank"
                  rel="noreferrer"
                  key={f.id}
                >
                  <span>▱</span>
                  <div>
                    <b>{f.originalFilename}</b>
                    <small>
                      {f.entityType === "InspectionDefect"
                        ? "Фото замечания"
                        : "Фото приёмки"}{" "}
                      · {date(f.createdAt)}
                    </small>
                  </div>
                </a>
              ))}
              {!detail.files.length ? (
                <div className="order-empty-small">Файлов пока нет.</div>
              ) : null}
            </div>
          ) : null}
          {tab === "history" ? (
            <div className="panel order-history">
              {detail.history.map((h) => (
                <article key={h.id}>
                  <i>•</i>
                  <div>
                    <b>{HISTORY[h.action] || h.action}</b>
                    <span>
                      {h.actorName} · {date(h.occurredAt, true)}
                    </span>
                  </div>
                </article>
              ))}
              {!detail.history.length ? (
                <div className="order-empty-small">История пока пуста.</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

export function OrdersScreen({
  currentUser,
  access,
  initialOrderId = null,
  initialClientId = null,
  onOrderClosed,
  onPayment,
}: {
  currentUser: AuthUser;
  access: AccessProfile;
  initialOrderId?: string | null;
  initialClientId?: string | null;
  onOrderClosed?: () => void;
  onPayment: (order: Order) => void;
}) {
  const [items, setItems] = useState<Order[]>([]),
    [meta, setMeta] = useState<Omit<ListData, "items"> | null>(null),
    [search, setSearch] = useState(""),
    [type, setType] = useState("ALL"),
    [status, setStatus] = useState("ALL"),
    [payment, setPayment] = useState("ALL"),
    [responsible, setResponsible] = useState("ALL"),
    [period, setPeriod] = useState("ALL"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [form, setForm] = useState(Boolean(initialClientId)),
    [formPreset, setFormPreset] = useState<SchedulePreset | null>(null),
    [openId, setOpenId] = useState<string | null>(initialOrderId),
    [revision, setRevision] = useState(0),
    [view, setView] = useState<"list" | "calendar">("list"),
    [calendarLevel, setCalendarLevel] = useState<"month" | "day">("month"),
    [selectedDate, setSelectedDate] = useState(todayKey()),
    [selectedInspector, setSelectedInspector] = useState("ALL"),
    [calendarItems, setCalendarItems] = useState<Order[]>([]),
    [calendarUsers, setCalendarUsers] = useState<User[]>([]),
    [calendarLoading, setCalendarLoading] = useState(false),
    [calendarError, setCalendarError] = useState("");
  useEffect(() => {
    const controller = new AbortController(),
      timer = setTimeout(() => {
        setLoading(true);
        const p = new URLSearchParams({
          search,
          type,
          status,
          payment,
          responsibleUserId: responsible,
          period,
          from,
          to,
          limit: "30",
          offset: "0",
        });
        fetch(`/api/orders?${p}`, {
          cache: "no-store",
          signal: controller.signal,
        })
          .then((r) => json<ListData>(r))
          .then((d) => {
            setItems(d.items);
            const { items: _, ...rest } = d;
            void _;
            setMeta(rest);
          })
          .catch((e) => {
            if (e.name !== "AbortError") setError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, type, status, payment, responsible, period, from, to, revision]);
  useEffect(() => {
    if (view !== "calendar") return;
    const controller = new AbortController(),
      { rangeStart, rangeEnd } = calendarRange(selectedDate, calendarLevel),
      params = new URLSearchParams({
        view: "calendar",
        rangeStart: String(rangeStart),
        rangeEnd: String(rangeEnd),
        inspectorUserId: selectedInspector,
      }),
      timer = setTimeout(() => {
        setCalendarLoading(true);
        setCalendarError("");
        fetch(`/api/orders?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        })
          .then((response) => json<CalendarData>(response))
          .then((data) => {
            setCalendarItems(data.items);
            setCalendarUsers(data.inspectors);
          })
          .catch((reason) => {
            if (reason.name !== "AbortError") setCalendarError(reason.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setCalendarLoading(false);
          });
      }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [view, calendarLevel, selectedDate, selectedInspector, revision]);
  async function more() {
    if (meta?.nextOffset == null) return;
    const p = new URLSearchParams({
        search,
        type,
        status,
        payment,
        responsibleUserId: responsible,
        period,
        from,
        to,
        limit: "30",
        offset: String(meta.nextOffset),
      }),
      d = await json<ListData>(await fetch(`/api/orders?${p}`));
    setItems((x) => [...x, ...d.items]);
    const { items: _, ...rest } = d;
    void _;
    setMeta(rest);
  }
  function openCreate(preset: SchedulePreset | null = null) {
    setFormPreset(preset);
    setForm(true);
  }
  const users = calendarUsers.length
    ? calendarUsers
    : meta?.responsibleUsers || [];
  return (
    <section className="screen-section orders-screen">
      <div className="screen-intro">
        <div>
          <span className="eyebrow">УСЛУГИ</span>
          <h2>Заказы и приёмки</h2>
          <p>{meta?.total || 0} заказов · реальные данные Neon</p>
        </div>
        {access.actions["orders.create"] ? (
          <button className="primary" onClick={() => openCreate()}>
            ＋ Добавить заказ
          </button>
        ) : null}
      </div>
      <div
        className="orders-view-switch"
        role="tablist"
        aria-label="Режим отображения"
      >
        <button
          role="tab"
          aria-selected={view === "list"}
          className={view === "list" ? "active" : ""}
          onClick={() => setView("list")}
        >
          Список
        </button>
        <button
          role="tab"
          aria-selected={view === "calendar"}
          className={view === "calendar" ? "active" : ""}
          onClick={() => setView("calendar")}
        >
          Календарь
        </button>
      </div>
      <div className="orders-list-view" hidden={view !== "list"}>
        <div className="panel order-filters">
          <label className="order-search">
            <span>⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Номер, клиент, телефон, адрес, ЖК или квартира"
            />
          </label>
          <label>
            <span>Тип</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="ALL">Все услуги</option>
              {meta?.types.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Статус</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ALL">Все статусы</option>
              {meta?.statuses.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Оплата</span>
            <select
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
            >
              <option value="ALL">Все</option>
              <option value="UNPAID">Не оплачены</option>
              <option value="PARTIALLY_PAID">Частично</option>
              <option value="PAID">Оплачены</option>
            </select>
          </label>
          <label>
            <span>Ответственный</span>
            <select
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
            >
              <option value="ALL">Все ответственные</option>
              {meta?.responsibleUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Период</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="ALL">Всё время</option>
              <option value="TODAY">Сегодня</option>
              <option value="TOMORROW">Завтра</option>
              <option value="WEEK">Эта неделя</option>
              <option value="MONTH">Этот месяц</option>
              <option value="CUSTOM">Выбрать период</option>
            </select>
          </label>
          {period === "CUSTOM" ? (
            <>
              <label>
                <span>От</span>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                <span>До</span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </>
          ) : null}
        </div>
        {error ? <div className="form-error">{error}</div> : null}
        {loading ? (
          <div className="panel finance-loading">Загружаем заказы…</div>
        ) : null}
        {!loading && !items.length ? (
          <div className="panel orders-empty">
            <span>▤</span>
            <h3>Заказов пока нет.</h3>
            {access.actions["orders.create"] ? (
              <button className="primary" onClick={() => openCreate()}>
                Добавить заказ
              </button>
            ) : null}
          </div>
        ) : null}
        {items.length ? (
          <div className="panel orders-table">
            <div className="order-row head">
              <span>Номер</span>
              <span>Услуга / адрес</span>
              <span>Клиент</span>
              <span>Дата</span>
              <span>Ответственный</span>
              <span>Статус</span>
              <span>Оплата</span>
              <span>Стоимость</span>
            </div>
            {items.map((o) => (
              <button
                className="order-row"
                key={o.id}
                onClick={() => setOpenId(o.id)}
              >
                <span>
                  <b>{o.orderNumber}</b>
                </span>
                <span>
                  <b>{TYPE[o.type]}</b>
                  <small>
                    {o.inspection?.residentialComplex
                      ? `ЖК ${o.inspection.residentialComplex} · `
                      : ""}
                    {o.inspection?.address} · кв.{" "}
                    {o.inspection?.apartmentNumber}
                  </small>
                </span>
                <span>{o.clientName}</span>
                <span>
                  {rangeLabel(o)} · {date(o.scheduledAt)}
                </span>
                <span>{o.responsibleName}</span>
                <span>
                  <em
                    className={`order-status status-${o.status.toLowerCase()}`}
                  >
                    {STATUS[o.status]}
                  </em>
                </span>
                <span>
                  <em
                    className={`payment-status payment-${o.paymentStatus.toLowerCase()}`}
                  >
                    {PAYMENT[o.paymentStatus]}
                  </em>
                </span>
                <span>
                  <b>{money(o.priceKopecks)}</b>
                </span>
              </button>
            ))}
            {meta?.hasMore ? (
              <div className="order-more">
                <button className="secondary" onClick={() => void more()}>
                  Показать ещё
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="orders-calendar-view" hidden={view !== "calendar"}>
        {calendarError ? (
          <div className="form-error" role="alert">
            {calendarError}
          </div>
        ) : null}
        <InspectionCalendar
          level={calendarLevel}
          selectedDate={selectedDate}
          selectedInspector={selectedInspector}
          items={calendarItems}
          inspectors={users}
          canCreate={Boolean(access.actions["orders.create"])}
          loading={calendarLoading}
          onLevelChange={setCalendarLevel}
          onDateChange={setSelectedDate}
          onInspectorChange={setSelectedInspector}
          onOpen={setOpenId}
          onQuickCreate={openCreate}
        />
      </div>
      {form && meta ? (
        <OrderForm
          currentUser={currentUser}
          access={access}
          users={meta.responsibleUsers}
          initialClientId={initialClientId}
          initialSchedule={formPreset}
          onClose={() => {
            setForm(false);
            setFormPreset(null);
          }}
          onSaved={(d) => {
            setForm(false);
            setFormPreset(null);
            setOpenId(d.order.id);
            setRevision((x) => x + 1);
          }}
        />
      ) : null}
      {openId ? (
        <OrderCard
          id={openId}
          users={users}
          onClose={() => {
            setOpenId(null);
            onOrderClosed?.();
          }}
          onChanged={() => setRevision((x) => x + 1)}
          onPayment={onPayment}
        />
      ) : null}
    </section>
  );
}
