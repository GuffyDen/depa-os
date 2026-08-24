import { getRequestUser } from "@/lib/auth";
import { AdditionalWorkError, createAdditionalWork, listAdditionalWorks } from "@/lib/additional-works";
import { AccessError } from "@/lib/permissions";
import { createRequestLogger } from "@/lib/request-logger";

const status = (error: unknown) => error instanceof AdditionalWorkError || error instanceof AccessError ? error.status : 500;

export async function GET(request: Request) {
  const actor = await getRequestUser(request); if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json(await listAdditionalWorks(actor, request.url), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить дополнительные работы." }, { status: status(error) }); }
}

export async function POST(request: Request) {
  const actor = await getRequestUser(request), log = createRequestLogger(request, { route: "/api/additional-works", action: "ADDITIONAL_WORK_CREATE", actorType: actor ? "EMPLOYEE" : "ANONYMOUS", actorId: actor?.id ?? null });
  if (!actor) { log.failure("ADDITIONAL_WORK_CREATE_FAILURE", new Error("Unauthorized"), { errorCode: "UNAUTHORIZED" }); return log.json({ error: "Требуется авторизация." }, { status: 401 }); }
  let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch (error) { log.failure("ADDITIONAL_WORK_CREATE_FAILURE", error, { errorCode: "INVALID_JSON" }); return log.json({ error: "Некорректные данные." }, { status: 400 }); }
  try { const result = await createAdditionalWork(actor, body); log.success("ADDITIONAL_WORK_CREATE_SUCCESS", { entityId: result.id, projectId: result.project_id }); return log.json(result, { status: 201 }); }
  catch (error) { log.failure("ADDITIONAL_WORK_CREATE_FAILURE", error, { projectId: String(body.projectId ?? "") || null, errorCode: `ADDITIONAL_WORK_${status(error)}` }); return log.json({ error: error instanceof Error ? error.message : "Не удалось создать дополнительную работу.", details: error instanceof AdditionalWorkError ? error.details : undefined }, { status: status(error) }); }
}
