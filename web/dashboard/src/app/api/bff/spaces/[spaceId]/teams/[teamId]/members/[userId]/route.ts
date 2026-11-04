import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ spaceId: string; teamId: string; userId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  const { spaceId, teamId, userId } = await context.params;
  return proxyBff(
    request,
    `/v1/spaces/${encodeURIComponent(spaceId)}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
}
