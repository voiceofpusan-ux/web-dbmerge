type NormalizeResult = [string, '' | '구번호변환' | '오류번호'];

// 구번호 → 010 변환 테이블: [국번시작, 국번끝, offset]
const OLD_PREFIX_RANGES: Record<string, [number, number, number][]> = {
  '011': [[200, 499, 5000], [500, 899, 3000], [1700, 1799, 5400], [9000, 9499, 0], [9500, 9999, -1000]],
  '017': [[200, 499, 6000], [500, 899, 4000]],
  '016': [[200, 499, 3000], [500, 899, 2000], [9000, 9499, -2000], [9500, 9999, 0]],
  '018': [[200, 499, 4000], [500, 899, 6000]],
  '019': [[200, 499, 2000], [500, 899, 5000], [9000, 9499, -1000], [9500, 9999, -2000]],
};

function convertOldPrefix(prefix: string, rest: string): NormalizeResult {
  // rest = 7자리 (국번 + 가입자번호)
  // 4자리 국번 우선 검사 (1700~9999 범위)
  const ranges = OLD_PREFIX_RANGES[prefix];
  if (!ranges || rest.length !== 7) return [rest, '오류번호'];

  const gukbun4 = parseInt(rest.slice(0, 4));
  const sub3 = rest.slice(4);
  for (const [lo, hi, offset] of ranges) {
    if (lo >= 1000 && gukbun4 >= lo && gukbun4 <= hi) {
      const newGukbun = gukbun4 + offset;
      return [`010-${String(newGukbun).padStart(4, '0')}-${sub3}`, '구번호변환'];
    }
  }

  const gukbun3 = parseInt(rest.slice(0, 3));
  const sub4 = rest.slice(3);
  for (const [lo, hi, offset] of ranges) {
    if (lo < 1000 && gukbun3 >= lo && gukbun3 <= hi) {
      const newGukbun = gukbun3 + offset;
      return [`010-${String(newGukbun).padStart(4, '0')}-${sub4}`, '구번호변환'];
    }
  }

  return [`${prefix}-${rest.slice(0, 3)}-${rest.slice(3)}`, '오류번호'];
}

export function normalizePhone(raw: string): NormalizeResult {
  if (!raw || typeof raw !== 'string') return ['', '오류번호'];

  let digits = raw.replace(/\D/g, '');
  if (!digits) return ['', '오류번호'];

  // 맨 앞 0 누락 처리
  // 010 계열: 10자리이고 '10'으로 시작 → 0 삽입 → 11자리
  //           9자리이고 '10'으로 시작 → 0 삽입 → 10자리
  // 구번호 계열: 9자리이고 '11','16','17','18','19'로 시작 → 0 삽입 → 10자리
  const MOBILE_NO_ZERO = /^1(0|1|6|7|8|9)/;
  if (digits.length === 10 && digits.startsWith('10')) {
    digits = '0' + digits;
  } else if (digits.length === 9 && MOBILE_NO_ZERO.test(digits)) {
    digits = '0' + digits;
  }

  // 010 정상번호
  if (digits.startsWith('010')) {
    if (digits.length === 11) {
      return [`010-${digits.slice(3, 7)}-${digits.slice(7)}`, ''];
    }
    if (digits.length === 10) {
      return [`010-${digits.slice(3, 6)}-${digits.slice(6)}`, ''];
    }
    return [raw, '오류번호'];
  }

  // 구번호 (01x-XXXXXXX = 10자리)
  const oldPrefixes = ['011', '016', '017', '018', '019'];
  for (const prefix of oldPrefixes) {
    if (digits.startsWith(prefix) && digits.length === 10) {
      return convertOldPrefix(prefix, digits.slice(3));
    }
  }

  // 나머지 (지역번호, 대표번호, 형식오류 등) → 오류번호
  return [raw, '오류번호'];
}
