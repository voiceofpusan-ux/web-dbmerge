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

-- ── 주소록 보관 (DB 저장 권한 계정만) ─────────────────────────
-- 업로드 묶음(파일) 단위로 저장하고, 저장 시각 + 계정 보관 시간이 지나면 삭제
-- 관리자 콘솔에서 계정별 권한(can_store)과 보관 시간(retention_hours, 비우면 영구)을 바꿈
-- 보관 시간을 바꾸면 이미 저장된 묶음에도 바로 적용됨 (삭제 시점을 매번 계산). 슈퍼어드민은 항상 영구
alter table public.dbmerge_licenses add column if not exists can_store boolean not null default false;
alter table public.dbmerge_licenses add column if not exists retention_hours integer default 72;

create table if not exists public.dbmerge_books (
  id         uuid primary key default gen_random_uuid(),
  license_id text not null,
  file_name  text not null default '',
  row_count  integer not null default 0,
  created_at timestamptz not null default now()
);
-- 이전 버전(묶음별 만료일)에서 만든 칸·인덱스 정리
drop index if exists public.dbmerge_books_license_idx;
alter table public.dbmerge_books drop column if exists expires_at;
create index if not exists dbmerge_books_license_created_idx on public.dbmerge_books (license_id, created_at);
-- 묶음의 사용 이력(DB 정리 차감 기록). 여러 번에 나눠 저장해도 한 줄로 누적
alter table public.dbmerge_books add column if not exists job_id uuid;
-- 사용 이력 종류: excel(엑셀받기) / book(DB 정리)
alter table public.dbmerge_jobs add column if not exists kind text not null default 'excel';

create table if not exists public.dbmerge_book_rows (
  id          bigint generated always as identity primary key,
  book_id     uuid not null references public.dbmerge_books (id) on delete cascade,
  license_id  text not null,
  fixed_phone text not null default '',   -- 정리된 번호 (비교 기준)
  orig_phone  text not null default '',
  grp         text not null default '',
  name        text not null default '',
  memo        text not null default '',
  address     text not null default '',
  party_type  text not null default '',
  note1       text not null default '',
  note2       text not null default '',
  note3       text not null default '',
  note4       text not null default '',
  note5       text not null default '',
  source      text not null default ''
);
create index if not exists dbmerge_book_rows_phone_idx on public.dbmerge_book_rows (license_id, fixed_phone);
create index if not exists dbmerge_book_rows_book_idx  on public.dbmerge_book_rows (book_id);

-- 내 주소록 검색: 이름·번호 일부 검색을 빠르게 (trigram 인덱스)
create extension if not exists pg_trgm with schema extensions;
create index if not exists dbmerge_book_rows_name_trgm  on public.dbmerge_book_rows using gin (name extensions.gin_trgm_ops);
create index if not exists dbmerge_book_rows_phone_trgm on public.dbmerge_book_rows using gin ((replace(fixed_phone, '-', '')) extensions.gin_trgm_ops);

alter table public.dbmerge_books     enable row level security;
alter table public.dbmerge_book_rows enable row level security;
revoke all on public.dbmerge_books, public.dbmerge_book_rows from anon, authenticated;

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
    'used',     coalesce(v.used, 0),
    'can_store', coalesce(v.can_store, false),
    -- null = 영구 보관
    'retention_hours', case when coalesce(v.is_admin, false) then null else v.retention_hours end
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

-- ── 주소록 정리 (DB 저장 권한 계정) ───────────────────────────

-- DB 저장 권한 확인(슈퍼어드민은 항상 허용) + 보관 기간 지난 데이터 먼저 정리
create or replace function public._dbmerge_store_auth(p_token text)
returns public.dbmerge_licenses
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v dbmerge_licenses := _dbmerge_auth(p_token);
begin
  if not (coalesce(v.can_store, false) or coalesce(v.is_admin, false)) then
    raise exception 'DB 저장 권한이 없습니다. 관리자에게 문의하세요.';
  end if;
  perform dbmerge_purge_expired();
  return v;
end $$;

