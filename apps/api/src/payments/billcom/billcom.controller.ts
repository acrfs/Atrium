import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  RawBodyRequest,
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { AuthGuard, RolesGuard, Roles, CurrentOrg, Public, RequiresFeature } from "../../common";
import { ConnectBillcomDto } from "../payments.dto";
import { BillcomService } from "./billcom.service";

@Controller("payments/billcom")
@UseGuards(AuthGuard, RolesGuard)
export class BillcomController {
  constructor(private billcom: BillcomService) {}

  @Get("status")
  @Roles("owner")
  getStatus(@CurrentOrg("id") orgId: string) {
    return this.billcom.getStatus(orgId);
  }

  @Post("connect")
  @Roles("owner")
  @RequiresFeature("online_payments")
  connect(@CurrentOrg("id") orgId: string, @Body() dto: ConnectBillcomDto) {
    return this.billcom.connect(orgId, dto);
  }

  @Post("disconnect")
  @Roles("owner")
  async disconnect(@CurrentOrg("id") orgId: string) {
    await this.billcom.disconnect(orgId);
    return { ok: true };
  }

  /** BILL's invoice.updated notifications (org-scoped; status is re-read from BILL). */
  @Post("webhook/:orgId")
  @Public()
  @SkipThrottle()
  webhook(@Param("orgId") orgId: string, @Req() req: RawBodyRequest<Request>) {
    const signature = req.headers["x-bill-sha-signature"];
    return this.billcom.handleWebhook(
      orgId,
      req.rawBody,
      Array.isArray(signature) ? signature[0] : signature,
    );
  }
}
