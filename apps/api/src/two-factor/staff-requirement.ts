import { ROLES } from "@atrium/shared";
import type { PrismaService } from "../prisma/prisma.service";

// Developers sign in to the dashboard too, so they are held to the same sign-in rules.
const STAFF_ROLES: string[] = [ROLES.OWNER, ROLES.ADMIN, ROLES.DEVELOPER];

/**
 * Whether the user is an owner or admin of any workspace that requires 2FA.
 * A plain function so AuthService's hooks and TwoFactorService share it
 * without a module cycle.
 */
export async function isStaffInRequiringWorkspace(
  prisma: Pick<PrismaService, "member">,
  userId: string,
): Promise<boolean> {
  const member = await prisma.member.findFirst({
    where: {
      userId,
      role: { in: STAFF_ROLES },
      organization: { systemSettings: { requireTwoFactor: true } },
    },
    select: { id: true },
  });
  return member !== null;
}

/** Whether the user is an owner or admin of any workspace. Passkeys are for staff only. */
export async function isStaffAnywhere(prisma: Pick<PrismaService, "member">, userId: string): Promise<boolean> {
  const member = await prisma.member.findFirst({
    where: { userId, role: { in: STAFF_ROLES } },
    select: { id: true },
  });
  return member !== null;
}
