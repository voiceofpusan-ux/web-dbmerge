import { RowRecord, SheetEntry, ProcessResult } from '@/types';
import { normalizePhone } from './normalizer';

// 우선순위: 이름 > 그룹 > 채워진 컬럼 수 > 메모
function scoreRow(row: RowRecord): [number, number, number, number] {
  const hasName = row.name.trim() ? 1 : 0;
  const hasGroup = row.group.trim() ? 1 : 0;
  const filledCount = [row.group, row.name, row.memo].filter((v) => v.trim() !== '').length;
  const hasMemo = row.memo.trim() ? 1 : 0;
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
 * 2. 2글자 → 사이에 공백 3칸 삽입, 이름처리='좌우폭조절'
 * 3. 4글자+ → 앞 3글자만 유지, 나머지 → 긴이름나머지, 이름처리='4글자이상'
 * 4. 그 외 → 공백 제거된 이름만 적용
 */
function applyNameRules(row: RowRecord): void {
  const name = row.name.replace(/\s/g, ''); // 공백 전체 제거
  if (name.length === 2) {
    row.name = name[0] + '   ' + name[1];
    row.이름처리 = '좌우폭조절';
  } else if (name.length >= 4) {
    row.긴이름나머지 = name.slice(3);
    row.name = name.slice(0, 3);
    row.이름처리 = '4글자이상';
  } else {
    row.name = name;
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
        이름처리:   '',
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
