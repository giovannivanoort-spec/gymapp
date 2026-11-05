"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { APP_ROOT_ID } from "@/components/shell/appRoot";
import { toast } from "@/components/ui/Toast";
import { APP_NAME } from "@/lib/brand";
import { isNativeApp, nativeBridgeMissing } from "@/lib/native/health";

/** De melding "app bijwerken" één keer per app-sessie. */
let bridgeWarned = false;

/** Hier is "terug" het einde van de app: dan sluiten in plaats van terug naar bijv. het inlogscherm. */
const ROOT_PATHS = new Set(["/", "/login"]);

/**
 * Terugknop van Android in de app (Capacitor). Zodra er een luisteraar is, doet Android zelf niets
 * meer, dus:
 * 1. Een paneel open (de app is dan `inert`): sluiten, net als Escape.
 * 2. Op de startpagina of het inlogscherm, of geen vorige pagina: de app sluiten.
 * 3. Anders: een pagina terug.
 * Doet niets op het web (daar regelt de browser het).
 *
 * Draait de pagina in de app maar zonder Capacitor-brug (een doorverwijzing naar een ander adres dan
 * server.url van deze APK), dan werken de terugknop en Health Connect niet: dan een blijvende melding
 * om de app bij te werken.
 */
export function NativeBackButton() {
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (bridgeWarned || !nativeBridgeMissing()) return;
    bridgeWarned = true;
    console.warn(`[${APP_NAME}] In de app, maar zonder Capacitor-brug op ${window.location.origin}: server.url van deze APK wijkt af.`);
    toast.warn(`Er is een nieuwe versie van de ${APP_NAME}-app. Installeer die om Health Connect en de terugknop te blijven gebruiken.`, { duration: 0 });
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    let alive = true;
    let remove: (() => void) | null = null;

    (async () => {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("backButton", ({ canGoBack }) => {
        const root = document.getElementById(APP_ROOT_ID);
        if (root?.inert) {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
          return;
        }
        if (!canGoBack || ROOT_PATHS.has(pathRef.current)) {
          void App.exitApp();
          return;
        }
        window.history.back();
      });
      if (alive) remove = () => void handle.remove();
      else void handle.remove();
    })().catch(() => {});

    return () => {
      alive = false;
      remove?.();
    };
  }, []);

  return null;
}
