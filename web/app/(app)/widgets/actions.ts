"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/validation";
import { AppearanceSchema, newPublicKey, normaliseOrigin } from "@/lib/widgets";

export type WidgetState = { error?: string; saved?: boolean } | undefined;

const Form = z.object({
  name: z.string().trim().min(1, "Name the widget").max(100),
  agentId: z.uuid("Pick an agent"),
  mode: z.enum(["chat", "voice", "both"]),
  enabled: z.boolean(),
});

export async function saveWidget(id: string | undefined, _: WidgetState, form: FormData): Promise<WidgetState> {
  const { tenantId } = await requireSession();
  const parsed = Form.safeParse({
    name: form.get("name"),
    agentId: form.get("agentId"),
    mode: form.get("mode"),
    enabled: form.get("enabled") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const appearance = AppearanceSchema.safeParse({
    title: form.get("title") ?? undefined,
    subtitle: form.get("subtitle") ?? undefined,
    color: form.get("color") ?? undefined,
    position: form.get("position") ?? undefined,
    launcherLabel: form.get("launcherLabel") ?? undefined,
  });
  if (!appearance.success) return { error: "Check the appearance settings: the colour must look like #2563eb." };
  const origins: string[] = [];
  for (const line of (form.get("origins")?.toString() ?? "").split(/[\s,]+/).filter(Boolean)) {
    const o = normaliseOrigin(line);
    if (!o) return { error: `"${line}" isn't a website address.` };
    if (!origins.includes(o)) origins.push(o);
  }
  if (origins.length > 20) return { error: "List up to 20 websites." };
  const [agent] = await sql`SELECT 1 FROM agents WHERE id = ${parsed.data.agentId} AND tenant_id = ${tenantId}`;
  if (!agent) return { error: "Pick one of your agents." };

  const values = {
    name: parsed.data.name,
    agent_id: parsed.data.agentId,
    mode: parsed.data.mode,
    enabled: parsed.data.enabled,
    allowed_origins: origins,
    appearance: sql.json(appearance.data),
  };
  if (id && isUuid(id)) {
    await sql`UPDATE widgets SET ${sql(values)} WHERE id = ${id} AND tenant_id = ${tenantId}`;
    revalidatePath(`/widgets/${id}`);
    return { saved: true };
  }
  const [row] = await sql<{ id: string }[]>`INSERT INTO widgets ${sql({ ...values, tenant_id: tenantId, public_key: newPublicKey() })} RETURNING id`;
  redirect(`/widgets/${row.id}`);
}

export async function rotateWidgetKey(form: FormData) {
  const { tenantId } = await requireSession();
  const id = form.get("id")?.toString();
  if (isUuid(id)) await sql`UPDATE widgets SET public_key = ${newPublicKey()} WHERE id = ${id} AND tenant_id = ${tenantId}`;
  revalidatePath(`/widgets/${id}`);
}

export async function deleteWidget(form: FormData) {
  const { tenantId } = await requireSession();
  const id = form.get("id")?.toString();
  if (isUuid(id)) await sql`DELETE FROM widgets WHERE id = ${id} AND tenant_id = ${tenantId}`;
  redirect("/widgets");
}
