import { getRequestUser } from "../../../../lib/auth";
import { getAccessProfile } from "../../../../lib/permissions";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Не авторизован." }, { status: 401 });
  return Response.json({ user, access: await getAccessProfile(user) }, { headers: { "Cache-Control": "no-store" } });
}
