# web-dbmerge 프로젝트

## 프로젝트 개요
다수의 엑셀/CSV 파일을 브라우저에서 업로드하여 전화번호를 정규화·중복 제거하고,
정제된 연락처 DB를 Supabase에 저장하거나 xlsx 파일로 다운로드하는 Next.js 웹 앱.

## 기술 스택
- **프레임워크**: Next.js 16 (App Router, TypeScript)
- **스타일**: Tailwind CSS
- **DB**: Supabase (PostgreSQL + RLS)
- **엑셀 파싱/생성**: SheetJS (xlsx)
- **배포**: Vercel (GitHub 자동 배포)

## 모듈 구조
```
app/
  layout.tsx          # 루트 레이아웃
  page.tsx            # 엑셀 정리 (Workspace mode="excel")
  book/
    page.tsx          # 주소록 정리 (Workspace mode="book", DB 저장 권한 계정)
  history/
    page.tsx          # 사용 이력(엑셀받기 차감 기록) 조회 페이지
components/
  Workspace.tsx       # 업로드 + 처리 + 결과 화면 (엑셀 정리 / 주소록 정리 공용)
  BookPanel.tsx       # 주소록 정리: 내 DB와 비교, 중복 검토(DB 행 삭제), DB 정리
  UploadPanel.tsx     # 파일 드롭 + 컬럼 매핑 테이블
  ResultPanel.tsx     # 결과 미리보기 + 엑셀받기(차감 확인 창)
  LicenseDialog.tsx   # 라이선스 등록/현황 모달
lib/
  normalizer.ts       # 전화번호 정규화 (구번호→010 변환 포함)
  loader.ts           # SheetJS로 xlsx/csv 파싱 + 컬럼 자동추론
  deduplicator.ts     # 시트 통합 + 중복제거 처리
  exporter.ts         # xlsx 다운로드 (정제결과 위 + 중복 행 아래, 단일 시트)
  db.ts               # 엑셀받기 건수 차감(chargeExport) + 사용 이력 조회
  book.ts             # 주소록 정리 서버 호출 (findExisting / saveBook / deleteBookRows)
  license.ts          # Supabase 라이선스 조회/등록/차감
  supabase.ts         # Supabase 클라이언트 초기화
  machineId.ts        # localStorage 기기 ID (UUID)
types/
  index.ts            # 공통 타입 정의
```

## 데이터 흐름
1. `UploadPanel` → 파일 드롭 + 컬럼 매핑
2. `loadFile()` → SheetJS로 파싱 → `SheetEntry[]`
3. `처리하기` 버튼 → `deduplicator.process()` → `ProcessResult`
4. `ResultPanel` → 통계 + 미리보기 표시
5. **엑셀받기** → 확인 창(이번 차감·현재 잔여·차감 후 잔여) → `db.chargeExport()` → RPC `dbmerge_start_job`(서버 차감 + 사용 기록) → `exporter.exportExcel()` 다운로드
   - 연락처 행은 서버로 보내지 않음 (통계만 전송). DB 저장 기능은 없음
   - 같은 결과 다시 받기는 추가 차감 없음, "다시 작업" 후 새로 처리하면 다시 차감
   - Supabase 미설정(로컬) 환경에서는 차감 없이 바로 다운로드
6. `/history` 페이지 → `db.getJobs()` → 사용 이력(엑셀받기/DB 정리 구분, 날짜·파일명·차감 건수)

### 주소록 정리 (`/book`, DB 저장 권한 계정·슈퍼어드민)
1. 업로드 → 처리하기 (엑셀 정리와 같음)
2. `BookPanel` → `book.findExisting()` → RPC `dbmerge_book_find`(1000개씩) → 신규 / DB중복 표시
   - 오류번호는 비교·저장 대상에서 제외 (엑셀에는 포함)
