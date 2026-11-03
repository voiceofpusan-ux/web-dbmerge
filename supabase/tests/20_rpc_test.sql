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

select test.ok((dbmerge_me(:'t_dev2') ->> 'retention_hours')::int = 72, '보관 기간 기본 72시간');
select test.ok((dbmerge_me(:'t_admin') -> 'retention_hours') = 'null'::jsonb, '슈퍼어드민은 영구 보관(null)');

reset role;
-- 일반 계정(01022223333): 4일 전·1일 전 묶음 / 슈퍼어드민: 100일 전 묶음
insert into dbmerge_books (id, license_id, file_name, row_count, created_at)
select '00000000-0000-0000-0000-0000000000b1'::uuid, id::text, '4일전.xlsx', 2, now() - interval '4 days' from dbmerge_licenses where phone = '01022223333'
union all
select '00000000-0000-0000-0000-0000000000b2'::uuid, id::text, '1일전.xlsx', 1, now() - interval '1 day'  from dbmerge_licenses where phone = '01022223333'
union all
select '00000000-0000-0000-0000-0000000000b3'::uuid, id::text, '관리자.xlsx', 1, now() - interval '100 days' from dbmerge_licenses where phone = '01099990000'
union all
select '00000000-0000-0000-0000-0000000000b4'::uuid, 'deleted-account', '탈퇴계정.xlsx', 1, now();
insert into dbmerge_book_rows (book_id, license_id, fixed_phone)
select id, license_id, '010-1111-000' || n from dbmerge_books, generate_series(1, row_count) n;

select test.ok(dbmerge_purge_expired() = 2, '72시간 지난 묶음과 계정 없는 묶음 삭제');
select test.ok((select array_agg(file_name order by file_name) from dbmerge_books) = array['1일전.xlsx', '관리자.xlsx'], '보관 기간 안 묶음·슈퍼어드민 묶음은 유지');
select test.ok((select count(*) from dbmerge_book_rows) = 2, '삭제된 묶음의 연락처도 함께 삭제');

update dbmerge_licenses set retention_hours = 12 where phone = '01022223333';     -- 관리자가 12시간으로 줄임
select test.ok(dbmerge_purge_expired() = 1, '기간을 줄이면 기존 데이터에도 바로 적용');
update dbmerge_licenses set retention_hours = null where phone = '01022223333';   -- 관리자가 영구로 바꿈
insert into dbmerge_books (license_id, file_name, row_count, created_at)
select id::text, '1년전.xlsx', 0, now() - interval '365 days' from dbmerge_licenses where phone = '01022223333';
select test.ok(dbmerge_purge_expired() = 0, '영구 보관 계정은 삭제 안 함');
set role anon;
select test.ok((dbmerge_me(:'t_dev2') -> 'retention_hours') = 'null'::jsonb, '영구로 바꾸면 내 정보에 null');

-- ── 주소록 정리 (DB 비교·DB 정리·중복 삭제) ─────────────────────
select test.err(format($$select dbmerge_book_find(%L, '[]')$$, :'t_old2'), 'DB 저장 권한', '권한 없는 계정은 주소록 정리 불가');
select test.err($$select _dbmerge_store_auth('x')$$, 'permission denied', '권한 확인 내부 함수 호출 차단');

select ((dbmerge_me(:'t_dev2') ->> 'used')::int) as used0 \gset
select dbmerge_book_save(:'t_dev2', null, '1차.xlsx',
  '[{"fixed_phone":"010-2000-0001","name":"홍길동","grp":""},
    {"fixed_phone":"010-2000-0002","name":"김철수"},
    {"fixed_phone":"010-2000-0001","name":"같은파일중복"},
    {"fixed_phone":"","name":"빈번호"}]') as save1 \gset
select test.ok((:'save1'::jsonb ->> 'inserted')::int = 2 and (:'save1'::jsonb ->> 'filled')::int = 0, '신규 2건 저장 (같은 번호·빈 번호 제외)');
select test.ok((dbmerge_me(:'t_dev2') ->> 'used')::int = :used0 + 2, '신규 건수만큼 차감');
select (:'save1'::jsonb ->> 'book_id') as book1 \gset

select test.ok(jsonb_array_length(dbmerge_book_find(:'t_dev2', '["010-2000-0001","010-2000-0002","010-2000-0003"]')) = 2, 'DB에 있는 번호만 찾음');

