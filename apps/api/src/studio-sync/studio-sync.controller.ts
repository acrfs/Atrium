import { Body, Controller, ForbiddenException, Headers, HttpCode, Post, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SkipThrottle } from "@nestjs/throttler";
import { timingSafeEqual } from "crypto";
import { Public } from "../common";
import { StudioSyncDto } from "./studio-sync.dto";
import { StudioSyncService } from "./studio-sync.service";

/**
 * Internal endpoint for the account.shanastudios.co password sync service.
 * Disabled unless STUDIO_SYNC_TOKEN is set; Caddy also blocks /api/internal/*
 * from the public internet, so only containers on the same Docker network reach it.
 */
@Public()
@SkipThrottle()
@Controller("internal/studio-sync")
export class StudioSyncController {
  constructor(
    private config: ConfigService,
    private studioSync: StudioSyncService,
  ) {}

  @Post("password")
  @HttpCode(200)
  async setPassword(@Headers("x-studio-sync-token") token: string | undefined, @Body() dto: StudioSyncDto) {
    const expected = this.config.get<string>("STUDIO_SYNC_TOKEN");
    if (!expected || expected.length < 32) throw new ServiceUnavailableException("Studio sync is not enabled");
    const given = Buffer.from(token ?? "");
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw new ForbiddenException("Bad sync token");
    }
    return this.studioSync.setPassword(dto.loginEmail, dto.smtpUser, dto.password);
  }
}
