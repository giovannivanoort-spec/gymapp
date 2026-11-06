package nl.myspotter.app.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import java.text.NumberFormat;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import nl.myspotter.app.MainActivity;
import nl.myspotter.app.R;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Widget op het startscherm: stappen van vandaag tegen je doel, de slaap van afgelopen nacht en je
 * volgende training. 2x2, uit te rekken tot 4x2 (vanaf 250dp breed de brede indeling).
 *
 * De widget haalt zelf niets op. De site in de app stuurt een momentopname via SpotterWidgetPlugin
 * (src/lib/native/widget.ts), die hier in SharedPreferences staat. Dit bestand tekent alleen. Zonder
 * momentopname (nooit geopend, of uitgelogd): "Open Spotter om te synchroniseren".
 *
 * Een snapshot is van één moment. Na middernacht horen de stappen niet meer bij vandaag en wordt
 * "Morgen" "Vandaag": daarom één niet-wekkend alarm vlak na middernacht dat alleen opnieuw tekent
 * (geen updatePeriodMillis; nieuwe gegevens komen alleen uit de app).
 *
 * Formaat van de momentopname (versie 1, zie WidgetSnapshot in src/lib/native/widget.ts):
 * { v: 1, updatedAt: ms, date: "YYYY-MM-DD", steps: number|null, stepGoal: number,
 *   sleep: { date, minutes } | null, trainings: [{ date, title, group }] }
 */
public class SpotterWidgetProvider extends AppWidgetProvider {

    private static final String PREFS = "spotter_widget";
    private static final String KEY_SNAPSHOT = "snapshot";
    private static final String ACTION_NEW_DAY = "nl.myspotter.app.widget.NEW_DAY";
    /** Tik op de widget: MainActivity met deze URL; de site gaat dan naar Home (appUrlOpen). */
    private static final String OPEN_URL = "nl.myspotter.app://widget";
    /** Vanaf deze breedte (dp) de brede indeling (4x2). */
    private static final float WIDE_MIN_WIDTH_DP = 250f;
    private static final int PROGRESS_MAX = 1000;

    private static final Locale NL = Locale.forLanguageTag("nl-NL");
    private static final String[] DAYS = { "ma", "di", "wo", "do", "vr", "za", "zo" };
    private static final String[] MONTHS = { "jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec" };

    // ─────────────── Opslag ───────────────

    /** Bewaart de momentopname (null = vergeten). */
    static void saveSnapshot(Context ctx, String json) {
        SharedPreferences.Editor e = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        if (json == null) e.remove(KEY_SNAPSHOT);
        else e.putString(KEY_SNAPSHOT, json);
        e.commit();
    }

