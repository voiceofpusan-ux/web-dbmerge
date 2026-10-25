-- 2단계(lockdown) 적용 후 anon 역할로 RPC 동작과 테이블 차단을 검증

set role anon;

-- ── 테이블 직접 접근 차단 ─────────────────────────────────────
select test.err('select * from dbmerge_licenses', 'permission denied', '라이선스 테이블 직접 조회 차단');
select test.err('select * from dbmerge_rows', 'permission denied', '연락처 행 직접 조회 차단');
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
select test.err($$select dbmerge_login('01011112222', 'pass1234', 'm2')$$, '다른 기기', '다른 기기 로그인 거부');

reset role;
select test.ok(password like '$2%' and machine_id = 'm1', '로그인 후 bcrypt 교체 + 기기 등록')
from dbmerge_licenses where phone = '01011112222';
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

-- ── 건수 차감과 저장 ──────────────────────────────────────────
select test.err(format($$select dbmerge_start_job(%L, 500, 400, 0, 0, 0, '["a.xlsx"]')$$, :'t_new'),
                '잔여 건수가 부족', '잔여 건수 초과 시 거부');
select test.ok((dbmerge_me(:'t_new') ->> 'used')::int = 0, '거부 시 차감 없음');

select dbmerge_start_job(:'t_new', 5, 3, 2, 0, 0, '["a.xlsx", "b.csv"]') as job \gset
select test.ok((dbmerge_me(:'t_new') ->> 'used')::int = 3, '작업 시작 → 3건 차감');

select test.ok(dbmerge_add_rows(:'t_new', :'job',
  '[{"name":"홍길동","fixed_phone":"010-1111-2222","party_type":"권리당원","job_id":"00000000-0000-0000-0000-000000000000","user_id":"hacker"},
    {"name":"김철수","fixed_phone":"010-3333-4444"}]') = 2, '행 2개 저장');
select test.err(format($$select dbmerge_add_rows(%L, %L, '[{"name":"a"},{"name":"b"}]')$$, :'t_new', :'job'),
                '많은 행', '차감한 건수보다 많이 저장 거부');

-- 다른 사용자는 내 작업에 접근 불가
select test.err(format($$select dbmerge_add_rows(%L, %L, '[{"name":"x"}]')$$, :'t_old', :'job'), '찾을 수 없습니다', '남의 작업에 행 추가 거부');
select test.err(format($$select * from dbmerge_get_rows(%L, %L, 0, 100)$$, :'t_old', :'job'), '찾을 수 없습니다', '남의 작업 행 조회 거부');
select test.err(format($$select dbmerge_abort_job(%L, %L)$$, :'t_old', :'job'), '찾을 수 없습니다', '남의 작업 취소 거부');
select test.ok((select count(*) from dbmerge_get_jobs(:'t_old')) = 0, '남의 작업은 이력에 안 보임');

select test.ok((select count(*) from dbmerge_get_jobs(:'t_new')) = 1, '내 작업 이력 조회');
select test.ok((select file_names = array['a.xlsx', 'b.csv'] from dbmerge_get_jobs(:'t_new')), '파일명 배열 저장');
select test.ok((select count(*) from dbmerge_get_rows(:'t_new', :'job', 0, 1)) = 1
           and (select count(*) from dbmerge_get_rows(:'t_new', :'job', 1, 1)) = 1
           and (select count(*) from dbmerge_get_rows(:'t_new', :'job', 2, 1)) = 0, '행 페이지 조회');
select test.ok((select count(*) from dbmerge_get_rows(:'t_new', :'job', 0, 100)
                where job_id::text = :'job' and user_id <> 'hacker') = 2, '요청 JSON의 job_id·user_id는 무시');
select test.ok((select party_type from dbmerge_get_rows(:'t_new', :'job', 0, 100) where name = '홍길동') = '권리당원', '컬럼 값 저장');

-- 저장 실패 시 취소 → 삭제 + 환불
select dbmerge_abort_job(:'t_new', :'job');
select test.ok((select count(*) from dbmerge_get_jobs(:'t_new')) = 0, '취소 → 작업 삭제');
select test.ok((dbmerge_me(:'t_new') ->> 'used')::int = 0, '취소 → 차감 건수 환불');

-- ── 관리자 ────────────────────────────────────────────────────
select dbmerge_login('01099990000', 'admin123', 'any') ->> 'token' as t_admin \gset
select dbmerge_start_job(:'t_admin', 10, 10, 0, 0, 0, '[]') as job_admin \gset
select test.ok((dbmerge_me(:'t_admin') ->> 'used')::int = 0, '관리자는 quota 0이어도 차감 없이 저장');

-- ── 차단·로그아웃 ─────────────────────────────────────────────
reset role;
update dbmerge_licenses set status = 'blocked' where phone = '01011112222';
set role anon;
select test.err(format($$select dbmerge_me(%L)$$, :'t_old'), '차단', '로그인 중 차단되면 즉시 거부');

select dbmerge_logout(:'t_new');
select test.err(format($$select dbmerge_me(%L)$$, :'t_new'), '로그인이 필요합니다', '로그아웃한 토큰 거부');

reset role;
select test.ok((select count(*) from dbmerge_sessions where length(token_hash) = 64) > 0, '세션에는 토큰 해시만 저장');
