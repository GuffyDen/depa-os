"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { AuthUser } from "../lib/auth";
import type { AccessProfile } from "../lib/permission-definitions";

const SOURCE_LABELS: Record<string, string> = { WEBSITE: "Сайт", FARPOST: "FarPost", AVITO: "Avito", REFERRAL: "Сарафанное радио", OTHER: "Другое" };
const PURPOSE_LABELS: Record<string, string> = { MATERIALS: "Материалы", WORKS: "Работы", ADDITIONAL_WORKS: "Дополнительные работы", OTHER: "Другое" };
type SourceOption = { value: string; label: string };
type Responsible = { id: string; name: string };
type Client = {
  id: string; fullName: string; phone: string; phoneNormalized: string; secondaryPhone: string | null; email: string | null;
  preferredContact: string | null; source: string; comment: string | null; responsibleUserId: string; responsibleName: string;
  status: "ACTIVE" | "ARCHIVED"; archivedAt: number | null; createdAt: number; updatedAt: number; projectCount: number;
};
type ClientDetail = {
  client: Client;
  projects: { id: string; name: string; address: string | null; status: string }[];
  orders: { id: string; number: string; title: string; status: string; amountKopecks: number }[];
  finances: { id: string; transactionDate: number; amountKopecks: number; type: string; purpose: string | null; title: string; projectName: string | null }[];
  tasks: { id: string; title: string; deadline: number | null; status: string }[];
  documents: { id: string; originalFilename: string; category: string; createdAt: number }[];
};
type ListResponse = { items: Client[]; total: number; hasMore: boolean; nextOffset: number | null; responsibleUsers: Responsible[]; sources: SourceOption[]; error?: string };
type ClientTab = "overview" | "projects" | "orders" | "finances" | "tasks" | "documents";