    private static Snapshot loadSnapshot(Context ctx) {
        String json = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SNAPSHOT, null);
        return json == null ? null : Snapshot.parse(json);
    }

    /** Aantal geplaatste widgets op het startscherm. */
    static int widgetCount(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        if (mgr == null) return 0;
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, SpotterWidgetProvider.class));
        return ids == null ? 0 : ids.length;
    }

    /** Tekent alle geplaatste widgets opnieuw. Geeft het aantal geplaatste widgets terug. */
    static int updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        if (mgr == null) return 0;
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, SpotterWidgetProvider.class));
        if (ids == null || ids.length == 0) return 0;
        Snapshot s = loadSnapshot(ctx);
        for (int id : ids) render(ctx, mgr, id, s);
        scheduleNewDay(ctx);
        return ids.length;
    }

    // ─────────────── Levenscyclus ───────────────

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        Snapshot s = loadSnapshot(ctx);
        for (int id : ids) render(ctx, mgr, id, s);
        scheduleNewDay(ctx);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle options) {
        render(ctx, mgr, id, loadSnapshot(ctx));
    }

    /** Laatste widget verwijderd: geen gezondheidsgegevens (stappen, slaap) op het toestel laten staan. */
    @Override
    public void onDisabled(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am != null) am.cancel(newDayIntent(ctx));
        saveSnapshot(ctx, null);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (ACTION_NEW_DAY.equals(intent.getAction())) {
            updateAll(ctx);
            return;
        }
        super.onReceive(ctx, intent);
    }

    // ─────────────── Middernacht ───────────────

    private static PendingIntent newDayIntent(Context ctx) {
        Intent i = new Intent(ctx, SpotterWidgetProvider.class).setAction(ACTION_NEW_DAY);
        return PendingIntent.getBroadcast(ctx, 1, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Eén minuut na middernacht opnieuw tekenen. Niet-wekkend en niet exact: geen extra recht nodig. */
    private static void scheduleNewDay(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am == null) return;
        ZoneId zone = ZoneId.systemDefault();
        long at = LocalDate.now(zone).plusDays(1).atStartOfDay(zone).plusMinutes(1).toInstant().toEpochMilli();
        am.set(AlarmManager.RTC, at, newDayIntent(ctx));
    }

    // ─────────────── Tekenen ───────────────

    private static void render(Context ctx, AppWidgetManager mgr, int id, Snapshot s) {
        LocalDate today = LocalDate.now();
        RemoteViews views;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12+: de launcher kiest zelf de indeling die past (ook tijdens het uitrekken).
            Map<SizeF, RemoteViews> sizes = new HashMap<>();
            sizes.put(new SizeF(100f, 80f), build(ctx, s, today, false));
            sizes.put(new SizeF(WIDE_MIN_WIDTH_DP, 80f), build(ctx, s, today, true));
            views = new RemoteViews(sizes);
        } else {
            Bundle o = mgr.getAppWidgetOptions(id);
            int minWidth = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            views = build(ctx, s, today, minWidth >= WIDE_MIN_WIDTH_DP);
        }
        mgr.updateAppWidget(id, views);
    }

    private static RemoteViews build(Context ctx, Snapshot s, LocalDate today, boolean wide) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), wide ? R.layout.widget_wide : R.layout.widget_small);
        v.setOnClickPendingIntent(android.R.id.background, openApp(ctx));

        if (s == null) {
            v.setViewVisibility(R.id.widget_content, View.GONE);
            v.setViewVisibility(R.id.widget_placeholder, View.VISIBLE);
            return v;
        }
        v.setViewVisibility(R.id.widget_content, View.VISIBLE);
        v.setViewVisibility(R.id.widget_placeholder, View.GONE);

        // Stappen: alleen als de momentopname van vandaag is.
        NumberFormat nf = NumberFormat.getIntegerInstance(NL);
        boolean stepsToday = s.steps != null && today.toString().equals(s.date);
        String goal = nf.format(s.stepGoal);
        if (stepsToday) {
            v.setTextViewText(R.id.widget_steps, nf.format(s.steps));
            int progress = s.stepGoal > 0 ? (int) Math.min(PROGRESS_MAX, (long) s.steps * PROGRESS_MAX / s.stepGoal) : 0;
            v.setProgressBar(R.id.widget_steps_bar, PROGRESS_MAX, progress, false);
            boolean reached = s.stepGoal > 0 && s.steps >= s.stepGoal;
            v.setTextViewText(R.id.widget_steps_goal, wide ? (reached ? "Doel van " + goal + " gehaald" : "van " + goal + " stappen") : "/ " + goal);
        } else {
            v.setTextViewText(R.id.widget_steps, "–");
            v.setProgressBar(R.id.widget_steps_bar, PROGRESS_MAX, 0, false);
            v.setTextViewText(R.id.widget_steps_goal, wide ? "van " + goal + " stappen" : "/ " + goal);
        }

        // Slaap: de nacht van vandaag (wakker geworden vandaag), anders die van gisteren.
        String sleepLabel = "Slaap";
        String sleepValue = "–";
        if (s.sleepMinutes != null && s.sleepDate != null) {
            if (s.sleepDate.equals(today.toString())) {
                sleepLabel = wide ? "Slaap vannacht" : "Slaap";
                sleepValue = formatDuration(s.sleepMinutes);
            } else if (s.sleepDate.equals(today.minusDays(1).toString())) {
                sleepLabel = "Slaap · gisteren";
                sleepValue = formatDuration(s.sleepMinutes);
            }
        }
        v.setTextViewText(R.id.widget_sleep_label, sleepLabel);
        v.setTextViewText(R.id.widget_sleep, sleepValue);

        // Volgende training (vandaag of later).
        Training next = null;
        for (Training t : s.trainings) {
            LocalDate d = parseDate(t.date);
            if (d != null && !d.isBefore(today)) {
                next = t;
                break;
            }
        }
        if (next != null) {
            v.setViewVisibility(R.id.widget_training_when, View.VISIBLE);
            v.setTextViewText(R.id.widget_training_when, dayLabel(parseDate(next.date), today));
            v.setTextViewText(R.id.widget_training, next.title);
        } else {
            v.setViewVisibility(R.id.widget_training_when, View.GONE);
            v.setTextViewText(R.id.widget_training, "Geen training gepland");
        }

        v.setTextViewText(R.id.widget_updated, updatedLabel(s.updatedAt, today));
        return v;
    }

    private static PendingIntent openApp(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse(OPEN_URL))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // ─────────────── Opmaak (gelijk aan de site) ───────────────

    /** "7 u 24 min", "8 u", "45 min" (zoals formatSleepDuration in src/lib/sleep.ts). */
    private static String formatDuration(int minutes) {
        int m = Math.max(0, minutes);
        int h = m / 60;
        int rest = m % 60;
        if (h == 0) return rest + " min";
        return rest == 0 ? h + " u" : h + " u " + rest + " min";
    }

    /** "Vandaag", "Morgen" of "do 12 nov". */
    private static String dayLabel(LocalDate d, LocalDate today) {
        if (d.equals(today)) return "Vandaag";
        if (d.equals(today.plusDays(1))) return "Morgen";
        return DAYS[d.getDayOfWeek().getValue() - 1] + " " + d.getDayOfMonth() + " " + MONTHS[d.getMonthValue() - 1];
    }

    /** "Bijgewerkt 08:15", "Bijgewerkt gisteren 21:10" of "Bijgewerkt 4 nov 21:10". */
    private static String updatedLabel(long ms, LocalDate today) {
        if (ms <= 0) return "";
        ZonedDateTime t = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault());
        String time = String.format(Locale.ROOT, "%02d:%02d", t.getHour(), t.getMinute());
        LocalDate d = t.toLocalDate();
        if (d.equals(today)) return "Bijgewerkt " + time;
        if (d.equals(today.minusDays(1))) return "Bijgewerkt gisteren " + time;
        return "Bijgewerkt " + d.getDayOfMonth() + " " + MONTHS[d.getMonthValue() - 1] + " " + time;
    }

    private static LocalDate parseDate(String iso) {
        if (iso == null) return null;
        try {
            return LocalDate.parse(iso);
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    // ─────────────── Momentopname ───────────────

    private static final class Training {
        final String date;
        final String title;

        Training(String date, String title) {
            this.date = date;
            this.title = title;
        }
    }

    private static final class Snapshot {
        long updatedAt;
        String date;
        Integer steps;
        int stepGoal;
        String sleepDate;
        Integer sleepMinutes;
        final List<Training> trainings = new ArrayList<>();

        static Snapshot parse(String json) {
            try {
                JSONObject o = new JSONObject(json);
                Snapshot s = new Snapshot();
                s.updatedAt = o.optLong("updatedAt", 0);
                s.date = o.optString("date", "");
                s.steps = o.isNull("steps") ? null : Math.max(0, o.optInt("steps", 0));
                s.stepGoal = Math.max(0, o.optInt("stepGoal", 0));
                JSONObject sleep = o.optJSONObject("sleep");
                if (sleep != null && !sleep.isNull("minutes")) {
                    s.sleepDate = sleep.optString("date", null);
                    s.sleepMinutes = sleep.optInt("minutes", 0);
                }
                JSONArray list = o.optJSONArray("trainings");
                if (list != null) {
                    for (int i = 0; i < list.length() && i < 5; i++) {
                        JSONObject t = list.optJSONObject(i);
                        if (t == null) continue;
                        String title = t.optString("title", "").trim();
                        if (title.isEmpty()) continue;
                        s.trainings.add(new Training(t.optString("date", ""), title));
                    }
                }
                return s;
            } catch (JSONException e) {
                return null;
            }
        }
    }
}
