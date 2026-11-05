import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";

/**
 * Privacyverklaring (AVG art. 13). Openbaar: ook leesbaar zonder in te loggen (PUBLIC_PATHS in
 * AuthProvider), zonder navigatie. Deze URL (/privacy) blijft vast: hij wordt ook gebruikt in de
 * Play Store, het Health Connect-privacyscherm en App Store Connect. Zie docs/health-koppeling.md §7.
 *
 * Contactgegevens van de verantwoordelijke: NEXT_PUBLIC_PRIVACY_CONTACT (e-mailadres) en
 * NEXT_PUBLIC_PRIVACY_CONTROLLER (naam). Vul die in voordat de app in een winkel komt.
 */

export const metadata: Metadata = {
  title: "Privacyverklaring",
  description: `Hoe ${APP_NAME} met je gegevens omgaat, ook met je stappen en verbrande calorieën.`,
};

/** Bij een inhoudelijke wijziging: datum aanpassen (en zo nodig ACTIVITY_CONSENT_VERSION ophogen). */
const UPDATED = "5 november 2026";

const CONTACT = process.env.NEXT_PUBLIC_PRIVACY_CONTACT?.trim() || null;
const CONTROLLER = process.env.NEXT_PUBLIC_PRIVACY_CONTROLLER?.trim() || `de beheerder van ${APP_NAME}`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted [&_strong]:font-semibold [&_strong]:text-ink">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="text-sm font-bold">{APP_NAME}</p>
        <Link href="/" className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-accent">
          Naar de app
        </Link>
      </div>

      <h1 className="text-2xl font-extrabold">Privacyverklaring</h1>
      <p className="mt-1 text-xs text-muted">Bijgewerkt op {UPDATED}</p>

      <div className="mt-6 space-y-7">
        <Section title="Wie is verantwoordelijk">
          <p>
            {APP_NAME} is een app om samen te trainen en je training, voeding en activiteit bij te houden. Verantwoordelijk voor je
            gegevens is <strong>{CONTROLLER}</strong>.
          </p>
          <p>
            Vragen, of je rechten gebruiken (zie hieronder)?{" "}
            {CONTACT ? (
              <>
                Mail naar{" "}
                <a href={`mailto:${CONTACT}`} className="font-semibold text-accent">
                  {CONTACT}
                </a>
                .
              </>
            ) : (
              <>Neem contact op met de beheerder van {APP_NAME}, bijvoorbeeld via je trainer.</>
            )}
          </p>
        </Section>

        <Section title="Welke gegevens">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Account:</strong> e-mailadres, naam en eventueel een profielfoto.
            </li>
            <li>
              <strong>Profiel:</strong> wat je zelf invult, zoals lichaamsgewicht, lengte, geboortedatum en geslacht.
            </li>
            <li>
              <strong>Training:</strong> schema&apos;s, oefeningen, sets, herhalingen en gewichten.
            </li>
            <li>
              <strong>Voeding:</strong> wat je eet en je voedingsdoelen.
            </li>
            <li>
              <strong>Activiteit (alleen met je toestemming):</strong> per dag je totaal aantal stappen en actieve kcal, eventueel
              totale kcal, en de bron (handmatig of de naam van de app). Geen losse metingen, hartslag, slaap of locatie.
            </li>
          </ul>
          <p>
            Stappen, verbrande calorieën, gewicht en voeding zijn <strong>gezondheidsgegevens</strong> (bijzondere persoonsgegevens,
            art. 9 AVG). Activiteit slaan we daarom alleen op met jouw uitdrukkelijke toestemming. Om toestemming te geven moet je 16
            jaar of ouder zijn.
          </p>
        </Section>

        <Section title="Waar je activiteit vandaan komt">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Handmatig:</strong> je vult je stappen zelf in.
            </li>
            <li>
              <strong>Health Connect (Android):</strong> met de Android-app van {APP_NAME} haal je dagtotalen op die je telefoon of
              horloge (bijvoorbeeld Garmin, Samsung of Fitbit) daar heeft opgeslagen. Alleen als je dat zelf toestaat.
            </li>
            <li>
              <strong>Apple Health (iPhone):</strong> later, met een iOS-app, op dezelfde manier.
            </li>
          </ul>
          <p>Gegevens uit Health Connect en Apple Health gebruiken we alleen voor de functies hieronder, nooit voor iets anders.</p>
        </Section>

        <Section title="Waarvoor en op welke grondslag">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>De app laten werken</strong> (account, training, voeding, groepen): nodig om de dienst te leveren die je
              gebruikt.
            </li>
            <li>
              <strong>Activiteit opslaan</strong> en je stappendoel tonen: alleen met je toestemming.
            </li>
            <li>
              <strong>Stappen delen</strong> met vrienden en groepsgenoten (ook je trainer) op de ranglijst: een aparte toestemming,
              standaard uit. Zij zien alleen je stappen per dag, niet je calorieën, en alleen als zij zelf ook delen.
            </li>
            <li>
              <strong>De AI-coach</strong> je activiteit laten gebruiken om je vragen te beantwoorden: een aparte toestemming,
              standaard uit.
            </li>
            <li>
              <strong>Calorieën terugverdienen</strong>: extra beweging bij je voedingsdoel optellen. Standaard uit.
            </li>
          </ul>
          <p>
            Elke toestemming zet je los aan of uit in Profiel, onder Koppelingen. We leggen vast wanneer je toestemming gaf of
            introk, en voor welke versie van de uitleg.
          </p>
        </Section>

        <Section title="Wie je gegevens verwerkt">
          <p>We verkopen niets en delen je gegevens alleen met diensten die nodig zijn om de app te laten werken:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Supabase</strong>: database en inloggen.
            </li>
            <li>
              <strong>Vercel</strong>: hosting van de app.
            </li>
            <li>
              <strong>Anthropic (Claude)</strong>: de AI-coach en het schatten van voeding op een foto die je zelf maakt. Je activiteit gaat er alleen heen als je dat hebt aangezet.
            </li>
            <li>
              <strong>Google en Apple</strong>: het versturen van meldingen (push), als je die aanzet.
            </li>
          </ul>
          <p>
            Sommige van deze diensten verwerken gegevens buiten de Europese Unie, vooral in de Verenigde Staten. Dat gebeurt op basis
            van het EU-VS Data Privacy Framework of de standaardcontractbepalingen van de Europese Commissie.
          </p>
        </Section>

        <Section title="Hoe lang we gegevens bewaren">
          <p>
            Activiteit bewaren we zolang je toestemming loopt. Trek je die in, dan verwijderen we al je stappen- en caloriegegevens
            direct. Je kunt ook alleen je gegevens verwijderen en de toestemming laten staan. Verwijder je je account, dan verdwijnen
            al je gegevens, ook je activiteit.
          </p>
        </Section>

        <Section title="Je rechten">
          <p>
            Je mag je gegevens inzien, laten verbeteren of laten verwijderen, en je kunt bezwaar maken of een kopie vragen. Veel
            daarvan kan direct in de app, in Profiel. Een gegeven toestemming trek je in met dezelfde schakelaar als waarmee je hem
            gaf.
          </p>
          <p>
            Ben je het niet eens met hoe we met je gegevens omgaan, dan kun je een klacht indienen bij de{" "}
            <a
              href="https://www.autoriteitpersoonsgegevens.nl"
              className="font-semibold text-accent"
              target="_blank"
              rel="noopener noreferrer"
            >
              Autoriteit Persoonsgegevens
            </a>
            .
          </p>
        </Section>

        <Section title="Wat we niet doen">
          <ul className="list-disc space-y-1 pl-5">
            <li>Geen advertenties en geen advertentienetwerken.</li>
            <li>Geen verkoop van gegevens.</li>
            <li>Geen opslag van je gezondheidsgegevens in iCloud.</li>
            <li>Geen gebruik van je gezondheidsgegevens voor iets anders dan de functies hierboven.</li>
          </ul>
        </Section>
      </div>
    </main>
  );
}
