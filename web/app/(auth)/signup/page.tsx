import { getSettings } from "@/lib/settings";
import { AuthForm } from "../auth-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const { termsUrl, privacyUrl } = await getSettings();
  return <AuthForm mode="signup" termsUrl={termsUrl} privacyUrl={privacyUrl} />;
}
