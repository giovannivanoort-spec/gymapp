"use client";

import type { Session } from "@supabase/supabase-js";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { clearCache, getCached, setCached } from "@/lib/cache";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import type { Profile } from "@/lib/types";
import { OfflineSync } from "./OfflineSync";
import { SetupNotice } from "./SetupNotice";

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

const PUBLIC_PATHS = ["/login"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) return setProfile(null);
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (data) setCached(`profile:${userId}`, data, true);
    setProfile(data);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user.id;
      setSession(data.session);
      // Bekend profiel van een vorige keer: app direct tonen en op de achtergrond verversen.
      const cached = uid ? getCached<Profile>(`profile:${uid}`) : undefined;
      if (cached) {
        setProfile(cached);
        setLoading(false);
        loadProfile(uid);
      } else {
        await loadProfile(uid);
        setLoading(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // De eerste sessie is hierboven al afgehandeld.
      if (event === "INITIAL_SESSION") return;
      if (event === "SIGNED_OUT") clearCache();
      setSession(s);
      if (event !== "TOKEN_REFRESHED") loadProfile(s?.user.id);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (loading) return;
    if (!session && !isPublic) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, session, isPublic, pathname, router]);

  if (!supabaseConfigured) return <SetupNotice />;

  const value: AuthState = {
    session,
    profile,
    loading,
    refreshProfile: () => loadProfile(session?.user.id),
  };

  if (!isPublic && (loading || !session)) {
    return (
      <AuthContext.Provider value={value}>
        <div className="flex min-h-dvh items-center justify-center">
          <Image src="/icon.svg" alt="" width={56} height={56} className="animate-pulse" priority />
        </div>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
      {session && <OfflineSync />}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Voor pagina's achter de login: session is daar altijd gezet. */
export function useUserId(): string {
  const { session } = useAuth();
  return session?.user.id ?? "";
}
