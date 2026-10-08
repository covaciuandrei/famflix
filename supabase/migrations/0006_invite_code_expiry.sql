-- ============================================================================
--  FamFlix — invite codes last 24 hours, then change by themselves.
--  Run this after 0005_score_reactions.sql. Existing codes get 24 hours from now.
-- ============================================================================

alter table public.groups
  add column if not exists invite_code_expires_at timestamptz not null
  default now() + interval '24 hours';

-- Members get the new code the next time they look; the app calls this before showing codes.
create or replace function public.refresh_invite_codes()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.groups g
  set invite_code = public.new_invite_code(),
      invite_code_expires_at = now() + interval '24 hours'
  where g.invite_code_expires_at <= now()
    and public.is_group_member(g.id, auth.uid());
end;
$$;

create or replace function public.join_group(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  g_id      uuid;
  g_expires timestamptz;
begin
  select id, invite_code_expires_at into g_id, g_expires
  from public.groups
  where invite_code = upper(trim(p_invite_code));

  if g_id is null then
    raise exception 'Invalid invite code';
  end if;
  if g_expires <= now() then
    raise exception 'This invite code has expired. Ask the family for the new one';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (g_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return g_id;
end;
$$;

-- A new code also starts a new 24 hours. Only this, not the daily change, goes in the feed.
create or replace function public.regenerate_invite_code(p_group uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := public.new_invite_code();
begin
  if not public.is_group_owner(p_group, auth.uid()) then
    raise exception 'Only the family owner can do this';
  end if;
  update public.groups
  set invite_code = v_code,
      invite_code_expires_at = now() + interval '24 hours'
  where id = p_group;
  perform public.add_activity(p_group, 'new_code');
  return v_code;
end;
$$;

create or replace function public.groups_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    perform public.add_activity(new.id, 'renamed', null, null, null, new.name);
  end if;
  return null;
end;
$$;

revoke execute on function public.refresh_invite_codes() from public, anon;
grant execute on function public.refresh_invite_codes() to authenticated;
