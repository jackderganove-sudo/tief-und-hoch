# Tief & Hoch

Tägliches Wort-/Trivia-Spiel mit zwei Modi:

- **Abstieg (RARE):** Je seltener die Antwort, desto tiefer geht es in die Höhle.
  Moos 10 · Stein 30 · Kristall 60 · Glut 85 · Kern 100 · Sonderstufe „Zu schlau“ 15
- **Aufstieg (COMMON):** Je häufiger die Antwort, desto höher steigt der Ballon.
  Wiese 10 · Baumwipfel 30 · Wolken 60 · Abendrot 85 · Sterne 100

Jeden Tag 7 Fragen pro Modus, 25 Sekunden pro Frage, eine Antwort. 1 Punkt = 10 m.
Tageswechsel um Mitternacht Europe/Berlin.

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

### Debug-Modus (nur Dev-Server)

<http://localhost:5173/?debug=1> öffnen. Unten links erscheint ein Panel:

- **◀ Tag / Heute / Tag ▶** verschiebt den Spieltag (andere Tagesfragen, Serien testen).
  Die Verschiebung bleibt über Reloads erhalten, solange `?debug=1` in der URL steht.
- **Tagesfortschritt zurücksetzen** löscht den Spielstand des angezeigten Tages
  (Abstieg, Aufstieg oder beide), damit man ihn erneut spielen kann.
- **Statistik & Serien löschen** setzt Gespielt/Bestwert/Serie zurück.

Im Produktions-Build (`npm run build`) ist der Debug-Code nicht enthalten, auch nicht mit `?debug=1`.

## Neue Fragen hinzufügen

1. Paket als JSON anlegen, z. B. `packs/meine-fragen.json`:

   ```json
   {
     "lang": "de",
     "mode": "rare",
     "questions": [
       {
         "id": "de-rare-kontinent",
         "prompt": "Nenne einen Kontinent",
         "answers": [
           "Europa=90",
           "Afrika=70",
           "Nordamerika|Amerika=50",
           { "text": "Antarktis", "aliases": ["Antarktika"], "baseScore": 8, "tooClever": true },
           "Australien|Ozeanien=30"
         ]
       }
     ]
   }
   ```

   - Antworten als Objekt `{ text, aliases[], baseScore, tooClever? }` oder in Kurzform
     `"Text|Alias|Alias=Score"`; ein `!` am Ende markiert `tooClever` (`"Saarland=12!"`).
   - `baseScore` = geschätzte Häufigkeit 0–100 (100 = die Antwort, die jeder sagt).
   - `id` ist optional; ohne ID wird eine aus Sprache, Modus und Prompt erzeugt.
   - `lang`/`mode` können auch pro Frage stehen.

2. Erst probeweise, dann echt importieren:

   ```bash
   npm run import-questions -- packs/meine-fragen.json --dry-run
   npm run import-questions -- packs/meine-fragen.json
   ```

   Das Skript prüft das Paket (Pflichtfelder, Wertebereiche, doppelte Schreibweisen,
   ob „Kern“/„Sterne“ erreichbar sind), sortiert die Antworten und schreibt nach
   `src/data/questions/<lang>/<mode>.json`. Bestehende IDs werden übersprungen,
   mit `--replace` überschrieben. `--verbose` zeigt zusätzlich sehr ähnliche
   Schreibweisen, die bei Tippfehlern verwechselt werden könnten.

Hinweis: Die Tagesauswahl hängt vom Fragen-Pool ab. Wer neue Fragen hinzufügt,
verändert die Auswahl künftiger Tage – alle Spieler mit demselben Stand sehen aber
weiterhin dieselben Fragen.

## Aufbau

```
src/
  domain/      reine Logik ohne React (getestet)
               normalize · levenshtein · matchAnswer · scoring · daily · share
  data/        Fragen als JSON (vom Import-Skript erzeugt)
  services/    Interfaces + lokale Implementierungen
               QuestionRepository · ScoreService · ProgressRepository
               index.ts = die eine Stelle, an der die Implementierungen gewählt werden
  game/        useGame (Ablauf, Speichern, Fortsetzen), Tages-/Countdown-Hooks
  components/  Szenen (Höhle, Himmel), Timer, Höhenmesser, Stufen-Einblendung
  screens/     Start, Spiel, Ergebnis
  i18n/        de.json, en.json (react-i18next)
scripts/       import-questions.ts
packs/         Beispiel-Pakete (Quelle der 80 Testfragen)
```

**Antwortprüfung:** Eingabe und Antworten werden normalisiert (Kleinschreibung,
ä→ae, ö→oe, ü→ue, ß→ss, Akzente, Satzzeichen, Leerzeichen). Exakte Treffer
(inkl. Aliase) gewinnen immer. Sonst greift Levenshtein mit einer Toleranz nach
Wortlänge (≤3: 0, ≤5: 1, ≤9: 2, sonst 3). Knappe Treffer werden beim Tippen als
„Gemeint: …?“ angezeigt und als diese Antwort gewertet.

**Tagesauswahl:** Der Pool wird nach ID sortiert und pro „Runde“ mit einem Seed aus
Sprache, Modus und Rundennummer gemischt. Tag *n* nimmt die nächsten 7 Positionen.
So kommt jede Frage erst wieder, wenn alle anderen dran waren.

**Spielstand:** `localStorage` (`tuh:v1:…`): Tages-Spielstand pro Modus, Statistik,
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
