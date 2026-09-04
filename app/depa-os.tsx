"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUser } from "../lib/auth";
import type { AccessProfile, ActionPermission, ModuleKey } from "../lib/permission-definitions";
import { FinanceOperationModal, FinanceScreen, OperationPickerModal, money, readFinance, type FinanceData, type FinanceMode } from "./finance-ui";
import { TeamAccessScreen } from "./team-access-ui";
import { ClientsScreen } from "./clients-ui";
import { ProjectsScreen } from "./projects-ui";
import { CrmScreen, type Lead } from "./crm-ui";
import { OrdersScreen, type Order } from "./orders-ui";
import { ResidentialComplexesScreen } from "./residential-complexes-ui";

type Section = "dashboard" | "crm" | "clients" | "orders" | "complexes" | "objects" | "finance" | "tasks" | "team" | "contractors" | "docs";

const nav: { group: string; items: { id: Section; label: string; icon: string; count?: number }[] }[] = [
  { group: "Компания", items: [
    { id: "dashboard", label: "Обзор", icon: "◫" },
    { id: "crm", label: "CRM", icon: "↗" },
    { id: "clients", label: "Клиенты", icon: "◎" },
    { id: "orders", label: "Заказы", icon: "▤" },
    { id: "complexes", label: "ЖК", icon: "⌂" },
  ]},
  { group: "Производство", items: [
    { id: "objects", label: "Объекты", icon: "◇" },
    { id: "tasks", label: "Задачи", icon: "✓" },
  ]},
  { group: "Учёт", items: [
    { id: "finance", label: "Финансы", icon: "₽" },
    { id: "team", label: "Команда", icon: "⊙" },
    { id: "contractors", label: "Исполнители", icon: "⌁" },
    { id: "docs", label: "Документы", icon: "▱" },
  ]},
];

const moduleBySection: Record<Section, ModuleKey> = { dashboard: "dashboard", crm: "crm", clients: "clients", orders: "orders", complexes: "projects", objects: "projects", tasks: "tasks", finance: "finance", team: "team", contractors: "contractors", docs: "documents" };
function canOpenSection(access: AccessProfile, section: Section) { return section === "complexes" ? Boolean(access.actions["residentialComplexes.view"]) : Boolean(access.modules[moduleBySection[section]]); }
function Brand() {
  return <div className="brand" aria-label="ДЕПА СТРОЙ"><span>ДЕПА</span><b>СТРОЙ</b><i>OS</i></div>;
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toLocaleUpperCase("ru-RU");
}

function Sidebar({ section, onChange, open, onClose, user, access, onProfile, crmCount }: { section: Section; onChange: (s: Section) => void; open: boolean; onClose: () => void; user: AuthUser; access: AccessProfile; onProfile: () => void; crmCount: number }) {
  const visibleNav = nav.map((group) => ({ ...group, items: group.items.filter((item) => item.id === "complexes" ? access.actions["residentialComplexes.view"] : access.modules[moduleBySection[item.id]]) })).filter((group) => group.items.length > 0);
  return <aside className={`sidebar ${open ? "open" : ""}`}>
    <div className="side-head"><Brand /><button className="icon-btn mobile-only" onClick={onClose} aria-label="Закрыть меню">×</button></div>
    <nav>
      {visibleNav.map(group => <div className="nav-group" key={group.group}>
        <small>{group.group}</small>
        {group.items.map(item => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => { onChange(item.id); onClose(); }}>
          <span className="nav-icon">{item.icon}</span><span>{item.label}</span>{(item.id === "crm" ? crmCount : item.count) ? <em>{item.id === "crm" ? crmCount : item.count}</em> : null}
        </button>)}
      </div>)}
    </nav>
    <button className="side-footer" onClick={onProfile} aria-label="Открыть профиль">
      <span className="avatar">{initials(user.name)}</span><span className="side-user"><strong>{user.name}</strong><span>{user.role}</span></span><span className="side-more">•••</span>
    </button>
  </aside>;
}

function Topbar({ title, onMenu, onAdd, onSearch }: { title: string; onMenu: () => void; onAdd?: () => void; onSearch?: () => void }) {
  return <header className="topbar">
    <div className="topbar-inner">
      <button className="icon-btn mobile-only" onClick={onMenu} aria-label="Открыть меню">☰</button>
      <div><small>DEPA STROY · ВЛАДИВОСТОК</small><h1>{title}</h1></div>
      <div className="top-actions">
        {onSearch ? <button className="search" onClick={onSearch}><span>⌕</span><span className="search-label">Найти клиента, объект, операцию</span><kbd>⌘ K</kbd></button> : null}
        {onAdd ? <button className="primary" onClick={onAdd}>＋ <span>Добавить</span></button> : null}
      </div>
    </div>
  </header>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return <div className="metric"><div className="metric-top"><span>{label}</span><i className={tone || ""}>↗</i></div><strong>{value}</strong><small>{detail}</small></div>;
}

