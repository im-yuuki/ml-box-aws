import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.search;
  return proxyBff(request, `/v1/projects${query}`, { method: "GET" });
}

export async function POST(request: NextRequest) {
  return proxyBff(request, "/v1/projects", {
    method: "POST",
    body: await request.text(),
  });
}