-- 내 DB에서 번호(정리된 번호, 최대 1000개)와 같은 행을 모두 찾음. 중복 검토 화면용
create or replace function public.dbmerge_book_find(p_token text, p_phones jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v dbmerge_licenses := _dbmerge_store_auth(p_token);
begin
  if jsonb_array_length(coalesce(p_phones, '[]'::jsonb)) > 1000 then
    raise exception '한 번에 1000개까지 조회할 수 있습니다.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'row_id', r.id, 'book_id', r.book_id, 'file_name', b.file_name, 'saved_at', b.created_at,
             'fixed_phone', r.fixed_phone, 'orig_phone', r.orig_phone, 'grp', r.grp, 'name', r.name,
             'memo', r.memo, 'address', r.address, 'party_type', r.party_type,
             'note1', r.note1, 'note2', r.note2, 'note3', r.note3, 'note4', r.note4, 'note5', r.note5,
             'source', r.source)
           order by r.fixed_phone, b.created_at, r.id)
    from dbmerge_book_rows r
    join dbmerge_books b on b.id = r.book_id
    where r.license_id = v.id::text
      and r.fixed_phone in (select jsonb_array_elements_text(p_phones))
  ), '[]'::jsonb);
end $$;

-- DB 정리: 신규 번호는 저장(신규 건수만큼 차감), 이미 있는 번호는 빈 칸만 채움
-- 1000행씩 나눠 호출. 첫 호출은 p_book_id = null → 묶음 생성 후 id 반환, 이후 호출은 그 id 사용
create or replace function public.dbmerge_book_save(p_token text, p_book_id uuid, p_file_name text, p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v         dbmerge_licenses := _dbmerge_store_auth(p_token);
  bid       uuid := p_book_id;
  jid       uuid;
  n_new     int;
  n_fill    int;
  remaining int;
begin
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 1000 then
    raise exception '한 번에 1000행까지 저장할 수 있습니다.';
  end if;

  -- 같은 계정이 동시에 저장해도 중복 판단·차감이 엇갈리지 않게 계정 행 잠금
  perform 1 from dbmerge_licenses where id = v.id for update;

  if bid is not null and not exists (select 1 from dbmerge_books where id = bid and license_id = v.id::text) then
    raise exception '저장 중인 묶음을 찾을 수 없습니다. 다시 시도하세요.';
  end if;

  -- 이번 묶음의 행 (같은 번호는 첫 행만, 빈 번호 제외)
  create temp table if not exists _dbmerge_in (
    fixed_phone text, orig_phone text, grp text, name text, memo text, address text, party_type text,
    note1 text, note2 text, note3 text, note4 text, note5 text, source text
  ) on commit drop;
  truncate _dbmerge_in;
  insert into _dbmerge_in
  select distinct on (x.fixed_phone)
         x.fixed_phone, coalesce(x.orig_phone, ''), coalesce(x.grp, ''), coalesce(x.name, ''), coalesce(x.memo, ''),
         coalesce(x.address, ''), coalesce(x.party_type, ''), coalesce(x.note1, ''), coalesce(x.note2, ''),
         coalesce(x.note3, ''), coalesce(x.note4, ''), coalesce(x.note5, ''), coalesce(x.source, '')
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
         fixed_phone text, orig_phone text, grp text, name text, memo text, address text, party_type text,
         note1 text, note2 text, note3 text, note4 text, note5 text, source text)
  where coalesce(x.fixed_phone, '') <> ''
  order by x.fixed_phone;

  select count(*) into n_new from _dbmerge_in i
  where not exists (select 1 from dbmerge_book_rows r where r.license_id = v.id::text and r.fixed_phone = i.fixed_phone);

  -- 신규 건수만큼 차감 (슈퍼어드민 제외)
  if n_new > 0 and not coalesce(v.is_admin, false) then
    update dbmerge_licenses set used = used + n_new where id = v.id and used + n_new <= quota;
    if not found then
      select quota - used into remaining from dbmerge_licenses where id = v.id;
      raise exception E'잔여 건수가 부족합니다.\n잔여: %건  /  필요: %건',
        to_char(remaining, 'FM999,999,999,990'), to_char(n_new, 'FM999,999,999,990');
    end if;
  end if;

  -- 묶음과 사용 이력(DB 정리) 준비
  if bid is null then
    insert into dbmerge_jobs (user_id, total, unique_count, duplicate, converted, error, file_names, kind)
    select r.user_id, 0, 0, 0, 0, 0, r.file_names, 'book'
    from jsonb_populate_record(null::dbmerge_jobs, jsonb_build_object(
           'user_id', v.id::text, 'file_names', jsonb_build_array(coalesce(p_file_name, '')))) r
    returning id into jid;
    insert into dbmerge_books (license_id, file_name, row_count, job_id)
    values (v.id::text, coalesce(p_file_name, ''), 0, jid)
    returning id into bid;
  else
    select job_id into jid from dbmerge_books where id = bid;
  end if;

  -- 이미 있는 번호: 빈 칸만 이번 행 값으로 채움 (기존 값은 덮어쓰지 않음)
  update dbmerge_book_rows r set
    orig_phone = case when r.orig_phone = '' then i.orig_phone else r.orig_phone end,
    grp        = case when r.grp        = '' then i.grp        else r.grp        end,
    name       = case when r.name       = '' then i.name       else r.name       end,
    memo       = case when r.memo       = '' then i.memo       else r.memo       end,
    address    = case when r.address    = '' then i.address    else r.address    end,
    party_type = case when r.party_type = '' then i.party_type else r.party_type end,
    note1      = case when r.note1      = '' then i.note1      else r.note1      end,
    note2      = case when r.note2      = '' then i.note2      else r.note2      end,
    note3      = case when r.note3      = '' then i.note3      else r.note3      end,
    note4      = case when r.note4      = '' then i.note4      else r.note4      end,
    note5      = case when r.note5      = '' then i.note5      else r.note5      end
  from _dbmerge_in i
  where r.license_id = v.id::text and r.fixed_phone = i.fixed_phone
    and ((r.orig_phone = '' and i.orig_phone <> '') or (r.grp = '' and i.grp <> '') or (r.name = '' and i.name <> '')
      or (r.memo = '' and i.memo <> '') or (r.address = '' and i.address <> '') or (r.party_type = '' and i.party_type <> '')
      or (r.note1 = '' and i.note1 <> '') or (r.note2 = '' and i.note2 <> '') or (r.note3 = '' and i.note3 <> '')
      or (r.note4 = '' and i.note4 <> '') or (r.note5 = '' and i.note5 <> ''));
  get diagnostics n_fill = row_count;

  -- 신규 번호 저장
  insert into dbmerge_book_rows (book_id, license_id, fixed_phone, orig_phone, grp, name, memo, address, party_type,
                                 note1, note2, note3, note4, note5, source)
  select bid, v.id::text, i.fixed_phone, i.orig_phone, i.grp, i.name, i.memo, i.address, i.party_type,
         i.note1, i.note2, i.note3, i.note4, i.note5, i.source
  from _dbmerge_in i
  where not exists (select 1 from dbmerge_book_rows r where r.license_id = v.id::text and r.fixed_phone = i.fixed_phone);

  update dbmerge_books set row_count = row_count + n_new where id = bid;
  update dbmerge_jobs set total = total + (select count(*) from _dbmerge_in), unique_count = unique_count + n_new
  where id = jid;

  return jsonb_build_object('book_id', bid, 'inserted', n_new, 'filled', n_fill);
