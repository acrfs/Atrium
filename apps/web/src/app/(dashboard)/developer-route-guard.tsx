"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { DEVELOPER_HOME, developerMayOpen, isDeveloper } from "@/lib/developer-access";

/**
 * Sends a developer away from dashboard pages that show the studio's work
 * (projects, contacts, calendar, reports) and renders nothing there meanwhile,
 * so not even an empty shell of those pages shows.
 */
export function DeveloperRouteGuard({ children }: { children: React.ReactNode }): React.ReactElement | null {
  const { role } = useSession();
  const pathname: string = usePathname();
  const router = useRouter();
  const blocked: boolean = isDeveloper(role) && !developerMayOpen(pathname);

  useEffect(() => {
    if (blocked) router.replace(DEVELOPER_HOME);
  }, [blocked, router]);

  if (blocked) return null;
  return <>{children}</>;
}
