import { changeOwnPassword } from "../../../../lib/auth";

export async function POST(request: Request) {
  let body: { currentPassword?: unknown; newPassword?: unknown; confirmPassword?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Некорректный запрос." }, { status: 400 }); }
  if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string" || typeof body.confirmPassword !== "string") return Response.json({ error: "Заполните все поля." }, { status: 400 });
  if (body.newPassword !== body.confirmPassword) return Response.json({ error: "Новый пароль и подтверждение не совпадают." }, { status: 400 });
  const result = await changeOwnPassword(request, body.currentPassword, body.newPassword);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
