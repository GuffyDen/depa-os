import { env } from "cloudflare:workers";
import { cookies } from "next/headers";

const SESSION_COOKIE = "depa_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 210_000;
const encoder = new TextEncoder();

export type AuthUser = {
  id: string;
  employeeId: string | null;
  name: string;
  username: string;
  role: "OWNER" | "EMPLOYEE" | "CLIENT";
  isProtectedOwner: boolean;
};

type UserRow = {
  id: string;
  employee_id: string | null;
  display_name: string;
  username: string;
  role: AuthUser["role"];
  status: string;
  is_protected_owner: number;
  password_hash: string | null;
  password_salt: string | null;
  password_iterations: number | null;
};

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function derivePassword(password: string, saltHex: string, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

async function makePasswordHash(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = bytesToHex(salt);
  return { hash: await derivePassword(password, saltHex, PASSWORD_ITERATIONS), salt: saltHex, iterations: PASSWORD_ITERATIONS };
}

async function verifyPassword(password: string, row: UserRow) {
  if (!row.password_hash || !row.password_salt || !row.password_iterations) return false;
  const candidate = hexToBytes(await derivePassword(password, row.password_salt, row.password_iterations));
  const expected = hexToBytes(row.password_hash);
  if (candidate.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) difference |= candidate[index] ^ expected[index];
  return difference === 0;
}

function publicUser(row: UserRow): AuthUser {
  return { id: row.id, employeeId: row.employee_id, name: row.display_name, username: row.username, role: row.role, isProtectedOwner: Boolean(row.is_protected_owner) };
}

function runtimeValue(key: string) {
  const value = (env as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function ensureBootstrapOwners() {
  const existing = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'OWNER' AND is_protected_owner = 1").first<{ count: number }>();
  if ((existing?.count ?? 0) >= 2) return;

  const owners = [
    { id: "user_owner_denis", employeeId: "employee_owner_denis", name: runtimeValue("DEPA_OWNER_DENIS_NAME"), username: runtimeValue("DEPA_OWNER_DENIS_USERNAME"), password: runtimeValue("DEPA_OWNER_DENIS_PASSWORD") },
    { id: "user_owner_pavel", employeeId: "employee_owner_pavel", name: runtimeValue("DEPA_OWNER_PAVEL_NAME"), username: runtimeValue("DEPA_OWNER_PAVEL_USERNAME"), password: runtimeValue("DEPA_OWNER_PAVEL_PASSWORD") },
  ];
  if (owners.some((owner) => !owner.name || !owner.username || !owner.password)) return;

  const timestamp = nowSeconds();
  const statements = [];
  for (const owner of owners) {
    const password = await makePasswordHash(owner.password!);
    statements.push(
      env.DB.prepare("INSERT OR IGNORE INTO employees (id, full_name, position, status, created_at, updated_at) VALUES (?, ?, 'Владелец', 'ACTIVE', ?, ?)").bind(owner.employeeId, owner.name, timestamp, timestamp),
      env.DB.prepare("INSERT OR IGNORE INTO users (id, auth_provider, username, username_normalized, display_name, role, employee_id, status, is_protected_owner, password_hash, password_salt, password_iterations, created_at, updated_at) VALUES (?, 'LOCAL', ?, ?, ?, 'OWNER', ?, 'ACTIVE', 1, ?, ?, ?, ?, ?)").bind(owner.id, owner.username, owner.username!.toLocaleLowerCase("ru-RU"), owner.name, owner.employeeId, password.hash, password.salt, password.iterations, timestamp, timestamp),
    );
  }
  await env.DB.batch(statements);
}

async function audit(actorUserId: string, action: string, entityType: string, entityId: string, metadata: Record<string, unknown> = {}) {
  const unsafe = /password|token|secret|credential/i;
  if (Object.keys(metadata).some((key) => unsafe.test(key))) throw new Error("Sensitive fields are forbidden in audit metadata");
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, occurred_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), actorUserId, action, entityType, entityId, nowSeconds(), JSON.stringify(metadata)).run();
}

async function rateLimitKey(username: string, request: Request) {
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  return sha256(`${username.toLocaleLowerCase("ru-RU")}:${address}`);
}

export async function login(username: string, password: string, request: Request) {
  await ensureBootstrapOwners();
  const normalized = username.trim().toLocaleLowerCase("ru-RU");
  const identifierHash = await rateLimitKey(normalized, request);
  const windowStart = nowSeconds() - 15 * 60;
  const failures = await env.DB.prepare("SELECT COUNT(*) AS count FROM auth_attempts WHERE identifier_hash = ? AND succeeded = 0 AND attempted_at >= ?").bind(identifierHash, windowStart).first<{ count: number }>();
  if ((failures?.count ?? 0) >= 5) return { ok: false as const, status: 429, message: "Слишком много попыток. Повторите через 15 минут." };

  const row = await env.DB.prepare("SELECT id, employee_id, display_name, username, role, status, is_protected_owner, password_hash, password_salt, password_iterations FROM users WHERE username_normalized = ? LIMIT 1")
    .bind(normalized).first<UserRow>();
  const valid = Boolean(row && row.status === "ACTIVE" && await verifyPassword(password, row));
  await env.DB.prepare("INSERT INTO auth_attempts (id, identifier_hash, attempted_at, succeeded) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), identifierHash, nowSeconds(), valid ? 1 : 0).run();
  if (!valid || !row) return { ok: false as const, status: 401, message: "Неверный логин или пароль." };

  const token = randomToken();
  const tokenHash = await sha256(token);
  const timestamp = nowSeconds();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO auth_sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), row.id, tokenHash, timestamp, timestamp, timestamp + SESSION_SECONDS, request.headers.get("user-agent")?.slice(0, 300) ?? null),
    env.DB.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").bind(timestamp, timestamp, row.id),
    env.DB.prepare("DELETE FROM auth_attempts WHERE identifier_hash = ?").bind(identifierHash),
    env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at < ? OR revoked_at IS NOT NULL").bind(timestamp - 86400),
  ]);
  await audit(row.id, "AUTH_LOGIN", "User", row.id);
  return { ok: true as const, user: publicUser(row), token };
}

