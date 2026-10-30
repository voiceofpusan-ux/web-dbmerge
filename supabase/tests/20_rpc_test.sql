-- 02(lockdown)·03(행 저장 제거) 적용 후 anon 역할로 RPC 동작과 테이블 차단을 검증

set role anon;

-- ── 테이블 직접 접근 차단 ─────────────────────────────────────
select test.err('select * from dbmerge_licenses', 'permission denied', '라이선스 테이블 직접 조회 차단');
select test.err('select * from dbmerge_jobs', 'permission denied', '사용 기록 직접 조회 차단');
select test.err($$update dbmerge_licenses set quota = 999999$$, 'permission denied', 'quota 직접 수정 차단');
select test.err('select * from dbmerge_sessions', 'permission denied', '세션 테이블 직접 조회 차단');
select test.err($$select _dbmerge_auth('x')$$, 'permission denied', '내부 함수 호출 차단');

-- ── 로그인 ────────────────────────────────────────────────────
select test.err($$select dbmerge_login('01011112222', 'wrong', 'm1')$$, '올바르지 않습니다', '틀린 비밀번호 거부');
select test.err($$select dbmerge_login('01000000000', 'pass1234', 'm1')$$, '올바르지 않습니다', '없는 전화번호 거부');
select test.err($$select dbmerge_login('01033334444', 'pass1234', 'm1')$$, '차단', '차단 계정 로그인 거부');

select dbmerge_login('01011112222', 'pass1234', 'm1') ->> 'token' as t_old \gset
select test.ok(length(:'t_old') = 64, '기존 SHA-256 계정 로그인 → 토큰 발급');
select test.ok((dbmerge_me(:'t_old') ->> 'quota')::int = 1000, '토큰으로 내 정보 조회');
select test.err($$select dbmerge_login('01011112222', 'pass1234', 'm2')$$, '컴퓨터 수(1대)', '기본 1대 → 다른 컴퓨터 로그인 거부');

reset role;
select test.ok(password like '$2%', '로그인 후 bcrypt 교체') from dbmerge_licenses where phone = '01011112222';
select test.ok((select array_agg(d.machine_id) from dbmerge_devices d join dbmerge_licenses l on l.id::text = d.license_id
                where l.phone = '01011112222') = array['m1'], '첫 로그인 기기 등록');
set role anon;

select dbmerge_login('01011112222', 'pass1234', 'm1') ->> 'token' as t_old2 \gset
select test.ok(length(:'t_old2') = 64, 'bcrypt로 바뀐 뒤에도 로그인');

select test.err($$select dbmerge_me('garbage')$$, '로그인이 필요합니다', '가짜 토큰 거부');

-- ── 가입 ──────────────────────────────────────────────────────
select dbmerge_register('신규', ' 01055556666 ', 'newpass1', 'm9') as reg \gset
select (:'reg'::jsonb) ->> 'token' as t_new \gset
select test.ok((:'reg'::jsonb -> 'profile' ->> 'quota')::int = 300 and (:'reg'::jsonb -> 'profile' ->> 'is_admin')::boolean = false,
               '가입 → 300건, 일반 사용자');
select test.err($$select dbmerge_register('또', '01055556666', 'newpass1', 'm9')$$, '이미 등록된', '중복 전화번호 가입 거부');
select test.err($$select dbmerge_register('짧', '01077778888', '123', 'm9')$$, '6자 이상', '짧은 비밀번호 거부');

-- ── 엑셀받기 건수 차감 (dbmerge_start_job = 차감 + 사용 기록) ──
select test.err(format($$select dbmerge_start_job(%L, 500, 400, 0, 0, 0, '["a.xlsx"]')$$, :'t_new'),
                '잔여 건수가 부족', '잔여 건수 초과 시 거부');
select test.ok((dbmerge_me(:'t_new') ->> 'used')::int = 0, '거부 시 차감 없음');

select dbmerge_start_job(:'t_new', 5, 3, 2, 0, 0, '["a.xlsx", "b.csv"]') as job \gset
select test.ok((dbmerge_me(:'t_new') ->> 'used')::int = 3, '엑셀받기 → 3건 차감');
select dbmerge_start_job(:'t_new', 297, 297, 0, 0, 0, '[]') as job2 \gset
select test.ok((dbmerge_me(:'t_new') ->> 'used')::int = 300, '잔여 건수를 정확히 다 쓰는 것은 허용');
select test.err(format($$select dbmerge_start_job(%L, 1, 1, 0, 0, 0, '[]')$$, :'t_new'),
                '잔여 건수가 부족', '다 쓴 뒤에는 거부');

-- 사용 이력
select test.ok((select count(*) from dbmerge_get_jobs(:'t_new')) = 2, '내 사용 이력 조회');
select test.ok((select count(*) from dbmerge_get_jobs(:'t_old')) = 0, '남의 사용 이력은 안 보임');
select test.ok((select file_names = array['a.xlsx', 'b.csv'] from dbmerge_get_jobs(:'t_new') where id::text = :'job'), '파일명 기록');

-- 연락처 행 저장 기능은 제거됨 (03_remove_row_storage.sql)
select test.err(format($$select dbmerge_add_rows(%L, %L, '[{"name":"x"}]')$$, :'t_new', :'job'), 'does not exist', '행 저장 함수 없음');
select test.err(format($$select * from dbmerge_get_rows(%L, %L, 0, 100)$$, :'t_new', :'job'), 'does not exist', '행 조회 함수 없음');
select test.err(format($$select dbmerge_abort_job(%L, %L)$$, :'t_new', :'job'), 'does not exist', '작업 취소 함수 없음');
select test.ok(to_regclass('public.dbmerge_rows') is null, '연락처 행 테이블 없음');

