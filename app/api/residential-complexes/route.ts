import { getRequestUser } from "../../../lib/auth";
import { AccessError } from "../../../lib/permissions";
import {
  createResidentialComplex,
  listResidentialComplexes,
  ResidentialComplexError,
  type ResidentialComplexInput,
} from "../../../lib/residential-complexes";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof ResidentialComplexError)
    return Response.json(
      { error: error.message, ...error.details },
      { status: error.status },
    );
  if (error instanceof AccessError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error("Residential complexes API error", error);
  return Response.json(
    { error: "Не удалось выполнить операцию со справочником ЖК." },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  const actor = await getRequestUser(request);
  if (!actor)
    return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    return Response.json(await listResidentialComplexes(actor, request.url), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const actor = await getRequestUser(request);
  if (!actor)
    return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    return Response.json(
      await createResidentialComplex(
        actor,
        (await request.json()) as ResidentialComplexInput,
      ),
      { status: 201 },
    );
  } catch (error) {
    return failure(error);
  }
}
