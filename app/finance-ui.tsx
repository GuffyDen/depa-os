"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { FINANCE_CATEGORY_GROUPS, INCOME_PURPOSE_OPTIONS, financeCategoryLabel, financePurposeLabel } from "../lib/finance-categories";

export type FinanceMode = "EXPENSE" | "INCOME" | "TRANSFER" | "REFUND";

type Cashbox = {
  id: string; ownerUserId: string | null; ownerName: string | null; name: string; status: "ACTIVE" | "INACTIVE"; balanceKopecks: number;
  createdAt: number; deactivatedAt: number | null; todayIncomeKopecks: number; todayExpenseKopecks: number; transferredOutKopecks: number; transferredInKopecks: number;
};
type FinanceTransaction = {
  id: string; type: FinanceMode; expenseType: "PROJECT" | "ADMIN" | null; amountKopecks: number; transactionDate: number; cashboxId: string; cashboxName: string;
  destinationCashboxId: string | null; destinationCashboxName: string | null; originalTransactionId: string | null; projectId: string | null; projectName: string | null;
  clientId: string | null; category: string; source: string | null; purpose: string | null; title: string; comment: string | null; showToClient: boolean;
  authorUserId: string; authorName: string; createdAt: number; attachmentCount: number; attachmentId: string | null;
  allocations: { id: string; projectId: string; projectName: string; amountKopecks: number; purpose: string }[];
};
export type FinanceData = {
  isOwner: boolean; currentUserId: string; capabilities: { createExpense: boolean; createIncome: boolean; createTransfer: boolean; editTransaction: boolean; viewClientFunds: boolean; viewProfit: boolean; viewAdministrativeExpenses: boolean; cashboxScope: "OWN" | "ALL"; hasOwnActiveCashbox: boolean };
  cashboxes: Cashbox[]; transferRecipients: { id: string; name: string; ownerName: string | null }[]; transactions: FinanceTransaction[]; projects: { id: string; name: string; clientId: string; incomeKopecks: number; expenseKopecks: number; refundKopecks: number; actualExpenseKopecks: number; clientBalanceKopecks: number; materialsIncomeKopecks: number; materialsExpenseKopecks: number; materialsBalanceKopecks: number; worksIncomeKopecks: number; worksExpenseKopecks: number; worksBalanceKopecks: number; additionalWorksIncomeKopecks: number; otherIncomeKopecks: number }[];
  clients: { id: string; name: string }[]; physicalTotalKopecks: number; clientFundsKopecks: number | null; depaProfitKopecks: number | null;
  summary: { todayIncomeKopecks: number; todayExpenseKopecks: number; todayTransferKopecks: number; monthProjectExpenseKopecks: number; monthAdminExpenseKopecks: number | null };
  attentionItems: { type: string; severity: string; title: string; detail: string; cashboxId?: string; projectId?: string; transactionId?: string }[];
  reconciliation: { ok: boolean; mismatchCount: number };
};

const projectCategories = FINANCE_CATEGORY_GROUPS.PROJECT;
const adminCategories = FINANCE_CATEGORY_GROUPS.ADMIN;
const modeLabels: Record<FinanceMode, string> = { EXPENSE: "Добавить расход", INCOME: "Добавить поступление", TRANSFER: "Переместить деньги", REFUND: "Оформить возврат" };
export function money(kopecks: number, sign = false) {
  const rubles = Math.abs(kopecks) / 100;
  const prefix = sign ? (kopecks > 0 ? "+" : kopecks < 0 ? "−" : "") : kopecks < 0 ? "−" : "";
  return `${prefix}${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: Number.isInteger(rubles) ? 0 : 2 }).format(rubles)} ₽`;
}

function amountToKopecks(value: string) {
  const normalized = value.replaceAll(" ", "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export async function readFinance() {
  const response = await fetch("/api/finance", { cache: "no-store" });
  const result = await response.json() as FinanceData & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить финансы.");
  return result;
}

function transactionLabel(transaction: FinanceTransaction) {
  if (transaction.type === "TRANSFER") return `Перемещение · ${transaction.cashboxName} → ${transaction.destinationCashboxName}`;
  if (transaction.type === "REFUND") return `Возврат · ${transaction.category}`;
  if (transaction.type === "INCOME") return `Поступление · ${transaction.source || transaction.category}`;
  return `${transaction.expenseType === "ADMIN" ? "Административный" : "Объектный"} расход · ${financeCategoryLabel(transaction.category)}`;
}

function TransactionRow({ transaction, cashboxId, onOpen }: { transaction: FinanceTransaction; cashboxId?: string; onOpen?: () => void }) {
  const incomingTransfer = transaction.type === "TRANSFER" && transaction.destinationCashboxId === cashboxId;
  const positive = transaction.type === "INCOME" || transaction.type === "REFUND" || incomingTransfer;
  const neutral = transaction.type === "TRANSFER" && !cashboxId;
  const amount = neutral ? money(transaction.amountKopecks) : money(positive ? transaction.amountKopecks : -transaction.amountKopecks, true);
  return <div className="transaction finance-transaction">
    <span className={`transaction-icon ${positive ? "plus" : transaction.type === "TRANSFER" ? "transfer" : "minus"}`}>{transaction.type === "TRANSFER" ? "⇄" : positive ? "↓" : "↑"}</span>
    <div><b>{transaction.title}</b><small>{transactionLabel(transaction)}{transaction.projectName ? ` · ${transaction.projectName}` : ""}{transaction.allocations.length ? ` · ${transaction.allocations.map((item) => `${item.projectName} ${money(item.amountKopecks)}`).join("; ")}` : ""}{transaction.purpose ? ` · ${financePurposeLabel(transaction.purpose)}` : ""}<br />{new Date(transaction.transactionDate * 1000).toLocaleDateString("ru-RU")} · {transaction.authorName}{transaction.attachmentId ? <> · <a href={`/api/files/${transaction.attachmentId}`} target="_blank" rel="noreferrer">чек приложен</a></> : " · без чека"}{onOpen && <> · <button type="button" className="inline-detail" onClick={onOpen}>подробнее</button></>}</small></div>
    <span className="person-pill">{transaction.cashboxName}</span><strong className={positive ? "plus" : neutral ? "" : "minus"}>{amount}</strong>
  </div>;
}

type PeriodPreset = "ALL" | "TODAY" | "YESTERDAY" | "THIS_WEEK" | "THIS_MONTH" | "LAST_MONTH" | "CUSTOM";

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function periodRange(preset: PeriodPreset, customFrom: string, customTo: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (preset === "ALL") return { from: "", to: "" };
  if (preset === "CUSTOM") return { from: customFrom, to: customTo };
  if (preset === "TODAY") return { from: dateInputValue(today), to: dateInputValue(today) };
  if (preset === "YESTERDAY") { const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1); return { from: dateInputValue(yesterday), to: dateInputValue(yesterday) }; }
  if (preset === "THIS_WEEK") { const monday = new Date(today); const day = monday.getDay() || 7; monday.setDate(monday.getDate() - day + 1); return { from: dateInputValue(monday), to: dateInputValue(today) }; }
  if (preset === "THIS_MONTH") { const first = new Date(today.getFullYear(), today.getMonth(), 1); return { from: dateInputValue(first), to: dateInputValue(today) }; }
  const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const last = new Date(today.getFullYear(), today.getMonth(), 0);
  return { from: dateInputValue(first), to: dateInputValue(last) };
}

