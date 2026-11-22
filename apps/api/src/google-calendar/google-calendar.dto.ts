import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class GoogleCalendarSettingsDto {
  /** Write portal deadlines to the portal's calendar in Google. */
  @IsOptional() @IsBoolean() pushEnabled?: boolean;
  /** Show Google events in the portal calendar. */
  @IsOptional() @IsBoolean() pullEnabled?: boolean;
}

/** A Google event made or edited from the portal. No start time means an all-day event. */
export class GoogleEventInputDto {
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @Matches(DATE, { message: "date must be YYYY-MM-DD" }) date!: string;
  @IsOptional() @Matches(TIME, { message: "startTime must be HH:MM" }) startTime?: string;
  @IsOptional() @Matches(TIME, { message: "endTime must be HH:MM" }) endTime?: string;
  /** IANA timezone the times are in; defaults to the workspace timezone. */
  @IsOptional() @IsString() @MaxLength(64) timeZone?: string;
  @IsOptional() @IsString() @MaxLength(500) location?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
}

export interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}
