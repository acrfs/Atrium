import { describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { StudioSyncService } from "./studio-sync.service";

function build(opts: { user?: { id: string } | null; credentialRows?: number; workspaces?: { organizationId: string }[] } = {}) {
  const prisma = {
    user: { findFirst: mock(() => Promise.resolve(opts.user === undefined ? { id: "u1" } : opts.user)) },
    account: { updateMany: mock(() => Promise.resolve({ count: opts.credentialRows ?? 1 })) },
    systemSettings: { findMany: mock(() => Promise.resolve(opts.workspaces ?? [{ organizationId: "o1" }])) },
  };
  const authService = { auth: { $context: Promise.resolve({ password: { hash: mock((p: string) => Promise.resolve(`hashed:${p}`)) } }) } };
  const settings = { updateSettings: mock(() => Promise.resolve({})) };
  const mail = { clearSmtpTransporters: mock(() => undefined) };
  const logger = { info: mock(() => undefined) };
  const service = new StudioSyncService(prisma as never, authService as never, settings as never, mail as never, logger as never);
  return { service, prisma, settings, mail };
}

describe("StudioSyncService", () => {
  it("hashes the sign-in password and updates matching SMTP settings", async () => {
    const { service, prisma, settings, mail } = build();
    const result = await service.setPassword("shana@shanastudios.co", "shana@shanastudios.co", "Abcdef1!");
    expect(result).toEqual({ login: "updated", smtpWorkspaces: 1 });
    expect(prisma.account.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", providerId: "credential" },
      data: { password: "hashed:Abcdef1!" },
    });
    expect(settings.updateSettings).toHaveBeenCalledWith("o1", { smtpPass: "Abcdef1!" });
    expect(mail.clearSmtpTransporters).toHaveBeenCalled();
  });

  it("stops when the user does not exist", async () => {
    const { service, settings } = build({ user: null });
    let err: unknown = null;
    try { await service.setPassword("x@y.z", "x@y.z", "Abcdef1!"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(NotFoundException);
    expect(settings.updateSettings).not.toHaveBeenCalled();
  });

  it("stops when the user has no password sign-in", async () => {
    const { service, settings } = build({ credentialRows: 0 });
    let err: unknown = null;
    try { await service.setPassword("x@y.z", "x@y.z", "Abcdef1!"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(NotFoundException);
    expect(settings.updateSettings).not.toHaveBeenCalled();
  });
});
