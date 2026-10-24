import type { NextRequest } from "next/server";
async function forward(request:NextRequest,{params}:{params:Promise<{path?:string[]}>}) {
  const secret=process.env.CLERK_SECRET_KEY;
  if(!secret)return new Response("Authentication proxy is not configured.",{status:503});
  const {path=[]}=await params;
  const host=request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()||request.headers.get("host")||"";
  const protocol=request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()||"https";
  const headers=new Headers(request.headers);
  for(const name of ["host","connection","content-length","transfer-encoding","accept-encoding","keep-alive"])headers.delete(name);
  headers.set("Clerk-Proxy-Url",`${protocol}://${host}/api/__clerk`);
  headers.set("Clerk-Secret-Key",secret);
  const upstream=await fetch("https://frontend-api.clerk.dev/"+path.map(encodeURIComponent).join("/")+request.nextUrl.search,{
    method:request.method,headers,body:["GET","HEAD"].includes(request.method)?undefined:await request.arrayBuffer(),redirect:"manual",signal:AbortSignal.timeout(20000),
  });
  const body=await upstream.arrayBuffer(),responseHeaders=new Headers(upstream.headers);
  for(const name of ["content-encoding","transfer-encoding","content-length","connection","set-cookie","clerk-secret-key"])responseHeaders.delete(name);
  for(const cookie of upstream.headers.getSetCookie())responseHeaders.append("set-cookie",cookie);
  responseHeaders.set("content-length",String(body.byteLength));
  return new Response([204,205,304].includes(upstream.status)?null:body,{status:upstream.status,headers:responseHeaders});
}
export {forward as GET,forward as POST,forward as PUT,forward as PATCH,forward as DELETE,forward as OPTIONS};
