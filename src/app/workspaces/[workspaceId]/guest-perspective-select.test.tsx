// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import type { FormEvent } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GuestPerspectiveSelect } from "./guest-perspective-select";

describe("GuestPerspectiveSelect", () => {
  it("keeps the chosen exact persona in the POST form until Switch is submitted", async () => {
    const user = userEvent.setup();
    const submitted = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    render(<form action="/api/demo/persona" method="post" onSubmit={submitted}>
      <GuestPerspectiveSelect value="ADMIN" />
      <button type="submit">Switch</button>
    </form>);

    const form = screen.getByRole("button", { name: "Switch" }).closest("form");
    expect(form?.getAttribute("action")).toBe("/api/demo/persona");
    expect(form?.getAttribute("method")).toBe("post");
    expect(new FormData(form ?? undefined).get("persona")).toBe("ADMIN");

    await user.click(screen.getByRole("combobox", { name: "Perspective" }));
    await user.click(await screen.findByText("Technician"));

    expect(new FormData(form ?? undefined).get("persona")).toBe("TECHNICIAN");
    await user.click(screen.getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1));
    expect(new FormData(form ?? undefined).get("persona")).toBe("TECHNICIAN");
    expect(screen.getByRole("button", { name: "Switch" })).toBeTruthy();
  });
});
