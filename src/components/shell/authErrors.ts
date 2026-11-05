/**
 * Supabase-foutmeldingen (Engels) omzetten naar duidelijk Nederlands.
 * Kijkt eerst naar de foutcode en valt terug op de tekst, omdat oudere servers geen code meesturen.
 */
export function authErrorMessage(err: unknown): string {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  const msg = err && typeof err === "object" && "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
  const m = msg.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => m.includes(n));

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "Je bent offline. Maak verbinding met internet en probeer het opnieuw.";
  }
  if (has("failed to fetch", "networkerror", "load failed", "fetch failed", "network request failed") || code === "request_timeout") {
    return "Geen verbinding met de server. Controleer je internet en probeer het opnieuw.";
  }
  if (code === "invalid_credentials" || has("invalid login credentials")) return "E-mail of wachtwoord klopt niet.";
  if (code === "email_not_confirmed" || has("email not confirmed")) {
    return "Bevestig eerst je e-mailadres via de link in je inbox.";
  }
  if (code === "user_already_exists" || code === "email_exists" || has("already registered", "already been registered")) {
    return "Dit e-mailadres heeft al een account. Log in of vraag een nieuw wachtwoord aan.";
  }
  if (code === "same_password" || has("should be different from the old password")) {
    return "Kies een ander wachtwoord dan je huidige.";
  }
  if (code === "weak_password" || has("password is known to be weak", "weak password")) {
    return "Dit wachtwoord is te makkelijk te raden. Kies een langer of minder bekend wachtwoord.";
  }
  if (has("password should be at least", "password should contain")) {
    const n = msg.match(/at least (\d+)/i)?.[1];
    return n ? `Je wachtwoord moet minimaal ${n} tekens zijn.` : "Je wachtwoord voldoet niet aan de eisen. Kies een langer wachtwoord.";
  }
  if (code === "over_email_send_rate_limit" || has("email rate limit")) {
    return "Er zijn net te veel mails verstuurd. Wacht een paar minuten en probeer het opnieuw.";
  }
  if (has("for security purposes")) {
    const s = msg.match(/after (\d+) seconds?/i)?.[1];
    return s ? `Wacht nog ${s} seconden voordat je het opnieuw probeert.` : "Wacht even voordat je het opnieuw probeert.";
  }
  if (code === "over_request_rate_limit" || code === "over_sms_send_rate_limit" || has("rate limit", "too many requests")) {
    return "Te veel pogingen achter elkaar. Wacht een minuut en probeer het opnieuw.";
  }
  if (code === "session_not_found" || code === "session_expired" || has("auth session missing", "session not found", "jwt expired")) {
    return "Je sessie is verlopen. Log opnieuw in.";
  }
  if (code === "otp_expired" || has("link is invalid", "invalid or has expired", "token has expired")) {
    return "Deze link is verlopen of al gebruikt. Vraag een nieuwe aan.";
  }
  if (code === "email_address_invalid" || has("unable to validate email", "invalid format") || (has("email address") && has("invalid"))) {
    return "Dit e-mailadres klopt niet. Controleer het en probeer het opnieuw.";
  }
  if (code === "otp_disabled" || has("signups not allowed for otp")) {
    return "Er is geen account met dit e-mailadres. Maak eerst een account.";
  }
  if (code === "signup_disabled" || has("signups not allowed")) return "Nieuwe accounts maken is op dit moment uitgeschakeld.";
  if (code === "user_not_found" || has("user not found")) return "Er is geen account met dit e-mailadres.";
  if (code === "reauthentication_needed" || has("reauthentication")) {
    return "Log voor de zekerheid opnieuw in en probeer het daarna nog eens.";
  }
  if (has("anonymous sign-ins are disabled", "missing email")) return "Vul je e-mailadres in.";

  if (msg && process.env.NODE_ENV !== "production") console.warn("Onvertaalde auth-fout:", code, msg);
  return "Er ging iets mis. Probeer het opnieuw.";
}
