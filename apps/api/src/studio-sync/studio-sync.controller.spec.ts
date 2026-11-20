import { describe, expect, it, mock } from "bun:test";
import { ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { StudioSyncController } from "./studio-sync.controller";

const TOKEN = "s".repeat(48);
const dto = { loginEmail: "shana@shanastudios.co", smtpUser: "shana@shanastudios.co", password: "Abcdef1!" };

function build(token: string | undefined) {
  const config = { get: mock(() => token) };
  const service = { setPassword: mock(() => Promise.resolve({ login: "updated" as const, smtpWorkspaces: 1 })) };
  return { controller: new StudioSyncController(config as never, service as never), service };
}

async function errorOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
}

describe("StudioSyncController", () => {
  it("is off when STUDIO_SYNC_TOKEN is missing or short", async () => {
    for (const t of [undefined, "short"]) {
      const { controller, service } = build(t);
      expect(await errorOf(controller.setPassword(t, dto))).toBeInstanceOf(ServiceUnavailableException);
      expect(service.setPassword).not.toHaveBeenCalled();
    }
  });

  it("refuses a wrong or missing token", async () => {
    const { controller, service } = build(TOKEN);
    expect(await errorOf(controller.setPassword(undefined, dto))).toBeInstanceOf(ForbiddenException);
    expect(await errorOf(controller.setPassword("x".repeat(48), dto))).toBeInstanceOf(ForbiddenException);
    expect(service.setPassword).not.toHaveBeenCalled();
  });

  it("applies the change with the right token", async () => {
    const { controller, service } = build(TOKEN);
    const result = await controller.setPassword(TOKEN, dto);
    expect(result).toEqual({ login: "updated", smtpWorkspaces: 1 });
    expect(service.setPassword).toHaveBeenCalledWith(dto.loginEmail, dto.smtpUser, dto.password);
  });
});
