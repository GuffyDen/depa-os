import type { AuthUser } from "./auth";
import { first, query, transaction } from "./postgres";
import { AccessError, assertActionPermission, getAccessProfile } from "./permissions";

export class ResidentialComplexError extends Error {
  status: number;
  details: Record<string, unknown>;
  constructor(message: string, status = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export type ResidentialComplexInput = {
  name?: unknown;
  city?: unknown;
  addresses?: unknown;
  developer?: unknown;
  comment?: unknown;
  allowDuplicate?: unknown;
};

type AddressDto = { id: string; address: string; position: number };
type ValidatedAddress = AddressDto & { normalizedAddress: string };
type ResidentialComplexRow = {
  id: string;
  name: string;
  normalized_name: string;
  city: string;
  developer: string | null;
  comment: string | null;
  status: "ACTIVE" | "ARCHIVED";
  created_by_user_id: string;
  creator_name: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  inspection_count: number | string;
  design_count: number | string;
  project_count: number | string;
  addresses_json: AddressDto[] | string | null;
};

function clean(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const result = value.trim().replace(/\s+/gu, " ");
  return result ? result.slice(0, max) : null;
}

export function cleanResidentialComplexName(value: unknown) {
  const original = clean(value, 180);
  if (!original) return null;
  const withoutPrefix = original.replace(/^жк(?:\s+|\s*[-–—:]\s*)/iu, "").trim();
  return (withoutPrefix || original).slice(0, 180);
}

export function normalizeResidentialComplexName(value: unknown) {
  const name = cleanResidentialComplexName(value);
  return name ? name.toLocaleLowerCase("ru-RU").replace(/\s+/gu, " ") : "";
}

export function normalizeResidentialComplexAddress(value: unknown) {
  const address = clean(value, 500);
  return address ? address.toLocaleLowerCase("ru-RU").replace(/\s+/gu, " ") : "";
}

function rowAddresses(row: ResidentialComplexRow): AddressDto[] {
  const parsed = typeof row.addresses_json === "string"
    ? JSON.parse(row.addresses_json) as AddressDto[]
    : row.addresses_json ?? [];
  return parsed.map((item) => ({ id: item.id, address: item.address, position: Number(item.position) }));
}

function validateAddresses(value: unknown, previous: AddressDto[] = []): ValidatedAddress[] {
  const source = value === undefined ? previous : value;
  if (!Array.isArray(source) || source.length === 0)
    throw new ResidentialComplexError("Укажите хотя бы один адрес ЖК.");
  if (source.length > 500)
    throw new ResidentialComplexError("За один раз можно сохранить не более 500 адресов.");
  const seen = new Set<string>();
  return source.map((raw, position) => {
    const item = typeof raw === "string" ? { address: raw } : raw;
    if (!item || typeof item !== "object")
      throw new ResidentialComplexError(`Проверьте адрес №${position + 1}.`);
    const typed = item as { id?: unknown; address?: unknown };
    const address = clean(typed.address, 500);
    if (!address) throw new ResidentialComplexError(`Укажите адрес №${position + 1}.`);
    const normalizedAddress = normalizeResidentialComplexAddress(address);
    if (seen.has(normalizedAddress))
      throw new ResidentialComplexError("Одинаковый адрес нельзя добавить в один ЖК дважды.", 409);
    seen.add(normalizedAddress);
    return { id: clean(typed.id, 100) ?? crypto.randomUUID(), address, normalizedAddress, position };
  });
}

function validate(input: ResidentialComplexInput, previous?: ResidentialComplexRow) {
  const name = input.name === undefined ? previous?.name ?? null : cleanResidentialComplexName(input.name);
  const city = input.city === undefined ? previous?.city ?? null : clean(input.city, 120);
  if (!name) throw new ResidentialComplexError("Укажите название ЖК.");
  if (!city) throw new ResidentialComplexError("Укажите город.");
  return {
    name,
    normalizedName: normalizeResidentialComplexName(name),
    city,
    addresses: validateAddresses(input.addresses, previous ? rowAddresses(previous) : []),
    developer: input.developer === undefined ? previous?.developer ?? null : clean(input.developer, 180),
    comment: input.comment === undefined ? previous?.comment ?? null : clean(input.comment, 4000),
  };
}

function baseSelect() {
  return `SELECT rc.id,rc.name,rc.normalized_name,rc.city,rc.developer,rc.comment,rc.status,
    rc.created_by_user_id,u.display_name creator_name,rc.created_at,rc.updated_at,rc.archived_at,
    COALESCE((SELECT json_agg(json_build_object('id',rca.id,'address',rca.address,'position',rca.position) ORDER BY rca.position,rca.id) FROM residential_complex_addresses rca WHERE rca.residential_complex_id=rc.id),'[]'::json) addresses_json,
    (SELECT COUNT(*)::int FROM inspections i WHERE i.residential_complex_id=rc.id) inspection_count,
    (SELECT COUNT(*)::int FROM design_projects dp WHERE dp.residential_complex_id=rc.id) design_count,
    (SELECT COUNT(*)::int FROM projects p WHERE p.residential_complex_id=rc.id) project_count
    FROM residential_complexes rc JOIN users u ON u.id=rc.created_by_user_id`;
}

function serialize(row: ResidentialComplexRow) {
  const addresses = rowAddresses(row);
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    city: row.city,
    addresses,
    primaryAddress: addresses[0]?.address ?? null,
    addressCount: addresses.length,
    developer: row.developer,
    comment: row.comment,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    creatorName: row.creator_name,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    archivedAt: row.archived_at === null ? null : Number(row.archived_at),
    counts: {
      inspections: Number(row.inspection_count),
      designs: Number(row.design_count),
      projects: Number(row.project_count),
    },
  };
}

async function assertSelectorAccess(actor: AuthUser) {
  if (actor.role === "OWNER") return;
  const access = await getAccessProfile(actor);
  const allowed = access.actions["residentialComplexes.view"] ||
    (access.modules.orders && access.actions["orders.view"]) ||
    (access.modules.projects && access.actions["projects.view"]);
  if (!allowed) throw new AccessError("Нет доступа к выбору ЖК.");
}

async function possibleDuplicates(normalizedName: string, excludeId?: string) {
  const params: unknown[] = [normalizedName];
  const exclude = excludeId ? ` AND rc.id<>$${params.push(excludeId)}` : "";
  return query<ResidentialComplexRow>(
    `${baseSelect()} WHERE rc.normalized_name=$1${exclude} ORDER BY rc.status,rc.name LIMIT 5`,
    params,
  );
}

export async function listResidentialComplexes(actor: AuthUser, requestUrl: string) {
  const url = new URL(requestUrl);
  const selector = url.searchParams.get("selector") === "1";
  if (selector) await assertSelectorAccess(actor);
  else await assertActionPermission(actor, "residentialComplexes.view");
  const values: unknown[] = [];
  const add = (value: unknown) => `$${values.push(value)}`;
  const conditions: string[] = [];
  const search = clean(url.searchParams.get("search"), 180);
  const includeId = clean(url.searchParams.get("includeId"), 100);
  const status = selector ? "ACTIVE" : clean(url.searchParams.get("status"), 20) ?? "ACTIVE";
  const city = clean(url.searchParams.get("city"), 120);
  if (status !== "ALL") {
    if (!(["ACTIVE", "ARCHIVED"] as const).includes(status as "ACTIVE" | "ARCHIVED"))
      throw new ResidentialComplexError("Некорректный статус ЖК.");
    const statusParam = add(status);
    conditions.push(includeId ? `(rc.status=${statusParam} OR rc.id=${add(includeId)})` : `rc.status=${statusParam}`);
  }
  if (city) conditions.push(`rc.city=${add(city)}`);
  if (search) {
    const term = `%${search}%`;
    conditions.push(`(rc.name ILIKE ${add(term)} OR rc.developer ILIKE ${add(term)} OR rc.city ILIKE ${add(term)} OR EXISTS(SELECT 1 FROM residential_complex_addresses rca_search WHERE rca_search.residential_complex_id=rc.id AND rca_search.address ILIKE ${add(term)}))`);
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 50);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = await query<ResidentialComplexRow>(`${baseSelect()}${where} ORDER BY CASE rc.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,rc.name,rc.city LIMIT ${limit + 1} OFFSET ${offset}`, values);
  const [countRow, cities] = await Promise.all([
    first<{ count: number | string }>(`SELECT COUNT(*) count FROM residential_complexes rc${where}`, values),
    selector ? Promise.resolve([]) : query<{ city: string }>("SELECT DISTINCT city FROM residential_complexes ORDER BY city"),
  ]);
  return { items: rows.slice(0, limit).map(serialize), total: Number(countRow?.count ?? 0), nextOffset: rows.length > limit ? offset + limit : null, cities: cities.map((item) => item.city) };
}

export async function getResidentialComplex(actor: AuthUser, id: string) {
  await assertActionPermission(actor, "residentialComplexes.view");
  return findResidentialComplex(id);
}

async function findResidentialComplex(id: string) {
  const row = await first<ResidentialComplexRow>(`${baseSelect()} WHERE rc.id=$1 LIMIT 1`, [id]);
  if (!row) throw new ResidentialComplexError("ЖК не найден.", 404);
  return serialize(row);
}

export async function createResidentialComplex(actor: AuthUser, input: ResidentialComplexInput) {
  await assertActionPermission(actor, "residentialComplexes.create");
  const data = validate(input);
  const duplicates = await possibleDuplicates(data.normalizedName);
  if (duplicates.length && input.allowDuplicate !== true)
    throw new ResidentialComplexError("ЖК с таким названием уже существует.", 409, { code: "POSSIBLE_DUPLICATE", duplicates: duplicates.map(serialize) });
  const id = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  await transaction([
    { text: `INSERT INTO residential_complexes(id,name,normalized_name,city,developer,comment,status,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$8,$8)`, params: [id, data.name, data.normalizedName, data.city, data.developer, data.comment, actor.id, timestamp] },
    ...data.addresses.map((address) => ({ text: "INSERT INTO residential_complex_addresses(id,residential_complex_id,address,normalized_address,position,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)", params: [address.id, id, address.address, address.normalizedAddress, address.position, timestamp] })),
    ...data.addresses.map((address) => ({ text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'RESIDENTIAL_COMPLEX_ADDRESS_ADDED','ResidentialComplexAddress',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, address.id, timestamp, JSON.stringify({ residentialComplexId: id, address: address.address, position: address.position })] })),
    { text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'RESIDENTIAL_COMPLEX_CREATED','ResidentialComplex',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, id, timestamp, JSON.stringify({ name: data.name, city: data.city, addressCount: data.addresses.length, duplicateOverride: duplicates.length > 0 })] },
  ]);
  return findResidentialComplex(id);
}

