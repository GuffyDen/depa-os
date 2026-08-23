import { getRequestUser } from "../../../../lib/auth";
import { FinanceError, getTeamFinanceAccess, setTeamFinanceAccess } from "../../../../lib/finance";
import { createRequestLogger } from "../../../../lib/request-logger";

export const dynamic = "force-dynamic";

function accessError(error: unknown) {
  if (error instanceof FinanceError) return Response.json({ error: error.message, ...error.details }, { status: error.status });
  console.error("Team finance access API error", error);
  return Response.json({ error: "Не удалось обновить финансовые права." }, { status: 500 });
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json({ members: await getTeamFinanceAccess(user) }); }
  catch (error) { return accessError(error); }
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  const log=createRequestLogger(request,{route:"/api/team/finance-access",action:"CASHBOX_ACCESS_MUTATION",actorType:user?"EMPLOYEE":"ANONYMOUS",actorId:user?.id??null});
  if (!user) { log.failure("CASHBOX_ACCESS_MUTATION_FAILURE",new Error("Unauthorized"),{errorCode:"UNAUTHORIZED"}); return log.json({ error: "Требуется авторизация." }, { status: 401 }); }
  let body: { userId?: unknown; financeAccess?: unknown; ownCashbox?: unknown; confirmNonZero?: unknown };
  try { body = await request.json() as typeof body; }
  catch (error) { log.failure("CASHBOX_ACCESS_MUTATION_FAILURE",error,{errorCode:"INVALID_JSON"}); return log.json({ error: "Некорректные данные прав доступа." }, { status: 400 }); }
  const targetUserId=typeof body.userId==="string"?body.userId:null,cashboxAction=body.ownCashbox===true?"ACTIVATE":body.ownCashbox===false?"DEACTIVATE":"UNCHANGED";
  try { const result=await setTeamFinanceAccess(user, body); log.success(cashboxAction==="ACTIVATE"?"CASHBOX_ACTIVATION_SUCCESS":cashboxAction==="DEACTIVATE"?"CASHBOX_DEACTIVATION_SUCCESS":"FINANCE_ACCESS_MUTATION_SUCCESS",{entityId:targetUserId,cashboxAction}); return log.json(result); }
  catch (error) { log.failure(cashboxAction==="ACTIVATE"?"CASHBOX_ACTIVATION_FAILURE":cashboxAction==="DEACTIVATE"?"CASHBOX_DEACTIVATION_FAILURE":"FINANCE_ACCESS_MUTATION_FAILURE",error,{entityId:targetUserId,cashboxAction,errorCode:error instanceof FinanceError?`FINANCE_ACCESS_${error.status}`:"FINANCE_ACCESS_INTERNAL"}); return log.withRequestId(accessError(error)); }
}
