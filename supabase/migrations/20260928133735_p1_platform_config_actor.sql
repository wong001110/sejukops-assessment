-- Platform configuration has a separate authority from business ADMIN.
-- This function is callable only by the server service role. The server must
-- first bind p_actor_profile_id to a verified Supabase Auth user.
create or replace function public.ai_assert_config_actor(p_actor_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
      and p.auth_user_id is not null
      and p.platform_role = 'SUPER_ADMIN'
      and p.active
  ) then
    raise exception 'INVALID_PLATFORM_ACTOR' using errcode = 'P0001';
  end if;
  return true;
end;
$$;

revoke all on function public.ai_assert_config_actor(uuid) from public, anon, authenticated;
grant execute on function public.ai_assert_config_actor(uuid) to service_role;

-- The assessment RLS policy exposed every null-order audit row, including
-- technical AI observations, to any authenticated user. Keep audit reads
-- server-only until business and platform events have separate scoped rules.
drop policy if exists audit_read_scoped on public.audit_logs;
revoke all on public.audit_logs from public, anon, authenticated;
