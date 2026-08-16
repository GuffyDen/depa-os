import { getRequestUser } from "../../../../lib/auth";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Не авторизован." }, { status: 401 });
  return Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
}
