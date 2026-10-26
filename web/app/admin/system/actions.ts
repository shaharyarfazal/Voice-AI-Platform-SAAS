"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { purgeOldTranscripts } from "@/lib/maintenance";
import { cloudConfigured, setMediaServer } from "@/lib/media-server";

export async function runTranscriptPurge() {
  await requireAdmin();
  await purgeOldTranscripts();
  revalidatePath("/admin/system");
}

export async function switchMediaServer(form: FormData) {
  await requireAdmin();
  const target = form.get("target") === "cloud" ? "cloud" : "self-hosted";
  // Without credentials the cloud can't be used; the page explains how to add them.
  if (target === "cloud" && !cloudConfigured()) return;
  await setMediaServer(target);
  revalidatePath("/admin/system");
}
