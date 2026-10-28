# GymApp

Samen trainen met vrienden: groepen, trainingen per dag, sets/reps/gewicht loggen, opmerkingen, herbruikbare schema's, een oefeningenbibliotheek met uitleg en video, en een spieranalyse bij het maken van een schema.

Gebouwd met Next.js 16, Tailwind 4 en Supabase (login + database + live updates).

## 1. Supabase instellen (eenmalig, ±5 min)

1. Ga naar [supabase.com](https://supabase.com), maak een gratis account en een **New project** (regio: bijv. Frankfurt).
2. Open in je project **SQL Editor → New query**, plak de inhoud van [`supabase/schema.sql`](supabase/schema.sql) en klik **Run**.
3. **Authentication → Sign In / Providers → Email**: staat standaard aan.
   - Wil je dat vrienden direct kunnen inloggen zonder bevestigingsmail? Zet **Confirm email** uit.
4. **Authentication → URL Configuration**: zet **Site URL** op `http://localhost:3000` (later je echte URL, zie stap 3).
5. Kopieer `.env.local.example` naar `.env.local` en vul in (te vinden via de **Connect**-knop bovenaan je project, of **Project Settings → API**):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... (anon / publishable key)
   ```

## 2. Lokaal draaien

```bash
npm install
npm run dev
```

Open http://localhost:3000. Testen op je telefoon in hetzelfde wifi-netwerk: `npm run dev -- -H 0.0.0.0` en ga naar `http://<ip-van-je-pc>:3000`.

## Updates

De app staat op Vercel (https://gymapp-eight-kappa.vercel.app) en is gekoppeld aan GitHub (`giovannivanoort-spec/gymapp`). Elke push naar `main` gaat vanzelf live:

```bash
git add -A
git commit -m "Wat er veranderd is"
git push
```

## 3. Online zetten (zodat je vrienden erbij kunnen)

1. Zet deze map op GitHub.
2. Ga naar [vercel.com](https://vercel.com) → **Add New Project** → kies de repo.
3. Voeg bij **Environment Variables** dezelfde twee variabelen uit `.env.local` toe → **Deploy**.
4. Zet in Supabase (**Authentication → URL Configuration**) de **Site URL** op je Vercel-adres (bijv. `https://gymapp-jij.vercel.app`) en voeg dat ook toe bij **Redirect URLs**.

Op je telefoon: open de site → *Zet op beginscherm*. Dan werkt hij als app.

## Hoe het werkt

| Onderdeel | Waar |
| --- | --- |
| Groep maken, vrienden uitnodigen (link/code) | Home → *+ Nieuwe groep*, groepspagina → *Deel uitnodiging* |
| Training voor een dag klaarzetten (alleen trainers) | Groepspagina → *+ Training* |
| Herbruikbare schema's | Tab *Schema's*, of *Bewaar als schema* bij het plannen |
| Sets, reps en gewicht invullen | Training openen → per set kg + reps, ✓ vult je vorige waarden in |
| Voor een vriend invullen (trainer) | Tik bovenaan de training op de naam van die persoon |
| Opmerkingen | Per oefening (💬) en onderaan de training |
| Uitleg, spieren en video per oefening | Tab *Oefeningen* |
| Welke spieren train je, wat mist er? | Onder de oefeningen bij het plannen/maken van een schema |

**Oefeningen**: 219 stuks, elk met uitleg, tips, een spierkaart (rood = hoofdspier, oranje = helpt mee) en een uitlegvideo.

**Video's**: elke oefening heeft standaard een YouTube-uitlegvideo, automatisch gekozen en gecontroleerd door [`scripts/find-videos.mjs`](scripts/find-videos.mjs) (resultaat in `src/lib/exercise-videos.json`). Vind je een andere video beter, kies dan *Andere video kiezen* op de oefeningpagina; die geldt dan voor iedereen.

**Oefeningen toevoegen of aanpassen**: in [`src/lib/exercises.ts`](src/lib/exercises.ts), [`exercises-upper.ts`](src/lib/exercises-upper.ts) en [`exercises-lower.ts`](src/lib/exercises-lower.ts). Zoek daarna video's voor nieuwe oefeningen met `node scripts/find-videos.mjs`. Spiergroepen staan in [`src/lib/muscles.ts`](src/lib/muscles.ts), de spierkaart in [`src/components/BodyMap.tsx`](src/components/BodyMap.tsx), de analyse-regels in [`src/lib/analysis.ts`](src/lib/analysis.ts).

## Progressie

Tab *Progressie*: een maandkalender (getrainde dagen gevuld, geplande dagen met een rand; tik op een dag voor je sets, reps, geschatte 1RM en records van die dag), per oefening een grafiek en tabel van je beste geschatte 1RM (of reps) per training, en een recordtabel van alle oefeningen.

## In de gym

- **Advies voor vandaag** per oefening (double progression): alle sets aan de bovenkant van het rep-bereik → gewicht omhoog (2,5 kg, of 2 kg bij dumbbells); anders zelfde gewicht en een rep erbij. De sets worden er alvast mee voorgevuld.
- **Schijvencalculator** bij barbell- en EZ-bar-oefeningen.
- **Offline**: sets die je zonder internet invult, worden bewaard en verstuurd zodra er weer verbinding is. Een service worker (`public/sw.js`, alleen in productie) bewaart de app en de laatst geladen data.

## Groep en meldingen

- **Activiteit**-feed per groep: records, promoties en nieuwe leden, met een "Respect"-knop.
- **Pushmeldingen** (Profiel → Meldingen): records en promoties van groepsleden, en elke ochtend een herinnering als er een training gepland staat (Vercel Cron, `vercel.json`). Op iPhone alleen als de app op het beginscherm staat.
- Instellen: draai [`supabase/features.sql`](supabase/features.sql). In `.env.local` en op Vercel: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET` en `SUPABASE_SECRET_KEY` (alleen server).

## Ranks

Per oefening een rang: **Brons, Zilver, Goud, Platina, Diamant, Elite, Olympiër**. Berekend uit je beste set (geschatte 1RM via Epley, sets tot 12 reps) en vergeleken met krachtstandaarden van [StrengthLevel.com](https://strengthlevel.com) **per oefening, geslacht en lichaamsgewicht** (Beginner → Zilver, Novice → Goud, Intermediate → Platina, Advanced → Diamant, Elite → Elite, één Elite-stap verder → Olympiër). Bij lichaamsgewicht-oefeningen tellen reps, en extra gewicht (dipriem/vest) als dat er is. Dumbbell-gewichten gelden per dumbbell.

- Instellen: draai [`supabase/ranks.sql`](supabase/ranks.sql) en [`supabase/profile-extra.sql`](supabase/profile-extra.sql), en vul in je profiel je lichaamsgewicht, geslacht en geboortedatum in. Leeftijd past de standaarden aan met de leeftijdstabellen per oefening (referentie: 30 jaar).
- Te zien op: *Mijn ranks* (vanaf Home of Profiel), elke oefeningpagina (met de "ladder" per rang), de ranglijst in je groep, en een promotie-animatie bij het loggen.
- Standaarden staan in `src/lib/strength-standards.json` en worden bijgewerkt met `node scripts/fetch-standards.mjs` (het script controleert dat materiaal en meetwijze bij de oefening passen; oefeningen zonder betrouwbare standaard krijgen geen rang).

## AI-coach

Tab *Coach*: een AI-coach (Claude Opus 5.5) die schema's maakt, trainingen nakijkt en progressie volgt. Hij leest via tools je echte data (groepen, trainingen, gelogde sets, opmerkingen, schema's) en de oefeningenbibliotheek, en kan op verzoek schema's opslaan of als trainer een training klaarzetten.

Instellen:
1. Draai [`supabase/coach.sql`](supabase/coach.sql) in de Supabase SQL Editor.
2. Maak een API-key op [platform.claude.com](https://platform.claude.com) (*API keys*) en zet hem in `.env.local` als `ANTHROPIC_API_KEY=...`. Op Vercel: voeg hem toe bij *Environment Variables*. **Nooit** met `NEXT_PUBLIC_` ervoor.
3. Herstart `npm run dev`.

Kosten: de coach draait op jouw API-tegoed, ook als vrienden hem gebruiken. Een gewone vraag kost grofweg 5–15 cent (meerdere tool-rondes plus het antwoord); zware vragen, zoals een maand trainingen analyseren, wat meer. `COACH_DAILY_LIMIT` (standaard 40) begrenst het aantal vragen per persoon per dag. Stel in de Claude Console ook een maandlimiet in (*Settings → Limits*).

De code staat in [`src/app/api/coach/route.ts`](src/app/api/coach/route.ts) (server, streaming, tool-loop), [`src/lib/coach/tools.ts`](src/lib/coach/tools.ts) (wat de coach kan) en [`src/lib/coach/prompt.ts`](src/lib/coach/prompt.ts) (instructies).

## Rechten

- **Trainer** (maker van de groep, of iemand die je trainer maakt): trainingen plannen/aanpassen, leden beheren, sets invullen voor leden.
- **Lid**: trainingen zien, eigen sets invullen, opmerkingen plaatsen.

Dit wordt afgedwongen in de database (Row Level Security), niet alleen in de app.
