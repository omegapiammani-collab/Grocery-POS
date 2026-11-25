'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clock,
  Lock,
  Unlock,
  CheckCircle2,
  Receipt,
  Plus,
  ArrowDownCircle,
  ArrowUpCircle,
  Eye,
  Calculator,
  RotateCcw,
  Copy,
  Check,
  Edit3,
  Download,
  Search,
  X,
  Printer,
  Award,
  TrendingUp,
  PieChart,
  AlertTriangle,
  Wallet,
  ArrowLeftRight,
  ArrowUpRight,
  ArrowDownRight,
  UserCheck,
  Users,
  Upload,
  Database,
  Pin,
  StickyNote,
  Trash2,
  Target,
  MessageSquare,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Modal } from '@/components/Modal';
import { createClient } from '@/lib/supabase/client';
import { formatBaht, formatDateTime, formatNumber } from '@/lib/format';
import type { DebtPayment, Expense, PaymentMethod, Sale, Shift, StoreSettings } from '@/types/pos';

type DebtPaymentWithCustomer = DebtPayment & { customers?: { name: string } | null };

type ShiftSalesTotals = {
  cash: number;
  qr: number;
  credit: number;
  total: number;
  billCount: number;
};

const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;

const CASH_DRAWER_SAFE_LIMIT = 10000;
const SAFE_DROP_NOTE_PREFIX = '[เก็บเงินเข้าเซฟ]';
const SAFE_DROP_QUICK_AMOUNTS = [2000, 5000, 10000] as const;

function isSafeCashDropExpense(exp: Pick<Expense, 'type' | 'note'>): boolean {
  return exp.type === 'expense' && (exp.note ?? '').trim().startsWith(SAFE_DROP_NOTE_PREFIX);
}

const SHIFT_CASHIER_NAMES_STORAGE_KEY = 'shift_cashier_names_v1';
const SHIFT_NEXT_FLOATS_STORAGE_KEY = 'shift_next_floats_v1';
const SHIFT_HANDOVER_MEMO_STORAGE_KEY = 'pos_shift_handover_memo_v1';
const SHIFT_SALES_TARGET_STORAGE_KEY = 'shift_sales_target_v1';
const SHIFT_VARIANCE_REASONS_STORAGE_KEY = 'shift_variance_reasons_v1';
const DEFAULT_SHIFT_SALES_TARGET = 3000;
const SHIFT_VARIANCE_REASON_PRESETS = [
  'ทอนเงินผิด/ปัดเศษให้ลูกค้า',
  'ลืมลงบันทึกรายจ่ายหน้าร้าน',
  'ลูกค้าโอนแต่กดรับเป็นเงินสด',
  'เงินทอนปน/นับเหรียญคลาดเคลื่อน',
  'ตรวจสอบแล้วรับทราบส่วนต่าง',
] as const;

function parseShiftSalesTarget(raw: string | null): number {
  if (!raw) return DEFAULT_SHIFT_SALES_TARGET;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed * 100) / 100;
    }
    if (typeof parsed === 'string') {
      const num = Number(parsed);
      if (Number.isFinite(num) && num > 0) {
        return Math.round(num * 100) / 100;
      }
    }
  } catch {
    const num = Number(raw);
    if (Number.isFinite(num) && num > 0) {
      return Math.round(num * 100) / 100;
    }
  }
  return DEFAULT_SHIFT_SALES_TARGET;
}

function getShiftTargetAchievement(salesAmount: number, target: number) {
  const effectiveTarget = target > 0 ? target : DEFAULT_SHIFT_SALES_TARGET;
  const pct = effectiveTarget > 0 ? (salesAmount / effectiveTarget) * 100 : 0;
  const reached = salesAmount >= effectiveTarget;
  const label = reached
    ? `🎯 ทะลุเป้า (${pct.toFixed(0)}%)`
    : `${pct.toFixed(0)}% ของเป้า`;
  return { target: effectiveTarget, pct, reached, label };
}

function getCashAccuracyGrade(actualCash: number | null, expectedCash: number | null) {
  if (actualCash === null || !Number.isFinite(Number(actualCash))) return null;
  const expected = Number(expectedCash ?? 0);
  if (!Number.isFinite(expected)) return null;
  const absDiff = Math.abs(Number(actualCash) - expected);
  if (absDiff < 0.01) {
    return {
      grade: 'A+' as const,
      label: '🏆 เกรด A+ (ตรงเป๊ะ)',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    };
  }
  if (absDiff <= 20) {
    return {
      grade: 'B' as const,
      label: '✅ เกรด B (คลาดเคลื่อน ≤฿20)',
      badgeClass: 'bg-sky-100 text-sky-800 border-sky-200',
    };
  }
  return {
    grade: 'C' as const,
    label: '⚠️ เกรด C (ต่างเกิน ฿20)',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-200',
  };
}

interface ShiftHandoverMemo {
  text: string;
  author: string;
  updatedAt: string;
  urgent: boolean;
}

function parseShiftNextFloatsMap(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        clean[k] = Math.round(v * 100) / 100;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function calcNetCashDrop(actualCash: number | null, nextShiftFloat: number): number | null {
  if (actualCash === null) return null;
  const cleanActual = Number.isFinite(actualCash) ? actualCash : 0;
  const cleanFloat = Math.max(0, Number.isFinite(nextShiftFloat) ? nextShiftFloat : 0);
  return Math.max(0, Math.round((cleanActual - cleanFloat) * 100) / 100);
}

const SHIFT_CLOSING_CHECKLIST_ITEMS = [
  { id: 'cash', label: 'นับเงินสดในลิ้นชักครบถ้วนแล้ว' },
  { id: 'qr', label: 'ตรวจสอบยอดเงินโอน QR ในแอปธนาคารแล้ว' },
  { id: 'float', label: 'เตรียมเงินทอนตั้งต้นสำหรับกะถัดไปแล้ว' },
  { id: 'lock', label: 'ตรวจเช็กตู้แช่และล็อกร้านเรียบร้อย' },
] as const;

type ShiftClosingChecklistId = (typeof SHIFT_CLOSING_CHECKLIST_ITEMS)[number]['id'];

const createEmptyClosingChecklist = (): Record<ShiftClosingChecklistId, boolean> => ({
  cash: false,
  qr: false,
  float: false,
  lock: false,
});

function formatClosingChecklistNote(
  checklist: Record<ShiftClosingChecklistId, boolean>
): string {
  const checkedCount = SHIFT_CLOSING_CHECKLIST_ITEMS.filter(
    (item) => checklist[item.id]
  ).length;
  const itemsText = SHIFT_CLOSING_CHECKLIST_ITEMS.map(
    (item) => `${checklist[item.id] ? '✓' : '✗'} ${item.label}`
  ).join(', ');
  return `[เช็กลิสต์ปิดกะ ${checkedCount}/${SHIFT_CLOSING_CHECKLIST_ITEMS.length}: ${itemsText}]`;
}

function parseShiftCashierNamesMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed) {
          clean[k] = trimmed;
        }
      }
    }
    return clean;
  } catch {
    return {};
  }
}

interface ShiftMetaBackupParsed {
  keysPresent: Array<
    | typeof SHIFT_CASHIER_NAMES_STORAGE_KEY
    | typeof SHIFT_NEXT_FLOATS_STORAGE_KEY
    | typeof SHIFT_HANDOVER_MEMO_STORAGE_KEY
    | typeof SHIFT_SALES_TARGET_STORAGE_KEY
    | typeof SHIFT_VARIANCE_REASONS_STORAGE_KEY
  >;
  cashierNames?: Record<string, string>;
  nextFloats?: Record<string, number>;
  handoverMemo?: ShiftHandoverMemo | null;
  salesTarget?: number;
  varianceReasons?: Record<string, string>;
  error?: string;
}

const isPlainRecordObject = (val: unknown): val is Record<string, unknown> =>
  Boolean(val) && typeof val === 'object' && !Array.isArray(val);

function normalizeShiftHandoverMemo(val: unknown): ShiftHandoverMemo | null {
  if (!isPlainRecordObject(val)) return null;
  const text = typeof val.text === 'string' ? val.text.trim() : '';
  if (!text) return null;
  const author = typeof val.author === 'string' ? val.author.trim() : '';
  const updatedAt = typeof val.updatedAt === 'string' ? val.updatedAt.trim() : '';
  const urgent = Boolean(val.urgent);
  return {
    text,
    author,
    updatedAt,
    urgent,
  };
}

function parseShiftHandoverMemo(raw: string | null): ShiftHandoverMemo | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return normalizeShiftHandoverMemo(parsed);
  } catch {
    return null;
  }
}

function parseShiftMetaBackupJson(rawText: string): ShiftMetaBackupParsed {
  const cleaned = rawText.replace(/^\uFEFF/, '').trim();
  if (!cleaned) {
    return {
      keysPresent: [],
      error: 'กรุณาวางข้อความ JSON หรือเลือกไฟล์ .json ก่อนกู้คืนข้อมูล',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      keysPresent: [],
      error: 'รูปแบบ JSON ไม่ถูกต้อง กรุณาตรวจสอบไฟล์หรือข้อความที่วาง',
    };
  }

  if (!isPlainRecordObject(parsed)) {
    return {
      keysPresent: [],
      error: 'ข้อมูล JSON ต้องอยู่ในรูปแบบ Object ({ ... })',
    };
  }

  const allKeys = [
    SHIFT_CASHIER_NAMES_STORAGE_KEY,
    SHIFT_NEXT_FLOATS_STORAGE_KEY,
    SHIFT_HANDOVER_MEMO_STORAGE_KEY,
    SHIFT_SALES_TARGET_STORAGE_KEY,
    SHIFT_VARIANCE_REASONS_STORAGE_KEY,
  ] as const;

  const hasRootKey = allKeys.some((k) =>
    Object.prototype.hasOwnProperty.call(parsed, k)
  );
  const source: Record<string, unknown> =
    !hasRootKey && isPlainRecordObject(parsed.data) ? parsed.data : parsed;

  const keysPresent: ShiftMetaBackupParsed['keysPresent'] = [];
  const result: ShiftMetaBackupParsed = { keysPresent };

  for (const key of allKeys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const rawVal = source[key];
    if (key === SHIFT_SALES_TARGET_STORAGE_KEY) {
      if (typeof rawVal !== 'number' || !Number.isFinite(rawVal) || rawVal <= 0) {
        return {
          keysPresent: [],
          error: `ข้อมูลของ "${key}" ต้องเป็นตัวเลขมากกว่า 0`,
        };
      }
      keysPresent.push(key);
      result.salesTarget = Math.round(rawVal * 100) / 100;
      continue;
    }
    if (key === SHIFT_HANDOVER_MEMO_STORAGE_KEY) {
      if (rawVal === null) {
        keysPresent.push(key);
        result.handoverMemo = null;
        continue;
      }
      if (!isPlainRecordObject(rawVal)) {
        return {
          keysPresent: [],
          error: `ข้อมูลของ "${key}" ต้องเป็น Object ({ text, author, updatedAt, urgent }) หรือ null`,
        };
      }
      if (rawVal.text !== undefined && typeof rawVal.text !== 'string') {
        return {
          keysPresent: [],
          error: `ข้อมูลของ "${key}" ต้องมีฟิลด์ text เป็นข้อความ (String)`,
        };
      }
      keysPresent.push(key);
      result.handoverMemo = normalizeShiftHandoverMemo(rawVal);
      continue;
    }
    if (!isPlainRecordObject(rawVal)) {
      return {
        keysPresent: [],
        error: `ข้อมูลของ "${key}" ต้องเป็น Object ({ ... })`,
      };
    }
    keysPresent.push(key);
    const serialized = JSON.stringify(rawVal);
    if (key === SHIFT_CASHIER_NAMES_STORAGE_KEY) {
      result.cashierNames = parseShiftCashierNamesMap(serialized);
    } else if (key === SHIFT_NEXT_FLOATS_STORAGE_KEY) {
      result.nextFloats = parseShiftNextFloatsMap(serialized);
    } else if (key === SHIFT_VARIANCE_REASONS_STORAGE_KEY) {
      result.varianceReasons = parseShiftCashierNamesMap(serialized);
    }
  }

  if (keysPresent.length === 0) {
    // Backward compatibility: allow legacy direct map { "shift-id": "ชื่อผู้ดูแลกะ" }
    const entries = Object.entries(parsed);
    const hasKnownWrapper =
      Object.prototype.hasOwnProperty.call(parsed, 'version') ||
      Object.prototype.hasOwnProperty.call(parsed, 'data') ||
      entries.some(
        ([k]) =>
          k.startsWith('pos_') ||
          k.startsWith('inventory_') ||
          k.startsWith('customer_') ||
          k.startsWith('shift_')
      );
    const looksLikeDirectCashierMap =
      !hasKnownWrapper &&
      entries.length > 0 &&
      entries.every(([, v]) => typeof v === 'string');

    if (looksLikeDirectCashierMap) {
      return {
        keysPresent: [SHIFT_CASHIER_NAMES_STORAGE_KEY],
        cashierNames: parseShiftCashierNamesMap(JSON.stringify(parsed)),
      };
    }

    return {
      keysPresent: [],
      error: `ไม่พบคีย์ตั้งค่ากะที่รองรับ (${SHIFT_CASHIER_NAMES_STORAGE_KEY}, ${SHIFT_NEXT_FLOATS_STORAGE_KEY}, ${SHIFT_HANDOVER_MEMO_STORAGE_KEY}, ${SHIFT_SALES_TARGET_STORAGE_KEY}, ${SHIFT_VARIANCE_REASONS_STORAGE_KEY})`,
    };
  }

  return result;
}

function CashierNameSelector({
  value,
  onChange,
  presets,
  label = 'ผู้ดูแลกะ / แคชเชียร์',
  placeholder = 'เช่น คุณสมชาย, แคชเชียร์กะเช้า',
  autoFocus = false,
  compact = false,
}: {
  value: string;
  onChange: (val: string) => void;
  presets: string[];
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      <div className="relative">
        <UserCheck className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-xl border border-slate-300 bg-white pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none ${
            compact ? 'py-2' : 'py-2.5'
          }`}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="ล้างชื่อผู้ดูแลกะ"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {presets.length > 0 && (
        <div className="mt-2 space-y-1">
          <span className="block text-[11px] font-medium text-slate-500">
            เลือกชื่อที่เคยบันทึกไว้:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => {
              const isSelected = value.trim() === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onChange(preset)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    isSelected
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800'
                  }`}
                >
                  <UserCheck className="h-3 w-3 shrink-0" />
                  <span>{preset}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function formatBahtPrefix(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return (
    '฿' +
    new Intl.NumberFormat('th-TH', {
      minimumFractionDigits: rounded % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(rounded)
  );
}

/** Shared Net Cash Drop / Handover calculator used in close-shift and closed-shift detail modals. */
function NetCashDropCalculator({
  inputId,
  actualCash,
  openingCash,
  nextShiftFloatInput,
  onNextShiftFloatChange,
  safeDropInShift = 0,
}: {
  inputId: string;
  actualCash: number | null;
  openingCash: number;
  nextShiftFloatInput: string;
  onNextShiftFloatChange: (val: string) => void;
  safeDropInShift?: number;
}) {
  const parsedNextFloat = Math.max(0, Number(nextShiftFloatInput) || 0);
  const netCashDrop = calcNetCashDrop(actualCash, parsedNextFloat);
  const totalShiftOwnerHandover =
    netCashDrop !== null ? Math.round((safeDropInShift + netCashDrop) * 100) / 100 : null;
  const isShortOfFloat = actualCash !== null && actualCash < parsedNextFloat;
  const isLessThanOpening = parsedNextFloat < openingCash;
  const openingFloatDiff = Math.round((openingCash - parsedNextFloat) * 100) / 100;

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
          <Wallet className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>ตัวคำนวณยอดเงินสดนำส่งเจ้าของร้าน (Net Cash Drop)</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onNextShiftFloatChange(String(openingCash))}
            className="rounded-lg border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 transition-colors"
          >
            เท่าเงินทอนกะนี้ ({formatBahtPrefix(openingCash)})
          </button>
          <button
            type="button"
            onClick={() => onNextShiftFloatChange('0')}
            className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            นำส่งทั้งหมด (฿0)
          </button>
        </div>
      </div>

      <div>
        <label
          htmlFor={inputId}
          className="block text-xs font-semibold text-slate-700 mb-1"
        >
          เงินทอนเก็บไว้เปิดกะถัดไป (บาท)
        </label>
        <input
          id={inputId}
          type="number"
          min="0"
          step="0.5"
          value={nextShiftFloatInput}
          onChange={(e) => onNextShiftFloatChange(e.target.value)}
          className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-base font-bold tabular-nums text-slate-900 focus:border-emerald-500 focus:outline-none"
        />
        <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
          ค่าเริ่มต้นเท่ากับเงินทอนตั้งต้นของกะนี้ ({formatBaht(openingCash)})
        </p>
      </div>

      <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2.5 flex items-center justify-between gap-3 tabular-nums">
        <div className="min-w-0">
          <span className="text-xs font-bold text-slate-900 block">
            ยอดเงินสดนำส่งเจ้าของร้าน (Net Cash Drop)
          </span>
          <span className="text-[11px] text-slate-500 block">
            {actualCash !== null
              ? `นับได้จริง ${formatBaht(actualCash)} − เงินทอนกะถัดไป ${formatBaht(parsedNextFloat)}`
              : 'ยังไม่มีข้อมูลเงินสดที่นับได้จริง'}
          </span>
        </div>
        <span className="text-lg font-extrabold text-emerald-700 shrink-0">
          {netCashDrop !== null ? formatBaht(netCashDrop) : '-'}
        </span>
      </div>

      {safeDropInShift > 0 && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2.5 flex items-center justify-between gap-3 tabular-nums">
          <div className="min-w-0">
            <span className="text-xs font-bold text-indigo-950 block">
              เงินสดนำส่งเจ้าของร้านรวมทั้งกะ (เก็บระหว่างกะ + นำส่งตอนปิดกะ)
            </span>
            <span className="text-[11px] text-indigo-700 block">
              เก็บเข้าเซฟระหว่างกะ {formatBaht(safeDropInShift)} + นำส่งตอนปิดกะ{' '}
              {netCashDrop !== null ? formatBaht(netCashDrop) : '-'}
            </span>
          </div>
          <span className="text-lg font-extrabold text-indigo-700 shrink-0">
            {totalShiftOwnerHandover !== null ? formatBaht(totalShiftOwnerHandover) : '-'}
          </span>
        </div>
      )}

      {isLessThanOpening && (
        <p className="text-[11px] font-medium text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-1.5 tabular-nums">
          ⚠️ เงินทอนเก็บไว้กะถัดไปน้อยกว่าเงินทอนตั้งต้น {formatBaht(openingFloatDiff)} (ตั้งต้น{' '}
          {formatBaht(openingCash)} → เก็บไว้ {formatBaht(parsedNextFloat)})
        </p>
      )}

      {isShortOfFloat && actualCash !== null && (
        <p className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 tabular-nums">
          เงินสดที่นับได้จริงน้อยกว่าเงินทอนกะถัดไปที่ตั้งไว้ ({formatBaht(parsedNextFloat - actualCash)}) จึงไม่มียอดนำส่งเข้าเซฟ/ส่งเจ้าของร้าน
        </p>
      )}
    </div>
  );
}

function formatShiftComparisonDelta(
  current: number,
  previous: number
): {
  diff: number;
  pct: number;
  text: string;
  direction: 'up' | 'down' | 'flat';
} {
  const diff = Math.round((current - previous) * 100) / 100;
  const pct =
    previous === 0
      ? diff > 0
        ? 100
        : diff < 0
          ? -100
          : 0
      : ((current - previous) / Math.abs(previous)) * 100;
  const roundedPct = Math.round(pct * 10) / 10;

  if (diff > 0) {
    return {
      diff,
      pct: roundedPct,
      text: `+${formatBahtPrefix(diff)} / +${Math.abs(roundedPct).toFixed(1)}%`,
      direction: 'up',
    };
  }
  if (diff < 0) {
    return {
      diff,
      pct: roundedPct,
      text: `-${formatBahtPrefix(Math.abs(diff))} / -${Math.abs(roundedPct).toFixed(1)}%`,
      direction: 'down',
    };
  }
  return {
    diff: 0,
    pct: 0,
    text: `${formatBahtPrefix(0)} / 0.0%`,
    direction: 'flat',
  };
}

const EXPENSE_CATEGORY_PRESETS = [
  'ซื้อของเข้าร้าน',
  'ค่าน้ำแข็ง/ถุง',
  'ค่าขนส่ง',
  'ค่าน้ำ/ไฟ',
  'อื่นๆ',
] as const;

const EXPENSE_NOTE_PRESETS = [
  'ซื้อน้ำแข็ง/ของสด',
  'ค่าถุง/บรรจุภัณฑ์',
  'ค่าขนส่ง',
  'ค่าใช้จ่ายเบ็ดเตล็ด',
] as const;

const INCOME_NOTE_PRESETS = [
  'เติมเงินทอนเหรียญ/แบงก์ย่อย',
  'สำรองเงินสดเข้าลิ้นชัก',
  'รับเงินมัดจำภาชนะสด',
  'รายรับเบ็ดเตล็ด',
] as const;

