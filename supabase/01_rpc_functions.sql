-- 1단계: 로그인·건수 차감·사용 기록을 서버 함수(RPC)로 처리. 추가만 하므로 기존 앱은 계속 동작함
--
-- 적용: Supabase 대시보드 → SQL Editor에 붙여넣고 실행 (여러 번 실행해도 안전)
-- 순서: 이 파일 → 새 앱 배포 → 02_lockdown.sql

create extension if not exists pgcrypto with schema extensions;

-- ── 세션 ──────────────────────────────────────────────────────
-- 토큰 원문은 브라우저에만 있고, DB에는 SHA-256 해시만 저장
create table if not exists public.dbmerge_sessions (
  token_hash text primary key,
  license_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
-- 세션이 만들어진 기기. 관리자가 기기를 해제하면 그 기기의 세션도 무효가 됨
alter table public.dbmerge_sessions add column if not exists machine_id text not null default '';
alter table public.dbmerge_sessions enable row level security;
revoke all on public.dbmerge_sessions from anon, authenticated;

-- ── 기기 (계정별 접속 가능 컴퓨터) ────────────────────────────
-- 최대 대수는 관리자 콘솔에서 계정별로 설정 (기본 1대)
alter table public.dbmerge_licenses add column if not exists max_devices integer not null default 1;

create table if not exists public.dbmerge_devices (
  license_id text not null,
  machine_id text not null,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (license_id, machine_id)
);
alter table public.dbmerge_devices enable row level security;
revoke all on public.dbmerge_devices from anon, authenticated;

-- 이전 방식(계정당 machine_id 1개)으로 등록된 기기를 옮긴 뒤 비움 (반복 실행해도 안전)
insert into public.dbmerge_devices (license_id, machine_id)
select id::text, machine_id from public.dbmerge_licenses where coalesce(machine_id, '') <> ''
on conflict do nothing;
update public.dbmerge_licenses set machine_id = '' where coalesce(machine_id, '') <> '';

-- ── 내부 함수 (anon 호출 불가) ────────────────────────────────

create or replace function public._dbmerge_token_hash(p_token text)
returns text
language sql immutable
set search_path = public, extensions
as $$ select encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') $$;

create or replace function public._dbmerge_profile(v public.dbmerge_licenses)
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'id',       v.id::text,
    'name',     v.name,
    'phone',    v.phone,
    'is_admin', coalesce(v.is_admin, false),
    'quota',    coalesce(v.quota, 0),
    'used',     coalesce(v.used, 0)
  )
$$;

