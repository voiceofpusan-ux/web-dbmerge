'use client';

import { useCallback, useRef } from 'react';
import { SheetEntry, ColumnMap } from '@/types';
import { loadFile } from '@/lib/loader';

interface Props {
  sheets: SheetEntry[];
  onSheetsChange: (sheets: SheetEntry[]) => void;
  selectedId: string | null;
  onSelectSheet: (id: string) => void;
}

const FIELD_LABELS: { key: keyof ColumnMap; label: string }[] = [
  { key: 'group',     label: '그룹' },
  { key: 'last_name', label: '성' },
  { key: 'name',      label: '이름' },
  { key: 'phone',     label: '폰번호' },
  { key: 'memo',      label: '메모' },
];

export default function UploadPanel({ sheets, onSheetsChange, selectedId, onSelectSheet }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      const newSheets: SheetEntry[] = [];
      for (const file of arr) {
        try {
          const loaded = await loadFile(file);
          for (const s of loaded) {
            newSheets.push({ ...s, id: `${Date.now()}-${Math.random()}` });
          }
        } catch (e) {
          alert(`파일 로드 오류: ${file.name}\n${e}`);
        }
      }
      const next = [...sheets, ...newSheets];
      onSheetsChange(next);
      if (newSheets.length > 0) onSelectSheet(newSheets[0].id);
    },
    [sheets, onSheetsChange, onSelectSheet],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleColumnChange = (id: string, field: keyof ColumnMap, value: string) => {
    onSheetsChange(
      sheets.map((s) =>
        s.id === id ? { ...s, columnMap: { ...s.columnMap, [field]: value } } : s,
      ),
    );
  };

  const handleRemove = (id: string) => {
    const next = sheets.filter((s) => s.id !== id);
    onSheetsChange(next);
    if (selectedId === id) onSelectSheet(next[0]?.id ?? '');
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 드롭존 */}
      <div
        className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        <p className="text-gray-500 text-sm">엑셀/CSV 파일을 드래그하거나 클릭하여 업로드</p>
        <p className="text-gray-400 text-xs mt-1">.xlsx .xls .csv 지원 · 다중 파일 가능</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* 시트 목록 */}
      {sheets.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-3 py-2 text-left font-medium text-gray-600 w-48">파일명 [시트]</th>
                  {FIELD_LABELS.map(({ key, label }) => (
                    <th key={key} className="px-2 py-2 text-left font-medium text-gray-600 w-28">
                      {label}
                    </th>
                  ))}
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {sheets.map((sheet) => (
                  <tr
                    key={sheet.id}
                    className={`border-b cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedId === sheet.id ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => onSelectSheet(sheet.id)}
                  >
                    <td className="px-3 py-2 text-gray-700 max-w-[180px]">
                      <div className="truncate font-medium">{sheet.fileName}</div>
                      <div className="text-gray-400">[{sheet.sheetName}]</div>
                    </td>
                    {FIELD_LABELS.map(({ key }) => (
                      <td key={key} className="px-2 py-1.5">
                        <select
                          value={sheet.columnMap[key]}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleColumnChange(sheet.id, key, e.target.value);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white w-full"
                        >
                          <option value="">-</option>
                          {sheet.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemove(sheet.id);
                        }}
                        className="text-red-400 hover:text-red-600 font-bold leading-none"
                        title="삭제"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
