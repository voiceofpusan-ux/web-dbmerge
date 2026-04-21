import * as XLSX from 'xlsx';
import { RowRecord } from '@/types';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function getTimestamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

const HEADERS: string[]            = ['그룹', '이름', '수정전이름', '이름처리', '긴이름나머지', '폰번호', '수정번호', '메모', '원본번호', '출처파일', '비고작업', '중복작업'];
const COLS: (keyof RowRecord)[]    = ['group', 'name', '수정전이름', '이름처리', '긴이름나머지', 'phone', '수정번호', 'memo', '원본번호', '출처파일', '비고작업', '중복작업'];

function makeSheet(rows: RowRecord[]) {
  const data = [HEADERS, ...rows.map((r) => COLS.map((c) => r[c] ?? ''))];
  return XLSX.utils.aoa_to_sheet(data);
}

/**
 * 단일 파일 출력 — 정제결과 행 위쪽, 중복 행 아래쪽 정렬
 * 중복작업 컬럼으로 정제/중복 구분
 */
export function exportExcel(uniqueRows: RowRecord[], allRows: RowRecord[]) {
  const ts = getTimestamp();
  const sorted = [
    ...allRows.filter((r) => r.중복작업 !== '중복'),
    ...allRows.filter((r) => r.중복작업 === '중복'),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeSheet(sorted), '통합결과');
  XLSX.writeFile(wb, `번호통합_${ts}.xlsx`);
}

/** DB 이력에서 다운로드 — 단일 시트 */
export function exportSingle(rows: RowRecord[], label = '정제결과') {
  const ts = getTimestamp();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeSheet(rows), label);
  XLSX.writeFile(wb, `번호통합_${ts}_${label}.xlsx`);
}
