import { cookies } from "next/headers";
import { first, query, transaction } from "./postgres";

const SESSION_COOKIE = "depa_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
// Conservative cross-runtime work factor for Web Crypto on Vercel and local Node.
const PASSWORD_ITERATIONS = 100_000;
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
  const value = process.env[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function ensureBootstrapOwners() {
  const existing = await first<{ count: string | number }>("SELECT COUNT(*) AS count FROM users WHERE role = 'OWNER' AND is_protected_owner = 1");
  if (Number(existing?.count ?? 0) >= 2) return;

  const owners = [
    { id: "user_owner_denis", employeeId: "employee_owner_denis", name: runtimeValue("DEPA_OWNER_DENIS_NAME"), username: runtimeValue("DEPA_OWNER_DENIS_USERNAME"), password: runtimeValue("DEPA_OWNER_DENIS_PASSWORD") },
    { id: "user_owner_pavel", employeeId: "employee_owner_pavel", name: runtimeValue("DEPA_OWNER_PAVEL_NAME"), username: runtimeValue("DEPA_OWNER_PAVEL_USERNAME"), password: runtimeValue("DEPA_OWNER_PAVEL_PASSWORD") },
  ];
  if (owners.some((owner) => !owner.name || !owner.username || !owner.password)) return;

  const timestamp = nowSeconds();
  const statements: { text: string; params: unknown[] }[] = [];
  for (const owner of owners) {
    const password = await makePasswordHash(owner.password!);
    statements.push(
      { text: "INSERT INTO employees (id, full_name, position, status, created_at, updated_at) VALUES ($1, $2, 'Владелец', 'ACTIVE', $3, $4) ON CONFLICT (id) DO NOTHING", params: [owner.employeeId, owner.name, timestamp, timestamp] },
      { text: "INSERT INTO users (id, auth_provider, username, username_normalized, display_name, role, employee_id, status, is_protected_owner, password_hash, password_salt, password_iterations, created_at, updated_at) VALUES ($1, 'LOCAL', $2, $3, $4, 'OWNER', $5, 'ACTIVE', 1, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING", params: [owner.id, owner.username, owner.username!.toLocaleLowerCase("ru-RU"), owner.name, owner.employeeId, password.hash, password.salt, password.iterations, timestamp, timestamp] },
    );
  }
  await transaction(statements);
}

async function audit(actorUserId: string, action: string, entityType: string, entityId: string, metadata: Record<string, unknown> = {}) {
  const unsafe = /password|token|secret|credential/i;
  if (Object.keys(metadata).some((key) => unsafe.test(key))) throw new Error("Sensitive fields are forbidden in audit metadata");
  await query("INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, occurred_at, metadata_json) VALUES ($1, $2, $3, $4, $5, $6, $7)", [crypto.randomUUID(), actorUserId, action, entityType, entityId, nowSeconds(), JSON.stringify(metadata)]);
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
  const failures = await first<{ count: string | number }>("SELECT COUNT(*) AS count FROM auth_attempts WHERE identifier_hash = $1 AND succeeded = 0 AND attempted_at >= $2", [identifierHash, windowStart]);
  if (Number(failures?.count ?? 0) >= 5) return { ok: false as const, status: 429, message: "Слишком много попыток. Повторите через 15 минут." };

  const row = await first<UserRow>("SELECT id, employee_id, display_name, username, role, status, is_protected_owner, password_hash, password_salt, password_iterations FROM users WHERE username_normalized = $1 LIMIT 1", [normalized]);
  const valid = Boolean(row && row.status === "ACTIVE" && await verifyPassword(password, row));
  await query("INSERT INTO auth_attempts (id, identifier_hash, attempted_at, succeeded) VALUES ($1, $2, $3, $4)", [crypto.randomUUID(), identifierHash, nowSeconds(), valid ? 1 : 0]);
  if (!valid || !row) return { ok: false as const, status: 401, message: "Неверный логин или пароль." };

  const token = randomToken();
  const tokenHash = await sha256(token);
  const timestamp = nowSeconds();
  await transaction([
    { text: "INSERT INTO auth_sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7)", params: [crypto.randomUUID(), row.id, tokenHash, timestamp, timestamp, timestamp + SESSION_SECONDS, request.headers.get("user-agent")?.slice(0, 300) ?? null] },
    { text: "UPDATE users SET last_login_at = $1, updated_at = $2 WHERE id = $3", params: [timestamp, timestamp, row.id] },
    { text: "DELETE FROM auth_attempts WHERE identifier_hash = $1", params: [identifierHash] },
    { text: "DELETE FROM auth_sessions WHERE expires_at < $1 OR revoked_at IS NOT NULL", params: [timestamp - 86400] },
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
  const row = await first<UserRow>("SELECT u.id, u.employee_id, u.display_name, u.username, u.role, u.status, u.is_protected_owner, u.password_hash, u.password_salt, u.password_iterations FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND u.status = 'ACTIVE' LIMIT 1", [tokenHash, nowSeconds()]);
  if (!row) return null;
  await query("UPDATE auth_sessions SET last_seen_at = $1 WHERE token_hash = $2", [nowSeconds(), tokenHash]);
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
  const session = await first<{ user_id: string }>("SELECT user_id FROM auth_sessions WHERE token_hash = $1 AND revoked_at IS NULL LIMIT 1", [tokenHash]);
  await query("UPDATE auth_sessions SET revoked_at = $1 WHERE token_hash = $2", [nowSeconds(), tokenHash]);
  if (session) await audit(session.user_id, "AUTH_LOGOUT", "User", session.user_id);
}

export async function changeOwnPassword(request: Request, currentPassword: string, newPassword: string) {
  const token = cookieFromRequest(request);
  const user = await userFromToken(token);
  if (!user || !token) return { ok: false as const, status: 401, message: "Сессия завершена. Войдите снова." };
  if (newPassword.length < 8) return { ok: false as const, status: 400, message: "Новый пароль должен содержать минимум 8 символов." };
  if (newPassword === currentPassword) return { ok: false as const, status: 400, message: "Новый пароль должен отличаться от текущего." };
  const row = await first<UserRow>("SELECT id, employee_id, display_name, username, role, status, is_protected_owner, password_hash, password_salt, password_iterations FROM users WHERE id = $1 LIMIT 1", [user.id]);
  if (!row || !(await verifyPassword(currentPassword, row))) return { ok: false as const, status: 400, message: "Текущий пароль указан неверно." };
  const next = await makePasswordHash(newPassword);
  const tokenHash = await sha256(token);
  const timestamp = nowSeconds();
  await transaction([
    { text: "UPDATE users SET password_hash = $1, password_salt = $2, password_iterations = $3, password_changed_at = $4, updated_at = $5 WHERE id = $6", params: [next.hash, next.salt, next.iterations, timestamp, timestamp, user.id] },
    { text: "UPDATE auth_sessions SET revoked_at = $1 WHERE user_id = $2 AND token_hash <> $3 AND revoked_at IS NULL", params: [timestamp, user.id, tokenHash] },
  ]);
  await audit(user.id, "PASSWORD_CHANGED", "User", user.id);
  return { ok: true as const };
}

export function assertCanManageUser(actor: AuthUser, target: AuthUser, requested: { role?: string; status?: string; password?: string; delete?: boolean }) {
  if (actor.role !== "OWNER") throw new Error("Недостаточно прав");
  if (target.isProtectedOwner && actor.id !== target.id && (requested.role || requested.status || requested.password || requested.delete)) throw new Error("Защищённый Owner не может быть изменён другим пользователем");
  if (requested.password && actor.id !== target.id) throw new Error("Можно изменить только собственный пароль");
}
