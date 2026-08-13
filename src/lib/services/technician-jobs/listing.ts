import "server-only";

import type {
  TechnicianJobListQuery,
  TechnicianPaginationMeta,
} from "@/domain/technician-jobs/contracts";
import { listTechnicianJobHistory, listTechnicianJobs } from "./service";

function meta(page: number, pageSize: number, total: number): TechnicianPaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page, pageSize, total, totalPages, hasMore: page < totalPages };
}

export async function listTechnicianJobsPaged(query: TechnicianJobListQuery) {
  const result = query.scope === "history"
    ? await listTechnicianJobHistory()
    : await listTechnicianJobs();
  const start = (query.page - 1) * query.pageSize;
  return {
    jobs: result.jobs.slice(start, start + query.pageSize),
    pagination: meta(query.page, query.pageSize, result.jobs.length),
  };
}
