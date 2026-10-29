import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

type Context = { params: Promise<{ paymentId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { paymentId } = await context.params;
  return proxyBff(request, `/v1/payments/mock/${encodeURIComponent(paymentId)}/retry`, {
    method: "POST",
    body: await request.text(),
  });
}
