import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { GoogleCalendarService } from "./google-calendar.service";

@Injectable()
export class GoogleCalendarTask {
  private readonly logger = new Logger(GoogleCalendarTask.name);

  constructor(private service: GoogleCalendarService) {}

  /** Every five minutes: well inside Google Calendar's free API quota for one account. */
  @Cron("*/5 * * * *")
  async run(): Promise<void> {
    try {
      await this.service.syncAll();
    } catch (err) {
      this.logger.error("Google Calendar sync failed", err instanceof Error ? err.stack : String(err));
    }
  }
}