export function sessionCookie(token: string, requestUrl: string) {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export function expiredSessionCookie(requestUrl: string) {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`;
}

async function userFromToken(token: string | undefined | null) {
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare("SELECT u.id, u.employee_id, u.display_name, u.username, u.role, u.status, u.is_protected_owner, u.password_hash, u.password_salt, u.password_iterations FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'ACTIVE' LIMIT 1")
    .bind(tokenHash, nowSeconds()).first<UserRow>();
  if (!row) return null;
  await env.DB.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?").bind(nowSeconds(), tokenHash).run();
  return publicUser(row);
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  return userFromToken(cookieStore.get(SESSION_COOKIE)?.value);
}

function cookieFromRequest(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  return header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) ?? null;
}

export async function getRequestUser(request: Request) {
  return userFromToken(cookieFromRequest(request));
}

export async function logout(request: Request) {
  const token = cookieFromRequest(request);
  if (!token) return;
  const tokenHash = await sha256(token);
  const session = await env.DB.prepare("SELECT user_id FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1").bind(tokenHash).first<{ user_id: string }>();
  await env.DB.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?").bind(nowSeconds(), tokenHash).run();
  if (session) await audit(session.user_id, "AUTH_LOGOUT", "User", session.user_id);
}

export async function changeOwnPassword(request: Request, currentPassword: string, newPassword: string) {
  const token = cookieFromRequest(request);
  const user = await userFromToken(token);
  if (!user || !token) return { ok: false as const, status: 401, message: "Сессия завершена. Войдите снова." };
  if (newPassword.length < 8) return { ok: false as const, status: 400, message: "Новый пароль должен содержать минимум 8 символов." };
  if (newPassword === currentPassword) return { ok: false as const, status: 400, message: "Новый пароль должен отличаться от текущего." };
  const row = await env.DB.prepare("SELECT id, employee_id, display_name, username, role, status, is_protected_owner, password_hash, password_salt, password_iterations FROM users WHERE id = ? LIMIT 1").bind(user.id).first<UserRow>();
  if (!row || !(await verifyPassword(currentPassword, row))) return { ok: false as const, status: 400, message: "Текущий пароль указан неверно." };
  const next = await makePasswordHash(newPassword);
  const tokenHash = await sha256(token);
  const timestamp = nowSeconds();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, password_changed_at = ?, updated_at = ? WHERE id = ?").bind(next.hash, next.salt, next.iterations, timestamp, timestamp, user.id),
    env.DB.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL").bind(timestamp, user.id, tokenHash),
  ]);
  await audit(user.id, "PASSWORD_CHANGED", "User", user.id);
  return { ok: true as const };
}

export function assertCanManageUser(actor: AuthUser, target: AuthUser, requested: { role?: string; status?: string; password?: string; delete?: boolean }) {
  if (actor.role !== "OWNER") throw new Error("Недостаточно прав");
  if (target.isProtectedOwner && actor.id !== target.id && (requested.role || requested.status || requested.password || requested.delete)) throw new Error("Защищённый Owner не может быть изменён другим пользователем");
  if (requested.password && actor.id !== target.id) throw new Error("Можно изменить только собственный пароль");
}
