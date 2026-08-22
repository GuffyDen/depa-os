import { getRequestUser } from "../../../../../lib/auth";
import { EstimateError, getProposal } from "../../../../../lib/estimates";
import { AccessError } from "../../../../../lib/permissions";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getRequestUser(request); if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { const { id } = await context.params; return Response.json(await getProposal(actor, id, new URL(request.url).searchParams.get("versionId")), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { if (error instanceof EstimateError || error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status }); console.error("Proposal API error", error); return Response.json({ error: "Не удалось открыть КП." }, { status: 500 }); }
}
