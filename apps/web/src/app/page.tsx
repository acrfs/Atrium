import Link from "next/link";
import { STUDIO_NAME, STUDIO_PORTFOLIO_URL, StudioMark } from "@/lib/studio";

export default function Home() {
  return (
    <>
      <header className="studio-nav-wrap is-fixed">
        <div className="studio-nav">
          <Link className="studio-nav-logo" href="/" aria-label={`${STUDIO_NAME} client portal`}>
            <StudioMark size={30} />
          </Link>
          <nav className="studio-nav-links" aria-label="Main">
            <a href={STUDIO_PORTFOLIO_URL}>Portfolio</a>
            <a href={`${STUDIO_PORTFOLIO_URL}/#contact`}>Contact</a>
          </nav>
          <Link className="studio-cta" href="/login">
            Sign in
          </Link>
        </div>
      </header>

      <main>
        <section className="studio-hero">
          <div className="studio-hero-light" aria-hidden="true" />
          <div className="studio-hero-logo">
            <StudioMark color="#fff" />
          </div>
          <h1>Client Portal</h1>
          <p className="studio-hero-sub">
            Your projects with {STUDIO_NAME}. Files, approvals and invoices in one place.
          </p>
          <Link className="studio-cta" href="/login">
            Sign in to your portal
          </Link>
          <a className="studio-hero-foot is-left" href={STUDIO_PORTFOLIO_URL}>
            Back to the portfolio
          </a>
          <span className="studio-hero-foot is-right">{STUDIO_NAME}</span>
        </section>
      </main>
    </>
  );
}
