"use client";

import { FormEvent, useEffect, useState } from "react";
import type { AuthUser } from "../lib/auth";
import type { AccessProfile, ActionPermission, ModuleKey } from "../lib/permission-definitions";
import { EmployeeObjectsScreen, FinanceOperationModal, FinanceScreen, OperationPickerModal, money, readFinance, type FinanceData, type FinanceMode } from "./finance-ui";
import { TeamAccessScreen } from "./team-access-ui";
import { ClientsScreen } from "./clients-ui";

type Section = "dashboard" | "crm" | "clients" | "orders" | "objects" | "finance" | "tasks" | "team" | "contractors" | "docs";
type ObjectTab = "overview" | "estimate" | "finance" | "stages" | "photos" | "docs";

const nav: { group: string; items: { id: Section; label: string; icon: string; count?: number }[] }[] = [
  { group: "Компания", items: [
    { id: "dashboard", label: "Обзор", icon: "◫" },
    { id: "crm", label: "CRM", icon: "↗", count: 12 },
    { id: "clients", label: "Клиенты", icon: "◎" },
    { id: "orders", label: "Заказы", icon: "▤" },
  ]},
  { group: "Производство", items: [
    { id: "objects", label: "Объекты", icon: "◇", count: 7 },
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

const objects = [
  { id: 1, name: "ЖК Море · 128", client: "Александр Иванов", status: "В работе", stage: "Малярные работы", progress: 68, date: "12 сен", budget: "2 640 000 ₽", balance: "+148 000 ₽", lead: "ДП", alert: false },
  { id: 2, name: "ЖК Атмосфера · 42", client: "Мария Волкова", status: "В работе", stage: "Электрика", progress: 41, date: "28 окт", budget: "3 180 000 ₽", balance: "−52 000 ₽", lead: "ПС", alert: true },
  { id: 3, name: "ЖК Бринер · 77", client: "Игорь Лебедев", status: "Подготовка", stage: "Демонтаж", progress: 12, date: "15 дек", budget: "1 980 000 ₽", balance: "+420 000 ₽", lead: "ДП", alert: false },
];

const stages = [
  { name: "Демонтаж", status: "done", date: "03–08 июн", owner: "Антон К." },
  { name: "Перегородки", status: "done", date: "10–17 июн", owner: "Антон К." },
  { name: "Электрика", status: "done", date: "18–30 июн", owner: "Иван М." },
  { name: "Сантехника", status: "done", date: "01–08 июл", owner: "Сергей П." },
  { name: "Малярные работы", status: "active", date: "22 июл–19 авг", owner: "Антон К." },
  { name: "Чистовой монтаж", status: "next", date: "20 авг–05 сен", owner: "Иван М." },
];

const financeRows = [
  { title: "Сухие смеси, профиль, крепёж", meta: "Материалы · ЖК Море · сегодня, 10:42", amount: "−38 500 ₽", person: "Павел", tone: "minus" },
  { title: "Оплата по договору · этап 3", meta: "Приход · ЖК Атмосфера · вчера, 18:12", amount: "+300 000 ₽", person: "Денис", tone: "plus" },
  { title: "Электромонтаж · аванс", meta: "Работа / подряд · ЖК Море · вчера, 14:05", amount: "−50 000 ₽", person: "Денис", tone: "minus" },
  { title: "Яндекс Директ · август", meta: "Общие расходы · Реклама · 14 авг", amount: "−42 000 ₽", person: "Павел", tone: "minus" },
];

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
  useEffect(() => { let cancelled = false; readFinance().then((result) => { if (!cancelled) setFinance(result); }).catch(() => undefined); return () => { cancelled = true; }; }, []);
  const financeAttention = finance?.attentionItems.slice(0, 3) ?? [];
  return <>
    <section className="welcome"><div><span className="eyebrow">ВОСКРЕСЕНЬЕ, 16 АВГУСТА</span><h2>{user.name.split(" ")[0]}, текущая ситуация</h2><p>В фокусе 4 вопроса. Один из них влияет на срок сдачи.</p></div><div className="weather"><span>Владивосток</span><b>+23°</b><small>ясно · рабочий день</small></div></section>
    <section className="metrics-grid">
      <Metric label="ОБЪЕКТЫ В РАБОТЕ" value="7" detail="2 завершатся в сентябре" />
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
      <div className="panel-head"><div><span className="eyebrow">ПРОИЗВОДСТВО</span><h3>Активные объекты</h3></div><button className="link" onClick={() => onSection("objects")}>Все 7 объектов →</button></div>
      <div className="object-list">
        {objects.map(obj => <button className="object-row" key={obj.id} onClick={onObject}>
          <div className="project-mark">{obj.name.split(" ")[1][0]}{obj.id}</div>
          <div className="object-title"><strong>{obj.name}</strong><span>{obj.client}</span></div>
          <div className="stage"><span>{obj.stage}</span><div><i style={{ width: `${obj.progress}%` }} /></div><small>{obj.progress}%</small></div>
          <div className="object-meta"><span>Сдача</span><b>{obj.date}</b></div>
          <div className="object-meta money"><span>Бюджет</span><b>{obj.budget}</b></div>
          <div className={`object-meta money ${obj.alert ? "danger" : ""}`}><span>Баланс клиента</span><b>{obj.balance}</b></div>
          <span className="avatar mini dark">{obj.lead}</span><em className="chevron">›</em>
        </button>)}
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

function ObjectsScreen({ onObject }: { onObject: () => void }) {
  return <section className="screen-section"><div className="screen-intro"><div><span className="eyebrow">ПРОИЗВОДСТВО</span><h2>Объекты</h2><p>Все ремонтные проекты и их текущее состояние.</p></div><div className="segmented"><button className="active">Активные · 7</button><button>Подготовка · 3</button><button>Завершены · 18</button></div></div>
    <div className="project-grid">{[...objects, {...objects[0], id:4, name:"ЖК Нагорный · 16", client:"Софья Ларина", progress:82, stage:"Чистовой монтаж", date:"28 авг", budget:"4 120 000 ₽"}].map(obj => <button className="project-card" key={obj.id} onClick={onObject}>
      <div className="project-card-top"><span className="status-chip">{obj.status}</span><span>•••</span></div><div className="project-logo">{obj.name.slice(3,5)}</div><h3>{obj.name}</h3><p>{obj.client}</p>
      <div className="card-progress"><span>{obj.stage}</span><b>{obj.progress}%</b><div><i style={{width:`${obj.progress}%`}} /></div></div>
      <div className="project-card-meta"><span>Сдача <b>{obj.date}</b></span><span>Договор <b>{obj.budget}</b></span></div>
      <div className="project-card-foot"><span className="avatar mini dark">{obj.lead}</span><span className={obj.alert ? "danger-text" : ""}>{obj.alert ? "Требует внимания" : "По плану"}</span><b>Открыть →</b></div>
    </button>)}</div>
  </section>;
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

function ObjectDetail({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<ObjectTab>("overview");
  const tabs: {id:ObjectTab; label:string}[] = [{id:"overview",label:"Обзор"},{id:"estimate",label:"Смета"},{id:"finance",label:"Финансы"},{id:"stages",label:"Этапы"},{id:"photos",label:"Фотоотчёты"},{id:"docs",label:"Документы"}];
  return <section className="object-detail">
    <button className="back" onClick={onBack}>← Все объекты</button>
    <div className="object-hero"><div><div className="object-kicker"><span className="status-chip">В работе</span><span>DEP-0268</span></div><h2>ЖК Море · квартира 128</h2><p>ул. Басаргина, 16 · Александр Иванов · 62 м²</p></div><div className="hero-actions"><button>•••</button><button className="secondary">Открыть кабинет клиента ↗</button></div></div>
    <div className="object-tabs">{tabs.map(t => <button className={tab===t.id?"active":""} onClick={()=>setTab(t.id)} key={t.id}>{t.label}{t.id==="photos"&&<em>24</em>}</button>)}</div>
    {tab === "overview" && <div className="detail-grid"><div className="detail-main"><div className="metrics-grid detail-metrics"><Metric label="ГОТОВНОСТЬ" value="68%" detail="Малярные работы" /><Metric label="СРОК СДАЧИ" value="12 сентября" detail="27 дней · по плану" /><Metric label="АКТУАЛЬНАЯ СТОИМОСТЬ" value="2 640 000 ₽" detail="Исходно 2 600 000 ₽" /></div><div className="panel stage-panel"><div className="panel-head"><div><span className="eyebrow">ХОД РАБОТ</span><h3>Этапы</h3></div><button className="link" onClick={()=>setTab("stages")}>Весь календарь →</button></div><div className="timeline">{stages.slice(0,5).map(stage=><div className={stage.status} key={stage.name}><i>{stage.status==="done"?"✓":stage.status==="active"?"3":""}</i><span><b>{stage.name}</b><small>{stage.date} · {stage.owner}</small></span>{stage.status==="active"&&<em>Сейчас</em>}</div>)}</div></div></div><aside className="detail-aside"><div className="panel budget-card"><span className="eyebrow">БЮДЖЕТ КЛИЕНТА</span><h3>Баланс по назначениям</h3><div><span>Материалы</span><b>148 000 ₽</b></div><div><span>Работы</span><b>320 000 ₽</b></div><div><span>Доп. работы</span><b>45 000 ₽</b></div><hr/><div><span>Всего доступно</span><strong>513 000 ₽</strong></div><button className="secondary full">Открыть финансы</button></div><div className="panel people-card"><span className="eyebrow">КОМАНДА ОБЪЕКТА</span><div><span className="avatar">ДУ</span><p><b>Денис Учайкин</b><small>Руководитель проекта</small></p></div><div><span className="avatar dark">АК</span><p><b>Антон Ковалёв</b><small>Прораб</small></p></div></div></aside></div>}
    {tab === "estimate" && <div className="panel tab-content"><div className="panel-head"><div><span className="eyebrow">ВЕРСИЯ 4 · 12 АВГУСТА</span><h3>План / факт</h3></div><button className="secondary">История версий</button></div><div className="estimate-head"><span>Раздел работ</span><span>План</span><span>Факт</span><span>Отклонение</span></div>{[["Демонтаж","138 000 ₽","132 000 ₽","+6 000 ₽"],["Электромонтаж","180 000 ₽","210 000 ₽","−30 000 ₽"],["Сантехника","245 000 ₽","238 500 ₽","+6 500 ₽"],["Малярные работы","420 000 ₽","286 000 ₽","+134 000 ₽"]].map(r=><div className="estimate-row" key={r[0]}>{r.map((c,i)=><span className={i===3&&c.startsWith("−")?"danger-text":""} key={c}>{c}</span>)}</div>)}</div>}
    {tab === "finance" && <div className="panel tab-content"><div className="panel-head"><div><span className="eyebrow">ОБЪЕКТ</span><h3>Финансовые операции</h3></div><button className="secondary">＋ Операция</button></div>{financeRows.slice(0,3).map(row=><div className="transaction" key={row.title}><span className={`transaction-icon ${row.tone}`}>{row.tone==="plus"?"↓":"↑"}</span><div><b>{row.title}</b><small>{row.meta}</small></div><span className="person-pill">{row.person}</span><strong className={row.tone}>{row.amount}</strong></div>)}</div>}
    {tab === "stages" && <div className="panel tab-content"><div className="panel-head"><div><span className="eyebrow">КАЛЕНДАРЬ</span><h3>Производственный план</h3></div><button className="secondary">＋ Этап</button></div><div className="timeline large">{stages.map(stage=><div className={stage.status} key={stage.name}><i>{stage.status==="done"?"✓":stage.status==="active"?"5":""}</i><span><b>{stage.name}</b><small>{stage.date} · {stage.owner}</small></span><em>{stage.status==="active"?"В работе":stage.status==="done"?"Завершён":"Запланирован"}</em></div>)}</div></div>}
    {tab === "photos" && <div className="empty-state"><div>▧</div><h3>Строительный дневник</h3><p>24 фотоотчёта · последний загружен 14 августа</p><button className="primary">＋ Добавить фотоотчёт</button></div>}
    {tab === "docs" && <div className="empty-state"><div>▱</div><h3>Документы объекта</h3><p>Договор, 4 версии сметы и 6 закрывающих актов</p><button className="primary">＋ Загрузить документ</button></div>}
  </section>;
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
  const [objectOpen, setObjectOpen] = useState(false);
  const [modal, setModal] = useState<"picker"|"finance"|"search"|"profile"|null>(null);
  const [financeMode, setFinanceMode] = useState<FinanceMode>("EXPENSE");
  const [financeRevision, setFinanceRevision] = useState(0);
  const [targetClientId, setTargetClientId] = useState<string | null>(null);
  const [menuOpen,setMenuOpen]=useState(false);
  const title = nav.flatMap(g=>g.items).find(i=>i.id===section)?.label || "Обзор";
  function select(s:Section){if (!access.modules[moduleBySection[s]]) { setDenied(true); return; } setSection(s);setObjectOpen(false);setDenied(false)}
  function openFinance(mode: FinanceMode) { setFinanceMode(mode); setModal("finance"); }
  const firstAllowed = nav.flatMap((group) => group.items).find((item) => access.modules[moduleBySection[item.id]])?.id ?? "dashboard";
  const financeAllowed = access.modules.finance && access.actions["finance.view"] && access.ownCashbox;
  const allowedFinanceModes = { EXPENSE: financeAllowed && access.actions["finance.createExpense"], INCOME: financeAllowed && access.actions["finance.createIncome"], TRANSFER: financeAllowed && access.actions["finance.createTransfer"] };
  const canAddFinance = section === "finance" && Object.values(allowedFinanceModes).some(Boolean);
  return <div className="app-shell">
    <Sidebar section={section} onChange={select} open={menuOpen} onClose={()=>setMenuOpen(false)} user={currentUser} access={access} onProfile={()=>setModal("profile")}/>
    {menuOpen&&<button className="scrim" onClick={()=>setMenuOpen(false)} aria-label="Закрыть меню"/>}
    <main className="main"><Topbar title={objectOpen?"Объект":title} onMenu={()=>setMenuOpen(true)} onAdd={canAddFinance ? ()=>setModal("picker") : undefined} onSearch={currentUser.role === "OWNER" ? ()=>setModal("search") : undefined}/><div className="content">
      {denied ? <AccessDenied onNavigate={() => select(firstAllowed)} /> : objectOpen ? <ObjectDetail onBack={()=>setObjectOpen(false)}/> : section === "dashboard" ? (currentUser.role === "OWNER" ? <Dashboard onObject={()=>setObjectOpen(true)} onSection={select} user={currentUser}/> : <EmployeeDashboard user={currentUser} access={access} onSection={select}/>) : section === "clients" ? <ClientsScreen key={targetClientId ?? "clients"} currentUser={currentUser} access={access} initialClientId={targetClientId} onClientClosed={()=>setTargetClientId(null)}/> : section === "objects" ? (currentUser.role === "OWNER" ? <ObjectsScreen onObject={()=>setObjectOpen(true)}/> : <EmployeeObjectsScreen/>) : section === "crm" ? (currentUser.role === "OWNER" ? <CrmScreen canCreate={access.actions["crm.create"]}/> : <ScopedModuleScreen section="crm"/>) : section === "finance" ? <FinanceScreen key={financeRevision} onNew={openFinance}/> : section === "team" && currentUser.role === "OWNER" ? <TeamAccessScreen/> : currentUser.role === "EMPLOYEE" ? <ScopedModuleScreen section={section as GenericSection|"crm"}/> : <GenericScreen section={section as GenericSection} access={access}/>}{" "}
    </div></main>
    {modal==="picker"&&<OperationPickerModal allowed={allowedFinanceModes} onClose={()=>setModal(null)} onSelect={openFinance}/>} {modal==="finance"&&<FinanceOperationModal mode={financeMode} onClose={()=>setModal(null)} onSaved={()=>setFinanceRevision((value)=>value+1)}/>} {modal==="search"&&<SearchModal onClose={()=>setModal(null)} onClient={(id)=>{setTargetClientId(id);select("clients")}}/>} {modal==="profile"&&<ProfileModal user={currentUser} onClose={()=>setModal(null)}/>}{" "}
  </div>;
}
