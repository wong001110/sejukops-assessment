import { beforeEach,describe,expect,it,vi } from "vitest";
import type { PlatformDataContext } from "@/lib/supabase/platform-server";
const mocks = vi.hoisted(()=>({ create:vi.fn(),list:vi.fn(),rpc:vi.fn(),owner:vi.fn() }));
vi.mock("./service",async importOriginal=>({ ...await importOriginal<typeof import("./service")>(),
  createStaffAccount:mocks.create,listStaffAccounts:mocks.list,staffRpc:mocks.rpc,staffOwnerParameters:mocks.owner }));
import { StaffAccountError } from "./service";
import { confirmStaffImport,previewStaffImport } from "./import";

const workspace="11111111-1111-4111-8111-111111111111";
const importId="22222222-2222-4222-8222-222222222222";
const token="33333333-3333-4333-8333-333333333333";
const key="44444444-4444-4444-8444-444444444444";
const profile="55555555-5555-4555-8555-555555555555";
const input={name:"Fictional Admin",email:"fictional@example.test",role:"ADMIN" as const,branchCode:null};
const context={actor:{},supabase:{}} as PlatformDataContext;
const result={row:2,status:"CREATED",profileId:profile};
describe("bounded persisted staff import orchestration",()=>{
  beforeEach(()=>{
    vi.resetAllMocks();mocks.owner.mockReturnValue({p_workspace_id:workspace});mocks.list.mockResolvedValue({accounts:[],branches:[]});
    mocks.create.mockResolvedValue({status:"CREATED",account:{profileId:profile},credential:{email:input.email,password:"synthetic-once-only-canary"}});
    mocks.rpc.mockImplementation(async (_client:unknown,name:string)=>name==="staff_claim_import"
      ?{claimToken:token,rows:[{row:2,requestKey:key,input}]}:{complete:true,results:[result]});
  });
  it("authorizes workspace even when workbook rows are invalid, without persisting a confirmable draft",async()=>{
    const draft=await previewStaffImport(context,workspace,{rows:[{row:2,input:null,errors:["Invalid role"]}],validCount:0,invalidCount:1});
    expect(draft.invalidCount).toBe(1);expect(mocks.list).toHaveBeenCalledWith(context,workspace);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects invalid-row previews when Owner workspace authorization fails",async()=>{
    mocks.list.mockRejectedValue(new StaffAccountError("STAFF_FORBIDDEN",403,"Forbidden"));
    await expect(previewStaffImport(context,workspace,{rows:[{row:2,input:null,errors:["Invalid"]}],validCount:0,invalidCount:1})).rejects.toMatchObject({status:403});
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("persists only canonical non-secret rows and uses DB preview revalidation",async()=>{
    const draft={importId,expiresAt:"2026-10-01T10:00:00Z",rows:[{row:2,input,errors:[]}],validCount:1,invalidCount:0};
    mocks.rpc.mockResolvedValue(draft);
    expect(await previewStaffImport(context,workspace,draft)).toEqual(draft);
    expect(mocks.rpc).toHaveBeenCalledWith(context.supabase,"staff_preview_import",{p_workspace_id:workspace,p_rows:[{row:2,input}]});
  });
  it("returns credentials once in response while excluding them from all persisted RPC arguments",async()=>{
    const completed=await confirmStaffImport(context,workspace,importId);
    expect(completed.results[0].credential?.password).toBe("synthetic-once-only-canary");
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("synthetic-once-only-canary");
    expect(mocks.create).toHaveBeenCalledWith(context,workspace,key,input);
    expect(mocks.rpc).toHaveBeenLastCalledWith(context.supabase,"staff_finish_import_batch",{
      p_workspace_id:workspace,p_import_id:importId,p_claim_token:token,p_results:[result],
    });
  });
  it("continues a batch after a row failure and persists only a sanitized stable error code",async()=>{
    mocks.rpc.mockResolvedValueOnce({claimToken:token,rows:[{row:2,requestKey:key,input},{row:3,requestKey:profile,input:{...input,email:"next@example.test"}}]})
      .mockResolvedValueOnce({complete:true,results:[{row:2,status:"FAILED",error:"Creation could not finish"},{row:3,status:"CREATED",profileId:profile}]});
    mocks.create.mockRejectedValueOnce(new Error("synthetic-secret-provider-message"));
    const completed=await confirmStaffImport(context,workspace,importId,true);
    expect(mocks.create).toHaveBeenCalledTimes(2);expect(completed.results[1].credential).toBeTruthy();
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("synthetic-secret-provider-message");
    expect(mocks.rpc.mock.calls[1][2].p_results[0]).toEqual({row:2,status:"FAILED",errorCode:"STAFF_UNAVAILABLE"});
    expect(mocks.rpc.mock.calls[0][2].p_retry_failed).toBe(true);
  });
  it("waits for each Auth operation before advancing to another row",async()=>{
    let release!: (value:unknown)=>void;
    mocks.rpc.mockResolvedValueOnce({claimToken:token,rows:[{row:2,requestKey:key,input},{row:3,requestKey:profile,input:{...input,email:"next@example.test"}}]});
    mocks.create.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const pending=confirmStaffImport(context,workspace,importId);
    await vi.waitFor(()=>expect(mocks.create).toHaveBeenCalledTimes(1));
    release({status:"ALREADY_CREATED",account:{profileId:profile},credential:null});await pending;
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it("replays completed rows without reissuing credentials or calling Auth",async()=>{
    mocks.rpc.mockResolvedValueOnce({claimToken:token,rows:[]}).mockResolvedValueOnce({complete:true,results:[{...result,status:"ALREADY_CREATED"}]});
    expect((await confirmStaffImport(context,workspace,importId)).results[0].credential).toBeUndefined();expect(mocks.create).not.toHaveBeenCalled();
  });
  it("explains lost credential delivery on reconciled current rows without resetting them",async()=>{
    mocks.create.mockResolvedValue({status:"ALREADY_CREATED",account:{profileId:profile},credential:null});
    mocks.rpc.mockResolvedValueOnce({claimToken:token,rows:[{row:2,requestKey:key,input}]}).mockResolvedValueOnce({complete:true,results:[{...result,status:"ALREADY_CREATED"}]});
    const completed=await confirmStaffImport(context,workspace,importId);
    expect(completed.results[0].error).toContain("Use Reset temporary password");
    expect(completed.results[0].credential).toBeUndefined();expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("Use Reset temporary password");
  });
  it("does not deliver a credential when the final persisted batch status cannot be accepted",async()=>{
    mocks.rpc.mockResolvedValueOnce({claimToken:token,rows:[{row:2,requestKey:key,input}]}).mockRejectedValueOnce(new StaffAccountError("STAFF_CONFLICT",409,"Expired"));
    await expect(confirmStaffImport(context,workspace,importId)).rejects.toMatchObject({status:409});
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("synthetic-once-only-canary");
  });
  it("rejects a backend batch larger than ten before executing any Auth call",async()=>{
    mocks.rpc.mockResolvedValueOnce({claimToken:token,rows:Array.from({length:11},(_,n)=>({row:n+2,requestKey:key,input}))});
    await expect(confirmStaffImport(context,workspace,importId)).rejects.toThrow();expect(mocks.create).not.toHaveBeenCalled();
  });
});
