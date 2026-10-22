import { NextResponse, type NextRequest } from "next/server";

/**
 * BFF stub: dashboard auth.
 *
 * The real implementation lives in `web/bff` (Node + Fastify) and is
 * exposed through the same /api/bff/* path once the dashboard and BFF
 * services are deployed behind the apex host rule (mlbox.june8th.me).
 *
 * This stub exists so the dashboard can be developed end-to-end against
 * a mock and so the request shape is reviewable before the BFF service
 * is built out.
 */
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      error: "BFF_NOT_DEPLOYED",
      message:
        "The BFF service isn't wired up yet. This endpoint will accept SRP responses and set the session cookie once it is.",
    },
    { status: 501 },
  );
}
