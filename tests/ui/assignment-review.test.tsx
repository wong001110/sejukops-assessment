// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred, jsonResponse } from "../helpers/ui-request";

const context = vi.hoisted(() => ({ workspaceId: "11111111-1111-4111-8111-111111111111" }));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceId: context.workspaceId }) }));
import AssignmentProposalPage from "../../src/app/workspaces/[workspaceId]/assignment/page";

const WORKSPACE = context.workspaceId;
const ORDER = "22222222-2222-4222-8222-222222222222";
const TECH = "33333333-3333-4333-8333-333333333333";
const PROPOSAL = "44444444-4444-4444-8444-444444444444";
const orders = [{ id: ORDER, order_no: "MOCK-001", branch_id: "branch", status: "NEW", updated_at: "2026-09-30T00:00:00Z" }];
const technicians = [{ id: TECH, branch_id: "branch", profile_id: "Fictional technician" }];
const proposal = { id: PROPOSAL, status: "PENDING", canonicalPayload: { orderId: ORDER, technicianId: TECH, scheduledAt: null },
  targetUpdatedAt: orders[0].updated_at, expiresAt: "2026-10-01T00:00:00Z" };
const detail = { proposal, previewToken: "a".repeat(64) };

beforeEach(() => { context.workspaceId = WORKSPACE; window.history.replaceState(null, "", `/assignment?orderId=${ORDER}`); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function chooseTechnician(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.queryByText("Loading orders and technicians…")).toBeNull());
  await user.click(screen.getByRole("combobox", { name: "Technician for this branch" }));
  await user.click(await screen.findByText("Fictional technician", { selector: ".ant-select-item-option-content" }));
}

function initialChoices(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockResolvedValueOnce(jsonResponse({ orders })).mockResolvedValueOnce(jsonResponse({ technicians }));
}

describe("assignment proposal rendered state", () => {
  it("keeps focused order, freezes pending fields, and confirms the exact saved proposal once", async () => {
    const user = userEvent.setup({ delay: null });
    const prepared = deferred<Response>(); const confirmed = deferred<Response>();
    const scheduledAt = "2026-10-02T02:00:00.000Z";
    const scheduledProposal = { ...proposal, canonicalPayload: { ...proposal.canonicalPayload, scheduledAt } };
    const fetchMock = vi.fn(); initialChoices(fetchMock);
    fetchMock.mockReturnValueOnce(prepared.promise).mockResolvedValueOnce(jsonResponse({ ...detail, proposal: scheduledProposal })).mockReturnValueOnce(confirmed.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<AssignmentProposalPage />);
    await chooseTechnician(user);
    expect(screen.getByText("MOCK-001 (NEW)", { selector: ".ant-select-selection-item" })).toBeTruthy();
    await user.type(screen.getByLabelText("Scheduled time (optional)"), "2026-10-02 10:00");
    await user.keyboard("{Enter}");
    await user.dblClick(screen.getByRole("button", { name: "Prepare proposal" }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((screen.getByRole("combobox", { name: "Order" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Scheduled time (optional)") as HTMLInputElement).disabled).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ orderId: ORDER, technicianId: TECH, expectedUpdatedAt: orders[0].updated_at, scheduledAt });
    await act(async () => prepared.resolve(jsonResponse({ proposal: scheduledProposal }, 201)));
    await screen.findByText("Review saved proposal");
    await user.dblClick(screen.getByRole("button", { name: "Confirm and execute this assignment" }));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({ confirm: true, previewToken: detail.previewToken });
    expect((screen.getByRole("combobox", { name: "Technician for this branch" }) as HTMLInputElement).disabled).toBe(true);
    await act(async () => confirmed.resolve(jsonResponse({ proposal: { ...proposal, status: "EXECUTED" } })));
    await screen.findByText("Assignment executed.");
    expect(screen.queryByRole("button", { name: "Confirm and execute this assignment" })).toBeNull();
  });

  it("does not resurrect a late saved preview after the user changes details", async () => {
    const user = userEvent.setup({ delay: null });
    window.history.replaceState(null, "", `/assignment?orderId=${ORDER}&proposalId=${PROPOSAL}`);
    const oldPreview = deferred<Response>();
    const fetchMock = vi.fn(); initialChoices(fetchMock); fetchMock.mockReturnValueOnce(oldPreview.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<AssignmentProposalPage />);
    await chooseTechnician(user);
    await act(async () => oldPreview.resolve(jsonResponse(detail)));
    expect(screen.queryByText("Review saved proposal")).toBeNull();
  });

  it("ignores prepare completion from an old workspace and offers retry after load failure", async () => {
    const user = userEvent.setup({ delay: null });
    const prepared = deferred<Response>();
    const fetchMock = vi.fn(); initialChoices(fetchMock); fetchMock.mockReturnValueOnce(prepared.promise)
      .mockResolvedValueOnce(jsonResponse({ error: "offline" }, 503)).mockResolvedValueOnce(jsonResponse({ technicians: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<AssignmentProposalPage />);
    await chooseTechnician(user);
    await user.click(screen.getByRole("button", { name: "Prepare proposal" }));
    context.workspaceId = "55555555-5555-4555-8555-555555555555";
    view.rerender(<AssignmentProposalPage />);
    await screen.findByText("Orders or technicians could not be loaded. Reload choices to retry.");
    await act(async () => prepared.resolve(jsonResponse({ proposal }, 201)));
    expect(screen.queryByText("Review saved proposal")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect((screen.getByRole("button", { name: "Reload choices" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not preselect a hidden order and blocks rejected proposal confirmation", async () => {
    const user = userEvent.setup({ delay: null });
    window.history.replaceState(null, "", `/assignment?orderId=hidden&proposalId=${PROPOSAL}`);
    const fetchMock = vi.fn(); initialChoices(fetchMock); fetchMock.mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ error: "stale" }, 409));
    vi.stubGlobal("fetch", fetchMock);
    render(<AssignmentProposalPage />);
    await screen.findByText("Review saved proposal");
    await waitFor(() => expect(screen.queryByText("Loading orders and technicians…")).toBeNull());
    expect(screen.queryByText("MOCK-001 (NEW)", { selector: ".ant-select-selection-item" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Confirm and execute this assignment" }));
    await screen.findByText("The proposal is stale or was rejected. Reload choices before retrying.");
    expect((screen.getByRole("button", { name: /Confirm and execute this assignment/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
