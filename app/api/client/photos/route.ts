import { ClientPortalError, getClientPortalPhotos, getClientPortalUser } from "../../../../lib/client-portal";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getClientPortalUser(request);
  if (!user) return Response.json({ error: "Требуется авторизация клиента." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try {
    return Response.json(await getClientPortalPhotos(user, String(params.get("projectId") ?? ""), Number(params.get("offset") ?? 0)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить фото." }, { status: error instanceof ClientPortalError ? error.status : 500 });
  }
}
