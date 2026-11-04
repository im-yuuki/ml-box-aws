import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ invitationId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { invitationId } = await context.params;
  return proxyBff(request, `/v1/invitations/${encodeURIComponent(invitationId)}/accept`, { method: "POST" });
}
