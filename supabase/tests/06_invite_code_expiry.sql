\set ON_ERROR_STOP 1
\set as_ana    'reset role; select set_config(''request.jwt.claim.sub'', ''aaaaaaaa-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_bogdan 'reset role; select set_config(''request.jwt.claim.sub'', ''bbbbbbbb-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_elena  'reset role; select set_config(''request.jwt.claim.sub'', ''eeeeeeee-0000-0000-0000-000000000005'', false); set role authenticated;'
\set as_anon   'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set grp '(select v::uuid from test.vals where k = ''expiry'')'
\set code '(select invite_code from public.groups where id = (select v::uuid from test.vals where k = ''expiry''))'

reset role;
select test.expect_eq((select count(*) from public.groups where invite_code_expires_at between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute'),
                      (select count(*) from public.groups), 'existing families got 24 hours for their current code');

:as_ana
select public.create_group('Expiry');
reset role;
insert into test.vals select 'expiry', id::text from public.groups where name = 'Expiry';
insert into test.vals select 'expiry_code', invite_code from public.groups where name = 'Expiry';
select test.expect_eq((select invite_code_expires_at > now() + interval '23 hours 59 minutes' from public.groups where id = :grp), true, 'a new family''s code lasts 24 hours');

:as_elena
select public.join_group((select v from test.vals where k = 'expiry_code'));
select test.expect_eq(public.is_group_member(:grp, 'eeeeeeee-0000-0000-0000-000000000005'), true, 'a fresh code works');

-- 25 hours later
reset role;
update public.groups set invite_code_expires_at = now() - interval '1 hour' where id = :grp;

:as_bogdan
select test.expect_error($$select public.join_group((select v from test.vals where k = 'expiry_code'))$$, 'has expired');
select public.refresh_invite_codes();
reset role;
select test.expect_eq(:code, (select v from test.vals where k = 'expiry_code'), 'someone outside the family can''t change its code');

:as_ana
select test.expect_error($$update public.groups set invite_code_expires_at = now() + interval '10 days'
  where id = (select v::uuid from test.vals where k = 'expiry')$$, 'permission denied');

:as_elena
select public.refresh_invite_codes();
reset role;
select test.expect_eq(:code <> (select v from test.vals where k = 'expiry_code') and :code ~ '^[A-HJ-NP-Z2-9]{8}$', true, 'a member looking at the family gets a new 8-character code');
select test.expect_eq((select invite_code_expires_at > now() + interval '23 hours 59 minutes' from public.groups where id = :grp), true, 'the new code lasts 24 hours');
select test.expect_eq((select count(*) from public.activity where group_id = :grp and kind = 'new_code'), 0::bigint, 'the daily change isn''t posted in the feed');
insert into test.vals select 'expiry_code2', invite_code from public.groups where id = (select v::uuid from test.vals where k = 'expiry');

:as_ana
select public.refresh_invite_codes();
reset role;
select test.expect_eq(:code, (select v from test.vals where k = 'expiry_code2'), 'a code that hasn''t expired stays the same');

:as_bogdan
select test.expect_eq(public.join_group((select v from test.vals where k = 'expiry_code')), null::uuid, 'the old code no longer works');
select public.join_group(lower((select v from test.vals where k = 'expiry_code2')));
select test.expect_eq(public.is_group_member(:grp, 'bbbbbbbb-0000-0000-0000-000000000002'), true, 'the new code works (any letter case)');

:as_ana
select public.regenerate_invite_code(:grp);
reset role;
select test.expect_eq(:code <> (select v from test.vals where k = 'expiry_code2'), true, 'owner''s New code still works');
select test.expect_eq((select invite_code_expires_at > now() + interval '23 hours 59 minutes' from public.groups where id = :grp), true, 'New code starts a fresh 24 hours');
select test.expect_eq((select count(*) from public.activity where group_id = :grp and kind = 'new_code'), 1::bigint, 'New code is still posted in the feed once');
select test.expect_eq((select count(*) from public.activity where group_id = :grp and kind = 'renamed'), 0::bigint, 'no rename noise from code changes');

:as_anon
select test.expect_error($$select public.refresh_invite_codes()$$, 'permission denied');

select 'INVITE CODE EXPIRY: ALL PASSED' as result;