function Dashboard({ onObject, onSection, onLead, onOrder, user }: { onObject: (id: string) => void; onSection: (s: Section) => void; onLead: (id:string) => void; onOrder: (id:string) => void; user: AuthUser }) {
  const [finance, setFinance] = useState<FinanceData | null>(null);
  const [projectSummary, setProjectSummary] = useState<{ total: number; items: { id: string; displayName: string; clientName: string; status: string; responsibleName: string; plannedEndDate: number | null }[] }>({ total: 0, items: [] });
  const [crmSummary, setCrmSummary] = useState<{ stageCounts: Record<string,number>; attention: Lead[] }>({ stageCounts: {}, attention: [] });
  const [orderAttention, setOrderAttention] = useState<Order[]>([]);
  useEffect(() => { let cancelled = false; readFinance().then((result) => { if (!cancelled) setFinance(result); }).catch(() => undefined); return () => { cancelled = true; }; }, []);
  useEffect(() => { let cancelled = false; fetch("/api/projects?status=WORKING&limit=4", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject()).then((result: typeof projectSummary) => { if (!cancelled) setProjectSummary(result); }).catch(() => undefined); return () => { cancelled = true; }; }, []);
  useEffect(() => { let cancelled=false;Promise.all([fetch("/api/crm?view=list&status=ACTIVE&limit=1",{cache:"no-store"}),fetch("/api/crm?attention=1&status=ACTIVE",{cache:"no-store"})]).then(async ([summary,attention])=>{if(!summary.ok||!attention.ok)throw new Error();const [s,a]=await Promise.all([summary.json(),attention.json()]);if(!cancelled)setCrmSummary({stageCounts:s.stageCounts??{},attention:a.items??[]});}).catch(()=>undefined);return()=>{cancelled=true};},[]);
  useEffect(() => { let cancelled=false;fetch("/api/orders?attention=1",{cache:"no-store"}).then(response=>response.ok?response.json():Promise.reject()).then((data:{items?:Order[]})=>{if(!cancelled)setOrderAttention(data.items??[])}).catch(()=>undefined);return()=>{cancelled=true};},[]);
  return <>
    <section className="welcome"><div><span className="eyebrow">РАБОЧИЙ КОНТУР</span><h2>{user.name.split(" ")[0]}, текущая ситуация</h2><p>Только реальные данные доступных модулей.</p></div><div className="weather"><span>Владивосток</span><b>DEPA</b><small>production</small></div></section>
    <section className="metrics-grid">
      <Metric label="ОБЪЕКТЫ В РАБОТЕ" value={String(projectSummary.total)} detail="Реальные объекты в рабочем контуре" />
      <Metric label="ПОСТУПЛЕНИЯ · СЕГОДНЯ" value={finance ? money(finance.summary.todayIncomeKopecks) : "—"} detail="По подтверждённым финансовым операциям" />
      <Metric label="ДЕНЬГИ В КАССАХ" value={finance ? money(finance.physicalTotalKopecks) : "—"} detail={`${finance?.cashboxes.filter((box) => box.status === "ACTIVE").length ?? 0} активных касс · физический остаток, не прибыль`} />
      <Metric label="УПРАВЛЕНЧЕСКАЯ ПРИБЫЛЬ" value={finance?.depaProfitKopecks != null ? money(finance.depaProfitKopecks) : "—"} detail={finance?.capabilities.viewProfit ? "Расчёт по текущему финансовому реестру" : "Нет права на просмотр"} tone="orange" />
    </section>
    <div className="dashboard-grid">
      <section className="panel attention-panel">
        <div className="panel-head"><div><span className="eyebrow orange">ТРЕБУЕТ ВНИМАНИЯ</span><h3>Не упустить сегодня</h3></div><b className="badge-alert">{crmSummary.attention.length+orderAttention.length}</b></div>
        <div className="attention-list">
          {crmSummary.attention.map((lead) => <button key={lead.id} onClick={() => onLead(lead.id)}><i>↗</i><div><strong>{lead.name}</strong><span>{lead.nextActionComment || lead.phone}</span></div><em>CRM</em></button>)}
          {orderAttention.map((order) => <button key={order.id} onClick={() => onOrder(order.id)}><i>₽</i><div><strong>{order.orderNumber} · {order.clientName}</strong><span>Приёмка завершена · к оплате {money(order.remainingKopecks??0)}</span></div><em>Заказ</em></button>)}
          {!crmSummary.attention.length&&!orderAttention.length ? <div className="finance-empty">CRM-действий, требующих внимания, нет.</div> : null}
        </div>
      </section>
      <section className="panel tasks-panel">
        <div className="panel-head"><div><span className="eyebrow">СЕГОДНЯ</span><h3>Задачи</h3></div><button className="link" onClick={() => onSection("tasks")}>Все задачи →</button></div>
        <div className="finance-empty">Задачи появятся после подключения единого Tasks module.</div>
      </section>
    </div>
    <section className="panel objects-panel">
      <div className="panel-head"><div><span className="eyebrow">ПРОИЗВОДСТВО</span><h3>Активные объекты</h3></div><button className="link" onClick={() => onSection("objects")}>Все объекты →</button></div>
      <div className="object-list">
        {projectSummary.items.map((project) => <button className="object-row" key={project.id} onClick={() => { window.history.pushState(null, "", `/dashboard?section=objects&projectId=${encodeURIComponent(project.id)}`); onObject(project.id); }}>
          <div className="project-mark">{project.displayName.slice(0,2).toLocaleUpperCase("ru-RU")}</div>
          <div className="object-title"><strong>{project.displayName}</strong><span>{project.clientName}</span></div>
          <div className="stage"><span>{project.status === "ACTIVE" ? "В работе" : "Подготовка"}</span></div>
          <div className="object-meta"><span>Сдача</span><b>{project.plannedEndDate ? new Date(project.plannedEndDate * 1000).toLocaleDateString("ru-RU") : "—"}</b></div>
          <div className="object-meta"><span>Ответственный</span><b>{project.responsibleName}</b></div>
          <em className="chevron">›</em>
        </button>)}
        {!projectSummary.items.length ? <div className="finance-empty">Объектов пока нет.</div> : null}
      </div>
    </section>
    <div className="dashboard-grid lower">
      <section className="panel funnel-panel">
        <div className="panel-head"><div><span className="eyebrow">CRM</span><h3>Воронка продаж</h3></div><button className="link" onClick={() => onSection("crm")}>Открыть CRM →</button></div>
        <div className="funnel">{[["NEW","Новые"],["CONTACTED","Связались"],["CALCULATION","Расчёт"],["PROPOSAL","КП"],["CONTRACT","Договор"]].map(([stage,label],index)=><div key={stage} className={index===4?"accent":""} style={{height:`${Math.max(18,Math.min(100,24+(crmSummary.stageCounts[stage]||0)*12))}%`}}><b>{crmSummary.stageCounts[stage]||0}</b><span>{label}</span></div>)}</div>
      </section>
      <section className="panel cash-panel">
        <div className="panel-head"><div><span className="eyebrow">КАССЫ</span><h3>Персональные</h3></div><button className="link" onClick={() => onSection("finance")}>Подробнее →</button></div>
        {finance?.cashboxes.filter((box) => box.status === "ACTIVE").map((box, index) => <button className="cash-row" key={box.id} onClick={() => onSection("finance")}><span><i className={`dot ${index ? "gray" : ""}`} />{box.name}</span><b className={box.balanceKopecks < 0 ? "minus" : ""}>{money(box.balanceKopecks)}</b></button>)}
        {!finance?.cashboxes.filter((box) => box.status === "ACTIVE").length && <div className="finance-empty">Активных касс нет.</div>}
        <div className="cash-note"><span>Итого в кассах</span><b>{finance ? money(finance.physicalTotalKopecks) : "—"} · физический остаток</b><span>Инвестиции к возврату</span><b>{finance?.investmentOutstandingKopecks != null ? money(finance.investmentOutstandingKopecks) : "—"} · не входят в кассы</b><span>Клиентские средства</span><b>{finance?.clientFundsKopecks != null ? money(finance.clientFundsKopecks) : "—"} · считаются отдельно</b></div>
      </section>
    </div>
  </>;
}

