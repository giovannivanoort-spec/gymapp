import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Suspense } from "react";
import { AuthProvider } from "@/components/AuthProvider";
import { APP_ROOT_ID } from "@/components/shell/appRoot";
import { Splash } from "@/components/shell/Splash";
import { APP_BG, APP_DESCRIPTION, APP_NAME } from "@/lib/brand";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/*
 * Opstartschermen voor de iPhone-app op het beginscherm (iOS heeft geen manifest-splash). Zelfde
 * achtergrond en logo als <Splash />, zodat een koude start niet eerst wit of leeg flitst.
 * [css-breedte, css-hoogte, pixelratio]; de PNG's staan in public/splash/.
 */
const IOS_SCREENS: [number, number, number][] = [
  [440, 956, 3],
  [402, 874, 3],
  [430, 932, 3],
  [393, 852, 3],
  [428, 926, 3],
  [390, 844, 3],
  [375, 812, 3],
  [414, 896, 3],
  [414, 896, 2],
  [414, 736, 3],
  [375, 667, 2],
];

const startupImage = IOS_SCREENS.map(([w, h, dpr]) => ({
  url: `/splash/splash-${w * dpr}x${h * dpr}.png`,
  media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
}));

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s - ${APP_NAME}` },
  applicationName: APP_NAME,
  description: APP_DESCRIPTION,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "black-translucent", startupImage },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: APP_BG,
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="nl" className={`${geistSans.variable} h-full antialiased`}>
      {/* Browserextensies (bijv. ColorZilla) zetten attributen op <body>; die verschillen negeren we. */}
      <body className="min-h-full" suppressHydrationWarning>
        {/*
         * De app zelf (zonder pop-ups, die via Portal direct in <body> staan). Een open paneel maakt
         * dit element `inert`, zodat VoiceOver en Tab niet naar de pagina erachter kunnen.
         * `contents`: geen eigen vak, dus geen invloed op de opmaak.
         */}
        <div id={APP_ROOT_ID} className="contents">
          <Suspense fallback={<Splash />}>
            <AuthProvider>{children}</AuthProvider>
          </Suspense>
        </div>
      </body>
    </html>
  );
}
