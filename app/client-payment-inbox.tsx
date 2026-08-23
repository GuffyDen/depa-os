"use client";

import { FormEvent, useEffect, useState } from "react";

type Cashbox = { id: string; name: string; ownerName: string | null; status: "ACTIVE" | "INACTIVE" };
type Claim = { id: string; client_name: string; project_name: string; claimed_amount_kopecks: number; client_comment: string | null; claimed_at: number; proof_attachment_id: string | null; status: string };

const money = (kopecks: number) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(kopecks / 100)} ₽`;

export function ClientPaymentInboxForm({ cashboxes, onChanged }: { cashboxes: Cashbox[]; onChanged: () => void }) {
  const activeCashboxes = cashboxes.filter((cashbox) => cashbox.status === "ACTIVE");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [allowed, setAllowed] = useState(true);
  const [selected, setSelected] = useState<Claim | null>(null);
  const [mode, setMode] = useState<"CONFIRM" | "REJECT">("CONFIRM");
  const [amount, setAmount] = useState("");
  const [cashboxId, setCashboxId] = useState("");
  const [receivedDate, setReceivedDate] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/client-payments", { cache: "no-store" });
    if (response.status === 403) { setAllowed(false); return; }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setClaims(result.items ?? []);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить заявления.")); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function open(claim: Claim, nextMode: "CONFIRM" | "REJECT") {
    setSelected(claim);
    setMode(nextMode);
    setAmount(String(claim.claimed_amount_kopecks / 100));
    setCashboxId(activeCashboxes[0]?.id ?? "");
    setReceivedDate(new Date().toISOString().slice(0, 10));
    setComment("");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const body = mode === "CONFIRM"
        ? { action: "CONFIRM", claimId: selected.id, actualAmountKopecks: Math.round(Number(amount.replace(",", ".")) * 100), cashboxId, receivedAt: Math.floor(new Date(`${receivedDate}T12:00:00+10:00`).getTime() / 1000), comment }
        : { action: "REJECT", claimId: selected.id, comment };
      const response = await fetch("/api/client-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSelected(null);
      await load();
      onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось обработать оплату."); }
    finally { setBusy(false); }
  }

  if (!allowed) return null;
  const pending = claims.filter((claim) => claim.status === "PENDING");
  return <section className="panel client-payment-inbox">
    <div className="table-toolbar"><strong>Оплаты клиентов</strong><small>Ожидают подтверждения: {pending.length}</small></div>
    {error && !selected ? <div className="form-error">{error}</div> : null}
    {pending.length ? pending.map((claim) => <article key={claim.id}>
      <div><b>{claim.client_name}</b><span>{claim.project_name} · {new Date(claim.claimed_at * 1000).toLocaleString("ru-RU")}</span><small>{claim.client_comment || "Без комментария"}</small></div>
      <strong>{money(claim.claimed_amount_kopecks)}</strong>
      <div>{claim.proof_attachment_id ? <a className="link" href={`/api/files/${claim.proof_attachment_id}`} target="_blank" rel="noreferrer">Открыть proof</a> : <span>Без файла</span>}<button className="secondary" onClick={() => open(claim, "REJECT")}>Не подтверждено</button><button className="primary" onClick={() => open(claim, "CONFIRM")}>Подтвердить получение</button></div>
    </article>) : <div className="finance-empty">Ожидающих подтверждения оплат нет.</div>}
    {selected ? <div className="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="payment-confirm-title"><form className="modal finance-form" onSubmit={submit}>
      <header className="modal-head"><div><span className="eyebrow">ОПЛАТА КЛИЕНТА</span><h3 id="payment-confirm-title">{mode === "CONFIRM" ? "Подтвердить получение" : "Отклонить заявление"}</h3></div><button type="button" onClick={() => setSelected(null)} aria-label="Закрыть">×</button></header>
      {mode === "CONFIRM" ? <div className="form-grid">
        <label><span>Фактически получено, ₽</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
        <label><span>Активная касса</span><select value={cashboxId} onChange={(event) => setCashboxId(event.target.value)} required><option value="">Выберите кассу</option>{activeCashboxes.map((cashbox) => <option key={cashbox.id} value={cashbox.id}>{cashbox.name}{cashbox.ownerName ? ` · ${cashbox.ownerName}` : ""}</option>)}</select></label>
        <label><span>Дата получения</span><input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} required /></label>
        <label className="wide"><span>Комментарий</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} /></label>
      </div> : <label><span>Причина для клиента</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} required /></label>}
      {error ? <div className="form-error">{error}</div> : null}
      <div className="modal-actions"><button type="button" className="secondary" onClick={() => setSelected(null)}>Отмена</button><button className={mode === "CONFIRM" ? "primary" : "secondary danger-text"} disabled={busy || (mode === "CONFIRM" && !cashboxId)}>{busy ? "Сохраняем…" : mode === "CONFIRM" ? "Подтвердить оплату" : "Отклонить"}</button></div>
    </form></div> : null}
  </section>;
}
