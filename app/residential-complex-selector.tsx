"use client";

import { useEffect, useId, useRef, useState } from "react";

export type ResidentialComplexOption = {
  id: string;
  name: string;
  city: string;
  address: string;
  developer: string | null;
  status: "ACTIVE" | "ARCHIVED";
};

async function readJson<T>(response: Response) {
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw Object.assign(new Error(result.error || "Не удалось выполнить операцию."), result);
  return result;
}

export function ResidentialComplexSelector({ value, initialName, canCreate, onChange }: {
  value: string;
  initialName?: string | null;
  canCreate: boolean;
  onChange: (item: ResidentialComplexOption | null) => void;
}) {
  const inputId = useId();
  const [query, setQuery] = useState(initialName || "");
  const [items, setItems] = useState<ResidentialComplexOption[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<ResidentialComplexOption | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ selector: "1", limit: "12" });
      if (query.trim()) params.set("search", query.trim());
      if (value) params.set("includeId", value);
      fetch(`/api/residential-complexes?${params}`, { cache: "no-store", signal: controller.signal })
        .then((response) => readJson<{ items: ResidentialComplexOption[] }>(response))
        .then((result) => setItems(result.items))
        .catch((reason) => { if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Не удалось загрузить ЖК."); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, value]);

  async function create(allowDuplicate = false) {
    if (!formRef.current) return;
    setError("");
    setDuplicate(null);
    const payload = Object.fromEntries(new FormData(formRef.current));
    try {
      const item = await readJson<ResidentialComplexOption>(await fetch("/api/residential-complexes", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, allowDuplicate }),
      }));
      setCreating(false); setQuery(item.name); onChange(item);
    } catch (reason) {
      const failure = reason as Error & { code?: string; duplicates?: ResidentialComplexOption[] };
      if (failure.code === "POSSIBLE_DUPLICATE" && failure.duplicates?.length) setDuplicate(failure.duplicates[0]);
      else setError(failure.message);
    }
  }

  return <div className="rc-selector">
    <label htmlFor={inputId}><span>ЖК</span></label>
    <div className="rc-selector-control">
      <input id={inputId} value={query} autoComplete="off" placeholder="Найти по названию, адресу или застройщику"
        onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); if (value) onChange(null); setOpen(true); }} />
      {value ? <button type="button" className="link" onClick={() => { setQuery(""); onChange(null); }}>Очистить</button> : null}
      {canCreate ? <button type="button" className="link" onClick={() => { setCreating(true); setOpen(false); }}>+ Добавить ЖК</button> : null}
    </div>
    {open ? <div className="rc-selector-menu" role="listbox">
      {items.length ? items.map((item) => <button type="button" role="option" aria-selected={item.id === value} key={item.id}
        onClick={() => { setQuery(item.name); onChange(item); setOpen(false); }}>
        <b>{item.name}</b><small>{item.city} · {item.address}{item.status === "ARCHIVED" ? " · Архив" : ""}</small>
      </button>) : <p>ЖК не найдены</p>}
    </div> : null}
    {error ? <p className="form-error">{error}</p> : null}
    {creating ? <div className="modal-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}>
      <form ref={formRef} className="rc-inline-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <header><div><span className="eyebrow">СПРАВОЧНИК ЖК</span><h3>Новый жилой комплекс</h3></div><button type="button" aria-label="Закрыть" onClick={() => setCreating(false)}>×</button></header>
        <label><span>Название *</span><input name="name" defaultValue={query} required autoFocus /></label>
        <label><span>Город *</span><input name="city" required /></label>
        <label className="wide"><span>Адрес *</span><input name="address" required /></label>
        <label><span>Застройщик</span><input name="developer" /></label>
        <label><span>Район</span><input name="district" /></label>
        <label className="wide"><span>Комментарий</span><textarea name="comment" rows={3} /></label>
        {duplicate ? <div className="wide duplicate-warning"><b>Возможный дубль: {duplicate.name}</b><span>{duplicate.city} · {duplicate.address}</span><button type="button" className="link" onClick={() => { setCreating(false); setQuery(duplicate.name); onChange(duplicate); }}>Выбрать существующий</button></div> : null}
        {error ? <p className="form-error wide">{error}</p> : null}
        <footer className="wide"><button type="button" className="secondary" onClick={() => setCreating(false)}>Отмена</button>{duplicate ? <button type="button" className="secondary" onClick={() => void create(true)}>Всё равно создать</button> : null}<button type="submit">Создать ЖК</button></footer>
      </form>
    </div> : null}
  </div>;
}

export function ResidentialComplexFields({ initialId, initialName, initialAddress, canCreate, addressName = "address", addressLabel = "Адрес *", addressRequired = true }: {
  initialId?: string | null;
  initialName?: string | null;
  initialAddress?: string | null;
  canCreate: boolean;
  addressName?: string;
  addressLabel?: string;
  addressRequired?: boolean;
}) {
  const [id, setId] = useState(initialId || "");
  const [name, setName] = useState(initialName || "");
  const [address, setAddress] = useState(initialAddress || "");
  const [addressDirty, setAddressDirty] = useState(false);
  return <>
    <input type="hidden" name="residentialComplexId" value={id} />
    <input type="hidden" name="residentialComplex" value={name} />
    <ResidentialComplexSelector value={id} initialName={initialName} canCreate={canCreate} onChange={(item) => {
      setId(item?.id || ""); setName(item?.name || "");
      if (!item) return;
      if (!addressDirty || address === initialAddress || window.confirm("Заменить введённый адрес адресом выбранного ЖК?")) { setAddress(item.address); setAddressDirty(false); }
    }} />
    <label><span>{addressLabel}</span><input name={addressName} value={address} required={addressRequired} onChange={(event) => { setAddress(event.target.value); setAddressDirty(true); }} /></label>
  </>;
}
