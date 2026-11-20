import { LOGO_PATH } from "./studio-logo-path";

/** Studio identity for this fork. The portal is styled to match the portfolio site. */
export const STUDIO_NAME = "Shana Studios";
export const STUDIO_PORTFOLIO_URL =
  process.env.NEXT_PUBLIC_PORTFOLIO_URL || "https://shana-studios.vercel.app";

/** The studio's S mark, the same path the portfolio site draws. */
export function StudioMark({
  size = 32,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 432 432" aria-hidden="true">
      <path d={LOGO_PATH} fill={color} />
    </svg>
  );
}
