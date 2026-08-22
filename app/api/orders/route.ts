import { getRequestUser } from "../../../lib/auth";
import {
  createOrder,
  listInspectionCalendar,
  listOrders,
  OrderError,
  type OrderInput,
} from "../../../lib/orders";
import { AccessError } from "../../../lib/permissions";
import {
  createDesignOrder,
  createRenovationOrder,
  DesignError,
} from "../../../lib/design";
export const dynamic = "force-dynamic";
function fail(error: unknown) {
  if (error instanceof OrderError)
    return Response.json(
      { error: error.message, ...error.details },
      { status: error.status },
    );
  if (error instanceof AccessError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof DesignError)
    return Response.json(
      { error: error.message, ...error.details },
      { status: error.status },
    );
  console.error("Orders API error", error);
  return Response.json(
    { error: "Не удалось выполнить операцию с заказами." },
    { status: 500 },
  );
}
export async function GET(request: Request) {
  const actor = await getRequestUser(request);
  if (!actor)
    return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    const view = new URL(request.url).searchParams.get("view");
    return Response.json(
      view === "calendar"
        ? await listInspectionCalendar(actor, request.url)
        : await listOrders(actor, request.url),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  const actor = await getRequestUser(request);
  if (!actor)
    return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    const body = (await request.json()) as OrderInput;
    const type = typeof body.type === "string" ? body.type : "INSPECTION";
    return Response.json(
      type === "DESIGN"
        ? await createDesignOrder(actor, body)
        : type === "RENOVATION"
          ? await createRenovationOrder(actor, body)
          : await createOrder(actor, body),
      { status: 201 },
    );
  } catch (error) {
    return fail(error);
  }
}
