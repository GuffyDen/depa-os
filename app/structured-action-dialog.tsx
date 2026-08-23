"use client";

import { FormEvent, useState } from "react";

export type ActionDialogField = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "date" | "select";
  required?: boolean;
  value?: string;
  min?: number;
  max?: number;
  step?: number | "any";
  placeholder?: string;
  options?: { value: string; label: string }[];
};

export type ActionDialogConfig = {
  id: string;
  title: string;
  description?: string;
  submitLabel?: string;
  danger?: boolean;
  fields: ActionDialogField[];
  validate?: (values: Record<string, string>) => string | null;
  onSubmit: (values: Record<string, string>) => Promise<void>;
};

export function StructuredActionDialog({ config, onClose }: { config: ActionDialogConfig; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    const validationError = config.validate?.(values);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await config.onSubmit(values);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось выполнить операцию.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-wrap structured-action-wrap" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) onClose(); }}>
    <form className="modal structured-action-dialog" role="dialog" aria-modal="true" aria-labelledby={`${config.id}-title`} onSubmit={submit}>
      <header className="modal-head"><div><span className="eyebrow">DEPA OS</span><h3 id={`${config.id}-title`}>{config.title}</h3></div><button type="button" disabled={saving} onClick={onClose} aria-label="Закрыть">×</button></header>
      {config.description ? <p className="structured-action-description">{config.description}</p> : null}
      <div className="structured-action-fields">{config.fields.map((field) => <label key={field.name}><span>{field.label}{field.required ? " *" : ""}</span>{field.type === "textarea"
        ? <textarea name={field.name} required={field.required} defaultValue={field.value} placeholder={field.placeholder} rows={4} />
        : field.type === "select"
          ? <select name={field.name} required={field.required} defaultValue={field.value}>{field.options?.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
          : <input name={field.name} type={field.type ?? "text"} required={field.required} defaultValue={field.value} min={field.min} max={field.max} step={field.step} placeholder={field.placeholder} />}</label>)}</div>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <footer className="modal-actions"><button type="button" disabled={saving} onClick={onClose}>Отмена</button><button className={config.danger ? "danger-action" : "primary"} type="submit" disabled={saving}>{saving ? "Сохраняем…" : config.submitLabel ?? "Сохранить"}</button></footer>
    </form>
  </div>;
}
