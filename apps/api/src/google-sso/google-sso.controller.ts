import { Body, Controller, Get, Header, Headers, HttpCode, NotFoundException, Post, Query, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { Public } from "../common";
import { isStaffRole } from "../common/helpers/privileged-role";
import type { AuthenticatedRequest } from "../common/types/authenticated-request";
import { hasSecondFactor } from "../two-factor/second-factor";
import { GoogleSsoService, type AuthorizeProblem, type AuthorizeQuery, type TokenRequest, type TokenResult } from "./google-sso.service";

/** The request fields this controller reads; every one may be missing. */
type SsoRequest = Partial<
  Pick<AuthenticatedRequest, "user" | "session" | "member" | "workspaceRequiresTwoFactor" | "workspaceRequiresPasskey">
> & {
  originalUrl: string;
};

/** The page that resolves a session the second-factor gate holds back, or null when it may pass. */
export function gatePage(req: SsoRequest): "/login/2fa" | "/2fa/setup" | null {
  if (!req.user) return null;
  const isStaff: boolean = isStaffRole(req.member?.role);
  if (hasSecondFactor(req.user) && !req.session?.secondFactor) return "/login/2fa";
  // Same rule as the second-factor gate: staff need a passkey and must have signed in with it.
  if (req.workspaceRequiresPasskey === true && isStaff) {
    if (req.user.hasPasskey !== true) return "/2fa/setup";
    return req.session?.secondFactor === "passkey" ? null : "/login/2fa";
  }
  if (hasSecondFactor(req.user)) return null;
  if (req.workspaceRequiresTwoFactor === true && isStaff) return "/2fa/setup";
  return null;
}

/**
 * OpenID Connect endpoints that let Google Workspace send a user to the
 * portal to sign in (a third-party SSO profile assigned to one org unit).
 * Off, and answering 404, unless GOOGLE_SSO_* is configured.
 */
@Public()
@Controller("sso/google")
export class GoogleSsoController {
  constructor(private sso: GoogleSsoService) {}

  @Get(".well-known/openid-configuration")
  @Header("Cache-Control", "public, max-age=300")
  discovery(): Record<string, unknown> {
    this.assertEnabled();
    return this.sso.discovery();
  }

  @Get("jwks")
  @Header("Cache-Control", "public, max-age=300")
  jwks(): Record<string, unknown> {
    this.assertEnabled();
    return this.sso.jwks();
  }

  @Get("authorize")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  authorize(@Query() query: AuthorizeQuery, @Req() req: SsoRequest, @Res() res: Response): void {
    this.assertEnabled();
    const problem: AuthorizeProblem | null = this.sso.checkAuthorize(query);
    if (problem?.kind === "bad_client" || problem?.kind === "bad_redirect") {
      // Never redirect to an unchecked URI.
      res.status(400).type("text/plain").send("This sign-in link is not valid.");
      return;
    }
    if (problem?.kind === "redirect_error") {
      res.redirect(302, this.sso.redirectTo(query.redirect_uri as string, {
        error: problem.error,
        error_description: problem.description,
        state: query.state,
      }));
      return;
    }

    // Signed out (or not yet past the second factor): sign in on the portal,
    // which brings the browser straight back here with the same query.
    const next: string = encodeURIComponent(req.originalUrl);
    if (!req.user || !req.session) {
      res.redirect(302, `${this.sso.webUrl}/login?next=${next}`);
      return;
    }
    const gate: string | null = gatePage(req);
    if (gate) {
      res.redirect(302, `${this.sso.webUrl}${gate}?next=${next}`);
      return;
    }

    if (!this.sso.isAllowed(req.user.email)) {
      res.redirect(302, this.sso.redirectTo(query.redirect_uri as string, {
        error: "access_denied",
        error_description: "This portal account cannot sign in to Google",
        state: query.state,
      }));
      return;
    }

    const authTime: number = Math.floor(new Date(req.session.createdAt).getTime() / 1000);
    res.redirect(302, this.sso.issueCode(query, req.user, authTime));
  }

  @Post("token")
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  token(@Body() body: TokenRequest, @Headers("authorization") authorization: string | undefined, @Res() res: Response): void {
    this.assertEnabled();
    const result: TokenResult = this.sso.exchange(body ?? {}, authorization);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    if (result.ok) {
      res.status(200).json(result.body);
      return;
    }
    if (result.status === 401) res.setHeader("WWW-Authenticate", 'Basic realm="google-sso"');
    res.status(result.status).json({ error: result.error, error_description: result.description });
  }

  @Get("userinfo")
  userinfoGet(@Headers("authorization") authorization: string | undefined, @Res() res: Response): void {
    this.sendUserinfo(authorization, res);
  }

  @Post("userinfo")
  @HttpCode(200)
  userinfoPost(@Headers("authorization") authorization: string | undefined, @Res() res: Response): void {
    this.sendUserinfo(authorization, res);
  }

  private sendUserinfo(authorization: string | undefined, res: Response): void {
    this.assertEnabled();
    const claims: Record<string, unknown> | null = this.sso.userinfo(authorization);
    res.setHeader("Cache-Control", "no-store");
    if (!claims) {
      res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    res.status(200).json(claims);
  }

  private assertEnabled(): void {
    if (!this.sso.enabled) throw new NotFoundException();
  }
}
