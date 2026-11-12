# Highs & Lows

Tägliches Wort-/Trivia-Spiel mit zwei Modi:

- **Abstieg (RARE):** Je seltener die Antwort, desto tiefer geht es in die Höhle.
  Moos 10 · Stein 30 · Kristall 60 · Glut 85 · Kern 100 · Sonderstufe „Zu schlau“ 15
- **Aufstieg (COMMON):** Je häufiger die Antwort, desto höher steigt der Ballon.
  Wiese 10 · Baumwipfel 30 · Wolken 60 · Abendrot 85 · Sterne 100

Jeden Tag 7 Fragen pro Modus, 25 Sekunden pro Frage, eine Antwort. 1 Punkt = 10 m.
Tageswechsel um Mitternacht Europe/Berlin.

## Pixel-Look

Die Welt wird auf einem Canvas in niedriger Auflösung gezeichnet und ganzzahlig
hochskaliert (`image-rendering: pixelated`). Sie ist nach Metern aufgebaut: im Abstieg
seilt sich ein Forscher mit Stirnlampe durch Erde, Felshöhle, Kristallhöhle, Pilzgrotte
bis zum Lavakern ab; im Aufstieg fährt ein Heißluftballon über Wiese, Baumwipfel, Wolken,
Abendrot bis zu den Sternen. Nach jeder Antwort bewegt sich die Figur sichtbar, die Stufe
löst einen passenden Effekt aus. Mit `prefers-reduced-motion` gibt es keine Fahrten,
Umgebungsanimationen oder fliegenden Partikel.

Grafiken: CC0-Packs von ansimuz plus eigene Sprites, Schriften Pixelify Sans und
Silkscreen (OFL) – alles aufgelistet in [assets/CREDITS.md](assets/CREDITS.md).
Rahmen und Knöpfe (9-Slice) erzeugt `scripts/pixel-frames.py`.

**Visuelle Kontrolle:** `npm run screenshots` spielt beide Modi mit Playwright durch
und legt Bilder (Mobil 390×844, Desktop 1440×900) in `screenshots/` ab
(`--only=mobile`, `--reduced` für reduzierte Bewegung). Im Dev-Server zeigt
`/?world=rare&m=3000` die Welt in einer bestimmten Tiefe/Höhe.

## Live-Testversion

**<https://playhighsandlows.github.io/>**

Jeder Push auf `main` baut und veröffentlicht die App über GitHub Actions
(`.github/workflows/deploy.yml`): `npm ci` → Tests → Fragen-Validierung → Build → GitHub Pages.
Schlägt ein Test oder die Validierung fehl, wird nicht veröffentlicht.

- Repo `playhighsandlows/playhighsandlows.github.io` → die App liegt im Wurzelverzeichnis (`/`).
- `/admin` und andere Pfade funktionieren auch beim direkten Aufruf: der Build kopiert
  `index.html` nach `404.html`.
