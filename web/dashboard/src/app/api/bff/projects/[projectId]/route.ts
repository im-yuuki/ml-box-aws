import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ projectId: string }> };

/** One Project by its id. The details page needs the Project itself, not the whole list. */
export async function GET(request: NextRequest, context: Context) {
  const { projectId } = await context.params;
  return proxyBff(request, `/v1/projects/${encodeURIComponent(projectId)}`, { method: "GET" });
}

export async function DELETE(request: NextRequest, context: Context) {
  const { projectId } = await context.params;
  return proxyBff(request, `/v1/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
}
