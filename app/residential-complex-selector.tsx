"use client";

import { useEffect, useId, useRef, useState } from "react";

export type ResidentialComplexAddressOption = {
  id: string;
  address: string;
  position: number;
};

export type ResidentialComplexOption = {
  id: string;
  name: string;
  city: string;
  addresses: ResidentialComplexAddressOption[];
  primaryAddress: string | null;
  addressCount: number;
  developer: string | null;
  status: "ACTIVE" | "ARCHIVED";
};

async function readJson<T>(response: Response) {
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw Object.assign(new Error(result.error || "Не удалось выполнить операцию."), result);
  return result;
}

function AddressRows({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  return <fieldset className="rc-address-editor wide">
    <legend>Адреса *</legend>
    {values.map((value, index) => <div className="rc-address-row" key={index}>
      <label><span>Адрес {index + 1}</span><input value={value} required onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>
      <button type="button" className="secondary" disabled={values.length === 1} aria-label={`Удалить адрес ${index + 1}`} onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}>Удалить</button>
    </div>)}
    <button type="button" className="link" onClick={() => onChange([...values, ""])}>+ Добавить адрес</button>
  </fieldset>;
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
  const [addresses, setAddresses] = useState([""]);
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
    setError(""); setDuplicate(null);
    const payload = Object.fromEntries(new FormData(formRef.current));
    try {
      const item = await readJson<ResidentialComplexOption>(await fetch("/api/residential-complexes", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, addresses, allowDuplicate }),
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
      <input id={inputId} value={query} autoComplete="off" placeholder="Найти по названию, адресу или застройщику" onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); if (value) onChange(null); setOpen(true); }} />
      {value ? <button type="button" className="link" onClick={() => { setQuery(""); onChange(null); }}>Очистить</button> : null}
      {canCreate ? <button type="button" className="link" onClick={() => { setAddresses([""]); setCreating(true); setOpen(false); }}>+ Добавить ЖК</button> : null}
    </div>
    {open ? <div className="rc-selector-menu" role="listbox">
      {items.length ? items.map((item) => <button type="button" role="option" aria-selected={item.id === value} key={item.id} onClick={() => { setQuery(item.name); onChange(item); setOpen(false); }}>
        <b>{item.name}</b><small>{item.city} · {item.primaryAddress}{item.addressCount > 1 ? ` · ещё ${item.addressCount - 1}` : ""}{item.status === "ARCHIVED" ? " · Архив" : ""}</small>
      </button>) : <p>ЖК не найдены</p>}
    </div> : null}
    {error ? <p className="form-error">{error}</p> : null}
    {creating ? <div className="modal-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}>
      <form ref={formRef} className="rc-inline-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <header><div><span className="eyebrow">СПРАВОЧНИК ЖК</span><h3>Новый жилой комплекс</h3></div><button type="button" aria-label="Закрыть" onClick={() => setCreating(false)}>×</button></header>
        <label><span>Название *</span><input name="name" defaultValue={query} required autoFocus /></label>
        <label><span>Город *</span><input name="city" required /></label>
        <AddressRows values={addresses} onChange={setAddresses} />
        <label><span>Застройщик</span><input name="developer" /></label>
        <label className="wide"><span>Комментарий</span><textarea name="comment" rows={3} /></label>
        {duplicate ? <div className="wide duplicate-warning"><b>Возможный дубль: {duplicate.name}</b><span>{duplicate.city} · {duplicate.primaryAddress}</span><button type="button" className="link" onClick={() => { setCreating(false); setQuery(duplicate.name); onChange(duplicate); }}>Выбрать существующий</button></div> : null}
        {error ? <p className="form-error wide">{error}</p> : null}
        <footer className="wide"><button type="button" className="secondary" onClick={() => setCreating(false)}>Отмена</button>{duplicate ? <button type="button" className="secondary" onClick={() => void create(true)}>Всё равно создать</button> : null}<button type="submit">Создать ЖК</button></footer>
      </form>
    </div> : null}
  </div>;
}

export function ResidentialComplexFields({ initialId, initialName, initialAddressId, initialAddress, canCreate, addressName = "address", addressLabel = "Адрес *", addressRequired = true }: {
  initialId?: string | null;
  initialName?: string | null;
  initialAddressId?: string | null;
  initialAddress?: string | null;
  canCreate: boolean;
  addressName?: string;
  addressLabel?: string;
  addressRequired?: boolean;
}) {
  const [id, setId] = useState(initialId || "");
  const [name, setName] = useState(initialName || "");
  const [selected, setSelected] = useState<ResidentialComplexOption | null>(null);
  const [addressId, setAddressId] = useState(initialAddressId || "");
  const [freeAddress, setFreeAddress] = useState(initialAddress || "");
  const addresses = selected?.addresses ?? [];
  useEffect(() => {
    if (!initialId) return;
    const controller = new AbortController();
    fetch(`/api/residential-complexes/${initialId}`, { cache: "no-store", signal: controller.signal })
      .then((response) => readJson<ResidentialComplexOption>(response))
      .then((item) => {
        setSelected(item);
        const exact = item.addresses.find((address) => address.id === initialAddressId) ?? item.addresses.find((address) => address.address === initialAddress) ?? (item.addresses.length === 1 ? item.addresses[0] : null);
        if (exact) { setAddressId(exact.id); setFreeAddress(exact.address); }
      })
      .catch((reason) => { if (reason?.name !== "AbortError") return; });
    return () => controller.abort();
  }, [initialId, initialAddressId, initialAddress]);
  return <>
    <input type="hidden" name="residentialComplexId" value={id} />
    <input type="hidden" name="residentialComplex" value={name} />
    <input type="hidden" name="residentialComplexAddressId" value={addressId} />
    <ResidentialComplexSelector value={id} initialName={initialName} canCreate={canCreate} onChange={(item) => {
      setId(item?.id || ""); setName(item?.name || ""); setSelected(item);
      if (!item) { setAddressId(""); return; }
      const exact = item.addresses.find((address) => address.id === initialAddressId) ?? (item.addresses.length === 1 ? item.addresses[0] : null);
      setAddressId(exact?.id || ""); setFreeAddress(exact?.address || "");
    }} />
    {id ? <label><span>{addressLabel}</span><select value={addressId} required={addressRequired} onChange={(event) => { const next = addresses.find((item) => item.id === event.target.value); setAddressId(event.target.value); setFreeAddress(next?.address || ""); }}>
      {addresses.length > 1 ? <option value="">Выберите точный адрес</option> : null}
      {addresses.map((item) => <option value={item.id} key={item.id}>{item.address}</option>)}
    </select><input type="hidden" name={addressName} value={freeAddress} /></label> : <label><span>{addressLabel}</span><input name={addressName} value={freeAddress} required={addressRequired} onChange={(event) => setFreeAddress(event.target.value)} /></label>}
  </>;
}
