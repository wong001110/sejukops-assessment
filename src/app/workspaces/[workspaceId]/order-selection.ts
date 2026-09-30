export function resolveVisibleOrderId(
  orders: readonly { id: string }[], current: string, requested: string | null,
): string {
  if (current && orders.some((order) => order.id === current)) return current;
  if (requested && orders.some((order) => order.id === requested)) return requested;
  return "";
}
