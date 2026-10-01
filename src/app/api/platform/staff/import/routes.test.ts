import { beforeEach,describe,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({context:vi.fn(),list:vi.fn(),parse:vi.fn(),template:vi.fn(),preview:vi.fn(),confirm:vi.fn()}));
vi.mock("@/lib/supabase/platform-server",()=>({createPlatformDataContext:mocks.context,PlatformPermissionDeniedError:class extends Error{}}));
vi.mock("@/lib/services/staff-accounts/service",async original=>({...await original<typeof import("@/lib/services/staff-accounts/service")>(),listStaffAccounts:mocks.list}));
vi.mock("@/lib/services/staff-accounts/spreadsheet",()=>({parseStaffImportWorkbook:mocks.parse,createStaffImportTemplate:mocks.template}));
vi.mock("@/lib/services/staff-accounts/import",()=>({previewStaffImport:mocks.preview,confirmStaffImport:mocks.confirm}));
import { StaffAccountError } from "@/lib/services/staff-accounts/service";
import { POST as preview } from "./preview/route";
import { POST as confirm } from "./confirm/route";
import { GET as template } from "./template/route";
const origin="http://localhost:3000";
const workspace="11111111-1111-4111-8111-111111111111";
const importId="22222222-2222-4222-8222-222222222222";
function upload(file=new File(["synthetic-xlsx"],"staff.xlsx"),change?:(form:FormData)=>void){
  const form=new FormData();form.set("workspaceId",workspace);form.set("file",file);change?.(form);
  return new Request(origin+"/api/platform/staff/import/preview",{method:"POST",headers:{Origin:origin},body:form});
}
function confirmation(body:unknown,requestOrigin=origin){return new Request(origin+"/api/platform/staff/import/confirm",{
  method:"POST",headers:{Origin:requestOrigin,"Content-Type":"application/json"},body:JSON.stringify(body),
});}
describe("staff import HTTP authorization and payload boundaries",()=>{
  beforeEach(()=>{
    vi.resetAllMocks();mocks.context.mockResolvedValue({actor:{sessionId:importId}});mocks.list.mockResolvedValue({accounts:[],branches:[]});
    mocks.parse.mockResolvedValue({rows:[],validCount:0,invalidCount:0});mocks.preview.mockResolvedValue({importId,rows:[],validCount:0,invalidCount:0});
    mocks.confirm.mockResolvedValue({complete:true,results:[]});mocks.template.mockResolvedValue(Buffer.from("synthetic-workbook"));
  });
  it("rejects cross-origin confirmation before resolving Auth or touching a draft",async()=>{
    expect((await confirm(confirmation({workspaceId:workspace,importId},"https://foreign.example"))).status).toBe(403);
    expect(mocks.context).not.toHaveBeenCalled();expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("accepts the inbound browser host when Next normalizes its internal URL",async()=>{
    const request=confirmation({workspaceId:workspace,importId},"http://127.0.0.1:3000");
    request.headers.set("host","127.0.0.1:3000");request.headers.set("x-forwarded-proto","http");
    expect((await confirm(request)).status).toBe(200);expect(mocks.confirm).toHaveBeenCalledOnce();
  });
  it("rejects a browser origin that differs from the inbound host",async()=>{
    const request=confirmation({workspaceId:workspace,importId});request.headers.set("host","127.0.0.1:3000");
    expect((await confirm(request)).status).toBe(403);expect(mocks.context).not.toHaveBeenCalled();expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("requires fresh platform authority before parsing a workbook",async()=>{
    mocks.context.mockRejectedValue(new StaffAccountError("STAFF_FORBIDDEN",403,"Forbidden"));
    expect((await preview(upload())).status).toBe(403);expect(mocks.parse).not.toHaveBeenCalled();
  });
  it("checks exact workspace authorization before the workbook parser",async()=>{
    mocks.list.mockRejectedValue(new StaffAccountError("STAFF_FORBIDDEN",403,"Forbidden"));
    expect((await preview(upload())).status).toBe(403);expect(mocks.parse).not.toHaveBeenCalled();
  });
  it("passes actual bounded uploaded bytes to parser and returns a private non-cacheable preview",async()=>{
    const response=await preview(upload());expect(response.status).toBe(200);
    expect(new TextDecoder().decode(mocks.parse.mock.calls[0][0])).toBe("synthetic-xlsx");
    expect(response.headers.get("cache-control")).toBe("no-store, private");expect(response.headers.get("vary")).toBe("Cookie");
  });
  it.each([
    (form:FormData)=>form.append("file",new File(["second"],"second.xlsx")),
    (form:FormData)=>form.set("password","synthetic-never-persist"),
    (form:FormData)=>form.append("workspaceId",workspace),
  ])("rejects duplicate or extra multipart fields",async change=>{
    expect((await preview(upload(undefined,change))).status).toBe(400);expect(mocks.parse).not.toHaveBeenCalled();
  });
  it.each([new File(["wrong"],"staff.csv"),new File([],"staff.xlsx")])("rejects empty and wrong-extension uploads",async file=>{
    expect((await preview(upload(file))).status).toBe(400);expect(mocks.parse).not.toHaveBeenCalled();
  });
  it("bounds the complete multipart body even without trusting Content-Length",async()=>{
    expect((await preview(upload(new File([new Uint8Array(1024*1024+20_000)],"large.xlsx")))).status).toBe(413);
    expect(mocks.parse).not.toHaveBeenCalled();expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("enforces file bound separately from multipart overhead",async()=>{
    expect((await preview(upload(new File([new Uint8Array(1024*1024+1)],"large.xlsx")))).status).toBe(413);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
  it("sanitizes parser diagnostics that may contain uploaded values",async()=>{
    mocks.parse.mockRejectedValue(new Error("synthetic-private-content-canary"));
    const response=await preview(upload());expect(response.status).toBe(400);expect(await response.text()).not.toContain("synthetic-private-content-canary");
  });
  it("requires explicit confirmation shape and refuses browser-selected row/password overrides",async()=>{
    expect((await confirm(confirmation({workspaceId:workspace,importId,rows:[],password:"bad"}))).status).toBe(400);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("passes explicit retry intent to the saved import and keeps credential response private",async()=>{
    const response=await confirm(confirmation({workspaceId:workspace,importId,retryFailed:true}));
    expect(response.status).toBe(200);expect(mocks.confirm).toHaveBeenCalledWith(expect.anything(),workspace,importId,true);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });
  it("authorizes workspace before creating or downloading a template",async()=>{
    mocks.list.mockRejectedValue(new StaffAccountError("STAFF_FORBIDDEN",403,"Forbidden"));
    expect((await template(new Request(origin+"/api/platform/staff/import/template?workspaceId="+workspace))).status).toBe(403);
    expect(mocks.template).not.toHaveBeenCalled();
  });
  it("returns a named private XLSX download after workspace authorization",async()=>{
    const response=await template(new Request(origin+"/api/platform/staff/import/template?workspaceId="+workspace));
    expect(response.status).toBe(200);expect(response.headers.get("content-disposition")).toContain("sejukops-staff-template.xlsx");
    expect(response.headers.get("cache-control")).toBe("no-store, private");expect(await response.text()).toBe("synthetic-workbook");
  });
});