function EmployeeDashboard({ user, access, onSection }: { user: AuthUser; access: AccessProfile; onSection: (s: Section) => void }) {
  const [finance, setFinance] = useState<FinanceData | null>(null);
  useEffect(() => { if (!access.modules.finance || !access.actions["finance.view"]) return; let active = true; readFinance().then((result) => { if (active) setFinance(result); }).catch(() => undefined); return () => { active = false; }; }, [access]);
  const quickSections = (["objects", "tasks", "finance", "docs"] as Section[]).filter((section) => access.modules[moduleBySection[section]]);
  return <><section className="welcome"><div><span className="eyebrow">РАБОЧИЙ КОНТУР</span><h2>{user.name.split(" ")[0]}, рабочее пространство</h2><p>Здесь отображаются только разрешённые разделы и доступная область данных.</p></div></section><div className="metrics-grid employee-metrics">
    {access.modules.finance && access.actions["finance.view"] ? <Metric label={access.scopes.cashboxes === "ALL" ? "ДОСТУПНЫЕ КАССЫ" : "МОЯ КАССА"} value={finance ? money(finance.physicalTotalKopecks) : "—"} detail={access.scopes.cashboxes === "ALL" ? "Просмотр всех касс · операции только из своей" : "Баланс и история собственной кассы"} /> : null}
    {access.modules.projects ? <Metric label="ОБЪЕКТЫ" value={access.scopes.projects === "ALL" ? "Все" : "Назначенные"} detail="Доступ определяется Owner" /> : null}
    {access.actions["finance.viewClientFunds"] && finance?.clientFundsKopecks !== null ? <Metric label="СРЕДСТВА КЛИЕНТОВ" value={finance ? money(finance.clientFundsKopecks ?? 0) : "—"} detail="В доступной области" /> : null}
    {access.actions["finance.viewInvestments"] && finance?.investmentOutstandingKopecks !== null ? <Metric label="ИНВЕСТИЦИИ К ВОЗВРАТУ" value={finance ? money(finance.investmentOutstandingKopecks ?? 0) : "—"} detail="Не входят в деньги касс" tone="orange" /> : null}
    {access.actions["finance.viewProfit"] && finance?.depaProfitKopecks !== null ? <Metric label="ПРИБЫЛЬ DEPA" value={finance ? money(finance.depaProfitKopecks ?? 0) : "—"} detail="Разрешено Owner" tone="orange" /> : null}
  </div><div className="panel employee-start"><div><span className="eyebrow">БЫСТРЫЙ ДОСТУП</span><h3>Рабочее пространство</h3><p>Прямые переходы и API также проверяют эти права.</p></div>{quickSections.map((section) => <button className={section === "finance" ? "primary" : "secondary"} key={section} onClick={() => onSection(section)}>{nav.flatMap((group) => group.items).find((item) => item.id === section)?.label}</button>)}</div></>;
}

type GenericSection = Exclude<Section, "dashboard"|"crm"|"clients"|"complexes"|"objects"|"finance">;
const genericData: Record<GenericSection, { eyebrow: string; title: string; desc: string; columns: string[]; rows: string[][] }> = {
  orders: { eyebrow:"УСЛУГИ", title:"Заказы", desc:"Приёмка и ремонт учитываются как отдельные заказы.", columns:["Заказ","Клиент","Услуга","Стоимость","Статус"], rows:[]},
  tasks: { eyebrow:"КОНТРОЛЬ", title:"Задачи", desc:"Общие, CRM-задачи и задачи по объектам в одном месте.", columns:["Задача","Связь","Дедлайн","Ответственный","Статус"], rows:[]},
  team: { eyebrow:"КОМАНДА", title:"Сотрудники", desc:"Сотрудник может работать в DEPA без аккаунта в системе.", columns:["Сотрудник","Должность","Телефон","Объекты","Доступ"], rows:[["Денис Учайкин","Владелец","+7 914 693-90-45","Все","Owner"],["Павел Костенко","Владелец","+7 984 191-19-91","Все","Owner"],["Антон Ковалёв","Прораб","+7 924 102-18-44","3 объекта","Ограниченный"],["Илья Семёнов","Снабженец","+7 914 731-24-02","2 объекта","Финансы"]]},
  contractors: { eyebrow:"ИСПОЛНИТЕЛИ", title:"Подрядчики", desc:"База проверенных специалистов DEPA Строй.", columns:["Исполнитель","Специализация","Телефон","Активные объекты","Статус"], rows:[["Иван Миронов","Электрика","+7 914 770-18-30","2","Проверен"],["Сергей Петров","Сантехника","+7 902 556-14-88","1","Проверен"],["Бригада «Линия»","Малярные работы","+7 924 005-84-12","2","Проверен"],["Студия «Контур»","Потолки","+7 914 681-02-14","0","Резерв"]]},
  docs: { eyebrow:"АРХИВ", title:"Документы", desc:"Договоры, сметы, чеки и отчёты по объектам.", columns:["Документ","Тип","Объект","Изменён","Версия"], rows:[]},
};

