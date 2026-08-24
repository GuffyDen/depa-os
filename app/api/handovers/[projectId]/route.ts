import { getRequestUser } from "@/lib/auth";
import { cancelProjectHandover, getProjectHandover, HandoverError, manualAcceptProjectHandover, prepareProjectHandover, requestHandoverReinspection, sendProjectHandover } from "@/lib/handovers";
import { AccessError } from "@/lib/permissions";
import { createRequestLogger } from "@/lib/request-logger";

type Context = { params: Promise<{ projectId: string }> };
const status = (error: unknown) => error instanceof HandoverError || error instanceof AccessError ? error.status : 500;

export async function GET(request: Request, { params }: Context) { const actor = await getRequestUser(request); if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 }); try { return Response.json(await getProjectHandover(actor, (await params).projectId), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить финальную сдачу." }, { status: status(error) }); } }

export async function PATCH(request: Request, { params }: Context) {
  const actor = await getRequestUser(request), projectId = (await params).projectId, log = createRequestLogger(request, { route: "/api/handovers/[projectId]", action: "HANDOVER_MUTATION", actorType: actor ? "EMPLOYEE" : "ANONYMOUS", actorId: actor?.id ?? null, entityId: projectId });
  if (!actor) return log.json({ error: "Требуется авторизация." }, { status: 401 }); let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return log.json({ error: "Некорректные данные." }, { status: 400 }); } const action = String(body.action ?? "");
  try { const result = action === "PREPARE" ? await prepareProjectHandover(actor, projectId) : action === "SEND" ? await sendProjectHandover(actor, projectId) : action === "MANUAL_ACCEPT" ? await manualAcceptProjectHandover(actor, projectId, body) : action === "REQUEST_REINSPECTION" ? await requestHandoverReinspection(actor, projectId) : action === "CANCEL" ? await cancelProjectHandover(actor, projectId, body.reason) : (() => { throw new HandoverError("Неизвестное действие."); })(); log.success(`HANDOVER_${action}_SUCCESS`, { projectId }); return log.json(result); }
  catch (error) { log.failure(`HANDOVER_${action || "UNKNOWN"}_FAILURE`, error, { projectId, errorCode: `HANDOVER_${status(error)}` }); return log.json({ error: error instanceof Error ? error.message : "Не удалось выполнить действие.", details: error instanceof HandoverError ? error.details : undefined }, { status: status(error) }); }
}
