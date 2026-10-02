import { configuredProviders } from "@/lib/oauth";
import { getSettings } from "@/lib/settings";
import { AuthForm } from "../auth-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const { termsUrl, privacyUrl, allowSignup } = await getSettings();
  return (
    <AuthForm
      mode="signup"
      termsUrl={termsUrl}
      privacyUrl={privacyUrl}
      ssoProviders={allowSignup ? configuredProviders() : []}
      notice={allowSignup ? undefined : "Sign-up is closed. Contact us for an account."}
    />
  );
}
