"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { AuthUser } from "../lib/auth";
import type { AccessProfile } from "../lib/permission-definitions";
import { ResidentialComplexFields } from "./residential-complex-selector";

type User = { id: string; name: string };
type Client = { id: string; fullName: string; phone: string };
type Designer = { id: string; name: string; userId: string | null };
type ServiceType = "INSPECTION" | "DESIGN" | "RENOVATION";
type SchedulePreset = { date: string; startTime: string; endTime: string };
export type OrderPrefill = {
  residentialComplexId?: string | null;
  residentialComplex?: string | null;
  address?: string | null;
  apartmentNumber?: string | null;
  areaSqm?: number | null;
  responsibleUserId?: string | null;
};

const SERVICE_OPTIONS: {
  type: ServiceType;
  label: string;
  description: string;
}[] = [
  {
    type: "INSPECTION",
    label: "Приёмка квартиры",
    description: "Расписание, специалист и акт приёмки",
  },
  {
    type: "DESIGN",
    label: "Дизайн-проект",
    description: "Этапы, версии файлов и сроки проекта",
  },
  {
    type: "RENOVATION",
    label: "Ремонт квартиры",
    description: "Коммерческий заказ с последующим созданием объекта",
  },
];

function vladivostokEpoch(date: string, time = "00:00") {
  return Math.floor(new Date(`${date}T${time}:00+10:00`).getTime() / 1000);
}

async function readJson<T>(response: Response) {
  const result = (await response.json()) as T & {
    error?: string;
    code?: string;
    duplicate?: { orderId: string; orderNumber: string };
    conflict?: unknown;
  };
  if (!response.ok)
    throw Object.assign(
      new Error(result.error || "Не удалось создать заказ."),
      result,
    );
  return result;
}

