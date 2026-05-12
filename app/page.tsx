'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { SheetEntry, ProcessResult, Session } from '@/types';
import UploadPanel from '@/components/UploadPanel';
import ResultPanel from '@/components/ResultPanel';
import LicenseDialog from '@/components/LicenseDialog';
import { process as processData } from '@/lib/deduplicator';
import { getSession, isConfigured as licConfigured } from '@/lib/license';
import { isConfigured as dbConfigured } from '@/lib/supabase';

export default function Home() {
  const [sheets,      setSheets]      = useState<SheetEntry[]>([]);
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [result,      setResult]      = useState<ProcessResult | null>(null);
  const [processing,  setProcessing]  = useState(false);
  const [showAccount, setShowAccount] = useState(() => licConfigured && !getSession());
  const [session,     setSession]     = useState<Session | null>(getSession);
  const [applyNames,  setApplyNames]  = useState(false);
  const [spaceCount,  setSpaceCount]  = useState(3);

  const refreshSession = useCallback(() => {
    setSession(getSession());
  }, []);

  const selectedSheet = sheets.find((s) => s.id === selectedId);
  const fileNames = [...new Set(sheets.map((s) => s.fileName))];

  const handleProcess = () => {
    if (sheets.length === 0) return;
    setProcessing(true);
    setTimeout(() => {
      try {
        setResult(processData(sheets, applyNames, spaceCount));
      } catch (e) {
        alert(`처리 오류: ${e}`);
      } finally {
        setProcessing(false);
      }
    }, 50);
  };

  const remaining = session ? session.quota - session.used : 0;

  const quotaText = () => {
    if (!licConfigured) return null;
    if (!session) return '잔여건수: 로그인 필요';
    if (session.is_admin) return '슈퍼어드민';
    if (remaining <= 0) return '잔여건수: 0건 (충전 필요)';
    return `잔여건수: ${remaining.toLocaleString()}건`;
  };

  const quotaColor = () => {
    if (!session) return 'text-gray-400';
    if (session.is_admin) return 'text-purple-600';
    if (remaining <= 0) return 'text-red-600';
    if (remaining <= 1000) return 'text-orange-500';
    return 'text-green-600';
  };

  return (
    <div className="min-h-screen">
      {/* 헤더 */}
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm">
        <h1 className="text-base font-bold text-gray-800">연락처 엑셀 통합 정제 도구</h1>
        <div className="flex items-center gap-3">
          {licConfigured && (
            <span className={`text-sm ${quotaColor()}`}>{quotaText()}</span>
          )}
          {dbConfigured && (
            <Link href="/history" className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">
              작업 이력
            </Link>
          )}
          <button
            onClick={() => setShowAccount(true)}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {session ? `${session.name} 님` : '로그인'}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        {!result ? (
          <>
            <div className="flex gap-4 items-start">
              {/* 업로드 패널 */}
              <div className="flex-1 bg-white rounded-xl border p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">파일 업로드 및 컬럼 매핑</h2>
                <UploadPanel
                  sheets={sheets}
                  onSheetsChange={setSheets}
                  selectedId={selectedId}
                  onSelectSheet={setSelectedId}
                />
              </div>

              {/* 미리보기 패널 */}
              {selectedSheet && (
                <div className="w-80 flex-shrink-0 bg-white rounded-xl border p-5 shadow-sm">
                  <h2 className="text-sm font-semibold text-gray-700 mb-1">미리보기</h2>
                  <p className="text-xs text-gray-400 mb-3">
                    {selectedSheet.fileName} [{selectedSheet.sheetName}] · 전체 {selectedSheet.data.length.toLocaleString()}행
                  </p>
                  <div className="overflow-auto max-h-80">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          {selectedSheet.headers.slice(0, 5).map((h) => (
                            <th key={h} className="px-2 py-1.5 text-left font-medium text-gray-600 border-b whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSheet.data.slice(0, 10).map((row, i) => (
                          <tr key={i} className="border-b hover:bg-gray-50">
                            {selectedSheet.headers.slice(0, 5).map((h) => (
                              <td key={h} className="px-2 py-1 whitespace-nowrap text-gray-700 max-w-[80px] truncate">
                                {row[h]}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col items-center gap-3 pt-2">
              {/* 이름 처리 옵션 */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={applyNames}
                    onChange={(e) => setApplyNames(e.target.checked)}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className="text-sm text-gray-700 font-medium">이름 처리</span>
                  <span className="text-xs text-gray-400">(2글자 좌우폭조절 · 4글자 이상 분리)</span>
                </label>
                {applyNames && (
                  <label className="flex items-center gap-1.5 text-sm text-gray-600">
                    <span>공백</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={spaceCount}
                      onChange={(e) => setSpaceCount(Math.max(1, Math.min(10, Number(e.target.value))))}
                      className="w-14 border border-gray-300 rounded px-2 py-0.5 text-center text-sm focus:outline-none focus:border-blue-400"
                    />
                    <span>칸</span>
                  </label>
                )}
              </div>

              <button
                onClick={handleProcess}
                disabled={sheets.length === 0 || processing}
                className="px-10 py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed shadow"
              >
                {processing ? '처리 중...' : '처리하기'}
              </button>
            </div>
          </>
        ) : (
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">처리 결과</h2>
            <ResultPanel
              result={result}
              fileNames={fileNames}
              onClose={() => setResult(null)}
              onLicenseRefresh={refreshSession}
            />
          </div>
        )}
      </main>

      {showAccount && (
        <LicenseDialog
          onClose={() => { if (!licConfigured || session) setShowAccount(false); }}
          onRefresh={refreshSession}
        />
      )}
    </div>
  );
}
