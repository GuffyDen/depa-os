"use client";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FINANCE_CATEGORY_GROUPS, INCOME_PURPOSE_OPTIONS, financeCategoryLabel, financePurposeLabel } from "../lib/finance-categories";
import { createFinanceAttachmentDraft, FINANCE_ATTACHMENT_ACCEPT, uploadFinanceAttachment, type FinanceAttachmentDraft } from "../lib/finance-attachments-client";
import { ClientPaymentInboxForm } from "./client-payment-inbox";

export type FinanceMode = "EXPENSE" | "INCOME" | "TRANSFER" | "REFUND";
type FinanceTransactionType = FinanceMode | "INVESTMENT_REPAYMENT";
type FinanceOperationKind = FinanceTransactionType | "INVESTMENT";
type FinanceTab = "OPERATIONS" | "CASHBOXES" | "INVESTMENTS";

const financeTabSlugs: Record<FinanceTab, string> = { OPERATIONS: "operations", CASHBOXES: "cashboxes", INVESTMENTS: "investments" };
function financeTabFromSlug(value: string | null): FinanceTab {
  if (value === "cashboxes") return "CASHBOXES";
  if (value === "investments") return "INVESTMENTS";
  return "OPERATIONS";
}

type Cashbox = {
  id: string; ownerUserId: string | null; ownerName: string | null; name: string; status: "ACTIVE" | "INACTIVE"; balanceKopecks: number;
  createdAt: number; deactivatedAt: number | null; todayIncomeKopecks: number; todayExpenseKopecks: number; transferredOutKopecks: number; transferredInKopecks: number;
};
type FinanceTransaction = {
  id: string; type: FinanceTransactionType; operationKind: FinanceOperationKind; expenseType: "PROJECT" | "ADMIN" | null; amountKopecks: number; transactionDate: number; cashboxId: string | null; cashboxName: string;
  destinationCashboxId: string | null; destinationCashboxName: string | null; originalTransactionId: string | null; projectId: string | null; projectName: string | null;
  investmentAccountId: string | null; investmentAccountName: string | null; investmentOwnerName: string | null;
  clientId: string | null; category: string; source: string | null; purpose: string | null; title: string; comment: string | null; showToClient: boolean;
  authorUserId: string; authorName: string; createdAt: number; attachmentCount: number; attachmentId: string | null;
  attachments: { id: string; originalFilename: string; mimeType: string; sizeBytes: number; status: "PENDING" | "LINKED" | "FAILED"; createdAt: number }[];
  allocations: { id: string; projectId: string; projectName: string; amountKopecks: number; purpose: string }[];
};
type InvestmentMovement = {
  id: string; type: "CONTRIBUTION" | "REPAYMENT"; amountKopecks: number; transactionDate: number; transactionId: string;
  sourceCashboxId: string | null; sourceCashboxName: string | null; title: string; comment: string | null; category: string;
  expenseType: "PROJECT" | "ADMIN" | null; projectId: string | null; projectName: string | null; authorUserId: string; authorName: string; createdAt: number;
  allocations: { id: string; projectId: string; projectName: string; amountKopecks: number; purpose: string }[];
};
type InvestmentAccount = {
  id: string; ownerUserId: string; ownerName: string; name: string; status: "ACTIVE" | "INACTIVE"; contributedKopecks: number; repaidKopecks: number; outstandingKopecks: number; movements: InvestmentMovement[];
};
export type FinanceData = {
  isOwner: boolean; currentUserId: string; capabilities: { createExpense: boolean; createIncome: boolean; createTransfer: boolean; editTransaction: boolean; viewClientFunds: boolean; viewProfit: boolean; viewAdministrativeExpenses: boolean; viewInvestments: boolean; createInvestmentExpense: boolean; repayInvestments: boolean; cashboxScope: "OWN" | "ALL"; hasOwnActiveCashbox: boolean };
  cashboxes: Cashbox[]; transferRecipients: { id: string; name: string; ownerName: string | null }[]; transactions: FinanceTransaction[]; projects: { id: string; name: string; clientId: string; incomeKopecks: number; expenseKopecks: number; refundKopecks: number; actualExpenseKopecks: number; clientBalanceKopecks: number; materialsIncomeKopecks: number; materialsExpenseKopecks: number; materialsBalanceKopecks: number; worksIncomeKopecks: number; worksExpenseKopecks: number; worksBalanceKopecks: number; additionalWorksIncomeKopecks: number; otherIncomeKopecks: number }[];
  clients: { id: string; name: string }[]; physicalTotalKopecks: number; clientFundsKopecks: number | null; depaProfitKopecks: number | null;
  investmentAccounts: InvestmentAccount[]; investmentOutstandingKopecks: number | null;
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
  if (transaction.operationKind === "INVESTMENT") return `Инвестиция · ${transaction.investmentAccountName ?? "Инвестиционный счёт"}`;
  if (transaction.type === "INVESTMENT_REPAYMENT") return `Возврат инвестиции · ${transaction.cashboxName ?? "Касса"} → ${transaction.investmentAccountName ?? "Инвестиционный счёт"}`;
  if (transaction.type === "TRANSFER") return `Перемещение · ${transaction.cashboxName} → ${transaction.destinationCashboxName}`;
  if (transaction.type === "REFUND") return `Возврат · ${transaction.category}`;
  if (transaction.type === "INCOME") return `Поступление · ${transaction.source || transaction.category}`;
  return `${transaction.expenseType === "ADMIN" ? "Административный" : "Объектный"} расход · ${financeCategoryLabel(transaction.category)}`;
}

function transactionSourceLabel(transaction: FinanceTransaction) {
  if (transaction.type === "INVESTMENT_REPAYMENT") return `${transaction.cashboxName ?? "Касса"} → ${transaction.investmentAccountName ?? "Инвестиционный счёт"}`;
  if (transaction.type === "TRANSFER") return `${transaction.cashboxName ?? "Касса"} → ${transaction.destinationCashboxName ?? "Касса"}`;
  return transaction.investmentAccountName ?? transaction.cashboxName ?? transaction.source ?? "—";
}

