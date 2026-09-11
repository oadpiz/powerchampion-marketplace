import { AuthForm } from "../../components/auth-form";
import { metadataForRoute } from "../../lib/metadata";
export const metadata = metadataForRoute("/register");
export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