3. 중복 검토: 번호별로 이번 파일 행 + DB 행 전부 표시 → 체크한 DB 행 `dbmerge_book_delete_rows`로 삭제
4. **DB 정리** → 확인 창 → `book.saveBook()` → RPC `dbmerge_book_save`(1000행씩 같은 묶음에 이어 저장)
   - 신규 번호 저장, **신규 건수만큼 차감**. 기존 번호는 빈 칸만 채움(기존 값 유지, 차감 없음)
   - 사용 이력에 `kind = 'book'`으로 묶음당 한 줄 누적
5. **엑셀받기** → 엑셀 정리와 같은 확인 창·차감(정제결과 건수), 파일명 `아이디_주소록정리_YYYYMMDD_HHMMSS.xlsx`

## 컬럼 규칙

### 내부 컬럼명 (RowRecord)
| 필드 | 설명 |
|---|---|
| group, name, phone, memo | 원본 입력값 (매핑 기준) |
| 원본번호 | phone 원본값 복사본 |
| 출처파일 | `파일명 [시트명]` |
| 수정번호 | 정규화/변환된 전화번호 (중복 검사 기준) |
| 비고작업 | `''` / `'구번호변환'` / `'오류번호'` |
| 중복작업 | `''` / `'중복'` |

### 비고작업 값 정의
- `''` : 정상 010 번호
- `'구번호변환'` : 구번호(011/016/017/018/019)를 010으로 변환 성공
- `'오류번호'` : 빈값, 지역번호, 대표번호, 형식오류, 변환 불가 구번호

### 중복 검사 규칙
- `비고작업 !== '오류번호'`인 행만 대상
- `수정번호` 기준 Set으로 keep='first'
- 중복 판정된 행: `중복작업 = '중복'`

## 구번호 → 010 변환 테이블

### SKT (011)
| 국번 범위 | offset |
|---|---|
| 200~499 (3자리) | +5000 |
| 500~899 (3자리) | +3000 |
| 1700~1799 (4자리) | +5400 |
| 9000~9499 (4자리) | 0 |
| 9500~9999 (4자리) | -1000 |

### SKT (017, 신세기통신)
| 국번 범위 | offset |
|---|---|
| 200~499 (3자리) | +6000 |
| 500~899 (3자리) | +4000 |

### KT (016)
| 국번 범위 | offset |
|---|---|
| 200~499 (3자리) | +3000 |
| 500~899 (3자리) | +2000 |
| 9000~9499 (4자리) | -2000 |
| 9500~9999 (4자리) | 0 |

### KT (018, 한솔텔레콤)
| 국번 범위 | offset |
|---|---|
| 200~499 (3자리) | +4000 |
| 500~899 (3자리) | +6000 |

### LGU+ (019)
| 국번 범위 | offset |
|---|---|
| 200~499 (3자리) | +2000 |
| 500~899 (3자리) | +5000 |
| 9000~9499 (4자리) | -1000 |
| 9500~9999 (4자리) | -2000 |

변환 원리: `new_gukbun = gukbun + offset` → `010-{new_gukbun:04d}-{subscriber}`
테이블 범위 밖 구번호는 `비고작업 = '오류번호'`로 처리.

## 출력 파일
- 형식: xlsx (SheetJS, Excel 2007+)
- 파일명: `번호통합_YYYYMMDD_HHMMSS_정제결과.xlsx` / `_전체이력.xlsx`
- 정제결과: 중복 제거된 행 (그룹/이름/폰번호/수정번호/메모/원본번호/출처파일/비고작업)
- 전체이력: 전체 행 + 중복작업 컬럼 포함

## Supabase DB 스키마

### dbmerge_jobs (작업 메타)
| 컬럼 | 설명 |
|---|---|
| id | uuid PK |
| machine_id | 기기 ID (localStorage UUID) |
| total | 전체 행 수 |
| unique_count | 정제결과 행 수 |
| duplicate | 중복 제거 수 |
| converted | 구번호변환 수 |
| error | 오류번호 수 |
| file_names | 업로드 파일명 배열 |
| created_at | 작업일시 |

### 접근 권한 (서버 함수만 허용)
브라우저(anon 키)는 dbmerge 테이블에 직접 접근할 수 없고, `SECURITY DEFINER` 서버 함수(RPC)만 호출한다.
SQL은 `supabase/`에 있고, 대시보드 SQL Editor에서 순서대로 실행한다.

