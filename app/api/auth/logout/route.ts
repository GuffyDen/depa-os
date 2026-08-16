import { expiredSessionCookie, logout } from "../../../../lib/auth";

export async function POST(request: Request) {
  await logout(request);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": expiredSessionCookie(request.url), "Cache-Control": "no-store" } });
}
