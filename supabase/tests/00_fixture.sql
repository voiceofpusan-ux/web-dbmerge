-- 로컬 테스트용: 기존(삭제 전) 프로젝트의 dbmerge 테이블과 "anon all" 정책을 재현 (실제 DB에는 실행하지 말 것)

\ir supabase_env.sql

-- 앱 코드(lib/license.ts, lib/db.ts)에서 쓰는 컬럼 기준으로 재구성
create table public.dbmerge_licenses (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  phone         text,
  password      text,
  computer_name text,
  machine_id    text default '',
  is_admin      boolean default false,
  status        text default 'active',
  quota         integer default 300,
  used          integer default 0,
  charge_count  integer default 0,
  registered_at timestamptz default now()
);

create table public.dbmerge_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      text,
  total        integer,
  unique_count integer,
  duplicate    integer,
  converted    integer,
  error        integer,
  file_names   text[],
  created_at   timestamptz default now()
);

create table public.dbmerge_rows (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references public.dbmerge_jobs(id),
  user_id     text,
  grp text, name text, orig_name text, name_remark text, long_name text,
  phone text, fixed_phone text, memo text, orig_phone text, source text, remark text,
  address text, party_type text, note1 text, note2 text, note3 text, note4 text, note5 text
);

alter table public.dbmerge_licenses enable row level security;
alter table public.dbmerge_jobs     enable row level security;
alter table public.dbmerge_rows     enable row level security;
create policy "anon all licenses" on public.dbmerge_licenses for all to anon using (true) with check (true);
create policy "anon all jobs"     on public.dbmerge_jobs     for all to anon using (true) with check (true);
create policy "anon all rows"     on public.dbmerge_rows     for all to anon using (true) with check (true);
