import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { AIObservationRecord } from "@/domain/ai-observability/contracts";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { AI_OBSERVATION_EVENT_TYPE, AI_OBSERVATION_RETENTION_DAYS } from "./ai-observation-store";

/** Best-effort technical evidence; an observation failure never changes the business result. */
export async function persistWorkspaceAIRecord(record: AIObservationRecord, actorProfileId: string): Promise<void> {
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!key) return;
    const service = createClient(getSupabasePublicConfig().url, key, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { error } = await service.from("audit_logs").insert({
      id: record.id,
      actor_profile_id: actorProfileId,
      event_type: AI_OBSERVATION_EVENT_TYPE,
      idempotency_key: `ai-observation:${record.traceId}`,
      metadata_json: record,
      created_at: record.createdAt,
    });
    if (error) return;
    const cutoff = new Date(Date.now() - AI_OBSERVATION_RETENTION_DAYS * 86_400_000).toISOString();
    await service.from("audit_logs").delete()
      .eq("event_type", AI_OBSERVATION_EVENT_TYPE).lt("created_at", cutoff);
  } catch {
    // Never expose storage, network, or provider details through this route.
  }
}
