/** Kennung des Builds (Commit-SHA in CI) – siehe vite.config.ts. */
declare const __BUILD_ID__: string;

/** Voller Commit-SHA (nur in CI, sonst leer). */
declare const __COMMIT__: string;

/** Zeitpunkt des Builds (ISO). */
declare const __BUILD_TIME__: string;
