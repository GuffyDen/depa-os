import { login, sessionCookie } from "../../../../lib/auth";

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Некорректный запрос." }, { status: 400 }); }
  if (typeof body.username !== "string" || typeof body.password !== "string" || !body.username.trim() || !body.password) return Response.json({ error: "Введите логин и пароль." }, { status: 400 });
  const result = await login(body.username, body.password, request);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  return Response.json({ user: result.user }, { headers: { "Set-Cookie": sessionCookie(result.token, request.url), "Cache-Control": "no-store" } });
}
