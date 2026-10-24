-- 로컬 테스트용: Supabase 기본 역할·권한과 현재 dbmerge 테이블 구조를 재현 (실제 DB에는 실행하지 말 것)

-- Supabase 기본 역할
-- 역할은 클러스터 전체에 공유되므로 이미 있으면 건너뜀 (테스트 반복 실행)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase는 public 스키마의 새 테이블·함수 권한을 anon에게 기본 부여함
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

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
