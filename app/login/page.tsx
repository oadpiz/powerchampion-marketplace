import { AuthForm } from "../../components/auth-form";
import { metadataForRoute } from "../../lib/metadata";
export const metadata = metadataForRoute("/login");
export default function LoginPage() {
  return <AuthForm mode="login" />;
}
