import { NextResponse } from "next/server";

import { technicianJobListQuerySchema } from "@/domain/technician-jobs/contracts";
import { listTechnicianJobsPaged } from "@/lib/services/technician-jobs/listing";
import { technicianApiError } from "../_shared/responses";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = technicianJobListQuerySchema.parse({
      scope: params.get("scope") || undefined,
      page: params.get("page") || undefined,
      pageSize: params.get("pageSize") || undefined,
    });
    return NextResponse.json(await listTechnicianJobsPaged(query));
  } catch (error) {
    return technicianApiError(error);
  }
}
