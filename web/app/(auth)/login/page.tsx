import { configuredProviders } from "@/lib/oauth";
import { AuthForm } from "../auth-form";

export const dynamic = "force-dynamic";

const NOTICES: Record<string, string> = {
  no_account: "There's no account for that email, and sign-up is closed. Ask us for an account.",
  denied: "Sign-in was cancelled.",
  provider: "The sign-in provider returned an error. Try again.",
  expired: "Sign-in took too long. Try again.",
  not_configured: "That sign-in option isn't available.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return <AuthForm mode="login" ssoProviders={configuredProviders()} notice={typeof error === "string" ? NOTICES[error] : undefined} />;
}