**새 프로젝트** (빈 DB)
1. `supabase/00_schema.sql` — 테이블 생성
2. `supabase/01_rpc_functions.sql` — 세션 테이블·서버 함수 추가
3. `supabase/02_lockdown.sql` — anon/authenticated 테이블 권한 회수
4. `supabase/03_remove_row_storage.sql` — (이전 버전 SQL을 실행한 프로젝트만 필요) 연락처 행 테이블·함수 삭제
5. Vercel 환경 변수(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)를 새 프로젝트 값으로 바꾸고 재배포
6. 앱에서 관리자 계정 가입 후 SQL Editor에서 `update dbmerge_licenses set is_admin = true where phone = '관리자 전화번호';`

**기존 테이블이 있는 프로젝트** — `01` 실행 → 새 앱 배포 → `02` 실행 (01은 기존 앱에 영향 없음, 반복 실행 가능)

| 함수 | 역할 |
|---|---|
| `dbmerge_register` / `dbmerge_login` | 가입·로그인 → `{ token, profile }` 반환 |
| `dbmerge_me` / `dbmerge_logout` | 내 정보(잔여건수) 조회 / 토큰 폐기 |
| `dbmerge_start_job` | 엑셀받기 때 `used + n <= quota` 조건으로 원자적 차감 + 사용 기록 생성 |
| `dbmerge_get_jobs` | 내 사용 이력 조회 (`kind`: excel / book) |
| `dbmerge_book_find` | 주소록 정리: 내 DB에서 같은 번호 행 모두 조회 (최대 1000개씩) |
| `dbmerge_book_save` | 주소록 정리: 신규 저장(신규 건수 차감) + 기존 번호 빈 칸 채움 (1000행씩) |
| `dbmerge_book_delete_rows` | 주소록 정리: 고른 내 DB 행 삭제 |

- 세션: `dbmerge_sessions`에 토큰의 SHA-256과 기기(machine_id)만 저장, 30일 만료. 무효 토큰은 errcode `28000`
- 접속 컴퓨터: `dbmerge_licenses.max_devices`(기본 1) + `dbmerge_devices`(계정별 기기 목록, 처음 등록·마지막 접속)
  - 로그인 시 등록된 기기면 통과, 새 기기는 최대 대수 안에서만 등록 (슈퍼어드민은 제한 없음)
  - 관리자가 `dbmerge_devices` 행을 지우면 그 기기의 세션은 즉시 무효 → 앱이 자동 로그아웃
  - 이전 방식(`dbmerge_licenses.machine_id` 1개)은 01 실행 시 `dbmerge_devices`로 옮기고 비움
- DB 저장(주소록 보관): `dbmerge_licenses.can_store`(기본 false, 관리자 콘솔에서 켬) → profile의 `can_store`
  - 보관 기간: `dbmerge_licenses.retention_hours`(기본 72시간, null = 영구). 슈퍼어드민은 항상 영구 → profile의 `retention_hours`
  - 삭제 시점 = 묶음 저장 시각 + 계정 보관 시간 (매번 계산 → 기간을 바꾸면 기존 데이터에도 바로 적용)
  - `dbmerge_books`: 업로드 묶음(파일명·건수·저장 시각)
  - `dbmerge_book_rows`: 묶음의 연락처(`fixed_phone` 기준 비교). 묶음 삭제 시 함께 삭제(on delete cascade)
  - `dbmerge_purge_expired()`: 기간 지난 묶음·계정 없는 묶음 삭제. pg_cron이 켜져 있으면 매시간 7분 예약 실행
  - 앱: 권한 있는 일반 계정에 "DB는 보관기간이 72시간(3일)입니다." 안내 (`retentionLabel`)
