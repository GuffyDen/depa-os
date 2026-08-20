"use client";

import { FormEvent, useEffect, useState } from "react";
import type { AuthUser } from "../lib/auth";
import type { AccessProfile, ActionPermission, ModuleKey } from "../lib/permission-definitions";
import { FinanceOperationModal, FinanceScreen, OperationPickerModal, money, readFinance, type FinanceData, type FinanceMode } from "./finance-ui";
import { TeamAccessScreen } from "./team-access-ui";
import { ClientsScreen } from "./clients-ui";
import { ProjectsScreen } from "./projects-ui";

type Section = "dashboard" | "crm" | "clients" | "orders" | "objects" | "finance" | "tasks" | "team" | "contractors" | "docs";

const nav: { group: string; items: { id: Section; label: string; icon: string; count?: number }[] }[] = [
  { group: "Компания", items: [
    { id: "dashboard", label: "Обзор", icon: "◫" },
    { id: "crm", label: "CRM", icon: "↗", count: 12 },
    { id: "clients", label: "Клиенты", icon: "◎" },
    { id: "orders", label: "Заказы", icon: "▤" },
  ]},
  { group: "Производство", items: [
    { id: "objects", label: "Объекты", icon: "◇" },
    { id: "tasks", label: "Задачи", icon: "✓", count: 9 },
  ]},
  { group: "Учёт", items: [
    { id: "finance", label: "Финансы", icon: "₽" },
    { id: "team", label: "Команда", icon: "⊙" },
    { id: "contractors", label: "Исполнители", icon: "⌁" },
    { id: "docs", label: "Документы", icon: "▱" },
  ]},
];

const moduleBySection: Record<Section, ModuleKey> = { dashboard: "dashboard", crm: "crm", clients: "clients", orders: "orders", objects: "projects", tasks: "tasks", finance: "finance", team: "team", contractors: "contractors", docs: "documents" };
const crmColumns = [
  { title: "Новая заявка", count: 4, cards: ["Анна Романова", "Максим Титов"] },
  { title: "Связались", count: 3, cards: ["Олег Фомин", "Елена Белова"] },
  { title: "Расчёт ремонта", count: 2, cards: ["Дарья Ким", "Виктор Орлов"] },
  { title: "КП / смета", count: 2, cards: ["Роман Савин", "Ирина Шестова"] },
  { title: "Договор", count: 1, cards: ["Алексей Власов"] },
];

function Brand() {
  return <div className="brand" aria-label="ДЕПА СТРОЙ"><span>ДЕПА</span><b>СТРОЙ</b><i>OS</i></div>;
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toLocaleUpperCase("ru-RU");
}

