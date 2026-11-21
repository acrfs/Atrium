"use client";

import { BrandingPageSection } from "../branding/branding-page-section";
import { GeneralSection } from "../general/general-section";
import { LeadSourcesSection } from "../lead-sources/lead-sources-section";
import { PipelineStagesSection } from "../pipeline-stages/pipeline-stages-section";
import { ProjectStatusesSection } from "../project-statuses/project-statuses-section";
import { useSession } from "@/lib/session-context";
import { isDeveloper } from "@/lib/developer-access";

export default function WorkspaceSettingsPage(): React.ReactElement {
  const { role } = useSession();
  // Lead sources, pipeline stages and project statuses describe the studio's
  // work, so a developer gets branding and the technical settings only.
  if (isDeveloper(role)) {
    return (
      <div className="divide-y divide-[var(--border)] space-y-0">
        <section className="pb-10">
          <BrandingPageSection />
        </section>
        <section className="pt-10">
          <GeneralSection />
        </section>
      </div>
    );
  }
  return (
    <div className="divide-y divide-[var(--border)] space-y-0">
      <section className="pb-10">
        <BrandingPageSection />
      </section>
      <section className="py-10">
        <LeadSourcesSection />
      </section>
      <section className="py-10">
        <PipelineStagesSection />
      </section>
      <section className="py-10">
        <ProjectStatusesSection />
      </section>
      <section className="pt-10">
        <GeneralSection />
      </section>
    </div>
  );
}
