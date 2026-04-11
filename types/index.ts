export interface ColumnMap {
  group: string;
  last_name: string;
  name: string;
  phone: string;
  memo: string;
}

export interface SheetEntry {
  id: string;
  fileName: string;
  sheetName: string;
  headers: string[];
  data: Record<string, string>[];
  columnMap: ColumnMap;
}

export interface RowRecord {
  group: string;
  name: string;
  phone: string;
  memo: string;
  원본번호: string;
  출처파일: string;
  수정번호: string;
  비고작업: '' | '구번호변환' | '오류번호';
  중복작업: '' | '중복';
}

export interface ProcessResult {
  uniqueRows: RowRecord[];
  allRows: RowRecord[];
  stats: {
    total: number;
    unique: number;
    duplicate: number;
    converted: number;
    error: number;
  };
}

export interface LicenseInfo {
  id: string;
  name: string;
  phone: string;
  computer_name: string;
  machine_id: string;
  status: 'pending' | 'active' | 'blocked';
  quota: number;
  used: number;
  charge_count: number;
  registered_at: string;
}
