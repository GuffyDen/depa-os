import { getRequestUser } from "../../../../lib/auth";
import { getProject, ProjectError, setProjectArchived, updateProject, type ProjectInput } from "../../../../lib/projects";
import { AccessError } from "../../../../lib/permissions";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof ProjectError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Project detail API error", error);
  return Response.json({ error: "Не удалось выполнить операцию с объектом." }, { status: 500 });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json(await getProject(actor, (await params).id), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return failure(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    const id=(await params).id;
    const body=await request.json() as ProjectInput & { action?: "ARCHIVE"|"RESTORE" };
    if(body.action==="ARCHIVE") return Response.json(await setProjectArchived(actor,id,true));
    if(body.action==="RESTORE") return Response.json(await setProjectArchived(actor,id,false));
    return Response.json(await updateProject(actor,id,body));
  } catch(error) { return failure(error); }
}
