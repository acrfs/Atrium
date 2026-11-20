/**
 * Shana Studios email look (local modification, see MODIFICATIONS.md).
 *
 * Drop-in stand-ins for the @react-email/components the templates use. Each
 * template imports from "../studio" instead of "@react-email/components", so the
 * template files keep their upstream structure while every email gets the
 * studio's paper background, indigo ink, serif headings (Instrument Serif),
 * Outfit body text, Fraunces pill buttons (Shana's "Mix", as on the site), S mark
 * and footer. Colours the templates hard-code (Atrium's greys) are mapped onto
 * the studio palette here, in one place.
 */
import {
  Body as REBody,
  Container as REContainer,
  Font,
  Head as REHead,
  Heading as REHeading,
  Html,
  Img,
  Link as RELink,
  Preview,
  Section as RESection,
  Text as REText,
} from "@react-email/components";
import * as React from "react";

export { Html, Preview };

export const STUDIO = {
  name: "Shana Studios",
  tagline: "Graphic design by Shana Thomas",
  site: "https://shanastudios.co",
  siteLabel: "shanastudios.co",
  email: "hello@shanastudios.co",
  logo: "https://shanastudios.co/email/s-logo.png",
  indigo: "#2d2c80",
  peri: "#5f7bbc",
  pink: "#efbdd7",
  coral: "#f48863",
  cream: "#fdf8c3",
  paper: "#fffdf2",
  table: "#fefbe1",
  line: "#ebe5c3",
  alert: "#c4492c",
  serif: "'Instrument Serif', 'Iowan Old Style', 'Palatino Linotype', Georgia, 'Times New Roman', serif",
  sans: "'Outfit', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  cta: "'Fraunces', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif",
} as const;

type Style = React.CSSProperties;

/** Atrium's hard-coded greys and accents, mapped onto the studio palette. */
const COLOR_MAP: Record<string, string> = {
  "#2d2c80": STUDIO.indigo,
  "#111827": STUDIO.indigo,
  "#1f2937": STUDIO.indigo,
  "#374151": STUDIO.indigo,
  "#4b5563": STUDIO.peri,
  "#6b7280": STUDIO.peri,
  "#9ca3af": STUDIO.peri,
  "#ffffff": STUDIO.paper,
  "#fff": STUDIO.paper,
  "#f9fafb": STUDIO.paper,
  "#f3f4f6": STUDIO.paper,
  "#e5e7eb": STUDIO.line,
  "#d1d5db": STUDIO.line,
  "#b91c1c": STUDIO.alert,
  "#dc2626": STUDIO.alert,
};

function mapColor(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.replace(/#[0-9a-fA-F]{3,6}\b/g, (hex: string) => COLOR_MAP[hex.toLowerCase()] ?? hex);
}

/** Re-colours a template's inline style and swaps its fonts for the studio's. */
function brand(style: Style | undefined): Style {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style ?? {})) {
    if (key === "fontFamily") continue;
    out[key] = /color|background|border/i.test(key) ? mapColor(value) : value;
  }
  return out as Style;
}

export function Head({ children }: { children?: React.ReactNode }) {
  return (
    <REHead>
      <meta name="color-scheme" content="light only" />
      <meta name="supported-color-schemes" content="light" />
      <Font
        fontFamily="Instrument Serif"
        fallbackFontFamily="Georgia"
        webFont={{ url: "https://fonts.gstatic.com/s/instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-6zUTjnTLgNs.woff2", format: "woff2" }}
        fontWeight={400}
        fontStyle="normal"
      />
      <Font
        fontFamily="Fraunces"
        fallbackFontFamily="Georgia"
        webFont={{
          url: "https://fonts.gstatic.com/s/fraunces/v38/6NUu8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7iQcIfJD58njt0oc7qv8.woff2",
          format: "woff2",
        }}
        fontWeight={600}
        fontStyle="normal"
      />
      {/* Each Font also sets a page-wide default, so Outfit (body text) goes last. */}
      <Font
        fontFamily="Outfit"
        fallbackFontFamily="Helvetica"
        webFont={{ url: "https://fonts.gstatic.com/s/outfit/v15/QGYvz_MVcBeNP4NJtEtq.woff2", format: "woff2" }}
        fontWeight={400}
        fontStyle="normal"
      />
      {/* Bold words use the soft serif, as on the site. */}
      <style>{`strong,b{font-family:${STUDIO.cta};font-weight:600;letter-spacing:0;}`}</style>
      {children}
    </REHead>
  );
}

