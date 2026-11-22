import { Module } from "@nestjs/common";
import { ContactSyncModule } from "../contact-sync/contact-sync.module";
import { BillingModule } from "../billing/billing.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SettingsModule } from "../settings/settings.module";
import { PaymentsController } from "./payments.controller";
import { ConnectWebhookController } from "./connect-webhook.controller";
import { PaymentsService } from "./payments.service";
import { BillcomController } from "./billcom/billcom.controller";
import { BillcomService } from "./billcom/billcom.service";
import { BillcomPollTask } from "./billcom/billcom-poll.task";

@Module({
  imports: [ContactSyncModule, BillingModule, NotificationsModule, SettingsModule],
  controllers: [PaymentsController, ConnectWebhookController, BillcomController],
  providers: [PaymentsService, BillcomService, BillcomPollTask],
  exports: [PaymentsService, BillcomService],
})
export class PaymentsModule {}
