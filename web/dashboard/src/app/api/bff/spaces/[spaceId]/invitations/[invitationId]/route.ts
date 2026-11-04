import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ spaceId: string; invitationId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  const { spaceId, invitationId } = await context.params;
  return proxyBff(request, `/v1/spaces/${encodeURIComponent(spaceId)}/invitations/${encodeURIComponent(invitationId)}`, { method: "DELETE" });
}
