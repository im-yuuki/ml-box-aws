import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

export async function PUT(request: NextRequest) {
  return proxyBff(request, "/v1/account/avatar", { method: "PUT", body: await request.text() });
}
