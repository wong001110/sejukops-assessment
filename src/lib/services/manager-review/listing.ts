import "server-only";

import type {
  ManagerBranch,
  ManagerPaginationMeta,
  ManagerReviewFilterQuery,
  ManagerReviewListQuery,
} from "@/domain/manager-review/contracts";
import { listManagerReviews } from "./service";

function pageMeta(page: number, pageSize: number, total: number): ManagerPaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page, pageSize, total, totalPages, hasMore: page < totalPages };
}

export async function listManagerReviewsPaged(query: ManagerReviewListQuery) {
  const result = await listManagerReviews(query);
  const start = (query.page - 1) * query.pageSize;
  return {
    reviews: result.reviews.slice(start, start + query.pageSize),
    pagination: pageMeta(query.page, query.pageSize, result.reviews.length),
    pendingRescheduleRequests: result.pendingRescheduleRequests,
  };
}

export async function getManagerReviewFilterData(query: ManagerReviewFilterQuery) {
  const result = await listManagerReviews({ page: 1, pageSize: 100 });
  const q = query.q?.toLocaleLowerCase("en-MY");
  const options = result.filters.branches.filter((item) =>
    !q || item.code.toLocaleLowerCase("en-MY").includes(q) || item.name.toLocalLowerCase("en-MY").includes(q),
  );
  const selected = query.selectedId
    ? result.filters.branches.find((item) => item.id === query.selectedId)
    : undefined;
  const merged: ManagerBranch[] = selected && !options.some((item) => item.id === selected.id)
    ? [selected, ...options]
    : options;
  return { options: merged.slice(0, 20) };
}
