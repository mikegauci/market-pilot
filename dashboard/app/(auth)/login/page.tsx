import { LoginForm } from "@/components/login-form";
import { isViewerLoginEnabled } from "@/lib/viewer-auth";

export default async function LoginPage() {
  const viewerLoginEnabled = await isViewerLoginEnabled();
  return <LoginForm viewerLoginEnabled={viewerLoginEnabled} />;
}