-- ── 관리자 ────────────────────────────────────────────────────
select dbmerge_login('01099990000', 'admin123', 'any') ->> 'token' as t_admin \gset
select dbmerge_start_job(:'t_admin', 10, 10, 0, 0, 0, '[]') as job_admin \gset
select test.ok((dbmerge_me(:'t_admin') ->> 'used')::int = 0, '관리자는 quota 0이어도 차감 없음');

-- ── 접속 가능 컴퓨터 수 ───────────────────────────────────────
-- 이전 방식(machine_id 1개)으로 등록된 기기는 그대로 인정
select dbmerge_login('01022223333', 'pass1234', 'legacy-pc') ->> 'token' as t_dev1 \gset
select test.ok(length(:'t_dev1') = 64, '이전에 등록된 기기로 로그인');
select test.err($$select dbmerge_login('01022223333', 'pass1234', 'pc-2')$$, '컴퓨터 수(1대)', '두 번째 컴퓨터 거부');

reset role;
select test.ok((select machine_id from dbmerge_licenses where phone = '01022223333') = '', '이전 machine_id 칸은 비워짐');
update dbmerge_licenses set max_devices = 2 where phone = '01022223333';   -- 관리자 콘솔에서 2대로 변경
set role anon;
select dbmerge_login('01022223333', 'pass1234', 'pc-2') ->> 'token' as t_dev2 \gset
select test.ok(length(:'t_dev2') = 64, '2대로 늘리면 두 번째 컴퓨터 등록');
select test.err($$select dbmerge_login('01022223333', 'pass1234', 'pc-3')$$, '컴퓨터 수(2대)', '세 번째 컴퓨터 거부');
select test.ok((dbmerge_me(:'t_dev1') ->> 'name') = '기기', '등록된 기기의 기존 세션 유지');

reset role;
delete from dbmerge_devices where machine_id = 'legacy-pc';   -- 관리자 콘솔에서 기기 해제
set role anon;
select test.err(format($$select dbmerge_me(%L)$$, :'t_dev1'), '해제된 기기', '해제된 기기의 세션은 즉시 무효');
select test.ok((dbmerge_me(:'t_dev2') ->> 'name') = '기기', '다른 기기 세션은 유지');
select dbmerge_login('01022223333', 'pass1234', 'pc-3') ->> 'token' as t_dev3 \gset
select test.ok(length(:'t_dev3') = 64, '해제로 빈 자리에 새 컴퓨터 등록');
select test.err($$select dbmerge_login('01022223333', 'pass1234', '')$$, '기기 정보', '기기 정보 없으면 거부');
select test.err('select * from dbmerge_devices', 'permission denied', '기기 목록 직접 조회 차단');
select test.err($$select _dbmerge_use_device(null, 'x')$$, 'permission denied', '기기 등록 내부 함수 호출 차단');

-- ── DB 저장 권한·보관 기간 ────────────────────────────────────
select test.ok((dbmerge_me(:'t_dev2') ->> 'can_store')::boolean = false, 'DB 저장 권한 기본값 꺼짐');
reset role;
update dbmerge_licenses set can_store = true where phone = '01022223333';   -- 관리자 콘솔에서 권한 켬
set role anon;
select test.ok((dbmerge_me(:'t_dev2') ->> 'can_store')::boolean = true, '권한을 켜면 내 정보에 반영');
select test.err('select * from dbmerge_books', 'permission denied', '보관 묶음 직접 조회 차단');
select test.err('select * from dbmerge_book_rows', 'permission denied', '보관 연락처 직접 조회 차단');
select test.err('select dbmerge_purge_expired()', 'permission denied', '만료 삭제 함수 호출 차단');

reset role;
insert into dbmerge_books (id, license_id, file_name, row_count, expires_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'L1', '지난주.xlsx', 2, now() - interval '1 minute'),
  ('00000000-0000-0000-0000-0000000000b2', 'L1', '오늘.xlsx',   1, default);
insert into dbmerge_book_rows (book_id, license_id, fixed_phone) values
  ('00000000-0000-0000-0000-0000000000b1', 'L1', '010-1111-0001'),
  ('00000000-0000-0000-0000-0000000000b1', 'L1', '010-1111-0002'),
  ('00000000-0000-0000-0000-0000000000b2', 'L1', '010-1111-0003');
select test.ok((select expires_at::date - created_at::date from dbmerge_books where file_name = '오늘.xlsx') = 10, '보관 기간 기본 10일');
select test.ok(dbmerge_purge_expired() = 1, '만료된 묶음 1개 삭제');
select test.ok((select array_agg(fixed_phone) from dbmerge_book_rows) = array['010-1111-0003'], '만료 묶음의 연락처도 함께 삭제');
update dbmerge_books set expires_at = now() - interval '1 second' where file_name = '오늘.xlsx';   -- 관리자가 달력으로 만료일을 앞당김
select test.ok(dbmerge_purge_expired() = 1, '만료일을 바꾸면 그 기준으로 삭제');
select test.ok((select count(*) from dbmerge_book_rows) = 0, '남은 보관 연락처 없음');
set role anon;

-- ── 차단·로그아웃 ─────────────────────────────────────────────
reset role;
update dbmerge_licenses set status = 'blocked' where phone = '01011112222';
set role anon;
select test.err(format($$select dbmerge_me(%L)$$, :'t_old'), '차단', '로그인 중 차단되면 즉시 거부');

select dbmerge_logout(:'t_new');
select test.err(format($$select dbmerge_me(%L)$$, :'t_new'), '로그인이 필요합니다', '로그아웃한 토큰 거부');

reset role;
select test.ok((select count(*) from dbmerge_sessions where length(token_hash) = 64) > 0, '세션에는 토큰 해시만 저장');
