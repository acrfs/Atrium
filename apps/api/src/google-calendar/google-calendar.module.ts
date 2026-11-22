import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CalendarModule } from "../calendar/calendar.module";
import { GoogleCalendarCallbackController, GoogleCalendarController } from "./google-calendar.controller";
import { GoogleCalendarService } from "./google-calendar.service";
import { GoogleCalendarTask } from "./google-calendar.task";

@Module({
  imports: [PrismaModule, CalendarModule],
  controllers: [GoogleCalendarController, GoogleCalendarCallbackController],
  providers: [GoogleCalendarService, GoogleCalendarTask],
})
export class GoogleCalendarModule {}
