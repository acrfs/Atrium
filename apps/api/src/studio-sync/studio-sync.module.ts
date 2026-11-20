import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { MailModule } from "../mail/mail.module";
import { StudioSyncController } from "./studio-sync.controller";
import { StudioSyncService } from "./studio-sync.service";

@Module({
  imports: [AuthModule, SettingsModule, MailModule],
  controllers: [StudioSyncController],
  providers: [StudioSyncService],
})
export class StudioSyncModule {}
