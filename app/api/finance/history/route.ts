import { getRequestUser } from "../../../../lib/auth";
import { FinanceError, getCashboxHistory } from "../../../../lib/finance";

export const dynamic = "force-dynamic";

function historyError(error: unknown) {
  if (error instanceof FinanceError) return Response.json({ error: error.message, ...error.details }, { status: error.status });
  console.error("Finance history API error", error);
  return Response.json({ error: "Не удалось загрузить историю кассы." }, { status: 500 });
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try {
    return Response.json(await getCashboxHistory(user, {
      cashboxId: params.get("cashboxId"),
      dateFrom: params.get("dateFrom"),
      dateTo: params.get("dateTo"),
      transactionType: params.get("transactionType"),
      category: params.get("category"),
      projectId: params.get("projectId"),
      limit: params.get("limit"),
      offset: params.get("offset"),
    }));
  } catch (error) {
    return historyError(error);
  }
}
