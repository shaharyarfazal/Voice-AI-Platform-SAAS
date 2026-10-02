"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { purgeOldTranscripts } from "@/lib/maintenance";

export async function runTranscriptPurge() {
  await requireAdmin();
  await purgeOldTranscripts();
  revalidatePath("/admin/system");
}
