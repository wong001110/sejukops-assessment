import type { EvidenceUploadStatus, TechnicianPaymentReceipt } from "@/domain/technician-completion/contracts";

export type LocalReceiptStatus = "queued" | "uploading" | "success" | "error";

export function confirmedReceiptUploadId(receipt?: TechnicianPaymentReceipt | null): string | undefined {
  return receipt?.status === "UPLOADED" ? receipt.id : undefined;
}

export function receiptCompletionError({ remoteStatus, localStatus }: { paymentAmount: number | null; paymentMethod?: string; remoteStatus?: EvidenceUploadStatus; localStatus?: LocalReceiptStatus }): string | undefined {
  if (localStatus === "queued" || localStatus === "uploading") return "Wait for the receipt / supporting document upload to finish before completing the job.";
  if (localStatus === "error") return "Retry or remove the failed receipt / supporting document before completing the job.";
  if (remoteStatus === "RESERVED" || remoteStatus === "DELETING") return "Wait for receipt / supporting document cleanup to finish, or retry/remove the interrupted upload before completing the job.";
  return undefined;
}
