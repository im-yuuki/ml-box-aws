import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ spaceId: string; teamId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { spaceId, teamId } = await context.params;
  return proxyBff(request, `/v1/spaces/${encodeURIComponent(spaceId)}/teams/${encodeURIComponent(teamId)}/members`, { method: "GET" });
}

export async function POST(request: NextRequest, context: Context) {
  const { spaceId, teamId } = await context.params;
  return proxyBff(request, `/v1/spaces/${encodeURIComponent(spaceId)}/teams/${encodeURIComponent(teamId)}/members`, {
    method: "POST",
    body: await request.text(),
  });
}