function CashboxHistory({ cashbox, projects, isOwner, onOpen }: { cashbox: Cashbox; projects: FinanceData["projects"]; isOwner: boolean; onOpen: (transaction: FinanceTransaction) => void }) {
  const [period, setPeriod] = useState<PeriodPreset>("ALL");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [appliedCustomFrom, setAppliedCustomFrom] = useState("");
  const [appliedCustomTo, setAppliedCustomTo] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const categories = [...FINANCE_CATEGORY_GROUPS.PROJECT, ...FINANCE_CATEGORY_GROUPS.ADMIN].filter((item, index, all) => all.findIndex((candidate) => candidate.code === item.code) === index);
  const filtersActive = period !== "ALL" || Boolean(typeFilter || categoryFilter || projectFilter);

  const loadHistory = useCallback(async (offset: number, signal?: AbortSignal) => {
    const range = periodRange(period, appliedCustomFrom, appliedCustomTo);
    const params = new URLSearchParams({ cashboxId: cashbox.id, limit: "20", offset: String(offset) });
    if (range.from) params.set("dateFrom", range.from);
    if (range.to) params.set("dateTo", range.to);
    if (typeFilter) params.set("transactionType", typeFilter);
    if (categoryFilter) params.set("category", categoryFilter);
    if (projectFilter) params.set("projectId", projectFilter);
    const response = await fetch(`/api/finance/history?${params}`, { cache: "no-store", signal });
    const result = await response.json() as { transactions?: FinanceTransaction[]; hasMore?: boolean; error?: string };
    if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить историю кассы.");
    return { transactions: result.transactions ?? [], hasMore: Boolean(result.hasMore) };
  }, [appliedCustomFrom, appliedCustomTo, cashbox.id, categoryFilter, period, projectFilter, typeFilter]);

  useEffect(() => {
    if (period === "CUSTOM" && (!appliedCustomFrom || !appliedCustomTo)) return;
    const controller = new AbortController();
    loadHistory(0, controller.signal).then((result) => {
      setTransactions(result.transactions); setHasMore(result.hasMore);
    }).catch((reason) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить историю кассы.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [appliedCustomFrom, appliedCustomTo, loadHistory, period]);

  function resetFilters() {
    setLoading(true); setPeriod("ALL"); setCustomFrom(""); setCustomTo(""); setAppliedCustomFrom(""); setAppliedCustomTo(""); setTypeFilter(""); setCategoryFilter(""); setProjectFilter(""); setError("");
  }

  function applyCustomPeriod() {
    if (!customFrom || !customTo) { setError("Укажите обе даты периода."); return; }
    if (customFrom > customTo) { setError("Дата начала периода должна быть не позже даты окончания."); return; }
    setLoading(true); setError(""); setAppliedCustomFrom(customFrom); setAppliedCustomTo(customTo);
  }

  async function loadMore() {
    setLoadingMore(true); setError("");
    try { const result = await loadHistory(transactions.length); setTransactions((current) => [...current, ...result.transactions]); setHasMore(result.hasMore); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить следующую страницу."); }
    finally { setLoadingMore(false); }
  }

  return <div className="cashbox-history"><div className="table-toolbar"><strong>История операций</strong><small>{transactions.length} загружено</small></div>
    <div className="cashbox-history-filters">
      <label><span>Период</span><select value={period} onChange={(event) => { const next = event.target.value as PeriodPreset; setLoading(next !== "CUSTOM"); setError(""); setPeriod(next); if (next === "CUSTOM") { setAppliedCustomFrom(""); setAppliedCustomTo(""); } }}><option value="ALL">Всё время</option><option value="TODAY">Сегодня</option><option value="YESTERDAY">Вчера</option><option value="THIS_WEEK">Эта неделя</option><option value="THIS_MONTH">Этот месяц</option><option value="LAST_MONTH">Прошлый месяц</option><option value="CUSTOM">Выбрать период</option></select></label>
      <label><span>Тип</span><select value={typeFilter} onChange={(event) => { setLoading(true); setError(""); setTypeFilter(event.target.value); }}><option value="">Все типы</option><option value="EXPENSE">Расход</option><option value="INCOME">Поступление</option><option value="TRANSFER">Перемещение</option></select></label>
      <label><span>Категория</span><select value={categoryFilter} onChange={(event) => { setLoading(true); setError(""); setCategoryFilter(event.target.value); }}><option value="">Все категории</option>{categories.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
      <label><span>Объект</span><select value={projectFilter} onChange={(event) => { setLoading(true); setError(""); setProjectFilter(event.target.value); }}><option value="">Все объекты</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <button type="button" className="cashbox-filter-reset" onClick={resetFilters} disabled={!filtersActive}>Сбросить</button>
    </div>
    {period === "CUSTOM" && <div className="cashbox-date-range"><label><span>От</span><input aria-label="Дата от" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label><i>—</i><label><span>До</span><input aria-label="Дата до" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label><button type="button" className="secondary" onClick={applyCustomPeriod}>Применить</button></div>}
    {error && <div className="auth-error cashbox-history-error" role="alert"><i>!</i><span>{error}</span></div>}
    {loading ? <div className="finance-empty">Загружаем операции…</div> : transactions.length ? transactions.map((item) => <TransactionRow key={item.id} transaction={item} cashboxId={cashbox.id} onOpen={isOwner ? () => onOpen(item) : undefined} />) : <div className="finance-empty">{filtersActive ? "Операций за выбранный период нет." : "Операций пока нет."}</div>}
    {!loading && hasMore && <div className="cashbox-load-more"><button type="button" className="secondary" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "Загружаем…" : "Показать ещё"}</button></div>}
  </div>;
}

function SelectedCashboxCard({ cashbox, projects, isOwner, onOpen }: { cashbox: Cashbox; projects: FinanceData["projects"]; isOwner: boolean; onOpen: (transaction: FinanceTransaction) => void }) {
  return <article className="cashbox-card selected-cashbox-card panel">
    <header><div><span className="eyebrow">ПЕРСОНАЛЬНАЯ КАССА</span><h3>{cashbox.name}</h3></div><span className={`cashbox-status ${cashbox.status.toLowerCase()}`}>{cashbox.status === "ACTIVE" ? "Активна" : "Неактивна"}</span></header>
    <div className="cashbox-balance"><span>Текущий баланс</span><strong className={cashbox.balanceKopecks < 0 ? "minus" : ""}>{money(cashbox.balanceKopecks)}</strong>{cashbox.balanceKopecks < 0 && <small>DEPA должна владельцу кассы {money(Math.abs(cashbox.balanceKopecks))}</small>}</div>
    <div className="cashbox-stats"><div><span>Сегодня поступило</span><b>{money(cashbox.todayIncomeKopecks)}</b></div><div><span>Сегодня потрачено</span><b>{money(cashbox.todayExpenseKopecks)}</b></div><div><span>Передано</span><b>{money(cashbox.transferredOutKopecks)}</b></div><div><span>Получено</span><b>{money(cashbox.transferredInKopecks)}</b></div></div>
    <CashboxHistory cashbox={cashbox} projects={projects} isOwner={isOwner} onOpen={onOpen} />
  </article>;
}

function CashboxWorkspace({ data, onOpen }: { data: FinanceData; onOpen: (transaction: FinanceTransaction) => void }) {
  const availableCashboxes = data.cashboxes;
  const ownCashbox = availableCashboxes.find((box) => box.ownerUserId === data.currentUserId && box.status === "ACTIVE");
  const [selectedCashboxId, setSelectedCashboxId] = useState(() => ownCashbox?.id ?? availableCashboxes[0]?.id ?? "");
  const selectedCashbox = availableCashboxes.find((box) => box.id === selectedCashboxId) ?? ownCashbox ?? availableCashboxes[0];
  if (!selectedCashbox) return <div className="panel finance-empty">Касс в доступной области нет.</div>;
  return <div className="cashbox-workspace">
    {availableCashboxes.length > 1 && <label className="cashbox-selector"><span>Касса</span><select value={selectedCashbox.id} onChange={(event) => setSelectedCashboxId(event.target.value)}>{availableCashboxes.map((box) => <option key={box.id} value={box.id}>{box.ownerName ?? box.name} · {box.name}{box.status === "INACTIVE" ? " · неактивна" : ""}</option>)}</select></label>}
    <SelectedCashboxCard key={selectedCashbox.id} cashbox={selectedCashbox} projects={data.projects} isOwner={data.isOwner} onOpen={onOpen} />
  </div>;
}

export function FinanceScreen({ onNew }: { onNew: (mode: FinanceMode) => void }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"OPERATIONS" | "CASHBOXES">("OPERATIONS");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [cashboxFilter, setCashboxFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  const [receiptFilter, setReceiptFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedTransaction, setSelectedTransaction] = useState<FinanceTransaction | null>(null);
  async function refresh() { try { setError(""); setData(await readFinance()); } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить финансы."); } }
  useEffect(() => {
    let cancelled = false;
    readFinance().then((result) => { if (!cancelled) setData(result); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось загрузить финансы."); });
    return () => { cancelled = true; };
  }, []);
  const filteredTransactions = (data?.transactions ?? []).filter((item) => {
    const haystack = `${item.title} ${item.comment ?? ""} ${item.projectName ?? ""} ${item.authorName} ${item.source ?? ""} ${item.allocations.map((allocation) => allocation.projectName).join(" ")}`.toLocaleLowerCase("ru-RU");
    const day = new Date(item.transactionDate * 1000).toISOString().slice(0, 10);
    return (!query || haystack.includes(query.toLocaleLowerCase("ru-RU")))
      && (!typeFilter || item.type === typeFilter)
      && (!cashboxFilter || item.cashboxId === cashboxFilter || item.destinationCashboxId === cashboxFilter)
      && (!categoryFilter || item.category === categoryFilter)
      && (!projectFilter || item.projectId === projectFilter || item.allocations.some((allocation) => allocation.projectId === projectFilter))
      && (!authorFilter || item.authorUserId === authorFilter)
      && (!receiptFilter || (receiptFilter === "YES" ? item.attachmentCount > 0 : item.attachmentCount === 0))
      && (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
  });
  const categoryOptions = [...FINANCE_CATEGORY_GROUPS.PROJECT, ...FINANCE_CATEGORY_GROUPS.ADMIN].filter((item, index, all) => all.findIndex((candidate) => candidate.code === item.code) === index);
  const authors = [...new Map((data?.transactions ?? []).map((item) => [item.authorUserId, item.authorName])).entries()];
  const canWrite = data?.capabilities.hasOwnActiveCashbox === true;
  return <section className="screen-section finance-screen"><div className="screen-intro"><div><span className="eyebrow">ЕДИНЫЙ УЧЁТ</span><h2>Финансы</h2><p>Кассы показывают физическое расположение денег. Просмотр касс не даёт права проводить операции из чужой кассы.</p></div><div className="finance-actions">{data?.capabilities.createIncome && canWrite ? <button className="secondary" onClick={() => onNew("INCOME")}>＋ Поступление</button> : null}{data?.capabilities.createExpense && canWrite ? <button className="secondary" onClick={() => onNew("EXPENSE")}>− Расход</button> : null}{data?.capabilities.createTransfer && canWrite && data.transferRecipients.length ? <button className="primary" onClick={() => onNew("TRANSFER")}>⇄ Переместить</button> : null}</div></div>
    <div className="segmented finance-tabs"><button className={tab === "OPERATIONS" ? "active" : ""} onClick={() => setTab("OPERATIONS")}>Операции</button><button className={tab === "CASHBOXES" ? "active" : ""} onClick={() => setTab("CASHBOXES")}>Кассы</button></div>
    {error && <div className="auth-error" role="alert"><i>!</i><span>{error}</span><button onClick={refresh}>Повторить</button></div>}
    {!data && !error && <div className="panel finance-loading">Загружаем финансовые данные…</div>}
    {data && <>
      <div className="metrics-grid finance-metrics finance-summary"><div className="metric"><div className="metric-top"><span>{data.capabilities.cashboxScope === "OWN" ? "МОЯ КАССА" : "ФИЗИЧЕСКИ В КАССАХ"}</span><i>↗</i></div><strong className={data.physicalTotalKopecks < 0 ? "minus" : ""}>{money(data.physicalTotalKopecks)}</strong><small>{data.cashboxes.filter((box) => box.status === "ACTIVE").length} активные кассы в доступной области</small></div>{data.capabilities.viewClientFunds && data.clientFundsKopecks !== null ? <div className="metric"><div className="metric-top"><span>СРЕДСТВА КЛИЕНТОВ</span><i>↗</i></div><strong>{money(data.clientFundsKopecks)}</strong><small>Текущий остаток клиентских средств</small></div> : null}{data.capabilities.viewProfit && data.depaProfitKopecks !== null ? <div className="metric"><div className="metric-top"><span>ПРИБЫЛЬ DEPA</span><i>↗</i></div><strong>{money(data.depaProfitKopecks)}</strong><small>Управленческий показатель</small></div> : null}</div>
      {data.attentionItems.length > 0 && <div className="panel finance-attention"><div className="table-toolbar"><strong>Требует внимания</strong><small>{data.attentionItems.length}</small></div>{data.attentionItems.slice(0, 8).map((item, index) => <div className="finance-attention-row" key={`${item.type}-${item.transactionId ?? item.projectId ?? item.cashboxId ?? index}`}><i>!</i><span><b>{item.title}</b><small>{item.detail}</small></span></div>)}</div>}
      {tab === "OPERATIONS" ? <div className="panel table-panel"><div className="table-toolbar"><strong>Все операции</strong><small>{filteredTransactions.length} из {data.transactions.length}</small></div><div className="finance-filter-bar"><input aria-label="Поиск операций" placeholder="Комментарий, клиент, объект" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Тип" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">Все типы</option><option value="INCOME">Поступление</option><option value="EXPENSE">Расход</option><option value="TRANSFER">Перемещение</option></select><select aria-label="Касса" value={cashboxFilter} onChange={(event) => setCashboxFilter(event.target.value)}><option value="">Все кассы</option>{data.cashboxes.map((box) => <option value={box.id} key={box.id}>{box.name}</option>)}</select><select aria-label="Категория" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Все категории</option>{categoryOptions.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select><select aria-label="Объект" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="">Все объекты</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><select aria-label="Автор" value={authorFilter} onChange={(event) => setAuthorFilter(event.target.value)}><option value="">Все авторы</option>{authors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select aria-label="Чек" value={receiptFilter} onChange={(event) => setReceiptFilter(event.target.value)}><option value="">Чек: любой</option><option value="YES">Есть чек</option><option value="NO">Нет чека</option></select><input aria-label="Дата от" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /><input aria-label="Дата до" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div>{filteredTransactions.length ? filteredTransactions.map((item) => <TransactionRow key={item.id} transaction={item} onOpen={data.capabilities.editTransaction ? () => setSelectedTransaction(item) : undefined} />) : <div className="finance-empty">По выбранным фильтрам операций нет.</div>}</div> : <CashboxWorkspace data={data} onOpen={data.capabilities.editTransaction ? setSelectedTransaction : () => undefined} />}
    </>}
    {selectedTransaction && <TransactionDetailModal transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} onSaved={async () => { setSelectedTransaction(null); await refresh(); }} />}
  </section>;
}

function TransactionDetailModal({ transaction, onClose, onSaved }: { transaction: FinanceTransaction; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/finance", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: transaction.id, title: form.get("title"), comment: form.get("comment"), showToClient: form.get("showToClient") === "on" }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? "Не удалось обновить операцию."); setLoading(false); return; }
    onSaved();
  }
  return <div className="modal-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal finance-detail-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-detail-title"><div className="modal-head"><div><span className="eyebrow">ФИНАНСОВАЯ ОПЕРАЦИЯ</span><h3 id="transaction-detail-title">{transactionLabel(transaction)}</h3></div><button onClick={onClose} aria-label="Закрыть">×</button></div><div className="transaction-facts"><span>Сумма <b>{money(transaction.amountKopecks)}</b></span><span>Дата <b>{new Date(transaction.transactionDate * 1000).toLocaleDateString("ru-RU")}</b></span><span>Касса <b>{transaction.cashboxName}</b></span><span>Автор <b>{transaction.authorName}</b></span></div>{transaction.allocations.length > 0 && <div className="detail-allocations">{transaction.allocations.map((item) => <span key={item.id}>{item.projectName}<b>{money(item.amountKopecks)}</b></span>)}</div>}<form onSubmit={submit}><label><span>Название</span><input name="title" defaultValue={transaction.title} required /></label><label><span>Комментарий</span><textarea name="comment" defaultValue={transaction.comment ?? ""} /></label>{transaction.expenseType === "PROJECT" && <label className="toggle-row"><span><b>Показывать клиенту</b><small>Изменение будет записано в audit log</small></span><input name="showToClient" type="checkbox" defaultChecked={transaction.showToClient} /></label>}<div className="immutable-note">Сумма, касса, категория, объект и распределение защищены от тихого редактирования.</div>{transaction.attachmentId && <a className="secondary receipt-link" href={`/api/files/${transaction.attachmentId}`} target="_blank" rel="noreferrer">Открыть чек</a>}{error && <div className="auth-error" role="alert"><i>!</i><span>{error}</span></div>}<div className="modal-actions"><button type="button" onClick={onClose}>Закрыть</button><button className="primary" type="submit" disabled={loading}>{loading ? "Сохраняем…" : "Сохранить изменения"}</button></div></form></section></div>;
}

export function OperationPickerModal({ onClose, onSelect, allowed }: { onClose: () => void; onSelect: (mode: FinanceMode) => void; allowed: Partial<Record<FinanceMode, boolean>> }) {
  return <div className="modal-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal operation-picker" role="dialog" aria-modal="true" aria-labelledby="operation-picker-title"><div className="modal-head"><div><h3 id="operation-picker-title">Добавить операцию</h3></div><button onClick={onClose} aria-label="Закрыть">×</button></div><div className="operation-options">
    {allowed.EXPENSE ? <button onClick={() => onSelect("EXPENSE")}><i>−</i><span><b>Расход</b><small>Только из собственной кассы</small></span><em>→</em></button> : null}
    {allowed.INCOME ? <button onClick={() => onSelect("INCOME")}><i>＋</i><span><b>Поступление</b><small>Только в собственную кассу</small></span><em>→</em></button> : null}
    {allowed.TRANSFER ? <button onClick={() => onSelect("TRANSFER")}><i>⇄</i><span><b>Перемещение</b><small>Из своей кассы в другую активную</small></span><em>→</em></button> : null}
  </div></section></div>;
}

async function uploadReceipt(file: File | undefined, projectId: string | null) {
  if (!file) return null;
  const mimeType = file.type.toLocaleLowerCase("en-US");
  const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };
  if (!extensions[mimeType]) throw new Error("Разрешены PDF, JPG, PNG, WebP и HEIC/HEIF.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Чек должен быть не больше 10 МБ.");
  const attachmentId = crypto.randomUUID();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  const checksumSha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const pathname = `depa-os/receipt/${attachmentId}.${extensions[mimeType]}`;
  const { upload } = await import("@vercel/blob/client");
  await upload(pathname, file, {
    access: "private",
    handleUploadUrl: "/api/files/upload",
    contentType: mimeType,
    multipart: file.size > 5 * 1024 * 1024,
    clientPayload: JSON.stringify({ attachmentId, originalFilename: file.name, mimeType, sizeBytes: file.size, checksumSha256, category: "RECEIPT", visibility: "INTERNAL", entityType: "FINANCIAL_TRANSACTION", entityId: null, projectId }),
  });
  return attachmentId;
}

export function FinanceOperationModal({ mode, onClose, onSaved, initialProjectId = "", initialClientId = "" }: { mode: FinanceMode; onClose: () => void; onSaved: () => void; initialProjectId?: string; initialClientId?: string }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [expenseType, setExpenseType] = useState<"PROJECT" | "ADMIN">("PROJECT");
  const [amount, setAmount] = useState("");
  const [cashboxId, setCashboxId] = useState("");
  const [destinationCashboxId, setDestinationCashboxId] = useState("");
  const [projectId, setProjectId] = useState(initialProjectId);
  const [clientId, setClientId] = useState(initialClientId);
  const [originalTransactionId, setOriginalTransactionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [splitAcrossProjects, setSplitAcrossProjects] = useState(false);
  const [allocations, setAllocations] = useState([{ projectId: "", amount: "" }, { projectId: "", amount: "" }]);
  const [category, setCategory] = useState("MATERIALS");
  useEffect(() => { readFinance().then((result) => { setData(result); const own = result.cashboxes.find((box) => box.ownerUserId === result.currentUserId && box.status === "ACTIVE"); setCashboxId(own?.id ?? ""); setDestinationCashboxId(result.transferRecipients[0]?.id ?? ""); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить кассы.")); }, []);
  const activeCashboxes = data?.cashboxes.filter((box) => box.status === "ACTIVE") ?? [];
  const selectedCashbox = activeCashboxes.find((box) => box.id === cashboxId);
  const destinationCashbox = activeCashboxes.find((box) => box.id === destinationCashboxId);
  const amountKopecks = amountToKopecks(amount);
  const sourceAfter = selectedCashbox ? selectedCashbox.balanceKopecks + (mode === "EXPENSE" || mode === "TRANSFER" ? -amountKopecks : amountKopecks) : 0;
  const destinationAfter = destinationCashbox ? destinationCashbox.balanceKopecks + amountKopecks : 0;
  const selectedOriginal = data?.transactions.find((item) => item.id === originalTransactionId);
  const categories = expenseType === "PROJECT" ? projectCategories : adminCategories;
  const allocationTotalKopecks = allocations.reduce((sum, item) => sum + amountToKopecks(item.amount), 0);
  const allocationRemainingKopecks = amountKopecks - allocationTotalKopecks;
  const selectedProject = data?.projects.find((item) => item.id === projectId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const receiptProjectId = splitAcrossProjects ? null : expenseType === "PROJECT" || mode !== "EXPENSE" ? projectId || null : null;
      const attachmentId = await uploadReceipt(form.get("attachment") instanceof File && (form.get("attachment") as File).size > 0 ? form.get("attachment") as File : undefined, receiptProjectId);
      const effectiveCashboxId = mode === "REFUND" && selectedOriginal ? selectedOriginal.cashboxId : cashboxId;
      const response = await fetch("/api/finance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        type: mode, amount, date: form.get("date"), cashboxId: effectiveCashboxId, destinationCashboxId, expenseType,
        category: form.get("category"), projectId: expenseType === "PROJECT" || mode !== "EXPENSE" ? projectId || null : null,
        clientId: clientId || null, purpose: form.get("purpose"), source: form.get("source"), title: form.get("title"), comment: form.get("comment"),
        showToClient: expenseType === "PROJECT" && form.get("showToClient") === "on", originalTransactionId: originalTransactionId || null, attachmentId,
        allocations: mode === "EXPENSE" && expenseType === "PROJECT" && splitAcrossProjects ? allocations : [],
      }) });
      const result = await response.json() as { error?: string; operation?: { warning?: string | null } };
      if (!response.ok) throw new Error(result.error ?? "Не удалось провести операцию.");
      setSuccess(result.operation?.warning ? `Операция проведена. ${result.operation.warning}` : "Операция проведена и записана в историю.");
      onSaved(); setTimeout(onClose, 1400);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось провести операцию."); setLoading(false); }
  }

  return <div className="modal-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onClose(); }}><section className="modal finance-modal" role="dialog" aria-modal="true" aria-labelledby="finance-modal-title"><div className="modal-head"><div><span className="eyebrow">ФИНАНСЫ</span><h3 id="finance-modal-title">{modeLabels[mode]}</h3></div><button onClick={onClose} aria-label="Закрыть">×</button></div>
    {success ? <div className="success"><i>✓</i><h3>Готово</h3><p>{success}</p></div> : <form onSubmit={submit}>
      {mode === "EXPENSE" && <fieldset className="expense-type"><legend>Тип расхода</legend><button type="button" className={expenseType === "PROJECT" ? "active" : ""} onClick={() => { setExpenseType("PROJECT"); setCategory("MATERIALS"); }}><b>Объектный расход</b><small>Связан с конкретным объектом</small></button>{data?.capabilities.viewAdministrativeExpenses ? <button type="button" className={expenseType === "ADMIN" ? "active" : ""} onClick={() => { setExpenseType("ADMIN"); setCategory("ADVERTISING"); setSplitAcrossProjects(false); }}><b>Административный расход</b><small>Без объекта и клиентского показа</small></button> : null}</fieldset>}
      <div className="form-grid"><label><span>Сумма</span><div className="amount-input"><input required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="100 000" /><b>₽</b></div></label><label><span>Дата</span><input name="date" type="date" defaultValue={localDate()} required /></label>
        {mode === "TRANSFER" ? <><label><span>Откуда</span><input value={selectedCashbox ? `${selectedCashbox.ownerName ?? ""} · ${selectedCashbox.name}` : "Собственная касса недоступна"} readOnly /></label><label><span>Куда</span><select value={destinationCashboxId} onChange={(event) => setDestinationCashboxId(event.target.value)} required><option value="">Выберите кассу</option>{data?.transferRecipients.map((box) => <option key={box.id} value={box.id}>{box.ownerName ?? box.name} · {box.name}</option>)}</select></label></> : mode === "REFUND" ? <label className="wide"><span>Исходный расход</span><select value={originalTransactionId} onChange={(event) => { const id = event.target.value; setOriginalTransactionId(id); const original = data?.transactions.find((item) => item.id === id); if (original) { setCashboxId(original.cashboxId); setProjectId(original.projectId ?? ""); } }}><option value="">Без связи с исходной операцией</option>{data?.transactions.filter((item) => item.type === "EXPENSE").map((item) => <option key={item.id} value={item.id}>{item.title} · {money(item.amountKopecks)} · {item.cashboxName}</option>)}</select></label> : <label><span>{mode === "INCOME" ? "Касса-получатель" : "Касса"}</span><input value={selectedCashbox ? `${selectedCashbox.ownerName ?? ""} · ${selectedCashbox.name} · ${money(selectedCashbox.balanceKopecks)}` : "Собственная касса недоступна"} readOnly /></label>}
        {mode === "EXPENSE" && <><label><span>Категория</span><select name="category" key={expenseType} value={category} onChange={(event) => setCategory(event.target.value)} required>{categories.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>{expenseType === "PROJECT" && !splitAcrossProjects && <label className="wide"><span>Объект</span><select value={projectId} onChange={(event) => { setProjectId(event.target.value); const project = data?.projects.find((item) => item.id === event.target.value); setClientId(project?.clientId ?? ""); }} required><option value="">Выберите объект</option>{data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>{data?.projects.length === 0 && <small>Нет доступных объектов. Создайте объект в разделе «Объекты».</small>}</label>}</>}
        {mode === "INCOME" && <><label><span>Источник</span><input name="source" required placeholder="Клиент, банк, другое" /></label><label><span>Клиент</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Не связан</option>{data?.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label><span>Объект</span><select value={projectId} onChange={(event) => { setProjectId(event.target.value); const project = data?.projects.find((item) => item.id === event.target.value); if (project) setClientId(project.clientId); }}><option value="">Не связан</option>{data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>{data?.projects.length === 0 && <small>Нет доступных объектов. Создайте объект в разделе «Объекты».</small>}</label><label><span>Назначение</span><select name="purpose" required={Boolean(projectId || clientId)}><option value="">Выберите</option>{INCOME_PURPOSE_OPTIONS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label></>}
        {mode === "REFUND" && !selectedOriginal && <><label><span>Касса</span><select value={cashboxId} onChange={(event) => setCashboxId(event.target.value)} required><option value="">Выберите кассу</option>{activeCashboxes.map((box) => <option key={box.id} value={box.id}>{box.name}</option>)}</select></label><label><span>Категория</span><input name="category" required placeholder="Материалы" /></label><label className="wide"><span>Объект</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Не связан</option>{data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></>}
        {mode !== "TRANSFER" && <label className="wide"><span>{mode === "INCOME" ? "Назначение / название" : "Название"}</span><input name="title" placeholder={mode === "REFUND" ? "Возврат материалов" : mode === "EXPENSE" ? "Что оплачено" : "Оплата по договору"} /></label>}
        <label className="wide"><span>Комментарий</span><textarea name="comment" placeholder={mode === "TRANSFER" ? "Передал на закупки" : "Необязательно"} /></label>
      </div>
      {mode === "EXPENSE" && expenseType === "PROJECT" && <><label className="toggle-row"><span><b>Распределить между несколькими объектами</b><small>Один исходный чек останется у общей операции</small></span><input type="checkbox" checked={splitAcrossProjects} disabled={(data?.projects.length ?? 0) < 2} onChange={(event) => { setSplitAcrossProjects(event.target.checked); if (event.target.checked) { setProjectId(""); setClientId(""); } }} /></label>{splitAcrossProjects && <div className="allocation-editor"><div className="table-toolbar"><strong>Распределение</strong><small>Общая сумма: {money(amountKopecks)}</small></div>{allocations.map((allocation, index) => <div className="allocation-row" key={index}><select aria-label={`Объект распределения ${index + 1}`} value={allocation.projectId} onChange={(event) => setAllocations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, projectId: event.target.value } : item))} required><option value="">Выберите объект</option>{data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><div className="amount-input"><input aria-label={`Сумма распределения ${index + 1}`} value={allocation.amount} onChange={(event) => setAllocations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} inputMode="decimal" required placeholder="0" /><b>₽</b></div>{allocations.length > 2 && <button type="button" aria-label="Удалить строку распределения" onClick={() => setAllocations((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>}</div>)}<button type="button" className="link" onClick={() => setAllocations((current) => [...current, { projectId: "", amount: "" }])}>＋ Добавить объект</button><div className={allocationRemainingKopecks === 0 ? "allocation-total ready" : "allocation-total"}><span>Осталось распределить</span><b>{money(allocationRemainingKopecks)}</b></div></div>}</>}
      <label className="upload"><input name="attachment" type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" onChange={(event) => setAttachmentName(event.target.files?.[0]?.name ?? "")} /><i>＋</i><span><b>{attachmentName || "Прикрепить чек"}</b><small>PDF, JPG, PNG, WebP или HEIC до 10 МБ · необязательно</small></span></label>
      {mode === "EXPENSE" && expenseType === "PROJECT" && <label className="toggle-row"><span><b>Показывать клиенту</b><small>Расход появится в клиентском кабинете</small></span><input name="showToClient" type="checkbox" defaultChecked /></label>}
      <div className={`warning after-posting ${sourceAfter < 0 ? "negative" : ""}`}><b>После проведения</b>{selectedCashbox && <><span>{selectedCashbox.name}</span><strong>{money(selectedCashbox.balanceKopecks)} → {money(sourceAfter)}</strong></>}{mode === "TRANSFER" && destinationCashbox && <><span>{destinationCashbox.name}</span><strong>{money(destinationCashbox.balanceKopecks)} → {money(destinationAfter)}</strong></>}{sourceAfter < 0 && <p>Баланс кассы станет отрицательным. Операция разрешена.</p>}</div>
      {mode === "EXPENSE" && expenseType === "PROJECT" && category === "MATERIALS" && !splitAcrossProjects && selectedProject && <div className={`warning after-posting ${selectedProject.materialsBalanceKopecks - amountKopecks < 0 ? "negative" : ""}`}><b>Клиентский бюджет материалов</b><span>{selectedProject.name}</span><strong>{money(selectedProject.materialsBalanceKopecks)} → {money(selectedProject.materialsBalanceKopecks - amountKopecks)}</strong>{selectedProject.materialsBalanceKopecks - amountKopecks < 0 && <p>Возникнет долг клиента {money(Math.abs(selectedProject.materialsBalanceKopecks - amountKopecks))}. Операция разрешена.</p>}</div>}
      {error && <div className="auth-error" role="alert"><i>!</i><span>{error}</span></div>}
      <div className="modal-actions"><button type="button" onClick={onClose}>Отмена</button><button type="submit" className="primary" disabled={loading || !data || (splitAcrossProjects && allocationRemainingKopecks !== 0)}>{loading ? "Проводим…" : mode === "TRANSFER" ? "Провести перемещение" : "Провести операцию"}</button></div>
    </form>}
  </section></div>;
}

type TeamMember = { id: string; name: string; role: string; status: string; financeAccess: boolean; ownCashbox: boolean; cashbox: { id: string; name: string; status: string; balanceKopecks: number } | null };

export function TeamFinanceScreen() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ member: TeamMember; financeAccess: boolean; ownCashbox: boolean } | null>(null);
  async function load() { const response = await fetch("/api/team/finance-access", { cache: "no-store" }); const result = await response.json() as { members?: TeamMember[]; error?: string }; if (!response.ok) throw new Error(result.error); setMembers(result.members ?? []); }
  useEffect(() => {
    let cancelled = false;
    fetch("/api/team/finance-access", { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { members?: TeamMember[]; error?: string };
      if (!response.ok) throw new Error(result.error);
      if (!cancelled) setMembers(result.members ?? []);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось загрузить команду."); });
    return () => { cancelled = true; };
  }, []);
  async function update(member: TeamMember, changes: Partial<Pick<TeamMember, "financeAccess" | "ownCashbox">>, confirmNonZero = false) {
    setError(""); const next = { financeAccess: changes.financeAccess ?? member.financeAccess, ownCashbox: changes.ownCashbox ?? member.ownCashbox };
    const response = await fetch("/api/team/finance-access", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: member.id, ...next, confirmNonZero }) });
    const result = await response.json() as { error?: string; requiresConfirmation?: boolean };
    if (response.status === 409 && result.requiresConfirmation) { setPending({ member, ...next }); setError(result.error ?? "У кассы есть остаток."); return; }
    if (!response.ok) { setError(result.error ?? "Не удалось обновить доступ."); return; }
    setPending(null); await load();
  }
  return <section className="screen-section"><div className="screen-intro"><div><span className="eyebrow">КОМАНДА · ПРАВА</span><h2>Сотрудники</h2><p>Owner отдельно выдаёт доступ к финансам и право иметь одну персональную кассу.</p></div></div>
    {error && <div className="auth-error" role="alert"><i>!</i><span>{error}</span></div>}
    {pending && <div className="panel cashbox-deactivation-warning"><b>Касса имеет ненулевой остаток</b><p>История и операции сохранятся, касса станет неактивной. Рекомендуется сначала урегулировать остаток.</p><div><button onClick={() => setPending(null)}>Отмена</button><button className="primary" onClick={() => update(pending.member, pending, true)}>Всё равно деактивировать</button></div></div>}
    <div className="panel access-table"><div className="access-row access-head"><span>Сотрудник</span><span>Финансы</span><span>Своя касса</span><span>Состояние кассы</span></div>{members.map((member) => <div className="access-row" key={member.id}><span className="access-person"><i>{member.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</i><b>{member.name}<small>{member.role}</small></b></span><label><input type="checkbox" checked={member.financeAccess} disabled={member.role === "OWNER"} onChange={(event) => void update(member, { financeAccess: event.target.checked })} /><span>Доступ к операциям</span></label><label><input type="checkbox" checked={member.ownCashbox} disabled={member.role === "OWNER"} onChange={(event) => void update(member, { ownCashbox: event.target.checked })} /><span>Иметь кассу</span></label><span>{member.cashbox ? <><b>{member.cashbox.name}</b><small className={member.cashbox.balanceKopecks < 0 ? "minus" : ""}>{member.cashbox.status === "ACTIVE" ? "Активна" : "Неактивна"} · {money(member.cashbox.balanceKopecks)}</small></> : <small>Кассы нет</small>}</span></div>)}</div>
  </section>;
}

export function EmployeeObjectsScreen() {
  const [projects, setProjects] = useState<{ id: string; name: string; status: string; client_name?: string }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects", { cache: "no-store" }).then(async (response) => { const result = await response.json() as { items?: { id: string; name: string; status: string; client_name?: string }[]; error?: string }; if (!response.ok) throw new Error(result.error); if (!cancelled) setProjects(result.items ?? []); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось загрузить объекты."); });
    return () => { cancelled = true; };
  }, []);
  return <section className="screen-section"><div className="screen-intro"><div><span className="eyebrow">ОБЪЕКТЫ</span><h2>Разрешённые объекты</h2><p>Список сформирован на сервере по области ASSIGNED / ALL.</p></div></div>{error && <div className="auth-error" role="alert"><i>!</i><span>{error}</span></div>}<div className="project-grid">{projects?.map((project) => <article className="project-card" key={project.id}><div className="project-logo">◇</div><h3>{project.name}</h3><p>{project.client_name ?? "Объект DEPA"} · {project.status}</p></article>)}</div>{projects && projects.length === 0 && <div className="panel finance-empty">В доступной области объектов пока нет.</div>}</section>;
}
