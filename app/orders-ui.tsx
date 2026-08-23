"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUser } from "../lib/auth";
import type { AccessProfile } from "../lib/permission-definitions";
import { calendarRange, InspectionCalendar } from "./inspection-calendar";
import { UniversalOrderForm, type OrderPrefill } from "./order-create-form";
import { DesignOrderCard } from "./design-order-card";
import { RenovationOrderCard } from "./renovation-order-card";
import { EstimatesWorkspace } from "./estimates-ui";
import { ContractsWorkspace } from "./contracts-ui";

export type User = { id: string; name: string };
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
  priceKopecks: number | null;
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
  paidKopecks: number | null;
  remainingKopecks: number | null;
  overpaymentKopecks: number | null;
  paymentStatus: string | null;
  inspection: {
    id: string;
    residentialComplexId: string | null;
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
  design: {
    id: string;
    residentialComplexId: string | null;
    residentialComplex: string | null;
    address: string;
    apartmentNumber: string;
    areaSqm: number | null;
    status: string;
    plannedStartDate: number | null;
    plannedEndDate: number | null;
    designerEmployeeId: string | null;
    designerName: string | null;
  } | null;
  renovation: {
    id: string;
    residentialComplexId: string | null;
    residentialComplex: string | null;
    address: string;
    apartmentNumber: string;
    areaSqm: number | null;
    projectId: string | null;
    approvedEstimateVersionId: string | null;
    approvedEstimateId: string | null;
    contractId: string | null;
    contractNumber: string | null;
    contractStatus: string | null;
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
  DESIGN: "Дизайн-проект",
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
function money(value: number | null) {
  if (value == null) return "Скрыто правами доступа";
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
function orderAddress(order: Order) {
  const location = order.inspection || order.design || order.renovation;
  if (!location) return "Адрес не указан";
  return `${location.residentialComplex ? `ЖК ${location.residentialComplex} · ` : ""}${location.address} · кв. ${location.apartmentNumber}`;
}
function orderDate(order: Order) {
  if (order.type === "DESIGN") return order.design?.plannedEndDate ?? null;
  return order.inspection?.scheduledStartAt ?? order.scheduledAt;
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
  access,
  onClose,
  onChanged,
  onPayment,
  onOpenOrder,
  onCreateRelated,
  onCreateEstimate,
  onOpenEstimate,
  onOpenProject,
}: {
  id: string;
  users: User[];
  access: AccessProfile;
  onClose: () => void;
  onChanged: () => void;
  onPayment: (order: Order) => void;
  onOpenOrder: (orderId: string) => void;
  onCreateRelated: (type: "DESIGN" | "RENOVATION", order: Order) => void;
  onCreateEstimate?: (context: {clientId:string;sourceOrderId:string;responsibleUserId:string;residentialComplexId:string|null;residentialComplex:string|null;address:string;apartmentNumber:string;areaSqm:number|null}) => void;
  onOpenEstimate?: (estimateId:string) => void;
  onOpenProject?: (projectId: string) => void;
}) {
  const router = useRouter();
  const openProject = onOpenProject ?? (() => router.push("/projects"));
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
            <button aria-label="Закрыть карточку" onClick={onClose}>
              ×
            </button>
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
  if (o.type === "DESIGN")
    return (
      <DesignOrderCard
        orderId={id}
        canCreateComplex={Boolean(access.actions["residentialComplexes.create"])}
        canCreateEstimate={Boolean(access.actions["estimates.create"])}
        onCreateEstimate={onCreateEstimate}
        onClose={onClose}
        onChanged={onChanged}
        onOpenOrder={onOpenOrder}
        onPayment={(designOrder) =>
          onPayment({
            ...o,
            priceKopecks: designOrder.priceKopecks ?? 0,
            paidKopecks: designOrder.paidKopecks ?? 0,
            remainingKopecks: designOrder.remainingKopecks ?? 0,
            overpaymentKopecks: designOrder.overpaymentKopecks ?? 0,
          })
        }
      />
    );
  if (o.type === "RENOVATION")
    return (
      <RenovationOrderCard
        order={o}
        canAddPayment={detail.capabilities.addPayment}
        canCreateProject={Boolean(access.actions["projects.create"])}
        onClose={onClose}
        onPayment={onPayment}
        onOpenProject={openProject}
        onChanged={onChanged}
        onOpenEstimate={onOpenEstimate}
      />
    );
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
            {detail.capabilities.addPayment && (o.remainingKopecks ?? 0) > 0 ? (
              <button className="primary" onClick={() => onPayment(o)}>
                ＋ Добавить оплату
              </button>
            ) : null}
            {detail.capabilities.edit && o.type === "INSPECTION" ? (
              <button
                className="secondary"
                onClick={() => onCreateRelated("DESIGN", o)}
              >
                Создать дизайн-проект
              </button>
            ) : null}
            {access.actions["estimates.create"] && o.type === "INSPECTION" && i ? <button className="secondary" onClick={()=>onCreateEstimate?.({clientId:o.clientId,sourceOrderId:o.id,responsibleUserId:o.responsibleUserId,residentialComplexId:i.residentialComplexId,residentialComplex:i.residentialComplex,address:i.address,apartmentNumber:i.apartmentNumber,areaSqm:i.areaSqm})}>Создать смету на ремонт</button> : null}
            {detail.capabilities.edit && o.type === "INSPECTION" ? (
              <button
                className="secondary"
                onClick={() => onCreateRelated("RENOVATION", o)}
              >
                Создать заказ на ремонт
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
            <button aria-label="Закрыть карточку" onClick={onClose}>
              ×
            </button>
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
                  <small>
                    {o.paymentStatus ? PAYMENT[o.paymentStatus] : "Скрыто"}
                  </small>
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
  initialSourceLeadId = null,
  onOrderClosed,
  onPayment,
  onOpenProject,
  initialEstimateId = null,
  initialEstimateContext = null,
  initialContractId = null,
}: {
  currentUser: AuthUser;
  access: AccessProfile;
  initialOrderId?: string | null;
  initialClientId?: string | null;
  initialSourceLeadId?: string | null;
  onOrderClosed?: () => void;
  onPayment: (order: Order) => void;
  onOpenProject?: (projectId: string) => void;
  initialEstimateId?: string | null;
  initialEstimateContext?: {clientId:string;sourceLeadId?:string|null;sourceOrderId?:string|null;projectId?:string|null;responsibleUserId:string;residentialComplexId?:string|null;residentialComplex?:string|null;address?:string|null;apartmentNumber?:string|null;areaSqm?:number|null} | null;
  initialContractId?: string | null;
}) {
  const router = useRouter();
  const openProject = onOpenProject ?? (() => router.push("/projects"));
  const routeContractId = initialContractId ?? (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("contractId"));
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
    [formContext, setFormContext] = useState<{
      clientId: string | null;
      type: "INSPECTION" | "DESIGN" | "RENOVATION" | null;
      sourceOrderId: string | null;
      sourceLeadId: string | null;
      prefill: OrderPrefill | null;
    }>({
      clientId: initialClientId,
      type: null,
      sourceOrderId: null,
      sourceLeadId: initialSourceLeadId,
      prefill: null,
    }),
    [openId, setOpenId] = useState<string | null>(initialOrderId),
    [revision, setRevision] = useState(0),
    [view, setView] = useState<"list" | "calendar" | "estimates" | "contracts">(routeContractId ? "contracts" : initialEstimateId || initialEstimateContext ? "estimates" : "list"),
    [estimateContext,setEstimateContext]=useState(initialEstimateContext),
    [estimateTargetId,setEstimateTargetId]=useState(initialEstimateId),
    [contractTargetId]=useState(routeContractId),
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
    setFormContext({
      clientId: initialClientId,
      type: preset ? "INSPECTION" : null,
      sourceOrderId: null,
      sourceLeadId: initialSourceLeadId,
      prefill: null,
    });
    setForm(true);
  }
  function createRelated(type: "DESIGN" | "RENOVATION", order: Order) {
    const location = order.inspection;
    setFormPreset(null);
    setFormContext({
      clientId: order.clientId,
      type,
      sourceOrderId: order.id,
      sourceLeadId: null,
      prefill: {
        residentialComplexId: location?.residentialComplexId,
        residentialComplex: location?.residentialComplex,
        address: location?.address,
        apartmentNumber: location?.apartmentNumber,
        areaSqm: location?.areaSqm,
        responsibleUserId: order.responsibleUserId,
      },
    });
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
          <h2>Заказы и расчёты</h2>
          <p>{meta?.total || 0} заказов · реальные данные Neon</p>
        </div>
        {(view === "list" || view === "calendar") && access.actions["orders.create"] ? (
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
        {currentUser.role === "OWNER" || access.actions["estimates.view"] ? <button role="tab" aria-selected={view === "estimates"} className={view === "estimates" ? "active" : ""} onClick={() => setView("estimates")}>Сметы / КП</button> : null}
        {currentUser.role === "OWNER" || access.actions["contracts.view"] ? <button role="tab" aria-selected={view === "contracts"} className={view === "contracts" ? "active" : ""} onClick={() => setView("contracts")}>Договоры</button> : null}
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
                  <small>{orderAddress(o)}</small>
                </span>
                <span>{o.clientName}</span>
                <span>
                  {o.type === "INSPECTION" ? `${rangeLabel(o)} · ` : ""}
                  {date(orderDate(o))}
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
                  {o.paymentStatus ? (
                    <em
                      className={`payment-status payment-${o.paymentStatus.toLowerCase()}`}
                    >
                      {PAYMENT[o.paymentStatus]}
                    </em>
                  ) : (
                    <small>Скрыто</small>
                  )}
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
      <div hidden={view !== "estimates"}>{view === "estimates" ? <EstimatesWorkspace currentUser={currentUser} access={access} initialEstimateId={estimateTargetId} createContext={estimateContext} onEstimateClosed={()=>{setEstimateContext(null);setEstimateTargetId(null)}} onOpenOrder={(id)=>{setOpenId(id);setView("list")}} /> : null}</div>
      <div hidden={view !== "contracts"}>{view === "contracts" ? <ContractsWorkspace access={access} initialContractId={contractTargetId} /> : null}</div>
      {form && meta ? (
        <UniversalOrderForm
          currentUser={currentUser}
          access={access}
          users={meta.responsibleUsers}
          initialClientId={formContext.clientId}
          initialType={formContext.type}
          initialSchedule={formPreset}
          sourceLeadId={formContext.sourceLeadId}
          sourceOrderId={formContext.sourceOrderId}
          prefill={formContext.prefill}
          onClose={() => {
            setForm(false);
            setFormPreset(null);
          }}
          onCreated={(orderId) => {
            setForm(false);
            setFormPreset(null);
            setOpenId(orderId);
            setRevision((x) => x + 1);
          }}
          onOpenExisting={(orderId) => {
            setForm(false);
            setOpenId(orderId);
          }}
        />
      ) : null}
      {openId ? (
        <OrderCard
          id={openId}
          users={users}
          access={access}
          onClose={() => {
            setOpenId(null);
            onOrderClosed?.();
          }}
          onChanged={() => setRevision((x) => x + 1)}
          onPayment={onPayment}
          onOpenOrder={setOpenId}
          onOpenProject={openProject}
          onCreateRelated={createRelated}
          onCreateEstimate={(context)=>{setOpenId(null);setEstimateContext(context);setView("estimates")}}
          onOpenEstimate={(estimateId)=>{setOpenId(null);setEstimateContext(null);setEstimateTargetId(estimateId);setView("estimates")}}
        />
      ) : null}
    </section>
  );
}
