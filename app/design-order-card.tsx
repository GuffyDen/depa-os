"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Stage = {
  id: string;
  name: string;
  position: number;
  status: string;
  plannedStartDate: number | null;
  plannedEndDate: number | null;
  completedAt: number | null;
  responsibleUserId: string | null;
  responsibleName: string | null;
  comment: string | null;
};
type DesignFile = {
  id: string;
  logicalName: string;
  category: string;
  originalFilename: string;
  mimeType: string;
  version: number;
  isCurrent: number;
  designStageId: string | null;
  previousVersionId: string | null;
  createdAt: number;
  uploadedByName: string;
};
type Detail = {
  order: {
    id: string;
    orderNumber: string;
    clientId: string;
    clientName: string;
    clientPhone: string;
    status: string;
    responsibleUserId: string;
    responsibleName: string;
    sourceLeadId: string | null;
    sourceOrderId: string | null;
    comment: string | null;
    priceKopecks: number | null;
    paidKopecks: number | null;
    remainingKopecks: number | null;
    overpaymentKopecks: number | null;
  };
  design: {
    id: string;
    residentialComplex: string | null;
    address: string;
    apartmentNumber: string;
    areaSqm: number | null;
    designerEmployeeId: string | null;
    designerName: string | null;
    plannedStartDate: number | null;
    plannedEndDate: number | null;
    actualEndDate: number | null;
    status: string;
    comment: string | null;
    projectId: string | null;
  };
  stages: Stage[];
  progress: { total: number; completed: number; percent: number };
  files: DesignFile[];
  fileCategories: readonly [string, string][];
  finances: {
    id: string;
    amountKopecks: number;
    transactionDate: number;
    title: string;
    cashboxName: string;
  }[];
  history: {
    id: string;
    type: string;
    occurredAt: number;
    actorName: string;
  }[];
  designers: { id: string; name: string; userId: string | null }[];
  responsibleUsers: { id: string; name: string }[];
  capabilities: {
    edit: boolean;
    assignDesigner: boolean;
    assignResponsible: boolean;
    viewStages: boolean;
    manageStages: boolean;
    completeStages: boolean;
    viewFiles: boolean;
    uploadFiles: boolean;
    manageVersions: boolean;
    archiveFiles: boolean;
    viewFinance: boolean;
    addPayment: boolean;
    complete: boolean;
    cancel: boolean;
    createRenovation: boolean;
  };
};

const STATUS: Record<string, string> = {
  PLANNING: "Подготовка",
  IN_PROGRESS: "В работе",
  WAITING_CLIENT: "Ожидает клиента",
  COMPLETED: "Завершён",
  PAUSED: "Приостановлен",
  CANCELLED: "Отменён",
};
const STAGE_STATUS: Record<string, string> = {
  NOT_STARTED: "Не начат",
  IN_PROGRESS: "В работе",
  WAITING_CLIENT: "Ожидает клиента",
  COMPLETED: "Завершён",
};
const HISTORY: Record<string, string> = {
  DESIGN_PROJECT_CREATED: "Дизайн-проект создан",
  DESIGN_PROJECT_UPDATED: "Дизайн-проект обновлён",
  DESIGN_DESIGNER_CHANGED: "Дизайнер изменён",
  DESIGN_STAGE_CREATED: "Этап добавлен",
  DESIGN_STAGE_UPDATED: "Этап обновлён",
  DESIGN_STAGE_COMPLETED: "Этап завершён",
  DESIGN_STAGE_DELETED: "Этап архивирован",
  DESIGN_FILE_UPLOADED: "Файл загружен",
  DESIGN_FILE_VERSION_CREATED: "Создана новая версия файла",
  DESIGN_FILE_ARCHIVED: "Файл архивирован",
  DESIGN_ORDER_COMPLETED: "Дизайн-проект завершён",
  ORDER_CANCELLED: "Заказ отменён",
};

function money(value: number | null) {
  return value == null
    ? "Скрыто правами доступа"
    : new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: "RUB",
        maximumFractionDigits: 0,
      }).format(value / 100);
}
function date(value: number | null) {
  return value
    ? new Date(value * 1000).toLocaleDateString("ru-RU", {
        timeZone: "Asia/Vladivostok",
      })
    : "—";
}
function dateInput(value: number | null) {
  if (!value) return "";
  return new Date((value + 10 * 3600) * 1000).toISOString().slice(0, 10);
}
async function json<T>(response: Response) {
  const result = (await response.json()) as T & {
    error?: string;
    code?: string;
    warnings?: CompletionWarnings;
  };
  if (!response.ok)
    throw Object.assign(
      new Error(result.error || "Операция не выполнена."),
      result,
    );
  return result;
}
type CompletionWarnings = {
  unfinishedStages: number;
  finalAlbumMissing: boolean;
  remainingKopecks: number;
};

