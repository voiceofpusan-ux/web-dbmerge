-- 로컬 테스트용: Supabase 기본 역할·스키마·기본 권한을 재현 (실제 DB에는 실행하지 말 것)

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
