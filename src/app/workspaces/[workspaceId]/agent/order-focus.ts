const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseOrderFocusId(value: unknown): string | undefined {
  return typeof value === "string" && ORDER_ID.test(value) ? value : undefined;
}
