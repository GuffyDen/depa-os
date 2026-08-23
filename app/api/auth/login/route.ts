import { login, sessionCookie } from "../../../../lib/auth";
import { createRequestLogger } from "../../../../lib/request-logger";

export async function POST(request: Request) {
  const log = createRequestLogger(request, { route: "/api/auth/login", action: "EMPLOYEE_LOGIN", actorType: "ANONYMOUS" });
  let body: { username?: unknown; password?: unknown };
  try { body = await request.json(); } catch (error) { log.failure("EMPLOYEE_AUTH_FAILURE", error, { errorCode: "INVALID_JSON" }); return log.json({ error: "Некорректный запрос." }, { status: 400 }); }
  if (typeof body.username !== "string" || typeof body.password !== "string" || !body.username.trim() || !body.password) { log.failure("EMPLOYEE_AUTH_FAILURE", new Error("Missing credentials"), { errorCode: "MISSING_CREDENTIALS" }); return log.json({ error: "Введите логин и пароль." }, { status: 400 }); }
  try {
    const result = await login(body.username, body.password, request);
    if (!result.ok) { log.failure("EMPLOYEE_AUTH_FAILURE", new Error("Authentication rejected"), { errorCode: `AUTH_${result.status}` }); return log.json({ error: result.message }, { status: result.status }); }
    log.success("EMPLOYEE_AUTH_SUCCESS", { actorType: "EMPLOYEE", actorId: result.user.id, entityId: result.user.id });
    return log.json({ user: result.user }, { headers: { "Set-Cookie": sessionCookie(result.token, request.url), "Cache-Control": "no-store" } });
  } catch (error) {
    log.failure("EMPLOYEE_AUTH_FAILURE", error, { errorCode: "AUTH_INTERNAL" });
    return log.json({ error: "Не удалось войти." }, { status: 500 });
  }
}