/** Paper page with the S mark on top and the studio footer underneath. */
export function Body({ children }: { children?: React.ReactNode; style?: Style }) {
  return (
    <REBody
      style={{
        backgroundColor: STUDIO.paper,
        color: STUDIO.indigo,
        fontFamily: STUDIO.sans,
        margin: 0,
        padding: "40px 12px 48px",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <REContainer style={{ maxWidth: "560px", margin: "0 auto" }}>
        <RESection style={{ padding: "0 8px 22px" }}>
          <table role="presentation" cellPadding={0} cellSpacing={0} style={{ borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={{ verticalAlign: "middle", paddingRight: "12px" }}>
                  <Img src={STUDIO.logo} width="34" height="35" alt="" style={{ display: "block" }} />
                </td>
                <td style={{ verticalAlign: "middle" }}>
                  <span style={{ fontFamily: STUDIO.serif, fontSize: "26px", lineHeight: "1", color: STUDIO.indigo, letterSpacing: "-0.01em" }}>
                    {STUDIO.name}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </RESection>
        {children}
        <Footer />
      </REContainer>
    </REBody>
  );
}

/** Brand-colour ribbon along the top of the card, like the letterhead. */
function Ribbon() {
  const colors: string[] = [STUDIO.indigo, STUDIO.peri, STUDIO.pink, STUDIO.coral, STUDIO.cream];
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: "collapse" }}>
      <tbody>
        <tr>
          {colors.map((c: string) => (
            <td key={c} style={{ backgroundColor: c, height: "6px", lineHeight: "6px", fontSize: "1px" }}>
              &nbsp;
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/** The message card. */
export function Container({ children }: { children?: React.ReactNode; style?: Style }) {
  return (
    <REContainer
      style={{
        maxWidth: "560px",
        width: "100%",
        backgroundColor: STUDIO.table,
        border: `1px solid ${STUDIO.line}`,
        borderRadius: "22px",
        overflow: "hidden",
      }}
    >
      <Ribbon />
      <RESection style={{ padding: "34px 36px 30px" }}>{children}</RESection>
    </REContainer>
  );
}

function Footer() {
  const small: Style = { fontSize: "13px", lineHeight: "20px", color: STUDIO.peri, margin: 0 };
  return (
    <RESection style={{ padding: "26px 8px 0", textAlign: "center" }}>
      <REText style={{ ...small, fontFamily: STUDIO.serif, fontSize: "19px", color: STUDIO.indigo, marginBottom: "4px" }}>
        {STUDIO.name}
      </REText>
      <REText style={small}>{STUDIO.tagline}</REText>
      <REText style={{ ...small, marginTop: "6px" }}>
        <RELink href={STUDIO.site} style={{ color: STUDIO.peri, textDecoration: "underline" }}>
          {STUDIO.siteLabel}
        </RELink>
        {"  ·  "}
        <RELink href={`mailto:${STUDIO.email}`} style={{ color: STUDIO.peri, textDecoration: "underline" }}>
          {STUDIO.email}
        </RELink>
      </REText>
    </RESection>
  );
}

export function Heading({ children, style, as }: { children?: React.ReactNode; style?: Style; as?: "h1" | "h2" | "h3" }) {
  const level: "h1" | "h2" | "h3" = as ?? "h1";
  const size: string = level === "h1" ? "36px" : level === "h2" ? "26px" : "21px";
  return (
    <REHeading
      as={level}
      style={{
        ...brand(style),
        fontFamily: STUDIO.serif,
        fontWeight: 400,
        fontSize: size,
        lineHeight: "1.1",
        letterSpacing: "-0.02em",
        color: STUDIO.indigo,
        margin: level === "h1" ? "0 0 20px" : "28px 0 10px",
      }}
    >
      {children}
    </REHeading>
  );
}

export function Text({ children, style }: { children?: React.ReactNode; style?: Style }) {
  const s: Style = brand(style);
  const isNote: boolean = typeof s.borderLeft === "string" || (typeof s.backgroundColor === "string" && s.backgroundColor !== "transparent");
  return (
    <REText
      style={{
        fontSize: "16px",
        lineHeight: "26px",
        color: STUDIO.indigo,
        margin: "0 0 14px",
        ...s,
        fontFamily: STUDIO.sans,
        ...(isNote && {
          backgroundColor: STUDIO.paper,
          borderLeft: `3px solid ${STUDIO.pink}`,
          borderRadius: "12px",
          padding: "14px 18px",
          color: STUDIO.indigo,
        }),
      }}
    >
      {children}
    </REText>
  );
}

/** Links with a background are the templates' buttons: they become studio pills. */
export function Link({ children, style, href }: { children?: React.ReactNode; style?: Style; href?: string }) {
  const s: Style = brand(style);
  const isButton: boolean = typeof style?.backgroundColor === "string" || style?.display === "inline-block";
  if (isButton) {
    return (
      <RELink
        href={href}
        style={{
          display: "inline-block",
          backgroundColor: STUDIO.indigo,
          color: STUDIO.paper,
          fontFamily: STUDIO.cta,
          fontSize: "15px",
          fontWeight: 600,
          fontVariationSettings: "'SOFT' 100, 'WONK' 0",
          lineHeight: "20px",
          letterSpacing: "0",
          padding: "14px 28px",
          borderRadius: "999px",
          textDecoration: "none",
          marginTop: s.marginTop ?? "10px",
          marginBottom: "6px",
        }}
      >
        {children}
      </RELink>
    );
  }
  return (
    <RELink href={href} style={{ ...s, color: STUDIO.indigo, textDecoration: "underline", fontFamily: STUDIO.sans }}>
      {children}
    </RELink>
  );
}

export function Section({ children, style }: { children?: React.ReactNode; style?: Style }) {
  return <RESection style={brand(style)}>{children}</RESection>;
}
