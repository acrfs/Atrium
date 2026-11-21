import { ROLES } from "@atrium/shared";

/**
 * Owners and admins can open any project through the portal ("/mine")
 * endpoints, e.g. to preview a project with no client yet. During a preview
 * as a client, PreviewModeMiddleware swaps the role to the client's, so this
 * returns false and the client's own access rules apply.
 */
export function isPrivilegedRole(role: string | undefined): boolean {
  return role === ROLES.OWNER || role === ROLES.ADMIN;
}

/**
 * Staff who sign in to the dashboard: owners, admins and developers. Use it for
 * sign-in security (2FA, passkeys), never for data access: a developer sees no
 * projects, clients or invoices, so data checks stay on isPrivilegedRole.
 */
export function isStaffRole(role: string | undefined): boolean {
  return isPrivilegedRole(role) || role === ROLES.DEVELOPER;
}
