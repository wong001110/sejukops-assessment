import type { AIOperationsErrorEnvelope, AIOperationsResponse, ConversationContext } from "@/domain/ai-operations/contracts";

export type ConversationTurn = {
  id: string;
  question: string;
  requestContext: ConversationContext | null;
  response?: AIOperationsResponse;
  error?: AIOperationsErrorEnvelope["error"];
  status: "loading" | "complete" | "error";
};

export function newConversationTurn(id: string, question: string, requestContext: ConversationContext | null): ConversationTurn {
  return { id, question, requestContext, status: "loading" };
}

/** Retry changes the existing turn in place and retains the context used for its first request. */
export function retryConversationTurn(turn: ConversationTurn): ConversationTurn {
  return { ...turn, response: undefined, error: undefined, status: "loading" };
}

/** A reset advances its epoch, making every older request result ineligible to update the new conversation. */
export function canApplyConversationResult(requestEpoch: number, currentEpoch: number, requestIsActive: boolean) {
  return requestEpoch === currentEpoch && requestIsActive;
}

/** Conversation context is ordered, so only one turn may be in flight at a time. */
export function canStartConversationRequest(activeTurnId: string | null, candidateTurnId: string) {
  return activeTurnId === null || activeTurnId === candidateTurnId;
}
