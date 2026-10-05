import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/auth/actor-policy";
import { readOperationsDashboard } from "./dashboard";
const mocks=vi.hoisted(()=>({generation:vi.fn()}));
vi.mock("@/lib/services/workspaces/generation",()=>({readWorkspaceGeneration:mocks.generation}));
const workspaceId="11111111-1111-4111-8111-111111111111";
const other="22222222-2222-4222-8222-222222222222";
const tech="33333333-3333-4333-8333-333333333333";
const profile="44444444-4444-4444-8444-444444444444";
const activity={asOf:"2026-10-05T04:00:00.123456+00:00",generation:1,completed:0,rescheduled:0,previousCompleted:0,previousRescheduled:0,trend:[],technicians:[]};
const order=(n=1,patch:Record<string,unknown>={})=>({id:`${String(n).padStart(8,"0")}-2222-4222-8222-222222222222`,workspace_id:workspaceId,order_no:`MOCK-${n}`,assigned_technician_id:tech,service_type:"Cleaning",status:"ASSIGNED",scheduled_at:null,created_at:"2026-10-05T00:00:00Z",...patch});
const actor=(role:"ADMIN"|"MANAGER"|"TECHNICIAN"="ADMIN"):ActorContext=>({authUserId:profile,profileId:profile,isAnonymous:false,platformRole:"USER",membership:{workspaceId,kind:"OWNER",role}});
function client(rows:ReturnType<typeof order>[]=[order()]) {
  const range=vi.fn().mockImplementation(async(start:number,end:number)=>({data:rows.slice(start,end+1),error:null,count:rows.length}));
  const eq=vi.fn(); const query={eq,order:vi.fn(),range}; eq.mockReturnValue(query); query.order.mockReturnValue(query);
  const techEq=vi.fn(); const technician={eq:techEq,maybeSingle:vi.fn().mockResolvedValue({data:{id:tech,branch_id:other},error:null})};techEq.mockReturnValue(technician);
  const branchEq=vi.fn(); const branch={eq:branchEq,maybeSingle:vi.fn().mockResolvedValue({data:{id:other},error:null})};branchEq.mockReturnValue(branch);
  const from=vi.fn((table:string)=>({select:vi.fn().mockReturnValue(table==="workspace_technicians"?technician:table==="workspace_branches"?branch:query)}));
  const rpc=vi.fn().mockResolvedValue({data:activity,error:null});
  return {supabase:{from,rpc} as unknown as SupabaseClient,from,rpc,eq,techEq,branchEq,technician,branch,range};
}
beforeEach(()=>{vi.resetAllMocks();mocks.generation.mockResolvedValue(1);});
describe("complete actor-scoped dashboard",()=>{
  it.each(["ADMIN","MANAGER","TECHNICIAN"] as const)("reads %s summary and actual offset activity contract",async role=>{
    const c=client(); const result=await readOperationsDashboard(actor(role),c.supabase,{workspaceId,period:"this_week"});
    expect(result.current.total).toBe(1);expect(result.role).toBe(role);
    expect(c.eq).toHaveBeenCalledWith("workspace_id",workspaceId);
    if(role==="TECHNICIAN") {expect(c.eq).toHaveBeenCalledWith("assigned_technician_id",tech);expect(c.branchEq).toHaveBeenCalledWith("active",true);}
    expect(c.rpc).toHaveBeenCalledWith("workspace_dashboard_activity",expect.objectContaining({p_workspace_id:workspaceId,p_expected_generation:1,p_period:"this_week"}));
  });
  it("rejects workspace substitution, no membership, onboarding and anonymous Owner before reads",async()=>{
    const c=client();for(const denied of [{...actor(),membership:{...actor().membership!,workspaceId:other}}, {...actor(),membership:undefined},{...actor(),businessReady:false},{...actor(),isAnonymous:true}])
      await expect(readOperationsDashboard(denied,c.supabase,{workspaceId,period:"today"})).rejects.toThrow("access denied");
    expect(c.from).not.toHaveBeenCalled();expect(c.rpc).not.toHaveBeenCalled();expect(mocks.generation).not.toHaveBeenCalled();
  });
  it("uses actual employee preview mapping and does not fallback to Owner",async()=>{
    const c=client();await readOperationsDashboard({...actor("TECHNICIAN"),preview:{readOnly:true,effectiveEmployeeProfileId:other}},c.supabase,{workspaceId,period:"today"});
    expect(c.techEq).toHaveBeenCalledWith("profile_id",other);expect(c.techEq).not.toHaveBeenCalledWith("profile_id",profile);
    const noEmployee=client();expect((await readOperationsDashboard({...actor("TECHNICIAN"),preview:{readOnly:true,effectiveEmployeeProfileId:null}},noEmployee.supabase,{workspaceId,period:"today"})).current.total).toBe(0);
    expect(noEmployee.from).not.toHaveBeenCalled();
  });
  it("does not read orders without a live Technician mapping or active branch",async()=>{
    for(const missing of ["technician","branch"] as const){const c=client();c[missing].maybeSingle.mockResolvedValue({data:null,error:null});
      expect((await readOperationsDashboard(actor("TECHNICIAN"),c.supabase,{workspaceId,period:"today"})).current.total).toBe(0);
      expect(c.from).not.toHaveBeenCalledWith("workspace_orders");}
  });
  it("reads all 1001 rows with inclusive stable pages instead of a recent20 slice",async()=>{
    const c=client(Array.from({length:1001},(_,i)=>order(i+1)));
    const result=await readOperationsDashboard(actor(),c.supabase,{workspaceId,period:"today"});
    expect(result.current.total).toBe(1001);expect(result.cohort.orders).toBe(1001);
    expect(c.range.mock.calls).toEqual([[0,999],[1000,1999]]);
  });
  it.each([{workspace_id:other},{assigned_technician_id:other}])("rejects a wrongly scoped returned technician row %j",async patch=>{
    const c=client([order(1,patch)]);await expect(readOperationsDashboard(actor("TECHNICIAN"),c.supabase,{workspaceId,period:"today"})).rejects.toThrow("scope changed");
  });
  it("fails closed on RPC failure and stale dataset generation",async()=>{
    const c=client();c.rpc.mockResolvedValue({data:null,error:{message:"Denied"}});await expect(readOperationsDashboard(actor(),c.supabase,{workspaceId,period:"today"})).rejects.toThrow("activity unavailable");
    const reset=client();mocks.generation.mockResolvedValueOnce(1).mockResolvedValueOnce(2);await expect(readOperationsDashboard(actor(),reset.supabase,{workspaceId,period:"today"})).rejects.toThrow("generation changed");
  });
  it.each([{data:[],error:null,count:1},{data:[order()],error:null,count:50_001},{data:[order()],error:null,count:null}])("rejects incomplete, excessive or unknown count %j",async response=>{
    const c=client();c.range.mockResolvedValue(response);await expect(readOperationsDashboard(actor(),c.supabase,{workspaceId,period:"today"})).rejects.toThrow();
  });
  it("passes only the resolved guest proof; avoids a privileged substitute client",async()=>{
    const c=client();const proof={visitId:other,tokenHash:"a".repeat(64)};
    await readOperationsDashboard({...actor(),membership:{workspaceId,kind:"DEMO",role:"ADMIN"}},c.supabase,{workspaceId,period:"today"},proof);
    expect(c.rpc).toHaveBeenCalledWith("workspace_dashboard_activity",expect.objectContaining({p_guest_visit_id:other,p_guest_token_hash:proof.tokenHash}));
  });
});
