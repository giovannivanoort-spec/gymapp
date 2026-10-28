import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Suspense } from "react";
import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GymApp",
  description: "Train samen met je vrienden: schema's, sets, reps en gewichten bijhouden.",
  appleWebApp: { capable: true, title: "GymApp", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0b0d10",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="nl" className={`${geistSans.variable} h-full antialiased`}>
      {/* Browserextensies (bijv. ColorZilla) zetten attributen op <body>; die verschillen negeren we. */}
      <body className="min-h-full" suppressHydrationWarning>
        <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-muted">Laden…</div>}>
          <AuthProvider>{children}</AuthProvider>
        </Suspense>
      </body>
    </html>
  );
}