end $$;

-- 중복 검토 후 사용자가 고른 DB 행 삭제 (내 행만)
create or replace function public.dbmerge_book_delete_rows(p_token text, p_row_ids jsonb)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v dbmerge_licenses := _dbmerge_store_auth(p_token);
  n integer;
begin
  -- 데이터 변경 CTE(upd)는 참조하지 않아도 실행됨
  with del as (
    delete from dbmerge_book_rows
    where license_id = v.id::text
      and id in (select (jsonb_array_elements_text(coalesce(p_row_ids, '[]'::jsonb)))::bigint)
    returning book_id
  ),
  cnt as (select book_id, count(*)::int as c from del group by book_id),
  upd as (
    update dbmerge_books b set row_count = greatest(0, b.row_count - cnt.c)
    from cnt where b.id = cnt.book_id
    returning 1
  )
  select coalesce(sum(c), 0)::int into n from cnt;
  return n;
end $$;

-- ── 내 주소록 (검색·수정) ─────────────────────────────────────

-- 검색 조건에 맞는 내 행. p_group·p_party가 null이면 전체, ''이면 빈 값인 행
create or replace function public._dbmerge_book_match(p_license_id text, p_query text, p_group text, p_party text)
returns setof public.dbmerge_book_rows
language sql stable
set search_path = public, extensions
as $$
  with q as (
    select btrim(coalesce(p_query, '')) as raw,
           -- ILIKE 특수문자(% _ \)는 글자 그대로 찾도록 이스케이프
           replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') as pat,
           regexp_replace(coalesce(p_query, ''), '\D', '', 'g') as digits
  )
  select r.* from dbmerge_book_rows r, q
  where r.license_id = p_license_id
    and (p_group is null or r.grp = p_group)
    and (p_party is null or r.party_type = p_party)
    and (q.raw = ''
      or r.name    ilike '%' || q.pat || '%'
      or r.memo    ilike '%' || q.pat || '%'
      or r.address ilike '%' || q.pat || '%'
      -- 번호 검색은 검색어가 숫자(하이픈·공백 허용)로만 됐을 때만. "사람05"의 05로 번호를 찾지 않게
      or (q.raw ~ '^[0-9 -]+$' and length(q.digits) >= 2 and replace(r.fixed_phone, '-', '') like '%' || q.digits || '%'))
