"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AccessProfile } from "../lib/permission-definitions";

type Stage = { id: string; name: string; stageCommercialAmountKopecks: number | null };
type Term = { stageId: string; amount: string; advance: string };
const money = (kopecks: number) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(kopecks / 100)} ₽`;
const kopecks = (value: string) => Math.round(Number(value.replace(",", ".")) * 100);

export function StagePaymentPlanForm({ projectId, stages, access, onError }: { projectId: string; stages: Stage[]; access: AccessProfile; onError: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [terms, setTerms] = useState<Term[]>([]);
  const [review, setReview] = useState<{ totalKopecks: number; contractAmountKopecks: number; differenceKopecks: number } | null>(null);
  const valid = useMemo(() => terms.length === stages.length && terms.every((term) => Number.isFinite(kopecks(term.amount)) && kopecks(term.amount) >= 0 && Number.isFinite(kopecks(term.advance)) && kopecks(term.advance) >= 0), [terms, stages.length]);
  if (!access.actions["stagePaymentTerms.view"] && !access.actions["stagePaymentTerms.edit"]) return null;

  function begin() {
    setTerms(stages.map((stage) => ({ stageId: stage.id, amount: String((stage.stageCommercialAmountKopecks ?? 0) / 100), advance: "0" })));
    setReview(null); setOpen(true);
  }
  function change(stageId: string, field: "amount" | "advance", value: string) { setTerms((current) => current.map((term) => term.stageId === stageId ? { ...term, [field]: value } : term)); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await fetch("/api/client-portal/payment-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SAVE", projectId, terms: terms.map((term) => ({ stageId: term.stageId, stageAmountKopecks: kopecks(term.amount), requiredAdvanceKopecks: kopecks(term.advance) })) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setReview({ totalKopecks: Number(result.totalKopecks), contractAmountKopecks: Number(result.contractAmountKopecks), differenceKopecks: Number(result.differenceKopecks) });
    } catch (reason) { onError(reason instanceof Error ? reason.message : "Не удалось сохранить финансовый план."); }
    finally { setBusy(false); }
  }
  async function activate() {
    setBusy(true);
    try {
      const response = await fetch("/api/client-portal/payment-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ACTIVATE", projectId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setOpen(false); setReview(null);
    } catch (reason) { onError(reason instanceof Error ? reason.message : "Не удалось активировать финансовый план."); }
    finally { setBusy(false); }
  }
  return <section className="panel stage-payment-plan"><div><span className="eyebrow">ФИНАНСОВЫЙ ПЛАН ЭТАПОВ</span><h3>Обязательства клиента</h3><p>Редактирование цифр не создаёт деньги. Обязательства появляются после активации и приёмки этапов.</p></div>{access.actions["stagePaymentTerms.edit"] ? <button className="secondary" disabled={busy || !stages.length} onClick={begin}>Настроить и активировать</button> : null}
    {open ? <div className="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="payment-plan-title"><form className="modal production-form" onSubmit={save}><header className="modal-head"><div><span className="eyebrow">ФИНАНСОВЫЙ ПЛАН</span><h3 id="payment-plan-title">Суммы и авансы этапов</h3></div><button type="button" onClick={() => setOpen(false)} aria-label="Закрыть">×</button></header>
      {!review ? <div className="stage-payment-fields">{stages.map((stage) => { const term = terms.find((item) => item.stageId === stage.id); return <fieldset key={stage.id}><legend>{stage.name}</legend><label><span>Стоимость этапа, ₽</span><input inputMode="decimal" value={term?.amount ?? ""} onChange={(event) => change(stage.id, "amount", event.target.value)} required /></label><label><span>Необходимый аванс, ₽</span><input inputMode="decimal" value={term?.advance ?? ""} onChange={(event) => change(stage.id, "advance", event.target.value)} required /></label></fieldset>; })}</div> : <div className="payment-plan-review"><p><span>Сумма этапов</span><strong>{money(review.totalKopecks)}</strong></p><p><span>Договор</span><strong>{money(review.contractAmountKopecks)}</strong></p><p><span>Разница</span><strong>{money(review.differenceKopecks)}</strong></p><small>Активация создаст первое обязательство по авансу. Финансовая транзакция при этом не создаётся.</small></div>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={() => review ? setReview(null) : setOpen(false)}>{review ? "Назад" : "Отмена"}</button>{review ? <button type="button" className="primary" disabled={busy} onClick={() => void activate()}>{busy ? "Активируем…" : "Активировать план"}</button> : <button className="primary" disabled={busy || !valid}>{busy ? "Проверяем…" : "Проверить суммы"}</button>}</div>
    </form></div> : null}
  </section>;
}
