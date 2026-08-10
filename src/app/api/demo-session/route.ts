import { NextResponse, type NextRequest } from "next/server";

import {
  DEMO_IDENTITY_COOKIE,
  getDemoIdentity,
  portalPathForRole,
} from "@/lib/auth/demo-identities";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const submittedIdentity = formData.get("identityId");
  const identity = getDemoIdentity(
    typeof submittedIdentity === "string" ? submittedIdentity : undefined,
  );

  if (!identity) {
    return NextResponse.redirect(new URL("/", request.url), 303);
  }

  const response = NextResponse.redirect(
    new URL(portalPathForRole(identity.role), request.url),
    303,
  );
  response.cookies.set(DEMO_IDENTITY_COOKIE, identity.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60,
    path: "/",
  });

  return response;
}
