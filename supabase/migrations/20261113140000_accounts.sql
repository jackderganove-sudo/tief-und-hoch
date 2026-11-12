-- Optionale Konten: Profil (Spielername, Avatar) und synchronisierter Fortschritt.
-- Spielen bleibt anonym möglich; ein Login „upgradet“ das anonyme Konto (gleiche user_id).
--
-- RLS: Jeder liest/ändert nur seine eigenen Daten. Spielernamen + Avatar sind öffentlich lesbar
-- (für den späteren Freunde-Modus), sonst nichts.

-- ---------------------------------------------------------------- Profile

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar smallint not null default 0 check (avatar between 0 and 11),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_name_unique on public.profiles (lower(display_name));
alter table public.profiles enable row level security;

/** Spielername prüfen: 3–20 Zeichen, Buchstaben/Ziffern/Leerzeichen/._-, keine Beleidigungen. */
create function public.display_name_ok(p_name text) returns boolean
  language plpgsql immutable set search_path = ''
as $$
declare
  n text := lower(translate(p_name, '013457@$', 'oieastas'));
  bad text[] := array[
    'arsch', 'fick', 'fotze', 'hure', 'nutte', 'wichser', 'schlampe', 'spast', 'missgeburt', 'hurensohn', 'nazi', 'hitler',
    'kanake', 'neger', 'schwuchtel', 'opfer', 'penner',
    'fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'retard', 'rape', 'porn', 'sex',
    'admin', 'moderator', 'support'
  ];
  w text;
begin
  if p_name is null or p_name !~ '^[A-Za-z0-9ÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß ._-]{1,18}[A-Za-z0-9ÄÖÜäöüß]$' then
    return false;
  end if;
  foreach w in array bad loop
    if position(w in replace(replace(replace(n, ' ', ''), '.', ''), '_', '')) > 0 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

alter table public.profiles add constraint profiles_name_ok check (public.display_name_ok(display_name));

create policy "Spielernamen sind öffentlich" on public.profiles for select to anon, authenticated using (true);
create policy "Eigenes Profil anlegen" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Eigenes Profil ändern" on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Eigenes Profil löschen" on public.profiles for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.profiles from anon, authenticated;
grant select (user_id, display_name, avatar) on table public.profiles to anon, authenticated;
grant insert (user_id, display_name, avatar), update (display_name, avatar, updated_at), delete on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

-- ---------------------------------------------------------------- Fortschritt (Sync)

-- Ein Snapshot pro Spieler: Tagesspielstände (letzte 30 Tage), Verlauf je Modus, Einstellungen.
-- localStorage bleibt der Offline-Cache; zusammengeführt wird im Client (src/domain/progressSync.ts).
create table public.player_progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  constraint player_progress_size check (pg_column_size(snapshot) < 400000)
);
alter table public.player_progress enable row level security;

create policy "Eigenen Fortschritt lesen" on public.player_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy "Eigenen Fortschritt speichern" on public.player_progress for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Eigenen Fortschritt ändern" on public.player_progress for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on table public.player_progress from anon, authenticated;
grant select, insert, update on table public.player_progress to authenticated;
grant all on table public.player_progress to service_role;

-- ---------------------------------------------------------------- Konto löschen

-- Beim Löschen eines Kontos (auth.users) verschwinden per ON DELETE CASCADE: submissions,
-- ai_judge_log, admins, profiles, player_progress. Verweise in Prüf-Daten werden NULL.
-- Gelöscht wird über die Edge Function delete-account (prüft das JWT des Spielers).