export async function updateResidentialComplex(actor: AuthUser, id: string, input: ResidentialComplexInput) {
  await assertActionPermission(actor, "residentialComplexes.edit");
  const before = await first<ResidentialComplexRow>(`${baseSelect()} WHERE rc.id=$1 LIMIT 1`, [id]);
  if (!before) throw new ResidentialComplexError("ЖК не найден.", 404);
  const oldAddresses = rowAddresses(before);
  const data = validate(input, before);
  const oldIds = new Set(oldAddresses.map((item) => item.id));
  const newIds = new Set(data.addresses.map((item) => item.id));
  const removed = oldAddresses.filter((item) => !newIds.has(item.id));
  const added = data.addresses.filter((item) => !oldIds.has(item.id));
  const updated = data.addresses.filter((item) => {
    const old = oldAddresses.find((address) => address.id === item.id);
    return old && (old.address !== item.address || old.position !== item.position);
  });
  const foreignIds = data.addresses.filter((item) => !oldIds.has(item.id)).map((item) => item.id);
  if (foreignIds.length) {
    const taken = await query<{ id: string }>("SELECT id FROM residential_complex_addresses WHERE id=ANY($1::text[])", [foreignIds]);
    if (taken.length) throw new ResidentialComplexError("Адрес другого ЖК нельзя перенести через эту форму.", 409);
  }
  if (removed.length) {
    const used = await query<{ id: string }>(
      `SELECT rca.id FROM residential_complex_addresses rca WHERE rca.id=ANY($1::text[]) AND (
        EXISTS(SELECT 1 FROM inspections x WHERE x.residential_complex_address_id=rca.id) OR
        EXISTS(SELECT 1 FROM design_projects x WHERE x.residential_complex_address_id=rca.id) OR
        EXISTS(SELECT 1 FROM renovation_order_details x WHERE x.residential_complex_address_id=rca.id) OR
        EXISTS(SELECT 1 FROM projects x WHERE x.residential_complex_address_id=rca.id) OR
        EXISTS(SELECT 1 FROM estimates x WHERE x.residential_complex_address_id=rca.id))`,
      [removed.map((item) => item.id)],
    );
    if (used.length) throw new ResidentialComplexError("Нельзя удалить адрес, который уже используется в документах или проектах.", 409, { code: "ADDRESS_IN_USE", addressIds: used.map((item) => item.id) });
  }
  const duplicates = await possibleDuplicates(data.normalizedName, id);
  if (duplicates.length && input.allowDuplicate !== true)
    throw new ResidentialComplexError("ЖК с таким названием уже существует.", 409, { code: "POSSIBLE_DUPLICATE", duplicates: duplicates.map(serialize) });
  const timestamp = Math.floor(Date.now() / 1000);
  await transaction([
    { text: "UPDATE residential_complexes SET name=$1,normalized_name=$2,city=$3,developer=$4,comment=$5,updated_at=$6 WHERE id=$7", params: [data.name, data.normalizedName, data.city, data.developer, data.comment, timestamp, id] },
    { text: "UPDATE residential_complex_addresses SET position=position+10000,normalized_address='__reorder__'||id WHERE residential_complex_id=$1", params: [id] },
    ...data.addresses.map((address) => oldIds.has(address.id) ? {
      text: "UPDATE residential_complex_addresses SET address=$1,normalized_address=$2,position=$3,updated_at=$4 WHERE id=$5 AND residential_complex_id=$6",
      params: [address.address, address.normalizedAddress, address.position, timestamp, address.id, id],
    } : {
      text: "INSERT INTO residential_complex_addresses(id,residential_complex_id,address,normalized_address,position,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)",
      params: [address.id, id, address.address, address.normalizedAddress, address.position, timestamp],
    }),
    ...removed.map((address) => ({ text: "DELETE FROM residential_complex_addresses WHERE id=$1 AND residential_complex_id=$2", params: [address.id, id] })),
    ...added.map((address) => ({ text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'RESIDENTIAL_COMPLEX_ADDRESS_ADDED','ResidentialComplexAddress',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, address.id, timestamp, JSON.stringify({ residentialComplexId: id, address: address.address, position: address.position })] })),
    ...updated.map((address) => ({ text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'RESIDENTIAL_COMPLEX_ADDRESS_UPDATED','ResidentialComplexAddress',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, address.id, timestamp, JSON.stringify({ residentialComplexId: id, address: address.address, position: address.position })] })),
    ...removed.map((address) => ({ text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'RESIDENTIAL_COMPLEX_ADDRESS_REMOVED','ResidentialComplexAddress',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, address.id, timestamp, JSON.stringify({ residentialComplexId: id, address: address.address })] })),
    { text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'RESIDENTIAL_COMPLEX_UPDATED','ResidentialComplex',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, id, timestamp, JSON.stringify({ addressCount: data.addresses.length, duplicateOverride: duplicates.length > 0 })] },
  ]);
  return findResidentialComplex(id);
}

