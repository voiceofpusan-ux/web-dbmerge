// 전화번호 정규화(구번호→010 변환 포함) 테스트
import { describe, it, expect } from 'vitest';
import { normalizePhone } from './normalizer';

describe('normalizePhone', () => {
  it('010 번호는 하이픈 형식으로 정리', () => {
    expect(normalizePhone('010-1234-5678')).toEqual(['010-1234-5678', '']);
    expect(normalizePhone('01012345678')).toEqual(['010-1234-5678', '']);
    expect(normalizePhone('1012345678')).toEqual(['010-1234-5678', '']);
  });

  it('3자리 국번 구번호(10자리)를 010으로 변환', () => {
    expect(normalizePhone('011-234-5678')).toEqual(['010-5234-5678', '구번호변환']);
    expect(normalizePhone('016-555-1234')).toEqual(['010-2555-1234', '구번호변환']);
    expect(normalizePhone('017-300-1234')).toEqual(['010-6300-1234', '구번호변환']);
    expect(normalizePhone('018-300-1234')).toEqual(['010-4300-1234', '구번호변환']);
    expect(normalizePhone('019-600-1234')).toEqual(['010-5600-1234', '구번호변환']);
  });

  it('4자리 국번 구번호(11자리)를 010으로 변환', () => {
    expect(normalizePhone('011-9123-4567')).toEqual(['010-9123-4567', '구번호변환']);
    expect(normalizePhone('011-9600-4567')).toEqual(['010-8600-4567', '구번호변환']);
    expect(normalizePhone('011-1750-4567')).toEqual(['010-7150-4567', '구번호변환']);
    expect(normalizePhone('016-9123-4567')).toEqual(['010-7123-4567', '구번호변환']);
    expect(normalizePhone('019-9600-4567')).toEqual(['010-7600-4567', '구번호변환']);
    expect(normalizePhone('11-9123-4567')).toEqual(['010-9123-4567', '구번호변환']);
  });

  it('국번 자릿수와 맞지 않는 범위는 변환하지 않고 오류번호', () => {
    // 10자리인데 9xx·17x 국번 → 예전에는 010-9123-456처럼 자릿수가 틀린 번호로 변환됨
    expect(normalizePhone('0119123456')[1]).toBe('오류번호');
    expect(normalizePhone('011-170-1234')[1]).toBe('오류번호');
    // 11자리인데 3자리 국번 범위(0200~0899)
    expect(normalizePhone('011-0234-5678')[1]).toBe('오류번호');
  });

  it('지역번호·대표번호·빈값은 오류번호', () => {
    expect(normalizePhone('02-123-4567')).toEqual(['02-123-4567', '오류번호']);
    expect(normalizePhone('1588-1234')).toEqual(['1588-1234', '오류번호']);
    expect(normalizePhone('')).toEqual(['', '오류번호']);
  });
});
