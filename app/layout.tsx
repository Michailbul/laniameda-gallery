import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { TelegramAuthProvider } from "@/components/TelegramAuthProvider";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

const instrumentSerif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Laniameda Gallery",
  description:
    "An AI creator's working vault: story sets, stills, and locations, generated and filed by hand.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Resolve the theme before first paint — otherwise a light-theme
            user gets a dark flash on every navigation. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} ${instrumentSerif.variable} antialiased`}
        suppressHydrationWarning
      >
        <ConvexClientProvider>
          <TelegramAuthProvider>{children}</TelegramAuthProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
