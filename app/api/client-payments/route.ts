import { getRequestUser } from "../../../lib/auth";
import { ClientPortalError, confirmPaymentClaim, listPaymentClaims, rejectPaymentClaim } from "../../../lib/client-portal";
import { AccessError } from "../../../lib/permissions";
import { createRequestLogger } from "../../../lib/request-logger";

function fail(error: unknown) { return Response.json({ error: error instanceof Error ? error.message : "Не удалось обработать оплату." }, { status: error instanceof ClientPortalError || error instanceof AccessError ? error.status : 500 }); }

export async function GET(request: Request) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json({ items: await listPaymentClaims(actor) }); } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  const actor = await getRequestUser(request);
  const log = createRequestLogger(request, { route: "/api/client-payments", action: "CLIENT_PAYMENT_CONFIRMATION", actorType: actor ? "EMPLOYEE" : "ANONYMOUS", actorId: actor?.id ?? null });
  if (!actor) { log.failure("CLIENT_PAYMENT_CONFIRMATION_FAILURE", new Error("Unauthorized"), { errorCode: "UNAUTHORIZED" }); return log.json({ error: "Требуется авторизация." }, { status: 401 }); }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch (error) { log.failure("CLIENT_PAYMENT_CONFIRMATION_FAILURE", error, { errorCode: "INVALID_JSON" }); return log.json({ error: "Некорректные данные оплаты." }, { status: 400 }); }
  const claimId = String(body.claimId ?? "");
  const cashboxId = String(body.cashboxId ?? "") || null;
  const action = body.action === "REJECT" ? "REJECT" : "CONFIRM";
  try {
    const result = action === "REJECT" ? await rejectPaymentClaim(actor, claimId, String(body.comment ?? "")) : await confirmPaymentClaim(actor, claimId, Number(body.actualAmountKopecks), String(body.cashboxId ?? ""), Number(body.receivedAt), String(body.comment ?? ""));
    log.success(action === "REJECT" ? "CLIENT_PAYMENT_REJECTION_SUCCESS" : "CLIENT_PAYMENT_CONFIRMATION_SUCCESS", { claimId, entityId: claimId, projectId: result.projectId, clientId: result.clientId, cashboxId, confirmedAmountMinor: action === "CONFIRM" ? Number(body.actualAmountKopecks) : null });
    return log.json(result);
  } catch (error) {
    log.failure(action === "REJECT" ? "CLIENT_PAYMENT_REJECTION_FAILURE" : "CLIENT_PAYMENT_CONFIRMATION_FAILURE", error, { claimId, entityId: claimId, cashboxId, errorCode: error instanceof ClientPortalError || error instanceof AccessError ? `PAYMENT_${error.status}` : "PAYMENT_INTERNAL" });
    return log.withRequestId(fail(error));
  }
}
