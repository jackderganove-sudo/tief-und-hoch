-- Admin-Dashboard: Räume im Freunde-Modus ansehen, beenden, Spieler im Raum sperren.
-- Alles SECURITY DEFINER mit is_admin()-Prüfung und Protokoll in admin_log.

create function public.admin_rooms() returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(x order by x ->> 'last_activity_at' desc)
    from (
      select jsonb_build_object(
        'id', r.id,
        'code', r.code,
        'status', r.status,
        'index', r.current_index,
        'count', r.question_count,
        'round', r.round,
        'mode', r.settings ->> 'mode',
        'scoring', r.settings ->> 'scoring',
        'source', r.settings ->> 'source',
        'created_at', r.created_at,
        'last_activity_at', r.last_activity_at,
        'host', (select p.name from public.room_players p where p.room_id = r.id and p.user_id = r.host_id),
        'players', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', p.user_id,
            'name', p.name,
            'avatar', p.avatar,
            'online', p.last_seen > now() - interval '45 seconds',
            'host', p.user_id = r.host_id,
            'banned', public.is_banned(p.user_id)
          ) order by p.joined_at)
          from public.room_players p where p.room_id = r.id and not p.kicked
        ), '[]'::jsonb)
      ) as x
      from public.rooms r
      where r.last_activity_at > now() - interval '2 hours'
    ) t
  ), '[]'::jsonb);
end;
$$;

create function public.admin_end_room(p_room uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  c text;
begin
  perform public.require_admin();
  update public.rooms
  set status = 'finished', phase_ends_at = null, ended_by_admin = true, version = version + 1, last_activity_at = now()
  where id = p_room
  returning code into c;
  perform public.log_admin('room.end', c, null);
end;
$$;

-- Spieler aus dem Raum entfernen und (optional) sperren
create function public.admin_room_ban(p_room uuid, p_user uuid, p_reason text default null) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.room_players set kicked = true where room_id = p_room and user_id = p_user;
  update public.rooms set version = version + 1, last_activity_at = now(),
    host_id = case when host_id = p_user then (select p.user_id from public.room_players p where p.room_id = p_room and not p.kicked order by p.joined_at limit 1) else host_id end
  where id = p_room;
  perform public.admin_set_ban(p_user, true, coalesce(p_reason, 'Freunde-Modus'));
end;
$$;

-- Übersicht: aktive Räume und Spieler darin
create or replace function public.admin_room_counts() returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'active', (select count(*) from public.rooms where last_activity_at > now() - interval '10 minutes' and status <> 'finished'),
    'players_online', (select count(*) from public.room_players p join public.rooms r on r.id = p.room_id
                       where not p.kicked and p.last_seen > now() - interval '45 seconds'),
    'today', (select count(*) from public.rooms where created_at >= date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')
  );
end;
$$;

revoke all on function public.admin_rooms(), public.admin_end_room(uuid), public.admin_room_ban(uuid, uuid, text), public.admin_room_counts() from public, anon;
grant execute on function public.admin_rooms(), public.admin_end_room(uuid), public.admin_room_ban(uuid, uuid, text), public.admin_room_counts() to authenticated;
