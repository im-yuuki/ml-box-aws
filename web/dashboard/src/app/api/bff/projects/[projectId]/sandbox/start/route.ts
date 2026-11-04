import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { projectId } = await context.params;
  return proxyBff(request, `/v1/projects/${encodeURIComponent(projectId)}/sandbox/start`, { method: "POST" });
}
