"use client";

import { upload } from "@vercel/blob/client";
import { StagePaymentPlanForm } from "./stage-payment-plan-form";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AccessProfile } from "../lib/permission-definitions";
import { StructuredActionDialog, type ActionDialogConfig } from "./structured-action-dialog";

type PhotoRequirement = { id: string; name: string; description: string | null; required_before_completion: number; photo_count: number };
type ContractorAssignment = { contractor_agreement_id: string; contractor_name: string };
type Task = {
  id: string; stageId: string; name: string; description: string | null; status: string;
  progressType: "BINARY" | "QUANTITY"; unit: string | null; plannedQuantity: number | null;
  completedQuantity: number | null; remainingQuantity: number | null; weightWithinStage: number;
  plannedStartDate: number | null; plannedEndDate: number | null; actualStartDate: number | null;
  actualEndDate: number | null; progressPercent: number | null; responsibleName: string | null;
  contractors: ContractorAssignment[]; photoRequirements: PhotoRequirement[];
};
type WeightValidation = { valid: boolean; total: number; message: string | null };
type Stage = {
  id: string; name: string; status: string; weightWithinProject: number; plannedStartDate: number | null;
  plannedEndDate: number | null; actualStartDate: number | null; actualEndDate: number | null;
  progressPercent: number; taskCount: number; completedCount: number; responsibleName: string | null;
  acceptanceStatus: string; stageCommercialAmountKopecks: number | null; tasks: Task[]; weightValidation: WeightValidation;
};
type Report = { id: string; report_date: number; author_name: string; work_completed: string; comment: string | null; comment_client_visible: number; worker_count: number; photo_count: number };
type Delay = { id: string; category: string; reason: string; days: number; client_visible: number; end_date: number | null };
type TemplateTask = { id: string; name: string; weight: string | number; typical_duration_days: number };
type TemplateStage = { id: string; name: string; weight: string | number; tasks: TemplateTask[] };
type Template = { id: string; name: string; stage_count: number; status?: string; version?: number; stages?: TemplateStage[] };
type Data = {
  plan: Record<string, unknown> | null; stages: Stage[]; tasks: Task[];
  dependencies: { id: string; predecessor_task_id: string; successor_task_id: string; lag_days: number }[];
  delays: Delay[]; reports: Report[]; templates: Template[];
  agreements: { id: string; contractor_id: string; contractor_name: string; work_title: string }[];
  employees: { id: string; display_name: string }[];
  forecast: { internal: number | null; published: number | null };
  scheduleEvents: { id: string; type: string; previous_forecast_end_date: number | null; new_forecast_end_date: number | null; occurred_at: number; actor_name: string }[];
  weightValidation: WeightValidation; progress: { production: number; overall: number };
};
type SchedulePreview = { confirmationRequired: true; affectedCount: number; affectedTaskIds: string[]; previousForecastEndDate: number; newForecastEndDate: number };

const statuses: Record<string, string> = { NOT_STARTED: "Не начата", IN_PROGRESS: "В работе", PAUSED: "Приостановлена", COMPLETED: "Завершена", CANCELLED: "Отменена" };
const formatDate = (value: number | null) => value ? new Date(value * 1000).toLocaleDateString("ru-RU") : "—";
const isoDate = (value: number | null) => value ? new Date(value * 1000).toISOString().slice(0, 10) : "";
async function json<T>(response: Response) {
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw Object.assign(new Error(value.error || "Операция не выполнена."), value);
  return value;
}

function Progress({ value }: { value: number }) {
  return <div className="production-progress"><i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /><span>{Math.round(value)}%</span></div>;
}

export function ProductionOverviewMetric({ projectId }: { projectId: string }) {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/production?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }).then(response => response.ok ? response.json() : Promise.reject()).then((result: { progress?: { production?: number } }) => { if (active) setValue(result.progress?.production ?? 0); }).catch(() => undefined);
    return () => { active = false; };
  }, [projectId]);
  if (value === null) return null;
  return <article className="panel"><span>ГОТОВНОСТЬ ОБЪЕКТА</span><b>{Math.round(value)}%</b><Progress value={value} /><small>Реальный weighted progress Production engine</small></article>;
}

