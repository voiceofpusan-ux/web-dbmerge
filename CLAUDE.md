# db통합다중엑셀 프로젝트

## 프로젝트 개요
다수의 엑셀/CSV 파일을 통합하고, 전화번호를 정규화·중복 제거하여 정제된 연락처 DB를 출력하는 tkinter GUI 도구.

## 모듈 구조
```
dbmerge.py              # 진입점, App(tk.Tk) 메인 윈도우, 잔여건수 표시
core/
  loader.py             # 엑셀/CSV 로드, 컬럼 자동 추론 (성+이름 병합 포함)
  normalizer.py         # 전화번호 정규화 및 구번호→010 변환
  deduplicator.py       # 중복 검사 및 비고작업 컬럼 생성
  exporter.py           # xlsx 저장 (openpyxl)
  license.py            # Firestore 라이선스 관리 (등록/조회/건수차감)
ui/
  upload_panel.py       # 파일 추가, 컬럼 매핑, 시트 미리보기 UI
  result_panel.py       # 결과 미리보기 및 저장 버튼
  license_dialog.py     # 라이선스 등록/현황 다이얼로그
serviceAccountKey.json  # Firebase 서비스 계정 키 (git 제외)
```

## 데이터 흐름
1. `UploadPanel` → 파일 선택 + 컬럼 매핑 → `load_sheet()` → combined_df
2. `deduplicator.process(combined_df)` → full_df (수정번호 / 비고작업 / 중복작업 컬럼 추가)
3. `deduplicator.get_unique(full_df)` → unique_df (중복 제거본)
4. `ResultPanel.show(unique_df, full_df)` → 화면 출력
5. 저장 버튼 → `exporter.export()` → xlsx 2파일 생성

## 컬럼 규칙

### 내부 컬럼명 (DataFrame)
| 컬럼 | 설명 |
|---|---|
| group, name, phone, memo | 원본 입력값 (로드 시 매핑) |
| 원본번호 | phone의 원본값 복사본 |
| 출처파일 | 파일명 [시트명] |
| 수정번호 | 정규화/변환된 전화번호 (중복 검사 기준) |
| 비고작업 | '' / '구번호변환' / '오류번호' |
| 중복작업 | '' / '중복' |

### 비고작업 값 정의
- `''` : 정상 010 번호
- `'구번호변환'` : 구번호(011/016/017/018/019)를 010으로 변환 성공
- `'오류번호'` : 빈값, 지역번호, 대표번호, 형식오류, 변환 불가 구번호

### 중복 검사 규칙
- `비고작업 != '오류번호'`인 행만 대상
- `수정번호` 기준 duplicated(keep='first')
- 중복으로 판정된 행: `중복작업 = '중복'`

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
- 형식: xlsx (Excel 2007+, openpyxl 엔진)
- 파일명: `번호통합_YYYYMMDD_HHMMSS_정제결과.xlsx` / `_전체이력.xlsx`
- 정제결과: 중복 제거된 행 (그룹/이름/폰번호/수정번호/메모/원본번호/출처파일/비고작업)
- 전체이력: 전체 행 + 중복작업 컬럼 포함

## 라이선스 (Firestore 연동)

### 컬렉션: `dbmerge_licenses`
| 필드 | 설명 |
|---|---|
| name | 사용자 이름 |
| phone | 전화번호 |
| computer_name | 컴퓨터 이름 |
| machine_id | 기기 UUID (`~/.dbmerge_machine_id`) |
| status | `pending` / `active` / `blocked` |
| quota | 총 허용 건수 (기본 10,000) |
| used | 사용 건수 |
| charge_count | 충전 횟수 |
| registered_at | 등록일 |

### 동작 흐름
1. 앱 시작 → 백그라운드 Firestore 조회 → 우측 상단 잔여건수 표시
2. `도구 → 라이선스 관리` → 이름/전화번호 입력 → 등록
3. 관리자 콘솔(admin-james.netlify.app) → DB통합정제 탭 → 승인
4. 저장폴더선택 클릭 → 정제결과 행 수만큼 `used` 자동 차감

### serviceAccountKey.json 없을 경우
라이선스 기능 비활성화 → 건수 제한 없이 자유롭게 저장 가능

### 관리자 콘솔
- URL: https://admin-james.netlify.app
- 레포: `voiceofpusan-ux/admin-james` (Netlify 자동 배포 연동)
- 로컬 경로: `E:/github/admin/index.html`
- push 방법: `cd E:/github/admin && git add index.html && git commit -m "..." && git push`

### Firestore 보안 규칙 (dbmerge_licenses)
```
match /dbmerge_licenses/{docId} {
  allow read, write: if isAdmin();
  allow read, write: if request.auth == null;

  match /charge_history/{histId} {
    allow read, write: if isAdmin();
  }
}
```

## 의존성
- pandas, openpyxl, tkinter (표준)
- firebase-admin>=6.0.0
- `pip install pandas openpyxl firebase-admin`
