# Credits

Alle Grafiken und Schriften in „Highs & Lows“ sind entweder **CC0** (gemeinfrei),
**CC-BY 3.0** (mit Namensnennung, siehe unten), **SIL Open Font License 1.1** oder selbst
erstellt. Es wird nichts mit „non-commercial“ oder unklarer Lizenz verwendet.

Die Original-ZIPs liegen nur lokal in `assets/_downloads/` (per `.gitignore`
ausgeschlossen). Im Spiel verwendete Ausschnitte liegen unter `src/assets/pixel/`.

## Grafik

| Pack | Autor | Link | Lizenz | Verwendet in |
| --- | --- | --- | --- | --- |
| Sunny Land | Luis Zuno (ansimuz) | https://ansimuz.itch.io/sunny-land-pixel-game-art | CC0 1.0 | `src/assets/pixel/sunny/` – Wiese, Dorf, Häuser, Bäume, Schilder, Adler |
| SunnyLand Woods | Luis Zuno (ansimuz) | https://ansimuz.itch.io/sunnyland-woods | CC0 1.0 | `src/assets/pixel/woods/` – Wolken, Berge, Wald-Parallax, Baumkronen, Äste |
| Caverns Environment | Luis Zuno (ansimuz) | https://ansimuz.itch.io/caverns-environment | CC0 1.0 | `src/assets/pixel/caverns/` – Fels-Tiles und Höhlenhintergrund |
| Warped Caves | Luis Zuno (ansimuz) | https://ansimuz.itch.io/warped-caves | CC0 1.0 | `src/assets/pixel/warped/` – Kristall-/Pilzhöhle, Stalaktiten, Pflanzen (teils umgefärbt für Lava-Zone) |
| Grotto Escape II – Environment | Luis Zuno (ansimuz) | https://opengameart.org/content/grotto-escape-ii-environment | **CC-BY 3.0** | `src/assets/pixel/hell/lavafall.png`, `lavasurface.png` – Lavafall am Übergang zur Hölle |
| 16x16 and animated lava tile (45 frames) | davesch | https://opengameart.org/content/16x16-and-animated-lava-tile-45-frames | CC0 1.0 | `src/assets/pixel/hell/lavatile.png` – Feuerseen (für Eis-/Kristall-Hölle umgefärbt) |
| Red Demons [Animated] – Classic Hero Edit | Umz (nach GrafxKid) | https://opengameart.org/content/red-demons-animated-classic-hero-edit | CC0 1.0 | `src/assets/pixel/hell/imp.png` – winkende Teufelchen (2 Frames, je Ebene umgefärbt) |
| Smoke & Fire Animated Particle [16x16] | KnoblePersona | https://opengameart.org/content/smoke-fire-animated-particle-16x16 | **CC-BY 3.0** | `src/assets/pixel/hell/smoke-fire.png` – Schwefeldampf (umgefärbt) |
| 16x16 Torch | Spring Spring | https://opengameart.org/content/16x16-torch | CC0 1.0 | `src/assets/pixel/hell/torch.png` – Fackeln/Feuerschalen |
| Misc. Dark Fantasy Scenery Sprites | ETTiNGRiNDER | https://opengameart.org/content/misc-dark-fantasy-scenery-sprites | CC0 1.0 | `src/assets/pixel/hell/chain.png` – nur das Kettenglied |
| Tiny Magic Glyphs | Emcee Flesher | https://opengameart.org/content/tiny-magic-glyphs | CC0 1.0 (dual mit OGA-BY 3.0, wir nutzen CC0) | `src/assets/pixel/hell/glyphs.png` – glühende Runen |
| Magic Cliffs Environment | Luis Zuno (ansimuz) | https://opengameart.org/content/magic-cliffs-environment | CC0 1.0 | `src/assets/pixel/heaven/island-*.png`, `rock-*.png`, `clouds.png` – Wolkeninseln und Wolkendecke (gold/weiß umgefärbt) |
| Classical Temple Tiles | surt | https://opengameart.org/content/classical-temple-tiles | CC0 1.0 | `src/assets/pixel/heaven/temple.png`, `columns.png` – schwebender Tempel, Säulen, Himmelstor |
| Angel | Spring Spring | https://opengameart.org/node/98027 | CC0 1.0 | `src/assets/pixel/heaven/angel.png` – Engelchen, die mitfliegen |
| Space Background | Luis Zuno (ansimuz) | https://opengameart.org/content/space-background-3 | CC0 1.0 | `src/assets/pixel/space/` – Weltraum über dem Himmel |
| Pixel Planets | Master484 | https://opengameart.org/content/pixel-planets | CC0 1.0 | `src/assets/pixel/space/planets.png` – Planeten (rund ausgeschnitten) |