export async function setResidentialComplexArchived(actor: AuthUser, id: string, archived: boolean) {
  await assertActionPermission(actor, "residentialComplexes.archive");
  const before = await first<{ status: string }>("SELECT status FROM residential_complexes WHERE id=$1 LIMIT 1", [id]);
  if (!before) throw new ResidentialComplexError("ЖК не найден.", 404);
  const status = archived ? "ARCHIVED" : "ACTIVE";
  if (before.status === status) return findResidentialComplex(id);
  const timestamp = Math.floor(Date.now() / 1000);
  await transaction([
    { text: "UPDATE residential_complexes SET status=$1,archived_at=$2,updated_at=$3 WHERE id=$4", params: [status, archived ? timestamp : null, timestamp, id] },
    { text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,$3,'ResidentialComplex',$4,$5,'{}')", params: [crypto.randomUUID(), actor.id, archived ? "RESIDENTIAL_COMPLEX_ARCHIVED" : "RESIDENTIAL_COMPLEX_RESTORED", id, timestamp] },
  ]);
  return findResidentialComplex(id);
}

export async function resolveResidentialComplexLocation(id: unknown, addressId: unknown, freeTextAddress: unknown, options: { allowArchivedId?: string | null } = {}) {
  const complexId = clean(id, 100);
  const selectedAddressId = clean(addressId, 100);
  if (!complexId) {
    if (selectedAddressId) throw new ResidentialComplexError("Адрес ЖК выбран без самого ЖК.", 409);
    const addressText = clean(freeTextAddress, 500);
    if (!addressText) throw new ResidentialComplexError("Укажите адрес.");
    return { residentialComplex: null, address: null, addressText };
  }
  const complex = await first<{ id: string; name: string; city: string; status: "ACTIVE" | "ARCHIVED" }>("SELECT id,name,city,status FROM residential_complexes WHERE id=$1 LIMIT 1", [complexId]);
  if (!complex) throw new ResidentialComplexError("Выбранный ЖК не найден.", 409);
  if (complex.status !== "ACTIVE" && complex.id !== options.allowArchivedId)
    throw new ResidentialComplexError("Архивный ЖК нельзя выбрать для новой связи.", 409);
  const addresses = await query<AddressDto>("SELECT id,address,position FROM residential_complex_addresses WHERE residential_complex_id=$1 ORDER BY position,id", [complex.id]);
  const address = selectedAddressId ? addresses.find((item) => item.id === selectedAddressId) : addresses.length === 1 ? addresses[0] : null;
  if (!address) throw new ResidentialComplexError(selectedAddressId ? "Выбранный адрес не принадлежит этому ЖК." : "Выберите точный адрес ЖК.", 409);
  return { residentialComplex: complex, address, addressText: address.address };
}

export function residentialComplexRelationAudit(actor: AuthUser, entityType: string, entityId: string, oldId: string | null, newId: string | null, timestamp: number) {
  if (oldId === newId) return null;
  return {
    text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'RESIDENTIAL_COMPLEX_RELATION_CHANGED',$3,$4,$5,$6)",
    params: [crypto.randomUUID(), actor.id, entityType, entityId, timestamp, JSON.stringify({ oldResidentialComplexId: oldId, newResidentialComplexId: newId })],
  };
}