$$;

-- 검색 + 페이지 (최대 200행씩). { total, rows: [...] }
create or replace function public.dbmerge_book_search(
  p_token text, p_query text, p_group text, p_party text, p_offset int, p_limit int
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v     dbmerge_licenses := _dbmerge_store_auth(p_token);
  total int;
  rows  jsonb;
begin
  select count(*) into total from _dbmerge_book_match(v.id::text, p_query, p_group, p_party);
  select coalesce(jsonb_agg(x order by x.ord), '[]'::jsonb) into rows from (
    select row_number() over (order by m.name, m.fixed_phone, m.id) as ord,
           m.id as row_id, m.book_id, b.file_name, b.created_at as saved_at,
           m.fixed_phone, m.orig_phone, m.grp, m.name, m.memo, m.address, m.party_type,
           m.note1, m.note2, m.note3, m.note4, m.note5, m.source
    from _dbmerge_book_match(v.id::text, p_query, p_group, p_party) m
    join dbmerge_books b on b.id = m.book_id
    order by m.name, m.fixed_phone, m.id
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) x;
  return jsonb_build_object('total', total, 'rows', rows);
end $$;

-- 필터 선택지: 내 주소록의 그룹·당원구분별 건수와 전체 건수
create or replace function public.dbmerge_book_facets(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v dbmerge_licenses := _dbmerge_store_auth(p_token);
begin
  return jsonb_build_object(
    'total',   (select count(*) from dbmerge_book_rows where license_id = v.id::text),
    'groups',  coalesce((select jsonb_agg(jsonb_build_object('value', grp, 'count', n) order by grp)
                         from (select grp, count(*) n from dbmerge_book_rows where license_id = v.id::text group by grp) g), '[]'::jsonb),
    'parties', coalesce((select jsonb_agg(jsonb_build_object('value', party_type, 'count', n) order by party_type)
                         from (select party_type, count(*) n from dbmerge_book_rows where license_id = v.id::text group by party_type) p), '[]'::jsonb)
  );
end $$;

-- 행 수정 (전화번호는 비교 기준이라 바꾸지 않음). p_fields에 있는 칸만 바꿈
create or replace function public.dbmerge_book_update_row(p_token text, p_row_id bigint, p_fields jsonb)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v dbmerge_licenses := _dbmerge_store_auth(p_token);
  f jsonb := coalesce(p_fields, '{}'::jsonb);
begin
  update dbmerge_book_rows set
    grp        = coalesce(btrim(f ->> 'grp'),        grp),
    name       = coalesce(btrim(f ->> 'name'),       name),
    memo       = coalesce(btrim(f ->> 'memo'),       memo),
    address    = coalesce(btrim(f ->> 'address'),    address),
    party_type = coalesce(btrim(f ->> 'party_type'), party_type),
    note1      = coalesce(btrim(f ->> 'note1'),      note1),
    note2      = coalesce(btrim(f ->> 'note2'),      note2),
    note3      = coalesce(btrim(f ->> 'note3'),      note3),
    note4      = coalesce(btrim(f ->> 'note4'),      note4),
    note5      = coalesce(btrim(f ->> 'note5'),      note5)
  where id = p_row_id and license_id = v.id::text;
  if not found then
    raise exception '수정할 행을 찾을 수 없습니다.';
  end if;
end $$;

-- 고른 행(최대 1000개)의 그룹을 한 번에 변경
create or replace function public.dbmerge_book_set_group(p_token text, p_row_ids jsonb, p_group text)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v dbmerge_licenses := _dbmerge_store_auth(p_token);
  n integer;
begin
  if jsonb_array_length(coalesce(p_row_ids, '[]'::jsonb)) > 1000 then
    raise exception '한 번에 1000행까지 바꿀 수 있습니다.';
  end if;
  update dbmerge_book_rows set grp = btrim(coalesce(p_group, ''))
  where license_id = v.id::text
    and id in (select (jsonb_array_elements_text(coalesce(p_row_ids, '[]'::jsonb)))::bigint);
  get diagnostics n = row_count;
  return n;
end $$;

-- ── 만료 보관 데이터 삭제 ─────────────────────────────────────
-- 매시간 예약 작업으로 실행. 주소록 정리 함수도 실행 전에 호출하므로 예약 작업이 없어도 만료분은 쓰이지 않음
create or replace function public.dbmerge_purge_expired()
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  n integer;
begin
  -- 행은 on delete cascade로 함께 삭제. 계정이 지워진 묶음도 삭제
  delete from dbmerge_books b
  where not exists (select 1 from dbmerge_licenses l where l.id::text = b.license_id)
     or exists (
          select 1 from dbmerge_licenses l
          where l.id::text = b.license_id
            and not coalesce(l.is_admin, false)
            and l.retention_hours is not null
            and b.created_at + make_interval(hours => l.retention_hours) <= now());
  get diagnostics n = row_count;
  return n;
end $$;

-- 매시간 7분에 만료 데이터 삭제 (보관 72시간 기준 최대 1시간 지연). pg_cron을 켤 수 없는 환경이면 안내만 하고 넘어감
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron을 켤 수 없어 자동 삭제 예약을 건너뜁니다 (Database → Extensions에서 pg_cron을 켜고 이 파일을 다시 실행). 원인: %', sqlerrm;
    return;
  end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'dbmerge-purge-expired';
  perform cron.schedule('dbmerge-purge-expired', '7 * * * *', 'select public.dbmerge_purge_expired()');
end $$;

-- ── 권한 ──────────────────────────────────────────────────────
-- Supabase는 새 함수를 anon에게 기본 허용하므로 내부 함수는 명시적으로 회수
revoke all on function public._dbmerge_token_hash(text)                          from public, anon, authenticated;
revoke all on function public._dbmerge_profile(public.dbmerge_licenses)          from public, anon, authenticated;
revoke all on function public._dbmerge_new_session(text, text)                   from public, anon, authenticated;
revoke all on function public._dbmerge_use_device(public.dbmerge_licenses, text) from public, anon, authenticated;
revoke all on function public._dbmerge_auth(text)                                from public, anon, authenticated;
revoke all on function public.dbmerge_purge_expired()                            from public, anon, authenticated;
revoke all on function public._dbmerge_store_auth(text)                          from public, anon, authenticated;
revoke all on function public._dbmerge_book_match(text, text, text, text)        from public, anon, authenticated;

revoke all on function public.dbmerge_register(text, text, text, text)                    from public;
revoke all on function public.dbmerge_login(text, text, text)                             from public;
revoke all on function public.dbmerge_me(text)                                            from public;
revoke all on function public.dbmerge_logout(text)                                        from public;
revoke all on function public.dbmerge_start_job(text, int, int, int, int, int, jsonb)    from public;
revoke all on function public.dbmerge_get_jobs(text)                                      from public;
revoke all on function public.dbmerge_book_find(text, jsonb)                              from public;
revoke all on function public.dbmerge_book_save(text, uuid, text, jsonb)                  from public;
revoke all on function public.dbmerge_book_delete_rows(text, jsonb)                       from public;
revoke all on function public.dbmerge_book_search(text, text, text, text, int, int)       from public;
revoke all on function public.dbmerge_book_facets(text)                                   from public;
revoke all on function public.dbmerge_book_update_row(text, bigint, jsonb)                from public;
revoke all on function public.dbmerge_book_set_group(text, jsonb, text)                   from public;

grant execute on function public.dbmerge_register(text, text, text, text)                 to anon, authenticated;
grant execute on function public.dbmerge_login(text, text, text)                          to anon, authenticated;
grant execute on function public.dbmerge_me(text)                                         to anon, authenticated;
grant execute on function public.dbmerge_logout(text)                                     to anon, authenticated;
grant execute on function public.dbmerge_start_job(text, int, int, int, int, int, jsonb) to anon, authenticated;
grant execute on function public.dbmerge_get_jobs(text)                                   to anon, authenticated;
grant execute on function public.dbmerge_book_find(text, jsonb)                           to anon, authenticated;
grant execute on function public.dbmerge_book_save(text, uuid, text, jsonb)               to anon, authenticated;
grant execute on function public.dbmerge_book_delete_rows(text, jsonb)                    to anon, authenticated;
grant execute on function public.dbmerge_book_search(text, text, text, text, int, int)    to anon, authenticated;
grant execute on function public.dbmerge_book_facets(text)                                to anon, authenticated;
grant execute on function public.dbmerge_book_update_row(text, bigint, jsonb)             to anon, authenticated;
grant execute on function public.dbmerge_book_set_group(text, jsonb, text)                to anon, authenticated;