- 비밀번호: bcrypt. 기존 SHA-256(전화번호+비밀번호) 해시는 로그인 성공 시 bcrypt로 교체
- localStorage 세션은 화면 표시용. 권한·잔여건수는 항상 서버에서 판단
- SQL 테스트 (로컬 Postgres, 빈 DB)
  - 새 프로젝트 경로: `createdb dbmerge_fresh && psql -v ON_ERROR_STOP=1 -d dbmerge_fresh -f supabase/tests/run_fresh.sql`
  - 기존 테이블 경로: `createdb dbmerge_test && psql -v ON_ERROR_STOP=1 -d dbmerge_test -f supabase/tests/run_all.sql`

## 라이선스 (Supabase 연동)

### 테이블: `dbmerge_licenses`
| 필드 | 설명 |
|---|---|
| id | uuid PK |
| name | 사용자 이름 |
| phone | 전화번호 |
| computer_name | User-Agent |
| machine_id | (이전 방식, 사용 안 함) 01 실행 시 `dbmerge_devices`로 이전 |
| max_devices | 접속 가능 컴퓨터 수 (기본 1, 관리자 콘솔에서 설정) |
| can_store | DB 저장(주소록 정리) 권한 (기본 false, 관리자 콘솔에서 설정) |
| retention_hours | DB 보관 시간 (기본 72, null = 영구, 관리자 콘솔에서 설정) |
| status | `pending` / `active` / `blocked` |
| password | bcrypt 해시 (기존 계정은 첫 로그인 전까지 SHA-256) |
| is_admin | 슈퍼어드민 (건수 차감·기기 제한 없음) |
| quota | 총 허용 건수 (가입 시 300) |
| used | 사용 건수 |
| charge_count | 충전 횟수 |
| registered_at | 등록일 |

### 동작 흐름
1. 앱 시작 → localStorage 세션으로 헤더 잔여건수 표시
2. `로그인` 버튼 → 회원가입(즉시 활성, 300건) 또는 로그인 → 서버가 세션 토큰 발급
3. 관리자 콘솔 → DB통합정제 탭 → 충전·차단·PW초기화·기기관리(최대 대수·기기별 해제)
4. 엑셀받기 시 서버가 정제결과 행 수(오류번호 포함)만큼 `used` 차감. 잔여 부족 시 다운로드 불가

### .env.local 설정 없을 경우
라이선스 기능 비활성화 → 건수 제한 없이 자유롭게 저장 가능

## 환경 변수
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
```

## Supabase 프로젝트
- URL: https://vzqxhnjeurbgneaaqgvo.supabase.co (프로젝트명 `문자관련`, 2026-10 생성, Free 플랜)
- Region: Northeast Asia (Seoul)
- 이전 프로젝트(`dtfckunvcjrotqtsyrjs`)는 삭제됨

## 배포
- **GitHub**: `voiceofpusan-ux/web-dbmerge`
- **Vercel**: GitHub 자동 배포 연동 (push → 자동 빌드)
- **로컬 실행**: `cd E:/github/web-dbmerge && npm run dev`

## 관리자 콘솔
- URL: https://admin-james.netlify.app
- 레포: `voiceofpusan-ux/admin-james`
- 로컬 경로: `E:/github/admin/index.html`
- DB통합정제 탭: Supabase `dbmerge_licenses` 사용자 관리 (충전/차단/PW초기화/기기관리)
  - 기기관리: 최대 대수(`max_devices`) 저장, `dbmerge_devices` 목록 조회·기기별/전체 해제
  - 보관관리: DB 저장 권한(`can_store`) 켜기/끄기, 보관 기간(`retention_hours`, 시간/일/영구) 설정, 묶음 목록(삭제 예정 시각)·삭제
  - `02_lockdown.sql` 적용 후에는 anon 키가 아니라 **service_role 키**로 연결해야 함
- 작업이력 탭: `dbmerge_rows`(연락처 행)는 삭제됨. `dbmerge_jobs`(사용 기록)만 남아 있음
  - Supabase URL/Key는 브라우저 localStorage에 저장

## 의존성
```json
"next": "^16.2.3",
"react": "^18.3.1",
"@supabase/supabase-js": "^2.39.0",
"xlsx": "^0.18.5",
"tailwindcss": "^3.4.0"
```
