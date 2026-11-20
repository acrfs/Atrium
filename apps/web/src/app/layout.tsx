import type { Metadata } from "next";
import { Providers } from "./providers";
import { Trackers } from "@/components/trackers";
import { STUDIO_NAME } from "@/lib/studio";
import "./globals.css";
import "./studio-theme.css";

export const metadata: Metadata = {
  title: `${STUDIO_NAME} Client Portal`,
  description: `Client portal for ${STUDIO_NAME}`,
  icons: { icon: "/icon-64.png" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Trackers />
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