function GenericScreen({ section, access }: { section: GenericSection; access: AccessProfile }) {
  const data = genericData[section];
  const createPermission: Partial<Record<GenericSection, ActionPermission>> = { orders: "orders.create", tasks: "tasks.create", contractors: "contractors.create", docs: "documents.upload" };
  const permission = createPermission[section];
  return <section className="screen-section"><div className="screen-intro"><div><span className="eyebrow">{data.eyebrow}</span><h2>{data.title}</h2><p>{data.desc}</p></div>{permission && access.actions[permission] ? <button className="secondary" disabled title="Действие будет подключено в профильном модуле">＋ Добавить</button> : null}</div><div className="panel data-table"><div className="data-row data-head">{data.columns.map(c => <span key={c}>{c}</span>)}</div>{data.rows.map((row,i) => <button className="data-row" key={i}>{row.map((cell,j) => <span key={j} className={j === 0 ? "strong" : ""}>{j === 0 && <i className="row-avatar">{cell.slice(0,2)}</i>}{cell}</span>)}</button>)}</div>{!data.rows.length ? <div className="finance-empty">Реальных записей пока нет.</div> : null}</section>;
}

const scopedModulePresentation: Record<GenericSection | "crm", { endpoint: string; eyebrow: string; title: string; fields: { key: string; label: string }[] }> = {
  crm: { endpoint: "crm", eyebrow: "ПРОДАЖИ", title: "CRM", fields: [{ key: "client_name", label: "Клиент" }, { key: "source", label: "Источник" }, { key: "status", label: "Статус" }, { key: "next_action", label: "Следующее действие" }] },
  orders: { endpoint: "orders", eyebrow: "УСЛУГИ", title: "Заказы", fields: [{ key: "number", label: "Заказ" }, { key: "client_name", label: "Клиент" }, { key: "title", label: "Услуга" }, { key: "status", label: "Статус" }] },
  tasks: { endpoint: "tasks", eyebrow: "КОНТРОЛЬ", title: "Задачи", fields: [{ key: "title", label: "Задача" }, { key: "deadline", label: "Дедлайн" }, { key: "status", label: "Статус" }, { key: "comment", label: "Комментарий" }] },
  team: { endpoint: "team", eyebrow: "КОМАНДА", title: "Сотрудники", fields: [{ key: "full_name", label: "Сотрудник" }, { key: "position", label: "Должность" }, { key: "phone", label: "Телефон" }, { key: "status", label: "Статус" }] },
  contractors: { endpoint: "contractors", eyebrow: "ИСПОЛНИТЕЛИ", title: "Исполнители", fields: [{ key: "name", label: "Исполнитель" }, { key: "specialization", label: "Специализация" }, { key: "phone", label: "Телефон" }, { key: "status", label: "Статус" }] },
  docs: { endpoint: "documents", eyebrow: "АРХИВ", title: "Документы", fields: [{ key: "original_filename", label: "Документ" }, { key: "category", label: "Тип" }, { key: "entity_type", label: "Связь" }, { key: "updated_at", label: "Изменён" }] },
};

