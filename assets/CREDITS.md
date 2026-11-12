# Credits

Alle Grafiken und Schriften in „Highs & Lows“ sind entweder **CC0** (gemeinfrei),
**SIL Open Font License 1.1** oder selbst erstellt. Es wird nichts mit
„non-commercial“ oder unklarer Lizenz verwendet.

Die Original-ZIPs liegen nur lokal in `assets/_downloads/` (per `.gitignore`
ausgeschlossen). Im Spiel verwendete Ausschnitte liegen unter `src/assets/pixel/`.

## Grafik

| Pack | Autor | Link | Lizenz | Verwendet in |
| --- | --- | --- | --- | --- |
| Sunny Land | Luis Zuno (ansimuz) | https://ansimuz.itch.io/sunny-land-pixel-game-art | CC0 1.0 | `src/assets/pixel/sunny/` – Wiese, Dorf, Häuser, Bäume, Schilder, Adler |
| SunnyLand Woods | Luis Zuno (ansimuz) | https://ansimuz.itch.io/sunnyland-woods | CC0 1.0 | `src/assets/pixel/woods/` – Wolken, Berge, Wald-Parallax, Baumkronen, Äste |
| Caverns Environment | Luis Zuno (ansimuz) | https://ansimuz.itch.io/caverns-environment | CC0 1.0 | `src/assets/pixel/caverns/` – Fels-Tiles und Höhlenhintergrund |
| Warped Caves | Luis Zuno (ansimuz) | https://ansimuz.itch.io/warped-caves | CC0 1.0 | `src/assets/pixel/warped/` – Kristall-/Pilzhöhle, Stalaktiten, Pflanzen (teils umgefärbt für Lava-Zone) |

CC0 verlangt keine Namensnennung – wir nennen den Autor trotzdem gern.

## Schriften

| Schrift | Autor | Link | Lizenz |
| --- | --- | --- | --- |
| Pixelify Sans | Stefie Justprince | https://fonts.google.com/specimen/Pixelify+Sans | SIL OFL 1.1 |
| Silkscreen | Jason Kottke | https://fonts.google.com/specimen/Silkscreen | SIL OFL 1.1 |

Eingebunden über die npm-Pakete `@fontsource/pixelify-sans` und `@fontsource/silkscreen`.

## Eigene Grafiken

Selbst erstellt für dieses Projekt (gleiche Lizenz wie das Projekt):

- Spielfigur Forscher (mit Stirnlampe, Seil) und Heißluftballon mit Brennerflamme – `src/pixel/sprites.ts`
- Fledermäuse, Glühwürmchen, Tropfen, Flugzeug, Sterne, Partikel-Effekte (Feuerwerk, Kristallglühen), Tier-Icons – `src/pixel/sprites.ts`, `src/pixel/world.ts`
- Himmelsverlauf, Erdschichten, Wurzeln, Lavasee und Schichtübergänge (prozedural) – `src/pixel/world.ts`
- Panel-, Knopf- und Feldrahmen (9-Slice) – `src/assets/pixel/frames/`, erzeugt mit `scripts/pixel-frames.py`
