import { describe, expect, it, mock } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ClientsService } from "./clients.service";
import { ClientsController } from "./clients.controller";
import { isPrivilegedRole, isStaffRole } from "../common/helpers/privileged-role";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthService } from "../auth/auth.service";
import type { ConfigService } from "@nestjs/config";

// The Developer role runs the portal's technical side and must never reach the
// studio's projects, clients, files or invoices. Roles are opt-in per endpoint,
// so the real guarantee is that only these controllers name it.
const CONTROLLERS_THAT_GRANT_DEVELOPER: string[] = [
  "branding/branding.controller.ts",
  "clients/clients.controller.ts",
  "integrations/integrations.controller.ts",
  "settings/settings.controller.ts",
];

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full: string = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
    else if (name.endsWith(".controller.ts")) out.push(full);
  }
  return out;
}

describe("Developer role", () => {
  it("is staff for sign-in security but not privileged for data", () => {
    expect(isStaffRole("developer")).toBe(true);
    expect(isStaffRole("owner")).toBe(true);
    expect(isStaffRole("member")).toBe(false);
    expect(isPrivilegedRole("developer")).toBe(false);
  });

  it("is granted only by the settings, branding, integrations and team controllers", () => {
    const root: string = join(import.meta.dir, "..");
    const granting: string[] = controllerFiles(root)
      .filter((f) => /@Roles\([^)]*"developer"/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(root.length + 1))
      .sort();
    expect(granting).toEqual(CONTROLLERS_THAT_GRANT_DEVELOPER);
  });

  it("keeps integration deliveries (which carry project details) away from developers", () => {
    const src: string = readFileSync(join(import.meta.dir, "../integrations/integrations.controller.ts"), "utf8");
    expect(src).toMatch(/@Roles\("owner", "admin"\)\s*\n\s*deliveries\(/);
    expect(src).toMatch(/@Post\("deliveries\/:deliveryId\/resend"\)\s*\n\s*@Roles\("owner", "admin"\)/);
  });

  describe("team list", () => {
    const staffPage = {
      data: [{ id: "m1", role: "owner", hourlyRateCents: 9000 }],
      meta: { total: 1, page: 1, limit: 100, totalPages: 1 },
    };
    function build() {
      const list = mock(() => Promise.resolve(staffPage));
      const controller = new ClientsController(
        {} as PrismaService,
        { get: () => "" } as unknown as ConfigService,
        { list } as unknown as ClientsService,
      );
      return { controller, list };
    }

    it("refuses a developer anything but the staff list", async () => {
      const { controller } = build();
      await expect(controller.list("org-1", { role: "client" }, "developer")).rejects.toThrow(ForbiddenException);
      await expect(controller.list("org-1", {}, "developer")).rejects.toThrow(ForbiddenException);
    });

    it("gives a developer the staff list without hourly rates", async () => {
      const { controller, list } = build();
      const res = await controller.list("org-1", { role: "staff" }, "developer");
      expect(list).toHaveBeenCalledWith("org-1", undefined, undefined, undefined, "staff");
      expect(res.data[0].hourlyRateCents).toBeNull();
    });

    it("leaves the owner's list unchanged", async () => {
      const { controller } = build();
      const res = await controller.list("org-1", { role: "staff" }, "owner");
      expect(res.data[0].hourlyRateCents).toBe(9000);
    });
  });

  describe("invitations", () => {
    function build(invitation: Record<string, unknown> | null) {
      const update = mock((args: { data: { role: string } }) => Promise.resolve({ ...invitation, ...args.data }));
      const prisma = { invitation: { findFirst: mock(() => Promise.resolve(invitation)), update } };
      const service = new ClientsService(
        prisma as unknown as PrismaService,
        {} as AuthService,
        {} as never,
        {} as never,
      );
      return { service, update };
    }

    it("switches a pending admin invitation to developer", async () => {
      const { service, update } = build({ id: "inv-1", role: "admin" });
      const res = await service.setInvitationRole("inv-1", "developer", "org-1");
      expect(res.role).toBe("developer");
      expect(update).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { role: "developer" } });
    });

    it("never turns an owner or client invitation into a developer one", async () => {
      await expect(build({ id: "inv-1", role: "owner" }).service.setInvitationRole("inv-1", "developer", "org-1"))
        .rejects.toThrow(BadRequestException);
      await expect(build({ id: "inv-1", role: "member" }).service.setInvitationRole("inv-1", "developer", "org-1"))
        .rejects.toThrow(BadRequestException);
    });

    it("refuses roles other than admin and developer", async () => {
      await expect(build({ id: "inv-1", role: "admin" }).service.setInvitationRole("inv-1", "owner", "org-1"))
        .rejects.toThrow(BadRequestException);
    });

    it("404s an invitation outside the workspace", async () => {
      await expect(build(null).service.setInvitationRole("inv-x", "developer", "org-1")).rejects.toThrow(NotFoundException);
    });
  });
});
