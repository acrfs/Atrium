import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import type { CalendarEvent, GoogleCalendarStatus } from "@atrium/shared";
import { AuthGuard, CurrentOrg, CurrentUser, Public, Roles, RolesGuard } from "../common";
import { GoogleCalendarService } from "./google-calendar.service";
import { GoogleCalendarSettingsDto, GoogleEventInputDto, type CallbackQuery } from "./google-calendar.dto";

/** Connect, sync and manage the workspace's Google Calendar (owners and admins). */
@Controller("google-calendar")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class GoogleCalendarController {
  constructor(private service: GoogleCalendarService) {}

  @Get("status")
  status(@CurrentOrg("id") orgId: string): Promise<GoogleCalendarStatus> {
    return this.service.status(orgId);
  }

  @Post("connect")
  @HttpCode(200)
  connect(@CurrentOrg("id") orgId: string, @CurrentUser() user: { id: string; email?: string }): { url: string } {
    return { url: this.service.connectUrl(orgId, user) };
  }

  @Post("sync")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async sync(@CurrentOrg("id") orgId: string): Promise<GoogleCalendarStatus> {
    try {
      await this.service.sync(orgId);
    } catch {
      // The error is saved on the connection and shown with the status.
    }
    return this.service.status(orgId);
  }

  @Patch("settings")
  settings(@CurrentOrg("id") orgId: string, @Body() dto: GoogleCalendarSettingsDto): Promise<GoogleCalendarStatus> {
    return this.service.updateSettings(orgId, dto);
  }

  @Delete()
  @HttpCode(204)
  disconnect(@CurrentOrg("id") orgId: string): Promise<void> {
    return this.service.disconnect(orgId);
  }

  @Post("events")
  createEvent(@CurrentOrg("id") orgId: string, @Body() dto: GoogleEventInputDto): Promise<CalendarEvent[]> {
    return this.service.createEvent(orgId, dto);
  }

  @Patch("events/:id")
  updateEvent(
    @CurrentOrg("id") orgId: string,
    @Param("id") id: string,
    @Body() dto: GoogleEventInputDto,
  ): Promise<CalendarEvent[]> {
    return this.service.updateEvent(orgId, id, dto);
  }

  @Delete("events/:id")
  @HttpCode(204)
  deleteEvent(@CurrentOrg("id") orgId: string, @Param("id") id: string): Promise<void> {
    return this.service.deleteEvent(orgId, id);
  }
}

/**
 * Where Google sends the browser back after consent. Public because it is a
 * top-level redirect; the signed `state` carries the workspace and user, and
 * the service checks that user is still an owner or admin there.
 */
@Public()
@Controller("google-calendar/callback")
export class GoogleCalendarCallbackController {
  constructor(private service: GoogleCalendarService) {}

  @Get()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async callback(@Query() query: CallbackQuery, @Res() res: Response): Promise<void> {
    const target: string = await this.service.handleCallback({
      code: typeof query.code === "string" ? query.code : undefined,
      state: typeof query.state === "string" ? query.state : undefined,
      error: typeof query.error === "string" ? query.error : undefined,
    });
    res.redirect(302, target);
  }
}
