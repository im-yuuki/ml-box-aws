import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

export async function POST(request: NextRequest) {
  return proxyBff(request, "/v1/subscription/cancel", {
    method: "POST",
    body: await request.text(),
  });
}
