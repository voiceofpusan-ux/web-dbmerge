'use client';

import { useEffect, useState } from 'react';
import { getLicense, registerLicense } from '@/lib/license';
import { getMachineId } from '@/lib/machineId';
import { LicenseInfo } from '@/types';

interface Props {
  onClose: () => void;
  onRefresh: () => void;
}

const STATUS_TEXT: Record<string, string> = {
  pending: '⏳ 승인 대기중',
  active:  '✅ 승인됨',
  blocked: '🚫 차단됨',
};
const STATUS_COLOR: Record<string, string> = {
  pending: 'text-orange-500',
  active:  'text-green-600',
  blocked: 'text-red-600',
};

export default function LicenseDialog({ onClose, onRefresh }: Props) {
  const [info, setInfo]         = useState<LicenseInfo | null | undefined>(undefined);
  const [name, setName]         = useState('');
  const [phone, setPhone]       = useState('');
  const [registering, setRegistering] = useState(false);
  const [error, setError]       = useState('');
  const machineId = getMachineId();

  useEffect(() => {
    getLicense().then(setInfo).catch(() => setInfo(null));
  }, []);

  useEffect(() => {
    if (info) {
      setName(info.name || '');
      setPhone(info.phone || '');
    }
  }, [info]);

  const handleRegister = async () => {
    if (!name.trim() || !phone.trim()) {
      setError('이름과 전화번호를 입력해주세요.');
      return;
    }
    setRegistering(true);
    setError('');
    try {
      const result = await registerLicense(name.trim(), phone.trim());
      setInfo(result);
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '등록 실패');
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[400px] p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-800">라이선스 관리</h2>

        {/* 현황 */}
        <div className="border rounded-lg p-4 bg-gray-50">
          <p className="text-xs font-medium text-gray-500 mb-2">라이선스 현황</p>
          {info === undefined ? (
            <p className="text-sm text-gray-400">조회 중...</p>
          ) : info === null ? (
            <p className="text-sm text-gray-500">⚪ 미등록 — 아래에서 등록해주세요.</p>
          ) : (
            <div className="text-sm space-y-1">
              <p className={`font-semibold ${STATUS_COLOR[info.status] ?? 'text-gray-700'}`}>
                {STATUS_TEXT[info.status] ?? info.status}
              </p>
              <p className="text-gray-600 text-xs">
                총 {info.quota.toLocaleString()}건 &nbsp;|&nbsp;
                사용 {info.used.toLocaleString()}건 &nbsp;|&nbsp;
                잔여 {(info.quota - info.used).toLocaleString()}건
              </p>
            </div>
          )}
        </div>

        {/* 등록 폼 */}
        <div className="border rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 mb-3">기기 등록</p>
          <div className="grid grid-cols-[4.5rem_1fr] gap-y-2 gap-x-2 items-center text-sm">
            <label className="text-gray-600">이름</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={info?.status === 'active'}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm disabled:bg-gray-100 focus:outline-none focus:border-blue-400"
            />
            <label className="text-gray-600">전화번호</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={info?.status === 'active'}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm disabled:bg-gray-100 focus:outline-none focus:border-blue-400"
            />
          </div>
          {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
          {info?.status !== 'active' && (
            <button
              onClick={handleRegister}
              disabled={registering}
              className="mt-3 w-full py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {registering ? '등록 중...' : '등록하기'}
            </button>
          )}
        </div>

        {/* 기기 ID */}
        <p className="text-xs text-gray-400">
          기기 ID: <span className="font-mono">{machineId.slice(0, 20)}...</span>
        </p>

        <button
          onClick={onClose}
          className="w-full py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
