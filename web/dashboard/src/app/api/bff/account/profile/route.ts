import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

export async function GET(request: NextRequest) {
  return proxyBff(request, "/v1/account/profile", { method: "GET" });
}

export async function PUT(request: NextRequest) {
  return proxyBff(request, "/v1/account/profile", { method: "PUT", body: await request.text() });
}
