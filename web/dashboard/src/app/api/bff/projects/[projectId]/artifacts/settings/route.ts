import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ projectId: string }> };

export async function PUT(request: NextRequest, context: Context) {
  const { projectId } = await context.params;
  return proxyBff(request, `/v1/projects/${encodeURIComponent(projectId)}/artifacts/settings`, {
    method: "PUT",
    body: await request.text(),
  });
}
