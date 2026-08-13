import "server-only";
import { aiObservationListResponseSchema, aiObservationRecordSchema, type AIObservationListQuery, type AIObservationRecord } from "@/domain/ai-observability/contracts";
import { createAuthorizedDataContext } from "@/lib/supabase/privileged-server";
import { AI_OBSERVATION_EVENT_TYPE, AI_OBSERVATION_RETENTION_DAYS } from "./ai-observation-store";

export async function listAIObservationsPaged(query:AIObservationListQuery){
 const context=await createAuthorizedDataContext("diagnostics:view");
 const start=(query.page-1)*query.pageSize; const end=start+query.pageSize-1;
 let pageRequest=context.supabase.from("audit_logs").select("metadata_json",{count:"exact"}).eq("event_type",AI_OBSERVATION_EVENT_TYPE).order("created_at",{ascending:false});
 if(query.task)pageRequest=pageRequest.eq("metadata_json->>task",query.task); if(query.status)pageRequest=pageRequest.eq("metadata_json->>status",query.status);
 let summaryRequest=context.supabase.from("audit_logs").select("metadata_json").eq("event_type",AI_OBSERVATION_EVENT_TYPE).order("created_at",{ascending:false}).limit(500);
 if(query.task)summaryRequest=summaryRequest.eq("metadata_json->>task",query.task); if(query.status)summaryRequest=summaryRequest.eq("metadata_json->>status",query.status);
 const[pageResult,summaryResult]=await Promise.all([pageRequest.range(start,end),summaryRequest]); if(pageResult.error)throw pageResult.error; if(summaryResult.error)throw summaryResult.error;
 const parse=(rows:Array<{metadata_json:unknown}>|null)=>{const out:AIObservationRecord[]=[];for(const row of rows??[]){const parsed=aiObservationRecordSchema.safeParse(row.metadata_json);if(parsed.success)out.push(parsed.data);}return out;};
 const observations=parse(pageResult.data); const summaryRows=parse(summaryResult.data); const total=pageResult.count??0; const totalPages=Math.max(1,Math.ceil(total/query.pageSize));
 return aiObservationListResponseSchema.parse({retentionDays:AI_OBSERVATION_RETENTION_DAYS,observations,pagination:{page:query.page,pageSize:query.pageSize,total,totalPages,hasMore:query.page<totalPages},summary:{runs:total,providerCalls:summaryRows.reduce((sum,item)=>sum+item.providerCalls.length,0),controlled:summaryRows.filter((item)=>item.status==="CONTROLLED").length,failures:summaryRows.filter((item)=>item.status==="FAILED").length,averageLatency:summaryRows.length?Math.round(summaryRows.reduce((sum,item)=>sum+item.durationMs,0)/summaryRows.length):0}});
}
