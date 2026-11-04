import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ spaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { spaceId } = await context.params;
  return proxyBff(request, `/v1/spaces/${encodeURIComponent(spaceId)}/teams`, { method: "GET" });
}

export async function POST(request: NextRequest, context: Context) {
  const { spaceId } = await context.params;
  return proxyBff(request, `/v1/spaces/${encodeURIComponent(spaceId)}/teams`, {
    method: "POST",
    body: await request.text(),
  });
}
