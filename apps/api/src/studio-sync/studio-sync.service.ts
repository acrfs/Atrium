import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { SettingsService } from "../settings/settings.service";
import { MailService } from "../mail/mail.service";

export interface StudioSyncResult {
  login: "updated";
  smtpWorkspaces: number;
}

/**
 * Shana Studios password sync: sets one person's sign-in password and the SMTP
 * password of every workspace that sends mail as that address, so a single
 * password change (made on account.shanastudios.co) reaches the portal.
 */
@Injectable()
export class StudioSyncService {
  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
    private settingsService: SettingsService,
    private mailService: MailService,
    @InjectPinoLogger(StudioSyncService.name) private readonly logger: PinoLogger,
  ) {}

  async setPassword(loginEmail: string, smtpUser: string, password: string): Promise<StudioSyncResult> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: loginEmail, mode: "insensitive" } },
      select: { id: true },
    });
    if (!user) throw new NotFoundException("No portal user with that email");

    const context = await this.authService.auth.$context;
    const hash: string = await context.password.hash(password);
    const updated = await this.prisma.account.updateMany({
      where: { userId: user.id, providerId: "credential" },
      data: { password: hash },
    });
    if (updated.count === 0) {
      throw new NotFoundException("That portal user signs in without a password");
    }

    const workspaces = await this.prisma.systemSettings.findMany({
      where: { smtpUser: { equals: smtpUser, mode: "insensitive" } },
      select: { organizationId: true },
    });
    for (const { organizationId } of workspaces) {
      await this.settingsService.updateSettings(organizationId, { smtpPass: password });
    }
    this.mailService.clearSmtpTransporters();

    this.logger.info({ smtpWorkspaces: workspaces.length }, "Studio password sync applied");
    return { login: "updated", smtpWorkspaces: workspaces.length };
  }
}