- Solange im Workflow `VITE_ENABLE_DEBUG: 'true'` steht, ist das Debug-Panel auch live über
  [`?debug=1`](https://playhighsandlows.github.io/?debug=1) erreichbar.
  Zum Abschalten die Zeile im Workflow entfernen.

## Lokal starten

Voraussetzung: Node.js ≥ 20.

```bash
npm install
npm run dev
```

Dann <http://localhost:5173> öffnen. Der Dev-Server lauscht auch im WLAN
(`server.host: true`), d. h. Handy oder iPad im selben Netz können die
„Network“-Adresse aus der Konsole öffnen.

Weitere Befehle:

| Befehl | Zweck |
| --- | --- |
| `npm test` | Logik-Tests (Vitest) |
| `npm run typecheck` | TypeScript prüfen |
| `npm run build` | Produktions-Build nach `dist/` |
| `npm run preview` | Build lokal ansehen |
| `npm run import-questions -- <paket.json>` | Fragen-Paket importieren |
| `npm run validate-questions` | Alle gespeicherten Fragen prüfen |

### Debug-Modus

<http://localhost:5173/?debug=1> öffnen. Unten links erscheint ein Panel:

- **◀ Tag / Heute / Tag ▶** verschiebt den Spieltag (andere Tagesfragen, Serien testen).
  Die Verschiebung bleibt über Reloads erhalten, solange `?debug=1` in der URL steht.
- **Tagesfortschritt zurücksetzen** löscht den Spielstand des angezeigten Tages
  (Abstieg, Aufstieg oder beide), damit man ihn erneut spielen kann.
- **Statistik & Serien löschen** setzt Gespielt/Bestwert/Serie zurück.
- **Fragen Abstieg / Aufstieg** klappt die Tagesfragen des angezeigten Tages mit Thema
  und ID auf (zum Prüfen der Themen-Mischung).

In einem normalen Build (`npm run build`) ist der Debug-Code nicht enthalten, auch nicht mit `?debug=1`.
Nur ein Build mit `VITE_ENABLE_DEBUG=true` (die Live-Testversion) nimmt ihn mit auf.

## Fragen: Format, Themen, Import

Bestand: **600 Fragen** (300 Deutsch, 300 Englisch), je Sprache getrennt erstellt,
in 11 Themen: `food`, `animals`, `gaming`, `anime`, `music`, `general`, `geography`,
`sports`, `movies_tv`, `brands`, `everyday`. Die IDs sind in beiden Sprachen gleich,
die Anzeigenamen stehen in `src/i18n/de.json` / `en.json` unter `topics`.

Eine Datei pro Thema und Sprache: `src/data/questions/<lang>/<topic>.json`.

```json
{
  "id": "de-food-001",
  "lang": "de",
  "topic": "food",
  "prompt": "Nenne ein Nudelgericht",
  "modes": ["rare", "common"],
  "answers": [{ "text": "Lasagne", "aliases": ["Lasagna"], "baseScore": 70, "tooClever": true }]
}
```

### Neues Paket einfügen

1. Paket als JSON anlegen (Vorlage: `packs/example-pack.json`). Antworten als Objekt
   oder in Kurzform `"Text|Alias|Alias=Score"`, ein `!` am Ende markiert `tooClever`.
   `id` und `modes` dürfen fehlen: die ID wird fortlaufend vergeben (`de-food-029`),
   die Modi werden aus der Verteilung abgeleitet.
2. Erst probeweise, dann echt importieren:

   ```bash
   npm run import-questions -- packs/mein-paket.json --dry-run
   npm run import-questions -- packs/mein-paket.json
   ```

   Bestehende Fragen (gleiche ID oder gleicher Prompt) werden übersprungen, mit
   `--replace` überschrieben. Bei Fehlern wird nichts geschrieben.
3. `npm run validate-questions` prüft den ganzen Bestand und zeigt die Übersicht
   Fragen pro Thema / Sprache / Modus.

### Was die Validierung prüft (zod + eigene Regeln)

- Schema, bekannte Sprache/Thema/Modus, ID passt zu Sprache und Thema, IDs und Prompts eindeutig
- mindestens 20 Antworten, keine doppelte Schreibweise (Text oder Alias) in einer Frage
- plausible Verteilung: eine Antwort ≥ 40, höchstens 25 % der Antworten ≥ 60, mindestens 25 % ≤ 15
- `common` nur mit klarer Top-Antwort (eine ≥ 80, höchstens 5 Antworten ≥ 60)
- `rare` nur mit genug seltenen Antworten (mind. 8 mit ≤ 10, davon 3 mit ≤ 3)
- `tooClever`: höchstens 3, Hinweis wenn bei einer Rare-Frage keine markiert ist
- pro Sprache mindestens 7 Fragen je Modus, Hinweis bei weniger als 5 je Thema und Modus
- `--verbose` listet sehr ähnliche Schreibweisen, die bei Tippfehlern verwechselt werden könnten

Die `baseScore`-Werte sind Schätzungen. Hinweis: Wer Fragen hinzufügt, verändert die
Tagesauswahl künftiger Tage; alle Spieler mit demselben Stand sehen weiter dieselben Fragen.

## KI-Prüfung (Supabase + Gemini)

Antworten, die die lokale Prüfung (Liste, Aliase, Tippfehler) nicht kennt, prüft die
Supabase Edge Function `judge-answer` mit Gemini. Spieler brauchen keinen Key: das
Frontend kennt nur Supabase-URL und anon key, der Gemini-Key liegt als Supabase-Secret.

- **Anmeldung:** anonym (Supabase Anonymous Sign-In) – jeder Spieler hat eine ID.
- **Ablauf:** Cache auf dem Gerät (localStorage, wird bei neuer App-Version geleert) →
  Edge Function: Cache `ai_verdicts` → Limit (30 KI-Prüfungen pro Spieler in 24 h,
  1000 insgesamt) → Gemini (≈ 4,7 s, im Spiel max. 6 s mit Lade-Animation) → Urteil cachen.
  Fehler/Timeout/Limit: ungültig, aber „Konnte nicht geprüft werden“.
- **Wertung:** Abstieg nach geschätzter Häufigkeit, höchstens „Glut“ (85) – der Kern
  bleibt Listen-Antworten vorbehalten. Aufstieg: nicht in der Liste = „Wiese“ (10).
  Erkennt die KI eine Variante einer Listen-Antwort, zählt die Listen-Antwort.
- **Speichern:** jede Tagesantwort landet in `submissions` (Übung nicht).
- **Datenbank:** `supabase/migrations/` (RLS überall, Rechte explizit vergeben).
- **Ohne** `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` läuft alles rein lokal wie bisher.

```bash
cp .env.example .env.local                 # URL + anon key eintragen
npx supabase db push                       # Migrationen anwenden
npm run function-data                      # Fragen-Bundle der Funktion (nach Fragen-Änderungen)
npx supabase functions deploy judge-answer
npm run review-ai-answers                  # KI-Antworten sichten (über die CLI-Anmeldung)
node scripts/smoke-judge.mjs de-food-001 Mangold Gemüse     # Live-Test der Funktion
```

**Verbrauch:** jede Prüfung steht in `ai_judge_log` (`kind`: model/cache/list/limited/error, `ms`).
Im Supabase-SQL-Editor z. B.:
`select kind, count(*), round(avg(ms)) from ai_judge_log where created_at > now() - interval '1 day' group by kind;`

Modell: `gemini-3.8-flash` (genauer). Ist es nach 2 s nicht fertig oder scheitert (503 Überlastung),
läuft `gemini-3.5-flash-lite` parallel mit; 3.8 Flash gewinnt, wenn es bis 4,7 s antwortet.
`ai_verdicts.model` zeigt, welches Modell geurteilt hat.
Optionale Function-Secrets: `GEMINI_MODEL`, `GEMINI_THINKING` (`low`), `GEMINI_FALLBACK_MODEL`
(leer = kein Ersatz), `GEMINI_FALLBACK_THINKING` (`minimal`), `AI_USER_DAILY_LIMIT` (30), `AI_GLOBAL_DAILY_LIMIT` (1000).

## Admin-Bereich (KI-Antworten prüfen)

Versteckte Route **/admin** (nicht verlinkt), Login mit GitHub. Zugriff hat nur, wer in der
Tabelle `admins` steht – durchgesetzt per RLS in der Datenbank, nicht nur im Frontend.
Es gibt keinen geheimen Schlüssel im Frontend; Aktionen laufen über die SQL-Funktionen
`approve_verdict`, `reject_verdicts`, `reset_verdicts` (SECURITY INVOKER + `is_admin()`).

- **Freigeben:** Schreibweise, Aliase und baseScore anpassbar → `approved_answers`. Die App lädt
  diese beim Start (gecacht, offline der letzte Stand) und behandelt sie wie Listen-Antworten:
  normale Wertung, kein KI-Badge – sofort für alle, ohne Deployment.
- **Variante:** einer Listen-Antwort zuordnen (wird deren Alias).
- **Ablehnen:** Urteil wird ungültig, auch im Cache der Edge Function. Ein Revisionszähler
  (`app_meta`) lässt Geräte ihren lokalen KI-Cache verwerfen.
- Filter (Status, KI-Urteil, Sprache, Thema), Mehrfachauswahl, Tasten **↑/↓ A R X**.
- Bereits vergebene Punkte alter Runden ändern sich nicht.

```bash
npm run review-ai-answers -- --apply-approved --dry-run   # zeigt, was übernommen würde
npm run review-ai-answers -- --apply-approved             # Freigaben → Fragen-JSONs, in der DB "exportiert"
npm run test:rls                                          # RLS-Tests gegen das Projekt (mit Rollback)
```

## Als App installieren (PWA)

Manifest + Service Worker über `vite-plugin-pwa`: Chrome/Android bietet „App installieren“ an,
auf iPhone/iPad geht es über „Teilen → Zum Home-Bildschirm“ (Hinweis im Hilfe-Menü „?“).

- **Offline:** App-Shell, Code inkl. Fragen, Grafiken und Schriften liegen im Cache – die
  Tagesrunde startet auch ohne Netz. Supabase (KI-Prüfung, Datenbank, Login) wird nie gecacht;
  offline zeigt die KI-Prüfung „Konnte nicht geprüft werden“.
- **Updates:** neue Version → kleiner Hinweis „Neue Version – Neu laden“, nie während einer Runde,
  nie automatisch.
- **Icons:** `python3 scripts/make-icons.py [--preview]` zeichnet das Pixel-Icon (32er-Raster,
  nur ganzzahlig vergrößert) nach `public/icons/`, `public/apple-touch-icon.png`, `public/favicon-*.png`.

## Übungsmodus

Startseite → „∞ Übung“: Abstieg oder Aufstieg wählen, Themen per Checkbox („Alle Themen“
ist Standard), dann endlos spielen. Nichts davon wird gespeichert, es zählt nicht für
Serie oder Tagesergebnis. Die heutigen Tagesfragen kommen in der Übung nicht vor;
Fragen künftiger Tage können aber vorkommen. Die Themenauswahl (`TopicPicker`,
`TopicSelection`, `QuestionRepository.getQuestions`) ist eigenständig gebaut und für den
Freunde-Modus wiederverwendbar.

## Aufbau

```
src/
  domain/      reine Logik ohne React (getestet)
               normalize · levenshtein · matchAnswer · scoring · daily · share · quality
  data/        Fragen als JSON (vom Import-Skript erzeugt)
  services/    Interfaces + lokale Implementierungen
               QuestionRepository · ScoreService · ProgressRepository
               index.ts = die eine Stelle, an der die Implementierungen gewählt werden
  game/        useGame (Tagesspiel), usePractice (Übung), Tages-/Countdown-Hooks
  pixel/       Canvas-Welt (world.ts), eigene Sprites, Asset-Lader, PixelWorld-Komponente
  components/  Pixel-Bausteine (Panel, PxButton, TierIcon), Timer, Stufen-Einblendung, TopicPicker
  assets/pixel Sprites/Tiles aus den CC0-Packs + Rahmen
  screens/     Start, Spiel, Ergebnis, Übung
  i18n/        de.json, en.json (react-i18next)
scripts/       import-questions.ts · screenshots.mjs · pixel-frames.py
packs/         example-pack.json (Vorlage für eigene Pakete)
```

**Antwortprüfung:** Eingabe und Antworten werden normalisiert (Kleinschreibung,
ä→ae, ö→oe, ü→ue, ß→ss, Akzente, Satzzeichen, Leerzeichen). Exakte Treffer
(inkl. Aliase) gewinnen immer. Sonst greift Levenshtein mit einer Toleranz nach
Wortlänge (≤3: 0, ≤5: 1, ≤9: 2, sonst 3). Knappe Treffer werden beim Tippen als
„Gemeint: …?“ angezeigt und als diese Antwort gewertet.

**Tagesauswahl:** Pro Modus nur Fragen, deren `modes` den Modus enthält. Der Pool wird
nach ID sortiert und pro „Runde“ mit einem Seed aus Sprache, Modus und Rundennummer
gemischt (Rare und Common haben also verschiedene Seeds), dabei nach Themen gestreut.
Tag *n* nimmt die nächsten 7 Positionen; jede Tagesfrage hat ein anderes Thema, und
keine Frage kommt am selben Tag in beiden Modi vor. Eine Frage kommt in der Regel erst
wieder, wenn alle anderen dran waren.

**Spielstand:** `localStorage` (`hal:v1:…`): Tages-Spielstand pro Modus, Statistik,
Serie. Der Timer rechnet mit einem gespeicherten Startzeitpunkt, deshalb läuft er auch
über einen Reload weiter.

## Später: Backend

- **Phase 2 (Supabase):** `SupabaseScoreService` implementiert `ScoreService`.
  `submit()` speichert echte Antworten, `frequencyOf()` mischt `baseScore` mit dem
  echten Anteil, sobald eine Frage genug Antworten hat. Optional ein
  `SupabaseQuestionRepository` mit fester Tagesplanung. Austausch nur in
  `src/services/index.ts`.
- **Phase 3 (Freunde-Modus):** Raumcode, Echtzeit über Supabase Realtime, Wertung
  innerhalb der Gruppe – kann auf denselben Domain-Funktionen (`matchAnswer`,
  `tierFor`) aufsetzen.
