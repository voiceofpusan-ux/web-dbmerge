import { RowRecord, SheetEntry, ProcessResult } from '@/types';
import { normalizePhone } from './normalizer';

const DOUBLE_SURNAMES = new Set(['남궁', '황보', '제갈', '선우', '독고', '사공', '서문', '동방']);

// 우선순위: 이름 > 그룹 > 채워진 컬럼 수 > 메모
function scoreRow(row: RowRecord): [number, number, number, number] {
  const hasName    = row.name.trim() ? 1 : 0;
  const hasGroup   = row.group.trim() ? 1 : 0;
  const filledCount = [row.group, row.name, row.memo].filter((v) => v.trim() !== '').length;
  const hasMemo    = row.memo.trim() ? 1 : 0;
  return [hasName, hasGroup, filledCount, hasMemo];
}

function pickBetter(a: RowRecord, b: RowRecord): RowRecord {
  const sa = scoreRow(a);
  const sb = scoreRow(b);
  for (let i = 0; i < 4; i++) {
    if (sa[i] !== sb[i]) return sa[i] > sb[i] ? a : b;
  }
  return a;
}

/**
 * 이름 처리:
 * 1. 공백 전체 제거
 * 2. 복성(4글자+ 이름에서 앞 2글자가 복성)이면 복성 제거 후 남은 이름으로 처리
 * 3. 남은 이름 2글자 → 공백 3칸 삽입, 이름처리='좌우폭조절'
 *    남은 이름 3글자(복성 제거) → 이름처리='복성제거'
 *    남은 이름 4글자+ → 앞 3글자 유지, 나머지→긴이름나머지, 이름처리='4글자이상'
 *    그 외(1·3글자 일반) → 변환 없음, 수정전이름=''
 */
function applyNameRules(row: RowRecord): void {
  const rawName = row.name;                      // 원본 (공백 포함 가능)
  const cleaned = rawName.replace(/\s/g, '');    // 공백 전체 제거

  let working        = cleaned;
  let isDoubleSurname = false;

  // 복성 감지 (4글자 이상일 때만)
  if (working.length >= 4 && DOUBLE_SURNAMES.has(working.slice(0, 2))) {
    working        = working.slice(2);
    isDoubleSurname = true;
  }

  if (working.length === 2) {
    // 2글자 이름 (일반 or 복성 제거 후)
    row.name       = working[0] + '   ' + working[1];
    row.이름처리   = '좌우폭조절';
    row.수정전이름 = rawName;
  } else if (working.length >= 4) {
    // 4글자 이상 (일반 or 복성 제거 후)
    row.긴이름나머지 = working.slice(3);
    row.name         = working.slice(0, 3);
    row.이름처리     = '4글자이상';
    row.수정전이름   = rawName;
  } else if (isDoubleSurname) {
    // 복성 제거 후 3글자 → 변환 없이 복성만 제거
    row.name       = working;
    row.이름처리   = '복성제거';
    row.수정전이름 = rawName;
  } else {
    // 1글자 · 3글자 일반 이름 → 공백 제거만, 수정 없음
    row.name       = cleaned;
    row.수정전이름 = '';
  }
}

export function process(sheets: SheetEntry[], applyNames = false): ProcessResult {
  const allRows: RowRecord[] = [];

  for (const sheet of sheets) {
    const source = `${sheet.fileName} [${sheet.sheetName}]`;
    const { columnMap, data } = sheet;

    for (const raw of data) {
      const lastName  = columnMap.last_name ? (raw[columnMap.last_name] ?? '') : '';
      const firstName = columnMap.name      ? (raw[columnMap.name]      ?? '') : '';
      const name  = (lastName + firstName).trim();
      const phone = columnMap.phone ? (raw[columnMap.phone] ?? '') : '';
      const group = columnMap.group ? (raw[columnMap.group] ?? '') : '';
      const memo  = columnMap.memo  ? (raw[columnMap.memo]  ?? '') : '';

      const [수정번호, 비고작업] = normalizePhone(String(phone).trim());

      allRows.push({
        group:      String(group).trim(),
        name,
        수정전이름:   '',
        이름처리:    '',
        긴이름나머지: '',
        phone:      String(phone).trim(),
        memo:       String(memo).trim(),
        원본번호:   String(phone).trim(),
        출처파일:   source,
        수정번호,
        비고작업,
        중복작업:   '',
      });
    }
  }

  // 수정번호별 최적 행 선택 (우선순위 비교)
  const bestMap = new Map<string, RowRecord>();
  for (const row of allRows) {
    if (row.비고작업 !== '오류번호' && row.수정번호) {
      const current = bestMap.get(row.수정번호);
      bestMap.set(row.수정번호, current ? pickBetter(current, row) : row);
    }
  }

  // 낙선 행 중복 표시
  const winners = new Set(bestMap.values());
  for (const row of allRows) {
    if (row.비고작업 !== '오류번호' && row.수정번호 && !winners.has(row)) {
      row.중복작업 = '중복';
    }
  }

  // 이름 처리 (옵션 선택 시에만)
  if (applyNames) {
    for (const row of allRows) {
      applyNameRules(row);
    }
  }

  const uniqueRows = allRows.filter((r) => r.중복작업 !== '중복');

  const stats = {
    total:     allRows.length,
    unique:    uniqueRows.length,
    duplicate: allRows.filter((r) => r.중복작업  === '중복').length,
    converted: allRows.filter((r) => r.비고작업 === '구번호변환').length,
    error:     allRows.filter((r) => r.비고작업 === '오류번호').length,
  };

  return { uniqueRows, allRows, stats };
}
