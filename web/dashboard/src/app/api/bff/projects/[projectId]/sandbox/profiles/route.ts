import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { projectId } = await context.params;
  return proxyBff(request, `/v1/projects/${encodeURIComponent(projectId)}/sandbox/profiles`, { method: "GET" });
}
