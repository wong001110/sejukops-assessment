// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/auth/actor-policy";
import { aggregateDashboard } from "@/domain/operations-dashboard/aggregate";
import type { DashboardPeriod } from "@/domain/operations-dashboard/contracts";
const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.context }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("Not found"); } }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a> }));
vi.mock("./dashboard-insight",()=>({DashboardInsight:({canUseAi}:{canUseAi:boolean})=>canUseAi?<button>View AI Insight</button>:null}));
import { OperationsOverview } from "./operations-overview";
import OverviewPage from "./overview/page";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const params = Promise.resolve({ workspaceId });
const order = { id,workspace_id:workspaceId, order_no: "MOCK-OVERVIEW", status: "ASSIGNED" as const, service_type: "Synthetic service", scheduled_at: null, assigned_technician_id: id,created_at:"2026-10-05T00:00:00Z" };
const actor = (role: "ADMIN" | "MANAGER" | "TECHNICIAN", preview = false): ActorContext => ({ authUserId: id, profileId: id, platformRole: "SUPER_ADMIN", isAnonymous: false, membership: { workspaceId, kind: "OWNER", role }, ...(preview ? { preview: { readOnly: true, effectiveEmployeeProfileId: role === "TECHNICIAN" ? id : null } } : {}) });
function fixture(role:"ADMIN"|"MANAGER"|"TECHNICIAN"="MANAGER",period:DashboardPeriod="this_week",empty=false,selectedWorkspace=workspaceId){
  return aggregateDashboard(empty?[]:[{...order,workspace_id:selectedWorkspace}],{workspaceId:selectedWorkspace,role,period,generation:1,now:new Date("2026-10-05T04:00:00Z"),activity:{asOf:"2026-10-05T04:00:00Z",generation:1,completed:2,rescheduled:1,previousCompleted:1,previousRescheduled:0,trend:[{label:"05/10",jobs:2}],technicians:[{technicianId:id,name:"Mock technician",completed:2,rescheduled:1}]}});
}
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ dashboard:fixture() }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("actual role dashboard", () => {
  it.each(["ADMIN","MANAGER","TECHNICIAN"] as const)("renders %s dashboard with complete period data and safe preview", async role => {
    mocks.context.mockResolvedValue({ actor: actor(role, true), guestVisit: null });
    vi.mocked(fetch).mockResolvedValue(Response.json({dashboard:fixture(role)}));render(await OverviewPage({ params }));
    await screen.findByText(order.order_no);
    expect(screen.getByText("Read-only perspective")).toBeTruthy();
    expect(screen.getByText("Completion trend")).toBeTruthy();
    expect(screen.getByText("Service distribution")).toBeTruthy();
    expect(screen.getByText(/All orders visible to your role/)).toBeTruthy();
    expect(screen.queryByRole("button",{name:"View AI Insight"})).toBeNull();
    expect(vi.mocked(fetch)).toHaveBeenCalledExactlyOnceWith(`/api/workspaces/${workspaceId}/dashboard?period=this_week`,expect.objectContaining({cache:"no-store"}));
    expect(screen.queryByText("Technician workload & completions")!==null).toBe(role!=="TECHNICIAN");
  });
  it("enables on-demand AI insight for ready roles",async()=>{
    render(<OperationsOverview workspaceId={workspaceId} role="MANAGER" readOnly={false} canAssign={false} isGuest={false}/>);
    await screen.findByRole("button",{name:"View AI Insight"});
  });
  it("denies missing, mismatched and onboarding actors before rendering",async()=>{
    for(const context of [null,{actor:{...actor("ADMIN"),membership:undefined}},{actor:{...actor("ADMIN"),membership:{...actor("ADMIN").membership!,workspaceId:id}}},{actor:{...actor("ADMIN"),businessReady:false}}]){
      mocks.context.mockResolvedValue(context);await expect(OverviewPage({params})).rejects.toThrow("Not found");
    }expect(fetch).not.toHaveBeenCalled();
  });
  it("switches periods and clears previous counts until the new response arrives",async()=>{
    let finish!:(response:Response)=>void;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({dashboard:fixture()})).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<OperationsOverview workspaceId={workspaceId} role="MANAGER" readOnly={false} canAssign={false} isGuest={false}/>);
    await screen.findByText(order.order_no);await userEvent.setup({delay:null}).click(screen.getByRole("button",{name:"Today"}));
    await waitFor(()=>expect(screen.queryByLabelText("Key performance indicators")).toBeNull());
    finish(Response.json({dashboard:fixture("MANAGER","today",true)}));
    await screen.findByText("No orders are visible.");expect(screen.getByRole("button",{name:"Today"}).getAttribute("aria-pressed")).toBe("true");
  });
  it("shows failure without stale counts, retries, then handles empty data",async()=>{
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({},{status:503})).mockResolvedValueOnce(Response.json({dashboard:fixture("ADMIN","this_week",true)}));
    render(<OperationsOverview workspaceId={workspaceId} role="ADMIN" readOnly={false} canAssign={true} isGuest={false}/>);
    await screen.findByText("Overview could not be loaded.");expect(screen.queryByLabelText("Key performance indicators")).toBeNull();
    await userEvent.setup({delay:null}).click(screen.getByRole("button",{name:"Refresh overview"}));
    await screen.findByText("No orders are visible.");expect(screen.queryByText("Overview could not be loaded.")).toBeNull();
  });
  it("ignores old scope response after workspace change",async()=>{
    let finishOld!:(response:Response)=>void;
    vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve;})).mockResolvedValueOnce(Response.json({dashboard:fixture("TECHNICIAN","this_week",true,id)}));
    const view=render(<OperationsOverview workspaceId={workspaceId} role="TECHNICIAN" readOnly={false} canAssign={false} isGuest={false}/>);
    view.rerender(<OperationsOverview workspaceId={id} role="TECHNICIAN" readOnly={false} canAssign={false} isGuest={false}/>);
    await screen.findByText("No orders are visible.");finishOld(Response.json({dashboard:fixture("TECHNICIAN")}));
    await waitFor(()=>expect(screen.queryByText(order.order_no)).toBeNull());expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("rejects data for a different role rather than displaying it",async()=>{
    render(<OperationsOverview workspaceId={workspaceId} role="TECHNICIAN" readOnly={false} canAssign={false} isGuest={false}/>);
    await screen.findByText("Overview could not be loaded.");expect(screen.queryByText(order.order_no)).toBeNull();
  });
});
