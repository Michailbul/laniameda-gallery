import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { TelegramAuthProvider } from "@/components/TelegramAuthProvider";

const instrumentSerif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Misha Buloy — Taste Profile · Laniameda",
  description:
    "An AI creator's taste profile: story sets, stills, and locations, generated and filed by hand.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
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
