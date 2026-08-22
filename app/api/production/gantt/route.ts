import { getRequestUser } from "../../../../lib/auth";
import { getProduction,ProductionError } from "../../../../lib/production";
import { AccessError,assertModuleAction } from "../../../../lib/permissions";
export const dynamic="force-dynamic";
export async function GET(request:Request){const actor=await getRequestUser(request);if(!actor)return Response.json({error:"Требуется авторизация."},{status:401});try{await assertModuleAction(actor,"projects","production.viewGantt");const projectId=new URL(request.url).searchParams.get("projectId")??"",data=await getProduction(actor,projectId);return Response.json({plan:data.plan,stages:data.stages,dependencies:data.dependencies,progress:data.progress},{headers:{"Cache-Control":"private, no-store"}})}catch(error){if(error instanceof ProductionError||error instanceof AccessError)return Response.json({error:error.message},{status:error.status});return Response.json({error:"Не удалось загрузить график."},{status:500})}}
