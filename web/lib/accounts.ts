import "server-only";
import type { TransactionSql } from "postgres";

/** A new person with their own workspace, as its owner. */
export async function createAccount(
  tx: TransactionSql,
  a: { email: string; name?: string; passwordHash: string | null; company: string; termsAcceptedAt?: Date | null; onboarded?: boolean },
): Promise<{ userId: string; tenantId: string }> {
  const [tenant] = await tx<{ id: string }[]>`
    INSERT INTO tenants (name, onboarded_at) VALUES (${a.company}, ${a.onboarded ? new Date() : null}) RETURNING id`;
  const [user] = await tx<{ id: string }[]>`
    INSERT INTO users (tenant_id, email, name, password_hash, terms_accepted_at, last_login_at)
    VALUES (${tenant.id}, ${a.email}, ${a.name ?? ""}, ${a.passwordHash}, ${a.termsAcceptedAt ?? null}, now()) RETURNING id`;
  await tx`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenant.id}, ${user.id}, 'owner')`;
  return { userId: user.id, tenantId: tenant.id };
}
