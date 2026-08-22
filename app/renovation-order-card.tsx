"use client";

import { useState } from "react";
import type { Order } from "./orders-ui";

function money(value: number | null) {
  if (value == null) return "Скрыто правами доступа";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

export function RenovationOrderCard({
  order,
  canAddPayment,
  canCreateProject,
  onClose,
  onPayment,
  onOpenProject,
  onChanged,
  onOpenEstimate,
}: {
  order: Order;
  canAddPayment: boolean;
  canCreateProject: boolean;
  onClose: () => void;
  onPayment: (order: Order) => void;
  onOpenProject: (projectId: string) => void;
  onChanged: () => void;
  onOpenEstimate?: (estimateId:string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const details = order.renovation;
  async function createProject() {
    if (!details || details.projectId) return;
    if (details.contractStatus !== "SIGNED" && !window.confirm("Подписанный договор не найден. Owner может продолжить создание объекта без договора. Продолжить?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          clientId: order.clientId,
          residentialComplexId: details.residentialComplexId,
          residentialComplex: details.residentialComplex,
          address: details.address,
          apartment: details.apartmentNumber,
          areaSqm: details.areaSqm,
          responsibleUserId: order.responsibleUserId,
          status: "PLANNING",
        }),
      });
      const result = (await response.json()) as {
        project?: { id: string };
        error?: string;
      };
      if (!response.ok || !result.project)
        throw new Error(result.error || "Не удалось создать объект.");
      onChanged();
      onOpenProject(result.project.id);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось создать объект.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-wrap order-drawer-wrap"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="order-card renovation-order-card"
        role="dialog"
        aria-modal="true"
      >
        <header className="order-card-head">
          <button className="back" onClick={onClose}>
            ← Заказы
          </button>
          <div>
            <span
              className={`order-status status-${order.status.toLowerCase()}`}
            >
              {order.status === "NEW" ? "Новый" : order.status}
            </span>
            <span className="eyebrow">РЕМОНТ КВАРТИРЫ</span>
            <h2>{order.orderNumber}</h2>
            <span className="client-link">
              {order.clientName} · {order.clientPhone}
            </span>
          </div>
          <div className="order-card-actions">
            {canAddPayment ? (
              <button className="primary" onClick={() => onPayment(order)}>
                ＋ Добавить оплату
              </button>
            ) : null}
            <button aria-label="Закрыть карточку" onClick={onClose}>
              ×
            </button>
          </div>
        </header>
        {error ? (
          <div className="form-error order-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="order-card-content renovation-overview">
          <section className="panel order-facts">
            <div>
              <span>Клиент</span>
              <b>{order.clientName}</b>
            </div>
            <div>
              <span>Ответственный</span>
              <b>{order.responsibleName}</b>
            </div>
            <div>
              <span>ЖК</span>
              <b>{details?.residentialComplex || "—"}</b>
            </div>
            <div>
              <span>Адрес</span>
              <b>{details?.address || "—"}</b>
            </div>
            <div>
              <span>Квартира</span>
              <b>{details?.apartmentNumber || "—"}</b>
            </div>
            <div>
              <span>Площадь</span>
              <b>{details?.areaSqm ? `${details.areaSqm} м²` : "—"}</b>
            </div>
          </section>
          <section className="order-money">
            <article className="panel">
              <span>Стоимость</span>
              <b>{money(order.priceKopecks)}</b>
            </article>
            <article className="panel">
              <span>Оплачено</span>
              <b>{money(order.paidKopecks)}</b>
            </article>
            <article className="panel">
              <span>{order.overpaymentKopecks ? "Переплата" : "Остаток"}</span>
              <b>{money(order.overpaymentKopecks || order.remainingKopecks)}</b>
            </article>
          </section>
          <section className="panel renovation-project-link">
            <span className="eyebrow">ПРОИЗВОДСТВЕННЫЙ ОБЪЕКТ</span>
            {details?.projectId ? (
              <>
                <h3>Объект связан с заказом</h3>
                <button
                  className="primary"
                  onClick={() => onOpenProject(details.projectId!)}
                >
                  Открыть объект
                </button>
              </>
            ) : (
              <>
                <h3>Объект ещё не создан</h3>
                <p>
                  Заказ на ремонт существует самостоятельно. Создание объекта
                  выполняется явным действием.
                </p>
                {canCreateProject ? (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void createProject()}
                  >
                    {busy ? "Создаём…" : "Создать объект"}
                  </button>
                ) : null}
              </>
            )}
          </section>
          {details?.approvedEstimateVersionId ? <section className="panel order-comment"><span className="eyebrow">СОГЛАСОВАННАЯ СМЕТА</span><p>Заказ создан из согласованной версии сметы. Стоимость заказа включает только работы.</p>{details.approvedEstimateId&&onOpenEstimate?<button className="secondary" onClick={()=>onOpenEstimate(details.approvedEstimateId!)}>Открыть смету</button>:null}</section> : null}
          <section className="panel order-comment"><span className="eyebrow">ДОГОВОР</span><p>{details?.contractNumber ? `${details.contractNumber} · ${details.contractStatus}` : "Договор ещё не создан. Объект остаётся доступен для явного создания Owner с предупреждением."}</p></section>
          <section className="panel order-comment">
            <span className="eyebrow">КОММЕНТАРИЙ</span>
            <p>{order.comment || "Комментарий не добавлен."}</p>
          </section>
        </div>
      </aside>
    </div>
  );
}
