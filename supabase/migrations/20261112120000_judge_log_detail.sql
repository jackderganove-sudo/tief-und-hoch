-- Fehlermeldung bei kind = 'error' (gekürzt, nie Header oder Key) – zur Fehlersuche ohne Log-Zugriff.
alter table public.ai_judge_log add column detail text check (char_length(detail) <= 400);
