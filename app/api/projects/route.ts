import { getRequestUser } from "../../../lib/auth";
import { createProject, listProjects, ProjectError, type ProjectInput } from "../../../lib/projects";
import { AccessError } from "../../../lib/permissions";
import { ResidentialComplexError } from "../../../lib/residential-complexes";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof ProjectError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ResidentialComplexError) return Response.json({ error: error.message, ...error.details }, { status: error.status });
  if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Projects API error", error);
  return Response.json({ error: "Не удалось выполнить операцию с объектом." }, { status: 500 });
}

export async function GET(request: Request) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json(await listProjects(actor, request.url), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json(await createProject(actor, await request.json() as ProjectInput), { status: 201 }); }
  catch (error) { return failure(error); }
}
