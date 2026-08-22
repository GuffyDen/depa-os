"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ACCESS_PRESETS, ACTION_GROUPS, MODULE_DEFINITIONS, SCOPE_DEFINITIONS, profileFromPreset,
  type AccessPreset, type AccessProfile, type ActionPermission, type ModuleKey, type ScopeValue,
} from "../lib/permission-definitions";
import type { TeamAccessMember } from "../lib/team-access";
import { money } from "./finance-ui";

const viewActionByModule: Partial<Record<ModuleKey, ActionPermission>> = {
  crm: "crm.view", clients: "clients.view", orders: "orders.view", projects: "projects.view", tasks: "tasks.view",
  finance: "finance.view", team: "team.view", contractors: "contractors.view", documents: "documents.view",
};

function copyProfile(profile: AccessProfile): AccessProfile {
  return { isOwner: profile.isOwner, modules: { ...profile.modules }, actions: { ...profile.actions }, scopes: { ...profile.scopes }, ownCashbox: profile.ownCashbox };
}

function PermissionEditor({ value, onChange }: { value: AccessProfile; onChange: (profile: AccessProfile) => void }) {
  function setModule(module: ModuleKey, enabled: boolean) {
    const next = copyProfile(value);
    next.modules[module] = enabled;
    const viewAction = viewActionByModule[module];
    if (viewAction) next.actions[viewAction] = enabled;
    onChange(next);
  }
  function setAction(permission: ActionPermission, enabled: boolean) {
    const next = copyProfile(value); next.actions[permission] = enabled; onChange(next);
  }
  function setScope(key: keyof AccessProfile["scopes"], scope: ScopeValue) {
    const next = copyProfile(value); next.scopes[key] = scope; onChange(next);
  }
  return <div className="permission-editor">
    <section className="permission-block"><header><span className="eyebrow">ДОСТУП К РАЗДЕЛАМ</span><p>В меню сотрудника появятся только включённые разделы.</p></header><div className="module-permission-grid">
      {MODULE_DEFINITIONS.map((item) => <label key={item.key}><input type="checkbox" checked={value.modules[item.key]} onChange={(event) => setModule(item.key, event.target.checked)} /><span>{item.label}</span></label>)}
    </div></section>
    {ACTION_GROUPS.map((group) => value.modules[group.module] ? <details className="permission-block permission-group" open={group.module === "finance"} key={`${group.module}-${group.label}`}>
      <summary><span>{group.label}</span><small>Действия и область данных</small></summary>
      <div className="permission-group-body">
        {group.module === "finance" ? <label className="permission-toggle featured"><span><b>Иметь собственную кассу</b><small>Касса создаётся или активируется при сохранении</small></span><input type="checkbox" checked={value.ownCashbox} onChange={(event) => { const next = copyProfile(value); next.ownCashbox = event.target.checked; onChange(next); }} /></label> : null}
        {SCOPE_DEFINITIONS.filter((item) => item.module === group.module && (group.label === "Дизайн-проекты" ? item.key === "design" : group.label === "Сметы и КП" ? item.key === "estimates" : item.key !== "design" && item.key !== "estimates")).map((item) => <fieldset className="scope-control" key={item.key}><legend>{item.label}</legend><label><input type="radio" name={`scope-${item.key}`} checked={value.scopes[item.key] !== "ALL"} onChange={() => setScope(item.key, item.default)} />{item.ownLabel}</label><label><input type="radio" name={`scope-${item.key}`} checked={value.scopes[item.key] === "ALL"} onChange={() => setScope(item.key, "ALL")} />{item.allLabel}</label></fieldset>)}
        <div className="action-permission-grid">{group.actions.filter(([permission]) => permission !== "team.managePermissions").map(([permission, label]) => <label key={permission}><input type="checkbox" checked={value.actions[permission]} onChange={(event) => setAction(permission, event.target.checked)} /><span>{label}</span></label>)}</div>
      </div>
    </details> : null)}
  </div>;
}

