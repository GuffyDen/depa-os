import { getRequestUser } from "../../../../lib/auth";
import { createTemplate,listTemplates,mutateTemplate,ProductionError,type ProductionInput } from "../../../../lib/production";
import { AccessError } from "../../../../lib/permissions";
export const dynamic="force-dynamic";
function fail(error:unknown){if(error instanceof ProductionError||error instanceof AccessError)return Response.json({error:error.message},{status:error.status});return Response.json({error:"Не удалось выполнить операцию с шаблоном."},{status:500})}
export async function GET(request:Request){const actor=await getRequestUser(request);if(!actor)return Response.json({error:"Требуется авторизация."},{status:401});try{return Response.json(await listTemplates(actor),{headers:{"Cache-Control":"private, no-store"}})}catch(error){return fail(error)}}
export async function POST(request:Request){const actor=await getRequestUser(request);if(!actor)return Response.json({error:"Требуется авторизация."},{status:401});try{return Response.json(await createTemplate(actor,await request.json() as ProductionInput),{status:201})}catch(error){return fail(error)}}
export async function PATCH(request:Request){const actor=await getRequestUser(request);if(!actor)return Response.json({error:"Требуется авторизация."},{status:401});try{return Response.json(await mutateTemplate(actor,await request.json() as ProductionInput))}catch(error){return fail(error)}}
