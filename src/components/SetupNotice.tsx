export function SetupNotice() {
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-bold">Bijna klaar</h1>
      <p className="text-muted">
        De app is nog niet gekoppeld aan Supabase. Volg de stappen in <code>README.md</code>:
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>Maak een gratis project aan op supabase.com.</li>
        <li>
          Draai <code>supabase/schema.sql</code> in de SQL Editor.
        </li>
        <li>
          Kopieer <code>.env.local.example</code> naar <code>.env.local</code> en vul de URL en anon key
          in.
        </li>
        <li>Herstart de app met <code>npm run dev</code>.</li>
      </ol>
    </main>
  );
}