const PAYMENT_LABEL: Record<PaymentMethod, { label: string; badgeClass: string }> = {
  cash: { label: 'เงินสด', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  qr: { label: 'PromptPay QR', badgeClass: 'bg-sky-50 text-sky-700 border-sky-200' },
  credit: { label: 'เงินเชื่อ', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200' },
};

const EXPENSE_SUMMARY_COLORS = [
  '#e11d48',
  '#f97316',
  '#f59e0b',
  '#8b5cf6',
  '#0ea5e9',
  '#14b8a6',
  '#64748b',
] as const;

const DEFAULT_SHIFT_EXPENSE_CATEGORIES = new Set([
  '',
  'อื่นๆ',
  'รายจ่ายในกะ',
  'จ่ายค่าของสด/น้ำแข็ง',
]);

function getShiftExpenseGroupLabel(exp: Expense): string {
  const cat = exp.category?.trim() ?? '';
  const note = exp.note?.trim() ?? '';
  if (note && DEFAULT_SHIFT_EXPENSE_CATEGORIES.has(cat)) {
    return note;
  }
  return cat || note || 'ทั่วไป';
}

type ShiftExpenseCategoryBreakdown = {
  expenseGroups: {
    key: string;
    label: string;
    count: number;
    amount: number;
    pct: number;
    color: string;
  }[];
  incomeGroups: {
    key: string;
    label: string;
    count: number;
    amount: number;
  }[];
  totalExpense: number;
  expenseCount: number;
  totalIncome: number;
  incomeCount: number;
};

function summarizeShiftExpenses(list: Expense[]): ShiftExpenseCategoryBreakdown {
  const expenseMap = new Map<string, { key: string; label: string; count: number; amount: number }>();
  const incomeMap = new Map<string, { key: string; label: string; count: number; amount: number }>();
  let totalExpense = 0;
  let expenseCount = 0;
  let totalIncome = 0;
  let incomeCount = 0;

  for (const exp of list) {
    const label = getShiftExpenseGroupLabel(exp);
    const amt = Number(exp.amount) || 0;
    if (exp.type === 'income') {
      totalIncome += amt;
      incomeCount += 1;
      const prev = incomeMap.get(label) ?? { key: `income:${label}`, label, count: 0, amount: 0 };
      prev.count += 1;
      prev.amount += amt;
      incomeMap.set(label, prev);
    } else {
      totalExpense += amt;
      expenseCount += 1;
      const prev = expenseMap.get(label) ?? { key: `expense:${label}`, label, count: 0, amount: 0 };
      prev.count += 1;
      prev.amount += amt;
      expenseMap.set(label, prev);
    }
  }

  const expenseGroups = [...expenseMap.values()]
    .sort((a, b) => b.amount - a.amount || b.count - a.count || a.label.localeCompare(b.label))
    .map((item, idx) => ({
      ...item,
      pct: totalExpense > 0 ? (item.amount / totalExpense) * 100 : 0,
      color: EXPENSE_SUMMARY_COLORS[idx % EXPENSE_SUMMARY_COLORS.length],
    }));

  const incomeGroups = [...incomeMap.values()].sort(
    (a, b) => b.amount - a.amount || b.count - a.count || a.label.localeCompare(b.label)
  );

  return {
    expenseGroups,
    incomeGroups,
    totalExpense,
    expenseCount,
    totalIncome,
    incomeCount,
  };
}

function parseDebtPaymentAmounts(
  amount: number | string | null | undefined,
  note: string | null | undefined
) {
  const totalReduction = Math.max(0, Number(amount ?? 0) || 0);
  const match = note?.match(/\(ยกเว้น\/ลดเศษหนี้ให้\s*฿([\d,]+(?:\.\d+)?)\)/);
  const rawWaived = match ? Number(match[1].replace(/,/g, '')) : 0;
  const waivedAmount =
    Number.isFinite(rawWaived) && rawWaived > 0
      ? Math.min(totalReduction, Math.round(rawWaived * 100) / 100)
      : 0;
  const actualCollected = Math.max(0, Math.round((totalReduction - waivedAmount) * 100) / 100);
  return { totalReduction, waivedAmount, actualCollected };
}

/** Shared table displaying in-shift debt payments (active shift & closed-shift detail modal). */
function InShiftDebtPaymentsTable({
  payments,
  title,
}: {
  payments: DebtPaymentWithCustomer[];
  title: string;
}) {
  const totalAmount =
    Math.round(
      payments.reduce((sum, d) => sum + parseDebtPaymentAmounts(d.amount, d.note).actualCollected, 0) *
        100
    ) / 100;
  const cashAmount =
    Math.round(
      payments
        .filter((d) => d.payment_method === 'cash')
        .reduce((sum, d) => sum + parseDebtPaymentAmounts(d.amount, d.note).actualCollected, 0) *
        100
    ) / 100;
  const qrAmount =
    Math.round(
      payments
        .filter((d) => d.payment_method !== 'cash')
        .reduce((sum, d) => sum + parseDebtPaymentAmounts(d.amount, d.note).actualCollected, 0) *
        100
    ) / 100;
  const totalWaived =
    Math.round(
      payments.reduce((sum, d) => sum + parseDebtPaymentAmounts(d.amount, d.note).waivedAmount, 0) *
        100
    ) / 100;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-700">
          {title} ({payments.length} รายการ)
        </span>
        {payments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold tabular-nums">
            <span className="text-emerald-700">รวมรับจริง {formatBaht(totalAmount)}</span>
            {cashAmount > 0 && (
              <span className="rounded-md bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-emerald-700">
                เงินสด {formatBaht(cashAmount)}
              </span>
            )}
            {qrAmount > 0 && (
              <span className="rounded-md bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-sky-700">
                โอน QR {formatBaht(qrAmount)}
              </span>
            )}
            {totalWaived > 0 && (
              <span className="rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-amber-800">
                ยกเว้นเศษหนี้ {formatBaht(totalWaived)}
              </span>
            )}
          </div>
        )}
      </div>

      {payments.length === 0 ? (
        <p className="text-xs text-slate-400 py-1">ยังไม่มีรายการรับชำระหนี้ในกะนี้</p>
      ) : (
        <div className="overflow-x-auto max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs border-collapse tabular-nums">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th scope="col" className="py-2 px-2.5 text-left font-bold whitespace-nowrap">
                  ชื่อลูกค้า
                </th>
                <th scope="col" className="py-2 px-2.5 text-left font-bold whitespace-nowrap">
                  เวลา
                </th>
                <th scope="col" className="py-2 px-2.5 text-left font-bold whitespace-nowrap">
                  ช่องทาง
                </th>
                <th scope="col" className="py-2 px-2.5 text-left font-bold whitespace-nowrap">
                  หมายเหตุ
                </th>
                <th scope="col" className="py-2 px-2.5 text-right font-bold whitespace-nowrap">
                  ยอดรับชำระ
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((dp) => {
                const { actualCollected, waivedAmount } = parseDebtPaymentAmounts(dp.amount, dp.note);
                return (
                  <tr key={dp.id} className="hover:bg-slate-50/70">
                    <td className="py-2 px-2.5 font-semibold text-slate-800 whitespace-nowrap">
                      {dp.customers?.name ?? 'ลูกค้าไม่ระบุชื่อ'}
                    </td>
                    <td className="py-2 px-2.5 text-slate-500 whitespace-nowrap">
                      {formatDateTime(dp.created_at)}
                    </td>
                    <td className="py-2 px-2.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${
                          dp.payment_method === 'cash'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-sky-50 text-sky-700 border-sky-200'
                        }`}
                      >
                        {dp.payment_method === 'cash' ? 'เงินสด' : 'โอน QR'}
                      </span>
                    </td>
                    <td className="py-2 px-2.5 text-slate-600 max-w-[200px] truncate" title={dp.note ?? ''}>
                      {dp.note?.trim() ? dp.note : '-'}
                    </td>
                    <td className="py-2 px-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {waivedAmount > 0 && (
                          <span className="rounded bg-emerald-50 border border-emerald-200 px-1 py-0.5 text-[10px] font-bold text-emerald-700">
                            รับจริง
                          </span>
                        )}
                        <span className="font-bold text-emerald-700">
                          +{formatBaht(actualCollected)}
                        </span>
                      </div>
                      {waivedAmount > 0 && (
                        <div className="mt-0.5 flex items-center justify-end gap-1">
                          <span className="rounded bg-amber-50 border border-amber-200 px-1 py-0.5 text-[10px] font-semibold text-amber-800">
                            ยกเว้น/ลดหนี้ {formatBaht(waivedAmount)}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ShiftExpenseCategorySummary({
  breakdown,
}: {
  breakdown: ShiftExpenseCategoryBreakdown;
}) {
  if (breakdown.expenseGroups.length === 0 && breakdown.incomeGroups.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 font-bold text-slate-700">
          <PieChart className="h-3.5 w-3.5 text-rose-600 shrink-0" />
          <span>สรุปสัดส่วนรายจ่ายแยกตามหมายเหตุ / หมวดหมู่</span>
        </span>
        <div className="flex flex-wrap items-center gap-2.5 tabular-nums">
          {breakdown.expenseCount > 0 && (
            <span className="font-bold text-rose-700">
              รวมรายจ่าย ({breakdown.expenseCount} ครั้ง): -{formatBaht(breakdown.totalExpense)}
            </span>
          )}
          {breakdown.incomeCount > 0 && (
            <span className="font-bold text-emerald-700">
              รวมรับสดเพิ่ม ({breakdown.incomeCount} ครั้ง): +{formatBaht(breakdown.totalIncome)}
            </span>
          )}
        </div>
      </div>

      {breakdown.expenseGroups.length > 0 && (
        <>
          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden flex">
            {breakdown.expenseGroups.map((g) =>
              g.pct > 0 ? (
                <div
                  key={g.key}
                  style={{ width: `${g.pct}%`, backgroundColor: g.color }}
                  className="h-full transition-all duration-300"
                  title={`${g.label}: ${g.count} ครั้ง · ${formatBaht(g.amount)} (${g.pct.toFixed(1)}%)`}
                />
              ) : null
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {breakdown.expenseGroups.map((g) => (
              <div
                key={g.key}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50/70 px-2.5 py-1 text-[11px] text-rose-900"
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: g.color }}
                />
                <span className="font-semibold">{g.label}</span>
                <span className="text-rose-700/80 tabular-nums">({g.count} ครั้ง)</span>
                <span className="font-extrabold tabular-nums text-rose-700">
                  -{formatBaht(g.amount)}
                </span>
                <span className="rounded bg-white/80 px-1 py-0.5 text-[10px] font-bold text-rose-700 tabular-nums">
                  {g.pct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {breakdown.incomeGroups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {breakdown.incomeGroups.map((g) => (
            <div
              key={g.key}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] text-emerald-900"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="font-semibold">{g.label}</span>
              <span className="text-emerald-700/80 tabular-nums">({g.count} ครั้ง)</span>
              <span className="font-extrabold tabular-nums text-emerald-700">
                +{formatBaht(g.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatShiftDuration(openedAt: string, closedAt: string | null): string {
  if (!closedAt) return '-';
  const diffMs = new Date(closedAt).getTime() - new Date(openedAt).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return '-';
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} นาที`;
  if (minutes === 0) return `${hours} ชม.`;
  return `${hours} ชม. ${minutes} นาที`;
}

function calcShiftVelocity(
  openedAt: string,
  closedAt: string | null,
  totalSales: number,
  billCount: number
): {
  durationHours: number;
  rawDurationHours: number;
  durationText: string;
  salesPerHour: number;
  billsPerHour: number;
} | null {
  if (!closedAt) return null;
  const openedMs = new Date(openedAt).getTime();
  const closedMs = new Date(closedAt).getTime();
  if (Number.isNaN(openedMs) || Number.isNaN(closedMs)) return null;
  const rawDurationHours = (closedMs - openedMs) / 3600000;
  const durationHours = Math.max(0.25, rawDurationHours);
  return {
    durationHours,
    rawDurationHours,
    durationText: formatShiftDuration(openedAt, closedAt),
    salesPerHour: totalSales / durationHours,
    billsPerHour: billCount / durationHours,
  };
}

export default function ShiftsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [shiftHistory, setShiftHistory] = useState<Shift[]>([]);
  const [closedShiftSalesMap, setClosedShiftSalesMap] = useState<Record<string, ShiftSalesTotals>>({});
  const [closedShiftNetCashMap, setClosedShiftNetCashMap] = useState<Record<string, number>>({});
  const [closedShiftDebtCashMap, setClosedShiftDebtCashMap] = useState<Record<string, number>>({});
  const [closedShiftExpenseMap, setClosedShiftExpenseMap] = useState<Record<string, number>>({});
  const [closedShiftSafeDropMap, setClosedShiftSafeDropMap] = useState<Record<string, number>>({});
  const [salesInShift, setSalesInShift] = useState<Sale[]>([]);
  const [debtCashInShift, setDebtCashInShift] = useState(0);
  const [debtPaymentsInShift, setDebtPaymentsInShift] = useState<DebtPaymentWithCustomer[]>([]);
  const [expenseInShift, setExpenseInShift] = useState(0);
  const [expensesListInShift, setExpensesListInShift] = useState<Expense[]>([]);
  const [activeExpenseFilter, setActiveExpenseFilter] = useState<
    'all' | 'store_expense' | 'safe_drop' | 'income'
  >('all');
  const [activeExpenseSearch, setActiveExpenseSearch] = useState('');
  const [detailExpenseFilter, setDetailExpenseFilter] = useState<
    'all' | 'store_expense' | 'safe_drop' | 'income'
  >('all');
  const [detailExpenseSearch, setDetailExpenseSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [openingCash, setOpeningCash] = useState('500');
  const [useOpeningDenomCounter, setUseOpeningDenomCounter] = useState(false);
  const [openingDenomCounts, setOpeningDenomCounts] = useState<Record<number, string>>({});
  const [shiftCashierNames, setShiftCashierNames] = useState<Record<string, string>>({});
  const [openShiftCashierName, setOpenShiftCashierName] = useState('');
  const [editingActiveCashier, setEditingActiveCashier] = useState(false);
  const [activeCashierInput, setActiveCashierInput] = useState('');
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [actualCash, setActualCash] = useState('');
  const [closeNextShiftFloat, setCloseNextShiftFloat] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [closeVarianceReason, setCloseVarianceReason] = useState('');
  const [closeShiftCashierName, setCloseShiftCashierName] = useState('');
  const [shiftVarianceReasons, setShiftVarianceReasons] = useState<Record<string, string>>({});
  const [detailVarianceReasonInput, setDetailVarianceReasonInput] = useState('');
  const [varianceReasonSavedFlash, setVarianceReasonSavedFlash] = useState(false);
  const [useDenomCounter, setUseDenomCounter] = useState(false);
  const [denomCounts, setDenomCounts] = useState<Record<number, string>>({});
  const [closingChecklist, setClosingChecklist] = useState<
    Record<ShiftClosingChecklistId, boolean>
  >(createEmptyClosingChecklist);
  const [attachChecklistToNote, setAttachChecklistToNote] = useState(false);
  const [shiftNextFloats, setShiftNextFloats] = useState<Record<string, number>>({});
  const [detailNextShiftFloat, setDetailNextShiftFloat] = useState('');
  const [handoverMemo, setHandoverMemo] = useState<ShiftHandoverMemo | null>(null);
  const [editingHandoverMemo, setEditingHandoverMemo] = useState(false);
  const [memoDraftText, setMemoDraftText] = useState('');
  const [memoDraftAuthor, setMemoDraftAuthor] = useState('');
  const [memoDraftUrgent, setMemoDraftUrgent] = useState(false);
  const [closeHandoverMemoText, setCloseHandoverMemoText] = useState('');
  const [closeHandoverMemoUrgent, setCloseHandoverMemoUrgent] = useState(false);

  // Add Expense in Active Shift Modal
  const [expModalOpen, setExpModalOpen] = useState(false);
  const [expType, setExpType] = useState<'expense' | 'income'>('expense');
  const [expCategory, setExpCategory] = useState('จ่ายค่าของสด/น้ำแข็ง');
  const [expAmount, setExpAmount] = useState('');
  const [expNote, setExpNote] = useState('');

  // Mid-Shift Safe Cash Drop Modal
  const [safeDropModalOpen, setSafeDropModalOpen] = useState(false);
  const [safeDropAmount, setSafeDropAmount] = useState('');
  const [safeDropNote, setSafeDropNote] = useState('');
  const [safeDropSubmitting, setSafeDropSubmitting] = useState(false);

  // Edit / Delete Expense in Active Shift
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editExpType, setEditExpType] = useState<'expense' | 'income'>('expense');
  const [editExpCategory, setEditExpCategory] = useState('');
  const [editExpAmount, setEditExpAmount] = useState('');
  const [editExpNote, setEditExpNote] = useState('');
  const [savingEditExpense, setSavingEditExpense] = useState(false);
  const [confirmDeleteExpenseId, setConfirmDeleteExpenseId] = useState<string | null>(null);
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null);

  // Edit Active Shift Opening Cash / Note Modal
  const [editShiftModalOpen, setEditShiftModalOpen] = useState(false);
  const [editOpeningCash, setEditOpeningCash] = useState('');
  const [editShiftNote, setEditShiftNote] = useState('');
  const [editShiftCashierName, setEditShiftCashierName] = useState('');

  // Shift Detail Modal (for history or active shift bills)
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [editingModalCashier, setEditingModalCashier] = useState(false);
  const [modalCashierInput, setModalCashierInput] = useState('');
  const [shiftSalesDetail, setShiftSalesDetail] = useState<Sale[]>([]);
  const [shiftExpensesDetail, setShiftExpensesDetail] = useState<Expense[]>([]);
  const [shiftDebtPaymentsDetail, setShiftDebtPaymentsDetail] = useState<DebtPaymentWithCustomer[]>([]);
  const [shiftDebtCashDetail, setShiftDebtCashDetail] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<'active' | 'modal' | null>(null);
  const [copiedLineTarget, setCopiedLineTarget] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [shiftStatusFilter, setShiftStatusFilter] = useState<
    'all' | 'open' | 'closed' | 'diff' | 'grade_c'
  >('all');
  const [cashierFilter, setCashierFilter] = useState<string>('all');
  const [printRequest, setPrintRequest] = useState<{
    target: 'active' | 'modal';
    mode: 'summary' | 'opening-float';
    seq: number;
  } | null>(null);

  // Shift Sales Target (localStorage 'shift_sales_target_v1')
  const [shiftSalesTarget, setShiftSalesTarget] = useState<number>(DEFAULT_SHIFT_SALES_TARGET);
  const [editingShiftTarget, setEditingShiftTarget] = useState(false);
  const [shiftTargetInput, setShiftTargetInput] = useState('');

  // Cashier Names JSON Backup / Restore Modal
  const [cashierBackupOpen, setCashierBackupOpen] = useState(false);
  const [cashierBackupJsonInput, setCashierBackupJsonInput] = useState('');
  const [cashierBackupFileName, setCashierBackupFileName] = useState('');
  const [cashierRestoreMode, setCashierRestoreMode] = useState<'replace' | 'merge'>('replace');
  const [cashierBackupError, setCashierBackupError] = useState('');
  const [cashierBackupSuccess, setCashierBackupSuccess] = useState('');
  const [cashierJsonCopied, setCashierJsonCopied] = useState(false);

  useEffect(() => {
    if (!printRequest) return;
    const timer = window.setTimeout(() => {
      window.print();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [printRequest]);

  const handlePrintShiftSummary = (target: 'active' | 'modal') => {
    setPrintRequest((prev) => ({ target, mode: 'summary', seq: (prev?.seq ?? 0) + 1 }));
  };

  const handlePrintOpeningFloatSlip = () => {
    if (!activeShift) return;
    setPrintRequest((prev) => ({ target: 'active', mode: 'opening-float', seq: (prev?.seq ?? 0) + 1 }));
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: st }, { data: openSh }, { data: hist }] = await Promise.all([
      supabase.from('store_settings').select('*').limit(1).maybeSingle(),
      supabase.from('shifts').select('*').eq('status', 'open').limit(1).maybeSingle(),
      supabase
        .from('shifts')
        .select('*')
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(20),
    ]);

    const closedList = (hist as Shift[]) ?? [];
    setSettings(st ?? null);
    setActiveShift(openSh ?? null);
    setShiftHistory(closedList);

    const closedShiftIds = closedList.map((sh) => sh.id);
    const closedSalesPromise =
      closedShiftIds.length > 0
        ? supabase
            .from('sales')
            .select('shift_id, payment_method, total_amount')
            .in('shift_id', closedShiftIds)
        : Promise.resolve({
            data: [] as Pick<Sale, 'shift_id' | 'payment_method' | 'total_amount'>[],
          });
    const closedExpensesPromise =
      closedShiftIds.length > 0
        ? supabase
            .from('expenses')
            .select('shift_id, type, amount, note')
            .in('shift_id', closedShiftIds)
        : Promise.resolve({
            data: [] as Pick<Expense, 'shift_id' | 'type' | 'amount' | 'note'>[],
          });
    const closedDebtPaymentsPromise =
      closedShiftIds.length > 0
        ? supabase
            .from('debt_payments')
            .select('shift_id, amount, note')
            .in('shift_id', closedShiftIds)
            .eq('payment_method', 'cash')
        : Promise.resolve({
            data: [] as Pick<DebtPayment, 'shift_id' | 'amount' | 'note'>[],
          });

    let closedSalesRows: Pick<Sale, 'shift_id' | 'payment_method' | 'total_amount'>[] = [];
    let closedExpenseRows: Pick<Expense, 'shift_id' | 'type' | 'amount' | 'note'>[] = [];
    let closedDebtRows: Pick<DebtPayment, 'shift_id' | 'amount' | 'note'>[] = [];

    if (openSh) {
      const [
        { data: sData },
        { data: dpData },
        { data: expData },
        { data: closedSalesData },
        { data: closedExpData },
        { data: closedDebtData },
      ] = await Promise.all([
        supabase
          .from('sales')
          .select('*, customers(name), sale_items(*)')
          .eq('shift_id', openSh.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('debt_payments')
          .select('*, customers(name)')
          .eq('shift_id', openSh.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('expenses')
          .select('*')
          .eq('shift_id', openSh.id)
          .order('created_at', { ascending: false }),
        closedSalesPromise,
        closedExpensesPromise,
        closedDebtPaymentsPromise,
      ]);

      setSalesInShift((sData as Sale[]) ?? []);
      const dpRows = (dpData as DebtPaymentWithCustomer[]) ?? [];
      setDebtPaymentsInShift(dpRows);
      setDebtCashInShift(
        Math.round(
          dpRows
            .filter((d) => d.payment_method === 'cash')
            .reduce((s, d) => s + parseDebtPaymentAmounts(d.amount, d.note).actualCollected, 0) *
            100
        ) / 100
      );
      const expRows = (expData as Expense[]) ?? [];
      setExpensesListInShift(expRows);
      const expNet = expRows.reduce(
        (s, e) => (e.type === 'expense' ? s + Number(e.amount) : s - Number(e.amount)),
        0
      );
      setExpenseInShift(expNet);
      closedSalesRows =
        (closedSalesData as Pick<Sale, 'shift_id' | 'payment_method' | 'total_amount'>[]) ?? [];
      closedExpenseRows =
        (closedExpData as Pick<Expense, 'shift_id' | 'type' | 'amount' | 'note'>[]) ?? [];
      closedDebtRows =
        (closedDebtData as Pick<DebtPayment, 'shift_id' | 'amount' | 'note'>[]) ?? [];
    } else {
      const [{ data: closedSalesData }, { data: closedExpData }, { data: closedDebtData }] =
        await Promise.all([closedSalesPromise, closedExpensesPromise, closedDebtPaymentsPromise]);
      closedSalesRows =
        (closedSalesData as Pick<Sale, 'shift_id' | 'payment_method' | 'total_amount'>[]) ?? [];
      closedExpenseRows =
        (closedExpData as Pick<Expense, 'shift_id' | 'type' | 'amount' | 'note'>[]) ?? [];
      closedDebtRows =
        (closedDebtData as Pick<DebtPayment, 'shift_id' | 'amount' | 'note'>[]) ?? [];
      setSalesInShift([]);
      setDebtPaymentsInShift([]);
      setDebtCashInShift(0);
      setExpenseInShift(0);
      setExpensesListInShift([]);
    }

    const nextClosedSalesMap: Record<string, ShiftSalesTotals> = {};
    for (const sh of closedList) {
      nextClosedSalesMap[sh.id] = { cash: 0, qr: 0, credit: 0, total: 0, billCount: 0 };
    }
    for (const row of closedSalesRows) {
      if (!row.shift_id) continue;
      const entry =
        nextClosedSalesMap[row.shift_id] ??
        (nextClosedSalesMap[row.shift_id] = {
          cash: 0,
          qr: 0,
          credit: 0,
          total: 0,
          billCount: 0,
        });
      const amt = Number(row.total_amount);
      if (row.payment_method === 'cash') entry.cash += amt;
      else if (row.payment_method === 'qr') entry.qr += amt;
      else if (row.payment_method === 'credit') entry.credit += amt;
      entry.total += amt;
      entry.billCount += 1;
    }
    setClosedShiftSalesMap(nextClosedSalesMap);

    const nextClosedNetCashMap: Record<string, number> = {};
    const nextClosedDebtCashMap: Record<string, number> = {};
    const nextClosedExpenseMap: Record<string, number> = {};
    const nextClosedSafeDropMap: Record<string, number> = {};
    for (const sh of closedList) {
      nextClosedNetCashMap[sh.id] = nextClosedSalesMap[sh.id]?.cash ?? 0;
      nextClosedDebtCashMap[sh.id] = 0;
      nextClosedExpenseMap[sh.id] = 0;
      nextClosedSafeDropMap[sh.id] = 0;
    }
    for (const dp of closedDebtRows) {
      if (!dp.shift_id) continue;
      const collected = parseDebtPaymentAmounts(dp.amount, dp.note).actualCollected;
      nextClosedDebtCashMap[dp.shift_id] = (nextClosedDebtCashMap[dp.shift_id] ?? 0) + collected;
      nextClosedNetCashMap[dp.shift_id] = (nextClosedNetCashMap[dp.shift_id] ?? 0) + collected;
    }
    for (const exp of closedExpenseRows) {
      if (!exp.shift_id) continue;
      const amt = Number(exp.amount) || 0;
      if (isSafeCashDropExpense(exp)) {
        nextClosedSafeDropMap[exp.shift_id] =
          Math.round(((nextClosedSafeDropMap[exp.shift_id] ?? 0) + amt) * 100) / 100;
      } else {
        nextClosedExpenseMap[exp.shift_id] =
          (nextClosedExpenseMap[exp.shift_id] ?? 0) + (exp.type === 'expense' ? amt : -amt);
      }
      nextClosedNetCashMap[exp.shift_id] =
        (nextClosedNetCashMap[exp.shift_id] ?? 0) + (exp.type === 'income' ? amt : -amt);
    }
    setClosedShiftNetCashMap(nextClosedNetCashMap);
    setClosedShiftDebtCashMap(nextClosedDebtCashMap);
    setClosedShiftExpenseMap(nextClosedExpenseMap);
    setClosedShiftSafeDropMap(nextClosedSafeDropMap);

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const loadCashierNames = () => {
      try {
        const raw = window.localStorage.getItem(SHIFT_CASHIER_NAMES_STORAGE_KEY);
        setShiftCashierNames(parseShiftCashierNamesMap(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    loadCashierNames();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SHIFT_CASHIER_NAMES_STORAGE_KEY || e.key === null) {
        loadCashierNames();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const loadNextFloats = () => {
      try {
        const raw = window.localStorage.getItem(SHIFT_NEXT_FLOATS_STORAGE_KEY);
        setShiftNextFloats(parseShiftNextFloatsMap(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    loadNextFloats();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SHIFT_NEXT_FLOATS_STORAGE_KEY || e.key === null) {
        loadNextFloats();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const loadHandoverMemo = () => {
      try {
        const raw = window.localStorage.getItem(SHIFT_HANDOVER_MEMO_STORAGE_KEY);
        setHandoverMemo(parseShiftHandoverMemo(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    loadHandoverMemo();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SHIFT_HANDOVER_MEMO_STORAGE_KEY || e.key === null) {
        loadHandoverMemo();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const loadShiftSalesTarget = () => {
      try {
        const raw = window.localStorage.getItem(SHIFT_SALES_TARGET_STORAGE_KEY);
        setShiftSalesTarget(parseShiftSalesTarget(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    loadShiftSalesTarget();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SHIFT_SALES_TARGET_STORAGE_KEY || e.key === null) {
        loadShiftSalesTarget();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const loadVarianceReasons = () => {
      try {
        const raw = window.localStorage.getItem(SHIFT_VARIANCE_REASONS_STORAGE_KEY);
        setShiftVarianceReasons(parseShiftCashierNamesMap(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    loadVarianceReasons();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SHIFT_VARIANCE_REASONS_STORAGE_KEY || e.key === null) {
        loadVarianceReasons();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const saveShiftSalesTarget = useCallback((nextTarget: number) => {
    if (!Number.isFinite(nextTarget) || nextTarget <= 0) return;
    const clean = Math.round(nextTarget * 100) / 100;
    try {
      window.localStorage.setItem(SHIFT_SALES_TARGET_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // Ignore localStorage write errors
    }
    setShiftSalesTarget(clean);
  }, []);

  const saveHandoverMemo = useCallback(
    (input: { text: string; author: string; urgent: boolean }) => {
      const trimmedText = input.text.trim();
      if (!trimmedText) {
        try {
          window.localStorage.removeItem(SHIFT_HANDOVER_MEMO_STORAGE_KEY);
        } catch {
          // Ignore localStorage write errors
        }
        setHandoverMemo(null);
        return null;
      }
      const nextMemo: ShiftHandoverMemo = {
        text: trimmedText,
        author: input.author.trim(),
        updatedAt: new Date().toISOString(),
        urgent: Boolean(input.urgent),
      };
      try {
        window.localStorage.setItem(SHIFT_HANDOVER_MEMO_STORAGE_KEY, JSON.stringify(nextMemo));
      } catch {
        // Ignore localStorage write errors
      }
      setHandoverMemo(nextMemo);
      return nextMemo;
    },
    []
  );

  const clearHandoverMemo = useCallback(() => {
    try {
      window.localStorage.removeItem(SHIFT_HANDOVER_MEMO_STORAGE_KEY);
    } catch {
      // Ignore localStorage write errors
    }
    setHandoverMemo(null);
    setEditingHandoverMemo(false);
    setMemoDraftText('');
    setMemoDraftAuthor('');
    setMemoDraftUrgent(false);
  }, []);

  const toggleHandoverMemoUrgent = useCallback(() => {
    if (!handoverMemo) return;
    const nextMemo: ShiftHandoverMemo = {
      ...handoverMemo,
      urgent: !handoverMemo.urgent,
      updatedAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(SHIFT_HANDOVER_MEMO_STORAGE_KEY, JSON.stringify(nextMemo));
    } catch {
      // Ignore localStorage write errors
    }
    setHandoverMemo(nextMemo);
  }, [handoverMemo]);

  const handleStartEditHandoverMemo = () => {
    const activeCashier = activeShift ? (shiftCashierNames[activeShift.id] ?? '') : '';
    setMemoDraftText(handoverMemo?.text ?? '');
    setMemoDraftAuthor(handoverMemo?.author || activeCashier);
    setMemoDraftUrgent(handoverMemo?.urgent ?? false);
    setEditingHandoverMemo(true);
  };

  const handleSaveHandoverMemoForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!memoDraftText.trim()) return;
    saveHandoverMemo({
      text: memoDraftText,
      author: memoDraftAuthor,
      urgent: memoDraftUrgent,
    });
    setEditingHandoverMemo(false);
  };

  const saveShiftNextFloat = useCallback(
    (shiftId: string, nextFloat: number) => {
      const cleanFloat = Math.max(
        0,
        Number.isFinite(nextFloat) ? Math.round(nextFloat * 100) / 100 : 0
      );
      let base: Record<string, number> = shiftNextFloats;
      try {
        const latestRaw = window.localStorage.getItem(SHIFT_NEXT_FLOATS_STORAGE_KEY);
        if (latestRaw !== null) {
          base = parseShiftNextFloatsMap(latestRaw);
        }
      } catch {
        // Fallback to in-memory state
      }
      const next: Record<string, number> = { ...base, [shiftId]: cleanFloat };
      try {
        window.localStorage.setItem(SHIFT_NEXT_FLOATS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore localStorage write errors
      }
      setShiftNextFloats(next);
    },
    [shiftNextFloats]
  );

  const saveShiftCashierName = useCallback(
    (shiftId: string, cashierName: string) => {
      const trimmed = cashierName.trim();
      let base: Record<string, string> = shiftCashierNames;
      try {
        const latestRaw = window.localStorage.getItem(SHIFT_CASHIER_NAMES_STORAGE_KEY);
        if (latestRaw !== null) {
          base = parseShiftCashierNamesMap(latestRaw);
        }
      } catch {
        // Fallback to in-memory state
      }
      const next: Record<string, string> = { ...base };
      if (trimmed) {
        next[shiftId] = trimmed;
      } else {
        delete next[shiftId];
      }
      try {
        window.localStorage.setItem(SHIFT_CASHIER_NAMES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore localStorage write errors
      }
      setShiftCashierNames(next);
    },
    [shiftCashierNames]
  );

  const saveShiftVarianceReason = useCallback(
    (shiftId: string, reason: string) => {
      const trimmed = reason.trim();
      let base: Record<string, string> = shiftVarianceReasons;
      try {
        const latestRaw = window.localStorage.getItem(SHIFT_VARIANCE_REASONS_STORAGE_KEY);
        if (latestRaw !== null) {
          base = parseShiftCashierNamesMap(latestRaw);
        }
      } catch {
        // Fallback to in-memory state
      }
      const next: Record<string, string> = { ...base };
      if (trimmed) {
        next[shiftId] = trimmed;
      } else {
        delete next[shiftId];
      }
      try {
        window.localStorage.setItem(SHIFT_VARIANCE_REASONS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore localStorage write errors
      }
      setShiftVarianceReasons(next);
    },
    [shiftVarianceReasons]
  );

  const buildCashierBackupPayload = () => {
    let latestCashierNames: Record<string, string> = shiftCashierNames;
    let latestNextFloats: Record<string, number> = shiftNextFloats;
    let latestHandoverMemo: ShiftHandoverMemo | null = handoverMemo;
    let latestSalesTarget: number = shiftSalesTarget;
    let latestVarianceReasons: Record<string, string> = shiftVarianceReasons;
    try {
      const rawNames = window.localStorage.getItem(SHIFT_CASHIER_NAMES_STORAGE_KEY);
      if (rawNames !== null) {
        latestCashierNames = parseShiftCashierNamesMap(rawNames);
      }
      const rawFloats = window.localStorage.getItem(SHIFT_NEXT_FLOATS_STORAGE_KEY);
      if (rawFloats !== null) {
        latestNextFloats = parseShiftNextFloatsMap(rawFloats);
      }
      const rawMemo = window.localStorage.getItem(SHIFT_HANDOVER_MEMO_STORAGE_KEY);
      latestHandoverMemo = parseShiftHandoverMemo(rawMemo);
      const rawTarget = window.localStorage.getItem(SHIFT_SALES_TARGET_STORAGE_KEY);
      if (rawTarget !== null) {
        latestSalesTarget = parseShiftSalesTarget(rawTarget);
      }
      const rawReasons = window.localStorage.getItem(SHIFT_VARIANCE_REASONS_STORAGE_KEY);
      if (rawReasons !== null) {
        latestVarianceReasons = parseShiftCashierNamesMap(rawReasons);
      }
    } catch {
      // Fallback to in-memory state
    }
    return {
      version: 1,
      [SHIFT_CASHIER_NAMES_STORAGE_KEY]: latestCashierNames,
      [SHIFT_NEXT_FLOATS_STORAGE_KEY]: latestNextFloats,
      [SHIFT_HANDOVER_MEMO_STORAGE_KEY]: latestHandoverMemo,
      [SHIFT_SALES_TARGET_STORAGE_KEY]: latestSalesTarget,
      [SHIFT_VARIANCE_REASONS_STORAGE_KEY]: latestVarianceReasons,
    };
  };

  const openCashierBackupModal = () => {
    setCashierBackupJsonInput('');
    setCashierBackupFileName('');
    setCashierRestoreMode('replace');
    setCashierBackupError('');
    setCashierBackupSuccess('');
    setCashierJsonCopied(false);
    setCashierBackupOpen(true);
  };

  const handleExportCashierBackupJson = () => {
    setCashierBackupError('');
    const payload = buildCashierBackupPayload();
    const jsonText = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `shift-settings-backup-${dateStamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setCashierBackupSuccess(`ดาวน์โหลดไฟล์สำรองข้อมูล (${link.download}) เรียบร้อยแล้ว`);
  };

  const handleCopyCashierBackupJson = async () => {
    try {
      const payload = buildCashierBackupPayload();
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCashierJsonCopied(true);
      setTimeout(() => setCashierJsonCopied(false), 2000);
    } catch {
      setCashierBackupError('ไม่สามารถคัดลอก JSON ได้ กรุณาใช้ปุ่มดาวน์โหลดไฟล์ .json แทน');
    }
  };

  const handleCashierBackupFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setCashierBackupError('');
    setCashierBackupSuccess('');
    setCashierBackupFileName(file.name);
    try {
      const rawText = await file.text();
      setCashierBackupJsonInput(rawText);
    } catch {
      setCashierBackupError('ไม่สามารถอ่านไฟล์ที่เลือกได้ กรุณาลองใหม่อีกครั้ง');
    }
  };

  const cashierBackupPreview = useMemo(() => {
    if (!cashierBackupJsonInput.trim()) return null;
    return parseShiftMetaBackupJson(cashierBackupJsonInput);
  }, [cashierBackupJsonInput]);

  const handleRestoreCashierBackupJson = () => {
    setCashierBackupError('');
    setCashierBackupSuccess('');

    const parsed = parseShiftMetaBackupJson(cashierBackupJsonInput);
    if (parsed.error || parsed.keysPresent.length === 0) {
      setCashierBackupError(parsed.error || 'ไม่สามารถอ่านข้อมูล JSON ได้');
      return;
    }

    const restoreShiftRecordMap = <T,>(
      key: string,
      incoming: Record<string, T>,
      fallback: Record<string, T>,
      parser: (raw: string | null) => Record<string, T>,
      setter: (next: Record<string, T>) => void
    ): { incomingCount: number; totalCount: number; next: Record<string, T> } => {
      let currentBase: Record<string, T> = fallback;
      if (cashierRestoreMode === 'merge') {
        try {
          const raw = window.localStorage.getItem(key);
          if (raw !== null) {
            currentBase = parser(raw);
          }
        } catch {
          // Fallback to in-memory state
        }
      }
      const next: Record<string, T> =
        cashierRestoreMode === 'merge' ? { ...currentBase, ...incoming } : incoming;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Ignore storage errors while still updating in-memory state
      }
      setter(next);
      return {
        incomingCount: Object.keys(incoming).length,
        totalCount: Object.keys(next).length,
        next,
      };
    };

    const summaryParts: string[] = [];

    if (parsed.cashierNames !== undefined) {
      const { incomingCount, totalCount } = restoreShiftRecordMap(
        SHIFT_CASHIER_NAMES_STORAGE_KEY,
        parsed.cashierNames,
        shiftCashierNames,
        parseShiftCashierNamesMap,
        setShiftCashierNames
      );
      summaryParts.push(
        `ผู้ดูแลกะ ${formatNumber(incomingCount)} รายการ (รวม ${formatNumber(totalCount)} กะ)`
      );
    }

    if (parsed.nextFloats !== undefined) {
      const { incomingCount, totalCount, next } = restoreShiftRecordMap(
        SHIFT_NEXT_FLOATS_STORAGE_KEY,
        parsed.nextFloats,
        shiftNextFloats,
        parseShiftNextFloatsMap,
        setShiftNextFloats
      );
      if (selectedShift) {
        setDetailNextShiftFloat(
          String(next[selectedShift.id] ?? Number(selectedShift.opening_cash ?? 0))
        );
      }
      summaryParts.push(
        `เงินทอนกะถัดไป ${formatNumber(incomingCount)} รายการ (รวม ${formatNumber(totalCount)} กะ)`
      );
    }

    if (parsed.handoverMemo !== undefined) {
      if (parsed.handoverMemo) {
        try {
          window.localStorage.setItem(
            SHIFT_HANDOVER_MEMO_STORAGE_KEY,
            JSON.stringify(parsed.handoverMemo)
          );
        } catch {
          // Ignore storage errors while still updating in-memory state
        }
        setHandoverMemo(parsed.handoverMemo);
        summaryParts.push(
          `ข้อความส่งต่อกะ 1 รายการ${parsed.handoverMemo.urgent ? ' (ด่วน)' : ''}`
        );
      } else if (cashierRestoreMode === 'replace') {
        try {
          window.localStorage.removeItem(SHIFT_HANDOVER_MEMO_STORAGE_KEY);
        } catch {
          // Ignore storage errors
        }
        setHandoverMemo(null);
        summaryParts.push('ข้อความส่งต่อกะ: ล้างข้อความ');
      } else {
        summaryParts.push('ข้อความส่งต่อกะ: คงเดิม');
      }
    }

    if (parsed.salesTarget !== undefined) {
      saveShiftSalesTarget(parsed.salesTarget);
      summaryParts.push(`เป้าหมายยอดขายต่อกะ ${formatBaht(parsed.salesTarget)}`);
    }

    if (parsed.varianceReasons !== undefined) {
      const { incomingCount, totalCount, next } = restoreShiftRecordMap(
        SHIFT_VARIANCE_REASONS_STORAGE_KEY,
        parsed.varianceReasons,
        shiftVarianceReasons,
        parseShiftCashierNamesMap,
        setShiftVarianceReasons
      );
      if (selectedShift) {
        setDetailVarianceReasonInput(next[selectedShift.id] ?? '');
      }
      summaryParts.push(
        `สาเหตุส่วนต่าง ${formatNumber(incomingCount)} รายการ (รวม ${formatNumber(totalCount)} กะ)`
      );
    }

    setCashierBackupSuccess(`กู้คืนข้อมูลตั้งค่ากะสำเร็จ (${summaryParts.join(' · ')})`);
  };

  const summary = useMemo(() => {
    let cash = 0;
    let qr = 0;
    let credit = 0;
    for (const s of salesInShift) {
      if (s.payment_method === 'cash') cash += Number(s.total_amount);
      else if (s.payment_method === 'qr') qr += Number(s.total_amount);
      else if (s.payment_method === 'credit') credit += Number(s.total_amount);
    }
    let safeDropInShift = 0;
    let regularExpenseInShift = 0;
    for (const exp of expensesListInShift) {
      const amt = Number(exp.amount) || 0;
      if (isSafeCashDropExpense(exp)) {
        safeDropInShift += amt;
      } else if (exp.type === 'expense') {
        regularExpenseInShift += amt;
      } else {
        regularExpenseInShift -= amt;
      }
    }
    safeDropInShift = Math.round(safeDropInShift * 100) / 100;
    regularExpenseInShift = Math.round(regularExpenseInShift * 100) / 100;
    const openingCash = Number(activeShift?.opening_cash ?? 0);
    const netCashInShift = cash + debtCashInShift - expenseInShift;
    const expectedCash = openingCash + netCashInShift;
    return {
      cash,
      qr,
      credit,
      openingCash,
      netCashInShift,
      expectedCash,
      totalSales: cash + qr + credit,
      safeDropInShift,
      regularExpenseInShift,
    };
  }, [salesInShift, activeShift, debtCashInShift, expenseInShift, expensesListInShift]);

  const topProductsInShift = useMemo(() => {
    const productMap = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const sale of salesInShift) {
      for (const item of sale.sale_items ?? []) {
        const key = item.product_name;
        const prev = productMap.get(key) ?? {
          name: item.product_name,
          qty: 0,
          revenue: 0,
        };
        prev.qty += Number(item.qty) * Number(item.conversion_rate);
        prev.revenue += Number(item.subtotal);
        productMap.set(key, prev);
      }
    }
    return [...productMap.values()]
      .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty)
      .slice(0, 5);
  }, [salesInShift]);

  const activeExpenseBreakdown = useMemo(
    () => summarizeShiftExpenses(expensesListInShift),
    [expensesListInShift]
  );

  const detailExpenseBreakdown = useMemo(
    () => summarizeShiftExpenses(shiftExpensesDetail),
    [shiftExpensesDetail]
  );

  const allShifts = useMemo(
    () => [...(activeShift ? [activeShift] : []), ...shiftHistory],
    [activeShift, shiftHistory]
  );

  const savedCashierNamePresets = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    const addName = (rawName: string | undefined) => {
      const trimmed = rawName?.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      list.push(trimmed);
    };
    for (const sh of allShifts) {
      addName(shiftCashierNames[sh.id]);
    }
    for (const name of Object.values(shiftCashierNames)) {
      addName(name);
    }
    return list;
  }, [allShifts, shiftCashierNames]);

  const cashierFilterOptions = useMemo(() => {
    const names = new Set<string>();
    let hasUnassigned = false;
    for (const sh of allShifts) {
      const name = (shiftCashierNames[sh.id] ?? '').trim();
      if (name) {
        names.add(name);
      } else {
        hasUnassigned = true;
      }
    }
    return {
      names: [...names].sort((a, b) => a.localeCompare(b, 'th')),
      hasUnassigned,
    };
  }, [allShifts, shiftCashierNames]);

  const filteredShiftHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return allShifts.filter((sh) => {
      if (shiftStatusFilter === 'open' && sh.status !== 'open') return false;
      if (shiftStatusFilter === 'closed' && sh.status !== 'closed') return false;
      if (shiftStatusFilter === 'diff') {
        if (sh.status !== 'closed') return false;
        const diff = Number(sh.actual_cash ?? 0) - Number(sh.expected_cash ?? 0);
        if (diff === 0) return false;
      }
      if (shiftStatusFilter === 'grade_c') {
        if (sh.status !== 'closed') return false;
        const grade = getCashAccuracyGrade(
          sh.actual_cash !== null ? Number(sh.actual_cash) : null,
          sh.expected_cash !== null ? Number(sh.expected_cash) : null
        );
        if (grade?.grade !== 'C') return false;
      }

      if (cashierFilter !== 'all') {
        const cashierName = (shiftCashierNames[sh.id] ?? '').trim();
        if (cashierFilter === '__unassigned__') {
          if (cashierName.length > 0) return false;
        } else if (cashierName !== cashierFilter) {
          return false;
        }
      }

      if (!q) return true;
      const noteMatch = (sh.note ?? '').toLowerCase().includes(q);
      const cashierMatch = (shiftCashierNames[sh.id] ?? '').toLowerCase().includes(q);
      const openedStr = formatDateTime(sh.opened_at).toLowerCase();
      const closedStr = sh.closed_at ? formatDateTime(sh.closed_at).toLowerCase() : '';
      const openedIso = sh.opened_at.slice(0, 10).toLowerCase();
      const closedIso = (sh.closed_at ?? '').slice(0, 10).toLowerCase();
      const idMatch = sh.id.toLowerCase().includes(q);
      return (
        noteMatch ||
        cashierMatch ||
        openedStr.includes(q) ||
        closedStr.includes(q) ||
        openedIso.includes(q) ||
        closedIso.includes(q) ||
        idMatch
      );
    });
  }, [allShifts, historySearch, shiftStatusFilter, cashierFilter, shiftCashierNames]);

  const historySummary = useMemo(() => {
    const effectiveTarget =
      shiftSalesTarget > 0 ? shiftSalesTarget : DEFAULT_SHIFT_SALES_TARGET;
    let exactMatchCount = 0;
    let targetMetCount = 0;
    let totalDiffCash = 0;
    let totalClosedCash = 0;
    let totalClosedQr = 0;
    let totalClosedCredit = 0;
    let totalClosedSales = 0;
    let totalClosedBills = 0;
    let totalClosedHours = 0;
    let totalNetCashDrop = 0;
    let netCashDropCount = 0;
    for (const sh of shiftHistory) {
      const diff =
        sh.actual_cash !== null
          ? Number(sh.actual_cash) - Number(sh.expected_cash ?? 0)
          : Number(sh.diff_cash ?? 0);
      if (diff === 0) exactMatchCount += 1;
      totalDiffCash += diff;
      const salesTotals = closedShiftSalesMap[sh.id];
      const shiftSales = salesTotals?.total ?? 0;
      if (shiftSales >= effectiveTarget) targetMetCount += 1;
      const shiftBills = salesTotals?.billCount ?? 0;
      if (salesTotals) {
        totalClosedCash += salesTotals.cash;
        totalClosedQr += salesTotals.qr;
        totalClosedCredit += salesTotals.credit;
        totalClosedSales += salesTotals.total;
        totalClosedBills += salesTotals.billCount;
      }
      if (sh.actual_cash !== null) {
        const nextShiftFloatAmt = shiftNextFloats[sh.id] ?? Number(sh.opening_cash ?? 0);
        const dropAmt = calcNetCashDrop(Number(sh.actual_cash), nextShiftFloatAmt);
        if (dropAmt !== null) {
          totalNetCashDrop += dropAmt;
          netCashDropCount += 1;
        }
      }
      const velocity = calcShiftVelocity(sh.opened_at, sh.closed_at, shiftSales, shiftBills);
      if (velocity) {
        totalClosedHours += velocity.durationHours;
      }
    }
    const totalCount = shiftHistory.length;
    totalNetCashDrop = Math.round(totalNetCashDrop * 100) / 100;
    return {
      totalCount,
      exactMatchCount,
      targetMetCount,
      totalDiffCash,
      totalClosedSales,
      totalClosedHours,
      totalNetCashDrop,
      netCashDropCount,
      avgSalesPerHour: totalClosedHours > 0 ? totalClosedSales / totalClosedHours : 0,
      avgTotalSales: totalCount > 0 ? totalClosedSales / totalCount : 0,
      avgCashSales: totalCount > 0 ? totalClosedCash / totalCount : 0,
      avgQrSales: totalCount > 0 ? totalClosedQr / totalCount : 0,
      avgCreditSales: totalCount > 0 ? totalClosedCredit / totalCount : 0,
      avgBillsPerShift: totalCount > 0 ? totalClosedBills / totalCount : 0,
    };
  }, [shiftHistory, closedShiftSalesMap, shiftSalesTarget, shiftNextFloats]);

  const varianceReasonBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        reason: string;
        isUnassigned: boolean;
        shiftCount: number;
        totalDiff: number;
        shortageCount: number;
        overageCount: number;
      }
    >();
    let totalVarianceShifts = 0;
    for (const sh of shiftHistory) {
      const diff =
        sh.actual_cash !== null
          ? Number(sh.actual_cash) - Number(sh.expected_cash ?? 0)
          : Number(sh.diff_cash ?? 0);
      if (diff === 0) continue;
      totalVarianceShifts += 1;
      const rawReason = (shiftVarianceReasons[sh.id] ?? '').trim();
      const isUnassigned = rawReason.length === 0;
      const key = isUnassigned ? '__unassigned__' : rawReason;
      const existing = map.get(key) ?? {
        reason: isUnassigned ? 'ยังไม่ระบุสาเหตุ' : rawReason,
        isUnassigned,
        shiftCount: 0,
        totalDiff: 0,
        shortageCount: 0,
        overageCount: 0,
      };
      existing.shiftCount += 1;
      existing.totalDiff = Math.round((existing.totalDiff + diff) * 100) / 100;
      if (diff < 0) existing.shortageCount += 1;
      else if (diff > 0) existing.overageCount += 1;
      map.set(key, existing);
    }
    const groups = [...map.values()].sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      if (b.shiftCount !== a.shiftCount) return b.shiftCount - a.shiftCount;
      return Math.abs(b.totalDiff) - Math.abs(a.totalDiff);
    });
    return {
      totalVarianceShifts,
      groups,
    };
  }, [shiftHistory, shiftVarianceReasons]);

  const cashierPerformanceStats = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        cashierName: string;
        isNamed: boolean;
        closedCount: number;
        totalSales: number;
        totalBills: number;
        totalHours: number;
        exactMatchCount: number;
        gradeAPlusCount: number;
        gradeBCount: number;
        gradeCCount: number;
        totalDiffCash: number;
        totalSafeDropInShift: number;
        totalSafeHandover: number;
      }
    >();

    for (const sh of shiftHistory) {
      const rawName = shiftCashierNames[sh.id]?.trim() ?? '';
      const isNamed = rawName.length > 0;
      const cashierName = isNamed ? rawName : 'ไม่ระบุผู้ดูแลกะ';
      const key = isNamed ? `named:${rawName}` : '__unassigned__';

      const entry = map.get(key) ?? {
        key,
        cashierName,
        isNamed,
        closedCount: 0,
        totalSales: 0,
        totalBills: 0,
        totalHours: 0,
        exactMatchCount: 0,
        gradeAPlusCount: 0,
        gradeBCount: 0,
        gradeCCount: 0,
        totalDiffCash: 0,
        totalSafeDropInShift: 0,
        totalSafeHandover: 0,
      };

      const salesTotals = closedShiftSalesMap[sh.id];
      const shiftSales = salesTotals?.total ?? 0;
      const shiftBills = salesTotals?.billCount ?? 0;
      const velocity = calcShiftVelocity(sh.opened_at, sh.closed_at, shiftSales, shiftBills);
      const diff =
        sh.actual_cash !== null
          ? Number(sh.actual_cash) - Number(sh.expected_cash ?? 0)
          : Number(sh.diff_cash ?? 0);
      const accuracyGrade = getCashAccuracyGrade(
        sh.actual_cash !== null ? Number(sh.actual_cash) : null,
        sh.expected_cash !== null ? Number(sh.expected_cash) : null
      );

      entry.closedCount += 1;
      entry.totalSales += shiftSales;
      entry.totalBills += shiftBills;
      if (velocity) {
        entry.totalHours += velocity.durationHours;
      }
      if (diff === 0) entry.exactMatchCount += 1;
      if (accuracyGrade?.grade === 'A+') entry.gradeAPlusCount += 1;
      else if (accuracyGrade?.grade === 'B') entry.gradeBCount += 1;
      else if (accuracyGrade?.grade === 'C') entry.gradeCCount += 1;
      entry.totalDiffCash += diff;

      const nextShiftFloatAmt = shiftNextFloats[sh.id] ?? Number(sh.opening_cash ?? 0);
      const safeDropAmt = closedShiftSafeDropMap[sh.id] ?? 0;
      const netCashDropAmt =
        sh.actual_cash !== null
          ? calcNetCashDrop(Number(sh.actual_cash), nextShiftFloatAmt)
          : null;
      const shiftSafeHandover =
        netCashDropAmt !== null
          ? Math.round((netCashDropAmt + safeDropAmt) * 100) / 100
          : Math.round(safeDropAmt * 100) / 100;
      entry.totalSafeDropInShift =
        Math.round((entry.totalSafeDropInShift + safeDropAmt) * 100) / 100;
      entry.totalSafeHandover =
        Math.round((entry.totalSafeHandover + shiftSafeHandover) * 100) / 100;

      map.set(key, entry);
    }

    const totalClosedSalesAll = [...map.values()].reduce((s, c) => s + c.totalSales, 0);

    return [...map.values()]
      .map((entry) => ({
        ...entry,
        avgSalesPerShift: entry.closedCount > 0 ? entry.totalSales / entry.closedCount : 0,
        salesPerHour: entry.totalHours > 0 ? entry.totalSales / entry.totalHours : 0,
        exactMatchRatePct:
          entry.closedCount > 0 ? (entry.exactMatchCount / entry.closedCount) * 100 : 0,
        sharePct: totalClosedSalesAll > 0 ? (entry.totalSales / totalClosedSalesAll) * 100 : 0,
      }))
      .sort(
        (a, b) =>
          b.totalSales - a.totalSales ||
          b.closedCount - a.closedCount ||
          a.cashierName.localeCompare(b.cashierName, 'th')
      );
  }, [
    shiftHistory,
    shiftCashierNames,
    closedShiftSalesMap,
    closedShiftSafeDropMap,
    shiftNextFloats,
  ]);

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data, error } = await supabase
      .from('shifts')
      .insert({
        opening_cash: Number(openingCash) || 0,
        status: 'open',
      })
      .select()
      .single();
    if (!error && data?.id && openShiftCashierName.trim()) {
      saveShiftCashierName(data.id, openShiftCashierName);
    }
    if (!error) {
      setOpenShiftCashierName('');
      setEditingActiveCashier(false);
      setUseOpeningDenomCounter(false);
      setOpeningDenomCounts({});
    }
    loadData();
  };

  const openingDenomSummary = useMemo(() => {
    let total = 0;
    let smallChangeTotal = 0;
    for (const d of DENOMINATIONS) {
      const qty = Math.max(0, parseInt(openingDenomCounts[d] || '0', 10) || 0);
      const subtotal = d * qty;
      total += subtotal;
      if (d <= 50) {
        smallChangeTotal += subtotal;
      }
    }
    return { total, smallChangeTotal };
  }, [openingDenomCounts]);

  const handleOpeningDenomChange = (denom: number, value: string) => {
    const nextCounts = { ...openingDenomCounts, [denom]: value };
    setOpeningDenomCounts(nextCounts);
    const total = DENOMINATIONS.reduce((sum, d) => {
      const qty = Math.max(0, parseInt(nextCounts[d] || '0', 10) || 0);
      return sum + d * qty;
    }, 0);
    setOpeningCash(String(total));
  };

  const handleResetOpeningDenom = () => {
    setOpeningDenomCounts({});
    setOpeningCash('0');
  };

  const handleOpenEditShiftModal = () => {
    if (!activeShift) return;
    setEditOpeningCash(String(activeShift.opening_cash ?? 0));
    setEditShiftNote(activeShift.note ?? '');
    setEditShiftCashierName(shiftCashierNames[activeShift.id] ?? '');
    setEditShiftModalOpen(true);
  };

  const handleSaveEditShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift) return;
    const nextOpeningCash = Math.max(0, Number(editOpeningCash) || 0);

    await supabase
      .from('shifts')
      .update({
        opening_cash: nextOpeningCash,
        note: editShiftNote.trim(),
      })
      .eq('id', activeShift.id);

    saveShiftCashierName(activeShift.id, editShiftCashierName);
    setEditShiftModalOpen(false);
    loadData();
  };

  const handleAddShiftExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift) return;
    const amt = Number(expAmount);
    if (!amt || amt <= 0) return;

    await supabase.from('expenses').insert({
      shift_id: activeShift.id,
      type: expType,
      category: expCategory.trim() || 'รายจ่ายในกะ',
      amount: amt,
      note: expNote.trim(),
    });

    setExpAmount('');
    setExpNote('');
    setExpModalOpen(false);
    loadData();
  };

  const handleOpenSafeDropModal = () => {
    setSafeDropAmount('');
    setSafeDropNote('');
    setSafeDropModalOpen(true);
  };

  const handleSaveSafeDrop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift || safeDropSubmitting) return;
    const amt = Number(safeDropAmount);
    if (!Number.isFinite(amt) || amt <= 0) return;

    setSafeDropSubmitting(true);
    try {
      const cleanNote = safeDropNote.trim() || 'นำเงินสดแบ่งเก็บเข้าเซฟระหว่างกะ';
      await supabase.from('expenses').insert({
        shift_id: activeShift.id,
        type: 'expense',
        category: 'เก็บเงินเข้าเซฟ',
        amount: amt,
        note: `${SAFE_DROP_NOTE_PREFIX} ${cleanNote}`,
      });
      setSafeDropAmount('');
      setSafeDropNote('');
      setSafeDropModalOpen(false);
      await loadData();
    } finally {
      setSafeDropSubmitting(false);
    }
  };

  const openEditExpenseModal = (exp: Expense) => {
    setConfirmDeleteExpenseId(null);
    setEditingExpense(exp);
    setEditExpType(exp.type);
    setEditExpCategory(exp.category);
    setEditExpAmount(String(exp.amount));
    setEditExpNote(exp.note ?? '');
  };

  const handleUpdateShiftExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift || !editingExpense) return;
    const amt = Number(editExpAmount);
    if (!amt || amt <= 0) return;

    setSavingEditExpense(true);
    await supabase
      .from('expenses')
      .update({
        type: editExpType,
        category:
          editExpCategory.trim() ||
          (editExpType === 'income' ? 'รายรับในกะ' : 'รายจ่ายในกะ'),
        amount: amt,
        note: editExpNote.trim(),
      })
      .eq('id', editingExpense.id)
      .eq('shift_id', activeShift.id);

    setSavingEditExpense(false);
    setEditingExpense(null);
    await loadData();
  };

  const handleDeleteShiftExpense = async (expenseId: string) => {
    if (!activeShift) return;
    setDeletingExpenseId(expenseId);
    await supabase
      .from('expenses')
      .delete()
      .eq('id', expenseId)
      .eq('shift_id', activeShift.id);
    setDeletingExpenseId(null);
    setConfirmDeleteExpenseId(null);
    await loadData();
  };

  const handleViewShiftDetail = async (shift: Shift) => {
    setSelectedShift(shift);
    setEditingModalCashier(false);
    setModalCashierInput(shiftCashierNames[shift.id] ?? '');
    setDetailVarianceReasonInput(shiftVarianceReasons[shift.id] ?? '');
    setVarianceReasonSavedFlash(false);
    setDetailNextShiftFloat(
      String(shiftNextFloats[shift.id] ?? Number(shift.opening_cash ?? 0))
    );
    setDetailLoading(true);
    const [{ data: sData }, { data: expData }, { data: dpData }] = await Promise.all([
      supabase
        .from('sales')
        .select('*, customers(name), sale_items(*)')
        .eq('shift_id', shift.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('expenses')
        .select('*')
        .eq('shift_id', shift.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('debt_payments')
        .select('*, customers(name)')
        .eq('shift_id', shift.id)
        .order('created_at', { ascending: false }),
    ]);
    setShiftSalesDetail((sData as Sale[]) ?? []);
    setShiftExpensesDetail((expData as Expense[]) ?? []);
    const dpRows = (dpData as DebtPaymentWithCustomer[]) ?? [];
    setShiftDebtPaymentsDetail(dpRows);
    setShiftDebtCashDetail(
      Math.round(
        dpRows
          .filter((d) => d.payment_method === 'cash')
          .reduce((s, d) => s + parseDebtPaymentAmounts(d.amount, d.note).actualCollected, 0) *
          100
      ) / 100
    );
    setDetailLoading(false);
  };

  const detailSummary = useMemo(() => {
    let cash = 0;
    let qr = 0;
    let credit = 0;
    for (const s of shiftSalesDetail) {
      const amt = Number(s.total_amount);
      if (s.payment_method === 'cash') cash += amt;
      else if (s.payment_method === 'qr') qr += amt;
      else if (s.payment_method === 'credit') credit += amt;
    }
    let expenseTotal = 0;
    let incomeTotal = 0;
    let safeDropTotal = 0;
    let regularExpenseTotal = 0;
    for (const e of shiftExpensesDetail) {
      const amt = Number(e.amount) || 0;
      if (e.type === 'expense') {
        expenseTotal += amt;
        if (isSafeCashDropExpense(e)) {
          safeDropTotal += amt;
        } else {
          regularExpenseTotal += amt;
        }
      } else {
        incomeTotal += amt;
      }
    }
    const netExpense = expenseTotal - incomeTotal;
    const regularNetExpense = regularExpenseTotal - incomeTotal;
    const netCashReceived = cash + shiftDebtCashDetail - netExpense;
    const expectedCash =
      selectedShift?.status === 'open'
        ? Number(selectedShift.opening_cash ?? 0) + netCashReceived
        : Number(selectedShift?.expected_cash ?? 0);
    return {
      cash,
      qr,
      credit,
      totalSales: cash + qr + credit,
      expenseTotal,
      incomeTotal,
      netExpense,
      safeDropTotal: Math.round(safeDropTotal * 100) / 100,
      regularNetExpense: Math.round(regularNetExpense * 100) / 100,
      netCashReceived,
      expectedCash,
    };
  }, [shiftSalesDetail, shiftExpensesDetail, shiftDebtCashDetail, selectedShift]);

  const detailVelocity = useMemo(() => {
    if (!selectedShift || selectedShift.status !== 'closed' || !selectedShift.closed_at) {
      return null;
    }
    return calcShiftVelocity(
      selectedShift.opened_at,
      selectedShift.closed_at,
      detailSummary.totalSales,
      shiftSalesDetail.length
    );
  }, [selectedShift, detailSummary.totalSales, shiftSalesDetail.length]);

  const previousClosedShift = useMemo(() => {
    if (!selectedShift || selectedShift.status !== 'closed') return null;
    const idx = shiftHistory.findIndex((sh) => sh.id === selectedShift.id);
    if (idx >= 0) {
      return shiftHistory[idx + 1] ?? null;
    }
    const selectedTime = selectedShift.closed_at || selectedShift.opened_at;
    return (
      shiftHistory.find(
        (sh) => sh.id !== selectedShift.id && (sh.closed_at || sh.opened_at) < selectedTime
      ) ?? null
    );
  }, [selectedShift, shiftHistory]);

  const shiftComparison = useMemo(() => {
    if (!selectedShift || selectedShift.status !== 'closed' || !previousClosedShift) {
      return null;
    }
    const prevTotalSales = closedShiftSalesMap[previousClosedShift.id]?.total ?? 0;
    const prevNetCash =
      closedShiftNetCashMap[previousClosedShift.id] ??
      Number(previousClosedShift.expected_cash ?? 0) -
        Number(previousClosedShift.opening_cash ?? 0);

    return {
      previousShift: previousClosedShift,
      prevTotalSales,
      prevNetCash,
      salesDelta: formatShiftComparisonDelta(detailSummary.totalSales, prevTotalSales),
      netCashDelta: formatShiftComparisonDelta(detailSummary.netCashReceived, prevNetCash),
    };
  }, [
    selectedShift,
    previousClosedShift,
    closedShiftSalesMap,
    closedShiftNetCashMap,
    detailSummary.totalSales,
    detailSummary.netCashReceived,
  ]);

  const handleCopyShiftSummary = async (target: 'active' | 'modal') => {
    const sh = target === 'active' ? activeShift : selectedShift;
    if (!sh) return;

    const isAct = target === 'active';
    const cashAmt = isAct ? summary.cash : detailSummary.cash;
    const qrAmt = isAct ? summary.qr : detailSummary.qr;
    const creditAmt = isAct ? summary.credit : detailSummary.credit;
    const totalSalesAmt = isAct ? summary.totalSales : detailSummary.totalSales;
    const debtCashAmt = isAct ? debtCashInShift : shiftDebtCashDetail;
    const expNetAmt = isAct ? expenseInShift : detailSummary.netExpense;
    const billCount = isAct ? salesInShift.length : shiftSalesDetail.length;
    const expectedAmt =
      sh.status === 'open'
        ? isAct
          ? summary.expectedCash
          : detailSummary.expectedCash
        : Number(sh.expected_cash ?? 0);
    const actualAmt = sh.actual_cash !== null ? Number(sh.actual_cash) : null;
    const diffAmt =
      sh.diff_cash !== null
        ? Number(sh.diff_cash)
        : actualAmt !== null
          ? actualAmt - expectedAmt
          : null;

    const diffText =
      diffAmt === null
        ? 'ยังไม่ได้นับเงินปิดกะ'
        : diffAmt === 0
          ? `${formatBaht(0)} (ครบพอดี)`
          : diffAmt > 0
            ? `+${formatBaht(diffAmt)} (เงินเกิน)`
            : `${formatBaht(diffAmt)} (เงินขาด)`;

    const expText =
      expNetAmt > 0
        ? `-${formatBaht(expNetAmt)}`
        : expNetAmt < 0
          ? `+${formatBaht(Math.abs(expNetAmt))} (รายรับสุทธิ)`
          : formatBaht(0);

    const closedVelocity =
      sh.status === 'closed' && sh.closed_at
        ? calcShiftVelocity(sh.opened_at, sh.closed_at, totalSalesAmt, billCount)
        : null;
    const cashierName = shiftCashierNames[sh.id] ?? '';
    const nextShiftFloatAmt =
      !isAct && selectedShift && selectedShift.id === sh.id
        ? Math.max(0, Number(detailNextShiftFloat) || 0)
        : (shiftNextFloats[sh.id] ?? Number(sh.opening_cash ?? 0));
    const netCashDropAmt = calcNetCashDrop(actualAmt, nextShiftFloatAmt);

    const lines = [
      `📋 สรุปกะการขาย (${settings?.store_name || 'ร้านขายของชำ POS'})`,
      `สถานะ: ${sh.status === 'open' ? '🟢 กำลังเปิดกะขาย' : '🔒 ปิดกะแล้ว'}`,
      ...(cashierName ? [`👤 ผู้ดูแลกะ / แคชเชียร์: ${cashierName}`] : []),
      `🕒 เวลาเปิดกะ: ${formatDateTime(sh.opened_at)}`,
      `🕒 เวลาปิดกะ: ${sh.closed_at ? formatDateTime(sh.closed_at) : 'กำลังเปิดกะ'}`,
      ...(closedVelocity
        ? [
            `⏱️ ระยะเวลาเปิดกะ: ${closedVelocity.durationText} (${formatNumber(Number(closedVelocity.durationHours.toFixed(2)))} ชม.)`,
            `⚡ ความเร็วการขาย: ${formatBahtPrefix(closedVelocity.salesPerHour)}/ชม. · ${closedVelocity.billsPerHour.toFixed(1)} บิล/ชม.`,
          ]
        : []),
      `-------------------------`,
      `🪙 เงินทอนตั้งต้น: ${formatBaht(sh.opening_cash)}`,
      `🧾 ยอดขายรวม (${billCount} บิล): ${formatBaht(totalSalesAmt)}`,
      `  • ขายเงินสด: ${formatBaht(cashAmt)}${debtCashAmt > 0 ? ` (+รับชำระหนี้สด ${formatBaht(debtCashAmt)})` : ''}`,
      `  • PromptPay QR: ${formatBaht(qrAmt)}`,
      `  • เงินเชื่อ (ค้างชำระ): ${formatBaht(creditAmt)}`,
      `💸 รายจ่ายเงินสดสุทธิในกะ: ${expText}`,
      `-------------------------`,
      `🏦 เงินสดที่ควรมีในลิ้นชัก: ${formatBaht(expectedAmt)}`,
      `💵 เงินสดที่นับได้จริง: ${actualAmt !== null ? formatBaht(actualAmt) : 'ยังไม่ได้นับเงินปิดกะ'}`,
      `⚖️ ส่วนต่างเงินสด: ${diffText}`,
      ...(sh.status === 'closed' && netCashDropAmt !== null
        ? [
            `🪙 เงินทอนเก็บไว้เปิดกะถัดไป: ${formatBaht(nextShiftFloatAmt)}`,
            `💰 ยอดเงินสดนำส่งเจ้าของร้าน (Net Cash Drop): ${formatBaht(netCashDropAmt)}`,
          ]
        : []),
    ];

    if (sh.note) {
      lines.push(`📝 หมายเหตุ: ${sh.note}`);
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedTarget(target);
      setTimeout(() => {
        setCopiedTarget((prev) => (prev === target ? null : prev));
      }, 2500);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const handleCopyLineShiftSummary = async (sh: Shift, targetKey: string) => {
    const isAct = activeShift?.id === sh.id && sh.status === 'open';
    const closedTotals = closedShiftSalesMap[sh.id];

    const cashAmt = isAct ? summary.cash : (closedTotals?.cash ?? 0);
    const qrAmt = isAct ? summary.qr : (closedTotals?.qr ?? 0);
    const creditAmt = isAct ? summary.credit : (closedTotals?.credit ?? 0);
    const totalSalesAmt = isAct ? summary.totalSales : (closedTotals?.total ?? 0);
    const billCount = isAct ? salesInShift.length : (closedTotals?.billCount ?? 0);
    const debtCashAmt = isAct ? debtCashInShift : (closedShiftDebtCashMap[sh.id] ?? 0);
    const expNetAmt = isAct ? expenseInShift : (closedShiftExpenseMap[sh.id] ?? 0);

    const expectedAmt = isAct
      ? summary.expectedCash
      : Number(sh.expected_cash ?? 0);
    const actualAmt = sh.actual_cash !== null ? Number(sh.actual_cash) : null;
    const diffAmt =
      sh.status === 'open'
        ? null
        : sh.diff_cash !== null
          ? Number(sh.diff_cash)
          : actualAmt !== null
            ? actualAmt - expectedAmt
            : null;

    const diffText =
      diffAmt === null
        ? 'รอปิดกะ'
        : diffAmt === 0
          ? 'ครบพอดี (฿0)'
          : diffAmt > 0
            ? `+${formatBaht(diffAmt)} (เกิน)`
            : `${formatBaht(diffAmt)} (ขาด)`;

    const expText =
      expNetAmt > 0
        ? `-${formatBaht(expNetAmt)}`
        : expNetAmt < 0
          ? `+${formatBaht(Math.abs(expNetAmt))} (รายรับสุทธิ)`
          : formatBaht(0);

    const cashierName = shiftCashierNames[sh.id]?.trim() || 'ไม่ระบุ';
    const grade =
      sh.status === 'closed'
        ? getCashAccuracyGrade(actualAmt, expectedAmt)
        : null;
    const nextShiftFloatAmt = shiftNextFloats[sh.id] ?? Number(sh.opening_cash ?? 0);
    const netCashDropAmt =
      sh.status === 'closed' ? calcNetCashDrop(actualAmt, nextShiftFloatAmt) : null;
    const varianceReason = shiftVarianceReasons[sh.id]?.trim() || '';

    const lines = [
      `📊 สรุปกะส่ง LINE — ${settings?.store_name || 'ร้านขายของชำ POS'}`,
      sh.status === 'open'
        ? `🟢 สถานะ: กำลังเปิดกะ (รายงานยอดระหว่างวัน)`
        : `🔒 สถานะ: ปิดกะแล้ว`,
      `👤 ผู้ดูแลกะ: ${cashierName}`,
      `🕒 เปิด: ${formatDateTime(sh.opened_at)}${sh.closed_at ? ` | ปิด: ${formatDateTime(sh.closed_at)}` : ' | ยังเปิดอยู่'}`,
      `💰 ยอดขายรวม (${formatNumber(billCount)} บิล): ${formatBaht(totalSalesAmt)}`,
      `   • สด ${formatBaht(cashAmt)} | โอน ${formatBaht(qrAmt)} | เชื่อ ${formatBaht(creditAmt)}`,
      `🤝 รับหนี้สด: ${formatBaht(debtCashAmt)} | 💸 รายจ่ายสุทธิ: ${expText}`,
      sh.status === 'open'
        ? `🏦 เงินสดควรมีในลิ้นชัก (ขณะนี้): ${formatBaht(expectedAmt)}`
        : `🏦 ลิ้นชัก: ควรมี ${formatBaht(expectedAmt)} | นับได้ ${actualAmt !== null ? formatBaht(actualAmt) : '-'} | ส่วนต่าง ${diffText}`,
      ...(grade ? [`🏅 เกรดความแม่นยำ: ${grade.label}`] : []),
      ...(diffAmt !== null && diffAmt !== 0 && varianceReason
        ? [`📝 สาเหตุส่วนต่าง: ${varianceReason}`]
        : []),
      ...(netCashDropAmt !== null
        ? [
            `💵 เงินสดนำส่งเจ้าของร้าน: ${formatBaht(netCashDropAmt)} (กันทอน ${formatBaht(nextShiftFloatAmt)})`,
          ]
        : []),
      ...(sh.note ? [`📌 หมายเหตุ: ${sh.note}`] : []),
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedLineTarget(targetKey);
      setTimeout(() => {
        setCopiedLineTarget((prev) => (prev === targetKey ? null : prev));
      }, 2500);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const handleDenomChange = (denom: number, value: string) => {
    const nextCounts = { ...denomCounts, [denom]: value };
    setDenomCounts(nextCounts);
    const total = DENOMINATIONS.reduce((sum, d) => {
      const qty = Math.max(0, parseInt(nextCounts[d] || '0', 10) || 0);
      return sum + d * qty;
    }, 0);
    setActualCash(String(total));
  };

  const handleResetDenom = () => {
    setDenomCounts({});
    setActualCash('0');
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift) return;
    const actual = Number(actualCash) || 0;
    const diff = actual - summary.expectedCash;
    const trimmedBaseNote = closeNote.trim();
    const finalNote = attachChecklistToNote
      ? trimmedBaseNote
        ? `${trimmedBaseNote} | ${formatClosingChecklistNote(closingChecklist)}`
        : formatClosingChecklistNote(closingChecklist)
      : trimmedBaseNote;

    await supabase
      .from('shifts')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        expected_cash: summary.expectedCash,
        actual_cash: actual,
        diff_cash: diff,
        note: finalNote,
      })
      .eq('id', activeShift.id);

    const nextFloat = Math.max(0, Number(closeNextShiftFloat) || 0);
    saveShiftCashierName(activeShift.id, closeShiftCashierName);
    saveShiftNextFloat(activeShift.id, nextFloat);
    if (Math.round(diff * 100) !== 0 && closeVarianceReason.trim()) {
      saveShiftVarianceReason(activeShift.id, closeVarianceReason);
    } else if (Math.round(diff * 100) === 0) {
      saveShiftVarianceReason(activeShift.id, '');
    }
    if (closeHandoverMemoText.trim()) {
      saveHandoverMemo({
        text: closeHandoverMemoText,
        author: closeShiftCashierName.trim() || shiftCashierNames[activeShift.id] || '',
        urgent: closeHandoverMemoUrgent,
      });
    }
    setCloseModalOpen(false);
    setActualCash('');
    setCloseNextShiftFloat('');
    setCloseNote('');
    setCloseVarianceReason('');
    setCloseShiftCashierName('');
    setCloseHandoverMemoText('');
    setCloseHandoverMemoUrgent(false);
    setUseDenomCounter(false);
    setDenomCounts({});
    setClosingChecklist(createEmptyClosingChecklist());
    setAttachChecklistToNote(false);
    loadData();
  };

  const handleExportShiftsCSV = async () => {
    const rowsToExport = [...(activeShift ? [activeShift] : []), ...shiftHistory];
    if (rowsToExport.length === 0) return;

    const shiftIds = rowsToExport.map((sh) => sh.id);
    const [{ data: salesData }, { data: expensesData }] = await Promise.all([
      supabase
        .from('sales')
        .select('shift_id, payment_method, total_amount')
        .in('shift_id', shiftIds),
      supabase
        .from('expenses')
        .select('shift_id, type, amount, note')
        .in('shift_id', shiftIds),
    ]);

    const aggMap = new Map<
      string,
      { cash: number; qr: number; credit: number; expense: number; safeDrop: number }
    >();
    const getAgg = (shiftId: string) => {
      let entry = aggMap.get(shiftId);
      if (!entry) {
        entry = { cash: 0, qr: 0, credit: 0, expense: 0, safeDrop: 0 };
        aggMap.set(shiftId, entry);
      }
      return entry;
    };

    for (const s of (salesData as Pick<Sale, 'shift_id' | 'payment_method' | 'total_amount'>[]) ?? []) {
      if (!s.shift_id) continue;
      const entry = getAgg(s.shift_id);
      const amt = Number(s.total_amount);
      if (s.payment_method === 'cash') entry.cash += amt;
      else if (s.payment_method === 'qr') entry.qr += amt;
      else if (s.payment_method === 'credit') entry.credit += amt;
    }

    for (const e of (expensesData as Pick<Expense, 'shift_id' | 'type' | 'amount' | 'note'>[]) ?? []) {
      if (!e.shift_id || e.type !== 'expense') continue;
      const entry = getAgg(e.shift_id);
      const amt = Number(e.amount) || 0;
      if (isSafeCashDropExpense(e)) {
        entry.safeDrop = Math.round((entry.safeDrop + amt) * 100) / 100;
      } else {
        entry.expense += amt;
      }
    }

    const escapeCsv = (val: string | number | null | undefined) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    let nextFloatsMap: Record<string, number> = shiftNextFloats;
    try {
      const rawFloats = window.localStorage.getItem(SHIFT_NEXT_FLOATS_STORAGE_KEY);
      if (rawFloats !== null) {
        nextFloatsMap = parseShiftNextFloatsMap(rawFloats);
      }
    } catch {
      // Fallback to in-memory state
    }

    const headers = [
      'วันที่เปิดกะ',
      'วันที่ปิดกะ',
      'สถานะ',
      'ผู้ดูแลกะ',
      'เงินทอนตั้งต้น',
      'ยอดขายเงินสด',
      'โอนเงิน',
      'ขายเชื่อ',
      'รายจ่ายเงินสด',
      'เก็บเข้าเซฟระหว่างกะ',
      'เงินนับได้จริง',
      'ส่วนต่าง',
      'เงินทอนเก็บกะถัดไป',
      'เงินสดนำส่ง (Net Cash Drop)',
      'หมายเหตุ',
    ];

    const rows = rowsToExport.map((sh) => {
      const agg = aggMap.get(sh.id) ?? { cash: 0, qr: 0, credit: 0, expense: 0, safeDrop: 0 };
      const isClosedWithActual = sh.status === 'closed' && sh.actual_cash !== null;
      const nextFloatAmt = nextFloatsMap[sh.id] ?? Number(sh.opening_cash ?? 0);
      const netCashDropAmt = isClosedWithActual
        ? calcNetCashDrop(Number(sh.actual_cash), nextFloatAmt)
        : null;
      return [
        escapeCsv(formatDateTime(sh.opened_at)),
        escapeCsv(sh.closed_at ? formatDateTime(sh.closed_at) : '-'),
        escapeCsv(sh.status === 'open' ? 'เปิดอยู่' : 'ปิดกะแล้ว'),
        escapeCsv(shiftCashierNames[sh.id] || ''),
        escapeCsv(Number(sh.opening_cash).toFixed(2)),
        escapeCsv(agg.cash.toFixed(2)),
        escapeCsv(agg.qr.toFixed(2)),
        escapeCsv(agg.credit.toFixed(2)),
        escapeCsv(agg.expense.toFixed(2)),
        escapeCsv(agg.safeDrop.toFixed(2)),
        escapeCsv(sh.actual_cash !== null ? Number(sh.actual_cash).toFixed(2) : ''),
        escapeCsv(sh.diff_cash !== null ? Number(sh.diff_cash).toFixed(2) : ''),
        escapeCsv(isClosedWithActual ? nextFloatAmt.toFixed(2) : ''),
        escapeCsv(netCashDropAmt !== null ? netCashDropAmt.toFixed(2) : ''),
        escapeCsv(sh.note || ''),
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `shifts-history-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const filterShiftExpenses = (
    list: Expense[],
    filterType: 'all' | 'store_expense' | 'safe_drop' | 'income',
    searchQuery: string
  ) => {
    const q = searchQuery.trim().toLowerCase();
    return list.filter((exp) => {
      if (filterType === 'income' && exp.type !== 'income') return false;
      if (filterType === 'safe_drop' && !isSafeCashDropExpense(exp)) return false;
      if (
        filterType === 'store_expense' &&
        (exp.type !== 'expense' || isSafeCashDropExpense(exp))
      ) {
        return false;
      }
      if (q) {
        const noteMatch = (exp.note ?? '').toLowerCase().includes(q);
        const catMatch = (exp.category ?? '').toLowerCase().includes(q);
        if (!noteMatch && !catMatch) return false;
      }
      return true;
    });
  };

  const handleExportShiftExpensesCsv = (shift: Shift, expensesList: Expense[]) => {
    if (!shift || expensesList.length === 0) return;
    const escapeCsv = (val: string | number | null | undefined) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };
    const headers = ['เวลา', 'ประเภท', 'หมวดหมู่', 'หมายเหตุ', 'จำนวนเงิน'];
    const rows = expensesList.map((exp) => {
      const typeLabel =
        exp.type === 'income'
          ? 'นำเงินเข้า'
          : isSafeCashDropExpense(exp)
            ? 'เก็บเข้าเซฟ'
            : 'รายจ่ายร้าน';
      const signedAmount =
        exp.type === 'income'
          ? Number(exp.amount).toFixed(2)
          : (-Math.abs(Number(exp.amount))).toFixed(2);
      return [
        escapeCsv(formatDateTime(exp.created_at)),
        escapeCsv(typeLabel),
        escapeCsv(exp.category),
        escapeCsv(exp.note ?? ''),
        escapeCsv(signedAmount),
      ].join(',');
    });
    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = shift.opened_at.slice(0, 10);
    link.href = url;
    link.download = `shift-cash-movements-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const printableShiftData = useMemo(() => {
    const target = printRequest?.target ?? (selectedShift ? 'modal' : 'active');
    const sh = target === 'active' ? activeShift : selectedShift;
    if (!sh) return null;

    const isAct = target === 'active';
    const cashAmt = isAct ? summary.cash : detailSummary.cash;
    const qrAmt = isAct ? summary.qr : detailSummary.qr;
    const creditAmt = isAct ? summary.credit : detailSummary.credit;
    const totalSalesAmt = isAct ? summary.totalSales : detailSummary.totalSales;
    const debtCashAmt = isAct ? debtCashInShift : shiftDebtCashDetail;
    const expNetAmt = isAct ? expenseInShift : detailSummary.netExpense;
    const billCount = isAct ? salesInShift.length : shiftSalesDetail.length;
    const expectedAmt =
      sh.status === 'open'
        ? isAct
          ? summary.expectedCash
          : detailSummary.expectedCash
        : Number(sh.expected_cash ?? 0);
    const actualAmt = sh.actual_cash !== null ? Number(sh.actual_cash) : null;
    const diffAmt =
      sh.diff_cash !== null
        ? Number(sh.diff_cash)
        : actualAmt !== null
          ? actualAmt - expectedAmt
          : null;

    const velocity =
      sh.status === 'closed' && sh.closed_at
        ? calcShiftVelocity(sh.opened_at, sh.closed_at, totalSalesAmt, billCount)
        : null;
    const safeDropAmt = isAct ? summary.safeDropInShift : detailSummary.safeDropTotal;
    const regularExpNetAmt = isAct ? summary.regularExpenseInShift : detailSummary.regularNetExpense;
    const nextShiftFloatAmt =
      !isAct && selectedShift && selectedShift.id === sh.id
        ? Math.max(0, Number(detailNextShiftFloat) || 0)
        : (shiftNextFloats[sh.id] ?? Number(sh.opening_cash ?? 0));
    const netCashDropAmt = calcNetCashDrop(actualAmt, nextShiftFloatAmt);
    const totalShiftHandoverAmt =
      netCashDropAmt !== null ? Math.round((netCashDropAmt + safeDropAmt) * 100) / 100 : null;
    const targetAchievement =
      sh.status === 'closed'
        ? getShiftTargetAchievement(totalSalesAmt, shiftSalesTarget)
        : null;
    const cashAccuracyGrade =
      sh.status === 'closed' ? getCashAccuracyGrade(actualAmt, expectedAmt) : null;

    return {
      mode: printRequest?.mode ?? 'summary',
      shift: sh,
      cashierName: shiftCashierNames[sh.id] ?? '',
      cashAmt,
      qrAmt,
      creditAmt,
      totalSalesAmt,
      debtCashAmt,
      expNetAmt,
      safeDropAmt,
      regularExpNetAmt,
      billCount,
      expectedAmt,
      actualAmt,
      diffAmt,
      nextShiftFloatAmt,
      netCashDropAmt,
      totalShiftHandoverAmt,
      durationText: sh.closed_at
        ? formatShiftDuration(sh.opened_at, sh.closed_at)
        : 'กำลังเปิดกะ',
      velocity,
      targetAchievement,
      cashAccuracyGrade,
      varianceReason: shiftVarianceReasons[sh.id] ?? '',
    };
  }, [
    printRequest,
    selectedShift,
    activeShift,
    shiftCashierNames,
    shiftNextFloats,
    shiftVarianceReasons,
    detailNextShiftFloat,
    summary,
    detailSummary,
    debtCashInShift,
    shiftDebtCashDetail,
    expenseInShift,
    salesInShift.length,
    shiftSalesDetail.length,
    shiftSalesTarget,
  ]);

  return (
    <>
      <div className="print:hidden">
        <AppShell storeName={settings?.store_name || 'ร้านขายของชำ POS'}>
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              ปิดกะ &amp; นับเงินลิ้นชัก
            </h1>
            <p className="text-sm text-slate-500">
              เปิดรอบการขาย บันทึกเงินทอนตั้งต้น และตรวจนับเงินสดในลิ้นชักตอนปิดร้าน
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(copiedTarget || copiedLineTarget) && (
              <div className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs">
                <Check className="h-4 w-4 shrink-0" />
                <span>
                  {copiedLineTarget
                    ? 'คัดลอกสรุปกะฉบับย่อส่ง LINE แล้ว!'
                    : 'คัดลอกข้อมูลสรุปกะลง Clipboard แล้ว!'}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={openCashierBackupModal}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-xs"
            >
              <Database className="h-4 w-4 text-sky-600 shrink-0" />
              <span>สำรอง/กู้คืนตั้งค่ากะ (JSON)</span>
            </button>
          </div>
        </div>

        {/* Shift Handover Memo Card */}
        <div
          className={`rounded-2xl border p-4 sm:p-5 shadow-xs space-y-3 transition-colors ${
            handoverMemo?.urgent
              ? 'border-rose-300 bg-rose-50/70'
              : handoverMemo
                ? 'border-sky-200 bg-sky-50/50'
                : 'border-slate-200 bg-white'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  handoverMemo?.urgent
                    ? 'bg-rose-100 text-rose-700'
                    : handoverMemo
                      ? 'bg-sky-100 text-sky-700'
                      : 'bg-slate-100 text-slate-600'
                }`}
              >
                <StickyNote className="h-4 w-4" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900">
                    กระดานฝากข้อความส่งต่อกะถัดไป (Shift Handover Memo)
                  </h2>
                  {handoverMemo?.urgent && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">
                      <Pin className="h-3 w-3" />
                      <span>ปักหมุดด่วน</span>
                    </span>
                  )}
                  {!handoverMemo && !editingHandoverMemo && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                      ยังไม่มีข้อความค้าง
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  ส่งต่อเรื่องสำคัญ เงินทอน สินค้าใกล้หมด หรือเหตุการณ์หน้าร้านให้กะถัดไปรับทราบ
                </p>
              </div>
            </div>

            {!editingHandoverMemo && (
              <div className="flex flex-wrap items-center gap-2">
                {handoverMemo ? (
                  <>
                    <button
                      type="button"
                      onClick={toggleHandoverMemoUrgent}
                      className={`inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors ${
                        handoverMemo.urgent
                          ? 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700'
                          : 'border-rose-200 bg-white text-rose-700 hover:bg-rose-50'
                      }`}
                    >
                      <Pin className="h-3.5 w-3.5" />
                      <span>{handoverMemo.urgent ? 'ยกเลิกปักหมุดด่วน' : 'ปักหมุดด่วน'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleStartEditHandoverMemo}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>แก้ไข</span>
                    </button>
                    <button
                      type="button"
                      onClick={clearHandoverMemo}
                      className="inline-flex items-center gap-1 rounded-xl border border-emerald-300 bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>รับทราบ &amp; เคลียร์ข้อความ</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartEditHandoverMemo}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-sky-700 shadow-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>ฝากข้อความถึงกะถัดไป</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {editingHandoverMemo ? (
            <form
              onSubmit={handleSaveHandoverMemoForm}
              className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3"
            >
              <div>
                <label
                  htmlFor="handover-memo-text"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  ข้อความส่งต่อกะถัดไป
                </label>
                <textarea
                  id="handover-memo-text"
                  rows={3}
                  required
                  autoFocus
                  value={memoDraftText}
                  onChange={(e) => setMemoDraftText(e.target.value)}
                  placeholder="เช่น เหลือเหรียญ 10 น้อย ช่วยแลกเพิ่ม, นมกล่องหมดหลังร้านรอซัพพลายเออร์มาส่งพรุ่งนี้เช้า..."
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label
                    htmlFor="handover-memo-author"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    ผู้ฝากข้อความ (แคชเชียร์ / เจ้าของร้าน)
                  </label>
                  <input
                    id="handover-memo-author"
                    type="text"
                    value={memoDraftAuthor}
                    onChange={(e) => setMemoDraftAuthor(e.target.value)}
                    placeholder="เช่น คุณสมชาย (กะบ่าย)"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                  />
                  {savedCashierNamePresets.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {savedCashierNamePresets.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setMemoDraftAuthor(preset)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                            memoDraftAuthor.trim() === preset
                              ? 'border-sky-600 bg-sky-600 text-white'
                              : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <label className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2.5 text-xs font-bold text-rose-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={memoDraftUrgent}
                    onChange={(e) => setMemoDraftUrgent(e.target.checked)}
                    className="h-4 w-4 rounded border-rose-300 text-rose-600 focus:ring-rose-500"
                  />
                  <Pin className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                  <span>ปักหมุดข้อความด่วน (Urgent)</span>
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div>
                  {handoverMemo && (
                    <button
                      type="button"
                      onClick={clearHandoverMemo}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>เคลียร์ข้อความ</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingHandoverMemo(false)}
                    className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={!memoDraftText.trim()}
                    className="inline-flex items-center gap-1 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>บันทึกข้อความส่งต่อ</span>
                  </button>
                </div>
              </div>
            </form>
          ) : handoverMemo ? (
            <div
              className={`rounded-xl border bg-white px-4 py-3 space-y-2 ${
                handoverMemo.urgent ? 'border-rose-200' : 'border-sky-200/80'
              }`}
            >
              <p className="text-sm sm:text-base font-semibold text-slate-900 whitespace-pre-wrap break-words leading-relaxed">
                {handoverMemo.text}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100 text-[11px] text-slate-500">
                <span>
                  ฝากโดย:{' '}
                  <strong className="text-slate-700">
                    {handoverMemo.author || 'ไม่ระบุผู้ฝาก'}
                  </strong>
                </span>
                <span>
                  อัปเดตเมื่อ:{' '}
                  {handoverMemo.updatedAt ? formatDateTime(handoverMemo.updatedAt) : '-'}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              ไม่มีข้อความฝากส่งต่อกะ — กดปุ่ม &ldquo;ฝากข้อความถึงกะถัดไป&rdquo; หรือกรอกได้ตอนปิดกะ
            </p>
          )}
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">กำลังโหลด...</div>
        ) : activeShift ? (
          <div className="rounded-2xl bg-white border border-emerald-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <Unlock className="h-5 w-5" />
                </span>
                <div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                    กำลังเปิดกะขาย
                  </span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    เปิดเมื่อ {formatDateTime(activeShift.opened_at)}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                      <UserCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>
                        ผู้ดูแลกะ:{' '}
                        <strong className="text-slate-900">
                          {shiftCashierNames[activeShift.id] || 'ยังไม่ระบุ'}
                        </strong>
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveCashierInput(shiftCashierNames[activeShift.id] ?? '');
                        setEditingActiveCashier((prev) => !prev);
                      }}
                      className="text-xs font-bold text-emerald-700 hover:underline"
                    >
                      {editingActiveCashier
                        ? 'ปิดการแก้ไข'
                        : shiftCashierNames[activeShift.id]
                          ? 'แก้ไขผู้ดูแลกะ'
                          : '+ ระบุผู้ดูแลกะ'}
                    </button>
                  </div>
                  {activeShift.note && (
                    <p className="text-xs text-amber-700 font-medium mt-0.5">
                      หมายเหตุกะ: {activeShift.note}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleOpenEditShiftModal}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Edit3 className="h-4 w-4" />
                  <span>แก้ไขเงินตั้งต้น/หมายเหตุ</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyShiftSummary('active')}
                  className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors ${
                    copiedTarget === 'active'
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {copiedTarget === 'active' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  <span>
                    {copiedTarget === 'active' ? 'คัดลอกสรุปกะแล้ว!' : 'คัดลอกสรุปกะ'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => activeShift && handleCopyLineShiftSummary(activeShift, 'active')}
                  className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors ${
                    copiedLineTarget === 'active'
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  }`}
                >
                  {copiedLineTarget === 'active' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <MessageSquare className="h-4 w-4" />
                  )}
                  <span>
                    {copiedLineTarget === 'active'
                      ? 'คัดลอกส่ง LINE แล้ว!'
                      : 'คัดลอกสรุปกะส่ง LINE'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintShiftSummary('active')}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Printer className="h-4 w-4" />
                  <span>พิมพ์สรุปกะ</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrintOpeningFloatSlip}
                  className="flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100"
                >
                  <Printer className="h-4 w-4" />
                  <span>พิมพ์ใบรับเงินทอนเปิดกะ</span>
                </button>
                <button
                  type="button"
                  onClick={() => setExpModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="h-4 w-4" />
                  <span>บันทึกรายจ่าย/รับเงินสดในกะ</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewShiftDetail(activeShift)}
                  className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                >
                  <Receipt className="h-4 w-4" />
                  <span>ดูบิลในกะนี้ ({salesInShift.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActualCash(String(summary.expectedCash));
                    setCloseNextShiftFloat(String(Number(activeShift.opening_cash ?? 0)));
                    setCloseNote(activeShift.note ?? '');
                    setCloseShiftCashierName(shiftCashierNames[activeShift.id] ?? '');
                    setDenomCounts({});
                    setUseDenomCounter(false);
                    setClosingChecklist(createEmptyClosingChecklist());
                    setAttachChecklistToNote(false);
                    setCloseHandoverMemoText('');
                    setCloseHandoverMemoUrgent(false);
                    setCloseModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
                >
                  <Lock className="h-4 w-4" />
                  <span>ปิดกะ &amp; นับเงิน</span>
                </button>
              </div>
            </div>

            {editingActiveCashier && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveShiftCashierName(activeShift.id, activeCashierInput);
                  setEditingActiveCashier(false);
                }}
                className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 space-y-2.5"
              >
                <CashierNameSelector
                  value={activeCashierInput}
                  onChange={setActiveCashierInput}
                  presets={savedCashierNamePresets}
                  compact
                  autoFocus
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>บันทึกผู้ดูแลกะ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingActiveCashier(false)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>ยกเลิก</span>
                  </button>
                </div>
              </form>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
              <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs text-slate-500">เงินทอนตั้งต้น</span>
                  <button
                    type="button"
                    onClick={handleOpenEditShiftModal}
                    className="text-[11px] font-bold text-emerald-700 hover:underline"
                  >
                    แก้ไข
                  </button>
                </div>
                <p className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                  {formatBaht(activeShift.opening_cash)}
                </p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3 border border-emerald-100">
                <span className="text-xs text-emerald-700">ขายเงินสด (+รับหนี้สด)</span>
                <p className="text-base font-bold text-emerald-800 tabular-nums mt-0.5">
                  {formatBaht(summary.cash + debtCashInShift)}
                </p>
                {debtCashInShift > 0 && (
                  <p className="text-[11px] text-emerald-600 mt-0.5">
                    รวมรับหนี้สด {formatBaht(debtCashInShift)}
                  </p>
                )}
              </div>
              <div className="rounded-xl bg-rose-50 p-3 border border-rose-100">
                <span className="text-xs text-rose-700">รายจ่ายทั่วไปสุทธิในกะ</span>
                <p className="text-base font-bold text-rose-800 tabular-nums mt-0.5">
                  {summary.regularExpenseInShift > 0
                    ? `-${formatBaht(summary.regularExpenseInShift)}`
                    : formatBaht(Math.abs(summary.regularExpenseInShift))}
                </p>
                <p className="text-[11px] text-rose-600 mt-0.5 tabular-nums">
                  {expensesListInShift.length} รายการ
                  {summary.safeDropInShift > 0 && (
                    <span className="block font-bold text-indigo-700">
                      เก็บเข้าเซฟ -{formatBaht(summary.safeDropInShift)}
                    </span>
                  )}
                </p>
              </div>
              <div className="rounded-xl bg-sky-50 p-3 border border-sky-100">
                <span className="text-xs text-sky-700">PromptPay QR</span>
                <p className="text-base font-bold text-sky-800 tabular-nums mt-0.5">
                  {formatBaht(summary.qr)}
                </p>
              </div>
              <div className="rounded-xl bg-amber-50 p-3 border border-amber-100">
                <span className="text-xs text-amber-700">เงินเชื่อ (เซ็นไว้)</span>
                <p className="text-base font-bold text-amber-800 tabular-nums mt-0.5">
                  {formatBaht(summary.credit)}
                </p>
              </div>
            </div>

            {/* Shift Sales Target Progress Bar */}
            {(() => {
              const target = shiftSalesTarget > 0 ? shiftSalesTarget : DEFAULT_SHIFT_SALES_TARGET;
              const currentSales = summary.totalSales;
              const pct = target > 0 ? (currentSales / target) * 100 : 0;
              const clampedPct = Math.min(100, Math.max(0, pct));
              const diff = currentSales - target;
              const reached = currentSales >= target;
              return (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-slate-800">
                      <Target className="h-4 w-4 text-emerald-600" />
                      <span>เป้าหมายยอดขายประจำกะ</span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                          reached
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-sky-100 text-sky-800'
                        }`}
                      >
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-bold text-slate-700 tabular-nums">
                        {formatBaht(currentSales)} / {formatBaht(target)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setShiftTargetInput(String(target));
                          setEditingShiftTarget((prev) => !prev);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                      >
                        <Edit3 className="h-3 w-3" />
                        <span>แก้ไขเป้าหมาย</span>
                      </button>
                    </div>
                  </div>

                  {editingShiftTarget && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const num = Number(shiftTargetInput);
                        if (!Number.isFinite(num) || num <= 0) return;
                        saveShiftSalesTarget(num);
                        setEditingShiftTarget(false);
                      }}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5"
                    >
                      <label htmlFor="shift-sales-target-input" className="text-xs font-semibold text-slate-700">
                        เป้าหมายยอดขายต่อกะ (บาท):
                      </label>
                      <input
                        id="shift-sales-target-input"
                        type="number"
                        min="1"
                        step="any"
                        value={shiftTargetInput}
                        onChange={(e) => setShiftTargetInput(e.target.value)}
                        className="w-32 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-900 tabular-nums focus:border-emerald-500 focus:outline-none"
                        autoFocus
                      />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>บันทึก</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingShiftTarget(false)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>ยกเลิก</span>
                      </button>
                    </form>
                  )}

                  <div className="h-3 w-full rounded-full overflow-hidden bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all ${
                        reached ? 'bg-emerald-500' : 'bg-sky-500'
                      }`}
                      style={{ width: `${clampedPct}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span
                      className={`font-bold tabular-nums ${
                        reached ? 'text-emerald-700' : 'text-sky-700'
                      }`}
                    >
                      {reached
                        ? `ทะลุเป้าหมายกะนี้แล้ว! +${formatBaht(diff)}`
                        : `อีก ${formatBaht(Math.abs(diff))} จะถึงเป้าหมายกะ`}
                    </span>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {formatNumber(salesInShift.length)} บิล
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Payment channel breakdown bar in current shift */}
            {(() => {
              const total = summary.totalSales;
              const cashPct = total > 0 ? (summary.cash / total) * 100 : 0;
              const qrPct = total > 0 ? (summary.qr / total) * 100 : 0;
              const creditPct = total > 0 ? (summary.credit / total) * 100 : 0;
              return (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700">สัดส่วนช่องทางการขายในกะปัจจุบัน</span>
                    <span className="text-slate-500 tabular-nums">
                      รวม {formatBaht(total)}
                    </span>
                  </div>
                  <div className="h-3 w-full rounded-full overflow-hidden bg-slate-200 flex">
                    {total > 0 && (
                      <>
                        {cashPct > 0 && (
                          <div
                            className="bg-emerald-500 h-full transition-all"
                            style={{ width: `${cashPct}%` }}
                            title={`เงินสด ${cashPct.toFixed(1)}%`}
                          />
                        )}
                        {qrPct > 0 && (
                          <div
                            className="bg-sky-500 h-full transition-all"
                            style={{ width: `${qrPct}%` }}
                            title={`QR ${qrPct.toFixed(1)}%`}
                          />
                        )}
                        {creditPct > 0 && (
                          <div
                            className="bg-amber-500 h-full transition-all"
                            style={{ width: `${creditPct}%` }}
                            title={`เงินเชื่อ ${creditPct.toFixed(1)}%`}
                          />
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" />
                      <span className="text-slate-600">เงินสด:</span>
                      <span className="font-bold text-slate-900">
                        {formatBaht(summary.cash)} ({cashPct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-sky-500 inline-block" />
                      <span className="text-slate-600">QR:</span>
                      <span className="font-bold text-sky-700">
                        {formatBaht(summary.qr)} ({qrPct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-500 inline-block" />
                      <span className="text-slate-600">เงินเชื่อ:</span>
                      <span className="font-bold text-amber-700">
                        {formatBaht(summary.credit)} ({creditPct.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Real-time Cash Drawer Liquidity Bar & Safety Alert */}
            {(() => {
              const openingAmt = Math.max(0, summary.openingCash);
              const netCashAmt = summary.netCashInShift;
              const positiveNetCash = Math.max(0, netCashAmt);
              const liquidityBase = openingAmt + positiveNetCash;
              const openingPct = liquidityBase > 0 ? (openingAmt / liquidityBase) * 100 : 0;
              const netCashPct = liquidityBase > 0 ? (positiveNetCash / liquidityBase) * 100 : 0;
              const isHighCash = summary.expectedCash >= CASH_DRAWER_SAFE_LIMIT;
              const safeUsagePct = Math.min(
                100,
                Math.max(0, (summary.expectedCash / CASH_DRAWER_SAFE_LIMIT) * 100)
              );

              return (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-slate-700">
                      <Wallet className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                      <span>ติดตามสภาพคล่องเงินสดในลิ้นชัก (Real-time)</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 tabular-nums">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          isHighCash
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}
                      >
                        {isHighCash
                          ? `เกินเกณฑ์ปลอดภัย (${formatBahtPrefix(CASH_DRAWER_SAFE_LIMIT)})`
                          : `${safeUsagePct.toFixed(0)}% ของเกณฑ์ปลอดภัย (${formatBahtPrefix(CASH_DRAWER_SAFE_LIMIT)})`}
                      </span>
                      <span className="font-extrabold text-slate-900">
                        รวมในลิ้นชัก {formatBaht(summary.expectedCash)}
                      </span>
                      <button
                        type="button"
                        onClick={handleOpenSafeDropModal}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-700 transition-colors shadow-xs"
                      >
                        <span>🔒 แบ่งเงินสดเก็บเข้าเซฟ</span>
                      </button>
                    </div>
                  </div>

                  <div className="h-3 w-full rounded-full overflow-hidden bg-slate-200 flex">
                    {liquidityBase > 0 && (
                      <>
                        {openingPct > 0 && (
                          <div
                            className="bg-indigo-500 h-full transition-all duration-300"
                            style={{ width: `${openingPct}%` }}
                            title={`เงินทอนตั้งต้น ${formatBaht(openingAmt)} (${openingPct.toFixed(1)}%)`}
                          />
                        )}
                        {netCashPct > 0 && (
                          <div
                            className="bg-emerald-500 h-full transition-all duration-300"
                            style={{ width: `${netCashPct}%` }}
                            title={`เงินสดรับสุทธิระหว่างกะ ${formatBaht(netCashAmt)} (${netCashPct.toFixed(1)}%)`}
                          />
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 inline-block shrink-0" />
                      <span className="text-slate-600">เงินทอนตั้งต้น:</span>
                      <span className="font-bold text-indigo-700">
                        {formatBaht(openingAmt)} ({openingPct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-2.5 w-2.5 rounded-full inline-block shrink-0 ${
                          netCashAmt >= 0 ? 'bg-emerald-500' : 'bg-rose-500'
                        }`}
                      />
                      <span className="text-slate-600">เงินสดรับสุทธิระหว่างกะ:</span>
                      <span
                        className={`font-bold ${
                          netCashAmt >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {netCashAmt >= 0
                          ? `+${formatBaht(netCashAmt)} (${netCashPct.toFixed(1)}%)`
                          : `-${formatBaht(Math.abs(netCashAmt))} (รายจ่ายเกินเงินสดรับ)`}
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 tabular-nums">
                    เงินสดรับสุทธิระหว่างกะ = ขายสด ({formatBaht(summary.cash)}) + รับหนี้สด (
                    {formatBaht(debtCashInShift)}) - รายจ่ายทั่วไป (
                    {formatBaht(summary.regularExpenseInShift)})
                    {summary.safeDropInShift > 0 &&
                      ` - แบ่งเก็บเข้าเซฟระหว่างกะ (${formatBaht(summary.safeDropInShift)})`}
                  </p>

                  {isHighCash && (
                    <div
                      role="status"
                      className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-amber-900 flex items-start gap-2.5"
                    >
                      <AlertTriangle
                        className="h-4 w-4 text-amber-600 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <div className="text-xs leading-relaxed">
                        <p className="font-bold text-amber-900">
                          เงินสดในลิ้นชักสูง ({formatBahtPrefix(summary.expectedCash)}) แนะนำแบ่งเก็บเข้าเซฟเพื่อความปลอดภัย
                        </p>
                        <p className="text-[11px] text-amber-800 mt-0.5 tabular-nums">
                          สูงกว่าเกณฑ์ปลอดภัย ({formatBahtPrefix(CASH_DRAWER_SAFE_LIMIT)}) อยู่{' '}
                          <span className="font-bold">
                            {formatBahtPrefix(summary.expectedCash - CASH_DRAWER_SAFE_LIMIT)}
                          </span>{' '}
                          · เมื่อเก็บเงินเข้าเซฟแล้ว สามารถบันทึกรายการนำเงินออกในกะเพื่อตัดยอดลิ้นชักให้ตรงจริงได้
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Expenses in current shift */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700">
                  รายการรายจ่าย / รายรับเงินสดในกะนี้ ({expensesListInShift.length})
                </span>
                <div className="flex items-center gap-2">
                  {expensesListInShift.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        handleExportShiftExpensesCsv(activeShift, expensesListInShift)
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                    >
                      📥 ส่งออกรายการรับ/จ่ายกะนี้ (CSV)
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpModalOpen(true)}
                    className="text-xs font-bold text-emerald-700 hover:underline"
                  >
                    + เพิ่มรายการ
                  </button>
                </div>
              </div>
              {expensesListInShift.length === 0 ? (
                <p className="text-xs text-slate-400 py-1">
                  ยังไม่มีรายการนำเงินสดออกจากลิ้นชักหรือรับเงินสดพิเศษในกะนี้
                </p>
              ) : (
                <div className="space-y-2">
                  <ShiftExpenseCategorySummary breakdown={activeExpenseBreakdown} />
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap items-center gap-1">
                      {(
                        [
                          { id: 'all', label: 'ทั้งหมด' },
                          { id: 'store_expense', label: 'รายจ่ายร้าน' },
                          { id: 'safe_drop', label: '🔒 เก็บเข้าเซฟ' },
                          { id: 'income', label: 'นำเงินเข้า' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveExpenseFilter(tab.id)}
                          className={`rounded-lg px-2 py-1 text-[11px] font-bold transition-colors ${
                            activeExpenseFilter === tab.id
                              ? 'bg-slate-800 text-white'
                              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={activeExpenseSearch}
                      onChange={(e) => setActiveExpenseSearch(e.target.value)}
                      placeholder="ค้นหาหมายเหตุ..."
                      aria-label="ค้นหาหมายเหตุรายการรับจ่ายในกะ"
                      className="w-full sm:w-48 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  {(() => {
                    const filteredActiveExpenses = filterShiftExpenses(
                      expensesListInShift,
                      activeExpenseFilter,
                      activeExpenseSearch
                    );
                    if (filteredActiveExpenses.length === 0) {
                      return (
                        <p className="text-xs text-slate-400 py-2 text-center">
                          ไม่พบรายการที่ตรงกับตัวกรอง
                        </p>
                      );
                    }
                    return (
                      <div className="divide-y divide-slate-200/70 max-h-44 overflow-y-auto">
                        {filteredActiveExpenses.map((exp) => {
                    const isConfirmingDelete = confirmDeleteExpenseId === exp.id;
                    const isDeleting = deletingExpenseId === exp.id;
                    return (
                      <div
                        key={exp.id}
                        className="py-1.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {exp.type === 'income' ? (
                            <ArrowDownCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <ArrowUpCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <span className="font-semibold text-slate-800">{exp.category}</span>
                            {exp.note && (
                              <span className="text-slate-500 ml-1.5">· {exp.note}</span>
                            )}
                            <span className="block text-[11px] text-slate-400">
                              {formatDateTime(exp.created_at)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`font-bold tabular-nums ${
                              exp.type === 'income' ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            {exp.type === 'income' ? '+' : '-'}
                            {formatBaht(exp.amount)}
                          </span>
                          {isConfirmingDelete ? (
                            <div className="flex items-center gap-1 ml-1">
                              <button
                                type="button"
                                disabled={isDeleting}
                                onClick={() => handleDeleteShiftExpense(exp.id)}
                                className="rounded-md bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                              >
                                {isDeleting ? 'กำลังลบ...' : 'ยืนยันลบ'}
                              </button>
                              <button
                                type="button"
                                disabled={isDeleting}
                                onClick={() => setConfirmDeleteExpenseId(null)}
                                className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                              >
                                ยกเลิก
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 ml-1">
                              <button
                                type="button"
                                onClick={() => openEditExpenseModal(exp)}
                                title="แก้ไขรายการ"
                                className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              >
                                <Edit3 className="h-3 w-3" />
                                <span>แก้ไข</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteExpenseId(exp.id)}
                                title="ลบรายการ"
                                className="inline-flex items-center gap-0.5 rounded-md border border-rose-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="h-3 w-3" />
                                <span>ลบ</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Debt payments in current shift */}
            <InShiftDebtPaymentsTable
              payments={debtPaymentsInShift}
              title="รายการรับชำระหนี้ในกะนี้"
            />

            {/* Top 5 Best-Selling Products in Current Shift */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <Award className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>สินค้าขายดี 5 อันดับในกะปัจจุบัน</span>
                </div>
                {topProductsInShift.length > 0 && (
                  <span className="text-[11px] text-slate-500">
                    เรียงตามยอดขายรวม
                  </span>
                )}
              </div>
              {topProductsInShift.length === 0 ? (
                <p className="text-xs text-slate-400 py-1">
                  ยังไม่มีรายการขายสินค้าในกะนี้
                </p>
              ) : (
                <div className="divide-y divide-slate-200/70">
                  {topProductsInShift.map((item, idx) => (
                    <div
                      key={item.name}
                      className="py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-800">
                          {idx + 1}
                        </span>
                        <span className="font-semibold text-slate-800 truncate">
                          {item.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 tabular-nums">
                        <span className="text-slate-500">
                          {formatNumber(item.qty)} หน่วย
                        </span>
                        <span className="font-bold text-slate-900 min-w-[72px] text-right">
                          {formatBaht(item.revenue)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl bg-slate-900 text-white p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-300">
                  เงินสดที่ควรมีในลิ้นชัก (ตั้งต้น + ขายสด + รับหนี้สด - รายจ่าย)
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  จำนวนบิลในกะนี้: {salesInShift.length} บิล · ยอดขายรวมทุกช่องทาง{' '}
                  {formatBaht(summary.totalSales)}
                </p>
              </div>
              <span className="text-2xl font-extrabold tabular-nums">
                {formatBaht(summary.expectedCash)}
              </span>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleOpenShift}
            className="rounded-2xl bg-white border border-slate-200 p-6 max-w-md space-y-4 shadow-xs"
          >
            <div className="flex items-center gap-2 text-slate-900 font-bold">
              <Clock className="h-5 w-5 text-emerald-600" />
              <h2>เปิดกะขายใหม่</h2>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                เงินทอนตั้งต้นในลิ้นชัก (บาท)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                required
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                readOnly={useOpeningDenomCounter}
                className={`w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-lg font-bold tabular-nums ${
                  useOpeningDenomCounter ? 'bg-slate-50 text-slate-700' : 'bg-white'
                }`}
              />
            </div>

            {/* Collapsible Opening Cash Denomination Counter */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const next = !useOpeningDenomCounter;
                    setUseOpeningDenomCounter(next);
                    if (next) {
                      const hasAny = Object.values(openingDenomCounts).some(
                        (v) => (parseInt(v || '0', 10) || 0) > 0
                      );
                      if (hasAny) {
                        setOpeningCash(String(openingDenomSummary.total));
                      }
                    }
                  }}
                  aria-expanded={useOpeningDenomCounter}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors ${
                    useOpeningDenomCounter
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Calculator className="h-3.5 w-3.5" />
                  <span>นับธนบัตรและเหรียญเงินทอนตั้งต้น</span>
                </button>

                {useOpeningDenomCounter && (
                  <button
                    type="button"
                    onClick={handleResetOpeningDenom}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-rose-600"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>ล้างค่า</span>
                  </button>
                )}
              </div>

              {useOpeningDenomCounter && (
                <div className="space-y-2.5 pt-1">
                  <div className="grid grid-cols-3 gap-2">
                    {DENOMINATIONS.map((denom) => {
                      const qty = Math.max(
                        0,
                        parseInt(openingDenomCounts[denom] || '0', 10) || 0
                      );
                      const isBanknote = denom >= 20;
                      return (
                        <div
                          key={denom}
                          className="rounded-lg bg-white border border-slate-200 p-2 flex flex-col gap-1"
                        >
                          <div className="flex items-center justify-between text-[11px]">
                            <span
                              className={`font-bold ${
                                isBanknote ? 'text-emerald-700' : 'text-amber-700'
                              }`}
                            >
                              {denom.toLocaleString()} ฿
                            </span>
                            <span className="text-slate-400">
                              {isBanknote ? 'ใบ' : 'เหรียญ'}
                            </span>
                          </div>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            placeholder="0"
                            value={openingDenomCounts[denom] ?? ''}
                            onChange={(e) => handleOpeningDenomChange(denom, e.target.value)}
                            className="w-full rounded-md border border-slate-300 px-2 py-1 text-right text-sm font-bold tabular-nums focus:border-emerald-500 focus:outline-none"
                          />
                          <div className="text-[10px] text-right text-slate-500 tabular-nums">
                            = {(denom * qty).toLocaleString()} ฿
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 text-xs tabular-nums">
                    <span className="text-slate-600 font-medium">
                      ยอดรวมเงินทอนตั้งต้น:
                    </span>
                    <span className="font-extrabold text-emerald-700">
                      ฿{openingDenomSummary.total.toLocaleString()}
                    </span>
                  </div>

                  {openingDenomSummary.total > 0 && openingDenomSummary.smallChangeTotal < 200 && (
                    <div
                      role="alert"
                      className="rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-800 tabular-nums"
                    >
                      ⚠️ แบงก์ย่อยและเหรียญมีเพียง ฿
                      {openingDenomSummary.smallChangeTotal.toLocaleString()} แนะนำเตรียมแบงก์ 20 และเหรียญเพิ่มให้พอทอนช่วงเปิดร้าน
                    </div>
                  )}
                </div>
              )}
            </div>
            <CashierNameSelector
              value={openShiftCashierName}
              onChange={setOpenShiftCashierName}
              presets={savedCashierNamePresets}
            />
            <button
              type="submit"
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700"
            >
              เริ่มเปิดกะขาย
            </button>
          </form>
        )}

        {/* Cashier Performance Summary Card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
              <Users className="h-5 w-5 text-emerald-600 shrink-0" />
              <h2>สรุปผลงานแยกตามผู้ดูแลกะ / แคชเชียร์</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-700 tabular-nums">
                {formatNumber(shiftHistory.length)} กะที่ปิดแล้ว
              </span>
              {shiftHistory.length > 0 && (
                <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 font-bold text-emerald-700 tabular-nums">
                  {formatNumber(cashierPerformanceStats.filter((c) => c.isNamed).length)} ผู้ดูแลกะที่ระบุชื่อ
                </span>
              )}
            </div>
          </div>

          {cashierPerformanceStats.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-400">
              ยังไม่มีประวัติกะที่ปิดแล้วสำหรับสรุปผลงานผู้ดูแลกะ
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {cashierPerformanceStats.every((c) => !c.isNamed) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2 text-xs text-amber-900">
                  ยังไม่มีการระบุชื่อผู้ดูแลกะในประวัติกะที่ปิดแล้ว — สามารถกรอกหรือเลือกชื่อผู้ดูแลกะได้เมื่อเปิด/ปิดกะ หรือแก้ไขในหน้าต่างรายละเอียดกะ
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-bold text-slate-600">
                      <th className="py-2.5 px-3 whitespace-nowrap rounded-tl-lg">
                        ผู้ดูแลกะ / แคชเชียร์
                      </th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">จำนวนกะที่ปิด</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">ชั่วโมงทำงานรวม</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">ยอดขายรวม</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">ยอดขายเฉลี่ย/กะ</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">ยอดขายเฉลี่ย/ชม.</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">เงินสดตรงเป๊ะ</th>
                      <th className="py-2.5 px-3 text-center whitespace-nowrap">
                        เกรดความแม่นยำ (A+ / B / C)
                      </th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">
                        🔒 เก็บเข้าเซฟรวม (฿)
                      </th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap rounded-tr-lg">
                        ส่วนต่างเงินสดรวม
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {cashierPerformanceStats.map((row) => {
                      const isFilteringThis =
                        row.isNamed && historySearch.trim() === row.cashierName;
                      return (
                        <tr
                          key={row.key}
                          className={`transition-colors ${
                            isFilteringThis ? 'bg-emerald-50/60' : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <td className="py-2.5 px-3 min-w-[200px]">
                            <div className="flex items-center justify-between gap-2">
                              {row.isNamed ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setHistorySearch((prev) =>
                                      prev.trim() === row.cashierName ? '' : row.cashierName
                                    )
                                  }
                                  title="คลิกเพื่อกรองประวัติกะของผู้ดูแลกะคนนี้"
                                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition-colors"
                                >
                                  <UserCheck className="h-3 w-3 shrink-0" />
                                  <span>{row.cashierName}</span>
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                                  <span>{row.cashierName}</span>
                                </span>
                              )}
                              <span className="text-[11px] font-semibold text-slate-400">
                                {row.sharePct.toFixed(1)}%
                              </span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  style={{ width: `${row.sharePct}%` }}
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    row.isNamed ? 'bg-emerald-500' : 'bg-slate-400'
                                  }`}
                                />
                              </div>
                              <span className="text-[11px] text-slate-400 shrink-0">
                                {formatNumber(row.totalBills)} บิล
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap font-bold text-slate-800">
                            {formatNumber(row.closedCount)} กะ
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap font-semibold text-slate-700">
                            {formatNumber(Number(row.totalHours.toFixed(1)))} ชม.
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap font-extrabold text-slate-900">
                            {formatBaht(row.totalSales)}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap font-semibold text-emerald-700">
                            {formatBaht(row.avgSalesPerShift)}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap font-semibold text-sky-700">
                            {formatBaht(row.salesPerHour)}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 font-bold text-slate-800">
                              <CheckCircle2
                                className={`h-3.5 w-3.5 ${
                                  row.exactMatchCount === row.closedCount
                                    ? 'text-emerald-600'
                                    : 'text-slate-400'
                                }`}
                              />
                              <span>
                                {formatNumber(row.exactMatchCount)} / {formatNumber(row.closedCount)} กะ
                              </span>
                            </span>
                            <span className="block text-[11px] text-slate-400">
                              ({row.exactMatchRatePct.toFixed(0)}%)
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            <div className="inline-flex items-center gap-1 text-[11px] font-bold">
                              <span
                                title="เกรด A+ (ตรงเป๊ะ)"
                                className="rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200 px-1.5 py-0.5"
                              >
                                A+: {formatNumber(row.gradeAPlusCount)}
                              </span>
                              <span
                                title="เกรด B (คลาดเคลื่อน ≤฿20)"
                                className="rounded-md bg-sky-100 text-sky-800 border border-sky-200 px-1.5 py-0.5"
                              >
                                B: {formatNumber(row.gradeBCount)}
                              </span>
                              <span
                                title="เกรด C (ต่างเกิน ฿20)"
                                className={`rounded-md border px-1.5 py-0.5 ${
                                  row.gradeCCount > 0
                                    ? 'bg-rose-100 text-rose-800 border-rose-200'
                                    : 'bg-slate-100 text-slate-500 border-slate-200'
                                }`}
                              >
                                C: {formatNumber(row.gradeCCount)}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="font-bold text-indigo-700">
                              {formatBaht(row.totalSafeHandover)}
                            </div>
                            {row.totalSafeDropInShift > 0 && (
                              <div className="text-[11px] text-slate-400">
                                ระหว่างกะ {formatBaht(row.totalSafeDropInShift)}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                row.totalDiffCash === 0
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : row.totalDiffCash > 0
                                    ? 'bg-sky-50 text-sky-700'
                                    : 'bg-rose-50 text-rose-700'
                              }`}
                            >
                              {row.totalDiffCash > 0
                                ? `เกิน +${formatBaht(row.totalDiffCash)}`
                                : row.totalDiffCash < 0
                                  ? `ขาด ${formatBaht(row.totalDiffCash)}`
                                  : `ตรงเป๊ะ ${formatBaht(0)}`}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/90 text-xs font-extrabold text-slate-900 tabular-nums">
                      <td className="py-2.5 px-3">รวมประวัติกะที่ปิดแล้วทั้งหมด</td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {formatNumber(historySummary.totalCount)} กะ
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap text-slate-700">
                        {formatNumber(Number(historySummary.totalClosedHours.toFixed(1)))} ชม.
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {formatBaht(historySummary.totalClosedSales)}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap text-emerald-700">
                        {formatBaht(historySummary.avgTotalSales)}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap text-sky-700">
                        {formatBaht(historySummary.avgSalesPerHour)}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {formatNumber(historySummary.exactMatchCount)} /{' '}
                        {formatNumber(historySummary.totalCount)} กะ
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1 text-[11px] font-bold">
                          <span className="rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200 px-1.5 py-0.5">
                            A+:{' '}
                            {formatNumber(
                              cashierPerformanceStats.reduce((s, r) => s + r.gradeAPlusCount, 0)
                            )}
                          </span>
                          <span className="rounded-md bg-sky-100 text-sky-800 border border-sky-200 px-1.5 py-0.5">
                            B:{' '}
                            {formatNumber(
                              cashierPerformanceStats.reduce((s, r) => s + r.gradeBCount, 0)
                            )}
                          </span>
                          <span className="rounded-md bg-rose-100 text-rose-800 border border-rose-200 px-1.5 py-0.5">
                            C:{' '}
                            {formatNumber(
                              cashierPerformanceStats.reduce((s, r) => s + r.gradeCCount, 0)
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap text-indigo-700">
                        {formatBaht(
                          cashierPerformanceStats.reduce((s, r) => s + r.totalSafeHandover, 0)
                        )}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right whitespace-nowrap ${
                          historySummary.totalDiffCash === 0
                            ? 'text-emerald-700'
                            : historySummary.totalDiffCash > 0
                              ? 'text-sky-700'
                              : 'text-rose-700'
                        }`}
                      >
                        {historySummary.totalDiffCash > 0
                          ? `เกินสุทธิ +${formatBaht(historySummary.totalDiffCash)}`
                          : historySummary.totalDiffCash < 0
                            ? `ขาดสุทธิ ${formatBaht(historySummary.totalDiffCash)}`
                            : `ตรงเป๊ะ ${formatBaht(0)}`}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Shift History */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="font-bold text-slate-900 text-sm">
                รายการกะ &amp; ประวัติการปิดกะ ({filteredShiftHistory.length}
                {historySearch.trim() || shiftStatusFilter !== 'all' || cashierFilter !== 'all'
                  ? ` / ${allShifts.length}`
                  : ''}
                )
              </span>
              <span className="block sm:inline sm:ml-2 text-xs text-slate-500">
                คลิกที่แถวหรือปุ่มเพื่อดูบิลในกะ
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="ค้นหารหัสกะ, ผู้ดูแลกะ, วันที่เปิด/ปิด, หมายเหตุ..."
                  className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-8 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                />
                {historySearch && (
                  <button
                    type="button"
                    onClick={() => setHistorySearch('')}
                    aria-label="ล้างคำค้นหา"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleExportShiftsCSV}
                disabled={shiftHistory.length === 0 && !activeShift}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                <span>ส่งออก CSV</span>
              </button>
            </div>
          </div>
          {allShifts.length > 0 && (
            <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor="shift-cashier-filter"
                  className="text-xs font-semibold text-slate-600 whitespace-nowrap"
                >
                  ผู้ดูแลกะ / แคชเชียร์:
                </label>
                <select
                  id="shift-cashier-filter"
                  value={cashierFilter}
                  onChange={(e) => setCashierFilter(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="all">ผู้ดูแลกะทั้งหมด</option>
                  {cashierFilterOptions.names.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  {cashierFilterOptions.hasUnassigned && (
                    <option value="__unassigned__">ไม่ระบุผู้ดูแลกะ</option>
                  )}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">
                  กรองสถานะกะ:
                </span>
                <div className="inline-flex flex-wrap rounded-xl bg-slate-200/70 p-1 gap-0.5">
                  {(
                    [
                      { key: 'all', label: 'ทั้งหมด' },
                      { key: 'open', label: 'เปิดอยู่' },
                      { key: 'closed', label: 'ปิดแล้ว' },
                      { key: 'diff', label: 'มีส่วนต่างเงินสด' },
                      { key: 'grade_c', label: 'ต้องตรวจสอบ (เกรด C >฿20)' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setShiftStatusFilter(opt.key)}
                      className={`rounded-lg px-3 py-1 text-xs font-bold transition-colors ${
                        shiftStatusFilter === opt.key
                          ? opt.key === 'grade_c'
                            ? 'bg-rose-600 text-white shadow-xs'
                            : opt.key === 'diff'
                              ? 'bg-amber-600 text-white shadow-xs'
                              : opt.key === 'open'
                                ? 'bg-emerald-600 text-white shadow-xs'
                                : 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Closed Shifts Net Cash Variance & Benchmark Summary Bar */}
          {shiftHistory.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 px-4 py-3 bg-slate-50/80 border-b border-slate-200">
              <div className="rounded-xl bg-white border border-slate-200 px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">กะที่ปิดแล้วทั้งหมด</span>
                <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                  {historySummary.totalCount} กะ
                </span>
              </div>
              <div className="rounded-xl bg-white border border-slate-200 px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">เงินตรงเป๊ะ (diff = 0)</span>
                <span className="inline-flex items-center gap-1 text-sm font-extrabold text-emerald-700 tabular-nums">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  {historySummary.exactMatchCount} / {historySummary.totalCount} กะ
                </span>
              </div>
              <div className="rounded-xl bg-white border border-slate-200 px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">ส่วนต่างเงินสดสุทธิรวม (เกิน/ขาด)</span>
                <span
                  className={`text-sm font-extrabold tabular-nums ${
                    historySummary.totalDiffCash === 0
                      ? 'text-emerald-700'
                      : historySummary.totalDiffCash > 0
                        ? 'text-sky-700'
                        : 'text-rose-700'
                  }`}
                >
                  {historySummary.totalDiffCash > 0
                    ? `เกินสุทธิ +${formatBaht(historySummary.totalDiffCash)}`
                    : historySummary.totalDiffCash < 0
                      ? `ขาดสุทธิ ${formatBaht(historySummary.totalDiffCash)}`
                      : `ตรงเป๊ะ ${formatBaht(0)}`}
                </span>
              </div>
              <div className="rounded-xl bg-white border border-slate-200 px-3.5 py-2.5 flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-slate-500 block">
                    ทำยอดทะลุเป้าหมาย
                  </span>
                  <span className="text-[10px] text-slate-400 tabular-nums">
                    เป้า {formatBaht(shiftSalesTarget)} / กะ
                  </span>
                </div>
                <span
                  className={`inline-flex items-center gap-1 text-sm font-extrabold tabular-nums ${
                    historySummary.targetMetCount > 0
                      ? 'text-emerald-700'
                      : 'text-slate-600'
                  }`}
                >
                  <Target className="h-4 w-4 text-emerald-600" />
                  {historySummary.targetMetCount} / {historySummary.totalCount} กะ
                </span>
              </div>
              <div className="rounded-xl bg-white border border-emerald-200/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 sm:col-span-2 lg:col-span-2">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-emerald-600 shrink-0" />
                  <div>
                    <span className="text-xs font-bold text-slate-700 block">
                      ยอดเงินสดนำส่งเจ้าของร้านรวมทั้งหมด
                    </span>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      จาก {formatNumber(historySummary.netCashDropCount)} กะที่มีการนับเงินสดจริง (หลังหักเงินทอนกะถัดไป)
                    </span>
                  </div>
                </div>
                <span className="text-base font-extrabold text-emerald-700 tabular-nums">
                  {formatBaht(historySummary.totalNetCashDrop)}
                </span>
              </div>
              <div className="rounded-xl bg-white border border-emerald-200/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 sm:col-span-2 lg:col-span-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-600 shrink-0" />
                  <div>
                    <span className="text-xs font-bold text-slate-700">
                      ค่าเฉลี่ยประสิทธิภาพต่อกะ (ยอดขายเงินสด+โอน+เชื่อ)
                    </span>
                    <span className="block text-[11px] text-slate-500 tabular-nums">
                      สด {formatBaht(historySummary.avgCashSales)} · โอน {formatBaht(historySummary.avgQrSales)} · เชื่อ {formatBaht(historySummary.avgCreditSales)} · เฉลี่ย {historySummary.avgBillsPerShift.toFixed(1)} บิล/กะ
                    </span>
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <span className="text-base font-extrabold text-emerald-700">
                    {formatBaht(historySummary.avgTotalSales)}
                  </span>
                  <span className="text-xs font-semibold text-slate-500 ml-1">/ กะ</span>
                </div>
              </div>
              {varianceReasonBreakdown.totalVarianceShifts > 0 && (
                <div className="rounded-xl bg-white border border-amber-200/80 px-3.5 py-3 sm:col-span-2 lg:col-span-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      <span className="text-xs font-bold text-slate-800">
                        สรุปสาเหตุส่วนต่างเงินสด (เงินสดขาด/เกิน)
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                      พบส่วนต่าง {formatNumber(varianceReasonBreakdown.totalVarianceShifts)} กะ ·{' '}
                      {formatNumber(varianceReasonBreakdown.groups.length)} หัวข้อ
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 tabular-nums">
                    {varianceReasonBreakdown.groups.map((item) => (
                      <div
                        key={item.isUnassigned ? '__unassigned__' : item.reason}
                        className={`rounded-lg border px-3 py-2 flex items-center justify-between gap-2 ${
                          item.isUnassigned
                            ? 'border-slate-200 bg-slate-50/80'
                            : 'border-amber-200/70 bg-amber-50/40'
                        }`}
                      >
                        <div className="min-w-0">
                          <p
                            title={item.reason}
                            className={`text-xs font-bold truncate ${
                              item.isUnassigned ? 'text-slate-600' : 'text-slate-900'
                            }`}
                          >
                            {item.reason}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            พบ {formatNumber(item.shiftCount)} กะ
                            {item.shortageCount > 0 && item.overageCount > 0
                              ? ` (ขาด ${formatNumber(item.shortageCount)} · เกิน ${formatNumber(item.overageCount)})`
                              : item.shortageCount > 0
                                ? ` (ขาด ${formatNumber(item.shortageCount)})`
                                : item.overageCount > 0
                                  ? ` (เกิน ${formatNumber(item.overageCount)})`
                                  : ''}
                          </p>
                        </div>
                        <span
                          className={`text-xs font-extrabold whitespace-nowrap ${
                            item.totalDiff === 0
                              ? 'text-emerald-700'
                              : item.totalDiff > 0
                                ? 'text-sky-700'
                                : 'text-rose-700'
                          }`}
                        >
                          {item.totalDiff > 0
                            ? `+${formatBaht(item.totalDiff)}`
                            : formatBaht(item.totalDiff)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {allShifts.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              ยังไม่มีประวัติการเปิด-ปิดกะ
            </div>
          ) : filteredShiftHistory.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 space-y-2">
              <p>
                {historySearch.trim()
                  ? `ไม่พบข้อมูลกะที่ตรงกับ "${historySearch}"`
                  : 'ไม่พบข้อมูลกะที่ตรงกับตัวกรองที่เลือก'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setHistorySearch('');
                  setShiftStatusFilter('all');
                  setCashierFilter('all');
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                ล้างตัวกรอง
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="px-4 py-3">เวลาเปิด - ปิด</th>
                    <th className="px-4 py-3">ผู้ดูแลกะ</th>
                    <th className="px-4 py-3">ระยะเวลา</th>
                    <th className="px-4 py-3 text-right">ยอดขายรวม</th>
                    <th className="px-4 py-3 text-right">ตั้งต้น</th>
                    <th className="px-4 py-3 text-right">ยอดในระบบ</th>
                    <th className="px-4 py-3 text-right">นับได้จริง</th>
                    <th className="px-4 py-3 text-right">ส่วนต่าง</th>
                    <th className="px-4 py-3 text-right">เงินสดนำส่ง</th>
                    <th className="px-4 py-3 text-right">รายละเอียด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredShiftHistory.map((sh) => {
                    const isOpen = sh.status === 'open';
                    const diff = isOpen
                      ? 0
                      : sh.actual_cash !== null
                        ? Number(sh.actual_cash) - Number(sh.expected_cash ?? 0)
                        : Number(sh.diff_cash ?? 0);
                    const durationText = isOpen
                      ? 'กำลังเปิดอยู่'
                      : formatShiftDuration(sh.opened_at, sh.closed_at);
                    const shiftTotalSales = isOpen
                      ? summary.totalSales
                      : (closedShiftSalesMap[sh.id]?.total ?? 0);
                    const vsAvgPct =
                      historySummary.avgTotalSales > 0
                        ? ((shiftTotalSales - historySummary.avgTotalSales) /
                            historySummary.avgTotalSales) *
                          100
                        : null;
                    const nextShiftFloatAmt =
                      shiftNextFloats[sh.id] ?? Number(sh.opening_cash ?? 0);
                    const safeDropAmt = isOpen
                      ? summary.safeDropInShift
                      : (closedShiftSafeDropMap[sh.id] ?? 0);
                    const netCashDropAmt =
                      isOpen || sh.actual_cash === null
                        ? null
                        : calcNetCashDrop(Number(sh.actual_cash), nextShiftFloatAmt);
                    const totalShiftHandoverAmt =
                      netCashDropAmt !== null
                        ? Math.round((netCashDropAmt + safeDropAmt) * 100) / 100
                        : null;
                    return (
                      <tr
                        key={sh.id}
                        onClick={() => handleViewShiftDetail(sh)}
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <div>เปิด: {formatDateTime(sh.opened_at)}</div>
                          {isOpen ? (
                            <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 mt-0.5">
                              กำลังเปิดอยู่
                            </span>
                          ) : (
                            <div>ปิด: {sh.closed_at ? formatDateTime(sh.closed_at) : '-'}</div>
                          )}
                          {sh.note && (
                            <div className="text-[11px] text-amber-700 mt-0.5">
                              หมายเหตุ: {sh.note}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">
                          {shiftCashierNames[sh.id] ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-800">
                              <UserCheck className="h-3 w-3 shrink-0" />
                              <span>{shiftCashierNames[sh.id]}</span>
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span
                            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold whitespace-nowrap ${
                              isOpen
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            <Clock className="h-3 w-3 opacity-70" />
                            {durationText}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <div className="font-bold text-slate-900">
                            {formatBaht(shiftTotalSales)}
                          </div>
                          {vsAvgPct !== null && (
                            <div
                              className={`text-[10px] font-semibold whitespace-nowrap ${
                                vsAvgPct >= 0 ? 'text-emerald-600' : 'text-amber-600'
                              }`}
                            >
                              {vsAvgPct >= 0
                                ? `+${vsAvgPct.toFixed(0)}%`
                                : `${vsAvgPct.toFixed(0)}%`}{' '}
                              เทียบเฉลี่ย
                            </div>
                          )}
                          {!isOpen && (() => {
                            const ach = getShiftTargetAchievement(shiftTotalSales, shiftSalesTarget);
                            return (
                              <div className="mt-0.5">
                                <span
                                  className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${
                                    ach.reached
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {ach.label}
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatBaht(sh.opening_cash)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatBaht(isOpen ? summary.expectedCash : sh.expected_cash)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">
                          {isOpen || sh.actual_cash === null ? '-' : formatBaht(sh.actual_cash)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {isOpen ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                              เปิดอยู่
                            </span>
                          ) : (
                            <div className="flex flex-col items-end gap-1">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                                  diff === 0
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : diff > 0
                                      ? 'bg-sky-50 text-sky-700'
                                      : 'bg-rose-50 text-rose-700'
                                }`}
                              >
                                {diff === 0 && <CheckCircle2 className="h-3 w-3" />}
                                {diff > 0 ? `+${formatBaht(diff)}` : formatBaht(diff)}
                              </span>
                              {(() => {
                                const grade = getCashAccuracyGrade(
                                  sh.actual_cash !== null ? Number(sh.actual_cash) : null,
                                  sh.expected_cash !== null ? Number(sh.expected_cash) : 0
                                );
                                if (!grade) return null;
                                return (
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${grade.badgeClass}`}
                                  >
                                    {grade.label}
                                  </span>
                                );
                              })()}
                              {diff !== 0 && shiftVarianceReasons[sh.id] && (
                                <span
                                  title={shiftVarianceReasons[sh.id]}
                                  className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 max-w-[180px] truncate"
                                >
                                  สาเหตุ: {shiftVarianceReasons[sh.id]}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {netCashDropAmt === null ? (
                            safeDropAmt > 0 ? (
                              <div>
                                <div className="text-xs font-bold text-indigo-700 whitespace-nowrap">
                                  เข้าเซฟแล้ว {formatBaht(safeDropAmt)}
                                </div>
                                <div className="text-[10px] text-slate-400 whitespace-nowrap">
                                  ระหว่างกะ (ยังไม่ปิด)
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )
                          ) : (
                            <div>
                              <div className="font-bold text-indigo-700">
                                {formatBaht(totalShiftHandoverAmt)}
                              </div>
                              {safeDropAmt > 0 && (
                                <div className="text-[10px] text-indigo-600 font-medium whitespace-nowrap">
                                  ปิดกะ {formatBaht(netCashDropAmt)} + เซฟ {formatBaht(safeDropAmt)}
                                </div>
                              )}
                              <div className="text-[10px] text-slate-400 whitespace-nowrap">
                                กันทอน {formatBaht(nextShiftFloatAmt)}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {!isOpen && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopyLineShiftSummary(sh, sh.id);
                                }}
                                title="คัดลอกสรุปกะฉบับย่อส่ง LINE"
                                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors whitespace-nowrap ${
                                  copiedLineTarget === sh.id
                                    ? 'border-emerald-600 bg-emerald-600 text-white'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                }`}
                              >
                                {copiedLineTarget === sh.id ? (
                                  <Check className="h-3.5 w-3.5" />
                                ) : (
                                  <MessageSquare className="h-3.5 w-3.5" />
                                )}
                                <span>
                                  {copiedLineTarget === sh.id ? 'คัดลอกแล้ว' : 'ส่ง LINE'}
                                </span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewShiftDetail(sh);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>ดูบิลในกะ</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Mid-Shift Safe Cash Drop Modal */}
      <Modal
        open={safeDropModalOpen}
        onClose={() => setSafeDropModalOpen(false)}
        title="🔒 แบ่งเงินสดเก็บเข้าเซฟระหว่างกะ"
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={handleSaveSafeDrop} className="space-y-4">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 space-y-1 text-xs tabular-nums">
            <div className="flex items-center justify-between">
              <span className="text-indigo-800 font-semibold">เงินสดที่ระบบคำนวณในลิ้นชักตอนนี้</span>
              <span className="font-extrabold text-indigo-950">{formatBaht(summary.expectedCash)}</span>
            </div>
            {safeDropAmount !== '' && Number(safeDropAmount) > 0 && (
              <div className="flex items-center justify-between pt-1 border-t border-indigo-200/70">
                <span className="text-indigo-700">ยอดคงเหลือในลิ้นชักหลังเก็บเข้าเซฟ</span>
                <span className="font-bold text-emerald-700">
                  {formatBaht(Math.max(0, summary.expectedCash - Number(safeDropAmount)))}
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              เลือกยอดด่วน หรือระบุจำนวนเงิน (บาท)
            </label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {SAFE_DROP_QUICK_AMOUNTS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSafeDropAmount(String(preset))}
                  className={`rounded-xl border py-2 text-xs font-bold tabular-nums transition-colors ${
                    Number(safeDropAmount) === preset
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-indigo-200 bg-indigo-50/60 text-indigo-800 hover:bg-indigo-100'
                  }`}
                >
                  {formatBahtPrefix(preset)}
                </button>
              ))}
            </div>
            <input
              type="number"
              min="1"
              step="any"
              required
              autoFocus
              value={safeDropAmount}
              onChange={(e) => setSafeDropAmount(e.target.value)}
              placeholder="0"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-lg font-bold tabular-nums focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              หมายเหตุเพิ่มเติม (ไม่บังคับ)
            </label>
            <input
              type="text"
              value={safeDropNote}
              onChange={(e) => setSafeDropNote(e.target.value)}
              placeholder="เช่น เก็บใส่ซองส่งเจ้าของร้านรอบบ่าย"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              ระบบจะบันทึกเป็นรายการนำเงินออกด้วยหมายเหตุขึ้นต้นว่า{' '}
              <span className="font-bold text-indigo-700">{SAFE_DROP_NOTE_PREFIX}</span>
            </p>
          </div>

          <button
            type="submit"
            disabled={safeDropSubmitting || !safeDropAmount || Number(safeDropAmount) <= 0}
            className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {safeDropSubmitting ? 'กำลังบันทึก...' : 'ยืนยันแบ่งเงินสดเก็บเข้าเซฟ'}
          </button>
        </form>
      </Modal>

      {/* Add Shift Expense Modal */}
      <Modal
        open={expModalOpen}
        onClose={() => setExpModalOpen(false)}
        title="บันทึกรายจ่าย / รับเงินสดในกะ"
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={handleAddShiftExpense} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setExpType('expense');
                setExpCategory('จ่ายค่าของสด/น้ำแข็ง');
              }}
              className={`rounded-xl border py-2.5 text-xs font-bold ${
                expType === 'expense'
                  ? 'border-rose-600 bg-rose-50 text-rose-700'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              นำเงินออก (รายจ่าย)
            </button>
            <button
              type="button"
              onClick={() => {
                setExpType('income');
                setExpCategory('เติมเงินทอน/รับสดอื่นๆ');
              }}
              className={`rounded-xl border py-2.5 text-xs font-bold ${
                expType === 'income'
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              นำเงินเข้า (รายรับสด)
            </button>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">รายการ</label>
            {expType === 'expense' && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {EXPENSE_CATEGORY_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setExpCategory(preset)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      expCategory === preset
                        ? 'border-rose-500 bg-rose-50 text-rose-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            )}
            <input
              type="text"
              required
              value={expCategory}
              onChange={(e) => setExpCategory(e.target.value)}
              placeholder="เช่น จ่ายค่าน้ำแข็ง, ซื้อถุงพลาสติก"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              จำนวนเงินสด (บาท)
            </label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              required
              autoFocus
              value={expAmount}
              onChange={(e) => setExpAmount(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-lg font-bold tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {expType === 'expense' ? 'หมายเหตุ / รายละเอียดรายจ่าย' : 'หมายเหตุ / รายละเอียด'}
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(expType === 'expense' ? EXPENSE_NOTE_PRESETS : INCOME_NOTE_PRESETS).map((preset) => {
                const activeClass =
                  expType === 'expense'
                    ? 'border-rose-500 bg-rose-50 text-rose-700'
                    : 'border-emerald-500 bg-emerald-50 text-emerald-700';
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setExpNote(preset)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      expNote === preset
                        ? activeClass
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              value={expNote}
              onChange={(e) => setExpNote(e.target.value)}
              placeholder={
                expType === 'expense'
                  ? 'เช่น ซื้อน้ำแข็ง/ของสด, ค่าถุง/บรรจุภัณฑ์'
                  : 'รายละเอียดเพิ่มเติม (ถ้ามี)'
              }
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800"
          >
            บันทึกรายการในกะ
          </button>
        </form>
      </Modal>

      {/* Edit Shift Expense Modal */}
      <Modal
        open={Boolean(editingExpense)}
        onClose={() => setEditingExpense(null)}
        title="แก้ไขรายการรายจ่าย / รับเงินสดในกะ"
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={handleUpdateShiftExpense} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setEditExpType('expense')}
              className={`rounded-xl border py-2.5 text-xs font-bold ${
                editExpType === 'expense'
                  ? 'border-rose-600 bg-rose-50 text-rose-700'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              นำเงินออก (รายจ่าย)
            </button>
            <button
              type="button"
              onClick={() => setEditExpType('income')}
              className={`rounded-xl border py-2.5 text-xs font-bold ${
                editExpType === 'income'
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              นำเงินเข้า (รายรับสด)
            </button>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">รายการ</label>
            {editExpType === 'expense' && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {EXPENSE_CATEGORY_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setEditExpCategory(preset)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      editExpCategory === preset
                        ? 'border-rose-500 bg-rose-50 text-rose-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            )}
            <input
              type="text"
              required
              value={editExpCategory}
              onChange={(e) => setEditExpCategory(e.target.value)}
              placeholder="เช่น จ่ายค่าน้ำแข็ง, ซื้อถุงพลาสติก"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              จำนวนเงินสด (บาท)
            </label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              required
              autoFocus
              value={editExpAmount}
              onChange={(e) => setEditExpAmount(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-lg font-bold tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {editExpType === 'expense' ? 'หมายเหตุ / รายละเอียดรายจ่าย' : 'หมายเหตุ / รายละเอียด'}
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(editExpType === 'expense' ? EXPENSE_NOTE_PRESETS : INCOME_NOTE_PRESETS).map((preset) => {
                const activeClass =
                  editExpType === 'expense'
                    ? 'border-rose-500 bg-rose-50 text-rose-700'
                    : 'border-emerald-500 bg-emerald-50 text-emerald-700';
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setEditExpNote(preset)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      editExpNote === preset
                        ? activeClass
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              value={editExpNote}
              onChange={(e) => setEditExpNote(e.target.value)}
              placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditingExpense(null)}
              className="w-1/3 rounded-xl border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={savingEditExpense}
              className="w-2/3 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {savingEditExpense ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Shift Detail Modal */}
      <Modal
        open={Boolean(selectedShift)}
        onClose={() => setSelectedShift(null)}
        title={
          selectedShift?.status === 'open'
            ? 'รายละเอียดบิลในกะปัจจุบัน'
            : 'รายละเอียดบิลและรายจ่ายในกะ'
        }
        maxWidthClass="max-w-2xl"
      >
        {selectedShift && (
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <span className="text-slate-500 block">
                    เวลาเปิดกะ: <strong className="text-slate-800">{formatDateTime(selectedShift.opened_at)}</strong>
                  </span>
                  <span className="text-slate-500 block">
                    เวลาปิดกะ:{' '}
                    <strong className="text-slate-800">
                      {selectedShift.closed_at ? formatDateTime(selectedShift.closed_at) : 'กำลังเปิดกะ'}
                    </strong>
                    {selectedShift.closed_at && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-slate-200/70 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
                        {formatShiftDuration(selectedShift.opened_at, selectedShift.closed_at)}
                      </span>
                    )}
                  </span>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="inline-flex items-center gap-1 text-slate-500">
                      <UserCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>ผู้ดูแลกะ / แคชเชียร์:</span>
                      <strong className="text-slate-900">
                        {shiftCashierNames[selectedShift.id] || 'ยังไม่ระบุ'}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setModalCashierInput(shiftCashierNames[selectedShift.id] ?? '');
                        setEditingModalCashier((prev) => !prev);
                      }}
                      className="font-bold text-emerald-700 hover:underline"
                    >
                      {editingModalCashier
                        ? 'ปิด'
                        : shiftCashierNames[selectedShift.id]
                          ? 'แก้ไข'
                          : '+ ระบุชื่อ'}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={detailLoading}
                    onClick={() => handleCopyShiftSummary('modal')}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${
                      copiedTarget === 'modal'
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    {copiedTarget === 'modal' ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {copiedTarget === 'modal' ? 'คัดลอกสรุปกะแล้ว!' : 'คัดลอกสรุปกะ'}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={detailLoading}
                    onClick={() => handlePrintShiftSummary('modal')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>
                      {selectedShift.status === 'closed'
                        ? 'พิมพ์ใบสรุปปิดกะ (Z-Report)'
                        : 'พิมพ์สรุปกะ'}
                    </span>
                  </button>
                </div>
              </div>
              {editingModalCashier && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveShiftCashierName(selectedShift.id, modalCashierInput);
                    setEditingModalCashier(false);
                  }}
                  className="rounded-xl border border-emerald-200 bg-white p-3 space-y-2.5"
                >
                  <CashierNameSelector
                    value={modalCashierInput}
                    onChange={setModalCashierInput}
                    presets={savedCashierNamePresets}
                    compact
                    autoFocus
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>บันทึกผู้ดูแลกะ</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingModalCashier(false)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>ยกเลิก</span>
                    </button>
                  </div>
                </form>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200/80 text-center">
                <div>
                  <span className="text-slate-500 block">เงินทอนตั้งต้น</span>
                  <span className="font-bold text-slate-900 text-sm tabular-nums">
                    {formatBaht(selectedShift.opening_cash)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">ยอดสดตามระบบ</span>
                  <span className="font-bold text-slate-900 text-sm tabular-nums">
                    {formatBaht(
                      selectedShift.status === 'open'
                        ? summary.expectedCash
                        : selectedShift.expected_cash
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">นับได้จริง</span>
                  <span className="font-bold text-emerald-700 text-sm tabular-nums">
                    {selectedShift.actual_cash !== null
                      ? formatBaht(selectedShift.actual_cash)
                      : '-'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">ส่วนต่าง</span>
                  <span
                    className={`font-bold text-sm tabular-nums ${
                      selectedShift.diff_cash === null
                        ? 'text-slate-400'
                        : Number(selectedShift.diff_cash) === 0
                          ? 'text-emerald-700'
                          : Number(selectedShift.diff_cash) > 0
                            ? 'text-sky-700'
                            : 'text-rose-700'
                    }`}
                  >
                    {selectedShift.diff_cash !== null
                      ? Number(selectedShift.diff_cash) > 0
                        ? `+${formatBaht(selectedShift.diff_cash)}`
                        : formatBaht(selectedShift.diff_cash)
                      : '-'}
                  </span>
                  {selectedShift.status === 'closed' && (() => {
                    const grade = getCashAccuracyGrade(
                      selectedShift.actual_cash !== null
                        ? Number(selectedShift.actual_cash)
                        : null,
                      selectedShift.expected_cash !== null
                        ? Number(selectedShift.expected_cash)
                        : 0
                    );
                    if (!grade) return null;
                    return (
                      <span
                        className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${grade.badgeClass}`}
                      >
                        {grade.label}
                      </span>
                    );
                  })()}
                </div>
              </div>
              {!detailLoading && (
                <>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/80 text-[11px] tabular-nums">
                    <div className="rounded-lg bg-white border border-slate-200/80 px-2.5 py-1.5">
                      <span className="text-slate-500 block">ยอดขายรวมในกะ</span>
                      <span className="font-bold text-slate-900 text-xs block">
                        {formatBaht(detailSummary.totalSales)}
                      </span>
                      {selectedShift.status === 'closed' && (() => {
                        const ach = getShiftTargetAchievement(
                          detailSummary.totalSales,
                          shiftSalesTarget
                        );
                        return (
                          <span
                            className={`mt-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                              ach.reached
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {ach.label}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="rounded-lg bg-white border border-slate-200/80 px-2.5 py-1.5">
                      <span className="text-slate-500 block">จำนวนบิลทั้งหมด</span>
                      <span className="font-bold text-slate-900 text-xs">
                        {formatNumber(shiftSalesDetail.length)} บิล
                      </span>
                    </div>
                    <div className="rounded-lg bg-white border border-slate-200/80 px-2.5 py-1.5">
                      <span className="text-slate-500 block">ยอดขายเฉลี่ยต่อบิล</span>
                      <span className="font-bold text-emerald-700 text-xs">
                        {shiftSalesDetail.length > 0
                          ? formatBaht(detailSummary.totalSales / shiftSalesDetail.length)
                          : formatBaht(0)}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200/80 text-[11px] tabular-nums">
                    <div className="rounded-lg bg-white border border-slate-200/80 px-2.5 py-1.5">
                      <span className="text-slate-500 block">ขายเงินสด</span>
                      <span className="font-bold text-emerald-700">
                        {formatBaht(detailSummary.cash)}
                      </span>
                    </div>
                    <div className="rounded-lg bg-white border border-slate-200/80 px-2.5 py-1.5">
                      <span className="text-slate-500 block">PromptPay QR</span>
                      <span className="font-bold text-sky-700">
                        {formatBaht(detailSummary.qr)}
                      </span>
                    </div>
                    <div className="rounded-lg bg-white border border-slate-200/80 px-2.5 py-1.5">
                      <span className="text-slate-500 block">เงินเชื่อ</span>
                      <span className="font-bold text-amber-700">
                        {formatBaht(detailSummary.credit)}
                      </span>
                    </div>
                    <div className="rounded-lg bg-white border border-slate-200/80 px-2.5 py-1.5">
                      <span className="text-slate-500 block">รายจ่ายเงินสดสุทธิ</span>
                      <span className="font-bold text-rose-700">
                        {detailSummary.netExpense > 0
                          ? `-${formatBaht(detailSummary.netExpense)}`
                          : formatBaht(Math.abs(detailSummary.netExpense))}
                      </span>
                    </div>
                  </div>
                  {selectedShift.status === 'closed' && detailVelocity && (
                    <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-2 text-xs tabular-nums">
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-100">
                        <span className="inline-flex items-center gap-1.5 font-bold text-slate-800">
                          <TrendingUp className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <span>วิเคราะห์ความเร็วการขายต่อชั่วโมง (Shift Sales Velocity)</span>
                        </span>
                        {detailVelocity.rawDurationHours < 0.25 && (
                          <span className="text-[11px] text-slate-500">
                            ใช้ฐานคำนวณขั้นต่ำ 0.25 ชม.
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-2.5 py-2">
                          <span className="text-[11px] font-medium text-slate-500 block">
                            ระยะเวลาเปิดกะ
                          </span>
                          <span className="font-extrabold text-slate-900 text-sm block mt-0.5">
                            {detailVelocity.durationText}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            ({formatNumber(Number(detailVelocity.durationHours.toFixed(2)))} ชม.)
                          </span>
                        </div>
                        <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/50 px-2.5 py-2">
                          <span className="text-[11px] font-medium text-emerald-700 block">
                            ยอดขายเฉลี่ยต่อชั่วโมง
                          </span>
                          <span className="font-extrabold text-emerald-800 text-sm block mt-0.5">
                            {formatBahtPrefix(detailVelocity.salesPerHour)}/ชม.
                          </span>
                          <span className="text-[11px] text-emerald-700/80">
                            จากยอดขาย {formatBaht(detailSummary.totalSales)}
                          </span>
                        </div>
                        <div className="rounded-lg border border-sky-200/80 bg-sky-50/50 px-2.5 py-2">
                          <span className="text-[11px] font-medium text-sky-700 block">
                            จำนวนบิลเฉลี่ยต่อชั่วโมง
                          </span>
                          <span className="font-extrabold text-sky-800 text-sm block mt-0.5">
                            {detailVelocity.billsPerHour.toFixed(1)} บิล/ชม.
                          </span>
                          <span className="text-[11px] text-sky-700/80">
                            จากทั้งหมด {formatNumber(shiftSalesDetail.length)} บิล
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  {selectedShift.status === 'closed' && (
                    <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-2.5 text-xs tabular-nums">
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-100">
                        <span className="inline-flex items-center gap-1.5 font-bold text-slate-800">
                          <ArrowLeftRight className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                          <span>เปรียบเทียบกับกะก่อนหน้า (Shift-over-Shift)</span>
                        </span>
                        {previousClosedShift && (
                          <span className="text-[11px] text-slate-500">
                            เทียบกะปิดเมื่อ{' '}
                            {previousClosedShift.closed_at
                              ? formatDateTime(previousClosedShift.closed_at)
                              : formatDateTime(previousClosedShift.opened_at)}
                          </span>
                        )}
                      </div>

                      {shiftComparison ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-2.5 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-medium text-slate-500">
                                ยอดขายรวม
                              </span>
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                                  shiftComparison.salesDelta.direction === 'up'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : shiftComparison.salesDelta.direction === 'down'
                                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                                      : 'bg-slate-100 text-slate-600 border-slate-200'
                                }`}
                              >
                                {shiftComparison.salesDelta.direction === 'up' && (
                                  <ArrowUpRight className="h-3 w-3 shrink-0" />
                                )}
                                {shiftComparison.salesDelta.direction === 'down' && (
                                  <ArrowDownRight className="h-3 w-3 shrink-0" />
                                )}
                                <span>{shiftComparison.salesDelta.text}</span>
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-extrabold text-slate-900 text-sm">
                                {formatBaht(detailSummary.totalSales)}
                              </span>
                              <span className="text-[11px] text-slate-500">
                                กะก่อนหน้า {formatBaht(shiftComparison.prevTotalSales)}
                              </span>
                            </div>
                          </div>

                          <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-2.5 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-medium text-slate-500">
                                เงินสดรับสุทธิ
                              </span>
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                                  shiftComparison.netCashDelta.direction === 'up'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : shiftComparison.netCashDelta.direction === 'down'
                                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                                      : 'bg-slate-100 text-slate-600 border-slate-200'
                                }`}
                              >
                                {shiftComparison.netCashDelta.direction === 'up' && (
                                  <ArrowUpRight className="h-3 w-3 shrink-0" />
                                )}
                                {shiftComparison.netCashDelta.direction === 'down' && (
                                  <ArrowDownRight className="h-3 w-3 shrink-0" />
                                )}
                                <span>{shiftComparison.netCashDelta.text}</span>
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-extrabold text-slate-900 text-sm">
                                {formatBaht(detailSummary.netCashReceived)}
                              </span>
                              <span className="text-[11px] text-slate-500">
                                กะก่อนหน้า {formatBaht(shiftComparison.prevNetCash)}
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 py-1">
                          ยังไม่มีข้อมูลกะที่ปิดก่อนหน้านี้ในประวัติ (เป็นกะเก่าสุดในรายการ)
                        </p>
                      )}
                    </div>
                  )}

                  {selectedShift.status === 'closed' && (
                    <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-1.5 text-xs tabular-nums">
                      <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-100">
                        <span className="font-bold text-slate-800">
                          สมการกระทบยอดเงินสดในลิ้นชัก
                        </span>
                        <span className="text-[11px] text-slate-400">
                          ตั้งต้น + ขายสด + รับหนี้สด - รายจ่ายสุทธิ
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>เงินทอนตั้งต้น</span>
                        <span className="font-semibold text-slate-900">
                          {formatBaht(selectedShift.opening_cash)}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>+ ขายเงินสด</span>
                        <span className="font-semibold text-emerald-700">
                          +{formatBaht(detailSummary.cash)}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>+ รับหนี้เงินสด</span>
                        <span className="font-semibold text-emerald-700">
                          +{formatBaht(shiftDebtCashDetail)}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>- รายจ่ายทั่วไปสุทธิ</span>
                        <span
                          className={`font-semibold ${
                            detailSummary.regularNetExpense > 0
                              ? 'text-rose-600'
                              : detailSummary.regularNetExpense < 0
                                ? 'text-emerald-700'
                                : 'text-slate-700'
                          }`}
                        >
                          {detailSummary.regularNetExpense > 0
                            ? `-${formatBaht(detailSummary.regularNetExpense)}`
                            : detailSummary.regularNetExpense < 0
                              ? `+${formatBaht(Math.abs(detailSummary.regularNetExpense))}`
                              : formatBaht(0)}
                        </span>
                      </div>
                      {detailSummary.safeDropTotal > 0 && (
                        <div className="flex justify-between text-indigo-700">
                          <span>- แบ่งเก็บเข้าเซฟระหว่างกะ</span>
                          <span className="font-semibold">
                            -{formatBaht(detailSummary.safeDropTotal)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between pt-1.5 border-t border-slate-200 font-bold text-slate-900">
                        <span>= ยอดที่ควรมีในลิ้นชัก</span>
                        <span>{formatBaht(selectedShift.expected_cash ?? 0)}</span>
                      </div>
                      <div className="flex justify-between font-bold text-emerald-700">
                        <span>เงินนับได้จริง</span>
                        <span>
                          {selectedShift.actual_cash !== null
                            ? formatBaht(selectedShift.actual_cash)
                            : '-'}
                        </span>
                      </div>
                      <div className="flex justify-between pt-1.5 border-t border-dashed border-slate-200 font-extrabold">
                        <span className="text-slate-800">ส่วนต่าง (นับได้จริง - ควรมี)</span>
                        <span
                          className={
                            selectedShift.diff_cash === null
                              ? 'text-slate-400'
                              : Number(selectedShift.diff_cash) === 0
                                ? 'text-emerald-700'
                                : Number(selectedShift.diff_cash) > 0
                                  ? 'text-sky-700'
                                  : 'text-rose-700'
                          }
                        >
                          {selectedShift.diff_cash === null
                            ? '-'
                            : Number(selectedShift.diff_cash) === 0
                              ? `${formatBaht(0)} (ครบพอดี)`
                              : Number(selectedShift.diff_cash) > 0
                                ? `+${formatBaht(selectedShift.diff_cash)} (เงินเกิน)`
                                : `${formatBaht(selectedShift.diff_cash)} (เงินขาด)`}
                        </span>
                      </div>
                      {selectedShift.status === 'closed' && (() => {
                        const grade = getCashAccuracyGrade(
                          selectedShift.actual_cash !== null
                            ? Number(selectedShift.actual_cash)
                            : null,
                          selectedShift.expected_cash !== null
                            ? Number(selectedShift.expected_cash)
                            : 0
                        );
                        if (!grade) return null;
                        return (
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-slate-600 font-semibold">
                              เกรดความแม่นยำลิ้นชักเงินสด
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${grade.badgeClass}`}
                            >
                              {grade.label}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </>
              )}
              {selectedShift.status === 'closed' && (
                <NetCashDropCalculator
                  inputId="detail-next-shift-float"
                  actualCash={
                    selectedShift.actual_cash !== null
                      ? Number(selectedShift.actual_cash)
                      : null
                  }
                  openingCash={Number(selectedShift.opening_cash ?? 0)}
                  nextShiftFloatInput={detailNextShiftFloat}
                  onNextShiftFloatChange={(val) => {
                    setDetailNextShiftFloat(val);
                    saveShiftNextFloat(selectedShift.id, Math.max(0, Number(val) || 0));
                  }}
                  safeDropInShift={detailSummary.safeDropTotal}
                />
              )}
              {selectedShift.status === 'closed' &&
                Math.round(Number(selectedShift.diff_cash ?? 0) * 100) !== 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-amber-900">
                        สาเหตุเงินสดขาด/เกิน
                      </span>
                      {shiftVarianceReasons[selectedShift.id] && (
                        <span className="inline-flex items-center rounded-full bg-white border border-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                          บันทึกแล้ว: {shiftVarianceReasons[selectedShift.id]}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {SHIFT_VARIANCE_REASON_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setDetailVarianceReasonInput(preset);
                            saveShiftVarianceReason(selectedShift.id, preset);
                            setVarianceReasonSavedFlash(true);
                            setTimeout(() => setVarianceReasonSavedFlash(false), 1800);
                          }}
                          className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
                            detailVarianceReasonInput.trim() === preset
                              ? 'border-amber-500 bg-amber-600 text-white'
                              : 'border-amber-200 bg-white text-amber-900 hover:bg-amber-100'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={detailVarianceReasonInput}
                        onChange={(e) => setDetailVarianceReasonInput(e.target.value)}
                        placeholder="ระบุสาเหตุเงินสดขาด/เกิน..."
                        className="flex-1 min-w-[200px] rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-amber-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          saveShiftVarianceReason(selectedShift.id, detailVarianceReasonInput);
                          setVarianceReasonSavedFlash(true);
                          setTimeout(() => setVarianceReasonSavedFlash(false), 1800);
                        }}
                        className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
                      >
                        {varianceReasonSavedFlash ? 'บันทึกแล้ว!' : 'บันทึกสาเหตุ'}
                      </button>
                    </div>
                  </div>
                )}
              {selectedShift.note && (
                <div className="pt-1 text-amber-700 font-medium">
                  หมายเหตุปิดกะ: {selectedShift.note}
                </div>
              )}
            </div>

            {detailLoading ? (
              <div className="py-8 text-center text-sm text-slate-500">กำลังโหลดข้อมูลบิล...</div>
            ) : (
              <>
                <div>
                  <h3 className="text-xs font-bold text-slate-700 mb-2">
                    รายการบิลขายในกะ ({shiftSalesDetail.length} บิล)
                  </h3>
                  {shiftSalesDetail.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 p-6 text-center text-xs text-slate-400">
                      ไม่มีรายการบิลขายในกะนี้
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                      {shiftSalesDetail.map((sale) => {
                        const pm = PAYMENT_LABEL[sale.payment_method] ?? PAYMENT_LABEL.cash;
                        return (
                          <div key={sale.id} className="p-3 bg-white space-y-1.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-700">
                                  {formatDateTime(sale.created_at)}
                                </span>
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${pm.badgeClass}`}
                                >
                                  {pm.label}
                                </span>
                                {sale.customers?.name && (
                                  <span className="text-amber-700 font-medium">
                                    ({sale.customers.name})
                                  </span>
                                )}
                              </div>
                              <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                                {formatBaht(sale.total_amount)}
                              </span>
                            </div>
                            {sale.sale_items && sale.sale_items.length > 0 && (
                              <div className="text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
                                {sale.sale_items.map((item) => (
                                  <span key={item.id}>
                                    • {item.product_name} x{item.qty} {item.unit_name} (
                                    {formatBaht(item.subtotal)})
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {shiftExpensesDetail.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-bold text-slate-700">
                        รายการรายจ่าย / รายรับเงินสดในกะ ({shiftExpensesDetail.length} รายการ)
                      </h3>
                      <button
                        type="button"
                        onClick={() =>
                          handleExportShiftExpensesCsv(selectedShift, shiftExpensesDetail)
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                      >
                        📥 ส่งออกรายการรับ/จ่ายกะนี้ (CSV)
                      </button>
                    </div>
                    <ShiftExpenseCategorySummary breakdown={detailExpenseBreakdown} />
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-1">
                        {(
                          [
                            { id: 'all', label: 'ทั้งหมด' },
                            { id: 'store_expense', label: 'รายจ่ายร้าน' },
                            { id: 'safe_drop', label: '🔒 เก็บเข้าเซฟ' },
                            { id: 'income', label: 'นำเงินเข้า' },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setDetailExpenseFilter(tab.id)}
                            className={`rounded-lg px-2 py-1 text-[11px] font-bold transition-colors ${
                              detailExpenseFilter === tab.id
                                ? 'bg-slate-800 text-white'
                                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={detailExpenseSearch}
                        onChange={(e) => setDetailExpenseSearch(e.target.value)}
                        placeholder="ค้นหาหมายเหตุ..."
                        aria-label="ค้นหาหมายเหตุรายการรับจ่ายในรายละเอียดกะ"
                        className="w-full sm:w-48 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    {(() => {
                      const filteredDetailExpenses = filterShiftExpenses(
                        shiftExpensesDetail,
                        detailExpenseFilter,
                        detailExpenseSearch
                      );
                      if (filteredDetailExpenses.length === 0) {
                        return (
                          <p className="text-xs text-slate-400 py-3 text-center rounded-xl border border-slate-200 bg-white">
                            ไม่พบรายการที่ตรงกับตัวกรอง
                          </p>
                        );
                      }
                      return (
                        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                          {filteredDetailExpenses.map((exp) => (
                            <div
                              key={exp.id}
                              className="p-2.5 bg-white flex items-center justify-between text-xs"
                            >
                              <div>
                                <span className="font-semibold text-slate-800">{exp.category}</span>
                                {exp.note && (
                                  <span className="text-slate-500 ml-1.5">· {exp.note}</span>
                                )}
                                <span className="block text-[11px] text-slate-400">
                                  {formatDateTime(exp.created_at)}
                                </span>
                              </div>
                              <span
                                className={`font-bold tabular-nums ${
                                  exp.type === 'income' ? 'text-emerald-600' : 'text-rose-600'
                                }`}
                              >
                                {exp.type === 'income' ? '+' : '-'}
                                {formatBaht(exp.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}

                <InShiftDebtPaymentsTable
                  payments={shiftDebtPaymentsDetail}
                  title="รายการรับชำระหนี้ในกะ"
                />
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Close Shift Modal */}
      <Modal
        open={closeModalOpen}
        onClose={() => setCloseModalOpen(false)}
        title="ปิดกะ & ตรวจนับเงินสด"
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleCloseShift} className="space-y-4">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex justify-between items-center">
            <span className="text-xs text-slate-600">เงินสดที่ระบบคำนวณได้</span>
            <span className="text-lg font-extrabold text-slate-900 tabular-nums">
              {formatBaht(summary.expectedCash)}
            </span>
          </div>

          {/* Toggle Denomination Counter */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  const next = !useDenomCounter;
                  setUseDenomCounter(next);
                  if (next) {
                    const hasAny = Object.values(denomCounts).some(
                      (v) => (parseInt(v || '0', 10) || 0) > 0
                    );
                    if (hasAny) {
                      const total = DENOMINATIONS.reduce((sum, d) => {
                        const qty = Math.max(0, parseInt(denomCounts[d] || '0', 10) || 0);
                        return sum + d * qty;
                      }, 0);
                      setActualCash(String(total));
                    }
                  }
                }}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors ${
                  useDenomCounter
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Calculator className="h-3.5 w-3.5" />
                <span>
                  {useDenomCounter
                    ? 'กำลังใช้ตัวช่วยนับธนบัตร/เหรียญ'
                    : 'ช่วยนับตามชนิดธนบัตร/เหรียญ'}
                </span>
              </button>

              {useDenomCounter && (
                <button
                  type="button"
                  onClick={handleResetDenom}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-rose-600"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>ล้างค่า</span>
                </button>
              )}
            </div>

            {useDenomCounter && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                {DENOMINATIONS.map((denom) => {
                  const qty = Math.max(0, parseInt(denomCounts[denom] || '0', 10) || 0);
                  const isBanknote = denom >= 20;
                  return (
                    <div
                      key={denom}
                      className="rounded-lg bg-white border border-slate-200 p-2 flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span
                          className={`font-bold ${
                            isBanknote ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {denom.toLocaleString()} ฿
                        </span>
                        <span className="text-slate-400">
                          {isBanknote ? 'ใบ' : 'เหรียญ'}
                        </span>
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        placeholder="0"
                        value={denomCounts[denom] ?? ''}
                        onChange={(e) => handleDenomChange(denom, e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-right text-sm font-bold tabular-nums focus:border-emerald-500 focus:outline-none"
                      />
                      <div className="text-[10px] text-right text-slate-500 tabular-nums">
                        = {(denom * qty).toLocaleString()} ฿
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              เงินสดที่นับได้จริงในลิ้นชัก (บาท)
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              required
              autoFocus={!useDenomCounter}
              value={actualCash}
              onChange={(e) => setActualCash(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-xl font-bold tabular-nums"
            />
          </div>
          {actualCash !== '' && (
            <div className="text-xs font-semibold text-right tabular-nums">
              ส่วนต่าง:{' '}
              <span
                className={
                  Number(actualCash) - summary.expectedCash === 0
                    ? 'text-emerald-600'
                    : 'text-amber-600'
                }
              >
                {formatBaht(Number(actualCash) - summary.expectedCash)}
              </span>
            </div>
          )}
          {actualCash !== '' &&
            Math.round((Number(actualCash) - summary.expectedCash) * 100) !== 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                <label
                  htmlFor="close-variance-reason"
                  className="block text-xs font-bold text-amber-900"
                >
                  สาเหตุเงินสดขาด/เกิน (ไม่บังคับ)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {SHIFT_VARIANCE_REASON_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCloseVarianceReason(preset)}
                      className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
                        closeVarianceReason.trim() === preset
                          ? 'border-amber-500 bg-amber-600 text-white'
                          : 'border-amber-200 bg-white text-amber-900 hover:bg-amber-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  id="close-variance-reason"
                  type="text"
                  value={closeVarianceReason}
                  onChange={(e) => setCloseVarianceReason(e.target.value)}
                  placeholder="ระบุสาเหตุเงินสดขาด/เกิน หรือเลือกจากปุ่มด้านบน..."
                  className="w-full rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-amber-500 focus:outline-none"
                />
              </div>
            )}
          <NetCashDropCalculator
            inputId="close-next-shift-float"
            actualCash={
              actualCash !== '' ? Math.max(0, Number(actualCash) || 0) : null
            }
            openingCash={Number(activeShift?.opening_cash ?? 0)}
            nextShiftFloatInput={closeNextShiftFloat}
            onNextShiftFloatChange={setCloseNextShiftFloat}
            safeDropInShift={summary.safeDropInShift}
          />
          <CashierNameSelector
            value={closeShiftCashierName}
            onChange={setCloseShiftCashierName}
            presets={savedCashierNamePresets}
            compact
          />

          {/* Shift Closing Checklist */}
          {(() => {
            const checkedCount = SHIFT_CLOSING_CHECKLIST_ITEMS.filter(
              (item) => closingChecklist[item.id]
            ).length;
            const allChecked = checkedCount === SHIFT_CLOSING_CHECKLIST_ITEMS.length;
            return (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2
                      className={`h-4 w-4 shrink-0 ${
                        allChecked ? 'text-emerald-600' : 'text-slate-500'
                      }`}
                    />
                    <span className="text-xs font-bold text-slate-800">
                      เช็กลิสต์ตรวจสอบก่อนปิดกะ / ปิดร้าน
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                        allChecked
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {checkedCount}/{SHIFT_CLOSING_CHECKLIST_ITEMS.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {checkedCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setClosingChecklist(createEmptyClosingChecklist())}
                        className="text-[11px] font-semibold text-slate-500 hover:text-rose-600"
                      >
                        ล้างค่า
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setClosingChecklist({
                          cash: true,
                          qr: true,
                          float: true,
                          lock: true,
                        })
                      }
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
                        allChecked
                          ? 'bg-emerald-600 text-white'
                          : 'border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      }`}
                    >
                      <Check className="h-3 w-3" />
                      <span>ติ๊กครบทุกข้อ</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {SHIFT_CLOSING_CHECKLIST_ITEMS.map((item) => {
                    const checked = closingChecklist[item.id];
                    return (
                      <label
                        key={item.id}
                        className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-xs cursor-pointer transition-colors ${
                          checked
                            ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 font-semibold'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setClosingChecklist((prev) => ({
                              ...prev,
                              [item.id]: e.target.checked,
                            }))
                          }
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>{item.label}</span>
                      </label>
                    );
                  })}
                </div>

                <div className="pt-1 border-t border-slate-200/80 space-y-1.5">
                  <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={attachChecklistToNote}
                      onChange={(e) => setAttachChecklistToNote(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>แนบสถานะเช็กลิสต์ลงหมายเหตุปิดกะ</span>
                  </label>
                  {attachChecklistToNote && (
                    <p className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600 leading-relaxed">
                      จะบันทึกต่อท้ายหมายเหตุ:{' '}
                      <span className="font-medium text-slate-800">
                        {formatClosingChecklistNote(closingChecklist)}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              หมายเหตุ (ถ้ามี)
            </label>
            <input
              type="text"
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
              placeholder="เช่น ทอนขาด/เกิน"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="close-handover-memo"
                className="flex items-center gap-1.5 text-xs font-bold text-slate-800"
              >
                <StickyNote className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                <span>ฝากข้อความถึงกะถัดไป (Shift Handover Memo)</span>
              </label>
              <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-rose-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={closeHandoverMemoUrgent}
                  onChange={(e) => setCloseHandoverMemoUrgent(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-rose-300 text-rose-600 focus:ring-rose-500"
                />
                <Pin className="h-3 w-3 shrink-0" />
                <span>ปักหมุดด่วน</span>
              </label>
            </div>
            {handoverMemo && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 leading-relaxed">
                มีข้อความส่งต่อกะค้างอยู่: &ldquo;{handoverMemo.text}&rdquo; (หากกรอกข้อความใหม่ด้านล่าง จะบันทึกทับข้อความเดิม)
              </p>
            )}
            <textarea
              id="close-handover-memo"
              rows={2}
              value={closeHandoverMemoText}
              onChange={(e) => setCloseHandoverMemoText(e.target.value)}
              placeholder="ฝากแจ้งกะถัดไป (ถ้ามี) เช่น เงินทอนเหรียญเหลือเท่าไร, ของต้องรับเข้าตอนเช้า..."
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800"
          >
            ยืนยันปิดกะ
          </button>
        </form>
      </Modal>

      {/* Edit Active Shift Opening Cash / Note Modal */}
      <Modal
        open={editShiftModalOpen}
        onClose={() => setEditShiftModalOpen(false)}
        title="แก้ไขเงินทอนตั้งต้น / หมายเหตุกะปัจจุบัน"
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={handleSaveEditShift} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              เงินทอนตั้งต้นในลิ้นชัก (บาท)
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              required
              autoFocus
              value={editOpeningCash}
              onChange={(e) => setEditOpeningCash(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-lg font-bold tabular-nums"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              ระบบจะคำนวณเงินสดที่ควรมีในลิ้นชักของกะปัจจุบันใหม่อัตโนมัติ
            </p>
          </div>
          <CashierNameSelector
            value={editShiftCashierName}
            onChange={setEditShiftCashierName}
            presets={savedCashierNamePresets}
            compact
          />
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              หมายเหตุประจำกะ (ถ้ามี)
            </label>
            <textarea
              rows={2}
              value={editShiftNote}
              onChange={(e) => setEditShiftNote(e.target.value)}
              placeholder="เช่น นับเงินทอนตั้งต้นใหม่, เปลี่ยนคนเฝ้าร้านช่วงบ่าย"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700"
          >
            บันทึกการแก้ไขกะ
          </button>
        </form>
      </Modal>

      {/* Cashier Names JSON Backup / Restore Modal */}
      <Modal
        open={cashierBackupOpen}
        onClose={() => setCashierBackupOpen(false)}
        title="สำรอง/กู้คืนตั้งค่ากะ (JSON)"
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-4">
          {/* Export Section */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  1. สำรองข้อมูลตั้งค่ากะทั้งหมด (Export JSON)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  รายชื่อผู้ดูแลกะ ({SHIFT_CASHIER_NAMES_STORAGE_KEY}), เงินทอนเก็บไว้เปิดกะถัดไป ({SHIFT_NEXT_FLOATS_STORAGE_KEY}), ข้อความส่งต่อกะ ({SHIFT_HANDOVER_MEMO_STORAGE_KEY}), เป้ายอดขาย ({SHIFT_SALES_TARGET_STORAGE_KEY}) และสาเหตุส่วนต่าง ({SHIFT_VARIANCE_REASONS_STORAGE_KEY})
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyCashierBackupJson}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  {cashierJsonCopied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      <span className="text-emerald-700">คัดลอก JSON แล้ว</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>คัดลอก JSON</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleExportCashierBackupJson}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>ดาวน์โหลดไฟล์ (.json)</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                ผู้ดูแลกะ: {formatNumber(Object.keys(shiftCashierNames).length)} กะ
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                เงินทอนกะถัดไป: {formatNumber(Object.keys(shiftNextFloats).length)} กะ
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                สาเหตุส่วนต่าง: {formatNumber(Object.keys(shiftVarianceReasons).length)} กะ
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                ข้อความส่งต่อกะ:{' '}
                {handoverMemo
                  ? handoverMemo.urgent
                    ? '1 รายการ (ด่วน)'
                    : '1 รายการ'
                  : 'ไม่มีข้อความ'}
              </span>
              {savedCashierNamePresets.length > 0 && (
                <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                  ชื่อผู้ดูแลกะไม่ซ้ำ: {formatNumber(savedCashierNamePresets.length)} คน
                </span>
              )}
            </div>
          </div>

          {/* Import / Restore Section */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                2. กู้คืนข้อมูลจากไฟล์หรือวาง JSON (Import / Restore)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                เลือกไฟล์ .json ที่สำรองไว้ หรือวางข้อความ JSON ลงในช่องด้านล่างเพื่ออัปเดตทันที
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/70 px-3.5 py-2 text-xs font-bold text-sky-800 hover:bg-sky-50 transition">
                <Upload className="h-4 w-4" />
                <span>
                  {cashierBackupFileName
                    ? `เลือกไฟล์ใหม่ (${cashierBackupFileName})`
                    : 'อัปโหลดไฟล์ .json จากเครื่อง'}
                </span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleCashierBackupFileChange}
                  className="hidden"
                />
              </label>

              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500 font-medium">รูปแบบกู้คืน:</span>
                <button
                  type="button"
                  onClick={() => setCashierRestoreMode('replace')}
                  className={`rounded-lg border px-2.5 py-1 font-semibold transition ${
                    cashierRestoreMode === 'replace'
                      ? 'border-sky-600 bg-sky-600 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  เขียนทับข้อมูลเดิม
                </button>
                <button
                  type="button"
                  onClick={() => setCashierRestoreMode('merge')}
                  className={`rounded-lg border px-2.5 py-1 font-semibold transition ${
                    cashierRestoreMode === 'merge'
                      ? 'border-sky-600 bg-sky-600 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  ผสานรวมกับข้อมูลเดิม
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="shift-cashier-json-textarea"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                วางข้อมูล JSON ที่นี่
              </label>
              <textarea
                id="shift-cashier-json-textarea"
                rows={6}
                value={cashierBackupJsonInput}
                onChange={(e) => {
                  setCashierBackupJsonInput(e.target.value);
                  setCashierBackupError('');
                  setCashierBackupSuccess('');
                }}
                placeholder={`{"${SHIFT_CASHIER_NAMES_STORAGE_KEY}": {"shift-id": "ชื่อผู้ดูแลกะ"}, "${SHIFT_NEXT_FLOATS_STORAGE_KEY}": {"shift-id": 500}, "${SHIFT_HANDOVER_MEMO_STORAGE_KEY}": {"text": "ข้อความส่งต่อ", "author": "ผู้ดูแลกะ", "updatedAt": "...", "urgent": false}}`}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-800 focus:border-sky-500 focus:bg-white focus:outline-none"
              />
            </div>

            {cashierBackupPreview && !cashierBackupPreview.error && (
              <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 flex flex-wrap items-center gap-2">
                <span className="font-bold">ตรวจพบข้อมูลพร้อมกู้คืน:</span>
                {cashierBackupPreview.cashierNames !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    ผู้ดูแลกะ {formatNumber(Object.keys(cashierBackupPreview.cashierNames).length)} รายการ
                  </span>
                )}
                {cashierBackupPreview.nextFloats !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    เงินทอนกะถัดไป {formatNumber(Object.keys(cashierBackupPreview.nextFloats).length)} รายการ
                  </span>
                )}
                {cashierBackupPreview.handoverMemo !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    ข้อความส่งต่อกะ:{' '}
                    {cashierBackupPreview.handoverMemo
                      ? cashierBackupPreview.handoverMemo.urgent
                        ? 'มีข้อความ (ด่วน)'
                        : 'มีข้อความ'
                      : 'ว่าง (ไม่มีข้อความ)'}
                  </span>
                )}
                {cashierBackupPreview.salesTarget !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    เป้าหมายยอดขายต่อกะ {formatBaht(cashierBackupPreview.salesTarget)}
                  </span>
                )}
                {cashierBackupPreview.varianceReasons !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    สาเหตุส่วนต่าง {formatNumber(Object.keys(cashierBackupPreview.varianceReasons).length)} รายการ
                  </span>
                )}
              </div>
            )}

            {cashierBackupPreview?.error && !cashierBackupError && (
              <div
                role="alert"
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
              >
                {cashierBackupPreview.error}
              </div>
            )}

            {cashierBackupError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
              >
                {cashierBackupError}
              </div>
            )}

            {cashierBackupSuccess && (
              <div
                role="status"
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 flex items-center gap-1.5"
              >
                <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{cashierBackupSuccess}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setCashierBackupOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ปิด
            </button>
            <button
              type="button"
              disabled={!cashierBackupJsonInput.trim() || Boolean(cashierBackupPreview?.error)}
              onClick={handleRestoreCashierBackupJson}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              <span>กู้คืนข้อมูลเข้าสู่ระบบ</span>
            </button>
          </div>
        </div>
      </Modal>
        </AppShell>
      </div>

      {/* Printable Shift Summary Slip / Opening Float Slip */}
      {printableShiftData && printableShiftData.mode === 'opening-float' ? (
        <div className="hidden print:block max-w-md mx-auto p-6 bg-white text-slate-900 text-sm">
          <div className="text-center border-b border-dashed border-slate-400 pb-4 mb-4 space-y-1">
            <h1 className="text-lg font-extrabold text-slate-900">
              {settings?.store_name || 'ร้านขายของชำ POS'}
            </h1>
            {settings?.phone && (
              <p className="text-xs text-slate-600">โทร: {settings.phone}</p>
            )}
            <p className="text-base font-bold text-slate-900 pt-1">
              ใบรับเงินทอนตั้งต้นเปิดกะ
            </p>
            <p className="text-xs text-slate-600">Opening Float Slip</p>
          </div>

          <div className="space-y-2 text-xs border-b border-dashed border-slate-400 pb-4 mb-4">
            <div className="flex justify-between gap-2">
              <span className="text-slate-600">ผู้ดูแลกะ / แคชเชียร์:</span>
              <span className="font-semibold text-right">
                {printableShiftData.cashierName || '-'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-600">เวลาเปิดกะ:</span>
              <span className="font-semibold text-right">
                {formatDateTime(printableShiftData.shift.opened_at)}
              </span>
            </div>
            <div className="flex justify-between gap-2 pt-2 border-t border-slate-200 text-sm font-extrabold">
              <span>ยอดเงินทอนตั้งต้น:</span>
              <span className="tabular-nums">
                {formatBaht(printableShiftData.shift.opening_cash)}
              </span>
            </div>
          </div>

          {printableShiftData.shift.note && (
            <div className="text-xs border-b border-dashed border-slate-400 pb-3 mb-4">
              <span className="font-bold">หมายเหตุ: </span>
              <span>{printableShiftData.shift.note}</span>
            </div>
          )}

          <div className="pt-8 text-center text-[11px] text-slate-600">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="border-b border-slate-400 h-8 mb-1" />
                <span>ผู้ส่งมอบเงินทอน</span>
              </div>
              <div>
                <div className="border-b border-slate-400 h-8 mb-1" />
                <span>
                  ผู้รับเงินทอน
                  {printableShiftData.cashierName ? ` (${printableShiftData.cashierName})` : ''}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : printableShiftData ? (
        <div className="hidden print:block max-w-md mx-auto p-6 bg-white text-slate-900 text-sm">
          <div className="text-center border-b border-dashed border-slate-400 pb-4 mb-4 space-y-1">
            <h1 className="text-lg font-extrabold text-slate-900">
              {settings?.store_name || 'ร้านขายของชำ POS'}
            </h1>
            {settings?.phone && (
              <p className="text-xs text-slate-600">โทร: {settings.phone}</p>
            )}
            <p className="text-base font-bold text-slate-900 pt-1">
              {printableShiftData.shift.status === 'closed'
                ? 'ใบสรุปปิดกะการขาย (Z-Report)'
                : 'ใบสรุปกะการขาย'}
            </p>
            <p className="text-xs text-slate-600">
              สถานะ: {printableShiftData.shift.status === 'closed' ? 'ปิดกะแล้ว' : 'กำลังเปิดกะ'}
            </p>
          </div>

          <div className="space-y-1.5 text-xs border-b border-dashed border-slate-400 pb-3 mb-3">
            <div className="flex justify-between gap-2">
              <span className="text-slate-600">ผู้ดูแลกะ / แคชเชียร์:</span>
              <span className="font-semibold text-right">
                {printableShiftData.cashierName || '-'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-600">เวลาเปิดกะ:</span>
              <span className="font-semibold text-right">
                {formatDateTime(printableShiftData.shift.opened_at)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-600">เวลาปิดกะ:</span>
              <span className="font-semibold text-right">
                {printableShiftData.shift.closed_at
                  ? formatDateTime(printableShiftData.shift.closed_at)
                  : 'กำลังเปิดกะ'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-600">ระยะเวลาเปิดกะ:</span>
              <span className="font-semibold text-right">{printableShiftData.durationText}</span>
            </div>
          </div>

          <div className="space-y-1.5 text-xs border-b border-dashed border-slate-400 pb-3 mb-3 tabular-nums">
            <div className="flex justify-between gap-2">
              <span className="text-slate-600">เงินทอนตั้งต้น:</span>
              <span className="font-bold">{formatBaht(printableShiftData.shift.opening_cash)}</span>
            </div>
            <div className="flex justify-between gap-2 pt-1 font-bold text-slate-900">
              <span>ยอดขายรวม ({printableShiftData.billCount} บิล):</span>
              <span>{formatBaht(printableShiftData.totalSalesAmt)}</span>
            </div>
            {printableShiftData.targetAchievement && (
              <div className="flex justify-between gap-2 pl-3 text-slate-700">
                <span>
                  • เทียบเป้ายอดขาย ({formatBaht(printableShiftData.targetAchievement.target)}):
                </span>
                <span className="font-bold">{printableShiftData.targetAchievement.label}</span>
              </div>
            )}
            <div className="flex justify-between gap-2 pl-3 text-slate-700">
              <span>• ขายเงินสด:</span>
              <span>{formatBaht(printableShiftData.cashAmt)}</span>
            </div>
            {printableShiftData.debtCashAmt > 0 && (
              <div className="flex justify-between gap-2 pl-3 text-slate-700">
                <span>• รับชำระหนี้เงินสด:</span>
                <span>+{formatBaht(printableShiftData.debtCashAmt)}</span>
              </div>
            )}
            <div className="flex justify-between gap-2 pl-3 text-slate-700">
              <span>• PromptPay QR:</span>
              <span>{formatBaht(printableShiftData.qrAmt)}</span>
            </div>
            <div className="flex justify-between gap-2 pl-3 text-slate-700">
              <span>• เงินเชื่อ (ค้างชำระ):</span>
              <span>{formatBaht(printableShiftData.creditAmt)}</span>
            </div>
            <div className="flex justify-between gap-2 pt-1">
              <span className="text-slate-600">รายจ่ายสิ้นเปลืองสุทธิในกะ:</span>
              <span className="font-semibold">
                {printableShiftData.regularExpNetAmt > 0
                  ? `-${formatBaht(printableShiftData.regularExpNetAmt)}`
                  : printableShiftData.regularExpNetAmt < 0
                    ? `+${formatBaht(Math.abs(printableShiftData.regularExpNetAmt))}`
                    : formatBaht(0)}
              </span>
            </div>
            {printableShiftData.safeDropAmt > 0 && (
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">เก็บเงินเข้าเซฟระหว่างกะ (Safe Drop):</span>
                <span className="font-semibold">
                  -{formatBaht(printableShiftData.safeDropAmt)}
                </span>
              </div>
            )}
          </div>

          {printableShiftData.velocity && (
            <div className="space-y-1.5 text-xs border-b border-dashed border-slate-400 pb-3 mb-3 tabular-nums">
              <p className="font-bold text-slate-800">
                วิเคราะห์ความเร็วการขายต่อชั่วโมง (Sales Velocity)
              </p>
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">ระยะเวลาเปิดกะ:</span>
                <span className="font-semibold text-right">
                  {printableShiftData.velocity.durationText} (
                  {formatNumber(Number(printableShiftData.velocity.durationHours.toFixed(2)))} ชม.)
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">ยอดขายเฉลี่ยต่อชั่วโมง:</span>
                <span className="font-bold text-right">
                  {formatBahtPrefix(printableShiftData.velocity.salesPerHour)}/ชม.
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">จำนวนบิลเฉลี่ยต่อชั่วโมง:</span>
                <span className="font-bold text-right">
                  {printableShiftData.velocity.billsPerHour.toFixed(1)} บิล/ชม.
                </span>
              </div>
            </div>
          )}

          <div className="space-y-2 text-xs border-b border-dashed border-slate-400 pb-4 mb-4 tabular-nums">
            <div className="text-[11px] text-slate-600 bg-slate-50 rounded px-2 py-1 border border-slate-200">
              กระทบยอดเงินสด: {formatBaht(printableShiftData.shift.opening_cash)} + {formatBaht(printableShiftData.cashAmt)} + {formatBaht(printableShiftData.debtCashAmt)} - {formatBaht(printableShiftData.expNetAmt)} = {formatBaht(printableShiftData.expectedAmt)}
            </div>
            <div className="flex justify-between gap-2 text-sm font-bold">
              <span>เงินสดที่ควรมีในลิ้นชัก:</span>
              <span>{formatBaht(printableShiftData.expectedAmt)}</span>
            </div>
            <div className="flex justify-between gap-2 text-sm font-bold">
              <span>เงินสดที่นับได้จริง:</span>
              <span>
                {printableShiftData.actualAmt !== null
                  ? formatBaht(printableShiftData.actualAmt)
                  : 'ยังไม่ได้นับเงินปิดกะ'}
              </span>
            </div>
            <div className="flex justify-between gap-2 text-sm font-extrabold pt-1">
              <span>ส่วนต่างเงินสด:</span>
              <span>
                {printableShiftData.diffAmt === null
                  ? '-'
                  : printableShiftData.diffAmt === 0
                    ? `${formatBaht(0)} (ครบพอดี)`
                    : printableShiftData.diffAmt > 0
                      ? `+${formatBaht(printableShiftData.diffAmt)} (เงินเกิน)`
                      : `${formatBaht(printableShiftData.diffAmt)} (เงินขาด)`}
              </span>
            </div>
            {printableShiftData.cashAccuracyGrade && (
              <div className="flex justify-between items-center gap-2 text-xs pt-1">
                <span className="text-slate-600 font-semibold">เกรดความแม่นยำลิ้นชัก:</span>
                <span className="font-bold">{printableShiftData.cashAccuracyGrade.label}</span>
              </div>
            )}
            {printableShiftData.varianceReason && (
              <div className="flex justify-between items-start gap-2 text-xs pt-1">
                <span className="text-slate-600 font-semibold shrink-0">สาเหตุส่วนต่าง:</span>
                <span className="font-bold text-right">{printableShiftData.varianceReason}</span>
              </div>
            )}
          </div>

          {printableShiftData.shift.status === 'closed' && (
            <div className="space-y-1.5 text-xs border-b border-dashed border-slate-400 pb-4 mb-4 tabular-nums">
              <p className="font-bold text-slate-800">
                สรุปยอดเงินสดนำส่งเจ้าของร้าน (Net Cash Drop)
              </p>
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">เงินสดที่นับได้จริง:</span>
                <span className="font-semibold">
                  {printableShiftData.actualAmt !== null
                    ? formatBaht(printableShiftData.actualAmt)
                    : '-'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">หัก เงินทอนเก็บไว้เปิดกะถัดไป:</span>
                <span className="font-semibold">
                  -{formatBaht(printableShiftData.nextShiftFloatAmt)}
                </span>
              </div>
              <div className="flex justify-between gap-2 text-xs font-bold pt-1 border-t border-slate-300">
                <span>ยอดเงินสดนำส่งตอนปิดกะ:</span>
                <span>
                  {printableShiftData.netCashDropAmt !== null
                    ? formatBaht(printableShiftData.netCashDropAmt)
                    : '-'}
                </span>
              </div>
              {printableShiftData.safeDropAmt > 0 && (
                <div className="flex justify-between gap-2 text-xs">
                  <span className="text-slate-600">บวก เก็บเข้าเซฟระหว่างกะ (Safe Drop):</span>
                  <span className="font-semibold">
                    +{formatBaht(printableShiftData.safeDropAmt)}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-2 text-sm font-extrabold pt-1 border-t border-slate-300">
                <span>
                  {printableShiftData.safeDropAmt > 0
                    ? 'ยอดเงินสดนำส่งรวมทั้งกะ:'
                    : 'ยอดเงินสดนำส่งเจ้าของร้าน / เข้าเซฟ:'}
                </span>
                <span>
                  {printableShiftData.totalShiftHandoverAmt !== null
                    ? formatBaht(printableShiftData.totalShiftHandoverAmt)
                    : '-'}
                </span>
              </div>
            </div>
          )}

          {printableShiftData.shift.note && (
            <div className="text-xs border-b border-dashed border-slate-400 pb-3 mb-4">
              <span className="font-bold">หมายเหตุ: </span>
              <span>{printableShiftData.shift.note}</span>
            </div>
          )}

          <div className="pt-6 text-center text-[11px] text-slate-500 space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="border-b border-slate-400 h-6 mb-1" />
                <span>
                  ผู้ส่งกะ / พนักงานขาย
                  {printableShiftData.cashierName ? ` (${printableShiftData.cashierName})` : ''}
                </span>
              </div>
              <div>
                <div className="border-b border-slate-400 h-6 mb-1" />
                <span>ผู้ตรวจรับยอด / เจ้าของร้าน</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
