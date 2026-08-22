import { getRequestUser } from "../../../lib/auth";
import { createEstimate, EstimateError, listEstimates, type EstimateInput } from "../../../lib/estimates";
import { AccessError } from "../../../lib/permissions";
import { ResidentialComplexError } from "../../../lib/residential-complexes";

export const dynamic = "force-dynamic";

function fail(error: unknown) {
  if (error instanceof EstimateError || error instanceof ResidentialComplexError) return Response.json({ error: error.message, ...(error instanceof EstimateError ? error.details : {}) }, { status: error.status });
  if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Estimates API error", error);
  return Response.json({ error: "Не удалось выполнить операцию со сметами." }, { status: 500 });
}

export async function GET(request: Request) {
  const actor = await getRequestUser(request); if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json(await listEstimates(actor, request.url), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  const actor = await getRequestUser(request); if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json(await createEstimate(actor, await request.json() as EstimateInput), { status: 201 }); } catch (error) { return fail(error); }
}
