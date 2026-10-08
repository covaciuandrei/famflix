-- ============================================================================
--  FamFlix — your score sets your like/dislike: over 7 likes the title,
--  under 6 dislikes it, 6 to 7 leaves your reaction alone.
--  Run this after 0004_decimal_scores.sql. Existing scores are not touched.
-- ============================================================================

create or replace function public.react_to_score()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only scores you gave yourself (not ones filled in for you), and only when the score changes,
  -- so editing just the note keeps a reaction you picked by hand.
  if new.score is null or new.rated_by is distinct from new.user_id then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.score is not distinct from old.score then
    return null;
  end if;

  if new.score > 7 or new.score < 6 then
    insert into public.reactions (list_item_id, user_id, value)
    values (new.list_item_id, new.user_id,
            case when new.score > 7 then 'like' else 'dislike' end)
    on conflict (list_item_id, user_id) do update set value = excluded.value;
  end if;
  return null;
end;
$$;

drop trigger if exists ratings_react_to_score on public.ratings;
create trigger ratings_react_to_score
  after insert or update of score on public.ratings
  for each row execute function public.react_to_score();