function formatDate(seconds: number | null) {
  return seconds ? new Date(seconds * 1000).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

function money(kopecks: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(kopecks / 100);
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toLocaleUpperCase("ru-RU");
}

async function json<T>(response: Response): Promise<T> {
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw Object.assign(new Error(result.error || "Не удалось выполнить операцию."), { status: response.status, result });
  return result;
}

function EmptyTab({ title, action }: { title: string; action?: string }) {
  return <div className="client-tab-empty"><span>◎</span><h4>{title}</h4>{action ? <button className="secondary" disabled title="Функция будет доступна в следующем модуле">{action}</button> : null}</div>;
}

function ClientForm({ mode, client, currentUser, responsibleUsers, sources, onClose, onSaved, onOpenDuplicate }: {
  mode: "create" | "edit"; client?: Client; currentUser: AuthUser; responsibleUsers: Responsible[]; sources: SourceOption[];
  onClose: () => void; onSaved: (detail: ClientDetail) => void; onOpenDuplicate: (client: Client) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<Client | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>, forceDuplicate = false) {
    event.preventDefault();
    setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries()) as Record<string, unknown>;
    if (mode === "create") payload.forceDuplicate = forceDuplicate;
    try {
      const detail = await json<ClientDetail>(await fetch(mode === "create" ? "/api/clients" : `/api/clients/${client?.id}`, {
        method: mode === "create" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      }));
      onSaved(detail);
    } catch (reason) {
      const failure = reason as Error & { status?: number; result?: { duplicate?: Client } };
      if (failure.status === 409 && failure.result?.duplicate) setDuplicate(failure.result.duplicate);
      else setError(failure.message);
    } finally { setSaving(false); }
  }

  return <div className="modal-wrap client-drawer-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="client-drawer" role="dialog" aria-modal="true" aria-label={mode === "create" ? "Добавить клиента" : "Редактировать клиента"}>
      <header className="client-drawer-head"><div><span className="eyebrow">{mode === "create" ? "НОВЫЙ КЛИЕНТ" : "КАРТОЧКА КЛИЕНТА"}</span><h3>{mode === "create" ? "Добавить клиента" : "Редактировать"}</h3></div><button onClick={onClose} aria-label="Закрыть">×</button></header>
      <form ref={formRef} className="client-form" onSubmit={submit}>
        <label className="wide"><span>ФИО *</span><input name="fullName" required defaultValue={client?.fullName ?? ""} autoFocus placeholder="Александр Иванов" /></label>
        <label><span>Телефон *</span><input name="phone" required defaultValue={client?.phone ?? ""} inputMode="tel" placeholder="+7 999 123-45-67" /></label>
        <label><span>Дополнительный телефон</span><input name="secondaryPhone" defaultValue={client?.secondaryPhone ?? ""} inputMode="tel" /></label>
        <label><span>Email</span><input name="email" type="email" defaultValue={client?.email ?? ""} /></label>
        <label><span>Предпочтительная связь</span><select name="preferredContact" defaultValue={client?.preferredContact ?? ""}><option value="">Не указано</option><option value="PHONE">Телефон</option><option value="EMAIL">Email</option></select></label>
        <label><span>Источник *</span><select name="source" required defaultValue={client?.source ?? "WEBSITE"}>{sources.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}</select></label>
        <label><span>Ответственный *</span><select name="responsibleUserId" required defaultValue={client?.responsibleUserId ?? currentUser.id}>{responsibleUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
        <label className="wide"><span>Комментарий</span><textarea name="comment" rows={5} defaultValue={client?.comment ?? ""} placeholder="Контекст договорённостей и важные детали" /></label>
        {duplicate ? <div className="duplicate-warning wide"><span className="eyebrow orange">ВОЗМОЖНЫЙ ДУБЛЬ</span><h4>Клиент с таким номером уже существует</h4><b>{duplicate.fullName}</b><p>{duplicate.phone}</p><div><button type="button" className="secondary" onClick={() => onOpenDuplicate(duplicate)}>Открыть клиента</button><button type="button" className="primary" disabled={saving} onClick={() => { if (formRef.current) void submit({ preventDefault() {}, currentTarget: formRef.current } as unknown as FormEvent<HTMLFormElement>, true); }}>Создать всё равно</button></div></div> : null}
        {error ? <div className="form-error wide">{error}</div> : null}
        <div className="client-form-actions wide"><button type="button" className="secondary" onClick={onClose}>Отмена</button><button className="primary" disabled={saving}>{saving ? "Сохраняем…" : mode === "create" ? "Создать клиента" : "Сохранить изменения"}</button></div>
      </form>
    </aside>
  </div>;
}

function ClientCard({ clientId, access, onClose, onChanged, onEdit }: { clientId: string; access: AccessProfile; onClose: () => void; onChanged: () => void; onEdit: (client: Client) => void }) {
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [tab, setTab] = useState<ClientTab>("overview");
  const [error, setError] = useState("");
  useEffect(() => { let active = true; fetch(`/api/clients/${clientId}`, { cache: "no-store" }).then((response) => json<ClientDetail>(response)).then((result) => { if (active) setDetail(result); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Не удалось открыть клиента."); }); return () => { active = false; }; }, [clientId]);
  async function archive(archived: boolean) {
    if (!detail || !window.confirm(archived ? "Архивировать клиента? История и связи сохранятся." : "Восстановить клиента?")) return;
    try {
      const next = await json<ClientDetail>(await fetch(`/api/clients/${clientId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: archived ? "ARCHIVE" : "RESTORE" }) }));
      setDetail(next); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось изменить статус."); }
  }
  if (error && !detail) return <div className="modal-wrap client-drawer-wrap"><aside className="client-drawer"><header className="client-drawer-head"><h3>Клиент</h3><button onClick={onClose}>×</button></header><div className="form-error">{error}</div></aside></div>;
  if (!detail) return <div className="modal-wrap client-drawer-wrap"><aside className="client-drawer"><div className="finance-loading">Загружаем карточку…</div></aside></div>;
  const client = detail.client;
  const tabs: { id: ClientTab; label: string; count?: number }[] = [
    { id: "overview", label: "Обзор" }, { id: "projects", label: "Объекты", count: detail.projects.length }, { id: "orders", label: "Заказы", count: detail.orders.length },
    { id: "finances", label: "Финансы", count: detail.finances.length }, { id: "tasks", label: "Задачи", count: detail.tasks.length }, { id: "documents", label: "Документы", count: detail.documents.length },
  ];
  return <div className="modal-wrap client-drawer-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="client-card-drawer" role="dialog" aria-modal="true" aria-label={`Клиент ${client.fullName}`}>
    <header className="client-card-head"><button className="back" onClick={onClose}>← Все клиенты</button><div><span className={`client-status ${client.status.toLowerCase()}`}>{client.status === "ACTIVE" ? "Активный" : "Архивный"}</span><h2>{client.fullName}</h2><a href={`tel:${client.phoneNormalized}`}>{client.phone}</a></div><div className="client-card-actions"><a className="secondary" href={`tel:${client.phoneNormalized}`}>Позвонить</a><button className="secondary" onClick={() => navigator.clipboard?.writeText(client.phone)}>Скопировать номер</button>{access.actions["clients.edit"] ? <button className="primary" onClick={() => onEdit(client)}>Редактировать</button> : null}<button aria-label="Закрыть" onClick={onClose}>×</button></div></header>
    <nav className="client-tabs" aria-label="Разделы карточки">{tabs.map((item) => <button className={tab === item.id ? "active" : ""} key={item.id} onClick={() => setTab(item.id)}>{item.label}{item.count != null ? <em>{item.count}</em> : null}</button>)}</nav>
    <div className="client-card-content">
      {error ? <div className="form-error">{error}</div> : null}
      {tab === "overview" ? <div className="client-overview"><section className="panel client-facts"><div><span>Телефон</span><a href={`tel:${client.phoneNormalized}`}>{client.phone}</a></div><div><span>Дополнительный телефон</span><b>{client.secondaryPhone || "—"}</b></div><div><span>Email</span><b>{client.email || "—"}</b></div><div><span>Источник</span><b>{SOURCE_LABELS[client.source]}</b></div><div><span>Ответственный</span><b>{client.responsibleName}</b></div><div><span>Дата создания</span><b>{formatDate(client.createdAt)}</b></div></section><section className="client-kpis"><article className="panel"><span>Объектов</span><b>{detail.projects.length}</b></article><article className="panel"><span>Заказов</span><b>{detail.orders.length}</b></article><article className="panel"><span>Открытых задач</span><b>{detail.tasks.filter((task) => !["DONE", "COMPLETED", "CLOSED"].includes(task.status)).length}</b></article></section><section className="panel client-comment"><span className="eyebrow">КОММЕНТАРИЙ</span><p>{client.comment || "Комментарий пока не добавлен."}</p></section><div className="client-related-actions"><button className="secondary" disabled title="Будет подключено в модуле задач">Добавить задачу</button><button className="secondary" disabled title="Будет подключено в модуле заказов">Создать заказ</button>{access.actions["clients.edit"] ? <button className="link danger-text" onClick={() => archive(client.status === "ACTIVE")}>{client.status === "ACTIVE" ? "Архивировать" : "Восстановить"}</button> : null}</div></div> : null}
      {tab === "projects" ? detail.projects.length ? <div className="client-linked-list">{detail.projects.map((project) => <article className="panel" key={project.id}><div><b>{project.name}</b><span>{project.address || "Адрес не указан"}</span></div><em>{project.status}</em></article>)}</div> : <EmptyTab title="Объектов пока нет." action="Создать объект" /> : null}
      {tab === "orders" ? detail.orders.length ? <div className="client-linked-list">{detail.orders.map((order) => <article className="panel" key={order.id}><div><b>{order.number} · {order.title}</b><span>{money(order.amountKopecks)}</span></div><em>{order.status}</em></article>)}</div> : <EmptyTab title="Заказов пока нет." /> : null}
      {tab === "finances" ? detail.finances.length ? <div className="panel client-finance-list"><div className="client-finance-row head"><span>Дата</span><span>Операция</span><span>Назначение</span><span>Объект</span><span>Сумма</span></div>{detail.finances.map((item) => <div className="client-finance-row" key={item.id}><span>{formatDate(item.transactionDate)}</span><span><b>{item.title}</b><small>{item.type}</small></span><span>{PURPOSE_LABELS[item.purpose || ""] || "—"}</span><span>{item.projectName || "—"}</span><strong>{money(item.amountKopecks)}</strong></div>)}</div> : <EmptyTab title="Финансовых операций пока нет." /> : null}
      {tab === "tasks" ? detail.tasks.length ? <div className="client-linked-list">{detail.tasks.map((task) => <article className="panel" key={task.id}><div><b>{task.title}</b><span>{task.deadline ? `До ${formatDate(task.deadline)}` : "Без срока"}</span></div><em>{task.status}</em></article>)}</div> : <EmptyTab title="Задач пока нет." /> : null}
      {tab === "documents" ? detail.documents.length ? <div className="client-linked-list">{detail.documents.map((document) => <article className="panel" key={document.id}><div><b>{document.originalFilename}</b><span>{document.category} · {formatDate(document.createdAt)}</span></div></article>)}</div> : <EmptyTab title="Документов пока нет." /> : null}
    </div>
  </aside></div>;
}

export function ClientsScreen({ currentUser, access, initialClientId = null, onClientClosed }: { currentUser: AuthUser; access: AccessProfile; initialClientId?: string | null; onClientClosed?: () => void }) {
  const [items, setItems] = useState<Client[]>([]);
  const [responsibleUsers, setResponsibleUsers] = useState<Responsible[]>([]);
  const [sources, setSources] = useState<SourceOption[]>(Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label })));
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("ALL");
  const [responsible, setResponsible] = useState("ALL");
  const [status, setStatus] = useState("ACTIVE");
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState<{ mode: "create" | "edit"; client?: Client } | null>(null);
  const [openClientId, setOpenClientId] = useState<string | null>(initialClientId);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      const params = new URLSearchParams({ search, source, responsibleUserId: responsible, status, limit: "30", offset: "0" });
      fetch(`/api/clients?${params}`, { cache: "no-store", signal: controller.signal }).then((response) => json<ListResponse>(response)).then((result) => {
        setItems(result.items); setTotal(result.total); setNextOffset(result.nextOffset); setResponsibleUsers(result.responsibleUsers); setSources(result.sources);
      }).catch((reason) => { if (reason instanceof Error && reason.name !== "AbortError") setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, source, responsible, status, revision]);

  async function loadMore() {
    if (nextOffset == null) return;
    setLoading(true);
    const params = new URLSearchParams({ search, source, responsibleUserId: responsible, status, limit: "30", offset: String(nextOffset) });
    try { const result = await json<ListResponse>(await fetch(`/api/clients?${params}`, { cache: "no-store" })); setItems((current) => [...current, ...result.items]); setNextOffset(result.nextOffset); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить клиентов."); }
    finally { setLoading(false); }
  }

  function saved(detail: ClientDetail) { setForm(null); setOpenClientId(detail.client.id); setRevision((value) => value + 1); }
  return <section className="screen-section clients-screen">
    <div className="screen-intro"><div><span className="eyebrow">ОТНОШЕНИЯ</span><h2>Клиенты</h2><p>Единая история обращений, заказов, объектов и оплат.</p></div>{access.actions["clients.create"] ? <button className="primary" onClick={() => setForm({ mode: "create" })}>＋ Добавить клиента</button> : null}</div>
    <div className="panel client-list-panel">
      <div className="client-filters"><label className="client-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по ФИО, телефону или email" /></label><label><span>Источник</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="ALL">Все источники</option>{sources.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label><span>Ответственный</span><select value={responsible} onChange={(event) => setResponsible(event.target.value)}><option value="ALL">Все ответственные</option>{responsibleUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label><span>Статус</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Все статусы</option><option value="ACTIVE">Активные</option><option value="ARCHIVED">Архивные</option></select></label></div>
      <div className="client-list-meta"><span>{total ? `Найдено: ${total}` : "Клиенты"}</span><small>Сначала новые</small></div>
      {error ? <div className="form-error client-list-error">{error}</div> : null}
      {!loading && items.length === 0 ? <div className="clients-empty"><span>◎</span><h3>Клиентов пока нет.</h3><p>{search || source !== "ALL" || responsible !== "ALL" || status !== "ACTIVE" ? "Измените параметры поиска или фильтры." : "Добавьте первого клиента, чтобы начать работу."}</p>{access.actions["clients.create"] && !search && source === "ALL" && responsible === "ALL" && status === "ACTIVE" ? <button className="primary" onClick={() => setForm({ mode: "create" })}>Добавить клиента</button> : null}</div> : null}
      {items.length ? <div className="client-table"><div className="client-row client-head"><span>Клиент</span><span>Телефон</span><span>Источник</span><span>Ответственный</span><span>Объекты</span><span>Создан</span></div>{items.map((client) => <button className="client-row" key={client.id} onClick={() => setOpenClientId(client.id)}><span className="client-name"><i>{initials(client.fullName)}</i><span><b>{client.fullName}</b>{client.status === "ARCHIVED" ? <small>Архивный</small> : null}</span></span><span>{client.phone}</span><span>{SOURCE_LABELS[client.source] || client.source}</span><span>{client.responsibleName}</span><span>{client.projectCount}</span><span>{formatDate(client.createdAt)} <em>›</em></span></button>)}</div> : null}
      {loading ? <div className="finance-loading">Загружаем клиентов…</div> : null}
      {nextOffset != null && !loading ? <div className="client-load-more"><button className="secondary" onClick={loadMore}>Показать ещё</button></div> : null}
    </div>
    {openClientId ? <ClientCard key={openClientId} clientId={openClientId} access={access} onClose={() => { setOpenClientId(null); onClientClosed?.(); }} onChanged={() => setRevision((value) => value + 1)} onEdit={(client) => setForm({ mode: "edit", client })} /> : null}
    {form ? <ClientForm mode={form.mode} client={form.client} currentUser={currentUser} responsibleUsers={responsibleUsers} sources={sources} onClose={() => setForm(null)} onSaved={saved} onOpenDuplicate={(client) => { setForm(null); setOpenClientId(client.id); }} /> : null}
  </section>;
}