select dbmerge_book_save(:'t_dev2', :'book1', '1차.xlsx',
  '[{"fixed_phone":"010-2000-0001","name":"다른이름","grp":"서울"},
    {"fixed_phone":"010-2000-0003","name":"이영희"}]') as save2 \gset
select test.ok((:'save2'::jsonb ->> 'inserted')::int = 1 and (:'save2'::jsonb ->> 'filled')::int = 1, '나눠 저장: 신규 1건 + 기존 1건 빈 칸 채움');
select test.ok((select r ->> 'name' = '홍길동' and r ->> 'grp' = '서울'
                from jsonb_array_elements(dbmerge_book_find(:'t_dev2', '["010-2000-0001"]')) r), '기존 값은 유지하고 빈 칸만 채움');
select test.ok((dbmerge_me(:'t_dev2') ->> 'used')::int = :used0 + 3, '기존 번호는 차감 안 함');

select dbmerge_book_save(:'t_dev2', null, '2차.xlsx', '[{"fixed_phone":"010-2000-0001"},{"fixed_phone":"010-2000-0002"}]') as save3 \gset
select test.ok((:'save3'::jsonb ->> 'inserted')::int = 0 and (dbmerge_me(:'t_dev2') ->> 'used')::int = :used0 + 3, '모두 기존 번호면 차감 0건');

select test.ok((select unique_count = 3 and total = 4 and kind = 'book' and file_names = array['1차.xlsx']
                from dbmerge_get_jobs(:'t_dev2') where kind = 'book' order by created_at limit 1), '사용 이력에 DB 정리(누적 3건) 기록');

select test.err(format($$select dbmerge_book_save(%L, '00000000-0000-0000-0000-0000000000b3', 'x', '[]')$$, :'t_dev2'),
                '찾을 수 없습니다', '남의 묶음에 이어서 저장 불가');
select test.err(format($$select dbmerge_book_find(%L, %L)$$, :'t_dev2', (select jsonb_agg(g::text) from generate_series(1, 1001) g)),
                '1000개까지', '한 번에 1000개 넘게 조회 불가');

reset role;
update dbmerge_licenses set quota = used + 1 where phone = '01022223333';
set role anon;
select test.err(format($$select dbmerge_book_save(%L, null, '3차.xlsx', '[{"fixed_phone":"010-2000-0008"},{"fixed_phone":"010-2000-0009"}]')$$, :'t_dev2'),
                '잔여 건수가 부족', '잔여 건수보다 신규가 많으면 거부');
select test.ok(jsonb_array_length(dbmerge_book_find(:'t_dev2', '["010-2000-0008","010-2000-0009"]')) = 0, '거부되면 아무것도 저장 안 됨');

reset role;
select r.id as admin_row from dbmerge_book_rows r join dbmerge_licenses l on l.id::text = r.license_id where l.phone = '01099990000' limit 1 \gset
set role anon;
select (dbmerge_book_find(:'t_dev2', '["010-2000-0002"]') -> 0 ->> 'row_id') as my_row \gset
select test.ok(dbmerge_book_delete_rows(:'t_dev2', format('[%s,%s]', :'my_row', :'admin_row')::jsonb) = 1, '내 행만 삭제 (남의 행 id는 무시)');
select test.ok(jsonb_array_length(dbmerge_book_find(:'t_dev2', '["010-2000-0002"]')) = 0, '삭제한 행은 더 이상 안 보임');
reset role;
select test.ok((select count(*) from dbmerge_book_rows where id = :admin_row) = 1, '다른 계정 행은 그대로');
select test.ok((select row_count from dbmerge_books where id = :'book1') = 2, '묶음 건수도 줄어듦');
set role anon;

select dbmerge_book_save(:'t_admin', null, '관리자2.xlsx', '[{"fixed_phone":"010-3000-0001"}]') as save_a \gset
select test.ok((:'save_a'::jsonb ->> 'inserted')::int = 1 and (dbmerge_me(:'t_admin') ->> 'used')::int = 0, '슈퍼어드민은 권한 설정 없이 저장, 차감 없음');