function TransactionRow({ transaction, cashboxId, clientName, structured = false, onOpen }: { transaction: FinanceTransaction; cashboxId?: string; clientName?: string; structured?: boolean; onOpen?: () => void }) {
  const incomingTransfer = transaction.type === "TRANSFER" && transaction.destinationCashboxId === cashboxId;
  const positive = transaction.type === "INCOME" || transaction.type === "REFUND" || incomingTransfer;
  const neutral = transaction.type === "TRANSFER" && !cashboxId;
  const amount = neutral ? money(transaction.amountKopecks) : money(positive ? transaction.amountKopecks : -transaction.amountKopecks, true);
  const investment = transaction.operationKind === "INVESTMENT";
  if (structured) {
    const project = transaction.projectName || transaction.allocations.map((item) => item.projectName).join(", ") || "—";
    const source = transactionSourceLabel(transaction);
    return <div className="finance-operation-row">
      <span className="finance-operation-title"><i className={`transaction-icon ${positive || investment ? "plus" : transaction.type === "TRANSFER" || transaction.type === "INVESTMENT_REPAYMENT" ? "transfer" : "minus"}`}>{transaction.type === "TRANSFER" || transaction.type === "INVESTMENT_REPAYMENT" ? "⇄" : investment ? "+" : positive ? "↓" : "↑"}</i><span><b>{transaction.title}</b><small>{transactionLabel(transaction)}</small></span></span>
      <span className="finance-col-client">{clientName || "—"}</span>
      <span className="finance-col-project">{project}</span>
      <span className="finance-col-category">{transaction.type === "INVESTMENT_REPAYMENT" ? "Возврат инвестиции" : financeCategoryLabel(transaction.category)}{transaction.purpose ? <small>{financePurposeLabel(transaction.purpose)}</small> : null}</span>
      <span className="finance-col-source">{source}</span>
      <span className="finance-col-author">{transaction.authorName}</span>
      <span className="finance-col-date">{new Date(transaction.transactionDate * 1000).toLocaleDateString("ru-RU")}</span>
      <span className="finance-col-receipt">{transaction.attachmentCount ? <a href={`/api/files/${transaction.attachmentId}`} target="_blank" rel="noreferrer">{transaction.attachmentCount > 1 ? `${transaction.attachmentCount} файла` : "Чек прикреплён"}</a> : transaction.attachments.some((item) => item.status === "PENDING") ? "Чек загружается…" : transaction.attachments.some((item) => item.status === "FAILED") ? "Ошибка загрузки" : "Без чека"}</span>
      <strong className={positive ? "plus" : neutral ? "" : "minus"}>{amount}</strong>
      {onOpen ? <button type="button" className="finance-row-action" aria-label={`Открыть операцию ${transaction.title}`} onClick={onOpen}>›</button> : <span className="finance-row-action" aria-hidden="true" />}
    </div>;
  }
  return <div className="transaction finance-transaction">
    <span className={`transaction-icon ${positive || investment ? "plus" : transaction.type === "TRANSFER" || transaction.type === "INVESTMENT_REPAYMENT" ? "transfer" : "minus"}`}>{transaction.type === "TRANSFER" || transaction.type === "INVESTMENT_REPAYMENT" ? "⇄" : investment ? "+" : positive ? "↓" : "↑"}</span>
    <div><b>{transaction.title}</b><small>{transactionLabel(transaction)}{transaction.projectName ? ` · ${transaction.projectName}` : ""}{transaction.allocations.length ? ` · ${transaction.allocations.map((item) => `${item.projectName} ${money(item.amountKopecks)}`).join("; ")}` : ""}{transaction.purpose ? ` · ${financePurposeLabel(transaction.purpose)}` : ""}<br />{new Date(transaction.transactionDate * 1000).toLocaleDateString("ru-RU")} · {transaction.authorName}{transaction.attachmentCount ? <> · <a href={`/api/files/${transaction.attachmentId}`} target="_blank" rel="noreferrer">{transaction.attachmentCount > 1 ? `${transaction.attachmentCount} файла` : "чек приложен"}</a></> : transaction.attachments.some((item) => item.status === "PENDING") ? " · чек загружается" : " · без чека"}{onOpen && <> · <button type="button" className="inline-detail" onClick={onOpen}>подробнее</button></>}</small></div>
    <span className="person-pill">{transaction.investmentAccountName ?? transaction.cashboxName}</span><strong className={positive ? "plus" : neutral ? "" : "minus"}>{amount}</strong>
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
      <label><span>Тип</span><select value={typeFilter} onChange={(event) => { setLoading(true); setError(""); setTypeFilter(event.target.value); }}><option value="">Все типы</option><option value="EXPENSE">Расход</option><option value="INCOME">Поступление</option><option value="TRANSFER">Перемещение</option><option value="INVESTMENT_REPAYMENT">Возврат инвестиции</option></select></label>
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
    <div className="cashbox-stats"><div><span>Сегодня поступило</span><b>{money(cashbox.todayIncomeKopecks)}</b></div><div><span>Сегодня потрачено</span><b>{money(cashbox.todayExpenseKopecks)}</b></div><div><span>Передано / возвращено</span><b>{money(cashbox.transferredOutKopecks)}</b></div><div><span>Получено</span><b>{money(cashbox.transferredInKopecks)}</b></div></div>
    <CashboxHistory cashbox={cashbox} projects={projects} isOwner={isOwner} onOpen={onOpen} />
  </article>;
}

function CashboxWorkspace({ data, onOpen }: { data: FinanceData; onOpen: (transaction: FinanceTransaction) => void }) {
  const availableCashboxes = data.cashboxes;
  const ownCashbox = availableCashboxes.find((box) => box.ownerUserId === data.currentUserId && box.status === "ACTIVE");
  const [selectedCashboxId, setSelectedCashboxId] = useState(() => ownCashbox?.id ?? availableCashboxes[0]?.id ?? "");
  const selectedCashbox = availableCashboxes.find((box) => box.id === selectedCashboxId) ?? ownCashbox ?? availableCashboxes[0];
  if (!selectedCashbox) return <div className="panel finance-empty">Касс в доступной области нет.</div>;
  return <div id="finance-cashboxes-panel" className="cashbox-workspace" role="tabpanel" aria-label="Кассы">
    <div className="metrics-grid finance-context-summary cashbox-summary"><div className="metric"><div className="metric-top"><span>ВСЕГО В КАССАХ</span><i>↗</i></div><strong className={data.physicalTotalKopecks < 0 ? "minus" : ""}>{money(data.physicalTotalKopecks)}</strong><small>Фактические деньги в доступной области</small></div>{data.capabilities.viewClientFunds && data.clientFundsKopecks !== null ? <div className="metric"><div className="metric-top"><span>СРЕДСТВА КЛИЕНТОВ</span><i>↗</i></div><strong>{money(data.clientFundsKopecks)}</strong><small>Текущий остаток средств клиентов</small></div> : null}<div className="metric"><div className="metric-top"><span>АКТИВНЫЕ КАССЫ</span><i>↗</i></div><strong>{availableCashboxes.filter((box) => box.status === "ACTIVE").length}</strong><small>из {availableCashboxes.length} касс в доступной области</small></div></div>
    <header className="finance-view-heading"><div><span className="eyebrow">ДЕНЬГИ КОМПАНИИ</span><h3>Кассы</h3></div><p>Выберите кассу, чтобы увидеть баланс и историю движений.</p></header>
    {availableCashboxes.length > 1 && <div className="cashbox-switcher" aria-label="Доступные кассы">{availableCashboxes.map((box) => <button type="button" aria-pressed={box.id === selectedCashbox.id} className={box.id === selectedCashbox.id ? "active" : ""} key={box.id} onClick={() => setSelectedCashboxId(box.id)}><span>{box.name}</span><strong className={box.balanceKopecks < 0 ? "minus" : ""}>{money(box.balanceKopecks)}</strong><small>{box.status === "ACTIVE" ? "Активна" : "Неактивна"}</small></button>)}</div>}
    <SelectedCashboxCard key={selectedCashbox.id} cashbox={selectedCashbox} projects={data.projects} isOwner={data.isOwner} onOpen={onOpen} />
  </div>;
}

