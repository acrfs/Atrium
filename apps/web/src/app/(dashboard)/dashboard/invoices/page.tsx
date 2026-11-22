"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { InvoicesSection } from "../projects/[id]/components/invoices-section";

/**
 * Invoices that have no project: their project was deleted, or they were
 * created without one. The dashboard and calendar link here for those, so
 * every invoice they count can still be opened, paid or deleted.
 */
export default function UnassignedInvoicesPage(): React.ReactElement {
  return (
    <div className="max-w-5xl mx-auto">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-4"
      >
        <ArrowLeft size={13} />
        Dashboard
      </Link>
      <h1 className="text-2xl font-semibold mb-1">Invoices without a project</h1>
      <p className="text-sm text-[var(--muted-foreground)] mb-6">
        These invoices are not attached to any project, usually because the project was deleted.
      </p>
      <InvoicesSection projectId={null} isArchived={false} />
    </div>
  );
}
