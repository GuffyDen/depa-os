import { getRequestUser } from "@/lib/auth";
import { AdditionalWorkError, applyAdditionalWorkSchedule, cancelAdditionalWorkDraft, createAdditionalWorkVersion, getAdditionalWork, manuallyApproveAdditionalWork, previewAdditionalWorkSchedule, sendAdditionalWork, updateAdditionalWorkDraft, withdrawAdditionalWork } from "@/lib/additional-works";
import { AccessError } from "@/lib/permissions";
import { createRequestLogger } from "@/lib/request-logger";

const code = (error: unknown) => error instanceof AdditionalWorkError || error instanceof AccessError ? error.status : 500;
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const actor = await getRequestUser(request); if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json(await getAdditionalWork(actor, (await params).id), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить дополнительную работу." }, { status: code(error) }); }
}

export async function PATCH(request: Request, { params }: Context) {
  const actor = await getRequestUser(request), workId = (await params).id, log = createRequestLogger(request, { route: "/api/additional-works/[id]", action: "ADDITIONAL_WORK_MUTATION", actorType: actor ? "EMPLOYEE" : "ANONYMOUS", actorId: actor?.id ?? null, entityId: workId });
  if (!actor) { log.failure("ADDITIONAL_WORK_MUTATION_FAILURE", new Error("Unauthorized"), { errorCode: "UNAUTHORIZED" }); return log.json({ error: "Требуется авторизация." }, { status: 401 }); }
  let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch (error) { log.failure("ADDITIONAL_WORK_MUTATION_FAILURE", error, { errorCode: "INVALID_JSON" }); return log.json({ error: "Некорректные данные." }, { status: 400 }); }
  const action = String(body.action ?? "UPDATE");
  try {
    const result = action === "UPDATE" ? await updateAdditionalWorkDraft(actor, workId, body)
      : action === "CREATE_VERSION" ? await createAdditionalWorkVersion(actor, workId)
      : action === "SEND" ? await sendAdditionalWork(actor, workId)
      : action === "WITHDRAW" ? await withdrawAdditionalWork(actor, workId, String(body.comment ?? ""))
      : action === "MANUAL_APPROVE" ? await manuallyApproveAdditionalWork(actor, workId, String(body.comment ?? ""))
      : action === "CANCEL" ? await cancelAdditionalWorkDraft(actor, workId, String(body.comment ?? ""))
      : action === "SCHEDULE_PREVIEW" ? await previewAdditionalWorkSchedule(actor, workId)
      : action === "SCHEDULE_APPLY" ? await applyAdditionalWorkSchedule(actor, workId)
      : (() => { throw new AdditionalWorkError("Неизвестное действие."); })();
    log.success(`ADDITIONAL_WORK_${action}_SUCCESS`, { entityId: workId, additionalWorkAction: action }); return log.json(result);
  } catch (error) { log.failure(`ADDITIONAL_WORK_${action}_FAILURE`, error, { entityId: workId, additionalWorkAction: action, errorCode: `ADDITIONAL_WORK_${code(error)}` }); return log.json({ error: error instanceof Error ? error.message : "Не удалось выполнить действие.", details: error instanceof AdditionalWorkError ? error.details : undefined }, { status: code(error) }); }
}
