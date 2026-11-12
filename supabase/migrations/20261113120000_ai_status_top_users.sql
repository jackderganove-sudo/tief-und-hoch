-- Admin-Statusanzeige: KI-Prüfungen heute pro Spieler (Top 5) und Limits.
create or replace function public.admin_ai_status() returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  since timestamptz := date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'nur für Admins' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'checks_today', count(*) filter (where kind = 'model'),
    'errors_today', count(*) filter (where kind = 'error'),
    'limited_today', count(*) filter (where kind = 'limited'),
    'cache_today', count(*) filter (where kind = 'cache'),
    'avg_ms_today', round(avg(ms) filter (where kind = 'model')),
    'last_model', (select l.model from public.ai_judge_log l where l.kind = 'model' and l.model is not null order by l.created_at desc limit 1),
    'primary_quota_hit_at', (select max(l.created_at) from public.ai_judge_log l where l.primary_status = 429 and l.created_at >= since),
    'unchecked_open', (select count(*) from public.ai_verdicts v where v.review_status = 'unchecked'),
    'top_users', coalesce((
      select jsonb_agg(t order by t.checks desc)
      from (
        select l.user_id,
               left(l.user_id::text, 8) as short_id,
               exists (select 1 from public.admins a where a.user_id = l.user_id) as is_admin,
               coalesce((u.raw_app_meta_data ->> 'provider'), 'anonym') as provider,
               count(*) filter (where l.kind = 'model') as checks,
               count(*) filter (where l.kind = 'limited') as limited
        from public.ai_judge_log l
        left join auth.users u on u.id = l.user_id
        where l.created_at >= since and l.user_id is not null
        group by l.user_id, u.raw_app_meta_data
        order by checks desc
        limit 5
      ) t
    ), '[]'::jsonb)
  )
  into result
  from public.ai_judge_log
  where created_at >= since;
  return result;
end;
$$;
