import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("retired demo selector", () => {
  it("cannot create a privileged identity from a submitted persona", async () => {
    const request = new NextRequest("http://localhost/api/demo-session", {
      method: "POST",
      body: new URLSearchParams({ identityId: "admin-demo" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(410);
    expect(response.cookies.get("sejukops_demo_identity")?.maxAge).toBe(0);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