function InvestmentWorkspace({ data, onOpen }: { data: FinanceData; onOpen: (transaction: FinanceTransaction) => void }) {
  const [selectedId, setSelectedId] = useState("");
  const selected = data.investmentAccounts.find((account) => account.id === selectedId) ?? null;
  const contributed = data.investmentAccounts.reduce((sum, account) => sum + account.contributedKopecks, 0);
  const repaid = data.investmentAccounts.reduce((sum, account) => sum + account.repaidKopecks, 0);
  const outstanding = data.investmentAccounts.reduce((sum, account) => sum + account.outstandingKopecks, 0);
  const transactionsById = useMemo(() => new Map(data.transactions.map((transaction) => [transaction.id, transaction])), [data.transactions]);
  return <div id="finance-investments-panel" className="investment-workspace" role="tabpanel" aria-label="Инвестиции">
    <div className="investment-summary" aria-label="Общая инвестиционная сводка"><span>Всего вложено<b>{money(contributed)}</b></span><span>Всего возвращено<b>{money(repaid)}</b></span><span>К возврату партнёрам<strong>{money(outstanding)}</strong></span></div>
    <header className="finance-view-heading"><div><span className="eyebrow">ВЗАИМОРАСЧЁТЫ С ПАРТНЁРАМИ</span><h3>Инвестиции</h3></div><p>Нажмите на счёт, чтобы открыть его историю.</p></header>
    {data.investmentAccounts.length ? <div className="investment-account-grid">{data.investmentAccounts.map((account) => <button type="button" className={`panel investment-account-card ${account.id === selectedId ? "active" : ""}`} aria-expanded={account.id === selectedId} aria-controls="investment-detail" key={account.id} onClick={() => setSelectedId((current) => current === account.id ? "" : account.id)}>
      <span className="eyebrow">ИНВЕСТИЦИОННЫЙ СЧЁТ</span><h3>{account.name}</h3>
      <div><span>Вложено<b>{money(account.contributedKopecks)}</b></span><span>Возвращено<b>{money(account.repaidKopecks)}</b></span></div>
      <footer><span>К возврату</span><strong>{money(account.outstandingKopecks)}</strong><em>{account.id === selectedId ? "Скрыть историю ↑" : "Открыть историю ↓"}</em></footer>
    </button>)}</div> : <div className="panel finance-empty">Инвестиционных счетов пока нет.</div>}
    {selected ? <section id="investment-detail" className="panel investment-detail" aria-labelledby="investment-detail-title"><header><div><span className="eyebrow">ИСТОРИЯ ИНВЕСТИЦИИ</span><h3 id="investment-detail-title">{selected.name}</h3></div><button type="button" className="link" onClick={() => setSelectedId("")}>Закрыть</button></header>
      <div className="investment-history-head" aria-hidden="true"><span>Дата</span><span>Тип</span><span>Описание</span><span>Связанный расход</span><span>Источник возврата</span><span>Сумма</span></div>
      {selected.movements.length ? <div className="investment-history">{selected.movements.map((movement) => {
        const transaction = transactionsById.get(movement.transactionId);
        const projects = movement.projectName || movement.allocations.map((item) => item.projectName).join(", ");
        const description = movement.comment || projects || (movement.type === "CONTRIBUTION" ? financeCategoryLabel(movement.category) : "Возврат инвестору");
        return <div className="investment-movement" key={movement.id}><span>{new Date(movement.transactionDate * 1000).toLocaleDateString("ru-RU")}</span><b>{movement.type === "CONTRIBUTION" ? "Вложение" : "Возврат"}</b><span>{description}</span><span>{movement.type === "CONTRIBUTION" ? <>{movement.title}{transaction && data.capabilities.editTransaction ? <button type="button" className="inline-detail" onClick={() => onOpen(transaction)}>Открыть</button> : null}</> : "—"}</span><span>{movement.type === "REPAYMENT" ? movement.sourceCashboxName ?? "Касса" : "Личные средства"}</span><strong className={movement.type === "CONTRIBUTION" ? "plus" : "minus"}>{money(movement.type === "CONTRIBUTION" ? movement.amountKopecks : -movement.amountKopecks, true)}</strong></div>;
      })}</div> : <div className="finance-empty">Движений по инвестиции пока нет.</div>}
    </section> : null}
  </div>;
}

