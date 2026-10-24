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
  // rest = 7자리(3자리 국번 + 가입자번호) 또는 8자리(4자리 국번 + 가입자번호)
  const ranges = OLD_PREFIX_RANGES[prefix];
  const gukbunLen = rest.length - 4;
  if (!ranges || (gukbunLen !== 3 && gukbunLen !== 4)) return [rest, '오류번호'];

  const gukbun = parseInt(rest.slice(0, gukbunLen));
  const sub = rest.slice(gukbunLen);
  for (const [lo, hi, offset] of ranges) {
    // 국번 자릿수와 범위 자릿수가 같은 것만 비교 (3자리: 200~899, 4자리: 1700~9999)
    if ((lo >= 1000) === (gukbunLen === 4) && gukbun >= lo && gukbun <= hi) {
      const newGukbun = gukbun + offset;
      return [`010-${String(newGukbun).padStart(4, '0')}-${sub}`, '구번호변환'];
    }
  }

  return [`${prefix}-${rest.slice(0, gukbunLen)}-${sub}`, '오류번호'];
}

export function normalizePhone(raw: string): NormalizeResult {
  if (!raw || typeof raw !== 'string') return ['', '오류번호'];

  let digits = raw.replace(/\D/g, '');
  if (!digits) return ['', '오류번호'];

  // 맨 앞 0 누락 처리: 10/11/16/17/18/19로 시작하면 무조건 0 삽입
  if (/^1[016789]/.test(digits)) {
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

  // 구번호 (01x-XXX-XXXX = 10자리, 01x-XXXX-XXXX = 11자리)
  const oldPrefixes = ['011', '016', '017', '018', '019'];
  for (const prefix of oldPrefixes) {
    if (digits.startsWith(prefix) && (digits.length === 10 || digits.length === 11)) {
      return convertOldPrefix(prefix, digits.slice(3));
    }
  }

  // 나머지 (지역번호, 대표번호, 형식오류 등) → 오류번호
  return [raw, '오류번호'];
}