drop function if exists public._dbmerge_new_session(text);
create or replace function public._dbmerge_new_session(p_license_id text, p_machine_id text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_token text := encode(gen_random_bytes(32), 'hex');
begin
  delete from dbmerge_sessions where expires_at < now();
  insert into dbmerge_sessions (token_hash, license_id, machine_id)
  values (_dbmerge_token_hash(v_token), p_license_id, coalesce(p_machine_id, ''));
  return to_jsonb(v_token);
end $$;

-- 일반 사용자 기기 확인: 등록된 기기면 접속 시각 갱신, 새 기기면 최대 대수 안에서만 등록
create or replace function public._dbmerge_use_device(v public.dbmerge_licenses, p_machine_id text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  mid text := coalesce(p_machine_id, '');
  n   int;
  lim int;
begin
  if mid = '' then
    raise exception '기기 정보를 확인할 수 없습니다. 브라우저를 새로고침한 뒤 다시 시도하세요.';
  end if;

  update dbmerge_devices set last_seen = now() where license_id = v.id::text and machine_id = mid;
  if found then
    return;
  end if;

  -- 같은 계정으로 동시에 새 기기 등록 시 대수를 넘지 않도록 계정 행을 잠그고 최신 최대 대수를 읽음
  select coalesce(max_devices, 1) into lim from dbmerge_licenses where id = v.id for update;
  select count(*) into n from dbmerge_devices where license_id = v.id::text;
  if n >= lim then
    raise exception E'등록 가능한 컴퓨터 수(%대)를 초과했습니다.\n다른 컴퓨터에서 쓰려면 관리자에게 기기 해제를 요청하세요.', lim;
  end if;
  insert into dbmerge_devices (license_id, machine_id) values (v.id::text, mid);
end $$;

-- 토큰으로 사용자 확인. 실패 시 errcode 28000 (앱에서 로그아웃 처리)
create or replace function public._dbmerge_auth(p_token text)
returns public.dbmerge_licenses
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v   dbmerge_licenses;
  mid text;
begin
  select s.machine_id into mid
  from dbmerge_sessions s
  where s.token_hash = _dbmerge_token_hash(p_token)
    and s.expires_at > now();
  if found then
    select l.* into v
    from dbmerge_sessions s
    join dbmerge_licenses l on l.id::text = s.license_id
    where s.token_hash = _dbmerge_token_hash(p_token);
  end if;

  if v.id is null then
    raise exception '로그인이 필요합니다.' using errcode = '28000';
  end if;
  if v.status = 'blocked' then
    raise exception '사용이 차단된 계정입니다. 관리자에게 문의하세요.' using errcode = '28000';
  end if;
  -- 관리자가 해제한 기기의 세션은 무효 (슈퍼어드민 제외)
  if not coalesce(v.is_admin, false)
     and not exists (select 1 from dbmerge_devices where license_id = v.id::text and machine_id = mid) then
    raise exception '등록이 해제된 기기입니다. 다시 로그인하세요.' using errcode = '28000';
  end if;
  return v;
end $$;

-- ── 계정 ──────────────────────────────────────────────────────

create or replace function public.dbmerge_register(p_name text, p_phone text, p_password text, p_machine_id text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v dbmerge_licenses;
begin
  p_name  := btrim(coalesce(p_name, ''));
  p_phone := btrim(coalesce(p_phone, ''));
  if p_name = '' or p_phone = '' then
    raise exception '모든 항목을 입력하세요.';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception '비밀번호는 6자 이상이어야 합니다.';
  end if;
  if exists (select 1 from dbmerge_licenses where phone = p_phone) then
    raise exception '이미 등록된 전화번호입니다.';
  end if;

  insert into dbmerge_licenses (name, phone, password, is_admin, status, quota, used, charge_count)
  values (p_name, p_phone, crypt(p_password, gen_salt('bf')), false, 'active', 300, 0, 0)
  returning * into v;
  perform _dbmerge_use_device(v, p_machine_id);

  return jsonb_build_object('token', _dbmerge_new_session(v.id::text, p_machine_id), 'profile', _dbmerge_profile(v));
end $$;

create or replace function public.dbmerge_login(p_phone text, p_password text, p_machine_id text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v  dbmerge_licenses;
  ok boolean := false;
begin
  p_phone    := btrim(coalesce(p_phone, ''));
  p_password := coalesce(p_password, '');

  select * into v from dbmerge_licenses where phone = p_phone limit 1;
  if found then
    if v.password like '$2%' then
      ok := v.password = crypt(p_password, v.password);
    else
      -- 기존 방식: SHA-256(전화번호 + 비밀번호). 관리자 콘솔 PW초기화도 이 방식
      ok := v.password = encode(digest(p_phone || p_password, 'sha256'), 'hex');
    end if;
  end if;
  if not ok then
    raise exception '전화번호 또는 비밀번호가 올바르지 않습니다.';
  end if;

  if v.status = 'blocked' then
    raise exception '사용이 차단된 계정입니다. 관리자에게 문의하세요.';
  end if;

  -- 슈퍼어드민은 기기 제한 없음
  if not coalesce(v.is_admin, false) then
    perform _dbmerge_use_device(v, p_machine_id);
  end if;

  -- 기존 SHA-256 해시는 bcrypt로 교체
  if v.password not like '$2%' then
    update dbmerge_licenses set password = crypt(p_password, gen_salt('bf')) where id = v.id
    returning * into v;
  end if;

  return jsonb_build_object('token', _dbmerge_new_session(v.id::text, p_machine_id), 'profile', _dbmerge_profile(v));
end $$;

create or replace function public.dbmerge_me(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  return _dbmerge_profile(_dbmerge_auth(p_token));
end $$;

create or replace function public.dbmerge_logout(p_token text)
returns void
language sql security definer
set search_path = public, extensions
as $$ delete from dbmerge_sessions where token_hash = _dbmerge_token_hash(p_token) $$;

-- ── 엑셀받기 건수 차감 ────────────────────────────────────────

-- 엑셀받기 때 정제결과 행 수(p_unique)만큼 건수를 차감하고 사용 기록을 남긴 뒤 기록 ID 반환 (연락처는 저장하지 않음)
create or replace function public.dbmerge_start_job(
  p_token text, p_total int, p_unique int, p_duplicate int, p_converted int, p_error int, p_file_names jsonb
)
returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v         dbmerge_licenses := _dbmerge_auth(p_token);
  v_job_id  text;
  remaining int;
begin
  if p_unique is null or p_unique < 0 then
    raise exception '잘못된 건수입니다.';
  end if;

  if not coalesce(v.is_admin, false) then
    -- 조건부 UPDATE로 동시 요청에도 잔여 건수를 넘지 않게 차감
    update dbmerge_licenses set used = used + p_unique
    where id = v.id and used + p_unique <= quota;
    if not found then
      select quota - used into remaining from dbmerge_licenses where id = v.id;
      raise exception E'잔여 건수가 부족합니다.\n잔여: %건  /  필요: %건',
        to_char(remaining, 'FM999,999,999,990'), to_char(p_unique, 'FM999,999,999,990');
    end if;
  end if;

  -- 컬럼 타입(text/uuid, text[]/jsonb)에 상관없이 넣기 위해 jsonb_populate_record 사용
  insert into dbmerge_jobs (user_id, total, unique_count, duplicate, converted, error, file_names)
  select r.user_id, r.total, r.unique_count, r.duplicate, r.converted, r.error, r.file_names
  from jsonb_populate_record(null::dbmerge_jobs, jsonb_build_object(
    'user_id',      v.id::text,
    'total',        p_total,
    'unique_count', p_unique,
    'duplicate',    p_duplicate,
    'converted',    p_converted,
    'error',        p_error,
    'file_names',   coalesce(p_file_names, '[]'::jsonb)
  )) r
  returning id::text into v_job_id;

  return v_job_id;
end $$;

-- ── 이력 조회 ─────────────────────────────────────────────────

create or replace function public.dbmerge_get_jobs(p_token text)
returns setof public.dbmerge_jobs
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v dbmerge_licenses := _dbmerge_auth(p_token);
begin
  return query
    select * from dbmerge_jobs where user_id::text = v.id::text order by created_at desc;
end $$;

-- ── 권한 ──────────────────────────────────────────────────────
-- Supabase는 새 함수를 anon에게 기본 허용하므로 내부 함수는 명시적으로 회수
revoke all on function public._dbmerge_token_hash(text)                          from public, anon, authenticated;
revoke all on function public._dbmerge_profile(public.dbmerge_licenses)          from public, anon, authenticated;
revoke all on function public._dbmerge_new_session(text, text)                   from public, anon, authenticated;
revoke all on function public._dbmerge_use_device(public.dbmerge_licenses, text) from public, anon, authenticated;
revoke all on function public._dbmerge_auth(text)                                from public, anon, authenticated;

revoke all on function public.dbmerge_register(text, text, text, text)                    from public;
revoke all on function public.dbmerge_login(text, text, text)                             from public;
revoke all on function public.dbmerge_me(text)                                            from public;
revoke all on function public.dbmerge_logout(text)                                        from public;
revoke all on function public.dbmerge_start_job(text, int, int, int, int, int, jsonb)    from public;
revoke all on function public.dbmerge_get_jobs(text)                                      from public;

grant execute on function public.dbmerge_register(text, text, text, text)                 to anon, authenticated;
grant execute on function public.dbmerge_login(text, text, text)                          to anon, authenticated;
grant execute on function public.dbmerge_me(text)                                         to anon, authenticated;
grant execute on function public.dbmerge_logout(text)                                     to anon, authenticated;
grant execute on function public.dbmerge_start_job(text, int, int, int, int, int, jsonb) to anon, authenticated;
grant execute on function public.dbmerge_get_jobs(text)                                   to anon, authenticated;
