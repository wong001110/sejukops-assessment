import type { EvidenceUploadStatus, TechnicianPaymentReceipt } from "@/domain/technician-completion/contracts";

export type LocalReceiptStatus = "queued" | "uploading" | "success" | "error";

export function confirmedReceiptUploadId(receipt?: TechnicianPaymentReceipt | null): string | undefined {
  return receipt?.status === "UPLOADED" ? receipt.id : undefined;
}

export function receiptCompletionError({ paymentAmount, paymentMethod, remoteStatus, localStatus }: { paymentAmount: number | null; paymentMethod?: string; remoteStatus?: EvidenceUploadStatus; localStatus?: LocalReceiptStatus }): string | undefined {
  if (localStatus === "queued" || localStatus === "uploading") return "Wait for the receipt photo upload to finish before completing the job.";
  if (localStatus === "error") return "Retry or remove the failed receipt photo before completing the job.";
  if (remoteStatus === "RESERVED" || remoteStatus === "DELETING") return "Wait for receipt cleanup to finish, or retry/remove the interrupted receipt before completing the job.";
  if (remoteStatus === "UPLOADED" && (paymentAmount === null || !paymentMethod)) return "A receipt photo requires both payment amount and payment method.";
  return undefined;
}