function ActionForm({ kind, projectId, stages, tasks, employees, agreements, onClose, onSave }: {
  kind: string; projectId: string; stages: Stage[]; tasks: Task[]; employees: Data["employees"]; agreements: Data["agreements"];
  onClose: () => void; onSave: (url: string, body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const formData = new FormData(event.currentTarget);
    const raw = Object.fromEntries(formData.entries());
    const body: Record<string, unknown> = { projectId, ...raw };
    if (kind === "stage") body.action = "ADD_STAGE";
    if (kind === "task") body.action = "ADD_TASK";
    if (kind === "report") { body.action = "REPORT"; body.employeeIds = formData.getAll("employeeIds"); body.contractorIds = formData.getAll("contractorIds"); body.taskIds = formData.getAll("taskIds"); }
    if (kind === "delay") body.action = "CREATE_DELAY";
    if (kind === "dependency") body.action = "ADD_DEPENDENCY";
    try { await onSave(kind === "report" ? "/api/production/daily-reports" : "/api/production", body); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Ошибка"); }
    finally { setSaving(false); }
  }
  const title = kind === "stage" ? "Новый этап" : kind === "task" ? "Новая задача" : kind === "report" ? "Дневной отчёт" : kind === "delay" ? "Новый простой" : "Зависимость задач";
  return <div className="modal-wrap production-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="modal production-action-form" onSubmit={submit}>
      <header><div><span className="eyebrow">ПРОИЗВОДСТВО</span><h3>{title}</h3></div><button type="button" onClick={onClose} aria-label="Закрыть">×</button></header>
      {kind === "stage" && <>
        <label><span>Название</span><input name="name" required /></label>
        <label><span>Вес этапа, %</span><input name="weightWithinProject" type="number" min="0" max="100" step="0.01" required /></label>
        <label><span>Ответственный DEPA</span><select name="responsibleUserId"><option value="">Не назначен</option>{employees.map(employee => <option value={employee.id} key={employee.id}>{employee.display_name}</option>)}</select></label>
        <label><span>Начало</span><input name="plannedStartDate" type="date" /></label><label><span>Окончание</span><input name="plannedEndDate" type="date" /></label>
      </>}
      {kind === "task" && <>
        <label><span>Этап</span><select name="stageId" required>{stages.map(stage => <option value={stage.id} key={stage.id}>{stage.name}</option>)}</select></label>
        <label><span>Название</span><input name="name" required /></label>
        <label><span>Ответственный DEPA</span><select name="responsibleUserId"><option value="">Не назначен</option>{employees.map(employee => <option value={employee.id} key={employee.id}>{employee.display_name}</option>)}</select></label>
        <label><span>Тип прогресса</span><select name="progressType"><option value="BINARY">Факт завершения</option><option value="QUANTITY">По количеству</option></select></label>
        <label><span>Единица</span><select name="unit"><option>задача</option><option>м²</option><option>м.п.</option><option>шт.</option><option>точка</option><option>компл.</option><option>помещение</option><option>день</option><option>другое</option></select></label>
        <label><span>Плановый объём</span><input name="plannedQuantity" inputMode="decimal" defaultValue="1" /></label>
        <label><span>Вес внутри этапа, %</span><input name="weightWithinStage" type="number" min="0" max="100" step="0.01" required /></label>
        <label><span>Начало</span><input name="plannedStartDate" type="date" /></label><label><span>Окончание</span><input name="plannedEndDate" type="date" /></label>
        <label className="wide"><span>Описание</span><textarea name="description" rows={3} /></label>
      </>}
      {kind === "report" && <>
        <label><span>Дата отчёта</span><input name="reportDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label className="wide"><span>Выполнено за день</span><textarea name="workCompleted" required rows={4} /></label>
        <label className="wide"><span>Комментарий</span><textarea name="comment" rows={3} /></label>
        <label className="check wide"><input name="commentClientVisible" type="checkbox" value="true" /> Показывать комментарий клиенту</label>
        <fieldset className="wide"><legend>Кто работал сегодня</legend>{employees.map(employee => <label className="check" key={employee.id}><input name="employeeIds" type="checkbox" value={employee.id} /> {employee.display_name}</label>)}{agreements.map(agreement => <label className="check" key={agreement.id}><input name="contractorIds" type="checkbox" value={agreement.contractor_id} /> {agreement.contractor_name}</label>)}</fieldset>
        <fieldset className="wide"><legend>Над какими задачами работали</legend>{tasks.map(task => <label className="check" key={task.id}><input name="taskIds" type="checkbox" value={task.id} /> {task.name}</label>)}</fieldset>
      </>}
      {kind === "delay" && <>
        <label><span>Категория</span><select name="category"><option value="CLIENT">Клиент</option><option value="MATERIALS">Материалы</option><option value="CONTRACTOR">Исполнитель</option><option value="DEPA">DEPA</option><option value="DESIGN">Проект / дизайн</option><option value="EXTERNAL">Внешние причины</option><option value="OTHER">Другое</option></select></label>
        <label><span>Причина</span><input name="reason" required /></label><label><span>Дата начала</span><input name="startDate" type="date" required /></label>
        <label><span>Дней</span><input name="durationDays" type="number" min="0" required /></label>
        <label className="wide"><span>Внутренний комментарий</span><textarea name="internalComment" rows={3} /></label>
        <label className="check wide"><input name="clientVisible" type="checkbox" value="true" /> Показывать клиенту</label>
      </>}
      {kind === "dependency" && <>
        <label><span>Предшествующая задача</span><select name="predecessorTaskId" required>{tasks.map(task => <option value={task.id} key={task.id}>{task.name}</option>)}</select></label>
        <label><span>Следующая задача</span><select name="successorTaskId" required>{tasks.map(task => <option value={task.id} key={task.id}>{task.name}</option>)}</select></label>
        <label><span>Задержка, дней</span><input name="lagDays" type="number" min="0" defaultValue="0" /></label>
      </>}
      {error && <div className="form-error wide">{error}</div>}
      <footer className="wide"><button type="button" onClick={onClose}>Отмена</button><button className="primary" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить"}</button></footer>
    </form>
  </div>;
}

function Gantt({ stages }: { stages: Stage[] }) {
  const [scale, setScale] = useState<"days" | "weeks">("days");
  const tasks = useMemo(() => stages.flatMap(stage => stage.tasks), [stages]);
  const range = useMemo(() => {
    const dates = tasks.flatMap(task => [task.plannedStartDate, task.plannedEndDate]).filter((value): value is number => Boolean(value));
    const min = Math.min(...dates), max = Math.max(...dates);
    return { min: Number.isFinite(min) ? min : 0, span: Math.max(86400, max - min + 86400) };
  }, [tasks]);
  if (!tasks.length) return <div className="project-tab-empty"><span>⌁</span><h4>Создайте задачи для отображения графика.</h4></div>;
  return <div className="gantt"><header><b>Диаграмма Ганта</b><div><button className={scale === "days" ? "active" : ""} onClick={() => setScale("days")}>Дни</button><button className={scale === "weeks" ? "active" : ""} onClick={() => setScale("weeks")}>Недели</button></div></header>
    <div className={`gantt-scroll ${scale}`}>{stages.map(stage => <section key={stage.id}><h4>{stage.name}<span>{Math.round(stage.progressPercent)}%</span></h4>{stage.tasks.map(task => {
      const left = ((Number(task.plannedStartDate ?? range.min) - range.min) / range.span) * 100;
      const width = Math.max(2, ((Number(task.plannedEndDate ?? task.plannedStartDate ?? range.min) - Number(task.plannedStartDate ?? range.min) + 86400) / range.span) * 100);
      const overdue = Boolean(task.plannedEndDate && task.plannedEndDate < Date.now() / 1000 && task.status !== "COMPLETED");
      return <div className="gantt-row" key={task.id}><span>{task.name}</span><div><i className={overdue ? "overdue" : ""} style={{ left: `${left}%`, width: `${width}%` }}><em style={{ width: `${task.progressPercent ?? 0}%` }} /></i></div></div>;
    })}</section>)}</div>
  </div>;
}

function TemplateManager({ templates, access, onChanged }: { templates: Template[]; access: AccessProfile; onChanged: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<ActionDialogConfig | null>(null);
  async function request(method: "POST" | "PATCH", body: Record<string, unknown>) {
    await json(await fetch("/api/production/templates", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    await onChanged();
  }
  async function mutate(body: Record<string, unknown>) {
    setBusy(true);
    try { await request("PATCH", body); } finally { setBusy(false); }
  }
  const numberField = (name: string, label: string, value: string, max = 100) => ({ name, label, type: "number" as const, required: true, value, min: 0, max, step: "any" as const });
  if (!access.actions["productionTemplates.view"]) return null;
  return <><section className="panel production-templates"><header><div><span className="eyebrow">СПРАВОЧНИК</span><h3>Шаблоны производственных планов</h3></div>{access.actions["productionTemplates.create"] && <button disabled={busy} onClick={() => setDialog({ id: "template-create", title: "Новый производственный шаблон", fields: [{ name: "name", label: "Название", required: true }], submitLabel: "Создать шаблон", onSubmit: values => request("POST", { name: values.name }) })}>＋ Создать Template</button>}</header>
    {templates.length ? templates.map(template => {
      const allTasks = (template.stages ?? []).flatMap(stage => stage.tasks);
      const taskOptions = allTasks.map(task => ({ value: task.id, label: task.name }));
      return <article key={template.id}><div><b>{template.name}</b><small>v{template.version ?? 1} · этапов {template.stage_count}</small></div>{access.actions["productionTemplates.edit"] && template.status !== "ARCHIVED" && <div className="task-actions">
        <button disabled={busy} onClick={() => setDialog({ id: `template-stage-add-${template.id}`, title: `Новый этап · ${template.name}`, fields: [{ name: "name", label: "Название этапа", required: true }, numberField("weight", "Вес этапа, %", "100")], onSubmit: values => request("PATCH", { action: "ADD_TEMPLATE_STAGE", templateId: template.id, name: values.name, weight: values.weight, position: template.stages?.length ?? 0 }) })}>＋ Stage</button>
        {(template.stages ?? []).map(stage => <span key={stage.id}><button disabled={busy} onClick={() => setDialog({ id: `template-task-add-${stage.id}`, title: `Новая задача · ${stage.name}`, fields: [{ name: "name", label: "Название задачи", required: true }, numberField("typicalDurationDays", "Типовая длительность, дней", "1", 3650), numberField("weight", "Вес задачи, %", "100")], onSubmit: values => request("PATCH", { action: "ADD_TEMPLATE_TASK", templateId: template.id, stageTemplateId: stage.id, name: values.name, typicalDurationDays: values.typicalDurationDays, weight: values.weight, position: stage.tasks.length, progressType: "BINARY", clientVisible: true }) })}>＋ Task в {stage.name}</button><button disabled={busy} onClick={() => setDialog({ id: `template-stage-edit-${stage.id}`, title: `Редактировать этап · ${stage.name}`, fields: [{ name: "name", label: "Название этапа", required: true, value: stage.name }, numberField("weight", "Вес этапа, %", String(stage.weight))], onSubmit: values => request("PATCH", { action: "UPDATE_TEMPLATE_STAGE", templateId: template.id, stageTemplateId: stage.id, name: values.name, weight: values.weight }) })}>Редактировать Stage</button>
          {stage.tasks.map(task => <span key={task.id}><button disabled={busy} onClick={() => setDialog({ id: `template-hidden-${task.id}`, title: `Требование скрытых работ · ${task.name}`, fields: [{ name: "name", label: "Название требования", required: true }], onSubmit: values => request("PATCH", { action: "ADD_TEMPLATE_PHOTO_REQUIREMENT", templateId: template.id, taskTemplateId: task.id, name: values.name, requiredBeforeCompletion: true }) })}>＋ Hidden Work · {task.name}</button><button disabled={busy} onClick={() => setDialog({ id: `template-task-edit-${task.id}`, title: `Редактировать задачу · ${task.name}`, fields: [numberField("typicalDurationDays", "Типовая длительность, дней", String(task.typical_duration_days), 3650), numberField("weight", "Вес задачи, %", String(task.weight))], onSubmit: values => request("PATCH", { action: "UPDATE_TEMPLATE_TASK", templateId: template.id, taskTemplateId: task.id, typicalDurationDays: values.typicalDurationDays, weight: values.weight }) })}>Редактировать Task</button></span>)}</span>)}
        {allTasks.length > 1 && <button disabled={busy} onClick={() => setDialog({ id: `template-dependency-${template.id}`, title: `Зависимость задач · ${template.name}`, fields: [{ name: "predecessorTaskTemplateId", label: "Предшествующая задача", type: "select", required: true, options: taskOptions }, { name: "successorTaskTemplateId", label: "Следующая задача", type: "select", required: true, value: taskOptions[1]?.value, options: taskOptions }, numberField("lagDays", "Задержка, дней", "0", 3650)], validate: values => values.predecessorTaskTemplateId === values.successorTaskTemplateId ? "Выберите две разные задачи." : null, onSubmit: values => request("PATCH", { action: "ADD_TEMPLATE_DEPENDENCY", templateId: template.id, predecessorTaskTemplateId: values.predecessorTaskTemplateId, successorTaskTemplateId: values.successorTaskTemplateId, lagDays: values.lagDays }) })}>＋ Dependency</button>}
      </div>}{access.actions["productionTemplates.archive"] && template.status !== "ARCHIVED" && <button disabled={busy} onClick={() => { if (window.confirm(`Архивировать шаблон «${template.name}»?`)) void mutate({ action: "ARCHIVE_TEMPLATE", templateId: template.id }); }}>Архивировать</button>}</article>;
    }) : <p>Шаблонов пока нет. Это нормальное production-состояние.</p>}
  </section>{dialog ? <StructuredActionDialog key={dialog.id} config={dialog} onClose={() => setDialog(null)} /> : null}</>;
}

export function ProductionCore({ projectId, access, view }: { projectId: string; access: AccessProfile; view: "production" | "gantt" | "reports" }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [actionDialog, setActionDialog] = useState<ActionDialogConfig | null>(null);

  async function reload() {
    const result = await json<Data>(await fetch(`/api/production?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }));
    setData(result); setError(""); return result;
  }
  useEffect(() => {
    let active = true;
    fetch(`/api/production?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }).then(response => json<Data>(response)).then(result => { if (active) { setData(result); setError(""); } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Не удалось загрузить производство."); });
    return () => { active = false; };
  }, [projectId]);
  async function save(url: string, body: Record<string, unknown>) {
    const result = await json<Data | SchedulePreview>(await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    if ("stages" in result) setData(result);
    return result;
  }
  async function act(body: Record<string, unknown>) {
    try { return await save("/api/production", { projectId, ...body }); }
    catch (reason) {
      const productionError = reason as Error & { warning?: string; requirements?: { name: string }[] };
      if (productionError.warning === "HIDDEN_WORK_MISSING" && window.confirm(`Не выполнена фотофиксация:\n${(productionError.requirements ?? []).map(item => `— ${item.name}`).join("\n")}\n\nЗавершить без фото?`)) return save("/api/production", { projectId, ...body, force: true });
      setError(productionError.message); return null;
    }
  }
  function rescheduleTask(task: Task) {
    setActionDialog({ id: `reschedule-${task.id}`, title: `Изменить график · ${task.name}`, description: "Даты пройдут через существующий schedule engine. Зависимые задачи будут показаны перед каскадным пересчётом.", fields: [{ name: "plannedStartDate", label: "Новая дата начала", type: "date", required: true, value: isoDate(task.plannedStartDate) }, { name: "plannedEndDate", label: "Новая дата окончания", type: "date", required: true, value: isoDate(task.plannedEndDate) }], validate: values => values.plannedEndDate < values.plannedStartDate ? "Дата окончания не может быть раньше даты начала." : null, onSubmit: async values => {
      const preview = await act({ action: "RESCHEDULE", taskId: task.id, plannedStartDate: values.plannedStartDate, plannedEndDate: values.plannedEndDate });
      if (!preview) throw new Error("Не удалось изменить график.");
      if ("confirmationRequired" in preview && window.confirm(`Изменение затронет зависимые задачи: ${preview.affectedCount}. Пересчитать график каскадно?`)) {
        const result = await act({ action: "RESCHEDULE", taskId: task.id, plannedStartDate: values.plannedStartDate, plannedEndDate: values.plannedEndDate, cascade: true });
        if (!result) throw new Error("Не удалось каскадно пересчитать график.");
      }
    } });
  }
  async function acceptance(action: "RESUBMIT" | "MANUAL_ACCEPT", stageId: string, comment: string) {
    const response = await fetch("/api/client-portal/acceptance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, stageId, comment }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "Не удалось обновить приёмку этапа.");
    await reload();
  }
  async function uploadPhoto(file: File, entity: { reportId?: string; requirementId?: string }) {
    const category = entity.requirementId ? "HIDDEN_WORK" : "DAILY_REPORT";
    if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) throw new Error("Разрешены изображения до 20 МБ.");
    const attachmentId = crypto.randomUUID();
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type.includes("hei") ? "heic" : "jpg";
    await upload(`depa-os/${category.toLowerCase().replace("_", "-")}/${attachmentId}.${ext}`, file, { access: "private", handleUploadUrl: "/api/files/upload", clientPayload: JSON.stringify({ attachmentId, originalFilename: file.name, mimeType: file.type, sizeBytes: file.size, category, visibility: "CLIENT", entityType: entity.requirementId ? "TaskPhotoRequirement" : "DailyReport", entityId: entity.requirementId ?? entity.reportId, projectId }) });
    await act({ action: "LINK_PHOTO", attachmentId, photoRequirementId: entity.requirementId, dailyReportId: entity.reportId });
  }

  if (!data) return <div className="finance-loading">{error || "Загружаем производственный план…"}</div>;
  if (!data.plan) return <><div className="production-empty"><span>⌁</span><h3>Производственный план не создан.</h3><p>Создайте пустой план или скопируйте независимую структуру из шаблона.</p>
    {access.actions["production.createPlan"] && <div><button className="primary" onClick={() => void act({ action: "CREATE_PLAN" })}>Создать пустой план</button>{data.templates.map(template => <button key={template.id} onClick={() => void act({ action: "CREATE_PLAN", templateId: template.id, startDate: new Date().toISOString().slice(0, 10) })}>Из шаблона «{template.name}»</button>)}</div>}
    {access.actions["productionTemplates.create"] && <button className="link" onClick={() => setActionDialog({ id: "empty-template-create", title: "Новый производственный шаблон", fields: [{ name: "name", label: "Название", required: true }], submitLabel: "Создать шаблон", onSubmit: async values => { await json(await fetch("/api/production/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: values.name }) })); await reload(); } })}>＋ Создать Template</button>}
    {error && <div className="form-error">{error}</div>}
  </div>{actionDialog ? <StructuredActionDialog key={actionDialog.id} config={actionDialog} onClose={() => setActionDialog(null)} /> : null}</>;
  if (view === "gantt") return <Gantt stages={data.stages} />;
  if (view === "reports") return <div className="production-reports"><header><div><h3>Дневные отчёты</h3><p>Один основной отчёт на объект за календарный день.</p></div>{access.actions["dailyReports.create"] && <button className="primary" onClick={() => setForm("report")}>＋ Добавить отчёт за день</button>}</header>
    {data.reports.length ? data.reports.map(report => <article className="panel" key={report.id}><div><b>{formatDate(report.report_date)} · {report.author_name}</b><p>{report.work_completed}</p>{report.comment && <small>{report.comment_client_visible ? "Клиенту: " : "Внутренний: "}{report.comment}</small>}</div><span>{report.worker_count} чел. · {report.photo_count} фото</span>{access.actions["dailyReports.uploadPhotos"] && <label className="secondary upload">Загрузить фото<input type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file, { reportId: report.id }).catch(reason => setError(reason instanceof Error ? reason.message : "Ошибка загрузки")); }} /></label>}</article>) : <div className="project-tab-empty"><span>▣</span><h4>Отчётов пока нет.</h4></div>}
    {error && <div className="form-error">{error}</div>}{form && <ActionForm kind={form} projectId={projectId} stages={data.stages} tasks={data.tasks} employees={data.employees} agreements={data.agreements} onClose={() => setForm(null)} onSave={save} />}
  </div>;

  return <div className="production-core">
    <header className="production-summary"><div><span className="eyebrow">ГОТОВНОСТЬ ОБЪЕКТА</span><b>{Math.round(data.progress.production)}%</b><Progress value={data.progress.production} /><small>Внутренний прогноз: {formatDate(data.forecast.internal)} · опубликован: {formatDate(data.forecast.published)}</small></div>
      <div className="production-actions">{access.actions["production.manageStages"] && <button onClick={() => setForm("stage")}>＋ Этап</button>}{access.actions["production.manageTasks"] && <button onClick={() => setForm("task")}>＋ Задача</button>}{access.actions["production.manageDependencies"] && data.tasks.length > 1 && <button onClick={() => setForm("dependency")}>＋ Зависимость</button>}{access.actions["production.manageDelays"] && <button onClick={() => setForm("delay")}>＋ Простой</button>}{access.actions["production.manageSchedule"] && data.forecast.internal && data.forecast.internal !== data.forecast.published && <button onClick={() => void act({ action: "PUBLISH_FORECAST" })}>Опубликовать прогноз</button>}</div>
    </header>
    <StagePaymentPlanForm projectId={projectId} stages={data.stages} access={access} onError={setError}/>
    {!data.weightValidation.valid && <div className="form-error">{data.weightValidation.message} {access.actions["production.manageStages"] && <button onClick={() => void act({ action: "NORMALIZE_WEIGHTS" })}>Распределить равномерно</button>}</div>}
    {error && <div className="form-error">{error}</div>}
    <div className="production-stages">{data.stages.map(stage => <section className="panel production-stage" key={stage.id}>
      <button className="production-stage-head" onClick={() => setOpen(current => { const next = new Set(current); if (next.has(stage.id)) next.delete(stage.id); else next.add(stage.id); return next; })}><span><small>{statuses[stage.status] || stage.status}</small><b>{stage.name}</b><em>{stage.responsibleName || "Ответственный не назначен"} · {stage.completedCount} из {stage.taskCount} задач · {formatDate(stage.plannedStartDate)} — {formatDate(stage.plannedEndDate)}</em></span><Progress value={stage.progressPercent} /><i>{open.has(stage.id) ? "⌃" : "⌄"}</i></button>
      {open.has(stage.id) && <div className="production-task-list">
        {access.actions["stageAcceptance.view"]?<div className="stage-acceptance-internal"><span>Приёмка клиента: <b>{stage.acceptanceStatus}</b></span>{stage.acceptanceStatus==="REJECTED"&&access.actions["stageAcceptance.resubmit"]?<button onClick={()=>setActionDialog({id:`stage-resubmit-${stage.id}`,title:`Повторно передать этап · ${stage.name}`,fields:[{name:"comment",label:"Комментарий при повторной передаче",type:"textarea"}],submitLabel:"Передать повторно",onSubmit:values=>acceptance("RESUBMIT",stage.id,values.comment||"")})}>Повторно передать</button>:null}{stage.acceptanceStatus!=="ACCEPTED"&&access.actions["obligations.manage"]?<button onClick={()=>setActionDialog({id:`stage-manual-${stage.id}`,title:`Ручная приёмка · ${stage.name}`,description:"Основание обязательно и будет сохранено существующей операцией приёмки.",fields:[{name:"comment",label:"Основание ручной приёмки",type:"textarea",required:true}],submitLabel:"Отметить принятым",onSubmit:values=>acceptance("MANUAL_ACCEPT",stage.id,values.comment)})}>Принято вручную</button>:null}</div>:null}
        {!stage.weightValidation.valid && <div className="form-error">{stage.weightValidation.message} {access.actions["production.manageTasks"] && <button onClick={() => void act({ action: "NORMALIZE_WEIGHTS", stageId: stage.id })}>Распределить равномерно</button>}</div>}
        {stage.tasks.map(task => <article key={task.id}><div><b>{task.name}</b><small>{task.responsibleName || "Ответственный DEPA не назначен"} · вес {task.weightWithinStage}%</small><small>Исполнители: {task.contractors.length ? task.contractors.map(item => item.contractor_name).join(", ") : "не назначены"}</small>{task.description && <p>{task.description}</p>}
          {task.photoRequirements.map(requirement => <div className="hidden-requirement" key={requirement.id}><span>{requirement.name}: {requirement.photo_count} фото {requirement.photo_count ? "✓" : ""}</span>{access.actions["hiddenWorks.upload"] && <label className="link upload">Загрузить Hidden Work photo<input type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file, { requirementId: requirement.id }).catch(reason => setError(reason instanceof Error ? reason.message : "Ошибка загрузки")); }} /></label>}</div>)}
        </div><div className="task-fact">{task.progressType === "QUANTITY" ? <span>План {task.plannedQuantity} · Выполнено {task.completedQuantity} · Осталось {task.remainingQuantity} {task.unit}</span> : <span>{statuses[task.status] || task.status}</span>}<Progress value={task.progressPercent ?? 0} /><small>План: {formatDate(task.plannedStartDate)} — {formatDate(task.plannedEndDate)} · Факт: {formatDate(task.actualStartDate)} — {formatDate(task.actualEndDate)}</small></div>
          <div className="task-actions">{access.actions["production.updateProgress"] && <>{task.progressType === "QUANTITY" && <button onClick={() => setActionDialog({id:`task-quantity-${task.id}`,title:`Обновить факт · ${task.name}`,fields:[{name:"completedQuantity",label:`Выполнено${task.unit?` (${task.unit})`:""}`,type:"number",required:true,value:String(task.completedQuantity??0),min:0,step:"any"}],submitLabel:"Обновить факт",onSubmit:async values=>{if(!await act({action:"UPDATE_TASK",taskId:task.id,completedQuantity:values.completedQuantity}))throw new Error("Не удалось обновить факт.")}})}>Обновить факт</button>}{task.status === "NOT_STARTED" && <button onClick={() => void act({ action: "UPDATE_TASK", taskId: task.id, status: "IN_PROGRESS" })}>Начать</button>}{task.status !== "COMPLETED" ? <button onClick={() => void act({ action: "UPDATE_TASK", taskId: task.id, status: "COMPLETED" })}>Завершить</button> : <button onClick={() => void act({ action: "UPDATE_TASK", taskId: task.id, status: "IN_PROGRESS" })}>Вернуть в работу</button>}</>}
            {access.actions["production.manageSchedule"] && <button onClick={() => rescheduleTask(task)}>Пересчитать график</button>}
            {access.actions["production.manageTasks"] && <button onClick={() => setActionDialog({id:`task-hidden-${task.id}`,title:`Скрытая работа · ${task.name}`,fields:[{name:"name",label:"Требование фотофиксации",required:true}],submitLabel:"Добавить требование",onSubmit:async values=>{if(!await act({action:"ADD_PHOTO_REQUIREMENT",taskId:task.id,name:values.name,requiredBeforeCompletion:true}))throw new Error("Не удалось добавить требование.")}})}>＋ Скрытая работа</button>}
            {access.actions["production.manageTasks"] && data.agreements.length > 0 && <button onClick={() => setActionDialog({id:`task-contractor-${task.id}`,title:`Назначить исполнителя · ${task.name}`,fields:[{name:"contractorAgreementId",label:"Исполнитель / соглашение",type:"select",required:true,options:data.agreements.map(item=>({value:item.id,label:`${item.contractor_name} · ${item.work_title}`}))}],submitLabel:"Назначить",onSubmit:async values=>{if(!await act({action:"ASSIGN_CONTRACTOR",taskId:task.id,contractorAgreementId:values.contractorAgreementId}))throw new Error("Не удалось назначить исполнителя.")}})}>＋ Исполнитель</button>}
          </div>
        </article>)}
      </div>}
      {stage.taskCount > 0 && stage.completedCount === stage.taskCount && stage.status !== "COMPLETED" && access.actions["production.manageStages"] && <button className="primary production-stage-complete" onClick={() => void act({ action: "COMPLETE_STAGE", stageId: stage.id })}>Завершить этап</button>}
    </section>)}</div>
    {data.delays.length > 0 && <section className="production-delay-list"><h3>Простои</h3>{data.delays.map(delay => <article className="panel" key={delay.id}><b>{delay.category} · +{delay.days} дн.</b><span>{delay.reason}{delay.client_visible ? " · показывается клиенту" : " · внутренний"}</span>{!delay.end_date && access.actions["production.manageDelays"] && <button onClick={() => void act({ action: "CLOSE_DELAY", delayId: delay.id })}>Закрыть простой</button>}</article>)}</section>}
    <TemplateManager templates={data.templates} access={access} onChanged={reload} />
    {form && <ActionForm kind={form} projectId={projectId} stages={data.stages} tasks={data.tasks} employees={data.employees} agreements={data.agreements} onClose={() => setForm(null)} onSave={save} />}
    {actionDialog ? <StructuredActionDialog key={actionDialog.id} config={actionDialog} onClose={() => setActionDialog(null)} /> : null}
  </div>;
}
