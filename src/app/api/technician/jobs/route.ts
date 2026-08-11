import { NextResponse } from "next/server";

import { listTechnicianJobHistory, listTechnicianJobs } from "@/lib/services/technician-jobs/service";

import { technicianApiError } from "../_shared/responses";

export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("scope") === "history") {
      return NextResponse.json(await listTechnicianJobHistory());
    }
    return NextResponse.json(await listTechnicianJobs());
  } catch (error) {
    return technicianApiError(error);
  }
}
