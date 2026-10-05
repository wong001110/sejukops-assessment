-- Supabase access JWTs stay cryptographically valid after sign-out. MCP
-- checks that the signed session_id still has a live auth.sessions row.
create function private.mcp_session_active(p_auth_user_id uuid, p_session_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions s
    where s.id = p_session_id and s.user_id = p_auth_user_id
      and (s.not_after is null or s.not_after > now())
  );
$$;
create function public.mcp_session_active(p_auth_user_id uuid, p_session_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select private.mcp_session_active(p_auth_user_id, p_session_id);
$$;
revoke execute on function private.mcp_session_active(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.mcp_session_active(uuid,uuid) from public, anon, authenticated;
grant execute on function private.mcp_session_active(uuid,uuid) to service_role;
grant execute on function public.mcp_session_active(uuid,uuid) to service_role;
