-- Retire the superseded anonymous/IP/user Demo admission and AI counters.
-- Guest visits and private.guest_ai_budget_* are the current mechanisms.
-- This migration is guarded for the prepared Test project. No CASCADE.
do $$
begin
  if to_regclass('private.demo_entry_policy') is null
     or to_regclass('private.demo_entry_counter') is null
     or to_regclass('private.demo_ai_policy') is null
     or to_regclass('private.demo_ai_counter') is null
     or to_regprocedure('private.demo_entry_reserve(text)') is null
     or to_regprocedure('public.demo_entry_reserve(text)') is null
     or to_regprocedure('private.demo_ai_reserve(uuid,uuid,text)') is null
     or to_regprocedure('public.demo_ai_reserve(uuid,uuid,text)') is null then
    raise exception 'Legacy Demo quota inventory changed; review before retirement';
  end if;
  if (select count(*) from private.demo_entry_policy) <> 1
     or (select count(*) from private.demo_entry_counter) <> 0
     or (select count(*) from private.demo_ai_policy) <> 1
     or (select count(*) from private.demo_ai_counter) <> 0 then
    raise exception 'Legacy Demo quota rows changed; review before retirement';
  end if;
end;
$$;

drop function public.demo_entry_reserve(text);
drop function public.demo_ai_reserve(uuid,uuid,text);
drop function private.demo_entry_reserve(text);
drop function private.demo_ai_reserve(uuid,uuid,text);
drop table private.demo_entry_counter;
drop table private.demo_entry_policy;
drop table private.demo_ai_counter;
drop table private.demo_ai_policy;