export function FinanceScreen({ onNew }: { onNew: (mode: FinanceMode) => void }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<FinanceTab>("OPERATIONS");
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
  async function refresh() { try { setError(""); const next = await readFinance(); setData(next); return next; } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить финансы."); return null; } }
  useEffect(() => {
    let cancelled = false;
    readFinance().then((result) => { if (!cancelled) setData(result); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось загрузить финансы."); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const syncTabFromUrl = () => setTab(financeTabFromSlug(new URLSearchParams(window.location.search).get("tab")));
    syncTabFromUrl();
    window.addEventListener("popstate", syncTabFromUrl);
    return () => window.removeEventListener("popstate", syncTabFromUrl);
  }, []);
  const selectTab = useCallback((nextTab: FinanceTab) => {
    setTab(nextTab);
    const url = new URL(window.location.href);
    url.pathname = "/dashboard";
    url.searchParams.set("section", "finance");
    url.searchParams.set("tab", financeTabSlugs[nextTab]);
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  const filteredTransactions = (data?.transactions ?? []).filter((item) => {
    const haystack = `${item.title} ${item.comment ?? ""} ${item.projectName ?? ""} ${item.authorName} ${item.source ?? ""} ${item.allocations.map((allocation) => allocation.projectName).join(" ")}`.toLocaleLowerCase("ru-RU");
    const day = new Date(item.transactionDate * 1000).toISOString().slice(0, 10);
    return (!query || haystack.includes(query.toLocaleLowerCase("ru-RU")))
      && (!typeFilter || item.operationKind === typeFilter)
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
  const canCreateExpense = data?.capabilities.createExpense && (canWrite || Boolean(data.capabilities.createInvestmentExpense && data.investmentAccounts.length));
  const canTransfer = data?.capabilities.createTransfer && canWrite && Boolean(data.transferRecipients.length || data.capabilities.repayInvestments && data.investmentAccounts.some((account) => account.outstandingKopecks > 0));
  const activeTab: FinanceTab = data && tab === "INVESTMENTS" && !data.capabilities.viewInvestments ? "OPERATIONS" : tab;
  const showIncomeAction = activeTab !== "INVESTMENTS" && data?.capabilities.createIncome && canWrite;
  const showExpenseAction = activeTab !== "INVESTMENTS" ? canCreateExpense : Boolean(data?.capabilities.createInvestmentExpense && data.investmentAccounts.length);
  const showTransferAction = activeTab !== "INVESTMENTS" ? canTransfer : Boolean(data?.capabilities.repayInvestments && canWrite && data.investmentAccounts.some((account) => account.outstandingKopecks > 0));
  return <section className="screen-section finance-screen"><div className="screen-intro finance-intro"><div><span className="eyebrow">ЕДИНЫЙ УЧЁТ</span><h2>Финансы</h2><p>Кассы — реальные деньги компании. Инвестиции — взаиморасчёты с партнёрами.</p></div><div className="finance-actions">{showIncomeAction ? <button className="secondary" onClick={() => onNew("INCOME")}>＋ Поступление</button> : null}{showExpenseAction ? <button className="secondary" onClick={() => onNew("EXPENSE")}>{activeTab === "INVESTMENTS" ? "− Личный расход" : "− Расход"}</button> : null}{showTransferAction ? <button className="primary" onClick={() => onNew("TRANSFER")}>{activeTab === "INVESTMENTS" ? "⇄ Вернуть инвестицию" : "⇄ Перевести"}</button> : null}</div></div>
    <div className="segmented finance-tabs" role="tablist" aria-label="Разделы финансов"><button role="tab" aria-controls="finance-operations-panel" aria-selected={activeTab === "OPERATIONS"} className={activeTab === "OPERATIONS" ? "active" : ""} onClick={() => selectTab("OPERATIONS")}>Операции</button><button role="tab" aria-controls="finance-cashboxes-panel" aria-selected={activeTab === "CASHBOXES"} className={activeTab === "CASHBOXES" ? "active" : ""} onClick={() => selectTab("CASHBOXES")}>Кассы</button>{data?.capabilities.viewInvestments ? <button role="tab" aria-controls="finance-investments-panel" aria-selected={activeTab === "INVESTMENTS"} className={activeTab === "INVESTMENTS" ? "active" : ""} onClick={() => selectTab("INVESTMENTS")}>Инвестиции</button> : null}</div>
    {error && <div className="auth-error" role="alert"><i>!</i><span>{error}</span><button onClick={refresh}>Повторить</button></div>}
    {!data && !error && <div className="panel finance-loading">Загружаем финансовые данные…</div>}
    {data && (activeTab === "OPERATIONS" ? <div id="finance-operations-panel" className="finance-view" role="tabpanel" aria-label="Операции">
      <ClientPaymentInboxForm cashboxes={data.cashboxes} onChanged={refresh}/>
      <div className="metrics-grid finance-metrics finance-summary"><div className="metric"><div className="metric-top"><span>{data.capabilities.cashboxScope === "OWN" ? "МОЯ КАССА" : "ФИЗИЧЕСКИ В КАССАХ"}</span><i>↗</i></div><strong className={data.physicalTotalKopecks < 0 ? "minus" : ""}>{money(data.physicalTotalKopecks)}</strong><small>{data.cashboxes.filter((box) => box.status === "ACTIVE").length} активные кассы в доступной области</small></div>{data.capabilities.viewInvestments && data.investmentOutstandingKopecks !== null ? <div className="metric"><div className="metric-top"><span>ИНВЕСТИЦИИ · К ВОЗВРАТУ</span><i className="orange">↗</i></div><strong>{money(data.investmentOutstandingKopecks)}</strong><small>{data.investmentAccounts.map((account) => `${account.ownerName.split(" ")[0]}: ${money(account.outstandingKopecks)}`).join(" · ")}</small></div> : null}{data.capabilities.viewClientFunds && data.clientFundsKopecks !== null ? <div className="metric"><div className="metric-top"><span>СРЕДСТВА КЛИЕНТОВ</span><i>↗</i></div><strong>{money(data.clientFundsKopecks)}</strong><small>Текущий остаток клиентских средств</small></div> : null}{data.capabilities.viewProfit && data.depaProfitKopecks !== null ? <div className="metric"><div className="metric-top"><span>ПРИБЫЛЬ DEPA</span><i>↗</i></div><strong>{money(data.depaProfitKopecks)}</strong><small>Управленческий показатель</small></div> : null}</div>
      {data.attentionItems.length > 0 && <div className="panel finance-attention"><div className="table-toolbar"><strong>Требует внимания</strong><small>{data.attentionItems.length}</small></div>{data.attentionItems.slice(0, 8).map((item, index) => <div className="finance-attention-row" key={`${item.type}-${item.transactionId ?? item.projectId ?? item.cashboxId ?? index}`}><i>!</i><span><b>{item.title}</b><small>{item.detail}</small></span></div>)}</div>}
      <div className="panel table-panel"><div className="table-toolbar"><strong>Все операции</strong><small>{filteredTransactions.length} из {data.transactions.length}</small></div><div className="finance-filter-bar"><input aria-label="Поиск операций" placeholder="Комментарий, клиент, объект" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Тип" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">Все типы</option><option value="INCOME">Доход</option><option value="EXPENSE">Расход</option><option value="TRANSFER">Перевод</option><option value="INVESTMENT">Инвестиция</option><option value="INVESTMENT_REPAYMENT">Возврат инвестиции</option></select><select aria-label="Касса" value={cashboxFilter} onChange={(event) => setCashboxFilter(event.target.value)}><option value="">Все кассы</option>{data.cashboxes.map((box) => <option value={box.id} key={box.id}>{box.name}</option>)}</select><select aria-label="Категория" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Все категории</option>{categoryOptions.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select><select aria-label="Объект" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="">Все объекты</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><select aria-label="Автор" value={authorFilter} onChange={(event) => setAuthorFilter(event.target.value)}><option value="">Все авторы</option>{authors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select aria-label="Чек" value={receiptFilter} onChange={(event) => setReceiptFilter(event.target.value)}><option value="">Чек: любой</option><option value="YES">Есть чек</option><option value="NO">Нет чека</option></select><input aria-label="Дата от" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /><input aria-label="Дата до" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div>{filteredTransactions.length ? <div className="finance-operation-table"><div className="finance-operation-row head"><span>Операция</span><span className="finance-col-client">Клиент</span><span className="finance-col-project">Объект</span><span className="finance-col-category">Категория</span><span className="finance-col-source">Касса / источник</span><span className="finance-col-author">Автор</span><span className="finance-col-date">Дата</span><span className="finance-col-receipt">Документ</span><span>Сумма</span><span aria-hidden="true" /></div>{filteredTransactions.map((item) => <TransactionRow key={item.id} transaction={item} structured clientName={data.clients.find((client) => client.id === item.clientId)?.name} onOpen={() => setSelectedTransaction(item)} />)}</div> : <div className="finance-empty">По выбранным фильтрам операций нет.</div>}</div>
    </div> : activeTab === "CASHBOXES" ? <CashboxWorkspace data={data} onOpen={data.capabilities.editTransaction ? setSelectedTransaction : () => undefined} /> : <InvestmentWorkspace data={data} onOpen={setSelectedTransaction} />)}
    {selectedTransaction && <TransactionDetailModal key={`${selectedTransaction.id}-${selectedTransaction.attachments.map((item) => `${item.id}:${item.status}`).join(",")}`} transaction={selectedTransaction} canEdit={data?.capabilities.editTransaction === true} onClose={() => setSelectedTransaction(null)} onSaved={async () => { setSelectedTransaction(null); await refresh(); }} onAttachmentsChanged={async () => { const next = await refresh(); setSelectedTransaction(next?.transactions.find((item) => item.id === selectedTransaction.id) ?? null); }} />}
  </section>;
}

function fileSize(value: number) {
  if (!value) return "—";
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} МБ` : `${Math.ceil(value / 1024)} КБ`;
}

function TransactionDetailModal({ transaction, canEdit, onClose, onSaved, onAttachmentsChanged }: { transaction: FinanceTransaction; canEdit: boolean; onClose: () => void; onSaved: () => void; onAttachmentsChanged: () => void }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState("");
  const [attachments, setAttachments] = useState(transaction.attachments);

  async function addAttachments(files: File[]) {
    if (!files.length || uploading) return;
    setError(""); setUploadNotice("");
    let pairs: { file: File; draft: FinanceAttachmentDraft }[];
    try { pairs = files.map((file) => ({ file, draft: createFinanceAttachmentDraft(file) })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Файл не прошёл проверку."); return; }
    setUploading(true);
    try {
      const slotResponse = await fetch("/api/finance/attachments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transactionId: transaction.id, attachments: pairs.map((item) => item.draft) }) });
      const slotResult = await slotResponse.json() as { error?: string };
      if (!slotResponse.ok) throw new Error(slotResult.error ?? "Не удалось подготовить вложения.");
      setAttachments((current) => [...current, ...pairs.map(({ draft }) => ({ id: draft.attachmentId, originalFilename: draft.originalFilename, mimeType: draft.mimeType, sizeBytes: 0, status: "PENDING" as const, createdAt: Math.floor(Date.now() / 1000) }))]);
      setUploadNotice(`Подготавливаем ${pairs.length === 1 ? "фото" : `${pairs.length} файла`}…`);
      const results = await Promise.allSettled(pairs.map(({ file, draft }) => uploadFinanceAttachment({
        file, draft, transactionId: transaction.id, projectId: transaction.projectId,
        onPhase: (phase) => {
          if (phase === "uploading") setUploadNotice(`Загружаем ${pairs.length === 1 ? "1 файл" : `${pairs.length} файла`}…`);
          if (phase === "ready" || phase === "failed") setAttachments((current) => current.map((item) => item.id === draft.attachmentId ? { ...item, status: phase === "ready" ? "LINKED" : "FAILED" } : item));
        },
      })));
      const failed = results.filter((result) => result.status === "rejected").length;
      setUploadNotice(failed ? `Операция не изменилась. Не удалось загрузить ${failed} ${failed === 1 ? "файл" : "файла"}.` : "Все файлы прикреплены.");
      onAttachmentsChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить вложения.");
    } finally { setUploading(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canEdit) return; setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/finance", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: transaction.id, title: form.get("title"), comment: form.get("comment"), showToClient: form.get("showToClient") === "on" }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? "Не удалось обновить операцию."); setLoading(false); return; }
    onSaved();
  }
  return <div className="modal-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget && !uploading) onClose(); }}><section className="modal finance-detail-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-detail-title"><div className="modal-head"><div><span className="eyebrow">ФИНАНСОВАЯ ОПЕРАЦИЯ</span><h3 id="transaction-detail-title">{transactionLabel(transaction)}</h3></div><button onClick={onClose} aria-label="Закрыть">×</button></div><div className="transaction-facts"><span>Сумма <b>{money(transaction.amountKopecks)}</b></span><span>Дата <b>{new Date(transaction.transactionDate * 1000).toLocaleDateString("ru-RU")}</b></span><span>Источник <b>{transactionSourceLabel(transaction)}</b></span><span>Автор <b>{transaction.authorName}</b></span></div>{transaction.allocations.length > 0 && <div className="detail-allocations">{transaction.allocations.map((item) => <span key={item.id}>{item.projectName}<b>{money(item.amountKopecks)}</b></span>)}</div>}
    <section className="finance-attachments"><header><div><span className="eyebrow">ДОКУМЕНТЫ / ВЛОЖЕНИЯ</span><b>{attachments.filter((item) => item.status === "LINKED").length} прикреплено</b></div><label className="secondary finance-attachment-add"><input type="file" multiple accept={FINANCE_ATTACHMENT_ACCEPT} disabled={uploading} onChange={(event) => { void addAttachments(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />{uploading ? "Загружаем…" : "＋ Добавить чек / фото"}</label></header>
      <div className="finance-attachment-list">{attachments.length ? attachments.map((attachment) => <article key={attachment.id}><i>{attachment.mimeType === "application/pdf" ? "PDF" : "IMG"}</i><span><b>{attachment.originalFilename}</b><small>{attachment.status === "PENDING" ? "Чек загружается…" : attachment.status === "FAILED" ? "Не удалось загрузить файл" : `Чек прикреплён · ${fileSize(attachment.sizeBytes)}`}</small></span>{attachment.status === "LINKED" ? <a href={`/api/files/${attachment.id}`} target="_blank" rel="noreferrer">Открыть</a> : attachment.status === "FAILED" ? <label className="link finance-attachment-retry"><input type="file" accept={FINANCE_ATTACHMENT_ACCEPT} disabled={uploading} onChange={(event) => { void addAttachments(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />Повторить</label> : <em>Загрузка…</em>}</article>) : <p>Файлов пока нет. Операция сохранена без чека.</p>}</div>
      {uploadNotice && <div className={uploadNotice.includes("Не удалось") ? "auth-error" : "auth-success"} role="status"><i>{uploadNotice.includes("Не удалось") ? "!" : "✓"}</i><span>{uploadNotice}</span></div>}
    </section>
    <form onSubmit={submit}><label><span>Название</span><input name="title" defaultValue={transaction.title} required disabled={!canEdit} /></label><label><span>Комментарий</span><textarea name="comment" defaultValue={transaction.comment ?? ""} disabled={!canEdit} /></label>{transaction.expenseType === "PROJECT" && <label className="toggle-row"><span><b>Показывать клиенту</b><small>Изменение будет записано в audit log</small></span><input name="showToClient" type="checkbox" defaultChecked={transaction.showToClient} disabled={!canEdit} /></label>}<div className="immutable-note">Добавление файлов не изменяет сумму, источник, категорию, объект или балансы.</div>{error && <div className="auth-error" role="alert"><i>!</i><span>{error}</span></div>}<div className="modal-actions"><button type="button" onClick={onClose}>Закрыть</button>{canEdit && <button className="primary" type="submit" disabled={loading}>{loading ? "Сохраняем…" : "Сохранить изменения"}</button>}</div></form></section></div>;
}

export function OperationPickerModal({ onClose, onSelect, allowed }: { onClose: () => void; onSelect: (mode: FinanceMode) => void; allowed: Partial<Record<FinanceMode, boolean>> }) {
  return <div className="modal-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal operation-picker" role="dialog" aria-modal="true" aria-labelledby="operation-picker-title"><div className="modal-head"><div><h3 id="operation-picker-title">Добавить операцию</h3></div><button onClick={onClose} aria-label="Закрыть">×</button></div><div className="operation-options">
    {allowed.EXPENSE ? <button onClick={() => onSelect("EXPENSE")}><i>−</i><span><b>Расход</b><small>Из кассы или за счёт личных средств</small></span><em>→</em></button> : null}
    {allowed.INCOME ? <button onClick={() => onSelect("INCOME")}><i>＋</i><span><b>Поступление</b><small>Только в собственную кассу</small></span><em>→</em></button> : null}
    {allowed.TRANSFER ? <button onClick={() => onSelect("TRANSFER")}><i>⇄</i><span><b>Перевод</b><small>В другую кассу или в счёт возврата инвестиции</small></span><em>→</em></button> : null}
  </div></section></div>;
}

export function FinanceOperationModal({ mode, onClose, onSaved, initialProjectId = "", initialClientId = "",initialOrderId="",initialOrderNumber="",initialAmount="",initialTitle="" }: { mode: FinanceMode; onClose: () => void; onSaved: () => void; initialProjectId?: string; initialClientId?: string;initialOrderId?:string;initialOrderNumber?:string;initialAmount?:string;initialTitle?:string }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [expenseType, setExpenseType] = useState<"PROJECT" | "ADMIN">("PROJECT");
  const [amount, setAmount] = useState(initialAmount);
  const [cashboxId, setCashboxId] = useState("");
  const [destinationCashboxId, setDestinationCashboxId] = useState("");
  const [paymentSource, setPaymentSource] = useState<"CASHBOX" | "INVESTMENT">("CASHBOX");
  const [destinationType, setDestinationType] = useState<"CASHBOX" | "INVESTMENT">("CASHBOX");
  const [investmentAccountId, setInvestmentAccountId] = useState("");
  const [projectId, setProjectId] = useState(initialProjectId);
  const [clientId, setClientId] = useState(initialClientId);
  const [originalTransactionId, setOriginalTransactionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedAttachments, setSelectedAttachments] = useState<{ file: File; draft: FinanceAttachmentDraft }[]>([]);
  const [uploadStatus, setUploadStatus] = useState("");
  const idempotencyKeyRef = useRef("");
  const submittingRef = useRef(false);
  const [splitAcrossProjects, setSplitAcrossProjects] = useState(false);
  const [allocations, setAllocations] = useState([{ projectId: initialProjectId, amount: "" }, { projectId: "", amount: "" }]);
  const [category, setCategory] = useState("MATERIALS");
  useEffect(() => { readFinance().then((result) => { setData(result); const own = result.cashboxes.find((box) => box.ownerUserId === result.currentUserId && box.status === "ACTIVE"); setCashboxId(own?.id ?? result.cashboxes.find((box) => box.status === "ACTIVE")?.id ?? ""); setDestinationCashboxId(result.transferRecipients[0]?.id ?? ""); setInvestmentAccountId(result.investmentAccounts.find((account) => account.status === "ACTIVE")?.id ?? ""); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить финансовые источники.")); }, []);
  const activeCashboxes = data?.cashboxes.filter((box) => box.status === "ACTIVE") ?? [];
  const selectedCashbox = activeCashboxes.find((box) => box.id === cashboxId);
  const destinationCashbox = activeCashboxes.find((box) => box.id === destinationCashboxId);
  const selectedInvestmentAccount = data?.investmentAccounts.find((account) => account.id === investmentAccountId);
  const amountKopecks = amountToKopecks(amount);
  const cashboxAffected = !(mode === "EXPENSE" && paymentSource === "INVESTMENT");
  const sourceAfter = selectedCashbox ? selectedCashbox.balanceKopecks + (cashboxAffected && (mode === "EXPENSE" || mode === "TRANSFER") ? -amountKopecks : mode === "INCOME" || mode === "REFUND" ? amountKopecks : 0) : 0;
  const destinationAfter = destinationCashbox ? destinationCashbox.balanceKopecks + amountKopecks : 0;
  const investmentAfter = selectedInvestmentAccount ? selectedInvestmentAccount.outstandingKopecks + (mode === "EXPENSE" && paymentSource === "INVESTMENT" ? amountKopecks : mode === "TRANSFER" && destinationType === "INVESTMENT" ? -amountKopecks : 0) : 0;
  const repaymentOverBalance = mode === "TRANSFER" && destinationType === "INVESTMENT" && Boolean(selectedInvestmentAccount && amountKopecks > selectedInvestmentAccount.outstandingKopecks);
  const selectedOriginal = data?.transactions.find((item) => item.id === originalTransactionId);
  const categories = expenseType === "PROJECT" ? projectCategories : adminCategories;
  const allocationTotalKopecks = allocations.reduce((sum, item) => sum + amountToKopecks(item.amount), 0);
  const allocationRemainingKopecks = amountKopecks - allocationTotalKopecks;
  const selectedProject = data?.projects.find((item) => item.id === projectId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true; setError(""); setLoading(true); setUploadStatus("");
    const form = new FormData(event.currentTarget);
    try {
      const receiptProjectId = mode === "TRANSFER" || splitAcrossProjects || mode === "EXPENSE" && expenseType === "ADMIN" ? null : projectId || null;
      const effectiveCashboxId = mode === "REFUND" && selectedOriginal ? selectedOriginal.cashboxId : cashboxId;
      if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
      const transactionStartedAt = performance.now();
      const response = await fetch("/api/finance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        type: mode, amount, date: form.get("date"), cashboxId: effectiveCashboxId, destinationCashboxId, expenseType, paymentSource, destinationType, investmentAccountId,
        category: form.get("category"), projectId: expenseType === "PROJECT" || mode !== "EXPENSE" ? projectId || null : null,
        clientId: clientId || null,orderId:initialOrderId||null, purpose: form.get("purpose"), source: form.get("source"), title: form.get("title"), comment: form.get("comment"),
        showToClient: expenseType === "PROJECT" && form.get("showToClient") === "on", originalTransactionId: originalTransactionId || null,
        allocations: mode === "EXPENSE" && expenseType === "PROJECT" && splitAcrossProjects ? allocations : [],
        idempotencyKey: idempotencyKeyRef.current, attachments: selectedAttachments.map((item) => item.draft),
      }) });
      const result = await response.json() as { error?: string; operation?: { id: string; warning?: string | null; idempotent?: boolean } };
      if (!response.ok) throw new Error(result.error ?? "Не удалось провести операцию.");
      if (!result.operation?.id) throw new Error("Сервер не вернул идентификатор операции.");
      console.info("FINANCE_TRANSACTION_CREATE_SUCCESS", { transactionId: result.operation.id, durationMs: Math.round(performance.now() - transactionStartedAt), idempotent: Boolean(result.operation.idempotent), attachmentCount: selectedAttachments.length });
      setSuccess(result.operation.warning ? `Операция создана. ${result.operation.warning}` : "Операция создана и записана в историю.");
      onSaved();
      if (!selectedAttachments.length) { setTimeout(onClose, 1200); return; }
      setUploadStatus(`Подготавливаем ${selectedAttachments.length === 1 ? "фото" : `${selectedAttachments.length} файла`}…`);
      const results = await Promise.allSettled(selectedAttachments.map(({ file, draft }) => uploadFinanceAttachment({ file, draft, transactionId: result.operation!.id, projectId: receiptProjectId, onPhase: (phase) => { if (phase === "uploading") setUploadStatus(`Операция создана. Загружаем ${selectedAttachments.length} ${selectedAttachments.length === 1 ? "файл" : "файла"}…`); } })));
      const failed = results.filter((item) => item.status === "rejected").length;
      setUploadStatus(failed ? `Расход создан. Не удалось загрузить ${failed} ${failed === 1 ? "файл" : "файла"}. Откройте операцию, чтобы повторить.` : "Операция создана. Все файлы прикреплены.");
      onSaved(); setTimeout(onClose, failed ? 2800 : 1400);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось провести операцию."); setLoading(false); submittingRef.current = false; }
  }

  return <div className="modal-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onClose(); }}><section className="modal finance-modal" role="dialog" aria-modal="true" aria-labelledby="finance-modal-title"><div className="modal-head"><div><span className="eyebrow">ФИНАНСЫ</span><h3 id="finance-modal-title">{modeLabels[mode]}</h3></div><button onClick={onClose} aria-label="Закрыть">×</button></div>
    {success ? <div className="success"><i>✓</i><h3>Готово</h3><p>{success}</p></div> : <form onSubmit={submit}>
      {mode === "EXPENSE" && <><fieldset className="expense-type"><legend>Тип расхода</legend><button type="button" className={expenseType === "PROJECT" ? "active" : ""} onClick={() => { setExpenseType("PROJECT"); setCategory("MATERIALS"); }}><b>Объектный расход</b><small>Связан с конкретным объектом</small></button>{data?.capabilities.viewAdministrativeExpenses ? <button type="button" className={expenseType === "ADMIN" ? "active" : ""} onClick={() => { setExpenseType("ADMIN"); setCategory("ADVERTISING"); setSplitAcrossProjects(false); }}><b>Административный расход</b><small>Без объекта и клиентского показа</small></button> : null}</fieldset>{data?.capabilities.createInvestmentExpense ? <fieldset className="expense-type funding-source"><legend>Источник оплаты</legend><button type="button" className={paymentSource === "CASHBOX" ? "active" : ""} onClick={() => setPaymentSource("CASHBOX")}><b>Касса</b><small>Уменьшает реальные деньги компании</small></button><button type="button" className={paymentSource === "INVESTMENT" ? "active" : ""} onClick={() => setPaymentSource("INVESTMENT")}><b>Личные средства / Инвестиция</b><small>Касса не изменится</small></button></fieldset> : null}</>}
      {mode === "TRANSFER" && data?.capabilities.repayInvestments ? <fieldset className="expense-type funding-source"><legend>Куда перевести</legend><button type="button" className={destinationType === "CASHBOX" ? "active" : ""} onClick={() => setDestinationType("CASHBOX")}><b>Другая касса</b><small>Обычное перемещение денег</small></button><button type="button" className={destinationType === "INVESTMENT" ? "active" : ""} onClick={() => setDestinationType("INVESTMENT")}><b>Инвестиционный счёт</b><small>Погашение личных вложений</small></button></fieldset> : null}
      <div className="form-grid">{initialOrderId?<label className="wide"><span>Заказ</span><input value={initialOrderNumber||initialOrderId} readOnly/></label>:null}<label><span>Сумма</span><div className="amount-input"><input required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="100 000" /><b>₽</b></div></label><label><span>Дата</span><input name="date" type="date" defaultValue={localDate()} required /></label>
        {mode === "TRANSFER" ? <>{data?.isOwner && destinationType === "INVESTMENT" ? <label><span>Откуда</span><select value={cashboxId} onChange={(event) => setCashboxId(event.target.value)} required><option value="">Выберите кассу</option>{activeCashboxes.map((box) => <option value={box.id} key={box.id}>{box.name} · {money(box.balanceKopecks)}</option>)}</select></label> : <label><span>Откуда</span><input value={selectedCashbox ? `${selectedCashbox.ownerName ?? ""} · ${selectedCashbox.name}` : "Собственная касса недоступна"} readOnly /></label>}{destinationType === "INVESTMENT" ? <label><span>Куда</span><select value={investmentAccountId} onChange={(event) => setInvestmentAccountId(event.target.value)} required><option value="">Выберите инвестицию</option>{data?.investmentAccounts.filter((account) => account.status === "ACTIVE").map((account) => <option key={account.id} value={account.id}>{account.name} · к возврату {money(account.outstandingKopecks)}</option>)}</select></label> : <label><span>Куда</span><select value={destinationCashboxId} onChange={(event) => setDestinationCashboxId(event.target.value)} required><option value="">Выберите кассу</option>{data?.transferRecipients.map((box) => <option key={box.id} value={box.id}>{box.ownerName ?? box.name} · {box.name}</option>)}</select></label>}</> : mode === "REFUND" ? <label className="wide"><span>Исходный расход</span><select value={originalTransactionId} onChange={(event) => { const id = event.target.value; setOriginalTransactionId(id); const original = data?.transactions.find((item) => item.id === id); if (original?.cashboxId) { setCashboxId(original.cashboxId); setProjectId(original.projectId ?? ""); } }}><option value="">Без связи с исходной операцией</option>{data?.transactions.filter((item) => item.type === "EXPENSE" && item.cashboxId).map((item) => <option key={item.id} value={item.id}>{item.title} · {money(item.amountKopecks)} · {item.cashboxName}</option>)}</select></label> : mode === "EXPENSE" && paymentSource === "INVESTMENT" ? <label><span>Инвестиционный счёт</span><select value={investmentAccountId} onChange={(event) => setInvestmentAccountId(event.target.value)} required><option value="">Выберите инвестицию</option>{data?.investmentAccounts.filter((account) => account.status === "ACTIVE").map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.outstandingKopecks)}</option>)}</select></label> : <label><span>{mode === "INCOME" ? "Касса-получатель" : "Касса"}</span><input value={selectedCashbox ? `${selectedCashbox.ownerName ?? ""} · ${selectedCashbox.name} · ${money(selectedCashbox.balanceKopecks)}` : "Собственная касса недоступна"} readOnly /></label>}
        {mode === "EXPENSE" && <><label><span>Категория</span><select name="category" key={expenseType} value={category} onChange={(event) => setCategory(event.target.value)} required>{categories.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>{expenseType === "PROJECT" && !splitAcrossProjects && <label className="wide"><span>Объект</span><select value={projectId} onChange={(event) => { setProjectId(event.target.value); const project = data?.projects.find((item) => item.id === event.target.value); setClientId(project?.clientId ?? ""); }} required><option value="">Выберите объект</option>{data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>{data?.projects.length === 0 && <small>Нет доступных объектов. Создайте объект в разделе «Объекты».</small>}</label>}</>}
        {mode === "INCOME" && <><label><span>Источник</span><input name="source" required placeholder="Клиент, банк, другое" /></label><label><span>Клиент</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Не связан</option>{data?.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label><span>Объект</span><select value={projectId} onChange={(event) => { setProjectId(event.target.value); const project = data?.projects.find((item) => item.id === event.target.value); if (project) setClientId(project.clientId); }}><option value="">Не связан</option>{data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>{data?.projects.length === 0 && <small>Нет доступных объектов. Создайте объект в разделе «Объекты».</small>}</label><label><span>Назначение</span><select name="purpose" required={Boolean(projectId || clientId)}><option value="">Выберите</option>{INCOME_PURPOSE_OPTIONS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label></>}
        {mode === "REFUND" && !selectedOriginal && <><label><span>Касса</span><select value={cashboxId} onChange={(event) => setCashboxId(event.target.value)} required><option value="">Выберите кассу</option>{activeCashboxes.map((box) => <option key={box.id} value={box.id}>{box.name}</option>)}</select></label><label><span>Категория</span><input name="category" required placeholder="Материалы" /></label><label className="wide"><span>Объект</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Не связан</option>{data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></>}
        {mode !== "TRANSFER" && <label className="wide"><span>{mode === "INCOME" ? "Назначение / название" : "Название"}</span><input name="title" defaultValue={initialTitle} placeholder={mode === "REFUND" ? "Возврат материалов" : mode === "EXPENSE" ? "Что оплачено" : "Оплата по договору"} /></label>}
        <label className="wide"><span>Комментарий</span><textarea name="comment" placeholder={mode === "TRANSFER" ? "Передал на закупки" : "Необязательно"} /></label>
      </div>
      {mode === "EXPENSE" && expenseType === "PROJECT" && <><label className="toggle-row"><span><b>Распределить между несколькими объектами</b><small>Один исходный чек останется у общей операции</small></span><input type="checkbox" checked={splitAcrossProjects} disabled={(data?.projects.length ?? 0) < 2} onChange={(event) => { setSplitAcrossProjects(event.target.checked); if (event.target.checked) { setAllocations([{ projectId: projectId || initialProjectId, amount }, { projectId: "", amount: "" }]); setProjectId(""); setClientId(""); } }} /></label>{splitAcrossProjects && <div className="allocation-editor"><div className="table-toolbar"><strong>Распределение</strong><small>Общая сумма: {money(amountKopecks)}</small></div>{allocations.map((allocation, index) => <div className="allocation-row" key={index}><select aria-label={`Объект распределения ${index + 1}`} value={allocation.projectId} onChange={(event) => setAllocations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, projectId: event.target.value } : item))} required><option value="">Выберите объект</option>{data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><div className="amount-input"><input aria-label={`Сумма распределения ${index + 1}`} value={allocation.amount} onChange={(event) => setAllocations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} inputMode="decimal" required placeholder="0" /><b>₽</b></div>{allocations.length > 2 && <button type="button" aria-label="Удалить строку распределения" onClick={() => setAllocations((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>}</div>)}<button type="button" className="link" onClick={() => setAllocations((current) => [...current, { projectId: "", amount: "" }])}>＋ Добавить объект</button><div className={allocationRemainingKopecks === 0 ? "allocation-total ready" : "allocation-total"}><span>Осталось распределить</span><b>{money(allocationRemainingKopecks)}</b></div></div>}</>}
      <label className="upload"><input name="attachment" type="file" multiple accept={FINANCE_ATTACHMENT_ACCEPT} onChange={(event) => { try { const next = Array.from(event.target.files ?? []).map((file) => ({ file, draft: createFinanceAttachmentDraft(file) })); setSelectedAttachments(next); setError(""); } catch (reason) { setSelectedAttachments([]); setError(reason instanceof Error ? reason.message : "Файл не прошёл проверку."); } }} /><i>＋</i><span><b>{selectedAttachments.length ? `${selectedAttachments.length} ${selectedAttachments.length === 1 ? "файл выбран" : "файла выбрано"}` : "Прикрепить чек / фото"}</b><small>До 10 файлов · изображения до 25 МБ, PDF до 10 МБ · необязательно</small></span></label>
      {mode === "EXPENSE" && expenseType === "PROJECT" && <label className="toggle-row"><span><b>Показывать клиенту</b><small>Расход появится в клиентском кабинете</small></span><input name="showToClient" type="checkbox" defaultChecked /></label>}
      <div className={`warning after-posting ${cashboxAffected && sourceAfter < 0 || repaymentOverBalance ? "negative" : ""}`}><b>После проведения</b>{cashboxAffected && selectedCashbox && <><span>{selectedCashbox.name}</span><strong>{money(selectedCashbox.balanceKopecks)} → {money(sourceAfter)}</strong></>}{mode === "TRANSFER" && destinationType === "CASHBOX" && destinationCashbox && <><span>{destinationCashbox.name}</span><strong>{money(destinationCashbox.balanceKopecks)} → {money(destinationAfter)}</strong></>}{selectedInvestmentAccount && (mode === "EXPENSE" && paymentSource === "INVESTMENT" || mode === "TRANSFER" && destinationType === "INVESTMENT") ? <><span>{selectedInvestmentAccount.name}</span><strong>{money(selectedInvestmentAccount.outstandingKopecks)} → {money(investmentAfter)}</strong></> : null}{cashboxAffected && sourceAfter < 0 && <p>Баланс кассы станет отрицательным. Операция разрешена.</p>}{repaymentOverBalance && <p>Сумма возврата превышает остаток инвестиции.</p>}</div>
      {mode === "EXPENSE" && expenseType === "PROJECT" && category === "MATERIALS" && !splitAcrossProjects && selectedProject && <div className={`warning after-posting ${selectedProject.materialsBalanceKopecks - amountKopecks < 0 ? "negative" : ""}`}><b>Клиентский бюджет материалов</b><span>{selectedProject.name}</span><strong>{money(selectedProject.materialsBalanceKopecks)} → {money(selectedProject.materialsBalanceKopecks - amountKopecks)}</strong>{selectedProject.materialsBalanceKopecks - amountKopecks < 0 && <p>Возникнет долг клиента {money(Math.abs(selectedProject.materialsBalanceKopecks - amountKopecks))}. Операция разрешена.</p>}</div>}
      {error && <div className="auth-error" role="alert"><i>!</i><span>{error}</span></div>}
      <div className="modal-actions"><button type="button" onClick={onClose}>Отмена</button><button type="submit" className="primary" disabled={loading || !data || repaymentOverBalance || (splitAcrossProjects && allocationRemainingKopecks !== 0)}>{loading ? "Проводим…" : mode === "TRANSFER" && destinationType === "INVESTMENT" ? "Вернуть инвестицию" : mode === "TRANSFER" ? "Провести перемещение" : "Провести операцию"}</button></div>
    </form>}{success && uploadStatus && <div className={uploadStatus.includes("Не удалось") ? "auth-error finance-upload-status" : "auth-success finance-upload-status"} role="status"><i>{uploadStatus.includes("Не удалось") ? "!" : "✓"}</i><span>{uploadStatus}</span></div>}
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
