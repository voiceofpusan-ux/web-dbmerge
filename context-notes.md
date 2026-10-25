# 작업 메모 (결정과 이유)

## 보안 구조 개선 (2026-10)

- **문제**: anon 키 + "anon all" RLS 정책으로 브라우저에서 모든 테이블을 직접 읽고 쓸 수 있었음.
  누구나 전체 연락처(당원구분 포함)·비밀번호 해시를 읽고, 자기 quota/is_admin을 수정할 수 있었음.
- **선택한 방식**: Supabase Auth 대신 SECURITY DEFINER 함수(RPC) + 자체 세션 토큰.
  - Supabase Auth는 기존 SHA-256 비밀번호 해시를 가져올 수 없어 전원 재가입이 필요하고, 이메일/SMS 설정도 필요함.
  - RPC 방식은 기존 계정·비밀번호를 그대로 쓰면서 테이블 직접 접근을 모두 막을 수 있음.
- **비밀번호**: bcrypt(pgcrypto `crypt`)로 저장. 기존 SHA-256(phone+password) 해시는 로그인 성공 시 bcrypt로 자동 교체.
  관리자 콘솔의 PW초기화는 여전히 SHA-256을 쓰므로 레거시 검증 경로를 유지함.
- **세션 토큰**: 32바이트 난수, DB에는 SHA-256 해시만 저장, 30일 만료.
- **건수 차감**: `dbmerge_start_job`에서 `used + n <= quota` 조건부 UPDATE로 원자적 차감.
  `dbmerge_add_rows`는 작업의 unique_count를 넘는 행 저장을 거부(적게 결제하고 많이 저장하는 것 방지).
  저장 실패 시 `dbmerge_abort_job`이 행·작업 삭제 후 환불.
- **컬럼 타입 불확실성**: 테이블이 저장소에 없어서 user_id(text/uuid), file_names(text[]/jsonb) 타입을 모름.
  비교는 `::text`로, INSERT는 `jsonb_populate_record(set)`로 해서 어느 타입이든 동작하게 함.
- **배포 순서**: 01(함수 추가, 기존 앱 영향 없음) → PR 머지·배포 → 02(직접 접근 차단).
- **관리자 콘솔(admin-james)**: REST로 테이블을 직접 다루므로, 02 적용 후에는 anon 키 대신 service_role 키를 입력해야 함.
- **이력 조회 1000행 제한**: Supabase 기본 max_rows(1000) 때문에 기존 getRows는 1000행에서 잘렸음. RPC를 페이지 단위로 호출하도록 함.
- **남은 한계**: machine_id는 브라우저가 보내는 값이라 위조 가능(기존과 동일한 약한 제한). 로그인 시도 횟수 제한 없음.

## 새 Supabase 프로젝트로 이전 (2026-10)

- 기존 프로젝트가 삭제되어 회원·이력 데이터가 모두 사라짐. 새 프로젝트에 다시 연결하기로 함.
- 테이블 정의가 저장소에 없었으므로 `supabase/00_schema.sql`을 새로 작성(코드 기준). 새 프로젝트이므로 `phone` unique, NOT NULL, `job_id` FK on delete cascade를 추가.
- 테이블은 RLS만 켜고 정책을 두지 않음. 브라우저 접근은 01의 서버 함수로만.
- 첫 관리자 계정은 앱에서 가입 후 SQL로 `is_admin = true` 설정 (가입 함수는 항상 일반 사용자로 만듦).
- 테스트를 두 경로로 나눔. `run_fresh.sql`(00→01→02, 새 프로젝트), `run_all.sql`(기존 테이블 + anon 정책에서 이전).
