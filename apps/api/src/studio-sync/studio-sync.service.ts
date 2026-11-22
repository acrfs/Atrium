import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { MailService } from "../mail/mail.service";
import { passwordChangedEmailHtml } from "../mail/studio-mail";

export interface StudioSyncResult {
  login: "updated";
  notified: boolean;
}

/**
 * Shana Studios password page: checks and sets one person's portal sign-in
 * password. The portal is also her Google Workspace sign-in (see google-sso),
 * so this one password covers the portal and Google.
 */
@Injectable()
export class StudioSyncService {
  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
    private mailService: MailService,
    @InjectPinoLogger(StudioSyncService.name) private readonly logger: PinoLogger,
  ) {}

  private findUser(loginEmail: string) {
    return this.prisma.user.findFirst({
      where: { email: { equals: loginEmail, mode: "insensitive" } },
      select: { id: true, email: true },
    });
  }

  /** True when the password matches the user's portal sign-in password. */
  async verifyPassword(loginEmail: string, password: string): Promise<boolean> {
    const user = await this.findUser(loginEmail);
    if (!user) return false;
    const account = await this.prisma.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
      select: { password: true },
    });
    if (!account?.password) return false;
    const context = await this.authService.auth.$context;
    return context.password.verify({ hash: account.password, password });
  }

  async setPassword(loginEmail: string, password: string): Promise<StudioSyncResult> {
    const user = await this.findUser(loginEmail);
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

    // The notice goes out through the workspace's own email setting.
    const membership = await this.prisma.member.findFirst({
      where: { userId: user.id },
      select: { organizationId: true },
      orderBy: { createdAt: "asc" },
    });
    let notified = false;
    try {
      const html = await passwordChangedEmailHtml();
      const sent = await this.mailService.send(user.email, "Your Shana Studios password was changed", html, membership?.organizationId);
      notified = sent.sent;
    } catch (err) {
      this.logger.warn({ err }, "Password change notice could not be sent");
    }

    this.logger.info({ notified }, "Studio password change applied");
    return { login: "updated", notified };
  }
}