export function UniversalOrderForm({
  currentUser,
  access,
  users,
  initialClientId,
  initialType,
  initialSchedule,
  sourceLeadId,
  sourceOrderId,
  prefill,
  onClose,
  onCreated,
  onOpenExisting,
}: {
  currentUser: AuthUser;
  access: AccessProfile;
  users: User[];
  initialClientId?: string | null;
  initialType?: ServiceType | null;
  initialSchedule?: SchedulePreset | null;
  sourceLeadId?: string | null;
  sourceOrderId?: string | null;
  prefill?: OrderPrefill | null;
  onClose: () => void;
  onCreated: (orderId: string) => void;
  onOpenExisting?: (orderId: string) => void;
}) {
  const [serviceType, setServiceType] = useState<ServiceType | null>(
    initialType || null,
  );
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState(initialClientId || "");
  const [designers, setDesigners] = useState<Designer[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<{
    orderId: string;
    orderNumber: string;
  } | null>(null);
  const [conflict, setConflict] = useState<{
    orderNumber: string | null;
    clientName: string | null;
    scheduledStartAt: number;
    scheduledEndAt: number;
  } | null>(null);
  const [defaultSchedule] = useState(() => ({
    date: new Date(Date.now() + 10 * 3600 * 1000).toISOString().slice(0, 10),
    startTime: "10:00",
    endTime: "11:30",
  }));
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (initialClientId || !query.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(
        `/api/clients?search=${encodeURIComponent(query)}&status=ACTIVE&limit=8`,
        { signal: controller.signal, cache: "no-store" },
      )
        .then((response) => readJson<{ items: Client[] }>(response))
        .then((data) => setClients(data.items))
        .catch(() => undefined);
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [initialClientId, query]);
  useEffect(() => {
    if (serviceType !== "DESIGN") return;
    fetch("/api/design", { cache: "no-store" })
      .then((response) => readJson<{ designers: Designer[] }>(response))
      .then((data) => setDesigners(data.designers))
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось загрузить дизайнеров.",
        ),
      );
  }, [serviceType]);

  async function submit(
    form: HTMLFormElement,
    allowDuplicate = false,
    allowConflict = false,
  ) {
    if (!serviceType) return;
    setSaving(true);
    setError("");
    if (!allowDuplicate) setDuplicate(null);
    const values = Object.fromEntries(new FormData(form)) as Record<
      string,
      unknown
    >;
    const payload: Record<string, unknown> = {
      ...values,
      type: serviceType,
      clientId,
      sourceLeadId,
      sourceOrderId,
      allowDuplicate,
      allowConflict,
    };
    if (serviceType === "INSPECTION") {
      payload.scheduledStartAt = vladivostokEpoch(
        String(values.scheduleDate),
        String(values.startTime),
      );
      payload.scheduledEndAt = vladivostokEpoch(
        String(values.scheduleDate),
        String(values.endTime),
      );
    }
    try {
      const created = await readJson<{
        order?: { id: string };
        orderId?: string;
      }>(
        await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      const orderId = created.order?.id || created.orderId;
      if (!orderId) throw new Error("Заказ создан без идентификатора.");
      onCreated(orderId);
    } catch (reason) {
      const failure = reason as Error & {
        code?: string;
        duplicate?: { orderId: string; orderNumber: string };
        conflict?: {
          orderNumber: string | null;
          clientName: string | null;
          scheduledStartAt: number;
          scheduledEndAt: number;
        };
      };
      if (failure.code === "POSSIBLE_DUPLICATE" && failure.duplicate)
        setDuplicate(failure.duplicate);
      else if (failure.code === "SCHEDULE_CONFLICT" && failure.conflict)
        setConflict(failure.conflict);
      else setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  const schedule = initialSchedule || defaultSchedule;
  const title = SERVICE_OPTIONS.find(
    (item) => item.type === serviceType,
  )?.label;
  return (
    <div
      className="modal-wrap order-drawer-wrap"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="order-drawer universal-order-drawer"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <span className="eyebrow">НОВЫЙ ЗАКАЗ</span>
            <h3>{title || "Выберите услугу"}</h3>
          </div>
          <button aria-label="Закрыть форму" onClick={onClose}>
            ×
          </button>
        </header>
        {!serviceType ? (
          <div className="service-picker">
            <p>Каждая услуга создаётся как самостоятельный заказ клиента.</p>
            {SERVICE_OPTIONS.map((service) => {
              const permitted =
                service.type !== "DESIGN" ||
                currentUser.role === "OWNER" ||
                access.actions["design.create"];
              return (
                <button
                  key={service.type}
                  type="button"
                  disabled={!permitted}
                  onClick={() => setServiceType(service.type)}
                >
                  <span>
                    <b>{service.label}</b>
                    <small>{service.description}</small>
                  </span>
                  <em>→</em>
                </button>
              );
            })}
          </div>
        ) : (
          <form
            ref={formRef}
            className="order-form"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void submit(event.currentTarget);
            }}
          >
            <button
              type="button"
              className="link service-back wide"
              onClick={() => setServiceType(null)}
            >
              ← Изменить услугу
            </button>
            <label className="wide">
              <span>Клиент *</span>
              {initialClientId ? (
                <input value="Клиент выбран из карточки" readOnly />
              ) : (
                <>
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setClientId("");
                    }}
                    placeholder="ФИО или телефон"
                    required={!clientId}
                  />
                  {clients.map((client) => (
                    <button
                      type="button"
                      className="client-option"
                      key={client.id}
                      onClick={() => {
                        setClientId(client.id);
                        setQuery(`${client.fullName} · ${client.phone}`);
                        setClients([]);
                      }}
                    >
                      <b>{client.fullName}</b>
                      <span>{client.phone}</span>
                    </button>
                  ))}
                </>
              )}
            </label>
            <ResidentialComplexFields
              initialId={prefill?.residentialComplexId}
              initialName={prefill?.residentialComplex}
              initialAddress={prefill?.address}
              canCreate={
                currentUser.role === "OWNER" ||
                Boolean(access.actions["residentialComplexes.create"])
              }
            />
            <label>
              <span>Квартира *</span>
              <input
                name="apartmentNumber"
                defaultValue={prefill?.apartmentNumber || ""}
                required
              />
            </label>
            <label>
              <span>Площадь, м²</span>
              <input
                name="areaSqm"
                inputMode="decimal"
                defaultValue={prefill?.areaSqm ?? ""}
              />
            </label>
            {serviceType === "INSPECTION" ? (
              <fieldset className="wide schedule-fields">
                <legend>Расписание</legend>
                <label>
                  <span>Дата *</span>
                  <input
                    name="scheduleDate"
                    type="date"
                    defaultValue={schedule.date}
                    required
                  />
                </label>
                <label>
                  <span>Начало *</span>
                  <input
                    name="startTime"
                    type="time"
                    step="900"
                    defaultValue={schedule.startTime}
                    required
                  />
                </label>
                <label>
                  <span>Окончание *</span>
                  <input
                    name="endTime"
                    type="time"
                    step="900"
                    defaultValue={schedule.endTime}
                    required
                  />
                </label>
              </fieldset>
            ) : null}
            {serviceType === "DESIGN" ? (
              <>
                <label>
                  <span>Дата начала</span>
                  <input name="plannedStartDate" type="date" />
                </label>
                <label>
                  <span>Плановое завершение</span>
                  <input name="plannedEndDate" type="date" />
                </label>
                <label>
                  <span>Дизайнер</span>
                  <select name="designerEmployeeId" defaultValue="">
                    <option value="">Не назначен</option>
                    {designers.map((designer) => (
                      <option value={designer.id} key={designer.id}>
                        {designer.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <label>
              <span>Стоимость *</span>
              <input
                name="price"
                inputMode="decimal"
                placeholder={
                  serviceType === "INSPECTION"
                    ? "7 000"
                    : serviceType === "DESIGN"
                      ? "180 000"
                      : "3 500 000"
                }
                required
              />
            </label>
            <label>
              <span>Ответственный *</span>
              <select
                name="responsibleUserId"
                defaultValue={prefill?.responsibleUserId || currentUser.id}
                disabled={!access.actions["orders.edit"]}
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>
            {serviceType === "INSPECTION" ? (
              <label>
                <span>Приёмку проводит *</span>
                <select name="inspectorUserId" defaultValue={currentUser.id}>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="wide">
              <span>Комментарий</span>
              <textarea name="comment" rows={4} />
            </label>
            {duplicate ? (
              <div className="duplicate-warning wide" role="alert">
                <b>ВОЗМОЖНЫЙ ДУБЛЬ</b>
                <p>
                  У клиента уже существует дизайн-проект по этому адресу:{" "}
                  {duplicate.orderNumber}.
                </p>
                <div>
                  {onOpenExisting ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => onOpenExisting(duplicate.orderId)}
                    >
                      Открыть
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="primary"
                    disabled={saving}
                    onClick={() =>
                      formRef.current && void submit(formRef.current, true)
                    }
                  >
                    Создать всё равно
                  </button>
                </div>
              </div>
            ) : null}
            {conflict ? (
              <div className="duplicate-warning wide" role="alert">
                <b>КОНФЛИКТ РАСПИСАНИЯ</b>
                <p>
                  В это время уже назначена приёмка
                  {conflict.orderNumber ? ` ${conflict.orderNumber}` : ""}
                  {conflict.clientName ? ` · ${conflict.clientName}` : ""}.
                </p>
                <div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setConflict(null)}
                  >
                    Изменить время
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={saving}
                    onClick={() =>
                      formRef.current &&
                      void submit(formRef.current, false, true)
                    }
                  >
                    Создать несмотря на конфликт
                  </button>
                </div>
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
                {saving
                  ? "Создаём…"
                  : serviceType === "DESIGN"
                    ? "Создать дизайн-проект"
                    : "Создать заказ"}
              </button>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}
