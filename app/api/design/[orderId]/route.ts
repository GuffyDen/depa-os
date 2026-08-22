import { getRequestUser } from "../../../../lib/auth";
import {
  archiveDesignAttachment,
  DesignError,
  getDesignProject,
  linkDesignAttachment,
  type DesignInput,
  updateDesignProject,
} from "../../../../lib/design";
import { AccessError } from "../../../../lib/permissions";

export const dynamic = "force-dynamic";

function fail(error: unknown) {
  if (error instanceof DesignError)
    return Response.json(
      { error: error.message, ...error.details },
      { status: error.status },
    );
  if (error instanceof AccessError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error("Design API error", error);
  return Response.json(
    { error: "Не удалось выполнить операцию с дизайн-проектом." },
    { status: 500 },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const actor = await getRequestUser(request);
  if (!actor)
    return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    return Response.json(await getDesignProject(actor, (await params).orderId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const actor = await getRequestUser(request);
  if (!actor)
    return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    const orderId = (await params).orderId;
    const body = (await request.json()) as DesignInput & {
      action?: string;
      attachmentId?: string;
    };
    if (body.action === "LINK_FILE")
      return Response.json(await linkDesignAttachment(actor, orderId, body));
    if (body.action === "ARCHIVE_FILE" && body.attachmentId)
      return Response.json(
        await archiveDesignAttachment(actor, orderId, body.attachmentId),
      );
    return Response.json(await updateDesignProject(actor, orderId, body));
  } catch (error) {
    return fail(error);
  }
}
