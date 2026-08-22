import type { AuthUser } from "./auth";
import { first, query, transaction } from "./postgres";
import {
  AccessError,
  assertActionPermission,
  getAccessProfile,
} from "./permissions";

export class ResidentialComplexError extends Error {
  status: number;
  details: Record<string, unknown>;

  constructor(
    message: string,
    status = 400,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export type ResidentialComplexInput = {
  name?: unknown;
  city?: unknown;
  address?: unknown;
  developer?: unknown;
  district?: unknown;
  comment?: unknown;
  allowDuplicate?: unknown;
};

type ResidentialComplexRow = {
  id: string;
  name: string;
  normalized_name: string;
  city: string;
  address: string;
  developer: string | null;
  district: string | null;
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

function validate(input: ResidentialComplexInput, previous?: ResidentialComplexRow) {
  const name =
    input.name === undefined
      ? previous?.name ?? null
      : cleanResidentialComplexName(input.name);
  const city =
    input.city === undefined ? previous?.city ?? null : clean(input.city, 120);
  const address =
    input.address === undefined
      ? previous?.address ?? null
      : clean(input.address, 500);
  if (!name) throw new ResidentialComplexError("Укажите название ЖК.");
  if (!city) throw new ResidentialComplexError("Укажите город.");
  if (!address) throw new ResidentialComplexError("Укажите адрес ЖК.");
  return {
    name,
    normalizedName: normalizeResidentialComplexName(name),
    city,
    address,
    developer:
      input.developer === undefined
        ? previous?.developer ?? null
        : clean(input.developer, 180),
    district:
      input.district === undefined
        ? previous?.district ?? null
        : clean(input.district, 180),
    comment:
      input.comment === undefined
        ? previous?.comment ?? null
        : clean(input.comment, 4000),
  };
}

function baseSelect() {
  return `SELECT rc.id,rc.name,rc.normalized_name,rc.city,rc.address,rc.developer,rc.district,rc.comment,rc.status,
    rc.created_by_user_id,u.display_name creator_name,rc.created_at,rc.updated_at,rc.archived_at,
    (SELECT COUNT(*)::int FROM inspections i WHERE i.residential_complex_id=rc.id) inspection_count,
    (SELECT COUNT(*)::int FROM design_projects dp WHERE dp.residential_complex_id=rc.id) design_count,
    (SELECT COUNT(*)::int FROM projects p WHERE p.residential_complex_id=rc.id) project_count
    FROM residential_complexes rc JOIN users u ON u.id=rc.created_by_user_id`;
}

function serialize(row: ResidentialComplexRow) {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    city: row.city,
    address: row.address,
    developer: row.developer,
    district: row.district,
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
  const allowed =
    access.actions["residentialComplexes.view"] ||
    (access.modules.orders && access.actions["orders.view"]) ||
    (access.modules.projects && access.actions["projects.view"]);
  if (!allowed) throw new AccessError("Нет доступа к выбору ЖК.");
}

async function possibleDuplicates(
  normalizedName: string,
  address: string,
  excludeId?: string,
) {
  const params: unknown[] = [normalizedName, address];
  const exclude = excludeId ? ` AND rc.id<>$${params.push(excludeId)}` : "";
  return query<ResidentialComplexRow>(
    `${baseSelect()} WHERE (rc.normalized_name=$1 OR lower(trim(rc.address))=lower(trim($2)))${exclude}
      ORDER BY CASE WHEN rc.normalized_name=$1 THEN 0 ELSE 1 END,rc.status,rc.name LIMIT 5`,
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
  const status = selector
    ? "ACTIVE"
    : clean(url.searchParams.get("status"), 20) ?? "ACTIVE";
  const city = clean(url.searchParams.get("city"), 120);
  if (status !== "ALL") {
    if (!(["ACTIVE", "ARCHIVED"] as const).includes(status as "ACTIVE" | "ARCHIVED"))
      throw new ResidentialComplexError("Некорректный статус ЖК.");
    const statusParam = add(status);
    conditions.push(
      includeId
        ? `(rc.status=${statusParam} OR rc.id=${add(includeId)})`
        : `rc.status=${statusParam}`,
    );
  }
  if (city) conditions.push(`rc.city=${add(city)}`);
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      `(rc.name ILIKE ${add(term)} OR rc.address ILIKE ${add(term)} OR rc.developer ILIKE ${add(term)} OR rc.city ILIKE ${add(term)})`,
    );
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 50);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = await query<ResidentialComplexRow>(
    `${baseSelect()}${where} ORDER BY CASE rc.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,rc.name,rc.city LIMIT ${limit + 1} OFFSET ${offset}`,
    values,
  );
  const [countRow, cities] = await Promise.all([
    first<{ count: number | string }>(
      `SELECT COUNT(*) count FROM residential_complexes rc${where}`,
      values,
    ),
    selector
      ? Promise.resolve([])
      : query<{ city: string }>(
          "SELECT DISTINCT city FROM residential_complexes ORDER BY city",
        ),
  ]);
  return {
    items: rows.slice(0, limit).map(serialize),
    total: Number(countRow?.count ?? 0),
    nextOffset: rows.length > limit ? offset + limit : null,
    cities: cities.map((item) => item.city),
  };
}

export async function getResidentialComplex(actor: AuthUser, id: string) {
  await assertActionPermission(actor, "residentialComplexes.view");
  return findResidentialComplex(id);
}

async function findResidentialComplex(id: string) {
  const row = await first<ResidentialComplexRow>(
    `${baseSelect()} WHERE rc.id=$1 LIMIT 1`,
    [id],
  );
  if (!row) throw new ResidentialComplexError("ЖК не найден.", 404);
  return serialize(row);
}

export async function createResidentialComplex(
  actor: AuthUser,
  input: ResidentialComplexInput,
) {
  await assertActionPermission(actor, "residentialComplexes.create");
  const data = validate(input);
  const duplicates = await possibleDuplicates(data.normalizedName, data.address);
  if (duplicates.length && input.allowDuplicate !== true)
    throw new ResidentialComplexError(
      "ЖК с таким названием или адресом уже существует.",
      409,
      { code: "POSSIBLE_DUPLICATE", duplicates: duplicates.map(serialize) },
    );
  const id = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  await transaction([
    {
      text: `INSERT INTO residential_complexes(id,name,normalized_name,city,address,developer,district,comment,status,created_by_user_id,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',$9,$10,$10)`,
      params: [id, data.name, data.normalizedName, data.city, data.address, data.developer, data.district, data.comment, actor.id, timestamp],
    },
    {
      text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'RESIDENTIAL_COMPLEX_CREATED','ResidentialComplex',$3,$4,$5)",
      params: [crypto.randomUUID(), actor.id, id, timestamp, JSON.stringify({ name: data.name, city: data.city, duplicateOverride: duplicates.length > 0 })],
    },
  ]);
  return findResidentialComplex(id);
}

export async function updateResidentialComplex(
  actor: AuthUser,
  id: string,
  input: ResidentialComplexInput,
) {
  await assertActionPermission(actor, "residentialComplexes.edit");
  const before = await first<ResidentialComplexRow>(
    `${baseSelect()} WHERE rc.id=$1 LIMIT 1`,
    [id],
  );
  if (!before) throw new ResidentialComplexError("ЖК не найден.", 404);
  const data = validate(input, before);
  const duplicates = await possibleDuplicates(data.normalizedName, data.address, id);
  if (duplicates.length && input.allowDuplicate !== true)
    throw new ResidentialComplexError(
      "ЖК с таким названием или адресом уже существует.",
      409,
      { code: "POSSIBLE_DUPLICATE", duplicates: duplicates.map(serialize) },
    );
  const changedFields = [
    ["name", before.name, data.name],
    ["city", before.city, data.city],
    ["address", before.address, data.address],
    ["developer", before.developer, data.developer],
    ["district", before.district, data.district],
    ["comment", before.comment, data.comment],
  ].filter(([, previous, next]) => previous !== next).map(([field]) => field);
  if (!changedFields.length) return findResidentialComplex(id);
  const timestamp = Math.floor(Date.now() / 1000);
  await transaction([
    {
      text: `UPDATE residential_complexes SET name=$1,normalized_name=$2,city=$3,address=$4,developer=$5,district=$6,comment=$7,updated_at=$8 WHERE id=$9`,
      params: [data.name, data.normalizedName, data.city, data.address, data.developer, data.district, data.comment, timestamp, id],
    },
    {
      text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'RESIDENTIAL_COMPLEX_UPDATED','ResidentialComplex',$3,$4,$5)",
      params: [crypto.randomUUID(), actor.id, id, timestamp, JSON.stringify({ changedFields, duplicateOverride: duplicates.length > 0 })],
    },
  ]);
  return findResidentialComplex(id);
}

