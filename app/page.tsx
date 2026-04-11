'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { SheetEntry, ProcessResult, LicenseInfo } from '@/types';
import UploadPanel from '@/components/UploadPanel';
import ResultPanel from '@/components/ResultPanel';
import LicenseDialog from '@/components/LicenseDialog';
import { process as processData } from '@/lib/deduplicator';
import { getLicense, isConfigured as licConfigured } from '@/lib/license';
import { isConfigured as dbConfigured } from '@/lib/supabase';

export default function Home() {
  const [sheets,      setSheets]      = useState<SheetEntry[]>([]);
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [result,      setResult]      = useState<ProcessResult | null>(null);
  const [processing,  setProcessing]  = useState(false);
  const [showLicense, setShowLicense] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null);

  const refreshLicense = useCallback(async () => {
    if (!licConfigured) return;
    try { setLicenseInfo(await getLicense()); } catch {}
  }, []);

  useEffect(() => { refreshLicense(); }, [refreshLicense]);

  const selectedSheet = sheets.find((s) => s.id === selectedId);
  const fileNames = [...new Set(sheets.map((s) => s.fileName))];

  const handleProcess = () => {
    if (sheets.length === 0) return;
    setProcessing(true);
    setTimeout(() => {
      try {
        setResult(processData(sheets));
      } catch (e) {
        alert(`처리 오류: ${e}`);
      } finally {
        setProcessing(false);
      }
    }, 50);
  };

  const quotaText = () => {
    if (!licConfigured) return null;
    if (!licenseInfo) return '잔여 처리건수: 미등록';
    const rem = licenseInfo.quota - licenseInfo.used;
    if (licenseInfo.status === 'pending') return '잔여 처리건수: 승인 대기중';
    if (licenseInfo.status === 'blocked') return '잔여 처리건수: 차단됨';
    if (rem <= 0) return '잔여 처리건수: 0건 (충전 필요)';
    return `잔여 처리건수: ${rem.toLocaleString()}건`;
  };

  const quotaColor = () => {
    if (!licenseInfo) return 'text-gray-400';
    const rem = licenseInfo.quota - licenseInfo.used;
    if (licenseInfo.status !== 'active') return 'text-orange-500';
    if (rem <= 0) return 'text-red-600';
    if (rem <= 1000) return 'text-orange-500';
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
            <Link
              href="/history"
              className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              작업 이력
            </Link>
          )}
          <button
            onClick={() => setShowLicense(true)}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            라이선스 관리
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

            <div className="flex justify-center pt-2">
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
              onLicenseRefresh={refreshLicense}
            />
          </div>
        )}
      </main>

      {showLicense && (
        <LicenseDialog onClose={() => setShowLicense(false)} onRefresh={refreshLicense} />
      )}
    </div>
  );
}
