import { NextResponse, type NextRequest } from "next/server";

type ProxyOptions = {
  method?: string;
  body?: string;
};

export async function proxyBff(
  request: NextRequest,
  path: string,
  options: ProxyOptions = {},
) {
  const baseUrl = process.env.BFF_INTERNAL_URL?.replace(/\/$/, "");
  if (!baseUrl) {
    return NextResponse.json(
      { error: "BFF_NOT_CONFIGURED", message: "BFF_INTERNAL_URL is not configured." },
      { status: 503 },
    );
  }

  const headers: Record<string, string> = { accept: "application/json" };
  const cookie = request.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  const csrfToken = request.headers.get("x-csrf-token");
  if (csrfToken) headers["x-csrf-token"] = csrfToken;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? request.method,
      headers,
      body: options.body,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "BFF_UNAVAILABLE", message: "The authentication service is unavailable." },
      { status: 502 },
    );
  }

  const result = new NextResponse(await response.text(), {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    for (const value of setCookies) result.headers.append("set-cookie", value);
  } else {
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) result.headers.set("set-cookie", setCookie);
  }
  return result;
}
