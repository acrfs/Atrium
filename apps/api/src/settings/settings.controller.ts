import {
  Controller,
  Get,
  Put,
  Patch,
  Post,
  Delete,
  Body,
  UseGuards,
} from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { UpdateSettingsDto, SaveCustomDomainDto } from "./settings.dto";
import { AuthGuard, RolesGuard, Roles, CurrentOrg, CurrentUser, RequiresFeature } from "../common";

@Controller("settings")
@UseGuards(AuthGuard, RolesGuard)
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get()
  @Roles("owner", "admin", "developer")
  getSettings(@CurrentOrg("id") orgId: string) {
    return this.settingsService.getSettings(orgId);
  }

  @Put()
  @Roles("owner", "developer")
  updateSettings(
    @CurrentOrg("id") orgId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.settingsService.updateSettings(orgId, dto);
  }

  @Patch()
  @Roles("owner", "developer")
  patchSettings(
    @CurrentOrg("id") orgId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.settingsService.updateSettings(orgId, dto);
  }

  // No @Roles — intentionally accessible to all authenticated users including clients
  @Get("payment-instructions")
  getPaymentInstructions(@CurrentOrg("id") orgId: string) {
    return this.settingsService.getPaymentInstructions(orgId);
  }

  @Post("test-email")
  @Roles("owner", "developer")
  testEmail(
    @CurrentOrg("id") orgId: string,
    @CurrentUser("email") userEmail: string,
  ) {
    return this.settingsService.testEmailConfig(orgId, userEmail);
  }

  @Get("custom-domain")
  @Roles("owner", "developer")
  getCustomDomain(@CurrentOrg("id") orgId: string) {
    return this.settingsService.getCustomDomain(orgId);
  }

  @Put("custom-domain")
  @Roles("owner", "developer")
  @RequiresFeature("custom_domain")
  saveCustomDomain(
    @CurrentOrg("id") orgId: string,
    @Body() dto: SaveCustomDomainDto,
  ) {
    return this.settingsService.saveCustomDomain(orgId, dto.domain);
  }

  @Delete("custom-domain")
  @Roles("owner", "developer")
  removeCustomDomain(@CurrentOrg("id") orgId: string) {
    return this.settingsService.removeCustomDomain(orgId);
  }

  @Get("custom-domain/verify")
  @Roles("owner", "developer")
  verifyCustomDomain(@CurrentOrg("id") orgId: string) {
    return this.settingsService.verifyCustomDomain(orgId);
  }
}
