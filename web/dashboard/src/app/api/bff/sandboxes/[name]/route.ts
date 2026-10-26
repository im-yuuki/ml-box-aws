import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ name: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  const { name } = await context.params;
  return proxyBff(request, `/v1/sandboxes/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}
