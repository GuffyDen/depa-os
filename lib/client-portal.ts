import type { AuthUser } from "./auth";
import { createLocalPasswordCredential, randomToken, sha256, verifyLocalPasswordCredential } from "./auth";
import { first, query, transaction } from "./postgres";
import { AccessError, assertModuleAction, canViewProject, getAccessProfile } from "./permissions";
import { taskProgress, weightedProgress } from "./production";
import { additionalWorkCommercialSummary, listClientAdditionalWorks } from "./additional-works";

const COOKIE = "depa_client_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const INVITE_SECONDS = 60 * 60 * 72;
const now = () => Math.floor(Date.now() / 1000);
const id = () => crypto.randomUUID();
const clean = (value: unknown, max = 500) => typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : "";
const int = (value: unknown, label: string, minimum = 0) => { const number = Number(value); if (!Number.isInteger(number) || number < minimum) throw new ClientPortalError(`Проверьте поле «${label}».`); return number; };
const normalizeLogin = (value: string) => value.replace(/\s+/g, "").toLocaleLowerCase("ru-RU");

export class ClientPortalError extends Error {
  constructor(message: string, public status = 400, public details: Record<string, unknown> = {}) { super(message); }
}

export type ClientPortalUser = { id: string; clientId: string; clientName: string; loginIdentifier: string };
type PortalRow = { id: string; client_id: string; client_name: string; login_identifier: string; password_hash: string; password_salt: string; password_iterations: number; status: string };

function portalAudit(action: string, entityType: string, entityId: string, options: { clientId?: string | null; portalUserId?: string | null; employeeUserId?: string | null; metadata?: Record<string, unknown>; at?: number } = {}) {
  return { text: "INSERT INTO client_portal_audit_events(id,action,entity_type,entity_id,client_id,client_portal_user_id,employee_user_id,metadata_json,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)", params: [id(), action, entityType, entityId, options.clientId ?? null, options.portalUserId ?? null, options.employeeUserId ?? null, JSON.stringify(options.metadata ?? {}), options.at ?? now()] };
}

function employeeAudit(actor: AuthUser, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>, at = now()) {
  return { text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)", params: [id(), actor.id, action, entityType, entityId, at, JSON.stringify(metadata)] };
}

function requestCookie(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  return header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? null;
}

