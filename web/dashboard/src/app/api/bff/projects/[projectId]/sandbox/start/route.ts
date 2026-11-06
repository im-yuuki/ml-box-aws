import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { projectId } = await context.params;
  // The body is optional; it carries the sandbox configuration ({ profile }).
  const body = await request.text();
  return proxyBff(request, `/v1/projects/${encodeURIComponent(projectId)}/sandbox/start`, {
    method: "POST",
    body: body || undefined,
  });
}