export async function setResidentialComplexArchived(
  actor: AuthUser,
  id: string,
  archived: boolean,
) {
  await assertActionPermission(actor, "residentialComplexes.archive");
  const before = await first<{ status: string }>(
    "SELECT status FROM residential_complexes WHERE id=$1 LIMIT 1",
    [id],
  );
  if (!before) throw new ResidentialComplexError("ЖК не найден.", 404);
  const status = archived ? "ARCHIVED" : "ACTIVE";
  if (before.status === status) return findResidentialComplex(id);
  const timestamp = Math.floor(Date.now() / 1000);
  await transaction([
    {
      text: "UPDATE residential_complexes SET status=$1,archived_at=$2,updated_at=$3 WHERE id=$4",
      params: [status, archived ? timestamp : null, timestamp, id],
    },
    {
      text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,$3,'ResidentialComplex',$4,$5,'{}')",
      params: [crypto.randomUUID(), actor.id, archived ? "RESIDENTIAL_COMPLEX_ARCHIVED" : "RESIDENTIAL_COMPLEX_RESTORED", id, timestamp],
    },
  ]);
  return findResidentialComplex(id);
}

export async function resolveResidentialComplexReference(
  id: unknown,
  options: { allowArchivedId?: string | null } = {},
) {
  const value = clean(id, 100);
  if (!value) return null;
  const row = await first<{
    id: string;
    name: string;
    city: string;
    address: string;
    status: "ACTIVE" | "ARCHIVED";
  }>(
    "SELECT id,name,city,address,status FROM residential_complexes WHERE id=$1 LIMIT 1",
    [value],
  );
  if (!row) throw new ResidentialComplexError("Выбранный ЖК не найден.", 409);
  if (row.status !== "ACTIVE" && row.id !== options.allowArchivedId)
    throw new ResidentialComplexError("Архивный ЖК нельзя выбрать для новой связи.", 409);
  return row;
}

export function residentialComplexRelationAudit(
  actor: AuthUser,
  entityType: string,
  entityId: string,
  oldId: string | null,
  newId: string | null,
  timestamp: number,
) {
  if (oldId === newId) return null;
  return {
    text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'RESIDENTIAL_COMPLEX_RELATION_CHANGED',$3,$4,$5,$6)",
    params: [crypto.randomUUID(), actor.id, entityType, entityId, timestamp, JSON.stringify({ oldResidentialComplexId: oldId, newResidentialComplexId: newId })],
  };
}
