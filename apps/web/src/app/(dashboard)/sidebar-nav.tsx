"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { isDeveloper } from "@/lib/developer-access";
import {
  LayoutDashboard,
  FolderKanban,
  Settings,
  Calendar,
  BarChart3,
  Contact,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
  { href: "/dashboard/calendar", label: "Calendar", icon: Calendar },
  { href: "/dashboard/contacts", label: "Contacts", icon: Contact },
  { href: "/dashboard/reports", label: "Reports", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  const { role } = useSession();
  // A developer works in Settings only; the studio's work stays out of view.
  const items = isDeveloper(role) ? navItems.filter((i) => i.href === "/dashboard/settings") : navItems;

  return (
    <nav className="space-y-1 flex-1">
      {items.map(({ href, label, icon: Icon }) => {
        const isActive =
          pathname === href ||
          (href !== "/dashboard" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive
                ? "bg-[var(--muted)] font-medium"
                : "hover:bg-[var(--muted)] text-[var(--muted-foreground)]"
            }`}
          >
            <Icon size={18} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