function PresetPicker({ value, onChange }: { value: AccessPreset; onChange: (preset: AccessPreset) => void }) {
  return <label className="wide"><span>Шаблон доступа</span><select value={value} onChange={(event) => onChange(event.target.value as AccessPreset)}>{Object.entries(ACCESS_PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}</select><small>Шаблон заполняет настройки один раз. После этого их можно менять вручную.</small></label>;
}

function EmployeeAccessModal({ member, onClose, onSaved }: { member?: TeamAccessMember; onClose: () => void; onSaved: () => void }) {
  const editing = Boolean(member);
  const hasUser = Boolean(member?.userId);
  const [accessEnabled, setAccessEnabled] = useState(member ? member.accessEnabled : true);
  const [profile, setProfile] = useState<AccessProfile>(() => member ? copyProfile(member.access) : profileFromPreset("CUSTOM"));
  const [preset, setPreset] = useState<AccessPreset>("CUSTOM");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>, confirmNonZero = false) {
    event.preventDefault(); setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    const payload = hasUser ? { userId: member!.userId, accessEnabled, access: profile, preset, confirmNonZero } : editing ? {
      employeeId: member!.employeeId, username: form.get("username"), initialPassword: form.get("initialPassword"), preset, access: profile,
    } : {
      fullName: form.get("fullName"), phone: form.get("phone"), position: form.get("position"), status: form.get("status"), accessEnabled,
      username: form.get("username"), initialPassword: form.get("initialPassword"), preset, access: profile,
    };
    try {
      let response = await fetch("/api/team/access", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      let result = await response.json() as { error?: string; requiresConfirmation?: boolean };
      if (!response.ok && result.requiresConfirmation && !confirmNonZero) {
        if (!window.confirm(`${result.error ?? "Касса имеет ненулевой остаток"}\nИстория сохранится. Деактивировать кассу?`)) return;
        response = await fetch("/api/team/access", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, confirmNonZero: true }) });
        result = await response.json() as typeof result;
      }
      if (!response.ok) throw new Error(result.error || "Не удалось сохранить сотрудника.");
      onSaved(); onClose();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Не удалось сохранить сотрудника."); }
    finally { setSaving(false); }
  }
  function applyPreset(nextPreset: AccessPreset) { setPreset(nextPreset); setProfile(profileFromPreset(nextPreset)); }
  return <div className="modal-wrap"><form className="modal team-access-modal" onSubmit={submit}>
    <div className="modal-head"><div><span className="eyebrow">{editing ? "НАСТРОЙКА ДОСТУПА" : "НОВЫЙ СОТРУДНИК"}</span><h3>{editing ? member!.name : "Добавить сотрудника"}</h3></div><button type="button" onClick={onClose}>×</button></div>
    {!editing ? <div className="form-grid employee-fields"><label className="wide"><span>ФИО</span><input name="fullName" required placeholder="Сергей Иванов" /></label><label><span>Телефон</span><input name="phone" inputMode="tel" placeholder="+7 900 000-00-00" /></label><label><span>Должность</span><input name="position" required placeholder="Бригадир" /></label><label><span>Статус</span><select name="status"><option value="ACTIVE">Работает</option><option value="INACTIVE">Неактивен</option></select></label></div> : <div className="employee-access-summary"><span><b>{member!.position || "Сотрудник"}</b><small>{member!.username ? `Логин: ${member!.username}` : "Аккаунт ещё не создан"}</small></span>{member!.cashbox ? <span><b>{member!.cashbox.name}</b><small>{member!.cashbox.status === "ACTIVE" ? "Активна" : "Неактивна"} · {money(member!.cashbox.balanceKopecks)}</small></span> : null}</div>}
    <label className="permission-toggle access-master"><span><b>Предоставить доступ в DEPA OS</b><small>При отключении активные сессии перестанут давать доступ после проверки пользователя</small></span><input type="checkbox" checked={accessEnabled} disabled={editing && !hasUser} onChange={(event) => setAccessEnabled(event.target.checked)} /></label>
    {accessEnabled ? <>{!hasUser ? <div className="form-grid employee-fields"><label><span>Логин</span><input name="username" required minLength={3} autoComplete="off" /></label><label><span>Первоначальный пароль</span><input name="initialPassword" type="password" required minLength={8} autoComplete="new-password" /><small>Не сохраняется в открытом виде.</small></label></div> : null}<div className="preset-row"><PresetPicker value={preset} onChange={applyPreset} /></div><PermissionEditor value={profile} onChange={(next) => { setPreset("CUSTOM"); setProfile(next); }} /></> : <div className="access-disabled-note">Вход сотрудника будет заблокирован. Его рабочие данные и история сохранятся.</div>}
    {error ? <p className="form-error">{error}</p> : null}<div className="modal-actions"><button type="button" onClick={onClose}>Отмена</button><button className="primary" disabled={saving}>{saving ? "Сохраняем…" : hasUser ? "Сохранить права" : editing ? "Выдать доступ" : "Создать сотрудника"}</button></div>
  </form></div>;
}

export function TeamAccessScreen() {
  const [members, setMembers] = useState<TeamAccessMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<{ member?: TeamAccessMember } | null>(null);
  async function load() {
    setLoading(true); setError("");
    try { const response = await fetch("/api/team/access", { cache: "no-store" }); const result = await response.json() as { members?: TeamAccessMember[]; error?: string }; if (!response.ok) throw new Error(result.error); setMembers(result.members ?? []); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить команду."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    fetch("/api/team/access", { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { members?: TeamAccessMember[]; error?: string };
      if (!response.ok) throw new Error(result.error);
      if (active) setMembers(result.members ?? []);
    }).catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить команду."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <section className="screen-section"><div className="screen-intro"><div><span className="eyebrow">КОМАНДА</span><h2>Сотрудники и доступ</h2><p>Разделы, действия и данные настраиваются индивидуально.</p></div><button className="primary" onClick={() => setModal({})}>＋ Добавить сотрудника</button></div>
    {error ? <div className="panel finance-empty">{error}</div> : null}{loading ? <div className="panel finance-loading">Загружаем сотрудников…</div> : <div className="team-member-grid">{members.map((member) => <article className="panel team-member-card" key={member.employeeId}><header><span className="avatar">{member.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div><h3>{member.name}</h3><p>{member.position || "Сотрудник"}</p></div><span className={`access-state ${member.accessEnabled ? "active" : ""}`}>{member.role === "OWNER" ? "OWNER" : member.accessEnabled ? "Доступ активен" : "Без доступа"}</span></header><div className="team-member-facts"><span><small>Телефон</small><b>{member.phone || "Не указан"}</b></span><span><small>Касса</small><b>{member.cashbox ? `${member.cashbox.name} · ${member.cashbox.status === "ACTIVE" ? "активна" : "неактивна"}` : "Нет"}</b></span></div>{member.role === "OWNER" ? <div className="owner-lock"><b>Полный системный доступ</b><span>Права Owner защищены и не редактируются.</span></div> : <button className="secondary full" onClick={() => setModal({ member })}>{member.userId ? "Настроить доступ" : "Выдать доступ"}</button>}</article>)}</div>}
    {modal ? <EmployeeAccessModal member={modal.member} onClose={() => setModal(null)} onSaved={() => void load()} /> : null}
  </section>;
}
