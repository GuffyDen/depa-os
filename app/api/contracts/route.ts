import { getRequestUser } from "../../../lib/auth";
import { ContractError, createContract, listContracts, type ContractInput } from "../../../lib/contracts";
import { AccessError } from "../../../lib/permissions";
export const dynamic="force-dynamic";
function fail(error:unknown){if(error instanceof ContractError)return Response.json({error:error.message,...error.details},{status:error.status});if(error instanceof AccessError)return Response.json({error:error.message},{status:error.status});console.error("Contracts API error",error);return Response.json({error:"Не удалось выполнить операцию с договорами."},{status:500});}
export async function GET(request:Request){const actor=await getRequestUser(request);if(!actor)return Response.json({error:"Требуется авторизация."},{status:401});try{return Response.json(await listContracts(actor,request.url),{headers:{"Cache-Control":"private, no-store"}})}catch(error){return fail(error)}}
export async function POST(request:Request){const actor=await getRequestUser(request);if(!actor)return Response.json({error:"Требуется авторизация."},{status:401});try{return Response.json(await createContract(actor,await request.json() as ContractInput),{status:201})}catch(error){return fail(error)}}
