import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ spaceId: string }> };

// Deleting an organization is a POST with the typed name, not a DELETE, so the body is always forwarded.
export async function POST(request: NextRequest, context: Context) {
  const { spaceId } = await context.params;
  return proxyBff(request, `/v1/spaces/${encodeURIComponent(spaceId)}/delete`, {
    method: "POST",
    body: await request.text(),
  });
}
