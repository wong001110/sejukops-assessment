import { NextResponse } from "next/server";

import { whatsappOpenSchema } from "@/domain/manager-review/contracts";

export function isFormPost(request: Request): boolean {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  return (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  );
}

export async function parseWhatsAppOpenInput(request: Request) {
  if (isFormPost(request)) {
    const form = await request.formData();
    return whatsappOpenSchema.parse({ requestKey: form.get("requestKey") });
  }
  return whatsappOpenSchema.parse(await request.json());
}

export function whatsappOpenResponse(
  request: Request,
  notification: Readonly<{ url: string }>,
) {
  if (isFormPost(request)) {
    return NextResponse.redirect(notification.url, 303);
  }
  return NextResponse.json({ notification, url: notification.url });
}
