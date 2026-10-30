-- 새 Supabase 프로젝트용: dbmerge 테이블 생성. 빈 프로젝트에서 01·02보다 먼저 한 번 실행
--
-- 순서: 00_schema.sql → 01_rpc_functions.sql → 02_lockdown.sql
-- 테이블은 RLS를 켜고 정책을 두지 않으므로, 브라우저는 01의 서버 함수로만 접근할 수 있음

create table if not exists public.dbmerge_licenses (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  phone         text not null unique,
  password      text not null,
  computer_name text,
  machine_id    text not null default '',   -- 이전 방식(1대) 호환용. 기기 목록은 dbmerge_devices
  max_devices   integer not null default 1,
  can_store     boolean not null default false,   -- DB 저장(주소록 정리) 권한
  is_admin      boolean not null default false,
  status        text not null default 'active' check (status in ('pending', 'active', 'blocked')),
  quota         integer not null default 300,
  used          integer not null default 0,
  charge_count  integer not null default 0,
  registered_at timestamptz not null default now()
);

create table if not exists public.dbmerge_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,
  total        integer not null default 0,
  unique_count integer not null default 0,
  duplicate    integer not null default 0,
  converted    integer not null default 0,
  error        integer not null default 0,
  file_names   text[] not null default '{}',
  created_at   timestamptz not null default now()
);
create index if not exists dbmerge_jobs_user_id_idx on public.dbmerge_jobs (user_id, created_at desc);

alter table public.dbmerge_licenses enable row level security;
alter table public.dbmerge_jobs     enable row level security;
