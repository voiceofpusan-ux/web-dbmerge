# 보안 구조 개선 체크리스트

- [x] 현재 스키마를 재현한 테스트용 SQL (`supabase/tests/00_fixture.sql`)
- [x] 1단계 SQL: 서버 함수(RPC)·세션 테이블 추가 (`supabase/01_rpc_functions.sql`)
- [x] 2단계 SQL: 테이블 직접 접근 차단 (`supabase/02_lockdown.sql`)
- [x] SQL 테스트 (`supabase/tests/rpc_test.sql`) 로컬 Postgres에서 통과
- [x] `lib/license.ts` RPC 기반으로 교체 (로그인·가입·세션 갱신·로그아웃)
- [x] `lib/db.ts` RPC 기반으로 교체 (작업 시작·행 저장·실패 시 취소·이력 조회)
- [x] `ResultPanel`·`LicenseDialog` 연결 수정
- [x] vitest 테스트 갱신 및 통과, 타입 검사·빌드 통과
- [x] `CLAUDE.md` 문서 갱신
- [x] PR 생성

# 계정별 권한 확장 (② → ③ → ① 단계별)

- [x] ② 접속 가능 컴퓨터 수: SQL(01) + 테스트 47개 + 관리자 콘솔 기기관리
- [x] ③ DB 저장 권한 + 데이터별 보관기간(기본 10일, 관리자 달력으로 묶음별 만료일 변경) + 자동 삭제
- [ ] ① 주소록 정리(DB 누적 비교, 신규 건수 차감, 중복 전체 표시·사용자가 삭제 선택, 파일명 아이디_주소록정리_날짜시간)