-- ── 내 주소록 (검색·수정) ─────────────────────────────────────
-- 이 시점 01022223333의 DB: 010-2000-0001 홍길동/서울, 010-2000-0003 이영희/(그룹 없음)
select test.err(format($$select dbmerge_book_search(%L, '', null, null, 0, 50)$$, :'t_old2'), 'DB 저장 권한', '권한 없는 계정은 주소록 검색 불가');
select test.ok((dbmerge_book_search(:'t_dev2', '', null, null, 0, 50) ->> 'total')::int = 2, '전체 검색');
select test.ok((dbmerge_book_search(:'t_dev2', '길동', null, null, 0, 50) -> 'rows' -> 0 ->> 'name') = '홍길동', '이름 일부 검색');
select test.ok((dbmerge_book_search(:'t_dev2', '0003', null, null, 0, 50) -> 'rows' -> 0 ->> 'name') = '이영희', '번호 일부 검색');
select test.ok((dbmerge_book_search(:'t_dev2', '010-2000-0003', null, null, 0, 50) ->> 'total')::int = 1, '하이픈 넣은 번호 검색');
select test.ok((dbmerge_book_search(:'t_dev2', '이영희00', null, null, 0, 50) ->> 'total')::int = 0, '글자 섞인 검색어는 숫자만 떼어 번호 검색하지 않음');
select test.ok((dbmerge_book_search(:'t_dev2', '', '서울', null, 0, 50) ->> 'total')::int = 1, '그룹 필터');
select test.ok((dbmerge_book_search(:'t_dev2', '', '', null, 0, 50) -> 'rows' -> 0 ->> 'name') = '이영희', '그룹 없음 필터');
select test.ok((dbmerge_book_search(:'t_dev2', '%', null, null, 0, 50) ->> 'total')::int = 0, '% 는 글자 그대로 검색');
select test.ok((select (r ->> 'total')::int = 2 and jsonb_array_length(r -> 'rows') = 1
                from dbmerge_book_search(:'t_dev2', '', null, null, 1, 1) r), '페이지 나눠 조회');
select test.ok((select (f ->> 'total')::int = 2 and f -> 'groups' @> '[{"value":"서울","count":1},{"value":"","count":1}]'
                from dbmerge_book_facets(:'t_dev2') f), '그룹별 건수');

select (dbmerge_book_search(:'t_dev2', '길동', null, null, 0, 50) -> 'rows' -> 0 ->> 'row_id') as hong \gset
select dbmerge_book_update_row(:'t_dev2', :hong, '{"name":" 홍길순 ","memo":"수정","fixed_phone":"010-9999-9999"}');
select test.ok((select r ->> 'name' = '홍길순' and r ->> 'memo' = '수정' and r ->> 'grp' = '서울' and r ->> 'fixed_phone' = '010-2000-0001'
                from jsonb_array_elements(dbmerge_book_find(:'t_dev2', '["010-2000-0001"]')) r), '보낸 칸만 수정, 전화번호는 그대로');
select test.err(format($$select dbmerge_book_update_row(%L, %s, '{"name":"x"}')$$, :'t_dev2', :admin_row), '찾을 수 없습니다', '남의 행 수정 불가');

select (dbmerge_book_search(:'t_dev2', '0003', null, null, 0, 50) -> 'rows' -> 0 ->> 'row_id') as lee \gset
select test.ok(dbmerge_book_set_group(:'t_dev2', format('[%s,%s,%s]', :hong, :lee, :admin_row)::jsonb, ' 부산 ') = 2, '그룹 일괄 변경 (내 행만)');
select test.ok((dbmerge_book_search(:'t_dev2', '', '부산', null, 0, 50) ->> 'total')::int = 2, '바뀐 그룹으로 검색');
reset role;
select test.ok((select grp from dbmerge_book_rows where id = :admin_row) <> '부산', '남의 행 그룹은 그대로');
set role anon;
select test.err($$select _dbmerge_book_match('x', '', null, null)$$, 'permission denied', '검색 내부 함수 호출 차단');

-- ── 차단·로그아웃 ─────────────────────────────────────────────
reset role;
update dbmerge_licenses set status = 'blocked' where phone = '01011112222';
set role anon;
select test.err(format($$select dbmerge_me(%L)$$, :'t_old'), '차단', '로그인 중 차단되면 즉시 거부');

select dbmerge_logout(:'t_new');
select test.err(format($$select dbmerge_me(%L)$$, :'t_new'), '로그인이 필요합니다', '로그아웃한 토큰 거부');

reset role;
select test.ok((select count(*) from dbmerge_sessions where length(token_hash) = 64) > 0, '세션에는 토큰 해시만 저장');
