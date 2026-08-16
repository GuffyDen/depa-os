"use client";

import { FormEvent, useEffect, useState } from "react";

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
};
type FinanceData = {
  isOwner: boolean; cashboxes: Cashbox[]; transactions: FinanceTransaction[]; projects: { id: string; name: string; clientId: string; incomeKopecks: number; expenseKopecks: number; refundKopecks: number; actualExpenseKopecks: number; clientBalanceKopecks: number }[];
  clients: { id: string; name: string }[]; physicalTotalKopecks: number;
};

const projectCategories = ["Материалы", "Работа / подряд", "Доставка и логистика", "Аренда оборудования", "Переделка / брак", "Прочее"];
const adminCategories = ["Реклама", "Офис", "Бухгалтерия", "Программное обеспечение", "Инструмент", "Транспорт", "Связь", "Прочее"];
const purposeLabels: Record<string, string> = { MATERIALS: "Материалы", WORKS: "Работы", ADDITIONAL_WORKS: "Дополнительные работы", OTHER: "Другое" };
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

async function readFinance() {
  const response = await fetch("/api/finance", { cache: "no-store" });
  const result = await response.json() as FinanceData & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить финансы.");
  return result;
}

function transactionLabel(transaction: FinanceTransaction) {
  if (transaction.type === "TRANSFER") return `Перемещение · ${transaction.cashboxName} → ${transaction.destinationCashboxName}`;
  if (transaction.type === "REFUND") return `Возврат · ${transaction.category}`;
  if (transaction.type === "INCOME") return `Поступление · ${transaction.source || transaction.category}`;
  return `${transaction.expenseType === "ADMIN" ? "Административный" : "Объектный"} расход · ${transaction.category}`;
}

function TransactionRow({ transaction, cashboxId }: { transaction: FinanceTransaction; cashboxId?: string }) {
  const incomingTransfer = transaction.type === "TRANSFER" && transaction.destinationCashboxId === cashboxId;
  const positive = transaction.type === "INCOME" || transaction.type === "REFUND" || incomingTransfer;
  const neutral = transaction.type === "TRANSFER" && !cashboxId;
  const amount = neutral ? money(transaction.amountKopecks) : money(positive ? transaction.amountKopecks : -transaction.amountKopecks, true);
  return <div className="transaction finance-transaction">
    <span className={`transaction-icon ${positive ? "plus" : transaction.type === "TRANSFER" ? "transfer" : "minus"}`}>{transaction.type === "TRANSFER" ? "⇄" : positive ? "↓" : "↑"}</span>
    <div><b>{transaction.title}</b><small>{transactionLabel(transaction)}{transaction.projectName ? ` · ${transaction.projectName}` : ""}<br />{new Date(transaction.transactionDate * 1000).toLocaleDateString("ru-RU")} · {transaction.authorName}{transaction.attachmentId ? <> · <a href={`/api/files/${transaction.attachmentId}`} target="_blank" rel="noreferrer">чек приложен</a></> : ""}</small></div>
    <span className="person-pill">{transaction.cashboxName}</span><strong className={positive ? "plus" : neutral ? "" : "minus"}>{amount}</strong>
  </div>;
}

