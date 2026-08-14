import "server-only";

import type { ManagerSupportingDocument } from "@/domain/manager-review/contracts";
import { ManagerReviewError } from "@/domain/manager-review/errors";
import { createAuthorizedDataContext } from "@/lib/supabase/privileged-server";
import { getManagerReviewDetail } from "./service";

export async function getManagerReviewDetailWithSupportingDocument(orderId: string) {
  const base = await getManagerReviewDetail(orderId);
  const context = await createAuthorizedDataContext("review:view");
  if (context.identity.role !== "MANAGER") {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_PERMISSION_DENIED",
      "An active Manager session is required.",
      403,
    );
  }

  const { data, error } = await context.supabase
    .from("payment_receipt_uploads")
    .select("id,storage_bucket,storage_path,original_filename,mime_type,size_bytes")
    .eq("order_id", orderId)
    .eq("status", "ATTACHED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_DATA_ACCESS_FAILED",
      "The supporting document could not be loaded.",
      503,
      { cause: error },
    );
  }

  let supportingDocument: ManagerSupportingDocument | null = null;
  if (data) {
    const { data: signed, error: signedError } = await context.supabase.storage
      .from(data.storage_bucket)
      .createSignedUrl(data.storage_path, 300);
    supportingDocument = {
      id: data.id,
      filename: data.original_filename,
      mimeType: data.mime_type,
      sizeBytes: Number(data.size_bytes),
      viewUrl: signedError ? null : (signed?.signedUrl ?? null),
    };
  }

  return {
    review: {
      ...base.review,
      supportingDocument,
    },
  };
}
