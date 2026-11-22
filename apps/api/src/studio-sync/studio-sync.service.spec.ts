import "../common/testing/mock-email";
import { describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { StudioSyncService } from "./studio-sync.service";

function build(opts: { user?: { id: string; email: string } | null; credentialRows?: number; stored?: string | null; sent?: boolean } = {}) {
  const prisma = {
    user: { findFirst: mock(() => Promise.resolve(opts.user === undefined ? { id: "u1", email: "shana@shanastudios.co" } : opts.user)) },
    account: {
      updateMany: mock(() => Promise.resolve({ count: opts.credentialRows ?? 1 })),
      findFirst: mock(() => Promise.resolve(opts.stored === null ? null : { password: opts.stored ?? "hashed:Right1!" })),
    },
    member: { findFirst: mock(() => Promise.resolve({ organizationId: "o1" })) },
  };
  const password = {
    hash: mock((p: string) => Promise.resolve(`hashed:${p}`)),
    verify: mock(({ hash, password: p }: { hash: string; password: string }) => Promise.resolve(hash === `hashed:${p}`)),
  };
  const authService = { auth: { $context: Promise.resolve({ password }) } };
  const mail = { send: mock(() => Promise.resolve({ sent: opts.sent ?? true, viaOrgConfig: true })) };
  const logger = { info: mock(() => undefined), warn: mock(() => undefined) };
  const service = new StudioSyncService(prisma as never, authService as never, mail as never, logger as never);
  return { service, prisma, mail };
}

describe("StudioSyncService", () => {
  it("hashes the new sign-in password and sends a notice through the workspace", async () => {
    const { service, prisma, mail } = build();
    const result = await service.setPassword("shana@shanastudios.co", "Abcdef1!");
    expect(result).toEqual({ login: "updated", notified: true });
    expect(prisma.account.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", providerId: "credential" },
      data: { password: "hashed:Abcdef1!" },
    });
    const call = (mail.send.mock.calls[0] ?? []) as unknown[];
    expect(call[0]).toBe("shana@shanastudios.co");
    expect(call[3]).toBe("o1");
    expect(String(call[2])).not.toContain("Abcdef1!");
  });

  it("reports a notice that could not be sent without failing the change", async () => {
    const { service } = build({ sent: false });
    expect(await service.setPassword("shana@shanastudios.co", "Abcdef1!")).toEqual({ login: "updated", notified: false });
  });

  it("stops when the user does not exist", async () => {
    const { service, prisma } = build({ user: null });
    let err: unknown = null;
    try { await service.setPassword("x@y.z", "Abcdef1!"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(NotFoundException);
    expect(prisma.account.updateMany).not.toHaveBeenCalled();
  });

  it("stops when the user has no password sign-in", async () => {
    const { service, mail } = build({ credentialRows: 0 });
    let err: unknown = null;
    try { await service.setPassword("x@y.z", "Abcdef1!"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(NotFoundException);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("verifies the current password", async () => {
    const { service } = build();
    expect(await service.verifyPassword("shana@shanastudios.co", "Right1!")).toBe(true);
    expect(await service.verifyPassword("shana@shanastudios.co", "Wrong1!")).toBe(false);
  });

  it("says no for an unknown user or one without a password", async () => {
    expect(await build({ user: null }).service.verifyPassword("x@y.z", "Right1!")).toBe(false);
    expect(await build({ stored: null }).service.verifyPassword("shana@shanastudios.co", "Right1!")).toBe(false);
  });
});
