import { getRequestUser } from "../../../lib/auth";
import { ContractError, getCompanySettings, saveCompanySettings, type ContractInput } from "../../../lib/contracts";
import { AccessError } from "../../../lib/permissions";
export const dynamic="force-dynamic";
function fail(error:unknown){if(error instanceof ContractError)return Response.json({error:error.message},{status:error.status});if(error instanceof AccessError)return Response.json({error:error.message},{status:error.status});console.error("Company settings API error",error);return Response.json({error:"Не удалось выполнить операцию с реквизитами."},{status:500});}
export async function GET(request:Request){const actor=await getRequestUser(request);if(!actor)return Response.json({error:"Требуется авторизация."},{status:401});try{return Response.json(await getCompanySettings(actor),{headers:{"Cache-Control":"private, no-store"}})}catch(error){return fail(error)}}
export async function PATCH(request:Request){const actor=await getRequestUser(request);if(!actor)return Response.json({error:"Требуется авторизация."},{status:401});try{return Response.json(await saveCompanySettings(actor,await request.json() as ContractInput))}catch(error){return fail(error)}}
