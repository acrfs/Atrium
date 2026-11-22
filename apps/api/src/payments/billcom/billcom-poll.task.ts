import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { BillcomService } from "./billcom.service";

/** Backup for missed BILL webhooks: re-check unpaid invoices that have a BILL copy. */
@Injectable()
export class BillcomPollTask {
  private readonly logger = new Logger(BillcomPollTask.name);
  private running = false;

  constructor(private billcom: BillcomService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async poll() {
    if (this.running) return;
    this.running = true;
    try {
      const paid = await this.billcom.pollUnpaid();
      if (paid > 0) this.logger.log(`Marked ${paid} invoice(s) paid from Bill.com`);
    } catch (err) {
      this.logger.warn("Bill.com poll failed", err);
    } finally {
      this.running = false;
    }
  }
}