function CashboxCard({ cashbox, transactions }: { cashbox: Cashbox; transactions: FinanceTransaction[] }) {
  const history = transactions.filter((item) => item.cashboxId === cashbox.id || item.destinationCashboxId === cashbox.id).slice(0, 20);
  return <article className={`cashbox-card panel ${cashbox.status === "INACTIVE" ? "inactive" : ""}`}>
    <header><div><span className="eyebrow">ПЕРСОНАЛЬНАЯ КАССА</span><h3>{cashbox.name}</h3></div><span className={`cashbox-status ${cashbox.status.toLowerCase()}`}>{cashbox.status === "ACTIVE" ? "Активна" : "Неактивна"}</span></header>
    <div className="cashbox-balance"><span>Текущий баланс</span><strong className={cashbox.balanceKopecks < 0 ? "minus" : ""}>{money(cashbox.balanceKopecks)}</strong>{cashbox.balanceKopecks < 0 && <small>DEPA должна владельцу кассы {money(Math.abs(cashbox.balanceKopecks))}</small>}</div>
    <div className="cashbox-stats"><div><span>Сегодня поступило</span><b>{money(cashbox.todayIncomeKopecks)}</b></div><div><span>Сегодня потрачено</span><b>{money(cashbox.todayExpenseKopecks)}</b></div><div><span>Передано</span><b>{money(cashbox.transferredOutKopecks)}</b></div><div><span>Получено</span><b>{money(cashbox.transferredInKopecks)}</b></div></div>
    <div className="cashbox-history"><div className="table-toolbar"><strong>История операций</strong><small>{history.length} записей</small></div>{history.length ? history.map((item) => <TransactionRow key={item.id} transaction={item} cashboxId={cashbox.id} />) : <div className="finance-empty">Операций пока нет.</div>}</div>
  </article>;
}

