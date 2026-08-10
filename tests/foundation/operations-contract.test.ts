import { describe, expect, it } from "vitest";

import {
  CUSTOMER_NOTIFICATION_STATUSES,
  SERVICE_EVIDENCE_POLICY,
  isAllowedOrderTransition,
} from "../../src/domain/operations";

describe("foundation operational contracts", () => {
  it("preserves the accepted lifecycle and clarification transition", () => {
    expect(isAllowedOrderTransition("NEW", "ASSIGNED")).toBe(true);
    expect(isAllowedOrderTransition("JOB_DONE", "IN_PROGRESS")).toBe(true);
    expect(isAllowedOrderTransition("CLOSED", "IN_PROGRESS")).toBe(false);
  });

  it("does not invent WhatsApp delivery truth", () => {
    expect(CUSTOMER_NOTIFICATION_STATUSES).toEqual(["READY", "OPENED"]);
  });

  it("exposes the authoritative evidence limits", () => {
    expect(SERVICE_EVIDENCE_POLICY.maximumFileCount).toBe(6);
    expect(SERVICE_EVIDENCE_POLICY.maximumTotalBytes).toBe(120 * 1024 * 1024);
  });
});
