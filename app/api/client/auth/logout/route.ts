import { expiredClientSessionCookie, logoutClientPortal } from "../../../../../lib/client-portal";
export async function POST(request:Request){await logoutClientPortal(request);return Response.json({ok:true},{headers:{"Set-Cookie":expiredClientSessionCookie(request.url)}})}
