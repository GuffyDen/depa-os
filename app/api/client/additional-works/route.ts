import { AdditionalWorkError, approveAdditionalWorkByClient, getClientAdditionalWork, listClientAdditionalWorks, rejectAdditionalWorkByClient } from "@/lib/additional-works";
import { getClientPortalUser } from "@/lib/client-portal";
import { createRequestLogger } from "@/lib/request-logger";

export async function GET(request: Request) {
  const user = await getClientPortalUser(request); if (!user) return Response.json({ error: "Требуется авторизация клиента." }, { status: 401 });
  const url = new URL(request.url), workId = url.searchParams.get("id"), projectId = url.searchParams.get("projectId");
  try { return Response.json(workId ? await getClientAdditionalWork(user, workId) : await listClientAdditionalWorks(user, projectId ?? ""), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить дополнительные работы." }, { status: error instanceof AdditionalWorkError ? error.status : 500 }); }
}

export async function POST(request: Request) {
  const user = await getClientPortalUser(request), log = createRequestLogger(request, { route: "/api/client/additional-works", action: "ADDITIONAL_WORK_CLIENT_DECISION", actorType: user ? "CLIENT" : "ANONYMOUS", actorId: user?.id ?? null, clientId: user?.clientId ?? null });
  if (!user) { log.failure("ADDITIONAL_WORK_CLIENT_DECISION_FAILURE", new Error("Unauthorized"), { errorCode: "UNAUTHORIZED" }); return log.json({ error: "Требуется авторизация клиента." }, { status: 401 }); }
  let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch (error) { log.failure("ADDITIONAL_WORK_CLIENT_DECISION_FAILURE", error, { errorCode: "INVALID_JSON" }); return log.json({ error: "Некорректные данные." }, { status: 400 }); }
  const workId = String(body.additionalWorkId ?? ""), action = body.action === "APPROVE" ? "APPROVE" : body.action === "REJECT" ? "REJECT" : "UNKNOWN";
  try { const result = action === "APPROVE" ? await approveAdditionalWorkByClient(user, workId) : action === "REJECT" ? await rejectAdditionalWorkByClient(user, workId, String(body.comment ?? "")) : (() => { throw new AdditionalWorkError("Неизвестное действие."); })(); log.success(action === "APPROVE" ? "ADDITIONAL_WORK_APPROVAL_SUCCESS" : "ADDITIONAL_WORK_REJECTION_SUCCESS", { entityId: workId, projectId: result.projectId, clientId: user.clientId }); return log.json(result); }
  catch (error) { log.failure(action === "APPROVE" ? "ADDITIONAL_WORK_APPROVAL_FAILURE" : "ADDITIONAL_WORK_REJECTION_FAILURE", error, { entityId: workId, errorCode: `ADDITIONAL_WORK_${error instanceof AdditionalWorkError ? error.status : 500}` }); return log.json({ error: error instanceof Error ? error.message : "Не удалось сохранить решение." }, { status: error instanceof AdditionalWorkError ? error.status : 500 }); }
}
