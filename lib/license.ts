import { supabase, isConfigured } from './supabase';
import { getMachineId } from './machineId';
import { LicenseInfo } from '@/types';

export { isConfigured };

export async function getLicense(): Promise<LicenseInfo | null> {
  if (!supabase) return null;
  const machineId = getMachineId();
  const { data } = await supabase
    .from('dbmerge_licenses')
    .select('*')
    .eq('machine_id', machineId)
    .maybeSingle();
  return data as LicenseInfo | null;
}

export async function registerLicense(name: string, phone: string): Promise<LicenseInfo> {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');

  const existing = await getLicense();
  if (existing) return existing;

  const machineId = getMachineId();
  const { data, error } = await supabase
    .from('dbmerge_licenses')
    .insert({
      name,
      phone,
      computer_name: navigator.userAgent.slice(0, 200),
      machine_id: machineId,
      status: 'pending',
      quota: 10000,
      used: 0,
      charge_count: 0,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as LicenseInfo;
}

export async function consumeLicense(count: number): Promise<{ ok: boolean; message: string }> {
  if (!isConfigured) return { ok: true, message: '' };

  const lic = await getLicense();
  if (!lic) return { ok: false, message: '미등록 기기입니다.\n라이선스 등록을 먼저 해주세요.' };
  if (lic.status === 'pending') return { ok: false, message: '관리자 승인 대기 중입니다.\n승인 후 저장이 가능합니다.' };
  if (lic.status === 'blocked') return { ok: false, message: '사용이 차단된 기기입니다.\n관리자에게 문의하세요.' };

  const remaining = lic.quota - lic.used;
  if (remaining < count) {
    return {
      ok: false,
      message: `잔여 건수가 부족합니다.\n잔여: ${remaining.toLocaleString()}건  /  필요: ${count.toLocaleString()}건`,
    };
  }

  const { error } = await supabase!
    .from('dbmerge_licenses')
    .update({ used: lic.used + count })
    .eq('id', lic.id);

  if (error) return { ok: false, message: `차감 오류: ${error.message}` };
  return { ok: true, message: `${count.toLocaleString()}건 차감 완료 (잔여: ${(remaining - count).toLocaleString()}건)` };
}
