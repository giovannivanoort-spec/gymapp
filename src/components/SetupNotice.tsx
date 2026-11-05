import Image from "next/image";
import { APP_NAME } from "@/lib/brand";

/** Getoond zolang de app nog niet aan Supabase gekoppeld is (geen URL/anon key ingesteld). */
export function SetupNotice() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <Image src="/icon.svg" alt="" width={48} height={48} className="mb-5 rounded-[14px]" priority />
      <h1 className="text-2xl font-bold">Bijna klaar</h1>
      <p className="mt-2 text-muted">
        {APP_NAME} is nog niet gekoppeld aan Supabase. Volg de stappen in <code>README.md</code>:
      </p>
      <ol className="card mt-5 list-decimal space-y-2 pl-9 text-sm">
        <li>Maak een gratis project aan op supabase.com.</li>
        <li>
          Draai <code>supabase/schema.sql</code> in de SQL Editor.
        </li>
        <li>
          Kopieer <code>.env.local.example</code> naar <code>.env.local</code> en vul de URL en anon key in.
        </li>
        <li>
          Herstart de app met <code>npm run dev</code>.
        </li>
      </ol>
    </main>
  );
}
