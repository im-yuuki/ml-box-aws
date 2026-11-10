import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ spaceId: string }> };

// Hands the ownership to one admin. The current owner becomes an admin.
export async function POST(request: NextRequest, context: Context) {
  const { spaceId } = await context.params;
  return proxyBff(request, `/v1/spaces/${encodeURIComponent(spaceId)}/transfer-ownership`, {
    method: "POST",
    body: await request.text(),
  });
}