CC0 verlangt keine Namensnennung – wir nennen den Autor trotzdem gern.

**Namensnennung (CC-BY 3.0):** „Grotto Escape II – Environment“ von Luis Zuno (ansimuz) und
„Smoke & Fire Animated Particle [16x16]“ von KnoblePersona, beide CC-BY 3.0
(https://creativecommons.org/licenses/by/3.0/) – Ausschnitte verwendet, teils umgefärbt.

Geprüft, aber nicht verwendet (Lizenz unpassend): Heaven Asset Pack (keybari-t, nur nicht-kommerziell),
Hell Asset Pack (myaumya, Mindestpreis, keine Weitergabe), Hell Tile Set (canadianjoker) und Floating
Island Tileset (monkeyimage, ohne Lizenz), Gothicvania Volcanic Area (ansimuz, kostenpflichtig).

Die Ausschnitte erzeugt `python3 scripts/extract-world-assets.py` aus den Original-ZIPs.

## Schriften

| Schrift | Autor | Link | Lizenz |
| --- | --- | --- | --- |
| Pixelify Sans | Stefie Justprince | https://fonts.google.com/specimen/Pixelify+Sans | SIL OFL 1.1 |
| Silkscreen | Jason Kottke | https://fonts.google.com/specimen/Silkscreen | SIL OFL 1.1 |
| Jersey 10 (nur Ziffern 0–9) | The Soft Type Project Authors | https://github.com/scfried/soft-type-jersey | SIL OFL 1.1 |

Eingebunden über die npm-Pakete `@fontsource/pixelify-sans`, `@fontsource/silkscreen` und `@fontsource/jersey-10`.

## Eigene Grafiken

Selbst erstellt für dieses Projekt (gleiche Lizenz wie das Projekt):

- Spielfigur Forscher (mit Stirnlampe, Seil) und Heißluftballon mit Brennerflamme – `src/pixel/sprites.ts`
- Fledermäuse, Glühwürmchen, Tropfen, Flugzeug, Sterne, Partikel-Effekte (Feuerwerk, Kristallglühen), Tier-Icons – `src/pixel/sprites.ts`, `src/pixel/world.ts`
- Himmelsverlauf, Erdschichten, Wurzeln und Schichtübergänge (prozedural) – `src/pixel/world.ts`
- Hölle: Basalt-/Obsidiansäulen mit Glutadern, Felsdecke mit Lava-Tropfsteinen, ferne Höhlenwand mit Feuerseen und Lavafällen, große Lavafälle mit Becken, Runentore, Käfige und Laternen an Ketten, fliegende Teufelchen (Flügel), Flammengeister, Schwefelschwaden, Vordergrund-Felsen, Höllentor mit Hörnern (prozedural) – `src/pixel/hell.ts`
- Endlose Tiefen: Eis-Hölle (Eiswände, Eiszapfen, erstarrte Lavafälle, blaues Feuer), Kristall-Hölle (Kristallsäulen mit Spiegelung, Splitter), Abgrund (Leuchtquallen, Leuchtpilze, Ranken, ferne Lichter; schwebende Ruinen aus umgefärbten Magic-Cliffs- und Classical-Temple-Grafiken, beide CC0, siehe oben) – `src/pixel/deep.ts`
- Himmel: Lichtstrahlen, Regenbogenbrücken, Perlentor mit Heiligenschein, Lichtwesen, Kristallwolken, Polarlicht (prozedural) – `src/pixel/heaven.ts`
- Mittlerer Himmel: Haufenwolken in vier Parallax-Ebenen, Federwolken, Windlinien, Wolkenmeer, ferne Berggipfel mit Wolkenschatten, Vogelschwärme, zweites Flugzeug mit Kondensstreifen, mehrfarbige Wolkenbänke im Abendrot, Kristallinseln, Perlmuttwolken mit Regenbogensaum, Lichtfächer, Halo mit Nebensonnen (prozedural) – `src/pixel/heaven.ts`
- Lebendige Welt: Windböen mit Wirbeln, Vordergrund-Wolken, ausweichende und landende Vögel, Engelchen-Schleife, Wolkendecken-Nebel und Tropfen, abbröckelnde Kristallsplitter (`src/pixel/skyFx.ts`, `heaven.ts`); Tropfen und Spritzer, Fledermausschwarm, Funken, Kristall-Glanz, Sporen, Lava-Blubbern, Kragsteine und Simse unter allem, was steht (`src/pixel/caveFx.ts`, `hell.ts`, `deep.ts`) – alles selbst gezeichnet
- Panel-, Knopf- und Feldrahmen (9-Slice) – `src/assets/pixel/frames/`, erzeugt mit `scripts/pixel-frames.py`