function Sidebar({ section, onChange, open, onClose, user, access, onProfile }: { section: Section; onChange: (s: Section) => void; open: boolean; onClose: () => void; user: AuthUser; access: AccessProfile; onProfile: () => void }) {
  const visibleNav = nav.map((group) => ({ ...group, items: group.items.filter((item) => access.modules[moduleBySection[item.id]]) })).filter((group) => group.items.length > 0);
  return <aside className={`sidebar ${open ? "open" : ""}`}>
    <div className="side-head"><Brand /><button className="icon-btn mobile-only" onClick={onClose} aria-label="Закрыть меню">×</button></div>
    <nav>
      {visibleNav.map(group => <div className="nav-group" key={group.group}>
        <small>{group.group}</small>
        {group.items.map(item => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => { onChange(item.id); onClose(); }}>
          <span className="nav-icon">{item.icon}</span><span>{item.label}</span>{item.count ? <em>{item.count}</em> : null}
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
    <button className="icon-btn mobile-only" onClick={onMenu} aria-label="Открыть меню">☰</button>
    <div><small>DEPA STROY · ВЛАДИВОСТОК</small><h1>{title}</h1></div>
    <div className="top-actions">
      {onSearch ? <button className="search" onClick={onSearch}><span>⌕</span><span className="search-label">Найти клиента, объект, операцию</span><kbd>⌘ K</kbd></button> : null}
      <button className="round" aria-label="Уведомления">●<i>3</i></button>
      {onAdd ? <button className="primary" onClick={onAdd}>＋ <span>Добавить</span></button> : null}
    </div>
  </header>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return <div className="metric"><div className="metric-top"><span>{label}</span><i className={tone || ""}>↗</i></div><strong>{value}</strong><small>{detail}</small></div>;
}

function Dashboard({ onObject, onSection, user }: { onObject: () => void; onSection: (s: Section) => void; user: AuthUser }) {
  const [finance, setFinance] = useState<FinanceData | null>(null);
  const [projectSummary, setProjectSummary] = useState<{ total: number; items: { id: string; displayName: string; clientName: string; status: string; responsibleName: string; plannedEndDate: number | null }[] }>({ total: 0, items: [] });
  useEffect(() => { let cancelled = false; readFinance().then((result) => { if (!cancelled) setFinance(result); }).catch(() => undefined); return () => { cancelled = true; }; }, []);
  useEffect(() => { let cancelled = false; fetch("/api/projects?status=WORKING&limit=4", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject()).then((result: typeof projectSummary) => { if (!cancelled) setProjectSummary(result); }).catch(() => undefined); return () => { cancelled = true; }; }, []);
  const financeAttention = finance?.attentionItems.slice(0, 3) ?? [];
  return <>
    <section className="welcome"><div><span className="eyebrow">ВОСКРЕСЕНЬЕ, 16 АВГУСТА</span><h2>{user.name.split(" ")[0]}, текущая ситуация</h2><p>В фокусе 4 вопроса. Один из них влияет на срок сдачи.</p></div><div className="weather"><span>Владивосток</span><b>+23°</b><small>ясно · рабочий день</small></div></section>
    <section className="metrics-grid">
      <Metric label="ОБЪЕКТЫ В РАБОТЕ" value={String(projectSummary.total)} detail="Реальные объекты в рабочем контуре" />
      <Metric label="ОБОРОТ · АВГУСТ" value="2,84 млн ₽" detail="+18% к июлю" />
      <Metric label="ДЕНЬГИ В КАССАХ" value={finance ? money(finance.physicalTotalKopecks) : "—"} detail={`${finance?.cashboxes.filter((box) => box.status === "ACTIVE").length ?? 0} активных касс · физический остаток, не прибыль`} />
      <Metric label="ПРОГНОЗ ПРИБЫЛИ" value="684 000 ₽" detail="Маржинальность 22,4%" tone="orange" />
    </section>
    <div className="dashboard-grid">
      <section className="panel attention-panel">
        <div className="panel-head"><div><span className="eyebrow orange">ТРЕБУЕТ ВНИМАНИЯ</span><h3>Не упустить сегодня</h3></div><b className="badge-alert">{financeAttention.length + 2}</b></div>
        <div className="attention-list">
          {financeAttention.map((item, index) => <button key={`${item.type}-${item.transactionId ?? item.projectId ?? item.cashboxId ?? index}`} onClick={() => onSection("finance")}><i>₽</i><div><strong>{item.title}</strong><span>{item.detail}</span></div><em>Финансы</em></button>)}
          <button><i>◷</i><div><strong>Риск сдвига срока на 6 дней</strong><span>ЖК Море · плитка ещё не согласована</span></div><em>Сроки</em></button>
          <button><i>▧</i><div><strong>Нет фотоотчёта за 15 августа</strong><span>ЖК Бринер · ответственный Антон К.</span></div><em>Контроль</em></button>
        </div>
      </section>
      <section className="panel tasks-panel">
        <div className="panel-head"><div><span className="eyebrow">СЕГОДНЯ</span><h3>Задачи</h3></div><button className="link" onClick={() => onSection("tasks")}>Все задачи →</button></div>
        <label className="task"><input type="checkbox" /><span><b>Согласовать плитку с клиентом</b><small>ЖК Море · до 12:00</small></span><em className="avatar mini">ДП</em></label>
        <label className="task"><input type="checkbox" /><span><b>Проверить смету электрика</b><small>ЖК Атмосфера · до 15:00</small></span><em className="avatar mini dark">ПС</em></label>
        <label className="task"><input type="checkbox" defaultChecked /><span><b>Оплатить доставку дверей</b><small>ЖК Бринер · выполнено</small></span><em className="avatar mini">ДП</em></label>
        <button className="add-task">＋ Добавить задачу</button>
      </section>
    </div>
    <section className="panel objects-panel">
      <div className="panel-head"><div><span className="eyebrow">ПРОИЗВОДСТВО</span><h3>Активные объекты</h3></div><button className="link" onClick={() => onSection("objects")}>Все объекты →</button></div>
      <div className="object-list">
        {projectSummary.items.map((project) => <button className="object-row" key={project.id} onClick={onObject}>
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
        <div className="funnel"><div style={{height:"88%"}}><b>4</b><span>Новые</span></div><div style={{height:"72%"}}><b>3</b><span>Связались</span></div><div style={{height:"50%"}}><b>2</b><span>Расчёт</span></div><div style={{height:"50%"}}><b>2</b><span>КП</span></div><div className="accent" style={{height:"28%"}}><b>1</b><span>Договор</span></div></div>
      </section>
      <section className="panel cash-panel">
        <div className="panel-head"><div><span className="eyebrow">КАССЫ</span><h3>Персональные</h3></div><button className="link" onClick={() => onSection("finance")}>Подробнее →</button></div>
        {finance?.cashboxes.filter((box) => box.status === "ACTIVE").map((box, index) => <button className="cash-row" key={box.id} onClick={() => onSection("finance")}><span><i className={`dot ${index ? "gray" : ""}`} />{box.name}</span><b className={box.balanceKopecks < 0 ? "minus" : ""}>{money(box.balanceKopecks)}</b></button>)}
        {!finance?.cashboxes.filter((box) => box.status === "ACTIVE").length && <div className="finance-empty">Активных касс нет.</div>}
        <div className="cash-note"><span>Итого в кассах</span><b>{finance ? money(finance.physicalTotalKopecks) : "—"} · физический остаток</b><span>Клиентские средства</span><b>{finance?.clientFundsKopecks != null ? money(finance.clientFundsKopecks) : "—"} · считаются отдельно</b></div>
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
    {access.actions["finance.viewProfit"] && finance?.depaProfitKopecks !== null ? <Metric label="ПРИБЫЛЬ DEPA" value={finance ? money(finance.depaProfitKopecks ?? 0) : "—"} detail="Разрешено Owner" tone="orange" /> : null}
  </div><div className="panel employee-start"><div><span className="eyebrow">БЫСТРЫЙ ДОСТУП</span><h3>Рабочее пространство</h3><p>Прямые переходы и API также проверяют эти права.</p></div>{quickSections.map((section) => <button className={section === "finance" ? "primary" : "secondary"} key={section} onClick={() => onSection(section)}>{nav.flatMap((group) => group.items).find((item) => item.id === section)?.label}</button>)}</div></>;
}

function CrmScreen({ canCreate }: { canCreate: boolean }) {
  return <section className="screen-section"><div className="screen-intro"><div><span className="eyebrow">ПРОДАЖИ</span><h2>CRM</h2><p>12 активных обращений · потенциал 18,4 млн ₽</p></div><div className="segmented"><button className="active">Воронка</button><button>Список</button></div></div>
    <div className="kanban">{crmColumns.map((col, i) => <div className="kanban-col" key={col.title}><div className="kanban-head"><span><i className={i === 4 ? "orange-bg" : ""} />{col.title}</span><b>{col.count}</b></div>{col.cards.map((name,j) => <article key={name}><span className="source">{j % 2 ? "AVITO" : "САЙТ"}</span><h4>{name}</h4><p>Ремонт · 62 м²</p><div><small>{i < 2 ? "Связаться сегодня" : "Следующее действие 18 авг"}</small><span className="avatar mini">{j%2 ? "ПС" : "ДП"}</span></div></article>)}{canCreate ? <button className="kanban-add">＋ Добавить</button> : null}</div>)}</div>
  </section>;
}

type GenericSection = Exclude<Section, "dashboard"|"crm"|"clients"|"objects"|"finance">;
const genericData: Record<GenericSection, { eyebrow: string; title: string; desc: string; columns: string[]; rows: string[][] }> = {
  orders: { eyebrow:"УСЛУГИ", title:"Заказы", desc:"Приёмка и ремонт учитываются как отдельные заказы.", columns:["Заказ","Клиент","Услуга","Стоимость","Статус"], rows:[["DEP-0268","Александр Иванов","Ремонт под ключ","2 640 000 ₽","В работе"],["DEP-0267","Мария Волкова","Ремонт под ключ","3 180 000 ₽","В работе"],["DEP-0266","Игорь Лебедев","Приёмка квартиры","8 500 ₽","Выполнен"],["DEP-0265","Софья Ларина","Ремонт под ключ","4 120 000 ₽","В работе"]]},
  tasks: { eyebrow:"КОНТРОЛЬ", title:"Задачи", desc:"Общие, CRM-задачи и задачи по объектам в одном месте.", columns:["Задача","Связь","Дедлайн","Ответственный","Статус"], rows:[["Согласовать плитку","ЖК Море · 128","Сегодня, 12:00","Денис","В работе"],["Проверить смету электрика","ЖК Атмосфера · 42","Сегодня, 15:00","Павел","Новая"],["Заказать двери","ЖК Бринер · 77","20 августа","Денис","Новая"],["Позвонить Иванову","CRM · Александр Иванов","18 августа","Павел","Запланирована"]]},
  team: { eyebrow:"КОМАНДА", title:"Сотрудники", desc:"Сотрудник может работать в DEPA без аккаунта в системе.", columns:["Сотрудник","Должность","Телефон","Объекты","Доступ"], rows:[["Денис Учайкин","Владелец","+7 914 693-90-45","Все","Owner"],["Павел Костенко","Владелец","+7 984 191-19-91","Все","Owner"],["Антон Ковалёв","Прораб","+7 924 102-18-44","3 объекта","Ограниченный"],["Илья Семёнов","Снабженец","+7 914 731-24-02","2 объекта","Финансы"]]},
  contractors: { eyebrow:"ИСПОЛНИТЕЛИ", title:"Подрядчики", desc:"База проверенных специалистов DEPA Строй.", columns:["Исполнитель","Специализация","Телефон","Активные объекты","Статус"], rows:[["Иван Миронов","Электрика","+7 914 770-18-30","2","Проверен"],["Сергей Петров","Сантехника","+7 902 556-14-88","1","Проверен"],["Бригада «Линия»","Малярные работы","+7 924 005-84-12","2","Проверен"],["Студия «Контур»","Потолки","+7 914 681-02-14","0","Резерв"]]},
  docs: { eyebrow:"АРХИВ", title:"Документы", desc:"Договоры, сметы, чеки и отчёты по объектам.", columns:["Документ","Тип","Объект","Изменён","Версия"], rows:[["Договор DEP-0268","Договор","ЖК Море · 128","14 августа","v1"],["Смета · актуальная","Смета","ЖК Море · 128","12 августа","v4"],["Акт скрытых работ","Акт","ЖК Атмосфера · 42","10 августа","v1"],["Отчёт о приёмке","PDF-отчёт","ЖК Бринер · 77","02 августа","v2"]]},
};

function GenericScreen({ section, access }: { section: GenericSection; access: AccessProfile }) {
  const data = genericData[section];
  const createPermission: Partial<Record<GenericSection, ActionPermission>> = { orders: "orders.create", tasks: "tasks.create", contractors: "contractors.create", docs: "documents.upload" };
  const permission = createPermission[section];
  return <section className="screen-section"><div className="screen-intro"><div><span className="eyebrow">{data.eyebrow}</span><h2>{data.title}</h2><p>{data.desc}</p></div>{permission && access.actions[permission] ? <button className="secondary">＋ Добавить</button> : null}</div><div className="panel data-table"><div className="data-row data-head">{data.columns.map(c => <span key={c}>{c}</span>)}</div>{data.rows.map((row,i) => <button className="data-row" key={i}>{row.map((cell,j) => <span key={j} className={j === 0 ? "strong" : ""}>{j === 0 && <i className="row-avatar">{cell.slice(0,2)}</i>}{cell}</span>)}</button>)}</div></section>;
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
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally { window.location.assign("/login"); }
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

function SearchModal({ onClose, onClient }: { onClose: () => void; onClient: (id: string) => void }) {
  const [q,setQ]=useState("");
  const [results,setResults]=useState<{id:string;fullName:string;phone:string}[]>([]);
  useEffect(()=>{const controller=new AbortController();const timer=window.setTimeout(()=>{if(!q.trim()){setResults([]);return}const params=new URLSearchParams({search:q,status:"ALL",limit:"5"});fetch(`/api/clients?${params}`,{cache:"no-store",signal:controller.signal}).then(response=>response.ok?response.json():Promise.reject()).then((data:{items?:{id:string;fullName:string;phone:string}[]})=>setResults(data.items??[])).catch(()=>undefined)},250);return()=>{window.clearTimeout(timer);controller.abort()}},[q]);
  return <div className="modal-wrap search-wrap" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="search-modal"><div className="search-input"><span>⌕</span><input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Поиск клиентов по ФИО или телефону"/><kbd>ESC</kbd></div><div className="search-results"><small>КЛИЕНТЫ</small>{results.map((client)=><button key={client.id} onClick={()=>{onClose();onClient(client.id)}}><i>◎</i><span><b>{client.fullName}</b><small>{client.phone}</small></span><em>↗</em></button>)}{q.trim()&&!results.length?<div className="finance-empty">Клиенты не найдены.</div>:null}</div></div></div>;
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
  const [financeContext, setFinanceContext] = useState<{ projectId: string; clientId: string } | null>(null);
  const [menuOpen,setMenuOpen]=useState(false);
  const title = nav.flatMap(g=>g.items).find(i=>i.id===section)?.label || "Обзор";
  function select(s:Section){if (!access.modules[moduleBySection[s]]) { setDenied(true); return; } setSection(s);setDenied(false)}
  function openFinance(mode: FinanceMode) { setFinanceContext(null); setFinanceMode(mode); setModal("finance"); }
  function openProjectFinance(mode: FinanceMode, project: { id: string; clientId: string }) { setFinanceContext({ projectId: project.id, clientId: project.clientId }); setFinanceMode(mode); setModal("finance"); }
  const firstAllowed = nav.flatMap((group) => group.items).find((item) => access.modules[moduleBySection[item.id]])?.id ?? "dashboard";
  const financeAllowed = access.modules.finance && access.actions["finance.view"] && access.ownCashbox;
  const allowedFinanceModes = { EXPENSE: financeAllowed && access.actions["finance.createExpense"], INCOME: financeAllowed && access.actions["finance.createIncome"], TRANSFER: financeAllowed && access.actions["finance.createTransfer"] };
  const canAddFinance = section === "finance" && Object.values(allowedFinanceModes).some(Boolean);
  return <div className="app-shell">
    <Sidebar section={section} onChange={select} open={menuOpen} onClose={()=>setMenuOpen(false)} user={currentUser} access={access} onProfile={()=>setModal("profile")}/>
    {menuOpen&&<button className="scrim" onClick={()=>setMenuOpen(false)} aria-label="Закрыть меню"/>}
    <main className="main"><Topbar title={title} onMenu={()=>setMenuOpen(true)} onAdd={canAddFinance ? ()=>setModal("picker") : undefined} onSearch={currentUser.role === "OWNER" ? ()=>setModal("search") : undefined}/><div className="content">
      {denied ? <AccessDenied onNavigate={() => select(firstAllowed)} /> : section === "dashboard" ? (currentUser.role === "OWNER" ? <Dashboard onObject={()=>select("objects")} onSection={select} user={currentUser}/> : <EmployeeDashboard user={currentUser} access={access} onSection={select}/>) : section === "clients" ? <ClientsScreen key={targetClientId ?? "clients"} currentUser={currentUser} access={access} initialClientId={targetClientId} onClientClosed={()=>setTargetClientId(null)}/> : section === "objects" ? <ProjectsScreen currentUser={currentUser} access={access} onClients={()=>select("clients")} onOpenClient={(id)=>{setTargetClientId(id);select("clients")}} onFinance={openProjectFinance}/> : section === "crm" ? (currentUser.role === "OWNER" ? <CrmScreen canCreate={access.actions["crm.create"]}/> : <ScopedModuleScreen section="crm"/>) : section === "finance" ? <FinanceScreen key={financeRevision} onNew={openFinance}/> : section === "team" && currentUser.role === "OWNER" ? <TeamAccessScreen/> : currentUser.role === "EMPLOYEE" ? <ScopedModuleScreen section={section as GenericSection|"crm"}/> : <GenericScreen section={section as GenericSection} access={access}/>}{" "}
    </div></main>
    {modal==="picker"&&<OperationPickerModal allowed={allowedFinanceModes} onClose={()=>setModal(null)} onSelect={openFinance}/>} {modal==="finance"&&<FinanceOperationModal key={`${financeMode}-${financeContext?.projectId ?? "global"}`} mode={financeMode} initialProjectId={financeContext?.projectId} initialClientId={financeContext?.clientId} onClose={()=>{setModal(null);setFinanceContext(null)}} onSaved={()=>setFinanceRevision((value)=>value+1)}/>} {modal==="search"&&<SearchModal onClose={()=>setModal(null)} onClient={(id)=>{setTargetClientId(id);select("clients")}}/>} {modal==="profile"&&<ProfileModal user={currentUser} onClose={()=>setModal(null)}/>}{" "}
  </div>;
}