function ScopedModuleScreen({ section }: { section: keyof typeof scopedModulePresentation }) {
  const presentation = scopedModulePresentation[section];
  const [items, setItems] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; fetch(`/api/${presentation.endpoint}`, { cache: "no-store" }).then(async (response) => { const result = await response.json() as { items?: Record<string, unknown>[]; error?: string }; if (!response.ok) throw new Error(result.error); if (active) setItems(result.items ?? []); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Не удалось загрузить раздел."); }); return () => { active = false; }; }, [presentation.endpoint]);
  function display(value: unknown) { if (value == null || value === "") return "—"; if (typeof value === "number" && value > 1_000_000_000) return new Date(value * 1000).toLocaleDateString("ru-RU"); return String(value); }
  return <section className="screen-section"><div className="screen-intro"><div><span className="eyebrow">{presentation.eyebrow}</span><h2>{presentation.title}</h2><p>Данные отфильтрованы сервером по индивидуальной области доступа.</p></div></div>{error ? <div className="auth-error"><i>!</i><span>{error}</span></div> : null}{items ? <div className="panel data-table"><div className="data-row data-head">{presentation.fields.map((field) => <span key={field.key}>{field.label}</span>)}</div>{items.map((item, index) => <div className="data-row" key={String(item.id ?? index)}>{presentation.fields.map((field) => <span className={field === presentation.fields[0] ? "strong" : ""} key={field.key}>{display(item[field.key])}</span>)}</div>)}</div> : <div className="panel finance-loading">Загружаем данные…</div>}{items?.length === 0 ? <div className="panel finance-empty">В доступной области записей пока нет.</div> : null}</section>;
}

function ProfileModal({ user, onClose }: { user: AuthUser; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"profile" | "password">("profile");
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setSuccess(""); setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword"), confirmPassword: form.get("confirmPassword") }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) { setError(result.error ?? "Не удалось изменить пароль."); setLoading(false); return; }
      event.currentTarget.reset(); setSuccess("Пароль изменён. Остальные ваши сессии завершены."); setLoading(false);
    } catch { setError("Нет связи с системой. Повторите попытку."); setLoading(false); }
  }

  async function signOut() {
    setLoading(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally { router.push("/login"); router.refresh(); }
  }

  return <div className="modal-wrap profile-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      <header className="profile-head"><button className="profile-back" onClick={mode === "password" ? () => { setMode("profile"); setError(""); setSuccess(""); } : onClose} aria-label={mode === "password" ? "Вернуться в профиль" : "Закрыть профиль"}>{mode === "password" ? "←" : "×"}</button><div><span className="eyebrow">АККАУНТ</span><h2 id="profile-title">{mode === "profile" ? "Профиль" : "Смена пароля"}</h2></div><span className="profile-protected">Защищён</span></header>
      {mode === "profile" ? <>
        <div className="profile-identity"><span className="avatar profile-avatar">{initials(user.name)}</span><div><h3>{user.name}</h3><p>{user.username}</p></div></div>
        <div className="profile-facts"><div><span>Роль</span><b>{user.role}</b><small>Максимальный доступ</small></div><div><span>Статус</span><b className="success-text">Активен</b><small>Защищённый владелец</small></div></div>
        <div className="owner-notice"><i>i</i><p><b>Равноправный Owner</b><span>Роль и основные права владельца нельзя изменить из профиля.</span></p></div>
        <div className="profile-actions"><button onClick={() => setMode("password")}><span><b>Сменить пароль</b><small>Только для текущего аккаунта</small></span><em>→</em></button><button className="logout-action" onClick={signOut} disabled={loading}><span><b>Выйти из DEPA OS</b><small>Завершить текущую сессию</small></span><em>→</em></button></div>
      </> : <form className="password-form" onSubmit={changePassword}>
        <p>После смены пароля все другие активные сессии этого аккаунта будут завершены.</p>
        {[{name:"currentPassword",label:"Текущий пароль",key:"current" as const,auto:"current-password"},{name:"newPassword",label:"Новый пароль",key:"next" as const,auto:"new-password"},{name:"confirmPassword",label:"Повторите новый пароль",key:"confirm" as const,auto:"new-password"}].map((field) => <label key={field.name}><span>{field.label}</span><div className="password-control"><input name={field.name} type={visible[field.key] ? "text" : "password"} autoComplete={field.auto} required minLength={field.key === "current" ? undefined : 8} /><button type="button" onClick={() => setVisible((state) => ({ ...state, [field.key]: !state[field.key] }))}>{visible[field.key] ? "Скрыть" : "Показать"}</button></div>{field.key === "next" && <small>Минимум 8 символов</small>}</label>)}
        {error && <div className="auth-error" role="alert"><i>!</i><span>{error}</span></div>}{success && <div className="auth-success" role="status"><i>✓</i><span>{success}</span></div>}
        <button className="primary password-submit" type="submit" disabled={loading}>{loading ? "Изменяем…" : "Изменить пароль"}</button>
      </form>}
    </section>
  </div>;
}

function SearchModal({ access, onClose, onClient, onProject, onLead, onOrder, onComplex,onEstimate,onContract }: { access: AccessProfile; onClose: () => void; onClient: (id: string) => void; onProject: (id: string) => void; onLead:(id:string)=>void; onOrder:(id:string)=>void; onComplex:(id:string)=>void;onEstimate:(id:string)=>void;onContract?:(id:string)=>void }) {
  const router = useRouter();
  onContract ??= (id: string) => router.push(`/dashboard?section=orders&contractId=${encodeURIComponent(id)}`);
  const [q, setQ] = useState("");
  const [clients, setClients] = useState<{ id: string; fullName: string; phone: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; displayName: string; address: string; apartment: string; residentialComplex: string | null; clientName: string }[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [complexes, setComplexes] = useState<{ id: string; name: string; city: string; address: string }[]>([]);
  const [estimates,setEstimates]=useState<{id:string;clientName:string;currentVersion:number;currentStatus:string;address:string;residentialComplex:string|null}[]>([]);
  const [contracts,setContracts]=useState<{id:string;contractNumber:string;clientName:string;status:string;orderNumber:string}[]>([]);
  const [additionalWorks,setAdditionalWorks]=useState<{id:string;number:string;title:string;status:string;project_id:string;client_name:string;project_name:string;amount_kopecks:number}[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (!q.trim()) { setClients([]); setProjects([]); setLeads([]); setOrders([]); setComplexes([]);setEstimates([]);setContracts([]);setAdditionalWorks([]); return; }
      const clientRequest = access.modules.clients && access.actions["clients.view"] ? fetch(`/api/clients?${new URLSearchParams({ search: q, status: "ALL", limit: "5" })}`, { cache: "no-store", signal: controller.signal }).then((response) => response.ok ? response.json() as Promise<{ items?: typeof clients }> : Promise.reject()) : Promise.resolve({ items: [] });
      const projectRequest = access.modules.projects && access.actions["projects.view"] ? fetch(`/api/projects?${new URLSearchParams({ search: q, status: "ALL", limit: "5" })}`, { cache: "no-store", signal: controller.signal }).then((response) => response.ok ? response.json() as Promise<{ items?: typeof projects }> : Promise.reject()) : Promise.resolve({ items: [] });
      const leadRequest = access.modules.crm && access.actions["crm.view"] ? fetch(`/api/crm?${new URLSearchParams({ search: q, status: "ALL", view:"list", limit: "5" })}`, { cache: "no-store", signal: controller.signal }).then((response) => response.ok ? response.json() as Promise<{ items?: typeof leads }> : Promise.reject()) : Promise.resolve({ items: [] });
      const orderRequest = access.modules.orders && access.actions["orders.view"] ? fetch(`/api/orders?${new URLSearchParams({ search: q, limit: "5" })}`, { cache: "no-store", signal: controller.signal }).then((response) => response.ok ? response.json() as Promise<{ items?: Order[] }> : Promise.reject()) : Promise.resolve({ items: [] as Order[] });
      const complexRequest = access.actions["residentialComplexes.view"] ? fetch(`/api/residential-complexes?${new URLSearchParams({ search: q, status: "ALL", limit: "5" })}`, { cache: "no-store", signal: controller.signal }).then((response) => response.ok ? response.json() as Promise<{ items?: Array<{ id: string; name: string; city: string; primaryAddress: string | null }> }> : Promise.reject()) : Promise.resolve({ items: [] });
      const estimateRequest = access.actions["estimates.view"] ? fetch(`/api/estimates?${new URLSearchParams({search:q,limit:"5"})}`,{cache:"no-store",signal:controller.signal}).then(response=>response.ok?response.json() as Promise<{items?:typeof estimates}>:Promise.reject()):Promise.resolve({items:[]});
      const contractRequest = access.actions["contracts.view"] ? fetch(`/api/contracts?${new URLSearchParams({search:q,limit:"5"})}`,{cache:"no-store",signal:controller.signal}).then(response=>response.ok?response.json() as Promise<{items?:typeof contracts}>:Promise.reject()):Promise.resolve({items:[]});
      const additionalWorkRequest = access.actions["additionalWorks.view"] ? fetch(`/api/additional-works?${new URLSearchParams({search:q,limit:"5"})}`,{cache:"no-store",signal:controller.signal}).then(response=>response.ok?response.json() as Promise<{items?:typeof additionalWorks}>:Promise.reject()):Promise.resolve({items:[]});
      Promise.all([clientRequest, projectRequest,leadRequest,orderRequest,complexRequest,estimateRequest,contractRequest,additionalWorkRequest]).then(([clientData, projectData,leadData,orderData,complexData,estimateData,contractData,additionalWorkData]) => { setClients(clientData.items ?? []); setProjects(projectData.items ?? []);setLeads(leadData.items??[]);setOrders(orderData.items??[]);setComplexes((complexData.items??[]).map((item)=>({...item,address:item.primaryAddress??""})));setEstimates(estimateData.items??[]);setContracts(contractData.items??[]);setAdditionalWorks(additionalWorkData.items??[]); }).catch(() => undefined);
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [q, access]);
  return <div className="modal-wrap search-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="search-modal"><div className="search-input"><span>⌕</span><input autoFocus value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }} placeholder="Клиент, договор, смета, допработа, заказ, ЖК, объект или адрес"/><kbd>ESC</kbd></div><div className="search-results">{access.actions["additionalWorks.view"]?<><small>ДОПОЛНИТЕЛЬНЫЕ РАБОТЫ</small>{additionalWorks.map(item=><button key={item.id} onClick={()=>{onClose();onProject(item.project_id)}}><i>＋</i><span><b>{item.number} · {item.title}</b><small>{item.client_name} · {item.project_name} · {money(Number(item.amount_kopecks))}</small></span><em>↗</em></button>)}</>:null}{access.actions["contracts.view"]?<><small>ДОГОВОРЫ</small>{contracts.map(item=><button key={item.id} onClick={()=>{onClose();onContract(item.id)}}><i>▱</i><span><b>{item.contractNumber} · {item.clientName}</b><small>{item.orderNumber} · {item.status}</small></span><em>↗</em></button>)}</>:null}{access.actions["estimates.view"]?<><small>СМЕТЫ</small>{estimates.map(item=><button key={item.id} onClick={()=>{onClose();onEstimate(item.id)}}><i>▤</i><span><b>Смета v{item.currentVersion} · {item.clientName}</b><small>{item.residentialComplex||item.address} · {item.currentStatus}</small></span><em>↗</em></button>)}</>:null}{access.actions["residentialComplexes.view"]?<><small>ЖИЛЫЕ КОМПЛЕКСЫ</small>{complexes.map(item=><button key={item.id} onClick={()=>{onClose();onComplex(item.id)}}><i>⌂</i><span><b>{item.name}</b><small>{item.city} · {item.address}</small></span><em>↗</em></button>)}</>:null}{access.modules.crm&&access.actions["crm.view"]?<><small>ЗАЯВКИ</small>{leads.map(lead=><button key={lead.id} onClick={()=>{onClose();onLead(lead.id)}}><i>↗</i><span><b>{lead.name}</b><small>{lead.phone} · {lead.responsibleName}</small></span><em>↗</em></button>)}</>:null}{access.modules.orders&&access.actions["orders.view"]?<><small>ЗАКАЗЫ</small>{orders.map(order=><button key={order.id} onClick={()=>{onClose();onOrder(order.id)}}><i>▤</i><span><b>{order.orderNumber}</b><small>{order.clientName} · {order.inspection?.address||order.title}</small></span><em>↗</em></button>)}</>:null}{access.modules.projects && access.actions["projects.view"] ? <><small>ОБЪЕКТЫ</small>{projects.map((project) => <button key={project.id} onClick={() => { onClose(); onProject(project.id); }}><i>◇</i><span><b>{project.displayName}</b><small>{project.clientName} · {project.address}</small></span><em>↗</em></button>)}</> : null}{access.modules.clients && access.actions["clients.view"] ? <><small>КЛИЕНТЫ</small>{clients.map((client) => <button key={client.id} onClick={() => { onClose(); onClient(client.id); }}><i>◎</i><span><b>{client.fullName}</b><small>{client.phone}</small></span><em>↗</em></button>)}</> : null}{q.trim() && !clients.length && !projects.length&&!leads.length&&!orders.length&&!complexes.length&&!estimates.length&&!contracts.length&&!additionalWorks.length ? <div className="finance-empty">Ничего не найдено.</div> : null}</div></div></div>;
}

function AccessDenied({ onNavigate }: { onNavigate: () => void }) {
  return <section className="panel access-denied"><span>403</span><h2>Доступ к разделу закрыт</h2><p>Раздел не входит в индивидуальные права этого аккаунта. Пункты меню и API используют ту же серверную проверку.</p><button className="primary" onClick={onNavigate}>Открыть доступный раздел</button></section>;
}

export function DepaOS({ currentUser, access, initialSection, accessDenied }: { currentUser: AuthUser; access: AccessProfile; initialSection: string; accessDenied?: ModuleKey }) {
  const safeInitial = Object.hasOwn(moduleBySection, initialSection) ? initialSection as Section : "dashboard";
  const [section, setSection] = useState<Section>(safeInitial);
  const [denied, setDenied] = useState(Boolean(accessDenied));
  const [modal, setModal] = useState<"picker"|"finance"|"search"|"profile"|null>(null);
  const [financeMode, setFinanceMode] = useState<FinanceMode>("EXPENSE");
  const [financeRevision, setFinanceRevision] = useState(0);
  const [targetClientId, setTargetClientId] = useState<string | null>(null);
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null);
  const [targetComplexId, setTargetComplexId] = useState<string | null>(null);
  const [targetLeadId,setTargetLeadId]=useState<string|null>(null);
  const [targetOrderId,setTargetOrderId]=useState<string|null>(null);
  const [targetOrderClientId,setTargetOrderClientId]=useState<string|null>(null);
  const [targetOrderSourceLeadId,setTargetOrderSourceLeadId]=useState<string|null>(null);
  const [targetEstimateId,setTargetEstimateId]=useState<string|null>(null);
  const [estimateCreateContext,setEstimateCreateContext]=useState<{clientId:string;sourceLeadId?:string|null;sourceOrderId?:string|null;projectId?:string|null;responsibleUserId:string;residentialComplexId?:string|null;residentialComplexAddressId?:string|null;residentialComplex?:string|null;address?:string|null;apartmentNumber?:string|null;areaSqm?:number|null}|null>(null);
  const [crmCount,setCrmCount]=useState(0);
  const [financeContext, setFinanceContext] = useState<{ projectId?: string; clientId: string; orderId?: string; orderNumber?: string; amount?: string; title?: string } | null>(null);
  const [menuOpen,setMenuOpen]=useState(false);
  const title = nav.flatMap(g=>g.items).find(i=>i.id===section)?.label || "Обзор";
  useEffect(()=>{if(!access.modules.crm||!access.actions["crm.view"])return;let active=true;fetch("/api/crm?view=list&status=ACTIVE&limit=1",{cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject()).then(d=>{if(active)setCrmCount(d.total??0)}).catch(()=>undefined);return()=>{active=false};},[access,section]);
  function select(s:Section){if (!canOpenSection(access,s)) { setDenied(true); return; } setTargetClientId(null);setTargetProjectId(null);setTargetComplexId(null);setTargetLeadId(null);setTargetOrderId(null);setTargetOrderClientId(null);setTargetOrderSourceLeadId(null);setTargetEstimateId(null);setEstimateCreateContext(null);setSection(s);setDenied(false)}
  function openClient(id:string){setTargetProjectId(null);setTargetLeadId(null);setTargetOrderId(null);setTargetOrderClientId(null);setTargetClientId(id);setSection("clients");setDenied(false)}
  function openProject(id:string){setTargetClientId(null);setTargetLeadId(null);setTargetOrderId(null);setTargetOrderClientId(null);setTargetProjectId(id);setSection("objects");setDenied(false)}
  function openComplex(id:string){setTargetClientId(null);setTargetProjectId(null);setTargetLeadId(null);setTargetOrderId(null);setTargetOrderClientId(null);setTargetComplexId(id);setSection("complexes");setDenied(false)}
  function openLead(id:string){setTargetClientId(null);setTargetProjectId(null);setTargetOrderId(null);setTargetOrderClientId(null);setTargetLeadId(id);setSection("crm");setDenied(false)}
  function openOrder(id:string){setTargetClientId(null);setTargetProjectId(null);setTargetLeadId(null);setTargetOrderClientId(null);setTargetOrderId(id);setSection("orders");setDenied(false)}
  function openEstimate(id:string){setTargetClientId(null);setTargetProjectId(null);setTargetLeadId(null);setTargetOrderId(null);setTargetOrderClientId(null);setTargetEstimateId(id);setEstimateCreateContext(null);setSection("orders");setDenied(false)}
  function createEstimate(context:{clientId:string;sourceLeadId?:string|null;sourceOrderId?:string|null;projectId?:string|null;responsibleUserId:string;residentialComplexId?:string|null;residentialComplexAddressId?:string|null;residentialComplex?:string|null;address?:string|null;apartmentNumber?:string|null;areaSqm?:number|null}){setTargetClientId(null);setTargetProjectId(null);setTargetLeadId(null);setTargetOrderId(null);setTargetOrderClientId(null);setTargetEstimateId(null);setEstimateCreateContext(context);setSection("orders");setDenied(false)}
  function createOrderForClient(clientId:string){setTargetClientId(null);setTargetProjectId(null);setTargetLeadId(null);setTargetOrderId(null);setTargetOrderClientId(clientId);setTargetOrderSourceLeadId(null);setSection("orders");setDenied(false)}
  function createOrderFromLead(clientId:string,leadId:string){createOrderForClient(clientId);setTargetOrderSourceLeadId(leadId)}
  function openFinance(mode: FinanceMode) { setFinanceContext(null); setFinanceMode(mode); setModal("finance"); }
  function openProjectFinance(mode: FinanceMode, project: { id: string; clientId: string }) { setFinanceContext({ projectId: project.id, clientId: project.clientId }); setFinanceMode(mode); setModal("finance"); }
  function openOrderPayment(order:Order){setFinanceContext({clientId:order.clientId,orderId:order.id,orderNumber:order.orderNumber,amount:String((order.remainingKopecks??0)/100),title:`Оплата по заказу ${order.orderNumber}`});setFinanceMode("INCOME");setModal("finance")}
  const firstAllowed = nav.flatMap((group) => group.items).find((item) => canOpenSection(access,item.id))?.id ?? "dashboard";
  const financeReadable = access.modules.finance && access.actions["finance.view"];
  const allowedFinanceModes = { EXPENSE: financeReadable && access.actions["finance.createExpense"] && (access.ownCashbox || access.actions["finance.createInvestmentExpense"]), INCOME: financeReadable && access.ownCashbox && access.actions["finance.createIncome"], TRANSFER: financeReadable && access.ownCashbox && access.actions["finance.createTransfer"] };
  const canAddFinance = section === "finance" && Object.values(allowedFinanceModes).some(Boolean);
  return <div className="app-shell">
    <Sidebar section={section} onChange={select} open={menuOpen} onClose={()=>setMenuOpen(false)} user={currentUser} access={access} onProfile={()=>setModal("profile")} crmCount={crmCount}/>
    {menuOpen&&<button className="scrim" onClick={()=>setMenuOpen(false)} aria-label="Закрыть меню"/>}
    <main className="main"><Topbar title={title} onMenu={()=>setMenuOpen(true)} onAdd={canAddFinance ? ()=>setModal("picker") : undefined} onSearch={access.modules.clients || access.modules.projects || access.modules.crm || access.modules.orders || access.actions["residentialComplexes.view"] ? ()=>setModal("search") : undefined}/><div className="content">
      {denied ? <AccessDenied onNavigate={() => select(firstAllowed)} /> : section === "dashboard" ? (currentUser.role === "OWNER" ? <Dashboard onObject={()=>select("objects")} onSection={select} onLead={openLead} onOrder={openOrder} user={currentUser}/> : <EmployeeDashboard user={currentUser} access={access} onSection={select}/>) : section === "clients" ? <ClientsScreen key={targetClientId ?? "clients"} currentUser={currentUser} access={access} initialClientId={targetClientId} onClientClosed={()=>setTargetClientId(null)} onOpenProject={openProject} onOpenLead={openLead} onOpenOrder={openOrder} onCreateOrder={createOrderForClient} onOpenEstimate={openEstimate} onCreateEstimate={createEstimate}/> : section === "orders" ? <OrdersScreen key={`${targetOrderId??"orders"}-${targetOrderClientId??"all"}-${targetOrderSourceLeadId??"direct"}-${targetEstimateId??"estimate-list"}-${estimateCreateContext?.clientId??"no-create"}`} currentUser={currentUser} access={access} initialOrderId={targetOrderId} initialClientId={targetOrderClientId} initialSourceLeadId={targetOrderSourceLeadId} initialEstimateId={targetEstimateId} initialEstimateContext={estimateCreateContext} onOrderClosed={()=>setTargetOrderId(null)} onPayment={openOrderPayment} onOpenProject={openProject}/> : section === "complexes" ? <ResidentialComplexesScreen key={targetComplexId ?? "complexes"} currentUser={currentUser} access={access} initialId={targetComplexId} onClosed={()=>setTargetComplexId(null)}/> : section === "objects" ? <ProjectsScreen key={targetProjectId ?? "projects"} currentUser={currentUser} access={access} initialProjectId={targetProjectId} onProjectClosed={()=>setTargetProjectId(null)} onClients={()=>select("clients")} onOpenClient={openClient} onFinance={openProjectFinance} onOpenEstimate={openEstimate} onCreateEstimate={createEstimate}/> : section === "crm" ? <CrmScreen key={targetLeadId??"crm"} currentUser={currentUser} access={access} initialLeadId={targetLeadId} onLeadClosed={()=>setTargetLeadId(null)} onOpenClient={openClient} onCreateOrder={createOrderFromLead} onOpenEstimate={openEstimate} onCreateEstimate={createEstimate}/> : section === "finance" ? <FinanceScreen key={financeRevision} onNew={openFinance}/> : section === "team" && currentUser.role === "OWNER" ? <TeamAccessScreen/> : currentUser.role === "EMPLOYEE" ? <ScopedModuleScreen section={section as GenericSection|"crm"}/> : <GenericScreen section={section as GenericSection} access={access}/>}{" "}
    </div></main>
    {modal==="picker"&&<OperationPickerModal allowed={allowedFinanceModes} onClose={()=>setModal(null)} onSelect={openFinance}/>} {modal==="finance"&&<FinanceOperationModal key={`${financeMode}-${financeContext?.projectId ?? financeContext?.orderId ?? "global"}`} mode={financeMode} initialProjectId={financeContext?.projectId} initialClientId={financeContext?.clientId} initialOrderId={financeContext?.orderId} initialOrderNumber={financeContext?.orderNumber} initialAmount={financeContext?.amount} initialTitle={financeContext?.title} onClose={()=>{setModal(null);setFinanceContext(null)}} onSaved={()=>setFinanceRevision((value)=>value+1)}/>} {modal==="search"&&<SearchModal access={access} onClose={()=>setModal(null)} onClient={openClient} onProject={openProject} onLead={openLead} onOrder={openOrder} onComplex={openComplex} onEstimate={openEstimate}/>} {modal==="profile"&&<ProfileModal user={currentUser} onClose={()=>setModal(null)}/>}{" "}
  </div>;
}
