-- 1단계: 로그인·건수 차감·작업 저장을 서버 함수(RPC)로 옮김. 추가만 하므로 기존 앱은 계속 동작함
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

-- 함수에서 job_id::text로 비교하므로 같은 식으로 인덱스 생성 (job_id가 uuid든 text든 동작)
create index if not exists dbmerge_rows_job_id_text_idx on public.dbmerge_rows ((job_id::text));

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

-- 작업 소유자 확인 후 잠금
create or replace function public._dbmerge_own_job(v public.dbmerge_licenses, p_job_id text)
returns public.dbmerge_jobs
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  j dbmerge_jobs;
begin
  select * into j from dbmerge_jobs
  where id::text = p_job_id and user_id::text = v.id::text
  for update;
  if not found then
    raise exception '작업을 찾을 수 없습니다.';
  end if;
  return j;
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

-- ── 작업 저장 ─────────────────────────────────────────────────

-- 정제결과 행 수(p_unique)만큼 건수를 차감하고 작업을 만든 뒤 작업 ID 반환
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

-- 행 묶음 저장. 차감한 건수(unique_count)를 넘게 저장할 수 없음
create or replace function public.dbmerge_add_rows(p_token text, p_job_id text, p_rows jsonb)
returns int
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  j     dbmerge_jobs := _dbmerge_own_job(_dbmerge_auth(p_token), p_job_id);
  n     int := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  saved int;
begin
  select count(*) into saved from dbmerge_rows where job_id::text = j.id::text;
  if saved + n > coalesce(j.unique_count, 0) then
    raise exception '차감한 건수보다 많은 행을 저장할 수 없습니다.';
  end if;

  -- id·job_id·user_id는 서버에서 채움 (요청에 들어온 값은 형 변환 전에 제거)
  insert into dbmerge_rows (job_id, user_id, grp, name, orig_name, name_remark, long_name, phone, fixed_phone,
                            memo, orig_phone, source, remark, address, party_type, note1, note2, note3, note4, note5)
  select j.id, j.user_id, r.grp, r.name, r.orig_name, r.name_remark, r.long_name, r.phone, r.fixed_phone,
         r.memo, r.orig_phone, r.source, r.remark, r.address, r.party_type, r.note1, r.note2, r.note3, r.note4, r.note5
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e,
       jsonb_populate_record(null::dbmerge_rows, e - 'id' - 'job_id' - 'user_id') r;

  return n;
end $$;

-- 저장 실패 시: 작업과 저장된 행을 지우고 차감한 건수를 되돌림
create or replace function public.dbmerge_abort_job(p_token text, p_job_id text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v dbmerge_licenses := _dbmerge_auth(p_token);
  j dbmerge_jobs     := _dbmerge_own_job(v, p_job_id);
begin
  delete from dbmerge_rows where job_id::text = j.id::text;
  delete from dbmerge_jobs where id = j.id;
  if not coalesce(v.is_admin, false) then
    update dbmerge_licenses set used = greatest(0, used - coalesce(j.unique_count, 0)) where id = v.id;
  end if;
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

-- Supabase 기본 응답 제한(1000행) 때문에 페이지 단위로 조회
create or replace function public.dbmerge_get_rows(p_token text, p_job_id text, p_offset int, p_limit int)
returns setof public.dbmerge_rows
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v dbmerge_licenses := _dbmerge_auth(p_token);
begin
  if not exists (select 1 from dbmerge_jobs where id::text = p_job_id and user_id::text = v.id::text) then
    raise exception '작업을 찾을 수 없습니다.';
  end if;
  return query
    select * from dbmerge_rows where job_id::text = p_job_id
    order by id
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end $$;

-- ── 권한 ──────────────────────────────────────────────────────
-- Supabase는 새 함수를 anon에게 기본 허용하므로 내부 함수는 명시적으로 회수
revoke all on function public._dbmerge_token_hash(text)                          from public, anon, authenticated;
revoke all on function public._dbmerge_profile(public.dbmerge_licenses)          from public, anon, authenticated;
revoke all on function public._dbmerge_new_session(text)                         from public, anon, authenticated;
revoke all on function public._dbmerge_auth(text)                                from public, anon, authenticated;
revoke all on function public._dbmerge_own_job(public.dbmerge_licenses, text)    from public, anon, authenticated;

revoke all on function public.dbmerge_register(text, text, text, text)                    from public;
revoke all on function public.dbmerge_login(text, text, text)                             from public;
revoke all on function public.dbmerge_me(text)                                            from public;
revoke all on function public.dbmerge_logout(text)                                        from public;
revoke all on function public.dbmerge_start_job(text, int, int, int, int, int, jsonb)    from public;
revoke all on function public.dbmerge_add_rows(text, text, jsonb)                         from public;
revoke all on function public.dbmerge_abort_job(text, text)                               from public;
revoke all on function public.dbmerge_get_jobs(text)                                      from public;
revoke all on function public.dbmerge_get_rows(text, text, int, int)                      from public;

grant execute on function public.dbmerge_register(text, text, text, text)                 to anon, authenticated;
grant execute on function public.dbmerge_login(text, text, text)                          to anon, authenticated;
grant execute on function public.dbmerge_me(text)                                         to anon, authenticated;
grant execute on function public.dbmerge_logout(text)                                     to anon, authenticated;
grant execute on function public.dbmerge_start_job(text, int, int, int, int, int, jsonb) to anon, authenticated;
grant execute on function public.dbmerge_add_rows(text, text, jsonb)                      to anon, authenticated;
grant execute on function public.dbmerge_abort_job(text, text)                            to anon, authenticated;
grant execute on function public.dbmerge_get_jobs(text)                                   to anon, authenticated;
grant execute on function public.dbmerge_get_rows(text, text, int, int)                   to anon, authenticated;
