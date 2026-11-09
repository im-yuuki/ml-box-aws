import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ sessionId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  const { sessionId } = await context.params;
  return proxyBff(request, `/v1/account/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}
