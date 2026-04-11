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
  page.tsx            # 메인 페이지 (업로드 + 처리 + 결과)
  history/
    page.tsx          # 작업 이력 조회 페이지
components/
  UploadPanel.tsx     # 파일 드롭 + 컬럼 매핑 테이블
  ResultPanel.tsx     # 결과 미리보기 + DB저장 + 엑셀저장
  LicenseDialog.tsx   # 라이선스 등록/현황 모달
lib/
  normalizer.ts       # 전화번호 정규화 (구번호→010 변환 포함)
  loader.ts           # SheetJS로 xlsx/csv 파싱 + 컬럼 자동추론
  deduplicator.ts     # 시트 통합 + 중복제거 처리
  exporter.ts         # xlsx 다운로드 (정제결과/전체이력/단일)
  db.ts               # Supabase dbmerge_jobs/rows CRUD
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
5. **DB 저장** → `db.saveJob()` → Supabase `dbmerge_jobs` + `dbmerge_rows`
6. **엑셀 저장** → `exporter.exportExcel()` → xlsx 2파일 다운로드
7. `/history` 페이지 → `db.getJobs()` → 이력 조회 + xlsx 다운로드

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

### dbmerge_rows (정제결과 행)
| 컬럼 | 설명 |
|---|---|
| id | uuid PK |
| job_id | dbmerge_jobs.id 참조 |
| machine_id | 기기 ID |
| grp / name / phone / fixed_phone / memo / orig_phone / source / remark | 각 컬럼값 |

### RLS 정책
```sql
-- 익명 접근 허용 (anon key 사용)
create policy "anon all jobs" on dbmerge_jobs for all to anon using (true) with check (true);
create policy "anon all rows" on dbmerge_rows for all to anon using (true) with check (true);
```

## 라이선스 (Supabase 연동)

### 테이블: `dbmerge_licenses`
| 필드 | 설명 |
|---|---|
| id | uuid PK |
| name | 사용자 이름 |
| phone | 전화번호 |
| computer_name | User-Agent |
| machine_id | 기기 UUID (localStorage) |
| status | `pending` / `active` / `blocked` |
| quota | 총 허용 건수 (기본 10,000) |
| used | 사용 건수 |
| charge_count | 충전 횟수 |
| registered_at | 등록일 |

### 동작 흐름
1. 앱 시작 → Supabase 조회 → 헤더 잔여건수 표시
2. `라이선스 관리` 버튼 → 이름/전화번호 입력 → 등록
3. 관리자 콘솔 → DB통합정제 탭 → 승인
4. DB 저장 시 정제결과 행 수만큼 `used` 자동 차감

### .env.local 설정 없을 경우
라이선스 기능 비활성화 → 건수 제한 없이 자유롭게 저장 가능

## 환경 변수
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
```

## Supabase 프로젝트
- URL: https://dtfckunvcjrotqtsyrjs.supabase.co
- Region: Northeast Asia (Seoul)

## 배포
- **GitHub**: `voiceofpusan-ux/web-dbmerge`
- **Vercel**: GitHub 자동 배포 연동 (push → 자동 빌드)
- **로컬 실행**: `cd E:/github/web-dbmerge && npm run dev`

## 관리자 콘솔
- URL: https://admin-james.netlify.app
- 레포: `voiceofpusan-ux/admin-james`
- 로컬 경로: `E:/github/admin/index.html`
- DB통합정제 탭: Firebase `dbmerge_licenses` 사용자 관리 (승인/충전)
- 작업이력 탭: Supabase `dbmerge_jobs/rows` 전체 조회 + xlsx 다운로드
  - Supabase URL/Key는 브라우저 localStorage에 저장

## 의존성
```json
"next": "^16.2.3",
"react": "^18.3.1",
"@supabase/supabase-js": "^2.39.0",
"xlsx": "^0.18.5",
"tailwindcss": "^3.4.0"
```
