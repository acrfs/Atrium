/**
 * The Developer role runs the portal's technical side (email, branding,
 * integrations, sign-in security) and never sees the studio's projects,
 * clients, files or invoices. The API refuses those to a developer anyway;
 * this keeps the dashboard from offering pages that would only fail.
 */
export const DEVELOPER_ROLE = "developer";

/** Where a developer lands, and is sent back to from any other dashboard page. */
export const DEVELOPER_HOME = "/dashboard/settings/workspace";

/** Dashboard pages a developer can open. */
export const DEVELOPER_PATHS: readonly string[] = [
  "/dashboard/settings/workspace",
  "/dashboard/settings/branding",
  "/dashboard/settings/team",
  "/dashboard/settings/integrations",
  "/dashboard/settings/account",
  "/dashboard/settings/security",
];

export function isDeveloper(role: string | undefined | null): boolean {
  return role === DEVELOPER_ROLE;
}

/** Whether a developer may open this dashboard path. */
export function developerMayOpen(pathname: string): boolean {
  return DEVELOPER_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
