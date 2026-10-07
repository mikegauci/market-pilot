export function viewerLoginConfigured(): boolean {
  if (process.env.DASHBOARD_VIEWER_LOGIN_ENABLED === "false") return false;
  const email = process.env.DASHBOARD_VIEWER_EMAIL?.trim();
  const password = process.env.DASHBOARD_VIEWER_PASSWORD?.trim();
  return Boolean(email && password);
}
