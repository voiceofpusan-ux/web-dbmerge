import * as XLSX from 'xlsx';
import { ColumnMap, SheetEntry } from '@/types';

const COLUMN_KEYWORDS: Record<keyof ColumnMap, string[]> = {
  // name을 last_name보다 먼저 배치 → '성명'이 last_name으로 잘못 매핑되는 것 방지
  name:       ['이름', '성명', '담당자', 'name', '고객명', '수신인', '수신자', '고객'],
  last_name:  ['성', '성씨', 'last_name', 'lastname'],
  phone:      ['전화', '번호', '폰', 'phone', '핸드폰', '휴대폰', '핸드폰번호', '휴대폰번호', '연락처', '전화번호', '모바일', '휴대전화'],
  group:      ['그룹', '부서', '팀', 'group', '분류', '구분'],
  memo:       ['메모', '특이사항', 'memo', '내용', '기타'],
  address:    ['주소', '거주지', '소재지', 'address'],
  party_type: ['당원구분', '당원', '구분', '유형', '분류'],
  note1:      ['비고1', 'note1', '비고_1'],
  note2:      ['비고2', 'note2', '비고_2'],
  note3:      ['비고3', 'note3', '비고_3'],
  note4:      ['비고4', 'note4', '비고_4'],
  note5:      ['비고5', 'note5', '비고_5'],
};

// 너무 일반적인 키워드는 헤더와 정확히 같을 때만 매칭 ('성별'→성, '당원구분'→그룹, '일련번호'→폰번호 오매핑 방지)
const EXACT_ONLY = new Set(['성', '번호', '구분']);

function autoInfer(headers: string[]): ColumnMap {
  const result: ColumnMap = { group: '', last_name: '', name: '', phone: '', memo: '', address: '', party_type: '', note1: '', note2: '', note3: '', note4: '', note5: '' };
  const used = new Set<string>();

  // 우선순위: name 먼저 → last_name에서 '성명' 오매핑 방지
  const order: (keyof ColumnMap)[] = ['name', 'phone', 'group', 'memo', 'last_name', 'address', 'party_type', 'note1', 'note2', 'note3', 'note4', 'note5'];

  for (const field of order) {
    for (const header of headers) {
      if (used.has(header)) continue;
      const h = header.toLowerCase().trim();
      for (const kw of COLUMN_KEYWORDS[field]) {
        const k = kw.toLowerCase();
        if (h === k || (!EXACT_ONLY.has(kw) && h.includes(k))) {
          result[field] = header;
          used.add(header);
          break;
        }
      }
      if (result[field]) break;
    }
  }

  return result;
}

export async function loadFile(file: File): Promise<Omit<SheetEntry, 'id'>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        const sheets: Omit<SheetEntry, 'id'>[] = [];
        for (const sheetName of workbook.SheetNames) {
          const ws = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(ws, {
            header: 1,
            defval: '',
          }) as string[][];

          if (rows.length < 2) continue;

          // 빈 헤더 열은 제외하되 원래 열 위치(i)를 유지해야 값이 밀리지 않음
          const cols = rows[0]
            .map((h, i) => ({ h: String(h).trim(), i }))
            .filter(({ h }) => h);
          const headers = cols.map(({ h }) => h);
          const rowData = rows.slice(1).map((row) => {
            const obj: Record<string, string> = {};
            cols.forEach(({ h, i }) => {
              obj[h] = String(row[i] ?? '');
            });
            return obj;
          });

          sheets.push({
            fileName: file.name,
            sheetName,
            headers,
            data: rowData,
            columnMap: autoInfer(headers),
          });
        }
        resolve(sheets);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
