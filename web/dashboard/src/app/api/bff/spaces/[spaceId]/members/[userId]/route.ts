import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ spaceId: string; userId: string }> };

function memberPath(spaceId: string, userId: string) {
  return `/v1/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}`;
}

// Changes a member's role. Owners and admins only; the owner role is never set here.
export async function PATCH(request: NextRequest, context: Context) {
  const { spaceId, userId } = await context.params;
  return proxyBff(request, memberPath(spaceId, userId), { method: "PATCH", body: await request.text() });
}

// Removes a member from the organization.
export async function DELETE(request: NextRequest, context: Context) {
  const { spaceId, userId } = await context.params;
  return proxyBff(request, memberPath(spaceId, userId), { method: "DELETE" });
}
