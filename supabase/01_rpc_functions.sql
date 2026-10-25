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
alter table public.dbmerge_sessions enable row level security;
revoke all on public.dbmerge_sessions from anon, authenticated;

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

create or replace function public._dbmerge_new_session(p_license_id text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_token text := encode(gen_random_bytes(32), 'hex');
begin
  delete from dbmerge_sessions where expires_at < now();
  insert into dbmerge_sessions (token_hash, license_id)
  values (_dbmerge_token_hash(v_token), p_license_id);
  return to_jsonb(v_token);
end $$;

-- 토큰으로 사용자 확인. 실패 시 errcode 28000 (앱에서 로그아웃 처리)
create or replace function public._dbmerge_auth(p_token text)
returns public.dbmerge_licenses
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v dbmerge_licenses;
begin
  select l.* into v
  from dbmerge_sessions s
  join dbmerge_licenses l on l.id::text = s.license_id
  where s.token_hash = _dbmerge_token_hash(p_token)
    and s.expires_at > now();

  if not found then
    raise exception '로그인이 필요합니다.' using errcode = '28000';
  end if;
  if v.status = 'blocked' then
    raise exception '사용이 차단된 계정입니다. 관리자에게 문의하세요.' using errcode = '28000';
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

  insert into dbmerge_licenses (name, phone, password, machine_id, is_admin, status, quota, used, charge_count)
  values (p_name, p_phone, crypt(p_password, gen_salt('bf')), coalesce(p_machine_id, ''), false, 'active', 300, 0, 0)
  returning * into v;

  return jsonb_build_object('token', _dbmerge_new_session(v.id::text), 'profile', _dbmerge_profile(v));
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
  if not coalesce(v.is_admin, false)
     and coalesce(v.machine_id, '') <> ''
     and v.machine_id <> coalesce(p_machine_id, '') then
    raise exception E'다른 기기에서 등록된 계정입니다.\n기기 변경이 필요하면 관리자에게 기기 초기화를 요청하세요.';
  end if;

  update dbmerge_licenses set
    -- 기존 SHA-256 해시는 bcrypt로 교체
    password   = case when v.password like '$2%' then password else crypt(p_password, gen_salt('bf')) end,
    -- 최초 로그인 또는 기기 초기화 후 첫 로그인 → 현재 기기 등록
    machine_id = case when not coalesce(v.is_admin, false) and coalesce(v.machine_id, '') = ''
                      then coalesce(p_machine_id, '') else machine_id end
  where id = v.id
  returning * into v;

  return jsonb_build_object('token', _dbmerge_new_session(v.id::text), 'profile', _dbmerge_profile(v));
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
revoke all on function public._dbmerge_new_session(text)                         from public, anon, authenticated;
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
