import { getRequestUser } from "../../../../lib/auth";
import { AccessError } from "../../../../lib/permissions";
import {
  getResidentialComplex,
  ResidentialComplexError,
  setResidentialComplexArchived,
  type ResidentialComplexInput,
  updateResidentialComplex,
} from "../../../../lib/residential-complexes";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof ResidentialComplexError)
    return Response.json(
      { error: error.message, ...error.details },
      { status: error.status },
    );
  if (error instanceof AccessError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error("Residential complex detail API error", error);
  return Response.json(
    { error: "Не удалось выполнить операцию с ЖК." },
    { status: 500 },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getRequestUser(request);
  if (!actor)
    return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    return Response.json(await getResidentialComplex(actor, (await params).id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getRequestUser(request);
  if (!actor)
    return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    const id = (await params).id;
    const body = (await request.json()) as ResidentialComplexInput & {
      action?: "ARCHIVE" | "RESTORE";
    };
    if (body.action === "ARCHIVE")
      return Response.json(await setResidentialComplexArchived(actor, id, true));
    if (body.action === "RESTORE")
      return Response.json(await setResidentialComplexArchived(actor, id, false));
    return Response.json(await updateResidentialComplex(actor, id, body));
  } catch (error) {
    return failure(error);
  }
}
