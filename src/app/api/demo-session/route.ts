import { NextResponse, type NextRequest } from "next/server";

const LEGACY_DEMO_COOKIE = "sejukops_demo_identity";

export async function POST(_request: NextRequest): Promise<NextResponse> {
  void _request;
  const response = NextResponse.json(
    { error: "The legacy demo selector has been retired." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(LEGACY_DEMO_COOKIE, "", {
    maxAge: 0,
    path: "/",
  });

  return response;
}
