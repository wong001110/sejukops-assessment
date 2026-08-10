import { NextResponse } from "next/server";

import { listTechnicianJobs } from "@/lib/services/technician-jobs/service";

import { technicianApiError } from "../_shared/responses";

export async function GET() {
  try {
    return NextResponse.json(await listTechnicianJobs());
  } catch (error) {
    return technicianApiError(error);
  }
}
