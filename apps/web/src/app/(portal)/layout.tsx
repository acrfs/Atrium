import { headers } from "next/headers";
import { DemoBanner } from "@/components/demo-banner";
import { Suspense } from "react";
import { redirect, unstable_rethrow } from "next/navigation";
import { loginRedirectPath } from "@/lib/login-redirect";
import Link from "next/link";
import { SignOutButton } from "./sign-out-button";
import { getSession } from "@/lib/auth";
import { NotificationBell, NotificationProvider } from "@/components/notification-bell";
import { DynamicFavicon } from "@/components/dynamic-favicon";
import { PreviewModeProvider } from "@/lib/preview-mode";
import { PreviewBanner } from "@/components/preview-banner";
import { ThemeToggle } from "@/components/theme-toggle";
import { serverFetch } from "@/lib/server-api";
import { twoFactorGatePage } from "@/lib/two-factor-gate";
import { logoSrc as buildLogoSrc } from "@/lib/logo-src";
import { SessionProvider } from "@/lib/session-context";
import { STUDIO_NAME, StudioMark } from "@/lib/studio";

async function getBranding() {
  try {
    const res: Response = await serverFetch("/api/branding");
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    // cookies() throws a control-flow signal during static render; let it through.
    unstable_rethrow(err);
    console.error("Failed to load branding", err);
    return null;
  }
}

async function getOrg(): Promise<{
  id: string;
  name: string;
  role: string;
  isDemo: boolean;
} | null> {
  try {
    const res: Response = await serverFetch("/api/organization/current");
    if (!res.ok) return null;
    const org: { id?: string; name?: string; role?: string; isDemo?: boolean } = await res.json();
    if (!org?.id) return null;
    return {
      id: org.id,
      name: org.name ?? "",
      role: org.role ?? "",
      isDemo: org.isDemo === true,
    };
  } catch (err) {
    // cookies() throws a control-flow signal during static render; let it through.
    unstable_rethrow(err);
    console.error("Failed to load organization", err);
    return null;
  }
}

/**
 * Where the real app lives, for the demo banner's "Start free" link. Whether
 * this is the demo comes from /api/organization/current, not the environment:
 * DEMO_MODE is instance-wide, the API's fence is organization-scoped.
 */
function demoAppUrl(): string {
  return process.env.DEMO_APP_URL ?? "";
}

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, gatePage, branding, org] = await Promise.all([
    getSession(),
    twoFactorGatePage(),
    getBranding(),
    getOrg(),
  ]);
  if (!session) {
    redirect(await loginRedirectPath());
  }
  // A session that has not passed its second factor, or staff who owe setup.
  if (gatePage) redirect(gatePage);
  // A developer has no client portal; their place is the dashboard's Settings.
  if (org?.role === "developer") redirect("/dashboard/settings/workspace");

  const orgName: string | null = org?.name || null;
  const logoSrc: string | null = buildLogoSrc(branding, process.env.NEXT_PUBLIC_API_URL || "");

  const appUrl: string = demoAppUrl();
  const isDemo: boolean = org?.isDemo === true;

  return (
    <Suspense fallback={null}>
      <SessionProvider
        userId={session.user?.id ?? ""}
        userName={session.user?.name ?? ""}
        role={org?.role ?? ""}
        orgId={org?.id ?? ""}
        onCustomDomain={Boolean((await headers()).get("x-custom-host"))}
        isDemo={isDemo}
      >
      <NotificationProvider>
      <PreviewModeProvider>
        <div
          style={
            {
              "--primary": branding?.primaryColor || "#2d2c80",
            } as React.CSSProperties
          }
        >
          <DynamicFavicon href={logoSrc || "/icon-64.png"} />
          <PreviewBanner />
          <header className="studio-nav-wrap">
            <div className="studio-nav">
              <Link className="studio-nav-logo" href="/portal" aria-label={`${orgName || STUDIO_NAME}, your projects`}>
                {!branding?.hideLogo && logoSrc ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={logoSrc} alt="" />
                ) : (
                  <StudioMark size={30} />
                )}
              </Link>
              <nav className="studio-nav-links" aria-label="Main">
                <Link href="/portal">Projects</Link>
                <Link href="/portal/settings">Settings</Link>
              </nav>
              <div className="studio-nav-tools">
                <NotificationBell />
                <ThemeToggle />
                <SignOutButton />
              </div>
            </div>
          </header>
          <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-16">
            <DemoBanner surface="portal" isDemo={isDemo} appUrl={appUrl} />
            {children}
          </main>
          {branding?.poweredBy && (
            <footer className="py-6 text-center">
              <a
                href="https://atrium.vibralabs.co?ref=portal"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                Powered by Atrium
              </a>
            </footer>
          )}
        </div>
      </PreviewModeProvider>
      </NotificationProvider>
      </SessionProvider>
    </Suspense>
  );
}