async function uploadDesignFile(
  file: File,
  category: string,
  entityType: "DesignProject" | "DesignStage",
  entityId: string,
) {
  const mimeType = file.type.toLowerCase();
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "application/pdf": "pdf",
  };
  if (!extensions[mimeType])
    throw new Error("Разрешены JPG, PNG, WebP, HEIC/HEIF и PDF.");
  if (file.size > 25 * 1024 * 1024)
    throw new Error("Файл должен быть не больше 25 МБ.");
  const attachmentId = crypto.randomUUID();
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
  );
  const checksumSha256 = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const folder = category.toLowerCase().replaceAll("_", "-");
  const pathname = `depa-os/${folder}/${attachmentId}.${extensions[mimeType]}`;
  const { upload } = await import("@vercel/blob/client");
  await upload(pathname, file, {
    access: "private",
    handleUploadUrl: "/api/files/upload",
    contentType: mimeType,
    multipart: file.size > 5 * 1024 * 1024,
    clientPayload: JSON.stringify({
      attachmentId,
      originalFilename: file.name,
      mimeType,
      sizeBytes: file.size,
      checksumSha256,
      category,
      visibility: "INTERNAL",
      entityType,
      entityId,
      projectId: null,
    }),
  });
  return attachmentId;
}

export function DesignOrderCard({
  orderId,
  onClose,
  onChanged,
  onPayment,
  onOpenOrder,
}: {
  orderId: string;
  onClose: () => void;
  onChanged: () => void;
  onPayment: (order: Detail["order"]) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<
    "overview" | "stages" | "finance" | "files" | "history"
  >("overview");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addStage, setAddStage] = useState(false);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [completionWarnings, setCompletionWarnings] =
    useState<CompletionWarnings | null>(null);
  const [renderedAt] = useState(() => Math.floor(Date.now() / 1000));
  async function load() {
    setDetail(
      await json<Detail>(
        await fetch(`/api/design/${orderId}`, { cache: "no-store" }),
      ),
    );
  }
  useEffect(() => {
    let active = true;
    fetch(`/api/design/${orderId}`, { cache: "no-store" })
      .then((response) => json<Detail>(response))
      .then((next) => {
        if (active) setDetail(next);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось открыть дизайн-проект.",
          );
      });
    return () => {
      active = false;
    };
  }, [orderId]);
  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const next = await json<Detail>(
        await fetch(`/api/design/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      setDetail(next);
      onChanged();
      return next;
    } catch (reason) {
      const failure = reason as Error & {
        code?: string;
        warnings?: CompletionWarnings;
      };
      if (failure.code === "DESIGN_COMPLETION_WARNINGS" && failure.warnings)
        setCompletionWarnings(failure.warnings);
      else setError(failure.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const groupedFiles = useMemo(() => {
    const groups = new Map<string, DesignFile[]>();
    for (const file of detail?.files || []) {
      const key = `${file.category}:${file.logicalName}`;
      groups.set(key, [...(groups.get(key) || []), file]);
    }
    return [...groups.values()];
  }, [detail?.files]);
  if (!detail)
    return (
      <div className="modal-wrap order-drawer-wrap">
        <aside className="order-card">
          <div className={error ? "form-error" : "finance-loading"}>
            {error || "Загружаем дизайн-проект…"}
          </div>
        </aside>
      </div>
    );
  const { order, design, capabilities } = detail;
  return (
    <div
      className="modal-wrap order-drawer-wrap"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="order-card design-order-card"
        role="dialog"
        aria-modal="true"
      >
        <header className="order-card-head design-card-head">
          <button className="back" onClick={onClose}>
            ← Заказы
          </button>
          <div>
            <span
              className={`order-status status-${order.status.toLowerCase()}`}
            >
              {STATUS[design.status]}
            </span>
            <span className="eyebrow">ДИЗАЙН-ПРОЕКТ</span>
            <h2>{order.orderNumber}</h2>
            <span className="client-link">
              {order.clientName} · {order.clientPhone}
            </span>
          </div>
          <div className="order-card-actions">
            {capabilities.addPayment && (order.remainingKopecks || 0) > 0 ? (
              <button className="primary" onClick={() => onPayment(order)}>
                ＋ Добавить оплату
              </button>
            ) : null}
            {capabilities.edit ? (
              <button
                className="secondary"
                onClick={() => setEditing((value) => !value)}
              >
                {editing ? "Закрыть форму" : "Редактировать"}
              </button>
            ) : null}
            {capabilities.complete &&
            !["COMPLETED", "CANCELLED"].includes(design.status) ? (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void patch({ action: "COMPLETE" })}
              >
                Завершить
              </button>
            ) : null}
            <button aria-label="Закрыть карточку" onClick={onClose}>
              ×
            </button>
          </div>
        </header>
        {error ? (
          <div className="form-error order-error" role="alert">
            {error}
          </div>
        ) : null}
        <nav className="order-tabs" aria-label="Разделы дизайн-проекта">
          {[
            ["overview", "Обзор"],
            ["stages", "Этапы"],
            ...(capabilities.viewFinance ? [["finance", "Финансы"]] : []),
            ...(capabilities.viewFiles ? [["files", "Файлы"]] : []),
            ["history", "История"],
          ].map(([key, label]) => (
            <button
              className={tab === key ? "active" : ""}
              key={key}
              onClick={() => setTab(key as typeof tab)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="order-card-content">
          {editing ? (
            <form
              className="panel design-edit-form"
              onSubmit={(event) => {
                event.preventDefault();
                void patch(
                  Object.fromEntries(new FormData(event.currentTarget)),
                );
              }}
            >
              <label>
                <span>ЖК</span>
                <input
                  name="residentialComplex"
                  defaultValue={design.residentialComplex || ""}
                />
              </label>
              <label>
                <span>Адрес</span>
                <input name="address" defaultValue={design.address} required />
              </label>
              <label>
                <span>Квартира</span>
                <input
                  name="apartmentNumber"
                  defaultValue={design.apartmentNumber}
                  required
                />
              </label>
              <label>
                <span>Площадь, м²</span>
                <input
                  name="areaSqm"
                  inputMode="decimal"
                  defaultValue={design.areaSqm ?? ""}
                />
              </label>
              <label>
                <span>Ответственный</span>
                <select
                  name="responsibleUserId"
                  defaultValue={order.responsibleUserId}
                  disabled={!capabilities.assignResponsible}
                >
                  {detail.responsibleUsers.map((user) => (
                    <option value={user.id} key={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Дизайнер</span>
                <select
                  name="designerEmployeeId"
                  defaultValue={design.designerEmployeeId || ""}
                  disabled={!capabilities.assignDesigner}
                >
                  <option value="">Не назначен</option>
                  {detail.designers.map((designer) => (
                    <option value={designer.id} key={designer.id}>
                      {designer.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Дата начала</span>
                <input
                  name="plannedStartDate"
                  type="date"
                  defaultValue={dateInput(design.plannedStartDate)}
                />
              </label>
              <label>
                <span>Плановое завершение</span>
                <input
                  name="plannedEndDate"
                  type="date"
                  defaultValue={dateInput(design.plannedEndDate)}
                />
              </label>
              {capabilities.viewFinance ? (
                <label>
                  <span>Стоимость</span>
                  <input
                    name="price"
                    inputMode="decimal"
                    defaultValue={(order.priceKopecks || 0) / 100}
                  />
                </label>
              ) : null}
              <label>
                <span>Статус</span>
                <select name="status" defaultValue={design.status}>
                  {Object.entries(STATUS)
                    .filter(
                      ([key]) => !["COMPLETED", "CANCELLED"].includes(key),
                    )
                    .map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
              <label className="wide">
                <span>Комментарий</span>
                <textarea name="comment" defaultValue={order.comment || ""} />
              </label>
              <button className="primary wide" disabled={busy}>
                Сохранить
              </button>
            </form>
          ) : null}
          {tab === "overview" ? (
            <div className="design-overview">
              <section className="panel design-hero-facts">
                <div>
                  <span>Квартира</span>
                  <b>
                    {design.residentialComplex
                      ? `ЖК ${design.residentialComplex} · `
                      : ""}
                    кв. {design.apartmentNumber}
                  </b>
                  <small>{design.address}</small>
                </div>
                <div>
                  <span>Площадь</span>
                  <b>
                    {design.areaSqm
                      ? `${design.areaSqm.toLocaleString("ru-RU")} м²`
                      : "—"}
                  </b>
                </div>
                <div>
                  <span>Ответственный</span>
                  <b>{order.responsibleName}</b>
                </div>
                <div>
                  <span>Дизайнер</span>
                  <b>{design.designerName || "Не назначен"}</b>
                </div>
                <div>
                  <span>Срок</span>
                  <b>
                    {design.plannedEndDate
                      ? `до ${date(design.plannedEndDate)}`
                      : "Не установлен"}
                  </b>
                </div>
                <div>
                  <span>Фактическое завершение</span>
                  <b>{date(design.actualEndDate)}</b>
                </div>
              </section>
              {capabilities.viewFinance ? (
                <section className="order-money">
                  <article className="panel">
                    <span>Стоимость</span>
                    <b>{money(order.priceKopecks)}</b>
                  </article>
                  <article className="panel">
                    <span>Оплачено</span>
                    <b>{money(order.paidKopecks)}</b>
                  </article>
                  <article className="panel">
                    <span>
                      {(order.overpaymentKopecks || 0) > 0
                        ? "Переплата"
                        : "Остаток"}
                    </span>
                    <b>
                      {money(
                        (order.overpaymentKopecks || 0) > 0
                          ? order.overpaymentKopecks
                          : order.remainingKopecks,
                      )}
                    </b>
                  </article>
                </section>
              ) : null}
              <section className="panel design-progress">
                <div>
                  <span className="eyebrow">ЭТАПЫ</span>
                  <h3>
                    {detail.progress.total
                      ? `${detail.progress.completed} из ${detail.progress.total} завершено`
                      : "Этапы не настроены"}
                  </h3>
                </div>
                <b>{detail.progress.percent}%</b>
                <div className="design-progress-track">
                  <i style={{ width: `${detail.progress.percent}%` }} />
                </div>
              </section>
              <section className="panel order-comment">
                <span className="eyebrow">КОММЕНТАРИЙ</span>
                <p>
                  {order.comment ||
                    design.comment ||
                    "Комментарий не добавлен."}
                </p>
              </section>
              {capabilities.createRenovation ? (
                <form
                  className="panel design-conversion"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setBusy(true);
                    setError("");
                    try {
                      const result = await json<{ orderId: string }>(
                        await fetch(`/api/design/${orderId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            action: "CONVERT_TO_RENOVATION",
                            ...Object.fromEntries(
                              new FormData(event.currentTarget),
                            ),
                          }),
                        }),
                      );
                      onOpenOrder(result.orderId);
                    } catch (reason) {
                      setError(
                        reason instanceof Error
                          ? reason.message
                          : "Не удалось создать заказ на ремонт.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <div>
                    <span className="eyebrow">СЛЕДУЮЩАЯ УСЛУГА</span>
                    <h3>Создать заказ на ремонт</h3>
                    <p>
                      Это отдельный коммерческий заказ. Объект автоматически не
                      создаётся.
                    </p>
                  </div>
                  <label>
                    <span>Стоимость ремонта *</span>
                    <input name="price" inputMode="decimal" required />
                  </label>
                  <button className="primary" disabled={busy}>
                    Создать заказ на ремонт
                  </button>
                </form>
              ) : null}
              {capabilities.cancel &&
              !["COMPLETED", "CANCELLED"].includes(design.status) ? (
                <form
                  className="panel design-cancel"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void patch({
                      action: "CANCEL",
                      ...Object.fromEntries(new FormData(event.currentTarget)),
                    });
                  }}
                >
                  <label>
                    <span>Причина отмены *</span>
                    <input name="reason" required />
                  </label>
                  <button className="link danger-text" disabled={busy}>
                    Отменить заказ
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
          {tab === "stages" ? (
            <div className="design-stages">
              <div className="design-tab-head">
                <div>
                  <span className="eyebrow">ЭТАПЫ</span>
                  <h3>
                    {detail.progress.completed} / {detail.progress.total}
                  </h3>
                </div>
                {capabilities.manageStages ? (
                  <button
                    className="secondary"
                    onClick={() => setAddStage((value) => !value)}
                  >
                    ＋ Добавить этап
                  </button>
                ) : null}
              </div>
              {addStage ? (
                <form
                  className="panel design-stage-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const next = await patch({
                      action: "CREATE_STAGE",
                      ...Object.fromEntries(new FormData(event.currentTarget)),
                    });
                    if (next) setAddStage(false);
                  }}
                >
                  <label>
                    <span>Название *</span>
                    <input name="name" required />
                  </label>
                  <label>
                    <span>Плановое начало</span>
                    <input name="plannedStartDate" type="date" />
                  </label>
                  <label>
                    <span>Плановое окончание</span>
                    <input name="plannedEndDate" type="date" />
                  </label>
                  <label>
                    <span>Ответственный</span>
                    <select name="responsibleUserId" defaultValue="">
                      <option value="">Не назначен</option>
                      {detail.responsibleUsers.map((user) => (
                        <option value={user.id} key={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="wide">
                    <span>Комментарий</span>
                    <input name="comment" />
                  </label>
                  <button className="primary" disabled={busy}>
                    Добавить этап
                  </button>
                </form>
              ) : null}
              {detail.stages.map((stage, index) => (
                <article
                  className={`panel design-stage ${stage.plannedEndDate && stage.plannedEndDate < renderedAt && stage.status !== "COMPLETED" ? "overdue" : ""}`}
                  key={stage.id}
                >
                  <header>
                    <span>
                      <em>{index + 1}</em>
                      <b>{stage.name}</b>
                    </span>
                    <i className={`stage-state ${stage.status.toLowerCase()}`}>
                      {STAGE_STATUS[stage.status]}
                    </i>
                  </header>
                  <div className="design-stage-meta">
                    <span>
                      {date(stage.plannedStartDate)} —{" "}
                      {date(stage.plannedEndDate)}
                    </span>
                    <span>
                      {stage.responsibleName || "Ответственный не назначен"}
                    </span>
                  </div>
                  {stage.comment ? <p>{stage.comment}</p> : null}
                  {editingStageId === stage.id ? (
                    <form
                      className="design-stage-form stage-inline-edit"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const next = await patch({
                          action: "UPDATE_STAGE",
                          stageId: stage.id,
                          ...Object.fromEntries(
                            new FormData(event.currentTarget),
                          ),
                        });
                        if (next) setEditingStageId(null);
                      }}
                    >
                      <label>
                        <span>Название</span>
                        <input name="name" defaultValue={stage.name} required />
                      </label>
                      <label>
                        <span>Статус</span>
                        <select name="status" defaultValue={stage.status}>
                          {Object.entries(STAGE_STATUS)
                            .filter(
                              ([value]) =>
                                value !== "COMPLETED" ||
                                capabilities.completeStages ||
                                stage.status === "COMPLETED",
                            )
                            .map(([value, label]) => (
                              <option value={value} key={value}>
                                {label}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        <span>Плановое начало</span>
                        <input
                          name="plannedStartDate"
                          type="date"
                          defaultValue={dateInput(stage.plannedStartDate)}
                        />
                      </label>
                      <label>
                        <span>Плановое окончание</span>
                        <input
                          name="plannedEndDate"
                          type="date"
                          defaultValue={dateInput(stage.plannedEndDate)}
                        />
                      </label>
                      <label>
                        <span>Ответственный</span>
                        <select
                          name="responsibleUserId"
                          defaultValue={stage.responsibleUserId || ""}
                        >
                          <option value="">Не назначен</option>
                          {detail.responsibleUsers.map((user) => (
                            <option value={user.id} key={user.id}>
                              {user.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="wide">
                        <span>Комментарий</span>
                        <input
                          name="comment"
                          defaultValue={stage.comment || ""}
                        />
                      </label>
                      <button className="primary" disabled={busy}>
                        Сохранить этап
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setEditingStageId(null)}
                      >
                        Отмена
                      </button>
                    </form>
                  ) : null}
                  <footer>
                    {capabilities.manageStages ? (
                      <>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => setEditingStageId(stage.id)}
                        >
                          Редактировать
                        </button>
                        <button
                          aria-label="Переместить этап выше"
                          disabled={index === 0 || busy}
                          onClick={() =>
                            void patch({
                              action: "MOVE_STAGE",
                              stageId: stage.id,
                              direction: "UP",
                            })
                          }
                        >
                          ↑
                        </button>
                        <button
                          aria-label="Переместить этап ниже"
                          disabled={index === detail.stages.length - 1 || busy}
                          onClick={() =>
                            void patch({
                              action: "MOVE_STAGE",
                              stageId: stage.id,
                              direction: "DOWN",
                            })
                          }
                        >
                          ↓
                        </button>
                        <select
                          value={stage.status}
                          onChange={(event) =>
                            void patch({
                              action: "UPDATE_STAGE",
                              stageId: stage.id,
                              status: event.target.value,
                            })
                          }
                        >
                          {Object.entries(STAGE_STATUS)
                            .filter(
                              ([value]) =>
                                value !== "COMPLETED" ||
                                capabilities.completeStages ||
                                stage.status === "COMPLETED",
                            )
                            .map(([value, label]) => (
                              <option value={value} key={value}>
                                {label}
                              </option>
                            ))}
                        </select>
                        <button
                          className="link danger-text"
                          disabled={busy}
                          onClick={() =>
                            void patch({
                              action: "ARCHIVE_STAGE",
                              stageId: stage.id,
                            })
                          }
                        >
                          Убрать этап
                        </button>
                      </>
                    ) : null}
                    {capabilities.completeStages &&
                    stage.status !== "COMPLETED" ? (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          void patch({
                            action: "COMPLETE_STAGE",
                            stageId: stage.id,
                          })
                        }
                      >
                        Завершить этап
                      </button>
                    ) : null}
                  </footer>
                </article>
              ))}
              {!detail.stages.length ? (
                <div className="panel orders-empty">
                  <h3>Этапы не настроены.</h3>
                </div>
              ) : null}
            </div>
          ) : null}
          {tab === "finance" && capabilities.viewFinance ? (
            <div className="design-finance">
              <section className="order-money">
                <article className="panel">
                  <span>Стоимость</span>
                  <b>{money(order.priceKopecks)}</b>
                </article>
                <article className="panel">
                  <span>Оплачено</span>
                  <b>{money(order.paidKopecks)}</b>
                </article>
                <article className="panel">
                  <span>
                    {(order.overpaymentKopecks || 0) > 0
                      ? "Переплата"
                      : "Остаток"}
                  </span>
                  <b>
                    {money(
                      (order.overpaymentKopecks || 0) > 0
                        ? order.overpaymentKopecks
                        : order.remainingKopecks,
                    )}
                  </b>
                </article>
              </section>
              {capabilities.addPayment ? (
                <button className="primary" onClick={() => onPayment(order)}>
                  ＋ Добавить оплату
                </button>
              ) : null}
              <div className="panel design-payment-list">
                {detail.finances.map((item) => (
                  <article key={item.id}>
                    <span>
                      <b>{item.title}</b>
                      <small>
                        {date(item.transactionDate)} · {item.cashboxName}
                      </small>
                    </span>
                    <strong>{money(item.amountKopecks)}</strong>
                  </article>
                ))}
                {!detail.finances.length ? (
                  <div className="finance-empty">
                    Поступлений по заказу пока нет.
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {tab === "files" && capabilities.viewFiles ? (
            <div className="design-files">
              <div className="design-tab-head">
                <div>
                  <span className="eyebrow">ФАЙЛЫ И ВЕРСИИ</span>
                  <h3>{detail.files.length}</h3>
                </div>
              </div>
              {capabilities.uploadFiles ? (
                <form
                  className="panel design-upload"
                  onSubmit={async (event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const values = Object.fromEntries(new FormData(form));
                    const file = (
                      form.elements.namedItem("file") as HTMLInputElement
                    ).files?.[0];
                    if (!file) return;
                    setUploading(true);
                    setError("");
                    try {
                      const stageId = String(values.designStageId || "");
                      const attachmentId = await uploadDesignFile(
                        file,
                        String(values.category),
                        stageId ? "DesignStage" : "DesignProject",
                        stageId || design.id,
                      );
                      await patch({
                        action: "LINK_FILE",
                        attachmentId,
                        logicalName: values.logicalName,
                        category: values.category,
                        designStageId: stageId || null,
                        previousVersionId: values.previousVersionId || null,
                      });
                      form.reset();
                      await load();
                    } catch (reason) {
                      setError(
                        reason instanceof Error
                          ? reason.message
                          : "Не удалось загрузить файл.",
                      );
                    } finally {
                      setUploading(false);
                    }
                  }}
                >
                  <label>
                    <span>Категория *</span>
                    <select name="category" required>
                      {detail.fileCategories.map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Название *</span>
                    <input
                      name="logicalName"
                      required
                      placeholder="Планировка"
                    />
                  </label>
                  <label>
                    <span>Этап</span>
                    <select name="designStageId">
                      <option value="">Весь дизайн-проект</option>
                      {detail.stages.map((stage) => (
                        <option value={stage.id} key={stage.id}>
                          {stage.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Новая версия</span>
                    <select
                      name="previousVersionId"
                      disabled={!capabilities.manageVersions}
                      onChange={(event) => {
                        const selected = detail.files.find(
                          (file) => file.id === event.target.value,
                        );
                        const form = event.currentTarget.form;
                        if (!selected || !form) return;
                        const category = form.elements.namedItem(
                          "category",
                        ) as HTMLSelectElement;
                        const logicalName = form.elements.namedItem(
                          "logicalName",
                        ) as HTMLInputElement;
                        category.value = selected.category;
                        logicalName.value = selected.logicalName;
                      }}
                    >
                      <option value="">Новый файл</option>
                      {detail.files
                        .filter((file) => file.isCurrent)
                        .map((file) => (
                          <option value={file.id} key={file.id}>
                            {file.logicalName} · v{file.version}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="wide">
                    <span>Файл *</span>
                    <input
                      name="file"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                      required
                    />
                  </label>
                  <button className="primary" disabled={uploading}>
                    {uploading ? "Загружаем…" : "Загрузить файл"}
                  </button>
                </form>
              ) : null}
              {groupedFiles.map((files) => (
                <section
                  className="panel design-file-group"
                  key={`${files[0].category}:${files[0].logicalName}`}
                >
                  <header>
                    <div>
                      <span className="eyebrow">
                        {detail.fileCategories.find(
                          ([id]) => id === files[0].category,
                        )?.[1] || files[0].category}
                      </span>
                      <h3>{files[0].logicalName}</h3>
                    </div>
                  </header>
                  {files.map((file) => (
                    <article key={file.id}>
                      <a
                        href={`/api/files/${file.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span>
                          <b>
                            v{file.version}{" "}
                            {file.isCurrent ? <em>АКТУАЛЬНАЯ</em> : null}
                          </b>
                          <small>
                            {date(file.createdAt)} · {file.uploadedByName}
                          </small>
                        </span>
                        <i>Открыть ↗</i>
                      </a>
                      {capabilities.archiveFiles ? (
                        <button
                          className="link danger-text"
                          onClick={() =>
                            void patch({
                              action: "ARCHIVE_FILE",
                              attachmentId: file.id,
                            })
                          }
                        >
                          Архивировать
                        </button>
                      ) : null}
                    </article>
                  ))}
                </section>
              ))}
              {!groupedFiles.length ? (
                <div className="panel finance-empty">
                  Файлы пока не загружены.
                </div>
              ) : null}
            </div>
          ) : null}
          {tab === "history" ? (
            <div className="panel order-history">
              {detail.history.map((item) => (
                <article key={item.id}>
                  <i>•</i>
                  <div>
                    <b>{HISTORY[item.type] || item.type}</b>
                    <span>
                      {item.actorName} · {date(item.occurredAt)}
                    </span>
                  </div>
                </article>
              ))}
              {!detail.history.length ? (
                <div className="finance-empty">История пока пуста.</div>
              ) : null}
            </div>
          ) : null}
        </div>
        {completionWarnings ? (
          <div className="modal-wrap completion-warning">
            <section className="modal">
              <header>
                <h3>Завершить дизайн-проект?</h3>
                <button onClick={() => setCompletionWarnings(null)}>×</button>
              </header>
              <ul>
                {completionWarnings.unfinishedStages ? (
                  <li>
                    Незавершённых этапов: {completionWarnings.unfinishedStages}
                  </li>
                ) : null}
                {completionWarnings.finalAlbumMissing ? (
                  <li>Финальный альбом не загружен.</li>
                ) : null}
                {completionWarnings.remainingKopecks ? (
                  <li>
                    Остаток к оплате:{" "}
                    {money(completionWarnings.remainingKopecks)}
                  </li>
                ) : null}
              </ul>
              <div className="modal-actions">
                <button
                  className="secondary"
                  onClick={() => setCompletionWarnings(null)}
                >
                  Вернуться
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    const next = await patch({
                      action: "COMPLETE",
                      confirmWarnings: true,
                    });
                    if (next) setCompletionWarnings(null);
                  }}
                >
                  Завершить всё равно
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
