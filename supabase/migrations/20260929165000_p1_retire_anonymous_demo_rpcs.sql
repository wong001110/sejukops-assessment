-- One-click Guest visits replaced anonymous Supabase Auth provisioning and
-- persona selection. These old RPCs have no application callers. Keep
-- private.demo_ensure_technician: the current Demo reset still uses it.
do $$
begin
  if to_regprocedure('public.demo_provision_user(uuid,public.app_role)') is null
     or to_regprocedure('private.demo_provision_user(uuid,public.app_role)') is null
     or to_regprocedure('public.demo_select_persona(public.app_role)') is null
     or to_regprocedure('private.demo_select_persona(public.app_role)') is null then
    raise exception 'Anonymous Demo RPC inventory changed; review before retirement';
  end if;
end;
$$;

drop function public.demo_provision_user(uuid,public.app_role);
drop function public.demo_select_persona(public.app_role);
drop function private.demo_provision_user(uuid,public.app_role);
drop function private.demo_select_persona(public.app_role);