export function clientSessionCookie(token: string, requestUrl: string) {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export function expiredClientSessionCookie(requestUrl: string) {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`;
}

async function portalUserFromToken(token: string | null) {
  if (!token) return null;
  const hash = await sha256(token);
  const row = await first<PortalRow>(`SELECT pu.id,pu.client_id,c.name client_name,pu.login_identifier,pu.password_hash,pu.password_salt,pu.password_iterations,pu.status
    FROM client_portal_sessions s JOIN client_portal_users pu ON pu.id=s.portal_user_id JOIN clients c ON c.id=pu.client_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>$2 AND pu.status='ACTIVE' AND c.status='ACTIVE' LIMIT 1`, [hash, now()]);
  if (!row) return null;
  await query("UPDATE client_portal_sessions SET last_seen_at=$1 WHERE token_hash=$2", [now(), hash]);
  return { id: row.id, clientId: row.client_id, clientName: row.client_name, loginIdentifier: row.login_identifier } satisfies ClientPortalUser;
}

export async function getClientPortalUser(request: Request) { return portalUserFromToken(requestCookie(request)); }

async function portalRateKey(identifier: string, request: Request) {
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  return sha256(`client-portal:${normalizeLogin(identifier)}:${address}`);
}

export async function createClientPortalInvite(actor: AuthUser, clientId: string, reset = false) {
  await assertModuleAction(actor, "clients", "clientPortal.manageAccess");
  const client = await first<{ id: string; name: string; phone: string; phone_normalized: string; email: string | null }>("SELECT id,name,phone,phone_normalized,email FROM clients WHERE id=$1 AND status='ACTIVE'", [clientId]);
  if (!client) throw new ClientPortalError("Клиент не найден.", 404);
  const token = randomToken(32), hash = await sha256(token), timestamp = now(), inviteId = id();
  const identifier = client.phone_normalized || client.email || client.phone;
  const statements: Parameters<typeof transaction>[0] = [
    { text: "UPDATE client_portal_invites SET revoked_at=$1 WHERE client_id=$2 AND used_at IS NULL AND revoked_at IS NULL", params: [timestamp, clientId] },
  ];
  if (reset) statements.push(
    { text: "UPDATE client_portal_sessions SET revoked_at=$1 WHERE portal_user_id IN(SELECT id FROM client_portal_users WHERE client_id=$2) AND revoked_at IS NULL", params: [timestamp, clientId] },
    { text: "UPDATE client_portal_users SET status='DISABLED',updated_at=$1 WHERE client_id=$2", params: [timestamp, clientId] },
  );
  statements.push(
    { text: "INSERT INTO client_portal_invites(id,client_id,token_hash,login_identifier,expires_at,created_by_user_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", params: [inviteId, clientId, hash, identifier, timestamp + INVITE_SECONDS, actor.id, timestamp] },
    portalAudit(reset ? "CLIENT_PORTAL_ACCESS_RESET" : "CLIENT_PORTAL_INVITE_CREATED", "Client", clientId, { clientId, employeeUserId: actor.id, metadata: { inviteId, expiresAt: timestamp + INVITE_SECONDS }, at: timestamp }),
    employeeAudit(actor, reset ? "CLIENT_PORTAL_ACCESS_RESET" : "CLIENT_PORTAL_INVITE_CREATED", "Client", clientId, { inviteId, expiresAt: timestamp + INVITE_SECONDS }, timestamp),
  );
  await transaction(statements);
  return { inviteId, inviteUrl: `/client/activate?token=${encodeURIComponent(token)}`, expiresAt: timestamp + INVITE_SECONDS, clientName: client.name, loginIdentifier: identifier };
}

export async function activateClientPortalInvite(token: string, password: string, passwordRepeat: string, request: Request) {
  if (!token || token.length < 32) throw new ClientPortalError("Ссылка приглашения недействительна.", 400);
  if (password !== passwordRepeat) throw new ClientPortalError("Пароли не совпадают.");
  const hash = await sha256(token), timestamp = now();
  const invite = await first<{ id: string; client_id: string; login_identifier: string; client_name: string }>(`SELECT i.id,i.client_id,i.login_identifier,c.name client_name FROM client_portal_invites i JOIN clients c ON c.id=i.client_id
    WHERE i.token_hash=$1 AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>$2 AND c.status='ACTIVE' LIMIT 1`, [hash, timestamp]);
  if (!invite) throw new ClientPortalError("Ссылка приглашения недействительна или истекла.", 410);
  const credential = await createLocalPasswordCredential(password), portalUserId = id(), sessionId = id(), sessionToken = randomToken(), sessionHash = await sha256(sessionToken);
  const activated = await query<{ count: number | string }>(`WITH claimed AS (
      UPDATE client_portal_invites SET used_at=$1 WHERE id=$2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>$1 RETURNING client_id,login_identifier
    ), portal_user AS (
      INSERT INTO client_portal_users(id,client_id,login_identifier,login_identifier_normalized,password_hash,password_salt,password_iterations,status,created_at,updated_at)
      SELECT $3,client_id,login_identifier,$4,$5,$6,$7,'ACTIVE',$1,$1 FROM claimed
      ON CONFLICT(client_id) DO UPDATE SET login_identifier=excluded.login_identifier,login_identifier_normalized=excluded.login_identifier_normalized,password_hash=excluded.password_hash,password_salt=excluded.password_salt,password_iterations=excluded.password_iterations,status='ACTIVE',updated_at=excluded.updated_at
      RETURNING id,client_id
    ), revoked AS (
      UPDATE client_portal_sessions SET revoked_at=$1 WHERE portal_user_id IN(SELECT id FROM portal_user) AND revoked_at IS NULL RETURNING id
    ), new_session AS (
      INSERT INTO client_portal_sessions(id,portal_user_id,token_hash,created_at,last_seen_at,expires_at,user_agent)
      SELECT $8,id,$9,$1,$1,$10,$11 FROM portal_user RETURNING id
    ), audit AS (
      INSERT INTO client_portal_audit_events(id,action,entity_type,entity_id,client_id,metadata_json,occurred_at)
      SELECT $12,'CLIENT_PORTAL_ACCESS_ACTIVATED','Client',client_id,client_id,jsonb_build_object('inviteId',$2),$1 FROM portal_user WHERE EXISTS(SELECT 1 FROM new_session) RETURNING id
    ) SELECT COUNT(*)::int count FROM new_session`, [timestamp, invite.id, portalUserId, normalizeLogin(invite.login_identifier), credential.hash, credential.salt, credential.iterations, sessionId, sessionHash, timestamp + SESSION_SECONDS, request.headers.get("user-agent")?.slice(0, 300) ?? null, id()]);
  if (Number(activated[0]?.count ?? 0) !== 1) throw new ClientPortalError("Ссылка приглашения уже использована.", 410);
  return { token: sessionToken, clientName: invite.client_name };
}

export async function loginClientPortal(identifier: string, password: string, request: Request) {
  const normalized = normalizeLogin(identifier), identifierHash = await portalRateKey(normalized, request), timestamp = now();
  const failures = await first<{ count: number | string }>("SELECT COUNT(*) count FROM auth_attempts WHERE identifier_hash=$1 AND succeeded=0 AND attempted_at>=$2", [identifierHash, timestamp - 900]);
  if (Number(failures?.count ?? 0) >= 5) throw new ClientPortalError("Слишком много попыток. Повторите через 15 минут.", 429);
  const row = await first<PortalRow>(`SELECT pu.id,pu.client_id,c.name client_name,pu.login_identifier,pu.password_hash,pu.password_salt,pu.password_iterations,pu.status FROM client_portal_users pu JOIN clients c ON c.id=pu.client_id WHERE pu.login_identifier_normalized=$1 LIMIT 1`, [normalized]);
  const valid = Boolean(row && row.status === "ACTIVE" && await verifyLocalPasswordCredential(password, row.password_hash, row.password_salt, row.password_iterations));
  await query("INSERT INTO auth_attempts(id,identifier_hash,attempted_at,succeeded) VALUES($1,$2,$3,$4)", [id(), identifierHash, timestamp, valid ? 1 : 0]);
  if (!valid || !row) throw new ClientPortalError("Неверный логин или пароль.", 401);
  const token = randomToken(), tokenHash = await sha256(token);
  await transaction([
    { text: "INSERT INTO client_portal_sessions(id,portal_user_id,token_hash,created_at,last_seen_at,expires_at,user_agent) VALUES($1,$2,$3,$4,$5,$6,$7)", params: [id(), row.id, tokenHash, timestamp, timestamp, timestamp + SESSION_SECONDS, request.headers.get("user-agent")?.slice(0, 300) ?? null] },
    { text: "UPDATE client_portal_users SET last_login_at=$1,updated_at=$2 WHERE id=$3", params: [timestamp, timestamp, row.id] },
    { text: "DELETE FROM auth_attempts WHERE identifier_hash=$1", params: [identifierHash] },
    portalAudit("CLIENT_PORTAL_LOGIN", "ClientPortalUser", row.id, { clientId: row.client_id, portalUserId: row.id, at: timestamp }),
  ]);
  return { token, user: { id: row.id, clientId: row.client_id, clientName: row.client_name, loginIdentifier: row.login_identifier } satisfies ClientPortalUser };
}

export async function logoutClientPortal(request: Request) {
  const token = requestCookie(request); if (!token) return;
  const hash = await sha256(token), timestamp = now();
  const session = await first<{ portal_user_id: string; client_id: string }>("SELECT s.portal_user_id,pu.client_id FROM client_portal_sessions s JOIN client_portal_users pu ON pu.id=s.portal_user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL", [hash]);
  await query("UPDATE client_portal_sessions SET revoked_at=$1 WHERE token_hash=$2", [timestamp, hash]);
  if (session) {
    const audit = portalAudit("CLIENT_PORTAL_LOGOUT", "ClientPortalUser", session.portal_user_id, { clientId: session.client_id, portalUserId: session.portal_user_id, at: timestamp });
    await query(audit.text, audit.params);
  }
}

export async function disableClientPortal(actor: AuthUser, clientId: string) {
  await assertModuleAction(actor, "clients", "clientPortal.manageAccess");
  const timestamp = now();
  await transaction([
    { text: "UPDATE client_portal_users SET status='DISABLED',updated_at=$1 WHERE client_id=$2", params: [timestamp, clientId] },
    { text: "UPDATE client_portal_sessions SET revoked_at=$1 WHERE portal_user_id IN(SELECT id FROM client_portal_users WHERE client_id=$2) AND revoked_at IS NULL", params: [timestamp, clientId] },
    { text: "UPDATE client_portal_invites SET revoked_at=$1 WHERE client_id=$2 AND used_at IS NULL AND revoked_at IS NULL", params: [timestamp, clientId] },
    portalAudit("CLIENT_PORTAL_ACCESS_DISABLED", "Client", clientId, { clientId, employeeUserId: actor.id, at: timestamp }), employeeAudit(actor, "CLIENT_PORTAL_ACCESS_DISABLED", "Client", clientId, {}, timestamp),
  ]);
  return { ok: true };
}

export async function getClientPortalAccess(actor: AuthUser, clientId: string) {
  await assertModuleAction(actor, "clients", "clients.view");
  const row = await first<Record<string, unknown>>(`SELECT pu.id,pu.status,pu.login_identifier,pu.last_login_at,pu.created_at,
    (SELECT COUNT(*)::int FROM client_portal_sessions s WHERE s.portal_user_id=pu.id AND s.revoked_at IS NULL AND s.expires_at>$2) active_sessions,
    (SELECT expires_at FROM client_portal_invites i WHERE i.client_id=$1 AND i.used_at IS NULL AND i.revoked_at IS NULL ORDER BY i.created_at DESC LIMIT 1) invite_expires_at
    FROM client_portal_users pu WHERE pu.client_id=$1`, [clientId, now()]);
  return row ?? { status: "NOT_CREATED", active_sessions: 0, invite_expires_at: null };
}

async function clientOwnsProject(user: ClientPortalUser, projectId: string) {
  return Boolean(await first("SELECT id FROM projects WHERE id=$1 AND client_id=$2", [projectId, user.clientId]));
}

export async function getClientPortalHome(user: ClientPortalUser, requestedProjectId?: string) {
  const projects = await query<{ id: string; name: string; residential_complex: string | null; residential_complex_name: string | null; address: string; apartment: string; published_forecast_end_date: number | null; contract_amount_kopecks: number; payment_plan_version: number }>(`SELECT p.id,p.name,p.residential_complex,rc.name residential_complex_name,p.address,p.apartment,p.published_forecast_end_date,p.contract_amount_kopecks,p.payment_plan_version FROM projects p LEFT JOIN residential_complexes rc ON rc.id=p.residential_complex_id WHERE p.client_id=$1 AND p.status<>'ARCHIVED' ORDER BY p.created_at DESC`, [user.clientId]);
  const designs = await query<{ id: string; order_id: string; title: string; residential_complex: string | null; residential_complex_name: string | null; address: string; apartment_number: string; status: string; progress: number }>(`SELECT dp.id,dp.order_id,o.title,dp.residential_complex,rc.name residential_complex_name,dp.address,dp.apartment_number,dp.status,
    COALESCE((SELECT ROUND(100.0*COUNT(*) FILTER(WHERE ds.status='COMPLETED')/NULLIF(COUNT(*),0))::int FROM design_project_stages ds WHERE ds.design_project_id=dp.id AND ds.archived_at IS NULL),CASE WHEN dp.status='COMPLETED' THEN 100 ELSE 0 END) progress
    FROM design_projects dp JOIN orders o ON o.id=dp.order_id LEFT JOIN residential_complexes rc ON rc.id=dp.residential_complex_id WHERE o.client_id=$1 AND o.status<>'CANCELLED' ORDER BY o.created_at DESC`, [user.clientId]);
  const objects = [
    ...projects.map((project) => ({ id: project.id, kind: "PROJECT" as const, title: project.residential_complex_name ?? project.residential_complex ?? project.name, subtitle: `${project.address} · кв.${project.apartment}` })),
    ...designs.filter((design) => !projects.some((project) => project.address === design.address && project.apartment === design.apartment_number)).map((design) => ({ id: design.id, kind: "DESIGN" as const, title: design.residential_complex_name ?? design.residential_complex ?? design.title, subtitle: `${design.address} · кв.${design.apartment_number}` })),
  ];
  if (!objects.length) return { user: { name: user.clientName }, objects: [], current: null, emptyState: "Объекты пока не добавлены." };
  const selected = objects.find((object) => object.id === requestedProjectId) ?? objects[0];
  if (selected.kind === "DESIGN") {
    const design = designs.find((item) => item.id === selected.id)!;
    return { user: { name: user.clientName }, objects, current: { ...selected, mode: "DESIGN_ONLY", progress: design.progress, progressLabel: "Готовность дизайн-проекта", publishedForecast: null, stages: [], delays: [], reports: [], hiddenWorks: [], additionalWorks: [], commercial: null, payments: { dueKopecks: 0, confirmedKopecks: 0, obligations: [], claims: [], history: [], unappliedKopecks: 0 }, documents: [] } };
  }
  if (!(await clientOwnsProject(user, selected.id))) throw new ClientPortalError("Объект недоступен.", 403);
  const project = projects.find((item) => item.id === selected.id)!;
  const plan = await first<{ id: string; design_weight: string | number; production_weight: string | number }>("SELECT id,design_weight,production_weight FROM production_plans WHERE project_id=$1 AND status='ACTIVE'", [project.id]);
  const stages = plan ? await query<Record<string, unknown>>(`SELECT s.id,s.name,s.status,s.sort_order,s.weight_within_project,s.acceptance_status,s.client_acceptance_required,
    COALESCE((SELECT SUM(CASE WHEN t.status='CANCELLED' THEN 0 ELSE COALESCE(t.weight_within_stage,0)*CASE WHEN t.progress_type='BINARY' THEN CASE WHEN t.status='COMPLETED' THEN 100 ELSE 0 END ELSE LEAST(100,100*COALESCE(t.completed_quantity,0)/NULLIF(t.planned_quantity,0)) END END)/NULLIF(SUM(CASE WHEN t.status='CANCELLED' THEN 0 ELSE COALESCE(t.weight_within_stage,0) END),0) FROM tasks t WHERE t.stage_id=s.id AND t.archived_at IS NULL),0) progress_percent
    FROM project_stages s WHERE s.production_plan_id=$1 AND s.archived_at IS NULL ORDER BY s.sort_order`, [plan.id]) : [];
  const productionProgress = weightedProgress(stages.map((stage) => ({ progress: Number(stage.progress_percent), weight: Number(stage.weight_within_project) })));
  const matchingDesign = designs.find((design) => design.address === project.address && design.apartment_number === project.apartment);
  const designWeight = matchingDesign ? Number(plan?.design_weight ?? 0) : 0, productionWeight = matchingDesign ? Number(plan?.production_weight ?? 100) : 100;
  const overall = Math.round(((matchingDesign?.progress ?? 0) * designWeight + productionProgress * productionWeight) / 100);
  const stageIds = stages.map((stage) => String(stage.id));
  const tasks = stageIds.length ? await query<Record<string, unknown>>("SELECT id,stage_id,title,status,progress_type,planned_quantity,completed_quantity,weight_within_stage FROM tasks WHERE stage_id=ANY($1) AND client_visible=1 AND archived_at IS NULL ORDER BY position", [stageIds]) : [];
  const delays = await query("SELECT id,category,'Срок скорректирован'::text reason,client_comment,start_date,end_date,days FROM project_delays WHERE project_id=$1 AND client_visible=1 ORDER BY start_date DESC", [project.id]);
  const reports = await query(`SELECT dr.id,dr.report_date,CASE WHEN dr.comment_client_visible=1 THEN dr.comment ELSE NULL END comment,
    COALESCE(json_agg(json_build_object('id',a.id,'filename',a.original_filename,'url','/api/client/files/'||a.id) ORDER BY a.created_at) FILTER(WHERE a.id IS NOT NULL),'[]') photos
    FROM daily_reports dr LEFT JOIN attachments a ON a.entity_type='DailyReport' AND a.entity_id=dr.id AND a.upload_status='LINKED' AND a.deleted_at IS NULL AND (a.visibility='CLIENT' OR a.client_visible=1)
    WHERE dr.project_id=$1 GROUP BY dr.id ORDER BY dr.report_date DESC`, [project.id]);
  const hiddenWorks = await query(`SELECT r.id,r.name,r.description,t.title task_name,COUNT(a.id)::int photo_count,
    COALESCE(json_agg(json_build_object('id',a.id,'filename',a.original_filename,'url','/api/client/files/'||a.id) ORDER BY a.created_at) FILTER(WHERE a.id IS NOT NULL),'[]') photos
    FROM task_photo_requirements r JOIN tasks t ON t.id=r.task_id LEFT JOIN attachments a ON a.photo_requirement_id=r.id AND a.upload_status='LINKED' AND a.deleted_at IS NULL AND (a.visibility='CLIENT' OR a.client_visible=1)
    WHERE t.project_id=$1 AND t.client_visible=1 GROUP BY r.id,t.title ORDER BY t.position,r.position`, [project.id]);
  const obligations = await query(`SELECT o.id,o.obligation_type,o.stage_id,COALESCE(s.name,aw.title,'Оплата по объекту') stage_name,o.amount_kopecks,o.paid_kopecks,o.amount_kopecks-o.paid_kopecks remaining_kopecks,o.status,o.due_date FROM obligations o LEFT JOIN project_stages s ON s.id=o.stage_id LEFT JOIN additional_works aw ON aw.id=o.additional_work_id WHERE o.project_id=$1 AND o.counterparty_type='CLIENT' AND o.counterparty_id=$2 AND o.status<>'CANCELLED' ORDER BY o.due_date NULLS LAST,o.created_at`, [project.id, user.clientId]);
  const claims = await query("SELECT id,claimed_amount_kopecks,confirmed_amount_kopecks,payment_method,status,claimed_at,received_at,rejection_comment FROM client_payment_claims WHERE project_id=$1 AND client_id=$2 ORDER BY created_at DESC", [project.id, user.clientId]);
  const history = await query("SELECT id,amount_kopecks,transaction_date,title FROM financial_transactions WHERE project_id=$1 AND client_id=$2 AND type='INCOME' ORDER BY transaction_date DESC", [project.id, user.clientId]);
  const unapplied = await first<{ total: number | string }>("SELECT COALESCE(SUM(remaining_kopecks),0) total FROM client_unapplied_funds WHERE project_id=$1 AND client_id=$2", [project.id, user.clientId]);
  const documents = await query(`SELECT a.id,a.original_filename filename,a.category,a.created_at,'/api/client/files/'||a.id url FROM attachments a WHERE a.project_id=$1 AND a.upload_status='LINKED' AND a.deleted_at IS NULL AND (a.client_visible=1 OR a.visibility='CLIENT') AND a.category IN('ESTIMATE','CONTRACT','CONTRACT_PDF','SIGNED_CONTRACT','FINAL_ALBUM','OTHER') ORDER BY a.created_at DESC`, [project.id]);
  const [additionalWorks, commercial] = await Promise.all([listClientAdditionalWorks(user, project.id), additionalWorkCommercialSummary(project.id)]);
  return { user: { name: user.clientName }, objects, current: { ...selected, mode: "PROJECT", progress: overall, progressLabel: "Общая готовность квартиры", designProgress: matchingDesign?.progress ?? null, productionProgress, publishedForecast: project.published_forecast_end_date, stages: stages.map((stage) => ({ id: stage.id, name: stage.name, status: stage.status, progressPercent: Math.round(Number(stage.progress_percent)), acceptanceStatus: stage.acceptance_status, acceptanceRequired: Boolean(stage.client_acceptance_required), tasks: tasks.filter((task) => task.stage_id === stage.id).map((task) => ({ id: task.id, name: task.title, status: task.status, progressPercent: taskProgress({ progress_type: task.progress_type as "BINARY" | "QUANTITY", status: String(task.status), planned_quantity: task.planned_quantity as number | null, completed_quantity: task.completed_quantity as number | null }) })) })), delays, reports, hiddenWorks, additionalWorks, commercial, payments: { dueKopecks: obligations.reduce((sum, item) => sum + Number(item.remaining_kopecks), 0), confirmedKopecks: history.reduce((sum, item) => sum + Number(item.amount_kopecks), 0), contractAmountKopecks: project.contract_amount_kopecks, obligations, claims, history, unappliedKopecks: Number(unapplied?.total ?? 0) }, documents } };
}

async function createAcceptedStageObligations(stageId: string, timestamp: number) {
  const stage = await first<{ id: string; project_id: string; sort_order: number; client_id: string; payment_plan_version: number }>(`SELECT s.id,s.project_id,s.sort_order,p.client_id,p.payment_plan_version FROM project_stages s JOIN projects p ON p.id=s.project_id WHERE s.id=$1`, [stageId]);
  if (!stage || stage.payment_plan_version < 1) return [];
  const term = await first<{ stage_amount_kopecks: number }>("SELECT stage_amount_kopecks FROM project_stage_payment_terms WHERE stage_id=$1 AND payment_plan_version=$2 AND active=1", [stageId, stage.payment_plan_version]);
  if (!term) return [];
  const advance = await first<{ paid: number | string }>("SELECT COALESCE(SUM(paid_kopecks),0) paid FROM obligations WHERE stage_id=$1 AND obligation_type='STAGE_ADVANCE' AND status<>'CANCELLED'", [stageId]);
  const balance = Math.max(0, Number(term.stage_amount_kopecks) - Number(advance?.paid ?? 0));
  const statements: Parameters<typeof transaction>[0] = [];
  if (balance > 0) statements.push({ text: `INSERT INTO obligations(id,direction,counterparty_type,counterparty_id,project_id,amount_kopecks,paid_kopecks,status,obligation_type,stage_id,payment_plan_version,source_key,currency,created_at,updated_at)
    VALUES($1,'RECEIVABLE','CLIENT',$2,$3,$4,0,'OPEN','STAGE_BALANCE',$5,$6,$7,'RUB',$8,$9) ON CONFLICT(source_key) WHERE source_key IS NOT NULL DO NOTHING`, params: [id(), stage.client_id, stage.project_id, balance, stageId, stage.payment_plan_version, `stage:${stageId}:balance:v${stage.payment_plan_version}`, timestamp, timestamp] });
  const next = await first<{ stage_id: string; required_advance_kopecks: number }>(`SELECT t.stage_id,t.required_advance_kopecks FROM project_stage_payment_terms t JOIN project_stages s ON s.id=t.stage_id WHERE t.project_id=$1 AND t.payment_plan_version=$2 AND t.active=1 AND s.sort_order>$3 ORDER BY s.sort_order LIMIT 1`, [stage.project_id, stage.payment_plan_version, stage.sort_order]);
  if (next && Number(next.required_advance_kopecks) > 0) statements.push({ text: `INSERT INTO obligations(id,direction,counterparty_type,counterparty_id,project_id,amount_kopecks,paid_kopecks,status,obligation_type,stage_id,payment_plan_version,source_key,currency,created_at,updated_at)
    VALUES($1,'RECEIVABLE','CLIENT',$2,$3,$4,0,'OPEN','STAGE_ADVANCE',$5,$6,$7,'RUB',$8,$9) ON CONFLICT(source_key) WHERE source_key IS NOT NULL DO NOTHING`, params: [id(), stage.client_id, stage.project_id, next.required_advance_kopecks, next.stage_id, stage.payment_plan_version, `stage:${next.stage_id}:advance:v${stage.payment_plan_version}`, timestamp, timestamp] });
  return statements;
}

export async function acceptStageByClient(user: ClientPortalUser, stageId: string, comment?: string) {
  const stage = await first<{ project_id: string; acceptance_status: string }>("SELECT s.project_id,s.acceptance_status FROM project_stages s JOIN projects p ON p.id=s.project_id WHERE s.id=$1 AND p.client_id=$2 AND s.status='COMPLETED'", [stageId, user.clientId]);
  if (!stage) throw new ClientPortalError("Этап недоступен.", 403);
  if (stage.acceptance_status === "ACCEPTED") return { ok: true, idempotent: true, projectId: stage.project_id, clientId: user.clientId };
  if (stage.acceptance_status !== "AWAITING_ACCEPTANCE") throw new ClientPortalError("Этап ещё не передан на приёмку.", 409);
  const timestamp = now(), eventId = id(), obligations = await createAcceptedStageObligations(stageId, timestamp);
  try { await transaction([
    { text: "WITH transitioned AS (UPDATE project_stages SET acceptance_status='ACCEPTED',accepted_at=$1,rejected_at=NULL,acceptance_comment=$2,accepted_by_client_portal_user_id=$3,updated_at=$4 WHERE id=$5 AND acceptance_status='AWAITING_ACCEPTANCE' RETURNING id) SELECT 1 / COUNT(*)::int transition_guard FROM transitioned", params: [timestamp, clean(comment, 2000) || null, user.id, timestamp, stageId] },
    { text: "INSERT INTO stage_acceptance_events(id,project_id,stage_id,type,client_portal_user_id,comment,created_at) VALUES($1,$2,$3,'STAGE_ACCEPTED_BY_CLIENT',$4,$5,$6)", params: [eventId, stage.project_id, stageId, user.id, clean(comment, 2000) || null, timestamp] },
    ...obligations,
    portalAudit("STAGE_ACCEPTED_BY_CLIENT", "ProjectStage", stageId, { clientId: user.clientId, portalUserId: user.id, metadata: { projectId: stage.project_id, eventId }, at: timestamp }),
  ]); } catch (error) { if ((error as { code?: string }).code === "22012") throw new ClientPortalError("Этап уже обработан другим запросом.", 409); throw error; }
  return { ok: true, projectId: stage.project_id, clientId: user.clientId };
}

export async function rejectStageByClient(user: ClientPortalUser, stageId: string, comment: string) {
  const reason = clean(comment, 2000); if (!reason) throw new ClientPortalError("Опишите замечания к этапу.");
  const stage = await first<{ project_id: string }>("SELECT s.project_id FROM project_stages s JOIN projects p ON p.id=s.project_id WHERE s.id=$1 AND p.client_id=$2 AND s.acceptance_status='AWAITING_ACCEPTANCE'", [stageId, user.clientId]);
  if (!stage) throw new ClientPortalError("Этап недоступен для отклонения.", 409);
  const timestamp = now();
  try { await transaction([
    { text: "WITH transitioned AS (UPDATE project_stages SET acceptance_status='REJECTED',rejected_at=$1,acceptance_comment=$2,updated_at=$3 WHERE id=$4 AND acceptance_status='AWAITING_ACCEPTANCE' RETURNING id) SELECT 1 / COUNT(*)::int transition_guard FROM transitioned", params: [timestamp, reason, timestamp, stageId] },
    { text: "INSERT INTO stage_acceptance_events(id,project_id,stage_id,type,client_portal_user_id,comment,created_at) VALUES($1,$2,$3,'STAGE_REJECTED_BY_CLIENT',$4,$5,$6)", params: [id(), stage.project_id, stageId, user.id, reason, timestamp] },
    portalAudit("STAGE_REJECTED_BY_CLIENT", "ProjectStage", stageId, { clientId: user.clientId, portalUserId: user.id, metadata: { projectId: stage.project_id }, at: timestamp }),
  ]); } catch (error) { if ((error as { code?: string }).code === "22012") throw new ClientPortalError("Этап уже обработан другим запросом.", 409); throw error; }
  return { ok: true, projectId: stage.project_id, clientId: user.clientId };
}

async function internalStage(actor: AuthUser, stageId: string, permission: "stageAcceptance.resubmit" | "obligations.manage") {
  await assertModuleAction(actor, "projects", permission);
  const stage = await first<{ project_id: string; acceptance_status: string; client_id: string }>("SELECT s.project_id,s.acceptance_status,p.client_id FROM project_stages s JOIN projects p ON p.id=s.project_id WHERE s.id=$1", [stageId]);
  if (!stage || !(await canViewProject(actor, stage.project_id))) throw new AccessError("Этап недоступен.", 403);
  return stage;
}

export async function resubmitStage(actor: AuthUser, stageId: string, comment?: string) {
  const stage = await internalStage(actor, stageId, "stageAcceptance.resubmit");
  if (stage.acceptance_status !== "REJECTED") throw new ClientPortalError("Повторно передать можно только отклонённый этап.", 409);
  const timestamp = now(), reason = clean(comment, 2000) || null;
  try { await transaction([{ text: "WITH transitioned AS (UPDATE project_stages SET acceptance_status='AWAITING_ACCEPTANCE',acceptance_comment=$1,updated_at=$2 WHERE id=$3 AND acceptance_status='REJECTED' RETURNING id) SELECT 1 / COUNT(*)::int transition_guard FROM transitioned", params: [reason, timestamp, stageId] }, { text: "INSERT INTO stage_acceptance_events(id,project_id,stage_id,type,employee_user_id,comment,created_at) VALUES($1,$2,$3,'STAGE_RESUBMITTED_FOR_ACCEPTANCE',$4,$5,$6)", params: [id(), stage.project_id, stageId, actor.id, reason, timestamp] }, employeeAudit(actor, "STAGE_RESUBMITTED_FOR_ACCEPTANCE", "ProjectStage", stageId, { projectId: stage.project_id }, timestamp)]); } catch (error) { if ((error as { code?: string }).code === "22012") throw new ClientPortalError("Этап уже изменён другим запросом.", 409); throw error; }
  return { ok: true, projectId: stage.project_id, clientId: stage.client_id };
}

export async function manuallyAcceptStage(actor: AuthUser, stageId: string, comment: string) {
  const reason = clean(comment, 2000); if (!reason) throw new ClientPortalError("Укажите основание ручной приёмки.");
  const stage = await internalStage(actor, stageId, "obligations.manage"), timestamp = now(), obligations = await createAcceptedStageObligations(stageId, timestamp);
  try { await transaction([{ text: "WITH transitioned AS (UPDATE project_stages SET acceptance_status='ACCEPTED',accepted_at=$1,rejected_at=NULL,acceptance_comment=$2,updated_at=$3 WHERE id=$4 AND acceptance_status<>'ACCEPTED' RETURNING id) SELECT 1 / COUNT(*)::int transition_guard FROM transitioned", params: [timestamp, reason, timestamp, stageId] }, { text: "INSERT INTO stage_acceptance_events(id,project_id,stage_id,type,employee_user_id,comment,created_at) VALUES($1,$2,$3,'STAGE_ACCEPTED_MANUALLY_BY_DEPA',$4,$5,$6)", params: [id(), stage.project_id, stageId, actor.id, reason, timestamp] }, ...obligations, employeeAudit(actor, "STAGE_ACCEPTED_MANUALLY_BY_DEPA", "ProjectStage", stageId, { projectId: stage.project_id, reason }, timestamp)]); } catch (error) { if ((error as { code?: string }).code === "22012") throw new ClientPortalError("Этап уже принят.", 409); throw error; }
  return { ok: true, projectId: stage.project_id, clientId: stage.client_id };
}

export async function saveStagePaymentTerms(actor: AuthUser, projectId: string, terms: unknown[]) {
  await assertModuleAction(actor, "projects", "stagePaymentTerms.edit"); if (!(await canViewProject(actor, projectId))) throw new AccessError("Объект недоступен.", 403);
  const project = await first<{ payment_plan_version: number; contract_amount_kopecks: number }>("SELECT payment_plan_version,contract_amount_kopecks FROM projects WHERE id=$1", [projectId]); if (!project) throw new ClientPortalError("Объект не найден.", 404);
  const version = Number(project.payment_plan_version) + 1, timestamp = now(), statements: Parameters<typeof transaction>[0] = [];
  const rows = terms.map((raw, position) => { const item = raw as Record<string, unknown>; return { stageId: clean(item.stageId), stageAmount: int(item.stageAmountKopecks, "Стоимость этапа"), advance: int(item.requiredAdvanceKopecks ?? 0, "Аванс"), position }; });
  for (const row of rows) statements.push({ text: `INSERT INTO project_stage_payment_terms(id,project_id,stage_id,stage_amount_kopecks,required_advance_kopecks,currency,position,payment_plan_version,active,created_at,updated_at)
    SELECT $1,$2,s.id,$3,$4,'RUB',$5,$6,1,$7,$8 FROM project_stages s WHERE s.id=$9 AND s.project_id=$2
    ON CONFLICT(stage_id,payment_plan_version) DO UPDATE SET stage_amount_kopecks=excluded.stage_amount_kopecks,required_advance_kopecks=excluded.required_advance_kopecks,position=excluded.position,updated_at=excluded.updated_at`, params: [id(), projectId, row.stageAmount, row.advance, row.position, version, timestamp, timestamp, row.stageId] });
  statements.push(employeeAudit(actor, "STAGE_PAYMENT_TERMS_UPDATED", "Project", projectId, { version, stageCount: rows.length }, timestamp)); await transaction(statements);
  const total = rows.reduce((sum, row) => sum + row.stageAmount, 0); return { version, totalKopecks: total, contractAmountKopecks: Number(project.contract_amount_kopecks), differenceKopecks: total - Number(project.contract_amount_kopecks) };
}

export async function activatePaymentPlan(actor: AuthUser, projectId: string) {
  await assertModuleAction(actor, "projects", "obligations.manage"); if (!(await canViewProject(actor, projectId))) throw new AccessError("Объект недоступен.", 403);
  const project = await first<{ client_id: string; payment_plan_version: number }>("SELECT client_id,payment_plan_version FROM projects WHERE id=$1", [projectId]); if (!project) throw new ClientPortalError("Объект не найден.", 404);
  const version = Number(project.payment_plan_version) + 1, firstTerm = await first<{ stage_id: string; required_advance_kopecks: number }>("SELECT stage_id,required_advance_kopecks FROM project_stage_payment_terms WHERE project_id=$1 AND payment_plan_version=$2 AND active=1 ORDER BY position LIMIT 1", [projectId, version]);
  if (!firstTerm) throw new ClientPortalError("Сначала заполните финансовый план этапов.", 409);
  const timestamp = now(), statements: Parameters<typeof transaction>[0] = [{ text: "UPDATE projects SET payment_plan_version=$1,payment_plan_activated_at=$2,payment_plan_activated_by_user_id=$3,updated_at=$4 WHERE id=$5", params: [version, timestamp, actor.id, timestamp, projectId] }];
  if (Number(firstTerm.required_advance_kopecks) > 0) statements.push({ text: `INSERT INTO obligations(id,direction,counterparty_type,counterparty_id,project_id,amount_kopecks,paid_kopecks,status,obligation_type,stage_id,payment_plan_version,source_key,currency,created_at,updated_at)
    VALUES($1,'RECEIVABLE','CLIENT',$2,$3,$4,0,'OPEN','STAGE_ADVANCE',$5,$6,$7,'RUB',$8,$9) ON CONFLICT(source_key) WHERE source_key IS NOT NULL DO NOTHING`, params: [id(), project.client_id, projectId, firstTerm.required_advance_kopecks, firstTerm.stage_id, version, `stage:${firstTerm.stage_id}:advance:v${version}`, timestamp, timestamp] });
  statements.push(employeeAudit(actor, "PAYMENT_PLAN_ACTIVATED", "Project", projectId, { version }, timestamp)); await transaction(statements); return { ok: true, version };
}

export async function createPaymentClaim(user: ClientPortalUser, projectId: string, amountKopecks: number, paymentMethod?: string, comment?: string) {
  if (!(await clientOwnsProject(user, projectId))) throw new ClientPortalError("Объект недоступен.", 403);
  const amount = int(amountKopecks, "Сумма", 1), method = clean(paymentMethod, 30) || null;
  if (method && !["BANK_TRANSFER", "CASH", "OTHER"].includes(method)) throw new ClientPortalError("Выберите способ оплаты.");
  const open = await query<{ id: string; remaining: number | string }>("SELECT id,amount_kopecks-paid_kopecks remaining FROM obligations WHERE project_id=$1 AND counterparty_id=$2 AND status IN('OPEN','PARTIALLY_PAID') ORDER BY due_date NULLS LAST,created_at,id", [projectId, user.clientId]);
  if (!open.length) throw new ClientPortalError("Оплат к внесению сейчас нет.", 409);
  const claimId = id(), timestamp = now(), statements: Parameters<typeof transaction>[0] = [{ text: "INSERT INTO client_payment_claims(id,client_id,project_id,portal_user_id,claimed_amount_kopecks,payment_method,client_comment,status,claimed_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10)", params: [claimId, user.clientId, projectId, user.id, amount, method, clean(comment, 2000) || null, timestamp, timestamp, timestamp] }];
  let remaining = amount, position = 0; for (const obligation of open) { const intended = Math.min(remaining, Number(obligation.remaining)); if (intended <= 0) break; statements.push({ text: "INSERT INTO client_payment_claim_obligations(id,claim_id,obligation_id,intended_amount_kopecks,position,created_at) VALUES($1,$2,$3,$4,$5,$6)", params: [id(), claimId, obligation.id, intended, position, timestamp] }); remaining -= intended; position += 1; }
  statements.push(portalAudit("CLIENT_PAYMENT_CLAIM_CREATED", "ClientPaymentClaim", claimId, { clientId: user.clientId, portalUserId: user.id, metadata: { projectId, claimedAmountKopecks: amount }, at: timestamp })); await transaction(statements); return { id: claimId, status: "PENDING" };
}

export async function cancelPaymentClaim(user: ClientPortalUser, claimId: string) {
  const timestamp = now(), result = await query<{ id: string }>("UPDATE client_payment_claims SET status='CANCELLED',cancelled_at=$1,updated_at=$2 WHERE id=$3 AND client_id=$4 AND portal_user_id=$5 AND status='PENDING' RETURNING id", [timestamp, timestamp, claimId, user.clientId, user.id]);
  if (!result.length) throw new ClientPortalError("Заявление уже обработано.", 409);
  const audit = portalAudit("CLIENT_PAYMENT_CLAIM_CANCELLED", "ClientPaymentClaim", claimId, { clientId: user.clientId, portalUserId: user.id, at: timestamp });
  await query(audit.text, audit.params);
  return { ok: true };
}

async function paymentPermission(actor: AuthUser, action: "clientPayments.view" | "clientPayments.confirm" | "clientPayments.reject", projectId?: string) {
  await assertModuleAction(actor, "finance", action); if (projectId && !(await canViewProject(actor, projectId))) throw new AccessError("Платёж этого объекта недоступен.", 403);
}

export async function listPaymentClaims(actor: AuthUser) {
  await paymentPermission(actor, "clientPayments.view"); const access = await getAccessProfile(actor), assigned = actor.role !== "OWNER" && access.scopes.production !== "ALL";
  return query(`SELECT pc.id,pc.project_id,pc.client_id,c.name client_name,p.name project_name,pc.claimed_amount_kopecks,pc.confirmed_amount_kopecks,pc.payment_method,pc.client_comment,pc.status,pc.claimed_at,pc.received_at,pc.rejection_comment,
    (SELECT a.id FROM attachments a WHERE a.client_payment_claim_id=pc.id AND a.upload_status='LINKED' AND a.deleted_at IS NULL ORDER BY a.created_at DESC LIMIT 1) proof_attachment_id
    FROM client_payment_claims pc JOIN clients c ON c.id=pc.client_id JOIN projects p ON p.id=pc.project_id WHERE 1=1${assigned ? " AND (p.responsible_user_id=$1 OR p.manager_employee_id=$2 OR p.foreman_employee_id=$2 OR EXISTS(SELECT 1 FROM user_project_access upa WHERE upa.project_id=p.id AND upa.user_id=$1))" : ""} ORDER BY CASE pc.status WHEN 'PENDING' THEN 0 ELSE 1 END,pc.created_at DESC`, assigned ? [actor.id, actor.employeeId] : []);
}

export async function rejectPaymentClaim(actor: AuthUser, claimId: string, comment: string) {
  const reason = clean(comment, 2000); if (!reason) throw new ClientPortalError("Укажите причину отказа."); const claim = await first<{ project_id: string; client_id: string }>("SELECT project_id,client_id FROM client_payment_claims WHERE id=$1", [claimId]); if (!claim) throw new ClientPortalError("Заявление не найдено.", 404); await paymentPermission(actor, "clientPayments.reject", claim.project_id); const timestamp = now();
  const result = await query("UPDATE client_payment_claims SET status='REJECTED',rejected_at=$1,rejected_by_user_id=$2,rejection_comment=$3,updated_at=$4 WHERE id=$5 AND status='PENDING' RETURNING id", [timestamp, actor.id, reason, timestamp, claimId]); if (!result.length) throw new ClientPortalError("Заявление уже обработано.", 409);
  await transaction([portalAudit("CLIENT_PAYMENT_CLAIM_REJECTED", "ClientPaymentClaim", claimId, { clientId: claim.client_id, employeeUserId: actor.id, metadata: { projectId: claim.project_id }, at: timestamp }), employeeAudit(actor, "CLIENT_PAYMENT_CLAIM_REJECTED", "ClientPaymentClaim", claimId, { projectId: claim.project_id }, timestamp)]); return { ok: true, projectId: claim.project_id, clientId: claim.client_id };
}

export async function confirmPaymentClaim(actor: AuthUser, claimId: string, actualAmountKopecks: number, cashboxId: string, receivedAt: number, comment?: string) {
  const amount = int(actualAmountKopecks, "Фактически получено", 1), cashbox = clean(cashboxId), received = int(receivedAt, "Дата получения", 1), claim = await first<{ project_id: string; client_id: string }>("SELECT project_id,client_id FROM client_payment_claims WHERE id=$1", [claimId]); if (!claim) throw new ClientPortalError("Заявление не найдено.", 404); await paymentPermission(actor, "clientPayments.confirm", claim.project_id);
  const box = await first<{ id: string; owner_user_id: string | null }>("SELECT id,owner_user_id FROM cashboxes WHERE id=$1 AND status='ACTIVE'", [cashbox]); if (!box) throw new ClientPortalError("Активная касса не найдена.", 404); const profile = await getAccessProfile(actor); if (actor.role !== "OWNER" && box.owner_user_id !== actor.id && !profile.actions["clientPayments.confirmToAnyCashbox"]) throw new AccessError("Подтвердить оплату можно только в свою кассу.", 403);
  const timestamp = now(), transactionId = id(), auditId = id(), portalAuditId = id(), unappliedId = id();
  const result = await query<{ transaction_count: number; allocated_kopecks: number | string }>(`WITH locked AS (SELECT pc.* FROM client_payment_claims pc WHERE pc.id=$1 FOR UPDATE),
    eligible AS (SELECT * FROM locked WHERE status='PENDING'),
    inserted_transaction AS (INSERT INTO financial_transactions(id,amount_kopecks,transaction_date,type,expense_type,author_user_id,cashbox_id,client_id,project_id,order_id,category,source,purpose,title,comment,show_to_client,client_payment_claim_id,created_at,updated_at)
      SELECT $2,$3,$4,'INCOME',NULL,$5,$6,e.client_id,e.project_id,p.order_id,'CLIENT_PAYMENT','CLIENT_PAYMENT_CLAIM','WORKS','Оплата клиента',NULLIF($7,''),1,e.id,$8,$8 FROM eligible e JOIN projects p ON p.id=e.project_id RETURNING id),
    ranked AS (SELECT l.obligation_id,GREATEST(0,o.amount_kopecks-o.paid_kopecks) remaining,COALESCE(SUM(GREATEST(0,o.amount_kopecks-o.paid_kopecks)) OVER(ORDER BY l.position ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) prior FROM client_payment_claim_obligations l JOIN obligations o ON o.id=l.obligation_id WHERE l.claim_id=$1 AND o.status IN('OPEN','PARTIALLY_PAID')),
    allocated AS (INSERT INTO obligation_payment_allocations(id,obligation_id,financial_transaction_id,amount_kopecks,created_at,created_by_user_id)
      SELECT $2||':'||r.obligation_id,r.obligation_id,it.id,LEAST(r.remaining,GREATEST(0,$3-r.prior))::int,$8,$5 FROM ranked r CROSS JOIN inserted_transaction it WHERE LEAST(r.remaining,GREATEST(0,$3-r.prior))>0 RETURNING obligation_id,amount_kopecks),
    updated_obligations AS (UPDATE obligations o SET paid_kopecks=LEAST(o.amount_kopecks,o.paid_kopecks+a.amount_kopecks),status=CASE WHEN o.paid_kopecks+a.amount_kopecks>=o.amount_kopecks THEN 'PAID' ELSE 'PARTIALLY_PAID' END,updated_at=$8 FROM allocated a WHERE o.id=a.obligation_id RETURNING o.id),
    updated_claim AS (UPDATE client_payment_claims SET status='CONFIRMED',confirmed_amount_kopecks=$3,received_at=$4,confirmed_at=$8,confirmed_by_user_id=$5,updated_at=$8 WHERE id=$1 AND EXISTS(SELECT 1 FROM inserted_transaction) RETURNING id),
    updated_cashbox AS (UPDATE cashboxes SET balance_kopecks=balance_kopecks+$3,updated_at=$8 WHERE id=$6 AND EXISTS(SELECT 1 FROM inserted_transaction) RETURNING id),
    unapplied AS (INSERT INTO client_unapplied_funds(id,client_id,project_id,financial_transaction_id,amount_kopecks,remaining_kopecks,created_at)
      SELECT $9,e.client_id,e.project_id,it.id,$3-COALESCE((SELECT SUM(amount_kopecks) FROM allocated),0),$3-COALESCE((SELECT SUM(amount_kopecks) FROM allocated),0),$8 FROM eligible e CROSS JOIN inserted_transaction it WHERE $3>COALESCE((SELECT SUM(amount_kopecks) FROM allocated),0) RETURNING id),
    employee_audit AS (INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) SELECT $10,$5,'CLIENT_PAYMENT_CLAIM_CONFIRMED','ClientPaymentClaim',$1,$8,jsonb_build_object('financialTransactionId',$2,'amountKopecks',$3,'cashboxId',$6) FROM inserted_transaction RETURNING id),
    portal_audit AS (INSERT INTO client_portal_audit_events(id,action,entity_type,entity_id,client_id,employee_user_id,metadata_json,occurred_at) SELECT $11,'CLIENT_PAYMENT_CLAIM_CONFIRMED','ClientPaymentClaim',$1,e.client_id,$5,jsonb_build_object('financialTransactionId',$2,'amountKopecks',$3),$8 FROM eligible e CROSS JOIN inserted_transaction RETURNING id)
    SELECT (SELECT COUNT(*)::int FROM inserted_transaction) transaction_count,COALESCE((SELECT SUM(amount_kopecks) FROM allocated),0) allocated_kopecks`, [claimId, transactionId, amount, received, actor.id, cashbox, clean(comment, 2000), timestamp, unappliedId, auditId, portalAuditId]);
  if (Number(result[0]?.transaction_count ?? 0) !== 1) throw new ClientPortalError("Заявление уже обработано.", 409);
  return { ok: true, projectId: claim.project_id, clientId: claim.client_id, financialTransactionId: transactionId, allocatedKopecks: Number(result[0].allocated_kopecks), unappliedKopecks: amount - Number(result[0].allocated_kopecks) };
}
