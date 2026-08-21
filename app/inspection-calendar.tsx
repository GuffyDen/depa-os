"use client";

import { useMemo } from "react";
import type { Order, SchedulePreset, User } from "./orders-ui";

const VLADIVOSTOK_OFFSET_SECONDS = 10 * 3600;
const HOUR_HEIGHT = 84;
const CURRENT_DATE_KEY = dateKeyFromEpoch(Math.floor(Date.now() / 1000));

function dateKeyFromEpoch(value: number) {
  return new Date((value + VLADIVOSTOK_OFFSET_SECONDS) * 1000)
    .toISOString()
    .slice(0, 10);
}
function dateKeyToEpoch(value: string, time = "00:00") {
  return Math.floor(new Date(`${value}T${time}:00+10:00`).getTime() / 1000);
}
function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
function makeDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}
export function addCalendarDays(value: string, amount: number) {
  const next = parseDateKey(value);
  next.setUTCDate(next.getUTCDate() + amount);
  return makeDateKey(next);
}
export function addCalendarMonths(value: string, amount: number) {
  const current = parseDateKey(value),
    day = current.getUTCDate();
  current.setUTCDate(1);
  current.setUTCMonth(current.getUTCMonth() + amount);
  const last = new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0),
  ).getUTCDate();
  current.setUTCDate(Math.min(day, last));
  return makeDateKey(current);
}
function dayLabel(value: string) {
  return parseDateKey(value).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
function monthLabel(value: string) {
  return parseDateKey(value).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
function clock(value: number | null) {
  return value
    ? new Date(value * 1000).toLocaleTimeString("ru-RU", {
        timeZone: "Asia/Vladivostok",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
function timeFromMinutes(minutes: number) {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}
function minuteOfDay(value: number) {
  const shifted = new Date((value + VLADIVOSTOK_OFFSET_SECONDS) * 1000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}
function preset(date: string, startTime = "10:00"): SchedulePreset {
  const [hours, minutes] = startTime.split(":").map(Number);
  return {
    date,
    startTime,
    endTime: timeFromMinutes(hours * 60 + minutes + 90),
  };
}
function monthGrid(value: string) {
  const current = parseDateKey(value),
    first = new Date(
      Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1),
    ),
    mondayOffset = (first.getUTCDay() + 6) % 7,
    start = makeDateKey(new Date(first.getTime() - mondayOffset * 86400000));
  return Array.from({ length: 42 }, (_, index) =>
    addCalendarDays(start, index),
  );
}
export function calendarRange(value: string, level: "month" | "day") {
  const days = level === "month" ? monthGrid(value) : [value];
  return {
    rangeStart: dateKeyToEpoch(days[0]),
    rangeEnd: dateKeyToEpoch(addCalendarDays(days.at(-1) || value, 1)),
  };
}
function rangeLabel(order: Order) {
  return `${clock(order.inspection?.scheduledStartAt ?? order.scheduledAt)}–${clock(order.inspection?.scheduledEndAt ?? null)}`;
}

function MonthView({
  selectedDate,
  items,
  onDay,
}: {
  selectedDate: string;
  items: Order[];
  onDay: (value: string) => void;
}) {
  const days = useMemo(() => monthGrid(selectedDate), [selectedDate]),
    currentMonth = parseDateKey(selectedDate).getUTCMonth(),
    counts = useMemo(() => {
      const result = new Map<string, number>();
      for (const order of items) {
        const start = order.inspection?.scheduledStartAt;
        if (start) {
          const key = dateKeyFromEpoch(start);
          result.set(key, (result.get(key) || 0) + 1);
        }
      }
      return result;
    }, [items]);
  return (
    <div className="panel inspection-month">
      <div className="month-weekdays">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="month-grid">
        {days.map((day) => {
          const count = counts.get(day) || 0,
            muted = parseDateKey(day).getUTCMonth() !== currentMonth,
            isToday = day === CURRENT_DATE_KEY;
          return (
            <button
              key={day}
              className={`${muted ? "muted " : ""}${isToday ? "today" : ""}`}
              onClick={() => onDay(day)}
              aria-label={`${dayLabel(day)}${count ? `, приёмок: ${count}` : ", приёмок нет"}`}
            >
              <time dateTime={day}>{parseDateKey(day).getUTCDate()}</time>
              {count ? (
                <b>
                  {count}{" "}
                  {count === 1 ? "приёмка" : count < 5 ? "приёмки" : "приёмок"}
                </b>
              ) : (
                <span>Свободно</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function layoutDayItems(items: Order[], day: string, startHour: number) {
  const dayStart = dateKeyToEpoch(day),
    rows = items
      .map((order) => {
        const startAt =
            order.inspection?.scheduledStartAt ?? order.scheduledAt ?? dayStart,
          endAt = order.inspection?.scheduledEndAt ?? startAt + 5400;
        return {
          order,
          start: Math.max(0, (startAt - dayStart) / 60),
          end: Math.min(24 * 60, (endAt - dayStart) / 60),
          lane: 0,
          laneCount: 1,
        };
      })
      .sort((a, b) => a.start - b.start || a.end - b.end),
    laneEnds: number[] = [];
  for (const row of rows) {
    let lane = laneEnds.findIndex((end) => end <= row.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = row.end;
    row.lane = lane;
  }
  const laneCount = Math.max(1, laneEnds.length);
  for (const row of rows) row.laneCount = laneCount;
  return rows.map((row) => ({
    ...row,
    top: ((row.start - startHour * 60) / 60) * HOUR_HEIGHT,
    height: Math.max(44, ((row.end - row.start) / 60) * HOUR_HEIGHT),
  }));
}

function DayView({
  selectedDate,
  items,
  canCreate,
  onOpen,
  onQuickCreate,
}: {
  selectedDate: string;
  items: Order[];
  canCreate: boolean;
  onOpen: (id: string) => void;
  onQuickCreate: (value: SchedulePreset) => void;
}) {
  const dayStart = dateKeyToEpoch(selectedDate),
    dayEnd = dayStart + 86400,
    sorted = [...items]
      .filter((order) => {
        const start = order.inspection?.scheduledStartAt || 0,
          end = order.inspection?.scheduledEndAt || start + 5400;
        return start < dayEnd && end > dayStart;
      })
      .sort(
        (a, b) =>
          (a.inspection?.scheduledStartAt || 0) -
          (b.inspection?.scheduledStartAt || 0),
      ),
    minutes = sorted.flatMap((order) => [
      minuteOfDay(order.inspection?.scheduledStartAt || dayStart + 8 * 3600),
      minuteOfDay(order.inspection?.scheduledEndAt || dayStart + 9.5 * 3600),
    ]),
    startHour = Math.max(
      0,
      Math.min(8, Math.floor(Math.min(...minutes, 8 * 60) / 60)),
    ),
    endHour = Math.min(
      24,
      Math.max(20, Math.ceil(Math.max(...minutes, 20 * 60) / 60)),
    ),
    hours = Array.from(
      { length: endHour - startHour + 1 },
      (_, index) => startHour + index,
    ),
    positioned = layoutDayItems(sorted, selectedDate, startHour),
    timelineHeight = (endHour - startHour) * HOUR_HEIGHT;
  return (
    <div className="inspection-day-layout">
      <section className="panel day-summary">
        <span className="eyebrow">РАСПИСАНИЕ ДНЯ</span>
        <h3>{dayLabel(selectedDate)}</h3>
        <p>
          {sorted.length
            ? `${sorted.length} ${sorted.length === 1 ? "приёмка" : sorted.length < 5 ? "приёмки" : "приёмок"}`
            : "Приёмок нет"}
        </p>
        {canCreate ? (
          <button
            className="primary"
            onClick={() => onQuickCreate(preset(selectedDate))}
          >
            ＋ Назначить приёмку
          </button>
        ) : null}
      </section>
      <section
        className="panel day-timeline"
        style={{ height: timelineHeight + 32 }}
        onClick={(event) => {
          if (!canCreate) return;
          const rect = event.currentTarget.getBoundingClientRect(),
            rawMinutes =
              startHour * 60 +
              ((event.clientY - rect.top - 16) / HOUR_HEIGHT) * 60,
            rounded = Math.round(rawMinutes / 30) * 30;
          onQuickCreate(preset(selectedDate, timeFromMinutes(rounded)));
        }}
        aria-label="Временная шкала приёмок"
      >
        {hours.map((hour) => (
          <div
            className="timeline-hour"
            key={hour}
            style={{ top: 16 + (hour - startHour) * HOUR_HEIGHT }}
          >
            <time>{String(hour).padStart(2, "0")}:00</time>
            <i />
          </div>
        ))}
        <div className="timeline-events">
          {positioned.map(({ order, lane, laneCount, top, height }) => (
            <button
              key={order.id}
              className={`calendar-event status-${order.status.toLowerCase()}`}
              style={{
                top,
                height,
                left: `calc(${(lane / laneCount) * 100}% + 4px)`,
                width: `calc(${100 / laneCount}% - 8px)`,
              }}
              onClick={(event) => {
                event.stopPropagation();
                onOpen(order.id);
              }}
            >
              <strong>{rangeLabel(order)}</strong>
              <b>{order.clientName}</b>
              <span>
                {order.inspection?.residentialComplex
                  ? `ЖК ${order.inspection.residentialComplex} · `
                  : ""}
                кв. {order.inspection?.apartmentNumber}
              </span>
              <small>
                {order.inspection?.inspectorName} ·{" "}
                {STATUS_LABELS[order.status]}
              </small>
            </button>
          ))}
        </div>
      </section>
      <section className="mobile-day-list">
        {sorted.map((order) => (
          <button
            className="panel mobile-calendar-event"
            key={order.id}
            onClick={() => onOpen(order.id)}
          >
            <time>{rangeLabel(order)}</time>
            <div>
              <b>{order.clientName}</b>
              <span>
                {order.inspection?.residentialComplex
                  ? `ЖК ${order.inspection.residentialComplex} · `
                  : ""}
                {order.inspection?.address} · кв.{" "}
                {order.inspection?.apartmentNumber}
              </span>
              <small>
                {order.inspection?.inspectorName} ·{" "}
                {STATUS_LABELS[order.status]}
              </small>
            </div>
          </button>
        ))}
        {!sorted.length ? (
          <div className="panel order-empty-small">
            На этот день приёмок нет.
          </div>
        ) : null}
      </section>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  NEW: "Новый",
  SCHEDULED: "Назначен",
  IN_PROGRESS: "В работе",
  COMPLETED: "Выполнен",
  CANCELLED: "Отменён",
};

export function InspectionCalendar({
  level,
  selectedDate,
  selectedInspector,
  items,
  inspectors,
  canCreate,
  loading,
  onLevelChange,
  onDateChange,
  onInspectorChange,
  onOpen,
  onQuickCreate,
}: {
  level: "month" | "day";
  selectedDate: string;
  selectedInspector: string;
  items: Order[];
  inspectors: User[];
  canCreate: boolean;
  loading: boolean;
  onLevelChange: (value: "month" | "day") => void;
  onDateChange: (value: string) => void;
  onInspectorChange: (value: string) => void;
  onOpen: (id: string) => void;
  onQuickCreate: (value: SchedulePreset) => void;
}) {
  function move(amount: number) {
    onDateChange(
      level === "month"
        ? addCalendarMonths(selectedDate, amount)
        : addCalendarDays(selectedDate, amount),
    );
  }
  return (
    <>
      <section className="panel calendar-toolbar">
        <div className="calendar-level-switch">
          <button
            className={level === "month" ? "active" : ""}
            onClick={() => onLevelChange("month")}
          >
            Месяц
          </button>
          <button
            className={level === "day" ? "active" : ""}
            onClick={() => onLevelChange("day")}
          >
            День
          </button>
        </div>
        <div className="calendar-navigation">
          <button
            aria-label={
              level === "month" ? "Предыдущий месяц" : "Предыдущий день"
            }
            onClick={() => move(-1)}
          >
            ←
          </button>
          <button
            onClick={() =>
              onDateChange(CURRENT_DATE_KEY)
            }
          >
            Сегодня
          </button>
          <button
            aria-label={
              level === "month" ? "Следующий месяц" : "Следующий день"
            }
            onClick={() => move(1)}
          >
            →
          </button>
        </div>
        <h3>
          {level === "month"
            ? monthLabel(selectedDate)
            : dayLabel(selectedDate)}
        </h3>
        <label>
          <span>Специалист</span>
          <select
            value={selectedInspector}
            onChange={(event) => onInspectorChange(event.target.value)}
          >
            <option value="ALL">Все специалисты</option>
            {inspectors.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <label className="calendar-date-picker">
          <span>Выбранная дата</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => {
              onDateChange(event.target.value);
              onLevelChange("day");
            }}
          />
        </label>
      </section>
      {loading ? (
        <div className="panel finance-loading">Загружаем календарь…</div>
      ) : level === "month" ? (
        <MonthView
          selectedDate={selectedDate}
          items={items}
          onDay={(day) => {
            onDateChange(day);
            onLevelChange("day");
          }}
        />
      ) : (
        <DayView
          selectedDate={selectedDate}
          items={items}
          canCreate={canCreate}
          onOpen={onOpen}
          onQuickCreate={onQuickCreate}
        />
      )}
    </>
  );
}