export function FinanceScreen({ onNew }: { onNew: (mode: FinanceMode) => void }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"OPERATIONS" | "CASHBOXES">("OPERATIONS");
  async function refresh() { try { setError(""); setData(await readFinance()); } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить финансы."); } }
  useEffect(() => {
    let cancelled = false;
    readFinance().then((result) => { if (!cancelled) setData(result); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось загрузить финансы."); });
    return () => { cancelled = true; };
  }, []);
  return <section className="screen-section finance-screen"><div className="screen-intro"><div><span className="eyebrow">ЕДИНЫЙ УЧЁТ</span><h2>Финансы</h2><p>Кассы показывают физическое расположение денег. Прибыль и клиентские средства учитываются отдельно.</p></div><div className="finance-actions">{data?.isOwner && <button className="secondary" onClick={() => onNew("INCOME")}>＋ Поступление</button>}<button className="secondary" onClick={() => onNew("EXPENSE")}>− Расход</button>{data?.isOwner && <button className="primary" onClick={() => onNew("TRANSFER")}>⇄ Переместить</button>}</div></div>
    <div className="segmented finance-tabs"><button className={tab === "OPERATIONS" ? "active" : ""} onClick={() => setTab("OPERATIONS")}>Операции</button><button className={tab === "CASHBOXES" ? "active" : ""} onClick={() => setTab("CASHBOXES")}>Кассы</button></div>
    {error && <div className="auth-error" role="alert"><i>!</i><span>{error}</span><button onClick={refresh}>Повторить</button></div>}
    {!data && !error && <div className="panel finance-loading">Загружаем финансовые данные…</div>}
    {data && <>
      <div className="metrics-grid finance-metrics"><div className="metric"><div className="metric-top"><span>ФИЗИЧЕСКИ В КАССАХ</span><i>↗</i></div><strong>{money(data.physicalTotalKopecks)}</strong><small>{data.cashboxes.filter((box) => box.status === "ACTIVE").length} активные персональные кассы</small></div><div className="metric"><div className="metric-top"><span>СРЕДСТВА КЛИЕНТОВ</span><i>↗</i></div><strong>Отдельно</strong><small>Не рассчитываются суммой касс</small></div><div className="metric"><div className="metric-top"><span>ПРИБЫЛЬ DEPA</span><i>↗</i></div><strong>Отдельно</strong><small>Управленческий контур</small></div><div className="metric"><div className="metric-top"><span>ДОСТУП</span><i>↗</i></div><strong>{data.isOwner ? "Owner" : "Личный"}</strong><small>{data.isOwner ? "Все персональные кассы" : "Только своя касса"}</small></div></div>
      {tab === "OPERATIONS" ? <div className="panel table-panel"><div className="table-toolbar"><strong>Все операции</strong><div>{data.isOwner && <button onClick={() => onNew("REFUND")}>＋ Возврат</button>}<button>Фильтры</button></div></div>{data.transactions.length ? data.transactions.map((item) => <TransactionRow key={item.id} transaction={item} />) : <div className="finance-empty">Операций пока нет. Добавьте поступление, расход или перемещение.</div>}</div> : <div className="cashbox-grid">{data.cashboxes.map((box) => <CashboxCard key={box.id} cashbox={box} transactions={data.transactions} />)}</div>}
    </>}
  </section>;
}

export function OperationPickerModal({ onClose, onSelect, isOwner }: { onClose: () => void; onSelect: (mode: FinanceMode) => void; isOwner: boolean }) {
  return <div className="modal-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal operation-picker" role="dialog" aria-modal="true" aria-labelledby="operation-picker-title"><div className="modal-head"><div><span className="eyebrow">НОВАЯ ЗАПИСЬ</span><h3 id="operation-picker-title">Добавить операцию</h3></div><button onClick={onClose} aria-label="Закрыть">×</button></div><div className="operation-options">
    <button onClick={() => onSelect("EXPENSE")}><i>−</i><span><b>Расход</b><small>Объектный или административный</small></span><em>→</em></button>
    {isOwner && <button onClick={() => onSelect("INCOME")}><i>＋</i><span><b>Поступление</b><small>В кассу от клиента или другого источника</small></span><em>→</em></button>}
    {isOwner && <button onClick={() => onSelect("TRANSFER")}><i>⇄</i><span><b>Перемещение</b><small>Одна операция между двумя кассами</small></span><em>→</em></button>}
    {isOwner && <button onClick={() => onSelect("REFUND")}><i>↩</i><span><b>Возврат</b><small>Возврат по расходу, не отрицательный расход</small></span><em>→</em></button>}
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

export function FinanceOperationModal({ mode, onClose, onSaved }: { mode: FinanceMode; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [expenseType, setExpenseType] = useState<"PROJECT" | "ADMIN">("PROJECT");
  const [amount, setAmount] = useState("");
  const [cashboxId, setCashboxId] = useState("");
  const [destinationCashboxId, setDestinationCashboxId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [clientId, setClientId] = useState("");
  const [originalTransactionId, setOriginalTransactionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  useEffect(() => { readFinance().then((result) => { setData(result); const active = result.cashboxes.filter((box) => box.status === "ACTIVE"); setCashboxId(active[0]?.id ?? ""); setDestinationCashboxId(active[1]?.id ?? ""); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить кассы.")); }, []);
  const activeCashboxes = data?.cashboxes.filter((box) => box.status === "ACTIVE") ?? [];
  const selectedCashbox = activeCashboxes.find((box) => box.id === cashboxId);
  const destinationCashbox = activeCashboxes.find((box) => box.id === destinationCashboxId);
  const amountKopecks = amountToKopecks(amount);
  const sourceAfter = selectedCashbox ? selectedCashbox.balanceKopecks + (mode === "EXPENSE" || mode === "TRANSFER" ? -amountKopecks : amountKopecks) : 0;
  const destinationAfter = destinationCashbox ? destinationCashbox.balanceKopecks + amountKopecks : 0;
  const selectedOriginal = data?.transactions.find((item) => item.id === originalTransactionId);
  const categories = expenseType === "PROJECT" ? projectCategories : adminCategories;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const receiptProjectId = expenseType === "PROJECT" || mode !== "EXPENSE" ? projectId || null : null;
      const attachmentId = await uploadReceipt(form.get("attachment") instanceof File && (form.get("attachment") as File).size > 0 ? form.get("attachment") as File : undefined, receiptProjectId);
      const effectiveCashboxId = mode === "REFUND" && selectedOriginal ? selectedOriginal.cashboxId : cashboxId;
      const response = await fetch("/api/finance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        type: mode, amount, date: form.get("date"), cashboxId: effectiveCashboxId, destinationCashboxId, expenseType,
        category: form.get("category"), projectId: expenseType === "PROJECT" || mode !== "EXPENSE" ? projectId || null : null,
        clientId: clientId || null, purpose: form.get("purpose"), source: form.get("source"), title: form.get("title"), comment: form.get("comment"),
        showToClient: expenseType === "PROJECT" && form.get("showToClient") === "on", originalTransactionId: originalTransactionId || null, attachmentId,
      }) });
      const result = await response.json() as { error?: string; operation?: { warning?: string | null } };
      if (!response.ok) throw new Error(result.error ?? "Не удалось провести операцию.");
      setSuccess(result.operation?.warning ? `Операция проведена. ${result.operation.warning}` : "Операция проведена и записана в историю.");
      onSaved(); setTimeout(onClose, 1400);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось провести операцию."); setLoading(false); }
  }

  return <div className="modal-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onClose(); }}><section className="modal finance-modal" role="dialog" aria-modal="true" aria-labelledby="finance-modal-title"><div className="modal-head"><div><span className="eyebrow">ФИНАНСЫ</span><h3 id="finance-modal-title">{modeLabels[mode]}</h3></div><button onClick={onClose} aria-label="Закрыть">×</button></div>
    {success ? <div className="success"><i>✓</i><h3>Готово</h3><p>{success}</p></div> : <form onSubmit={submit}>
      {mode === "EXPENSE" && <fieldset className="expense-type"><legend>Тип расхода</legend><button type="button" className={expenseType === "PROJECT" ? "active" : ""} onClick={() => setExpenseType("PROJECT")}><b>Объектный расход</b><small>Связан с конкретным объектом</small></button><button type="button" className={expenseType === "ADMIN" ? "active" : ""} onClick={() => setExpenseType("ADMIN")}><b>Административный расход</b><small>Без объекта и клиентского показа</small></button></fieldset>}
      <div className="form-grid"><label><span>Сумма</span><div className="amount-input"><input required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="100 000" /><b>₽</b></div></label><label><span>Дата</span><input name="date" type="date" defaultValue={localDate()} required /></label>
        {mode === "TRANSFER" ? <><label><span>Откуда</span><select value={cashboxId} onChange={(event) => setCashboxId(event.target.value)} required><option value="">Выберите кассу</option>{activeCashboxes.map((box) => <option key={box.id} value={box.id}>{box.name} · {money(box.balanceKopecks)}</option>)}</select></label><label><span>Куда</span><select value={destinationCashboxId} onChange={(event) => setDestinationCashboxId(event.target.value)} required><option value="">Выберите кассу</option>{activeCashboxes.map((box) => <option key={box.id} value={box.id}>{box.name} · {money(box.balanceKopecks)}</option>)}</select></label></> : mode === "REFUND" ? <label className="wide"><span>Исходный расход</span><select value={originalTransactionId} onChange={(event) => { const id = event.target.value; setOriginalTransactionId(id); const original = data?.transactions.find((item) => item.id === id); if (original) { setCashboxId(original.cashboxId); setProjectId(original.projectId ?? ""); } }}><option value="">Без связи с исходной операцией</option>{data?.transactions.filter((item) => item.type === "EXPENSE").map((item) => <option key={item.id} value={item.id}>{item.title} · {money(item.amountKopecks)} · {item.cashboxName}</option>)}</select></label> : <label><span>{mode === "INCOME" ? "Касса-получатель" : "Касса"}</span><select value={cashboxId} onChange={(event) => setCashboxId(event.target.value)} required><option value="">Выберите кассу</option>{activeCashboxes.map((box) => <option key={box.id} value={box.id}>{box.name} · {money(box.balanceKopecks)}</option>)}</select></label>}
        {mode === "EXPENSE" && <><label><span>Категория</span><select name="category" key={expenseType} required>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>{expenseType === "PROJECT" && <label className="wide"><span>Объект</span><select value={projectId} onChange={(event) => { setProjectId(event.target.value); const project = data?.projects.find((item) => item.id === event.target.value); setClientId(project?.clientId ?? ""); }} required><option value="">Выберите объект</option>{data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}</>}
        {mode === "INCOME" && <><label><span>Источник</span><input name="source" required placeholder="Клиент, банк, другое" /></label><label><span>Клиент</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Не связан</option>{data?.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label><span>Объект</span><select value={projectId} onChange={(event) => { setProjectId(event.target.value); const project = data?.projects.find((item) => item.id === event.target.value); if (project) setClientId(project.clientId); }}><option value="">Не связан</option>{data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label><span>Назначение</span><select name="purpose" required={Boolean(projectId || clientId)}><option value="">Выберите</option>{Object.entries(purposeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></>}
        {mode === "REFUND" && !selectedOriginal && <><label><span>Касса</span><select value={cashboxId} onChange={(event) => setCashboxId(event.target.value)} required><option value="">Выберите кассу</option>{activeCashboxes.map((box) => <option key={box.id} value={box.id}>{box.name}</option>)}</select></label><label><span>Категория</span><input name="category" required placeholder="Материалы" /></label><label className="wide"><span>Объект</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Не связан</option>{data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></>}
        {mode !== "TRANSFER" && <label className="wide"><span>{mode === "INCOME" ? "Назначение / название" : "Название"}</span><input name="title" placeholder={mode === "REFUND" ? "Возврат материалов" : mode === "EXPENSE" ? "Что оплачено" : "Оплата по договору"} /></label>}
        <label className="wide"><span>Комментарий</span><textarea name="comment" placeholder={mode === "TRANSFER" ? "Передал на закупки" : "Необязательно"} /></label>
      </div>
      <label className="upload"><input name="attachment" type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" onChange={(event) => setAttachmentName(event.target.files?.[0]?.name ?? "")} /><i>＋</i><span><b>{attachmentName || "Прикрепить чек"}</b><small>PDF, JPG, PNG, WebP или HEIC до 10 МБ · необязательно</small></span></label>
      {mode === "EXPENSE" && expenseType === "PROJECT" && <label className="toggle-row"><span><b>Показывать клиенту</b><small>Расход появится в клиентском кабинете</small></span><input name="showToClient" type="checkbox" defaultChecked /></label>}
      <div className={`warning after-posting ${sourceAfter < 0 ? "negative" : ""}`}><b>После проведения</b>{selectedCashbox && <><span>{selectedCashbox.name}</span><strong>{money(selectedCashbox.balanceKopecks)} → {money(sourceAfter)}</strong></>}{mode === "TRANSFER" && destinationCashbox && <><span>{destinationCashbox.name}</span><strong>{money(destinationCashbox.balanceKopecks)} → {money(destinationAfter)}</strong></>}{sourceAfter < 0 && <p>Баланс кассы станет отрицательным. Операция разрешена.</p>}</div>
      {error && <div className="auth-error" role="alert"><i>!</i><span>{error}</span></div>}
      <div className="modal-actions"><button type="button" onClick={onClose}>Отмена</button><button type="submit" className="primary" disabled={loading || !data}>{loading ? "Проводим…" : mode === "TRANSFER" ? "Провести перемещение" : "Провести операцию"}</button></div>
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
  const [data, setData] = useState<FinanceData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    readFinance().then((result) => { if (!cancelled) setData(result); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось загрузить объекты."); });
    return () => { cancelled = true; };
  }, []);
  return <section className="screen-section"><div className="screen-intro"><div><span className="eyebrow">МОИ ОБЪЕКТЫ</span><h2>Разрешённые объекты</h2><p>Показаны только объекты, к которым Owner предоставил доступ.</p></div></div>{error && <div className="auth-error" role="alert"><i>!</i><span>{error}</span></div>}<div className="project-grid">{data?.projects.map((project) => <article className="project-card" key={project.id}><div className="project-logo">◇</div><h3>{project.name}</h3><p>Доступ сотрудника</p></article>)}</div>{data && data.projects.length === 0 && <div className="panel finance-empty">Owner пока не назначил доступных объектов.</div>}</section>;
}
