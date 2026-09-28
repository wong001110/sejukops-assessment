import { NextResponse, type NextRequest } from "next/server";

import { DEMO_IDENTITY_COOKIE } from "@/lib/auth/demo-identities";

export async function POST(_request: NextRequest): Promise<NextResponse> {
  void _request;
  const response = NextResponse.json(
    { error: "The legacy demo selector has been retired." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(DEMO_IDENTITY_COOKIE, "", {
    maxAge: 0,
    path: "/",
  });

  return response;
}
