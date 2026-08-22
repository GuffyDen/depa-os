import { getRequestUser } from "../../../../lib/auth";
import { approveEstimate, archiveEstimate, createEstimateVersion, createProposalFollowUp, createRenovationFromEstimate, EstimateError, getEstimate, rejectEstimate, saveDraft, sendProposal, type EstimateInput } from "../../../../lib/estimates";
import { AccessError } from "../../../../lib/permissions";

export const dynamic = "force-dynamic";
function fail(error: unknown) {
  if (error instanceof EstimateError) return Response.json({ error: error.message, ...error.details }, { status: error.status });
  if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Estimate API error", error); return Response.json({ error: "Не удалось выполнить операцию со сметой." }, { status: 500 });
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getRequestUser(request); if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { const { id } = await context.params; return Response.json(await getEstimate(actor, id, new URL(request.url).searchParams.get("versionId")), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return fail(error); }
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getRequestUser(request); if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    const { id } = await context.params, body = await request.json() as EstimateInput, action = String(body.action ?? "save");
    if (action === "createVersion") return Response.json(await createEstimateVersion(actor, id, body), { status: 201 });
    if (action === "send") return Response.json(await sendProposal(actor, id, body));
    if (action === "approve") return Response.json(await approveEstimate(actor, id, body));
    if (action === "reject") return Response.json(await rejectEstimate(actor, id, body));
    if (action === "archive" || action === "restore") return Response.json(await archiveEstimate(actor, id, action === "archive"));
    if (action === "followUp") return Response.json(await createProposalFollowUp(actor, id, body), { status: 201 });
    if (action === "createRenovation") return Response.json(await createRenovationFromEstimate(actor, id, body), { status: 201 });
    return Response.json(await saveDraft(actor, id, body));
  } catch (error) { return fail(error); }
}
