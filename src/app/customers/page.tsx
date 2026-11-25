'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  UserPlus,
  Banknote,
  Receipt,
  CheckCircle2,
  History,
  Search,
  Edit3,
  AlertCircle,
  Copy,
  Check,
  Download,
  Trash2,
  ArrowUpDown,
  Users,
  Printer,
  Phone,
  Award,
  Crown,
  Clock,
  CalendarClock,
  X,
  Upload,
  Database,
  RotateCcw,
  MapPin,
  ClipboardCheck,
} from 'lucide-react';
import generatePayload from 'promptpay-qr';
import QRCode from 'qrcode';
import { AppShell } from '@/components/AppShell';
import { Modal } from '@/components/Modal';
import { createClient } from '@/lib/supabase/client';
import { formatBaht, formatDateTime, formatNumber } from '@/lib/format';
import type { Customer, DebtPayment, Sale, Shift, StoreSettings } from '@/types/pos';

interface RecentDebtPayment extends DebtPayment {
  customers?: { name: string } | null;
}

interface PayDebtReceipt {
  customerName: string;
  debtBefore?: number;
  amountPaid: number;
  waivedAmount?: number;
  paymentMethod: 'cash' | 'qr';
  remainingDebt: number;
  note: string;
  paidAt: string;
}

interface CompactPaymentReceipt {
  customerName: string;
  debtBefore: number;
  amountPaid: number;
  waivedAmount?: number;
  paymentMethod: 'cash' | 'qr';
  remainingDebt: number;
  paidAt: string;
  note?: string;
}

const CREDIT_LIMITS_STORAGE_KEY = 'customer_credit_limits_v1';
const LOYALTY_POINTS_STORAGE_KEY = 'customer_loyalty_points_v1';
const STORE_CREDIT_STORAGE_KEY = 'customer_store_credit_v1';
const DEFAULT_DISCOUNT_PCT_STORAGE_KEY = 'customer_default_discount_pct_v1';
const LAST_REMINDED_STORAGE_KEY = 'customer_last_reminded_v1';
const DUE_DATES_STORAGE_KEY = 'customer_due_dates_v1';
const CONTACT_NOTES_STORAGE_KEY = 'customer_contact_notes_v1';
const FOLLOWUP_LOGS_STORAGE_KEY = 'customer_followup_logs_v1';
const PAYDAY_CYCLES_STORAGE_KEY = 'customer_payday_cycles_v1';
const CUSTOMER_TAGS_STORAGE_KEY = 'customer_tags_v1';
const PAYDAY_CYCLE_PRESETS = [
  'ทุกสิ้นเดือน',
  'วันที่ 1 และ 16',
  'วันที่ 15 และสิ้นเดือน',
  'ทุกสัปดาห์ (เสาร์-อาทิตย์)',
  'วันที่ 10 ของเดือน',
] as const;
const CUSTOMER_TAG_PRESETS = [
  '🍳 ร้านอาหาร/แม่ค้า',
  '🏡 เพื่อนบ้านประจำ',
  '🏢 พนักงานรายเดือน',
  '🤝 ญาติ/คนคุ้นเคย',
] as const;
const VIP_DISCOUNT_PRESETS = [0, 3, 5, 10] as const;
const INSTALLMENT_COUNTS = [2, 3, 4, 6] as const;
const FOLLOWUP_QUICK_PRESETS = [
  'รับปากจ่ายสิ้นเดือน',
  'โทรแล้วไม่รับสาย',
  'ขอทยอยจ่ายรายสัปดาห์',
  'แวะแจ้งที่บ้านแล้ว',
] as const;

interface FollowupLogEntry {
  id: string;
  text: string;
  createdAt: string;
}

const parseFollowupLogsMap = (raw: string | null): Record<string, FollowupLogEntry[]> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, FollowupLogEntry[]> = {};
    for (const [customerId, entries] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;
      const validEntries: FollowupLogEntry[] = [];
      for (const item of entries) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const entry = item as Record<string, unknown>;
        const id = typeof entry.id === 'string' ? entry.id.trim() : '';
        const text = typeof entry.text === 'string' ? entry.text.trim() : '';
        const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt.trim() : '';
        if (id && text && createdAt) {
          validEntries.push({ id, text, createdAt });
        }
      }
      if (validEntries.length > 0) {
        clean[customerId] = validEntries;
      }
    }
    return clean;
  } catch {
    return {};
  }
};

const calcInstallmentPlan = (totalDebt: number, count: number) => {
  const safeDebt = Math.max(0, Number(totalDebt) || 0);
  const perInstallment = Math.round((safeDebt / count) * 100) / 100;
  const lastInstallment = Math.max(
    0,
    Math.round((safeDebt - perInstallment * (count - 1)) * 100) / 100
  );
  return { count, perInstallment, lastInstallment };
};

const parseIsoDateUtcMs = (iso: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const probe = new Date(utcMs);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return utcMs;
};

const parseDueDatesMap = (raw: string | null): Record<string, string> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, string> = {};
    for (const [customerId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (parseIsoDateUtcMs(trimmed) !== null) {
          clean[customerId] = trimmed;
        }
      }
    }
    return clean;
  } catch {
    return {};
  }
};

const formatDueDateTh = (iso: string): string => {
  const utcMs = parseIsoDateUtcMs(iso);
  if (utcMs === null) return iso;
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(utcMs));
};

const addDaysToIsoDate = (baseIso: string, days: number): string => {
  const baseMs = parseIsoDateUtcMs(baseIso);
  if (baseMs === null) return '';
  const target = new Date(baseMs + days * 86_400_000);
  const yyyy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(target.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const formatLocalIsoDate = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const getEndOfMonthIsoFromIso = (baseIso: string): string => {
  const baseMs = parseIsoDateUtcMs(baseIso);
  if (baseMs === null) return '';
  const probe = new Date(baseMs);
  const endOfMonth = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0));
  const yyyy = endOfMonth.getUTCFullYear();
  const mm = String(endOfMonth.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(endOfMonth.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const DUE_DATE_QUICK_PRESETS: ReadonlyArray<
  { label: string; kind: 'offset'; days: number } | { label: string; kind: 'end_of_month' }
> = [
  { label: 'วันนี้', kind: 'offset', days: 0 },
  { label: '+3 วัน', kind: 'offset', days: 3 },
  { label: '+7 วัน', kind: 'offset', days: 7 },
  { label: '+15 วัน', kind: 'offset', days: 15 },
  { label: 'สิ้นเดือนนี้', kind: 'end_of_month' },
];

type DueDateStatus = 'overdue' | 'due_today' | 'upcoming';

interface DueDateInfo {
  dueIso: string;
  formattedDate: string;
  daysDiff: number;
  status: DueDateStatus;
}

const getCustomerDueDateInfo = (
  dueIso: string | undefined,
  todayIso: string,
  totalDebt: number
): DueDateInfo | null => {
  if (!dueIso || parseIsoDateUtcMs(dueIso) === null) return null;
  const formattedDate = formatDueDateTh(dueIso);
  if (!todayIso || totalDebt <= 0) {
    return {
      dueIso,
      formattedDate,
      daysDiff: 0,
      status: 'upcoming',
    };
  }
  const dueMs = parseIsoDateUtcMs(dueIso);
  const todayMs = parseIsoDateUtcMs(todayIso);
  if (dueMs === null || todayMs === null) return null;
  const daysDiff = Math.round((dueMs - todayMs) / 86_400_000);
  const status: DueDateStatus =
    dueIso < todayIso ? 'overdue' : dueIso === todayIso ? 'due_today' : 'upcoming';
  return {
    dueIso,
    formattedDate,
    daysDiff,
    status,
  };
};

const STALE_DEBT_DAYS_THRESHOLD = 14;

interface StaleDebtInfo {
  daysSinceLastPayment: number;
  isStale: boolean;
  referenceIso: string;
  hasPaidBefore: boolean;
}

const getCustomerStaleDebtInfo = (
  totalDebt: number,
  lastPaymentPaidAt: string | undefined,
  createdAt: string | undefined,
  todayIso: string
): StaleDebtInfo | null => {
  if (!todayIso || totalDebt <= 0) return null;
  const todayMs = parseIsoDateUtcMs(todayIso);
  if (todayMs === null) return null;

  const hasPaidBefore = Boolean(lastPaymentPaidAt);
  const rawRef = lastPaymentPaidAt || createdAt;
  if (!rawRef) return null;

  let refDateIso = '';
  if (parseIsoDateUtcMs(rawRef) !== null) {
    refDateIso = rawRef.trim();
  } else {
    const parsedMs = Date.parse(rawRef);
    if (Number.isNaN(parsedMs)) return null;
    refDateIso = formatLocalIsoDate(new Date(parsedMs));
  }

  const refMs = parseIsoDateUtcMs(refDateIso);
  if (refMs === null) return null;

  const daysSinceLastPayment = Math.max(0, Math.round((todayMs - refMs) / 86_400_000));
  return {
    daysSinceLastPayment,
    isStale: daysSinceLastPayment > STALE_DEBT_DAYS_THRESHOLD,
    referenceIso: rawRef,
    hasPaidBefore,
  };
};

const computeNextDueDateFromPaydayCycle = (cycleText: string, now: Date): string | null => {
  const text = cycleText.trim();
  if (!text) return null;

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const weekdayMap: Array<{ keyword: string; day: number }> = [
    { keyword: 'อาทิตย์', day: 0 },
    { keyword: 'จันทร์', day: 1 },
    { keyword: 'อังคาร', day: 2 },
    { keyword: 'พุธ', day: 3 },
    { keyword: 'พฤหัส', day: 4 },
    { keyword: 'ศุกร์', day: 5 },
    { keyword: 'เสาร์', day: 6 },
  ];
  const matchedWeekdays = weekdayMap
    .filter((entry) => text.includes(entry.keyword))
    .map((entry) => entry.day);

  if (matchedWeekdays.length > 0) {
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = new Date(
        todayStart.getFullYear(),
        todayStart.getMonth(),
        todayStart.getDate() + offset
      );
      if (matchedWeekdays.includes(candidate.getDay())) {
        return formatLocalIsoDate(candidate);
      }
    }
  }

  if (text.includes('สัปดาห์')) {
    const nextWeek = new Date(
      todayStart.getFullYear(),
      todayStart.getMonth(),
      todayStart.getDate() + 7
    );
    return formatLocalIsoDate(nextWeek);
  }

  const hasEndOfMonth = text.includes('สิ้นเดือน');
  const dayMatches = text.match(/\d+/g) ?? [];
  const dayNumbers = Array.from(
    new Set(
      dayMatches
        .map((m) => Number(m))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31)
    )
  );

  if (hasEndOfMonth || dayNumbers.length > 0) {
    const candidates: Date[] = [];
    for (let monthOffset = 0; monthOffset <= 1; monthOffset++) {
      const year = todayStart.getFullYear();
      const month = todayStart.getMonth() + monthOffset;
      const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

      if (hasEndOfMonth) {
        candidates.push(new Date(year, month, lastDayOfMonth));
      }
      for (const day of dayNumbers) {
        const clampedDay = Math.min(day, lastDayOfMonth);
        candidates.push(new Date(year, month, clampedDay));
      }
    }

    candidates.sort((a, b) => a.getTime() - b.getTime());
    const nextMatch = candidates.find((d) => d.getTime() >= todayStart.getTime());
    if (nextMatch) {
      return formatLocalIsoDate(nextMatch);
    }
  }

  return null;
};

function DueDateField({
  inputId,
  value,
  todayIso,
  totalDebt,
  paydayCycle,
  onChange,
}: {
  inputId: string;
  value: string;
  todayIso: string;
  totalDebt: number;
  paydayCycle?: string;
  onChange: (val: string) => void;
}) {
  const info = getCustomerDueDateInfo(value, todayIso, totalDebt);
  const trimmedPaydayCycle = (paydayCycle ?? '').trim();
  return (
    <div className="rounded-xl bg-sky-50/70 border border-sky-200 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={inputId} className="block text-xs font-semibold text-sky-950">
          วันนัดชำระหนี้ (ไม่บังคับ)
        </label>
        {info ? (
          info.status === 'overdue' ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 border border-red-300 px-2 py-0.5 text-[11px] font-bold text-red-700">
              <CalendarClock className="h-3 w-3 shrink-0" />
              <span>เลยกำหนดชำระ ({Math.abs(info.daysDiff)} วัน)</span>
            </span>
          ) : info.status === 'due_today' ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 border border-orange-300 px-2 py-0.5 text-[11px] font-bold text-orange-800">
              <CalendarClock className="h-3 w-3 shrink-0" />
              <span>ครบกำหนดวันนี้</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-white border border-sky-200 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
              <CalendarClock className="h-3 w-3 shrink-0" />
              <span>
                {info.daysDiff > 0
                  ? `อีก ${info.daysDiff} วัน (${info.formattedDate})`
                  : info.formattedDate}
              </span>
            </span>
          )
        ) : (
          <span className="text-[11px] text-slate-500">ยังไม่กำหนดวันนัด</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          id={inputId}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 rounded-xl border border-sky-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 tabular-nums"
        />
        <button
          type="button"
          disabled={!value}
          onClick={() => onChange('')}
          className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <X className="h-3.5 w-3.5" />
          <span>ล้างค่า</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-sky-900 mr-0.5">เลือกด่วน:</span>
        {DUE_DATE_QUICK_PRESETS.map((preset) => {
          const matchIso = todayIso
            ? preset.kind === 'end_of_month'
              ? getEndOfMonthIsoFromIso(todayIso)
              : addDaysToIsoDate(todayIso, preset.days)
            : '';
          const isSelected = Boolean(matchIso) && value === matchIso;
          const handlePresetClick = () => {
            const now = new Date();
            const target =
              preset.kind === 'end_of_month'
                ? new Date(now.getFullYear(), now.getMonth() + 1, 0)
                : new Date(now.getFullYear(), now.getMonth(), now.getDate() + preset.days);
            onChange(formatLocalIsoDate(target));
          };
          return (
            <button
              key={preset.label}
              type="button"
              onClick={handlePresetClick}
              className={`rounded-lg border px-2 py-1 text-[11px] font-bold transition ${
                isSelected
                  ? 'border-sky-600 bg-sky-600 text-white'
                  : 'border-sky-300 bg-white text-sky-900 hover:bg-sky-100'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
        {trimmedPaydayCycle && (
          <button
            type="button"
            onClick={() => {
              const nextIso = computeNextDueDateFromPaydayCycle(trimmedPaydayCycle, new Date());
              if (nextIso) {
                onChange(nextIso);
              }
            }}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-800 hover:bg-indigo-100 transition"
          >
            ตั้งตามรอบจ่าย ({trimmedPaydayCycle})
          </button>
        )}
      </div>
    </div>
  );
}

const parseTrimmedStringMap = (raw: string | null): Record<string, string> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') {
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
};

const parseContactNotesMap = parseTrimmedStringMap;
const parsePaydayCyclesMap = parseTrimmedStringMap;
const parseCustomerTagsMap = parseTrimmedStringMap;

function ContactNoteField({
  inputId,
  value,
  onChange,
}: {
  inputId: string;
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="rounded-xl bg-teal-50/60 border border-teal-200 p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="flex items-center gap-1.5 text-xs font-semibold text-teal-950"
        >
          <MapPin className="h-3.5 w-3.5 text-teal-700 shrink-0" />
          <span>ที่อยู่ / จุดสังเกตบ้าน / LINE ID (ไม่บังคับ)</span>
        </label>
        {value.trim() && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="inline-flex items-center gap-0.5 rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            <X className="h-3 w-3" />
            <span>ล้าง</span>
          </button>
        )}
      </div>
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="เช่น ซอย 3 บ้านรั้วเขียว, LINE: @somchai"
        className="w-full rounded-xl border border-teal-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500"
      />
    </div>
  );
}

function PaydayCycleField({
  inputId,
  value,
  onChange,
}: {
  inputId: string;
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="rounded-xl bg-sky-50/60 border border-sky-200 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="flex items-center gap-1.5 text-xs font-semibold text-sky-950"
        >
          <CalendarClock className="h-3.5 w-3.5 text-sky-700 shrink-0" />
          <span>รอบจ่ายเงินประจำ (ไม่บังคับ)</span>
        </label>
        {value.trim() && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="inline-flex items-center gap-0.5 rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            <X className="h-3 w-3" />
            <span>ล้าง</span>
          </button>
        )}
      </div>
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="เช่น ทุกสิ้นเดือน, วันที่ 1 และ 16"
        className="w-full rounded-xl border border-sky-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500"
      />
      <div className="flex flex-wrap gap-1">
        {PAYDAY_CYCLE_PRESETS.map((preset) => {
          const isSelected = value.trim() === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(isSelected ? '' : preset)}
              className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
                isSelected
                  ? 'border-sky-600 bg-sky-600 text-white'
                  : 'border-sky-200 bg-white text-sky-800 hover:bg-sky-100'
              }`}
            >
              {preset}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CustomerTagField({
  inputId,
  value,
  onChange,
}: {
  inputId: string;
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="rounded-xl bg-fuchsia-50/60 border border-fuchsia-200 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="flex items-center gap-1.5 text-xs font-semibold text-fuchsia-950"
        >
          <Users className="h-3.5 w-3.5 text-fuchsia-700 shrink-0" />
          <span>กลุ่มประเภทลูกค้า (ไม่บังคับ)</span>
        </label>
        {value.trim() && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="inline-flex items-center gap-0.5 rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            <X className="h-3 w-3" />
            <span>ล้าง</span>
          </button>
        )}
      </div>
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="เช่น 🍳 ร้านอาหาร/แม่ค้า, 🏡 เพื่อนบ้านประจำ"
        className="w-full rounded-xl border border-fuchsia-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500"
      />
      <div className="flex flex-wrap gap-1">
        {CUSTOMER_TAG_PRESETS.map((preset) => {
          const isSelected = value.trim() === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(isSelected ? '' : preset)}
              className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
                isSelected
                  ? 'border-fuchsia-600 bg-fuchsia-600 text-white'
                  : 'border-fuchsia-200 bg-white text-fuchsia-800 hover:bg-fuchsia-100'
              }`}
            >
              {preset}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const parseLastRemindedMap = (raw: string | null): Record<string, string> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed && Number.isFinite(Date.parse(trimmed))) {
          clean[k] = trimmed;
        }
      }
    }
    return clean;
  } catch {
    return {};
  }
};

const normalizeDiscountPct = (val: unknown): number => {
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(100, Math.round(num * 100) / 100);
};

const parseDefaultDiscountPctMap = (raw: string | null): Record<string, number> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const pct = normalizeDiscountPct(v);
      if (pct > 0) {
        clean[k] = pct;
      }
    }
    return clean;
  } catch {
    return {};
  }
};

function VipDiscountField({
  inputId,
  value,
  onChange,
}: {
  inputId: string;
  value: string;
  onChange: (val: string) => void;
}) {
  const normalized = normalizeDiscountPct(value);
  return (
    <div className="rounded-xl bg-violet-50/70 border border-violet-200 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="block text-xs font-semibold text-violet-900">
          ส่วนลดประจำตัว VIP (%)
        </label>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums ${
            normalized > 0
              ? 'bg-violet-100 border-violet-300 text-violet-900'
              : 'bg-white border-slate-200 text-slate-500'
          }`}
        >
          {normalized > 0 ? (
            <>
              <Crown className="h-3 w-3 shrink-0" />
              <span>VIP ลด {formatNumber(normalized)}%</span>
            </>
          ) : (
            'ไม่มีส่วนลด'
          )}
        </span>
      </div>
      <input
        id={inputId}
        type="number"
        min="0"
        max="100"
        step="0.5"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="w-full rounded-xl border border-violet-300 bg-white px-3 py-2 text-sm font-bold tabular-nums"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-violet-800 mr-0.5">เลือกด่วน:</span>
        {VIP_DISCOUNT_PRESETS.map((pct) => {
          const isActive = normalized === pct;
          return (
            <button
              key={pct}
              type="button"
              onClick={() => onChange(String(pct))}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold tabular-nums transition ${
                isActive
                  ? 'border-violet-600 bg-violet-600 text-white'
                  : 'border-violet-300 bg-white text-violet-900 hover:bg-violet-100'
              }`}
            >
              {pct}%
            </button>
          );
        })}
      </div>
    </div>
  );
}

const parseLoyaltyPointsMap = (raw: string | null): Record<string, number> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const num = Math.floor(Number(v));
      if (Number.isFinite(num) && num > 0) {
        clean[k] = num;
      }
    }
    return clean;
  } catch {
    return {};
  }
};

const parseStoreCreditMap = (raw: string | null): Record<string, number> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const num = Math.round(Number(v) * 100) / 100;
      if (Number.isFinite(num) && num > 0) {
        clean[k] = num;
      }
    }
    return clean;
  } catch {
    return {};
  }
};

const parseCreditLimitsMap = (raw: string | null): Record<string, number> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const num = Number(v);
      if (Number.isFinite(num) && num > 0) {
        clean[k] = num;
      }
    }
    return clean;
  } catch {
    return {};
  }
};

type CreditHealthLevel = 'good' | 'watch' | 'risk';

interface CreditHealthInfo {
  level: CreditHealthLevel;
  label: string;
  usagePct: number | null;
  detail: string;
}

const getCustomerCreditHealth = (
  debt: number,
  creditLimit: number | undefined,
  dueInfo: DueDateInfo | null
): CreditHealthInfo | null => {
  const hasDebt = debt > 0;
  const hasCreditLimit = typeof creditLimit === 'number' && creditLimit > 0;
  if (!hasDebt && !hasCreditLimit) return null;

  const usagePct = hasCreditLimit ? Math.round((debt / creditLimit) * 100) : null;
  const isOverLimit = hasCreditLimit && debt > creditLimit;
  const isHighUsage = hasCreditLimit && debt * 100 >= creditLimit * 80;
  const isOverdue = hasDebt && dueInfo?.status === 'overdue';
  const isDueToday = hasDebt && dueInfo?.status === 'due_today';

  if (isOverdue || isOverLimit) {
    const reasons: string[] = [];
    if (isOverLimit) reasons.push(`เกินวงเงิน (${formatNumber(usagePct ?? 0)}%)`);
    if (isOverdue && dueInfo) {
      reasons.push(`เลยกำหนดชำระ ${Math.abs(dueInfo.daysDiff)} วัน`);
    }
    return {
      level: 'risk',
      label: '🚨 เสี่ยง/เกินกำหนด',
      usagePct,
      detail: reasons.join(' · '),
    };
  }

  if (isHighUsage || isDueToday) {
    const reasons: string[] = [];
    if (isHighUsage) reasons.push(`ใช้วงเงิน ${formatNumber(usagePct ?? 0)}%`);
    if (isDueToday) reasons.push('ครบกำหนดชำระวันนี้');
    return {
      level: 'watch',
      label: '⚠️ เฝ้าระวัง',
      usagePct,
      detail: reasons.join(' · '),
    };
  }

  return {
    level: 'good',
    label: '⭐ เครดิตดี',
    usagePct,
    detail: hasCreditLimit
      ? `ไม่เกินวงเงิน (ใช้วงเงิน ${formatNumber(usagePct ?? 0)}%) และไม่เลยกำหนดชำระ`
      : 'ไม่เกินวงเงินและไม่เลยกำหนดชำระ',
  };
};

interface CustomerMetaBackupParsed {
  keysPresent: Array<
    | typeof CREDIT_LIMITS_STORAGE_KEY
    | typeof LOYALTY_POINTS_STORAGE_KEY
    | typeof STORE_CREDIT_STORAGE_KEY
    | typeof DEFAULT_DISCOUNT_PCT_STORAGE_KEY
    | typeof LAST_REMINDED_STORAGE_KEY
    | typeof DUE_DATES_STORAGE_KEY
    | typeof CONTACT_NOTES_STORAGE_KEY
    | typeof FOLLOWUP_LOGS_STORAGE_KEY
    | typeof PAYDAY_CYCLES_STORAGE_KEY
    | typeof CUSTOMER_TAGS_STORAGE_KEY
  >;
  creditLimits?: Record<string, number>;
  loyaltyPoints?: Record<string, number>;
  storeCredits?: Record<string, number>;
  defaultDiscounts?: Record<string, number>;
  lastRemindedMap?: Record<string, string>;
  dueDates?: Record<string, string>;
  contactNotes?: Record<string, string>;
  followupLogs?: Record<string, FollowupLogEntry[]>;
  paydayCycles?: Record<string, string>;
  customerTags?: Record<string, string>;
  error?: string;
}

const isPlainRecordObject = (val: unknown): val is Record<string, unknown> =>
  Boolean(val) && typeof val === 'object' && !Array.isArray(val);

const parseCustomerMetaBackupJson = (rawText: string): CustomerMetaBackupParsed => {
  const cleaned = rawText.replace(/^\uFEFF/, '').trim();
  if (!cleaned) {
    return { keysPresent: [], error: 'กรุณาวางข้อความ JSON หรือเลือกไฟล์ .json ก่อนกู้คืนข้อมูล' };
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
    CREDIT_LIMITS_STORAGE_KEY,
    LOYALTY_POINTS_STORAGE_KEY,
    STORE_CREDIT_STORAGE_KEY,
    DEFAULT_DISCOUNT_PCT_STORAGE_KEY,
    LAST_REMINDED_STORAGE_KEY,
    DUE_DATES_STORAGE_KEY,
    CONTACT_NOTES_STORAGE_KEY,
    FOLLOWUP_LOGS_STORAGE_KEY,
    PAYDAY_CYCLES_STORAGE_KEY,
    CUSTOMER_TAGS_STORAGE_KEY,
  ] as const;

  const hasRootKey = allKeys.some((k) => Object.prototype.hasOwnProperty.call(parsed, k));
  const source: Record<string, unknown> =
    !hasRootKey && isPlainRecordObject(parsed.data) ? parsed.data : parsed;

  const keysPresent: CustomerMetaBackupParsed['keysPresent'] = [];
  const result: CustomerMetaBackupParsed = { keysPresent };

  for (const key of allKeys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const rawVal = source[key];
    if (!isPlainRecordObject(rawVal)) {
      return {
        keysPresent: [],
        error: `ข้อมูลของ "${key}" ต้องเป็น Object ({ ... })`,
      };
    }
    keysPresent.push(key);
    const serialized = JSON.stringify(rawVal);
    if (key === CREDIT_LIMITS_STORAGE_KEY) {
      result.creditLimits = parseCreditLimitsMap(serialized);
    } else if (key === LOYALTY_POINTS_STORAGE_KEY) {
      result.loyaltyPoints = parseLoyaltyPointsMap(serialized);
    } else if (key === STORE_CREDIT_STORAGE_KEY) {
      result.storeCredits = parseStoreCreditMap(serialized);
    } else if (key === DEFAULT_DISCOUNT_PCT_STORAGE_KEY) {
      result.defaultDiscounts = parseDefaultDiscountPctMap(serialized);
    } else if (key === LAST_REMINDED_STORAGE_KEY) {
      result.lastRemindedMap = parseLastRemindedMap(serialized);
    } else if (key === DUE_DATES_STORAGE_KEY) {
      result.dueDates = parseDueDatesMap(serialized);
    } else if (key === CONTACT_NOTES_STORAGE_KEY) {
      result.contactNotes = parseContactNotesMap(serialized);
    } else if (key === FOLLOWUP_LOGS_STORAGE_KEY) {
      result.followupLogs = parseFollowupLogsMap(serialized);
    } else if (key === PAYDAY_CYCLES_STORAGE_KEY) {
      result.paydayCycles = parsePaydayCyclesMap(serialized);
    } else if (key === CUSTOMER_TAGS_STORAGE_KEY) {
      result.customerTags = parseCustomerTagsMap(serialized);
    }
  }

  if (keysPresent.length === 0) {
    return {
      keysPresent: [],
      error:
        'ไม่พบคีย์ตั้งค่าลูกค้าที่รองรับ (customer_credit_limits_v1, customer_loyalty_points_v1, customer_store_credit_v1, customer_default_discount_pct_v1, customer_last_reminded_v1, customer_due_dates_v1, customer_contact_notes_v1, customer_followup_logs_v1, customer_payday_cycles_v1, customer_tags_v1)',
    };
  }

  return result;
};

export default function CustomersPage() {
  const supabase = useMemo(() => createClient(), []);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMoreCustomerTools, setShowMoreCustomerTools] = useState(false);
  const [quickCustomerTableMode, setQuickCustomerTableMode] = useState(false);

  // Search, Filter & Sort
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [filterMode, setFilterMode] = useState<
    | 'all'
    | 'debt'
    | 'overdue'
    | 'due_soon_7d'
    | 'stale_debt'
    | 'over_limit'
    | 'has_points'
    | 'has_credit'
    | 'vip'
    | 'has_followup'
    | 'credit_good'
    | 'credit_watch'
    | 'credit_risk'
  >('all');
  const [sortBy, setSortBy] = useState<
    'debt_desc' | 'debt_asc' | 'name_asc' | 'newest' | 'points_desc' | 'credit_desc'
  >('debt_desc');
  const [selectedPaydayCycle, setSelectedPaydayCycle] = useState<string>('all');
  const [selectedCustomerTag, setSelectedCustomerTag] = useState<string>('all');
  const [todayDebtPaid, setTodayDebtPaid] = useState(0);
  const [todayIso, setTodayIso] = useState('');
  const [lastPaymentMap, setLastPaymentMap] = useState<
    Record<string, { paidAt: string; amount: number }>
  >({});

  // Add Customer
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [contactNoteInput, setContactNoteInput] = useState('');
  const [paydayCycleInput, setPaydayCycleInput] = useState('');
  const [customerTagInput, setCustomerTagInput] = useState('');
  const [creditLimitInput, setCreditLimitInput] = useState('');
  const [loyaltyPointsInput, setLoyaltyPointsInput] = useState('');
  const [discountPctInput, setDiscountPctInput] = useState('');

  // Edit Customer
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editContactNoteInput, setEditContactNoteInput] = useState('');
  const [editPaydayCycleInput, setEditPaydayCycleInput] = useState('');
  const [editCustomerTagInput, setEditCustomerTagInput] = useState('');
  const [editCreditLimitInput, setEditCreditLimitInput] = useState('');
  const [editLoyaltyPointsInput, setEditLoyaltyPointsInput] = useState('');
  const [editDiscountPctInput, setEditDiscountPctInput] = useState('');
  const [editDueDateInput, setEditDueDateInput] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Per-customer credit limits, loyalty points, VIP discounts, due dates, contact notes & last reminded timestamps stored in localStorage
  const [creditLimits, setCreditLimits] = useState<Record<string, number>>({});
  const [loyaltyPoints, setLoyaltyPoints] = useState<Record<string, number>>({});
  const [storeCredits, setStoreCredits] = useState<Record<string, number>>({});
  const [defaultDiscounts, setDefaultDiscounts] = useState<Record<string, number>>({});
  const [lastRemindedMap, setLastRemindedMap] = useState<Record<string, string>>({});
  const [dueDates, setDueDates] = useState<Record<string, string>>({});
  const [contactNotes, setContactNotes] = useState<Record<string, string>>({});
  const [paydayCycles, setPaydayCycles] = useState<Record<string, string>>({});
  const [customerTags, setCustomerTags] = useState<Record<string, string>>({});
  const [followupLogs, setFollowupLogs] = useState<Record<string, FollowupLogEntry[]>>({});
  const [bulkDueDateNotice, setBulkDueDateNotice] = useState('');

  // Pay Debt Modal
  const [payCustomer, setPayCustomer] = useState<Customer | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payWaiveAmount, setPayWaiveAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'qr'>('cash');
  const [payNote, setPayNote] = useState('');
  const [payQrDataUrl, setPayQrDataUrl] = useState('');

  // Debt Payment Receipt Modal
  const [payReceipt, setPayReceipt] = useState<PayDebtReceipt | null>(null);
  const [copiedPayReceipt, setCopiedPayReceipt] = useState(false);

  // History Modal
  const [historyCustomer, setHistoryCustomer] = useState<Customer | null>(null);
  const [customerSales, setCustomerSales] = useState<Sale[]>([]);
  const [customerPayments, setCustomerPayments] = useState<DebtPayment[]>([]);
  const [historyTab, setHistoryTab] = useState<'sales' | 'payments'>('sales');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPointsInput, setHistoryPointsInput] = useState('');
  const [historyStoreCreditInput, setHistoryStoreCreditInput] = useState('');
  const [applyingStoreCreditDebt, setApplyingStoreCreditDebt] = useState(false);
  const [followupInput, setFollowupInput] = useState('');
  const [quickFollowupCustomerId, setQuickFollowupCustomerId] = useState<string | null>(null);
  const [quickFollowupInput, setQuickFollowupInput] = useState('');

type DebtReminderTone = 'polite' | 'due_soon' | 'overdue';

const DEBT_REMINDER_TONE_OPTIONS: ReadonlyArray<{
  key: DebtReminderTone;
  label: string;
}> = [
  { key: 'polite', label: 'สุภาพ / แจ้งยอดปกติ' },
  { key: 'due_soon', label: 'เตือนครบกำหนดนัดชำระ' },
  { key: 'overdue', label: 'ติดตามกรณีเลยกำหนดชำระ' },
];

  // Copy Debt Reminder State
  const [reminderTone, setReminderTone] = useState<DebtReminderTone>('polite');
  const [copiedReminderKey, setCopiedReminderKey] = useState<string | null>(null);
  const [copiedBenefitsKey, setCopiedBenefitsKey] = useState<string | null>(null);
  const [copiedDebtSummary, setCopiedDebtSummary] = useState(false);
  const [copiedDueSoon7d, setCopiedDueSoon7d] = useState(false);
  const [installmentCount, setInstallmentCount] = useState<(typeof INSTALLMENT_COUNTS)[number]>(2);
  const [copiedInstallmentKey, setCopiedInstallmentKey] = useState<string | null>(null);
  const [printDateText, setPrintDateText] = useState('');
  const [printMode, setPrintMode] = useState<
    'statement' | 'pay_receipt' | 'payment_receipt' | 'all_debtors'
  >('statement');
  const [compactPayReceipt, setCompactPayReceipt] = useState<CompactPaymentReceipt | null>(null);
  const [printSeq, setPrintSeq] = useState(0);

  // Delete Customer State (only when total_debt === 0)
  const [confirmDeleteCustomer, setConfirmDeleteCustomer] = useState<Customer | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState(false);

  // Recent Debt Payments Modal (Store-wide, latest 30)
  const [recentPaymentsOpen, setRecentPaymentsOpen] = useState(false);
  const [recentPayments, setRecentPayments] = useState<RecentDebtPayment[]>([]);
  const [recentPaymentsLoading, setRecentPaymentsLoading] = useState(false);

  // Customer Metadata Backup / Restore JSON Modal
  const [metaBackupOpen, setMetaBackupOpen] = useState(false);
  const [metaBackupJsonInput, setMetaBackupJsonInput] = useState('');
  const [metaBackupFileName, setMetaBackupFileName] = useState('');
  const [metaRestoreMode, setMetaRestoreMode] = useState<'replace' | 'merge'>('replace');
  const [metaBackupError, setMetaBackupError] = useState('');
  const [metaBackupSuccess, setMetaBackupSuccess] = useState('');
  const [metaCopied, setMetaCopied] = useState(false);

  // Bulk Credit Limit Assignment Modal
  const [bulkCreditOpen, setBulkCreditOpen] = useState(false);
  const [bulkCreditTarget, setBulkCreditTarget] = useState<
    'unset' | 'credit_good' | 'filtered'
  >('unset');
  const [bulkCreditAmountInput, setBulkCreditAmountInput] = useState('1000');
  const [bulkCreditClearMode, setBulkCreditClearMode] = useState(false);
  const [bulkCreditError, setBulkCreditError] = useState('');

  // Bulk Customer Tag Assignment Modal
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [bulkTagTarget, setBulkTagTarget] = useState<
    'unset' | 'has_debt' | 'filtered'
  >('unset');
  const [bulkTagInput, setBulkTagInput] = useState<string>(CUSTOMER_TAG_PRESETS[0]);
  const [bulkTagClearMode, setBulkTagClearMode] = useState(false);
  const [bulkTagError, setBulkTagError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);

    const [
      { data: st },
      { data: custs },
      { data: shift },
      { data: todayPayments },
      { data: allDebtPayments },
    ] = await Promise.all([
      supabase.from('store_settings').select('*').limit(1).maybeSingle(),
      supabase
        .from('customers')
        .select('*')
        .order('total_debt', { ascending: false })
        .order('name', { ascending: true }),
      supabase.from('shifts').select('*').eq('status', 'open').limit(1).maybeSingle(),
      supabase
        .from('debt_payments')
        .select('amount')
        .gte('created_at', startOfDay.toISOString())
        .lt('created_at', endOfDay.toISOString()),
      supabase
        .from('debt_payments')
        .select('customer_id, amount, created_at')
        .order('created_at', { ascending: false }),
    ]);

    const nextLastPaymentMap: Record<string, { paidAt: string; amount: number }> = {};
    for (const p of (allDebtPayments as Array<{
      customer_id: string;
      amount: number;
      created_at: string;
    }> | null) ?? []) {
      if (!p.customer_id || !p.created_at) continue;
      const existing = nextLastPaymentMap[p.customer_id];
      if (!existing || Date.parse(p.created_at) > Date.parse(existing.paidAt)) {
        nextLastPaymentMap[p.customer_id] = {
          paidAt: p.created_at,
          amount: Number(p.amount) || 0,
        };
      }
    }

    setSettings(st ?? null);
    setCustomers(custs ?? []);
    setActiveShift(shift ?? null);
    setTodayDebtPaid(
      (todayPayments ?? []).reduce((sum, p) => sum + Number(p.amount || 0), 0)
    );
    setLastPaymentMap(nextLastPaymentMap);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalAllDebt = useMemo(
    () => customers.reduce((sum, c) => sum + Number(c.total_debt), 0),
    [customers]
  );

  const debtCustomersCount = useMemo(
    () => customers.filter((c) => Number(c.total_debt) > 0).length,
    [customers]
  );

  const overLimitCustomersCount = useMemo(
    () =>
      customers.filter((c) => {
        const limit = creditLimits[c.id];
        return typeof limit === 'number' && limit > 0 && Number(c.total_debt) > limit;
      }).length,
    [customers, creditLimits]
  );

  const loyaltySummary = useMemo(() => {
    let totalPoints = 0;
    let customersWithPointsCount = 0;
    let redeemableCustomersCount = 0;
    for (const c of customers) {
      const pts = loyaltyPoints[c.id] ?? 0;
      if (pts > 0) {
        totalPoints += pts;
        customersWithPointsCount += 1;
      }
      if (pts >= 10) {
        redeemableCustomersCount += 1;
      }
    }
    return {
      totalPoints,
      customersWithPointsCount,
      redeemableCustomersCount,
    };
  }, [customers, loyaltyPoints]);

  const storeCreditSummary = useMemo(() => {
    let totalStoreCredit = 0;
    let customersWithCreditCount = 0;
    for (const c of customers) {
      const credit = storeCredits[c.id] ?? 0;
      if (credit > 0) {
        totalStoreCredit += credit;
        customersWithCreditCount += 1;
      }
    }
    return {
      totalStoreCredit: Math.round(totalStoreCredit * 100) / 100,
      customersWithCreditCount,
    };
  }, [customers, storeCredits]);

  const vipCustomersCount = useMemo(
    () => customers.filter((c) => (defaultDiscounts[c.id] ?? 0) > 0).length,
    [customers, defaultDiscounts]
  );

  const { overdueCustomersCount, overdueDebtAmount } = useMemo(() => {
    if (!todayIso) {
      return { overdueCustomersCount: 0, overdueDebtAmount: 0 };
    }
    let count = 0;
    let amount = 0;
    for (const c of customers) {
      const debt = Number(c.total_debt) || 0;
      const due = dueDates[c.id];
      if (Boolean(due) && due < todayIso && debt > 0) {
        count += 1;
        amount += debt;
      }
    }
    return { overdueCustomersCount: count, overdueDebtAmount: amount };
  }, [customers, dueDates, todayIso]);

  const { dueSoon7dItems, dueSoon7dCustomersCount, dueSoon7dDebtAmount } = useMemo(() => {
    if (!todayIso) {
      return {
        dueSoon7dItems: [] as Array<{ customer: Customer; debt: number; dueInfo: DueDateInfo }>,
        dueSoon7dCustomersCount: 0,
        dueSoon7dDebtAmount: 0,
      };
    }
    const items: Array<{ customer: Customer; debt: number; dueInfo: DueDateInfo }> = [];
    let amount = 0;
    for (const c of customers) {
      const debt = Number(c.total_debt) || 0;
      if (debt <= 0) continue;
      const dueInfo = getCustomerDueDateInfo(dueDates[c.id], todayIso, debt);
      if (!dueInfo) continue;
      if (dueInfo.daysDiff >= 0 && dueInfo.daysDiff <= 7) {
        items.push({ customer: c, debt, dueInfo });
        amount += debt;
      }
    }
    items.sort(
      (a, b) =>
        a.dueInfo.daysDiff - b.dueInfo.daysDiff ||
        b.debt - a.debt ||
        a.customer.name.localeCompare(b.customer.name, 'th')
    );
    return {
      dueSoon7dItems: items,
      dueSoon7dCustomersCount: items.length,
      dueSoon7dDebtAmount: amount,
    };
  }, [customers, dueDates, todayIso]);

  const staleDebtCustomersCount = useMemo(() => {
    if (!todayIso) return 0;
    let count = 0;
    for (const c of customers) {
      const debt = Number(c.total_debt) || 0;
      const staleInfo = getCustomerStaleDebtInfo(
        debt,
        lastPaymentMap[c.id]?.paidAt,
        c.created_at,
        todayIso
      );
      if (staleInfo?.isStale) {
        count += 1;
      }
    }
    return count;
  }, [customers, lastPaymentMap, todayIso]);

  const creditHealthSummary = useMemo(() => {
    let good = 0;
    let watch = 0;
    let risk = 0;
    for (const c of customers) {
      const debt = Number(c.total_debt) || 0;
      if (debt <= 0) continue;
      const dueIso = dueDates[c.id] ?? '';
      const dueInfo = todayIso ? getCustomerDueDateInfo(dueIso, todayIso, debt) : null;
      const health = getCustomerCreditHealth(debt, creditLimits[c.id], dueInfo);
      if (health?.level === 'risk') {
        risk += 1;
      } else if (health?.level === 'watch') {
        watch += 1;
      } else {
        good += 1;
      }
    }
    return { good, watch, risk };
  }, [customers, creditLimits, dueDates, todayIso]);

  const hasFollowupCustomersCount = useMemo(
    () => customers.filter((c) => (followupLogs[c.id]?.length ?? 0) > 0).length,
    [customers, followupLogs]
  );

  const paydayCycleOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let unassignedCount = 0;
    for (const c of customers) {
      const cycle = (paydayCycles[c.id] ?? '').trim();
      if (cycle) {
        counts.set(cycle, (counts.get(cycle) ?? 0) + 1);
      } else {
        unassignedCount += 1;
      }
    }
    const list = Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'th'))
      .map(([name, count]) => ({ name, count }));
    return { list, unassignedCount };
  }, [customers, paydayCycles]);

  const customerTagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let unassignedCount = 0;
    for (const c of customers) {
      const tag = (customerTags[c.id] ?? '').trim();
      if (tag) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      } else {
        unassignedCount += 1;
      }
    }
    const list = Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'th'))
      .map(([name, count]) => ({ name, count }));
    return { list, unassignedCount };
  }, [customers, customerTags]);

  const filteredCustomers = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const list = customers.filter((c) => {
      if (selectedPaydayCycle === '__none__') {
        if ((paydayCycles[c.id] ?? '').trim() !== '') return false;
      } else if (selectedPaydayCycle !== 'all') {
        if ((paydayCycles[c.id] ?? '').trim() !== selectedPaydayCycle) return false;
      }
      if (selectedCustomerTag === '__none__') {
        if ((customerTags[c.id] ?? '').trim() !== '') return false;
      } else if (selectedCustomerTag !== 'all') {
        if ((customerTags[c.id] ?? '').trim() !== selectedCustomerTag) return false;
      }
      if (filterMode === 'debt' && Number(c.total_debt) <= 0) {
        return false;
      }
      if (filterMode === 'overdue') {
        const due = dueDates[c.id];
        if (!todayIso || !due || due >= todayIso || Number(c.total_debt) <= 0) {
          return false;
        }
      }
      if (filterMode === 'due_soon_7d') {
        const debt = Number(c.total_debt) || 0;
        const dueInfo = todayIso ? getCustomerDueDateInfo(dueDates[c.id], todayIso, debt) : null;
        if (!dueInfo || debt <= 0 || dueInfo.daysDiff < 0 || dueInfo.daysDiff > 7) {
          return false;
        }
      }
      if (filterMode === 'stale_debt') {
        const staleInfo = getCustomerStaleDebtInfo(
          Number(c.total_debt) || 0,
          lastPaymentMap[c.id]?.paidAt,
          c.created_at,
          todayIso
        );
        if (!staleInfo?.isStale) {
          return false;
        }
      }
      if (filterMode === 'over_limit') {
        const limit = creditLimits[c.id];
        if (!(typeof limit === 'number' && limit > 0 && Number(c.total_debt) > limit)) {
          return false;
        }
      }
      if (filterMode === 'has_points' && (loyaltyPoints[c.id] ?? 0) <= 0) {
        return false;
      }
      if (filterMode === 'has_credit' && (storeCredits[c.id] ?? 0) <= 0) {
        return false;
      }
      if (filterMode === 'vip' && (defaultDiscounts[c.id] ?? 0) <= 0) {
        return false;
      }
      if (filterMode === 'has_followup' && (followupLogs[c.id]?.length ?? 0) === 0) {
        return false;
      }
      if (
        filterMode === 'credit_good' ||
        filterMode === 'credit_watch' ||
        filterMode === 'credit_risk'
      ) {
        const debt = Number(c.total_debt) || 0;
        if (debt <= 0) return false;
        const dueIso = dueDates[c.id] ?? '';
        const dueInfo = todayIso ? getCustomerDueDateInfo(dueIso, todayIso, debt) : null;
        const health = getCustomerCreditHealth(debt, creditLimits[c.id], dueInfo);
        const level = health?.level ?? 'good';
        if (filterMode === 'credit_good' && level !== 'good') return false;
        if (filterMode === 'credit_watch' && level !== 'watch') return false;
        if (filterMode === 'credit_risk' && level !== 'risk') return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.note && c.note.toLowerCase().includes(q)) ||
        (contactNotes[c.id] && contactNotes[c.id].toLowerCase().includes(q)) ||
        (paydayCycles[c.id] && paydayCycles[c.id].toLowerCase().includes(q)) ||
        (customerTags[c.id] && customerTags[c.id].toLowerCase().includes(q))
      );
    });
    return [...list].sort((a, b) => {
      if (sortBy === 'points_desc') {
        return (
          (loyaltyPoints[b.id] ?? 0) - (loyaltyPoints[a.id] ?? 0) ||
          a.name.localeCompare(b.name, 'th')
        );
      }
      if (sortBy === 'credit_desc') {
        return (
          (storeCredits[b.id] ?? 0) - (storeCredits[a.id] ?? 0) ||
          a.name.localeCompare(b.name, 'th')
        );
      }
      if (sortBy === 'debt_asc') {
        return (
          Number(a.total_debt) - Number(b.total_debt) ||
          a.name.localeCompare(b.name, 'th')
        );
      }
      if (sortBy === 'name_asc') {
        return a.name.localeCompare(b.name, 'th');
      }
      if (sortBy === 'newest') {
        const timeA = a.created_at ? Date.parse(a.created_at) || 0 : 0;
        const timeB = b.created_at ? Date.parse(b.created_at) || 0 : 0;
        return timeB - timeA || a.name.localeCompare(b.name, 'th');
      }
      return (
        Number(b.total_debt) - Number(a.total_debt) ||
        a.name.localeCompare(b.name, 'th')
      );
    });
  }, [customers, deferredSearch, filterMode, selectedPaydayCycle, selectedCustomerTag, sortBy, creditLimits, loyaltyPoints, storeCredits, defaultDiscounts, dueDates, contactNotes, paydayCycles, customerTags, lastPaymentMap, followupLogs, todayIso]);

  useEffect(() => {
    const loadCreditLimits = () => {
      try {
        const raw = window.localStorage.getItem(CREDIT_LIMITS_STORAGE_KEY);
        setCreditLimits(parseCreditLimitsMap(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    loadCreditLimits();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === CREDIT_LIMITS_STORAGE_KEY || e.key === null) {
        loadCreditLimits();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const loadLoyaltyPoints = () => {
      try {
        const raw = window.localStorage.getItem(LOYALTY_POINTS_STORAGE_KEY);
        setLoyaltyPoints(parseLoyaltyPointsMap(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    loadLoyaltyPoints();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === LOYALTY_POINTS_STORAGE_KEY || e.key === null) {
        loadLoyaltyPoints();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const loadStoreCredits = () => {
      try {
        const raw = window.localStorage.getItem(STORE_CREDIT_STORAGE_KEY);
        setStoreCredits(parseStoreCreditMap(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    loadStoreCredits();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORE_CREDIT_STORAGE_KEY || e.key === null) {
        loadStoreCredits();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const loadDefaultDiscounts = () => {
      try {
        const raw = window.localStorage.getItem(DEFAULT_DISCOUNT_PCT_STORAGE_KEY);
        setDefaultDiscounts(parseDefaultDiscountPctMap(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    loadDefaultDiscounts();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === DEFAULT_DISCOUNT_PCT_STORAGE_KEY || e.key === null) {
        loadDefaultDiscounts();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const loadLastReminded = () => {
      try {
        const raw = window.localStorage.getItem(LAST_REMINDED_STORAGE_KEY);
        setLastRemindedMap(parseLastRemindedMap(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    loadLastReminded();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === LAST_REMINDED_STORAGE_KEY || e.key === null) {
        loadLastReminded();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const syncDueDatesAndToday = () => {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      setTodayIso(`${yyyy}-${mm}-${dd}`);

      try {
        const raw = window.localStorage.getItem(DUE_DATES_STORAGE_KEY);
        setDueDates(parseDueDatesMap(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    syncDueDatesAndToday();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === DUE_DATES_STORAGE_KEY || e.key === null) {
        syncDueDatesAndToday();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const loadContactNotes = () => {
      try {
        const raw = window.localStorage.getItem(CONTACT_NOTES_STORAGE_KEY);
        setContactNotes(parseContactNotesMap(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    loadContactNotes();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === CONTACT_NOTES_STORAGE_KEY || e.key === null) {
        loadContactNotes();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const loadPaydayCycles = () => {
      try {
        const raw = window.localStorage.getItem(PAYDAY_CYCLES_STORAGE_KEY);
        setPaydayCycles(parsePaydayCyclesMap(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    loadPaydayCycles();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === PAYDAY_CYCLES_STORAGE_KEY || e.key === null) {
        loadPaydayCycles();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const loadCustomerTags = () => {
      try {
        const raw = window.localStorage.getItem(CUSTOMER_TAGS_STORAGE_KEY);
        setCustomerTags(parseCustomerTagsMap(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    loadCustomerTags();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === CUSTOMER_TAGS_STORAGE_KEY || e.key === null) {
        loadCustomerTags();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const loadFollowupLogs = () => {
      try {
        const raw = window.localStorage.getItem(FOLLOWUP_LOGS_STORAGE_KEY);
        setFollowupLogs(parseFollowupLogsMap(raw));
      } catch {
        // Ignore malformed localStorage
      }
    };
    loadFollowupLogs();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === FOLLOWUP_LOGS_STORAGE_KEY || e.key === null) {
        loadFollowupLogs();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const handleAddFollowupLog = (customerId: string, rawText: string, clearInput = false) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    const now = new Date();
    const newEntry: FollowupLogEntry = {
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      text: trimmed,
      createdAt: now.toISOString(),
    };

    let base: Record<string, FollowupLogEntry[]> = followupLogs;
    try {
      const latestRaw = window.localStorage.getItem(FOLLOWUP_LOGS_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseFollowupLogsMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }

    const existing = base[customerId] ?? [];
    const next: Record<string, FollowupLogEntry[]> = {
      ...base,
      [customerId]: [newEntry, ...existing],
    };
    try {
      window.localStorage.setItem(FOLLOWUP_LOGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setFollowupLogs(next);
    if (clearInput) {
      setFollowupInput('');
    }
  };

  const handleDeleteFollowupLog = (customerId: string, logId: string) => {
    let base: Record<string, FollowupLogEntry[]> = followupLogs;
    try {
      const latestRaw = window.localStorage.getItem(FOLLOWUP_LOGS_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseFollowupLogsMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }

    const existing = base[customerId] ?? [];
    const filtered = existing.filter((entry) => entry.id !== logId);
    const next: Record<string, FollowupLogEntry[]> = { ...base };
    if (filtered.length > 0) {
      next[customerId] = filtered;
    } else {
      delete next[customerId];
    }
    try {
      window.localStorage.setItem(FOLLOWUP_LOGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setFollowupLogs(next);
  };

  const saveCustomerCreditLimit = (customerId: string, rawInput: string) => {
    const trimmed = rawInput.trim();
    const parsed = Number(trimmed);
    setCreditLimits((prev) => {
      const next = { ...prev };
      if (trimmed !== '' && Number.isFinite(parsed) && parsed > 0) {
        next[customerId] = parsed;
      } else {
        delete next[customerId];
      }
      try {
        window.localStorage.setItem(CREDIT_LIMITS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const bulkCreditUnsetCustomers = useMemo(
    () =>
      customers.filter(
        (c) => !(typeof creditLimits[c.id] === 'number' && creditLimits[c.id] > 0)
      ),
    [customers, creditLimits]
  );

  const bulkCreditGoodCustomers = useMemo(
    () =>
      customers.filter((c) => {
        const debt = Number(c.total_debt) || 0;
        if (debt <= 0) return false;
        const dueIso = dueDates[c.id] ?? '';
        const dueInfo = todayIso ? getCustomerDueDateInfo(dueIso, todayIso, debt) : null;
        const health = getCustomerCreditHealth(debt, creditLimits[c.id], dueInfo);
        return health?.level === 'good';
      }),
    [customers, creditLimits, dueDates, todayIso]
  );

  const bulkCreditTargetCustomers = useMemo(() => {
    if (bulkCreditTarget === 'unset') return bulkCreditUnsetCustomers;
    if (bulkCreditTarget === 'credit_good') return bulkCreditGoodCustomers;
    return filteredCustomers;
  }, [
    bulkCreditTarget,
    bulkCreditUnsetCustomers,
    bulkCreditGoodCustomers,
    filteredCustomers,
  ]);

  const openBulkCreditModal = () => {
    setBulkCreditTarget('unset');
    setBulkCreditAmountInput('1000');
    setBulkCreditClearMode(false);
    setBulkCreditError('');
    setBulkCreditOpen(true);
  };

  const handleApplyBulkCreditLimit = () => {
    if (bulkCreditTargetCustomers.length === 0) {
      setBulkCreditError('ไม่มีลูกค้าในกลุ่มเป้าหมายที่เลือก');
      return;
    }
    const trimmed = bulkCreditAmountInput.trim();
    const parsed = Number(trimmed);
    if (!bulkCreditClearMode && (trimmed === '' || !Number.isFinite(parsed) || parsed <= 0)) {
      setBulkCreditError('กรุณากรอกวงเงินเชื่อที่มากกว่า 0 บาท หรือเลือก "ล้างวงเงิน"');
      return;
    }

    let base: Record<string, number> = creditLimits;
    try {
      const latestRaw = window.localStorage.getItem(CREDIT_LIMITS_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseCreditLimitsMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }

    const next = { ...base };
    for (const c of bulkCreditTargetCustomers) {
      if (bulkCreditClearMode) {
        delete next[c.id];
      } else {
        next[c.id] = parsed;
      }
    }

    try {
      window.localStorage.setItem(CREDIT_LIMITS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setCreditLimits(next);
    setBulkCreditOpen(false);
  };

  const bulkTagUnsetCustomers = useMemo(
    () => customers.filter((c) => !(customerTags[c.id] ?? '').trim()),
    [customers, customerTags]
  );

  const bulkTagDebtCustomers = useMemo(
    () => customers.filter((c) => (Number(c.total_debt) || 0) > 0),
    [customers]
  );

  const bulkTagTargetCustomers = useMemo(() => {
    if (bulkTagTarget === 'unset') return bulkTagUnsetCustomers;
    if (bulkTagTarget === 'has_debt') return bulkTagDebtCustomers;
    return filteredCustomers;
  }, [
    bulkTagTarget,
    bulkTagUnsetCustomers,
    bulkTagDebtCustomers,
    filteredCustomers,
  ]);

  const openBulkTagModal = () => {
    setBulkTagTarget('unset');
    setBulkTagInput(CUSTOMER_TAG_PRESETS[0]);
    setBulkTagClearMode(false);
    setBulkTagError('');
    setBulkTagOpen(true);
  };

  const handleApplyBulkCustomerTag = () => {
    if (bulkTagTargetCustomers.length === 0) {
      setBulkTagError('ไม่มีลูกค้าในกลุ่มเป้าหมายที่เลือก');
      return;
    }
    const trimmed = bulkTagInput.trim();
    if (!bulkTagClearMode && !trimmed) {
      setBulkTagError('กรุณาเลือกหรือกรอกป้ายกลุ่มลูกค้า หรือเลือก "ล้างป้ายกลุ่ม"');
      return;
    }

    let base: Record<string, string> = customerTags;
    try {
      const latestRaw = window.localStorage.getItem(CUSTOMER_TAGS_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseCustomerTagsMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }

    const next = { ...base };
    for (const c of bulkTagTargetCustomers) {
      if (bulkTagClearMode) {
        delete next[c.id];
      } else {
        next[c.id] = trimmed;
      }
    }

    try {
      window.localStorage.setItem(CUSTOMER_TAGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setCustomerTags(next);
    setBulkTagOpen(false);
  };

  const saveCustomerLoyaltyPoints = (customerId: string, points: number) => {
    const normalized = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
    let base: Record<string, number> = loyaltyPoints;
    try {
      const latestRaw = window.localStorage.getItem(LOYALTY_POINTS_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseLoyaltyPointsMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    if (normalized > 0) {
      next[customerId] = normalized;
    } else {
      delete next[customerId];
    }
    try {
      window.localStorage.setItem(LOYALTY_POINTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setLoyaltyPoints(next);
  };

  const saveCustomerStoreCredit = (customerId: string, amount: number) => {
    const normalized = Number.isFinite(amount)
      ? Math.max(0, Math.round(amount * 100) / 100)
      : 0;
    let base: Record<string, number> = storeCredits;
    try {
      const latestRaw = window.localStorage.getItem(STORE_CREDIT_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseStoreCreditMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    if (normalized > 0) {
      next[customerId] = normalized;
    } else {
      delete next[customerId];
    }
    try {
      window.localStorage.setItem(STORE_CREDIT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setStoreCredits(next);
  };

  const saveCustomerDefaultDiscountPct = (customerId: string, discountPct: number) => {
    const normalized = normalizeDiscountPct(discountPct);
    let base: Record<string, number> = defaultDiscounts;
    try {
      const latestRaw = window.localStorage.getItem(DEFAULT_DISCOUNT_PCT_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseDefaultDiscountPctMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    if (normalized > 0) {
      next[customerId] = normalized;
    } else {
      delete next[customerId];
    }
    try {
      window.localStorage.setItem(DEFAULT_DISCOUNT_PCT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setDefaultDiscounts(next);
  };

  const saveCustomerLastReminded = (customerId: string, isoTimestamp: string | null) => {
    const trimmed = isoTimestamp ? isoTimestamp.trim() : '';
    let base: Record<string, string> = lastRemindedMap;
    try {
      const latestRaw = window.localStorage.getItem(LAST_REMINDED_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseLastRemindedMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    if (trimmed && Number.isFinite(Date.parse(trimmed))) {
      next[customerId] = trimmed;
    } else {
      delete next[customerId];
    }
    try {
      window.localStorage.setItem(LAST_REMINDED_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setLastRemindedMap(next);
  };

  const saveCustomerDueDate = (customerId: string, rawDate: string) => {
    const trimmed = rawDate.trim();
    const isValidIso = parseIsoDateUtcMs(trimmed) !== null;
    let base: Record<string, string> = dueDates;
    try {
      const latestRaw = window.localStorage.getItem(DUE_DATES_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseDueDatesMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    if (isValidIso) {
      next[customerId] = trimmed;
    } else {
      delete next[customerId];
    }
    try {
      window.localStorage.setItem(DUE_DATES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setDueDates(next);
  };

  const saveCustomerContactNote = (customerId: string, rawContactNote: string) => {
    const trimmed = rawContactNote.trim();
    let base: Record<string, string> = contactNotes;
    try {
      const latestRaw = window.localStorage.getItem(CONTACT_NOTES_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseContactNotesMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    if (trimmed) {
      next[customerId] = trimmed;
    } else {
      delete next[customerId];
    }
    try {
      window.localStorage.setItem(CONTACT_NOTES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setContactNotes(next);
  };

  const saveCustomerPaydayCycle = (customerId: string, rawPaydayCycle: string) => {
    const trimmed = rawPaydayCycle.trim();
    let base: Record<string, string> = paydayCycles;
    try {
      const latestRaw = window.localStorage.getItem(PAYDAY_CYCLES_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parsePaydayCyclesMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    if (trimmed) {
      next[customerId] = trimmed;
    } else {
      delete next[customerId];
    }
    try {
      window.localStorage.setItem(PAYDAY_CYCLES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setPaydayCycles(next);
  };

  const saveCustomerTag = (customerId: string, rawTag: string) => {
    const trimmed = rawTag.trim();
    let base: Record<string, string> = customerTags;
    try {
      const latestRaw = window.localStorage.getItem(CUSTOMER_TAGS_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseCustomerTagsMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    if (trimmed) {
      next[customerId] = trimmed;
    } else {
      delete next[customerId];
    }
    try {
      window.localStorage.setItem(CUSTOMER_TAGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setCustomerTags(next);
  };

  const handleBulkSetDueDateByPaydayCycle = () => {
    if (selectedPaydayCycle === 'all' || selectedPaydayCycle === '__none__') return;
    const nextIso = computeNextDueDateFromPaydayCycle(selectedPaydayCycle, new Date());
    if (!nextIso) {
      setBulkDueDateNotice(
        `ไม่สามารถคำนวณวันนัดชำระอัตโนมัติจากรอบจ่าย "${selectedPaydayCycle}" ได้`
      );
      return;
    }

    const targetDebtors = customers.filter(
      (c) =>
        Number(c.total_debt) > 0 &&
        (paydayCycles[c.id] ?? '').trim() === selectedPaydayCycle
    );
    if (targetDebtors.length === 0) {
      setBulkDueDateNotice(
        `ไม่พบลูกหนี้ที่มียอดค้างชำระในกลุ่มรอบจ่าย "${selectedPaydayCycle}"`
      );
      return;
    }

    let base: Record<string, string> = dueDates;
    try {
      const latestRaw = window.localStorage.getItem(DUE_DATES_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseDueDatesMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    for (const c of targetDebtors) {
      next[c.id] = nextIso;
    }
    try {
      window.localStorage.setItem(DUE_DATES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setDueDates(next);
    setBulkDueDateNotice(
      `ตั้งวันนัดชำระ ${formatDueDateTh(nextIso)} ให้ลูกหนี้กลุ่ม "${selectedPaydayCycle}" จำนวน ${targetDebtors.length} รายเรียบร้อยแล้ว`
    );
  };

  const handleBulkSetDueDateAllStore = () => {
    const now = new Date();
    const next: Record<string, string> = { ...dueDates };
    let updatedCount = 0;
    for (const c of customers) {
      if ((Number(c.total_debt) || 0) <= 0) continue;
      const cycle = (paydayCycles[c.id] ?? '').trim();
      if (!cycle) continue;
      const nextIso = computeNextDueDateFromPaydayCycle(cycle, now);
      if (nextIso) {
        next[c.id] = nextIso;
        updatedCount += 1;
      }
    }
    if (updatedCount === 0) {
      setBulkDueDateNotice('ไม่พบลูกหนี้ที่มียอดค้างชำระและระบุรอบเงินเดือนออกไว้');
      return;
    }
    try {
      window.localStorage.setItem(DUE_DATES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setDueDates(next);
    setBulkDueDateNotice(
      `คำนวณและตั้งวันนัดชำระตามรอบจ่ายให้ลูกหนี้ทั้งร้านจำนวน ${updatedCount} รายเรียบร้อยแล้ว`
    );
  };

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const { data } = await supabase
      .from('customers')
      .insert({
        name: name.trim(),
        phone: phone.trim(),
        note: note.trim(),
      })
      .select('id')
      .single();
    if (data?.id) {
      saveCustomerCreditLimit(data.id, creditLimitInput);
      const initPoints = Number(loyaltyPointsInput.trim());
      if (loyaltyPointsInput.trim() !== '' && Number.isFinite(initPoints) && initPoints > 0) {
        saveCustomerLoyaltyPoints(data.id, initPoints);
      }
      const initDiscount = normalizeDiscountPct(discountPctInput);
      if (initDiscount > 0) {
        saveCustomerDefaultDiscountPct(data.id, initDiscount);
      }
      if (contactNoteInput.trim()) {
        saveCustomerContactNote(data.id, contactNoteInput);
      }
      if (paydayCycleInput.trim()) {
        saveCustomerPaydayCycle(data.id, paydayCycleInput);
      }
      if (customerTagInput.trim()) {
        saveCustomerTag(data.id, customerTagInput);
      }
    }
    setName('');
    setPhone('');
    setNote('');
    setContactNoteInput('');
    setPaydayCycleInput('');
    setCustomerTagInput('');
    setCreditLimitInput('');
    setLoyaltyPointsInput('');
    setDiscountPctInput('');
    setAddOpen(false);
    loadData();
  };

  const openEditCustomer = (c: Customer) => {
    setEditingCustomer(c);
    setEditName(c.name);
    setEditPhone(c.phone ?? '');
    setEditNote(c.note ?? '');
    setEditContactNoteInput(contactNotes[c.id] ?? '');
    setEditPaydayCycleInput(paydayCycles[c.id] ?? '');
    setEditCustomerTagInput(customerTags[c.id] ?? '');
    const existingLimit = creditLimits[c.id];
    setEditCreditLimitInput(
      typeof existingLimit === 'number' && existingLimit > 0 ? String(existingLimit) : ''
    );
    setEditLoyaltyPointsInput(String(loyaltyPoints[c.id] ?? 0));
    setEditDiscountPctInput(String(defaultDiscounts[c.id] ?? 0));
    setEditDueDateInput(dueDates[c.id] ?? '');
  };

  const handleEditCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer || !editName.trim()) return;
    setEditSaving(true);
    await supabase
      .from('customers')
      .update({
        name: editName.trim(),
        phone: editPhone.trim(),
        note: editNote.trim(),
      })
      .eq('id', editingCustomer.id);
    saveCustomerCreditLimit(editingCustomer.id, editCreditLimitInput);
    saveCustomerLoyaltyPoints(editingCustomer.id, Number(editLoyaltyPointsInput) || 0);
    saveCustomerDefaultDiscountPct(editingCustomer.id, Number(editDiscountPctInput) || 0);
    saveCustomerDueDate(editingCustomer.id, editDueDateInput);
    saveCustomerContactNote(editingCustomer.id, editContactNoteInput);
    saveCustomerPaydayCycle(editingCustomer.id, editPaydayCycleInput);
    saveCustomerTag(editingCustomer.id, editCustomerTagInput);
    setEditSaving(false);
    setEditingCustomer(null);
    loadData();
  };

  const openPayModal = (c: Customer, initialAmount?: number, initialNote?: string) => {
    setPayCustomer(c);
    setPayAmount(
      initialAmount !== undefined && initialAmount > 0
        ? String(initialAmount)
        : String(c.total_debt)
    );
    setPayWaiveAmount('');
    setPayMethod('cash');
    setPayNote(initialNote ?? '');
  };

  useEffect(() => {
    const amt = Number(payAmount);
    const ppId = settings?.promptpay_id?.trim();
    if (!payCustomer || payMethod !== 'qr' || !ppId || Number.isNaN(amt) || amt <= 0) {
      setPayQrDataUrl('');
      return;
    }
    let cancelled = false;
    try {
      const payload = generatePayload(ppId, { amount: amt });
      QRCode.toDataURL(payload, { width: 240, margin: 2 })
        .then((url) => {
          if (!cancelled) setPayQrDataUrl(url);
        })
        .catch(() => {
          if (!cancelled) setPayQrDataUrl('');
        });
    } catch {
      setPayQrDataUrl('');
    }
    return () => {
      cancelled = true;
    };
  }, [payCustomer, payMethod, payAmount, settings]);

  const handlePayDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payCustomer) return;
    const amt = Number(payAmount);
    if (!Number.isFinite(amt) || amt <= 0) return;

    const waiveAmt = Math.max(0, Number(payWaiveAmount) || 0);
    const debtBefore = Math.max(0, Number(payCustomer.total_debt) || 0);
    const totalReduction = Math.round((amt + waiveAmt) * 100) / 100;
    if (totalReduction > debtBefore + 0.001) {
      alert('ยอดรับชำระรวมกับยอดยกเว้นเศษหนี้ต้องไม่เกินยอดค้างชำระปัจจุบัน');
      return;
    }

    const formatAmountText = (val: number) =>
      val.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const userNote = payNote.trim();
    const waiveSummary =
      waiveAmt > 0
        ? `รับชำระจริง ฿${formatAmountText(amt)} (ยกเว้น/ลดเศษหนี้ให้ ฿${formatAmountText(waiveAmt)})`
        : '';
    const rpcNote =
      waiveAmt > 0
        ? userNote
          ? `${waiveSummary} - ${userNote}`
          : waiveSummary
        : userNote || 'รับชำระเงินเชื่อ';

    const { error } = await supabase.rpc('record_debt_payment', {
      p_customer_id: payCustomer.id,
      p_shift_id: activeShift?.id ?? null,
      p_amount: Math.min(debtBefore, totalReduction),
      p_payment_method: payMethod,
      p_note: rpcNote,
    });
    if (error) {
      alert(`บันทึกรับชำระหนี้ไม่สำเร็จ: ${error.message}`);
      return;
    }

    const paidAt = new Date().toLocaleString('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const remainingDebt = Math.max(
      0,
      Math.round((debtBefore - totalReduction) * 100) / 100
    );

    setPayReceipt({
      customerName: payCustomer.name,
      debtBefore,
      amountPaid: amt,
      waivedAmount: waiveAmt > 0 ? waiveAmt : undefined,
      paymentMethod: payMethod,
      remainingDebt,
      note: waiveAmt > 0 ? (userNote ? `${waiveSummary} - ${userNote}` : waiveSummary) : userNote,
      paidAt,
    });
    setCopiedPayReceipt(false);
    setPayCustomer(null);
    setPayWaiveAmount('');
    setPayNote('');
    loadData();
  };

  const handleApplyStoreCreditToDebt = async (targetCustomer: Customer) => {
    if (applyingStoreCreditDebt) return;
    const currentCredit = Math.max(0, Math.round((storeCredits[targetCustomer.id] ?? 0) * 100) / 100);
    const debtBefore = Math.max(0, Math.round((Number(targetCustomer.total_debt) || 0) * 100) / 100);
    const offsetAmount = Math.round(Math.min(currentCredit, debtBefore) * 100) / 100;
    if (offsetAmount <= 0) return;

    setApplyingStoreCreditDebt(true);
    try {
      const { error } = await supabase.rpc('record_debt_payment', {
        p_customer_id: targetCustomer.id,
        p_shift_id: activeShift?.id ?? null,
        p_amount: offsetAmount,
        p_payment_method: 'cash',
        p_note: `หักเงินฝากทอนสะสมชำระหนี้ ฿${offsetAmount.toLocaleString('th-TH', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        })}`,
      });
      if (error) {
        alert(`หักเงินฝากทอนชำระหนี้ไม่สำเร็จ: ${error.message}`);
        return;
      }

      const remainingCredit = Math.max(
        0,
        Math.round((currentCredit - offsetAmount) * 100) / 100
      );
      const remainingDebt = Math.max(
        0,
        Math.round((debtBefore - offsetAmount) * 100) / 100
      );
      saveCustomerStoreCredit(targetCustomer.id, remainingCredit);
      setHistoryStoreCreditInput(String(remainingCredit));

      if (historyCustomer?.id === targetCustomer.id) {
        setHistoryCustomer((prev) =>
          prev ? { ...prev, total_debt: remainingDebt } : prev
        );
      }
      if (payCustomer?.id === targetCustomer.id) {
        const paidAt = new Date().toLocaleString('th-TH', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        setPayReceipt({
          customerName: targetCustomer.name,
          debtBefore,
          amountPaid: offsetAmount,
          paymentMethod: 'cash',
          remainingDebt,
          note: `หักเงินฝากทอนสะสมชำระหนี้ (${formatBaht(offsetAmount)})`,
          paidAt,
        });
        setCopiedPayReceipt(false);
        setPayCustomer(null);
        setPayWaiveAmount('');
        setPayNote('');
      }
      await loadData();
    } finally {
      setApplyingStoreCreditDebt(false);
    }
  };

  const buildPayReceiptText = (receipt: PayDebtReceipt) => {
    const storeTitle = settings?.store_name || 'ร้านขายของชำ POS';
    const storePhone = settings?.phone?.trim();
    const methodLabel = receipt.paymentMethod === 'qr' ? 'โอน / QR' : 'เงินสด';
    const lines = [
      `✅ ใบเสร็จรับชำระหนี้ - ${storeTitle}`,
      `📅 วันที่: ${receipt.paidAt}`,
      `👤 ลูกค้า: คุณ${receipt.customerName}`,
      `------------------------`,
      `💵 ยอดที่รับชำระ: ${formatBaht(receipt.amountPaid)}`,
    ];
    if (receipt.waivedAmount && receipt.waivedAmount > 0) {
      lines.push(`🎁 ยกเว้น/ลดเศษหนี้ให้: ${formatBaht(receipt.waivedAmount)}`);
    }
    lines.push(
      `💳 ช่องทางชำระ: ${methodLabel}`,
      `📌 ยอดหนี้คงเหลือล่าสุด: ${formatBaht(receipt.remainingDebt)}`
    );
    if (receipt.note) {
      lines.push(`📝 หมายเหตุ: ${receipt.note}`);
    }
    if (storePhone) {
      lines.push(`📞 ติดต่อร้าน: ${storePhone}`);
    }
    lines.push(`ขอบคุณที่ชำระเงินครับ/ค่ะ 🙏`);
    return lines.join('\n');
  };

  const handleCopyPayReceipt = async () => {
    if (!payReceipt) return;
    const text = buildPayReceiptText(payReceipt);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedPayReceipt(true);
    setTimeout(() => setCopiedPayReceipt(false), 2500);
  };

  const openHistory = async (c: Customer) => {
    setHistoryCustomer(c);
    setHistoryTab('sales');
    setHistoryPointsInput(String(loyaltyPoints[c.id] ?? 0));
    setHistoryStoreCreditInput(String(storeCredits[c.id] ?? 0));
    setFollowupInput('');
    setHistoryLoading(true);
    const [{ data: salesData }, { data: paymentsData }] = await Promise.all([
      supabase
        .from('sales')
        .select('*, sale_items(*)')
        .eq('customer_id', c.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('debt_payments')
        .select('*')
        .eq('customer_id', c.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    setCustomerSales((salesData as Sale[]) ?? []);
    setCustomerPayments((paymentsData as DebtPayment[]) ?? []);
    setHistoryLoading(false);
  };

  const buildDebtReminderText = (
    customer: Customer,
    recentSales?: Sale[],
    tone: DebtReminderTone = 'polite'
  ) => {
    const storeTitle = settings?.store_name || 'ร้านขายของชำ POS';
    const promptPay = settings?.promptpay_id?.trim();
    const storePhone = settings?.phone?.trim();
    const dateStr = new Date().toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const dueIso = dueDates[customer.id];
    const debt = Number(customer.total_debt) || 0;
    const dueInfo = getCustomerDueDateInfo(dueIso, todayIso, debt);

    const lines: string[] = [`🙏 สวัสดีครับ/ค่ะ คุณ${customer.name}`];

    if (tone === 'due_soon') {
      lines.push(
        `ขออนุญาตแจ้งเตือนกำหนดนัดชำระยอดค้างกับ "${storeTitle}" (ณ วันที่ ${dateStr})`,
        `------------------------`,
        `💰 ยอดค้างชำระรวมสุทธิ: ${formatBaht(customer.total_debt)}`
      );
      if (dueIso && debt > 0) {
        lines.push(`📅 วันนัดชำระหนี้: ${formatDueDateTh(dueIso)}`);
      } else {
        lines.push(`📅 กำหนดนัดชำระ: ตามที่ตกลงกับทางร้าน`);
      }
    } else if (tone === 'overdue') {
      lines.push(
        `ขออนุญาตติดตามยอดค้างชำระที่เลยกำหนดกับ "${storeTitle}" (ณ วันที่ ${dateStr})`,
        `------------------------`,
        `💰 ยอดค้างชำระรวมสุทธิ: ${formatBaht(customer.total_debt)}`
      );
      if (dueInfo && dueInfo.status === 'overdue') {
        const overdueDays = Math.abs(dueInfo.daysDiff);
        lines.push(
          `⏰ เลยกำหนดนัดชำระมาแล้ว ${overdueDays} วัน (ครบกำหนด ${dueInfo.formattedDate})`
        );
      } else if (dueIso && debt > 0) {
        lines.push(`📅 วันนัดชำระที่ระบุไว้: ${formatDueDateTh(dueIso)}`);
      }
      lines.push(
        `🙏 รบกวนขอความร่วมมือชำระยอดค้างดังกล่าว เพื่อจะได้สามารถใช้วงเงินสินเชื่อกับทางร้านต่อได้อย่างต่อเนื่องครับ/ค่ะ`
      );
    } else {
      lines.push(
        `ขออนุญาตแจ้งสรุปยอดค้างชำระจาก "${storeTitle}" (ณ วันที่ ${dateStr})`,
        `------------------------`,
        `💰 ยอดค้างชำระรวมสุทธิ: ${formatBaht(customer.total_debt)}`
      );
      if (dueIso && debt > 0) {
        lines.push(`📅 วันนัดชำระหนี้: ${formatDueDateTh(dueIso)}`);
      }
    }

    if (recentSales && recentSales.length > 0) {
      lines.push(
        `🧾 บิลล่าสุด (${Math.min(recentSales.length, 3)} รายการ):`,
        ...recentSales.slice(0, 3).map(
          (s) => `  • ${formatDateTime(s.created_at)}: ${formatBaht(s.total_amount)}`
        )
      );
    }

    if (promptPay) {
      lines.push(
        `------------------------`,
        `📲 ช่องทางโอนชำระ (พร้อมเพย์): ${promptPay}`
      );
    }
    if (storePhone) {
      lines.push(`📞 เบอร์ติดต่อร้าน: ${storePhone}`);
    }

    if (tone === 'due_soon') {
      lines.push(`สามารถโอนชำระและส่งสลิปแจ้งทางร้านได้เลยนะครับ/คะ ขอบคุณครับ/ค่ะ 🙏`);
    } else if (tone === 'overdue') {
      lines.push(`หากชำระเรียบร้อยแล้วรบกวนส่งสลิปยืนยัน หรือติดต่อทางร้านได้ตลอดครับ/ค่ะ ขอบคุณครับ/ค่ะ 🙏`);
    } else {
      lines.push(`ขอบคุณที่อุดหนุนครับ/ค่ะ 🙏`);
    }

    return lines.join('\n');
  };

  const handleCopyDebtReminder = async (
    customer: Customer,
    key: string,
    recentSales?: Sale[],
    tone: DebtReminderTone = 'polite'
  ) => {
    const text = buildDebtReminderText(customer, recentSales, tone);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        // Ignore clipboard fallback errors
      }
    }
    saveCustomerLastReminded(customer.id, new Date().toISOString());
    setCopiedReminderKey(key);
    setTimeout(() => {
      setCopiedReminderKey((prev) => (prev === key ? null : prev));
    }, 2500);
  };

  const handleCopyBenefitsSummary = async (customer: Customer) => {
    const storeTitle = settings?.store_name || 'ร้านขายของชำ POS';
    const currentCredit = Math.max(0, Math.round((storeCredits[customer.id] ?? 0) * 100) / 100);
    const currentPoints = Math.max(0, Math.floor(loyaltyPoints[customer.id] ?? 0));
    const redeemableBaht = Math.floor(currentPoints / 10);
    const vipDiscountPct = Math.max(0, defaultDiscounts[customer.id] ?? 0);

    const lines = [
      `🎁 สรุปสิทธิประโยชน์ลูกค้า — ${storeTitle}`,
      `คุณ${customer.name}`,
      `💰 เงินฝากทอนสะสม: ${formatBaht(currentCredit)}`,
      `🏆 แต้มสะสม: ${formatNumber(currentPoints)} แต้ม (แลกส่วนลดได้ ${formatBaht(redeemableBaht)} | 10 แต้ม = 1 บาท)`,
      `⭐ สิทธิ์ส่วนลด VIP: ${
        vipDiscountPct > 0 ? `ลดประจำ ${vipDiscountPct}% ทุกบิล` : 'ยังไม่มีส่วนลด VIP ประจำ'
      }`,
      `ขอบคุณที่อุดหนุนครับ/ค่ะ 🙏`,
    ];
    const text = lines.join('\n');

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        // Ignore clipboard fallback errors
      }
    }

    setCopiedBenefitsKey(customer.id);
    setTimeout(() => {
      setCopiedBenefitsKey((prev) => (prev === customer.id ? null : prev));
    }, 2500);
  };

  const handleCopyInstallmentPlan = async (
    customer: Customer,
    count: (typeof INSTALLMENT_COUNTS)[number],
    key: string
  ) => {
    const storeTitle = settings?.store_name || 'ร้านขายของชำ POS';
    const promptPay = settings?.promptpay_id?.trim();
    const storePhone = settings?.phone?.trim();
    const totalDebt = Math.max(0, Number(customer.total_debt) || 0);
    const plan = calcInstallmentPlan(totalDebt, count);
    const dateStr = new Date().toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const lines: string[] = [
      `📅 แผนแบ่งผ่อนชำระหนี้ - ${storeTitle}`,
      `👤 ลูกค้า: คุณ${customer.name} (ณ วันที่ ${dateStr})`,
      `------------------------`,
      `💰 ยอดค้างชำระรวม: ${formatBaht(totalDebt)}`,
      `📌 แผนที่เลือก: แบ่งชำระ ${plan.count} งวด`,
      `💵 ยอดผ่อนต่องวด: ${formatBaht(plan.perInstallment)} / งวด`,
    ];

    if (Math.abs(plan.lastInstallment - plan.perInstallment) >= 0.01) {
      lines.push(`   (งวดสุดท้าย: ${formatBaht(plan.lastInstallment)})`);
    }

    const dueIso = dueDates[customer.id];
    if (dueIso && totalDebt > 0) {
      lines.push(`🗓️ วันนัดชำระถัดไป: ${formatDueDateTh(dueIso)}`);
    }

    if (promptPay) {
      lines.push(`------------------------`, `📲 พร้อมเพย์: ${promptPay}`);
    }
    if (storePhone) {
      lines.push(`📞 ติดต่อร้าน: ${storePhone}`);
    }
    lines.push(`ขอบคุณครับ/ค่ะ 🙏`);

    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        // Ignore clipboard fallback errors
      }
    }
    setCopiedInstallmentKey(key);
    setTimeout(() => {
      setCopiedInstallmentKey((prev) => (prev === key ? null : prev));
    }, 2500);
  };

  const renderInstallmentPlanHelper = (customer: Customer, context: 'pay' | 'history') => {
    const totalDebt = Math.max(0, Number(customer.total_debt) || 0);
    if (totalDebt <= 0) return null;
    const selectedPlan = calcInstallmentPlan(totalDebt, installmentCount);
    const copyKey = `${context}-${customer.id}`;
    const isCopied = copiedInstallmentKey === copyKey;

    return (
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold text-indigo-950">
            จำลองแผนแบ่งผ่อนชำระ (2 / 3 / 4 / 6 งวด)
          </span>
          <span className="text-[11px] font-semibold text-indigo-700 tabular-nums">
            ยอดตั้งต้น {formatBaht(totalDebt)}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {INSTALLMENT_COUNTS.map((cnt) => {
            const plan = calcInstallmentPlan(totalDebt, cnt);
            const active = installmentCount === cnt;
            return (
              <button
                key={cnt}
                type="button"
                onClick={() => setInstallmentCount(cnt)}
                className={`rounded-lg border px-2.5 py-1.5 text-left transition ${
                  active
                    ? 'border-indigo-600 bg-indigo-600 text-white shadow-xs'
                    : 'border-indigo-200 bg-white text-indigo-950 hover:border-indigo-400 hover:bg-indigo-50'
                }`}
              >
                <div className="text-[11px] font-bold">{cnt} งวด</div>
                <div className="text-xs font-extrabold tabular-nums">
                  {formatBaht(plan.perInstallment)}
                </div>
              </button>
            );
          })}
        </div>

        <div className="rounded-lg border border-indigo-200 bg-white px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-slate-600">
            เลือก <strong className="text-indigo-900">{selectedPlan.count} งวด</strong>: งวดละ{' '}
            <strong className="text-indigo-700 tabular-nums">
              {formatBaht(selectedPlan.perInstallment)}
            </strong>
          </span>
          {Math.abs(selectedPlan.lastInstallment - selectedPlan.perInstallment) >= 0.01 && (
            <span className="text-[11px] font-medium text-slate-500 tabular-nums">
              งวดสุดท้าย {formatBaht(selectedPlan.lastInstallment)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (context === 'pay') {
                setPayAmount(String(selectedPlan.perInstallment));
                if (!payNote.trim()) {
                  setPayNote(`ผ่อนชำระ (แผน ${selectedPlan.count} งวด)`);
                }
              } else {
                setHistoryCustomer(null);
                openPayModal(
                  customer,
                  selectedPlan.perInstallment,
                  `ผ่อนชำระ (แผน ${selectedPlan.count} งวด)`
                );
              }
            }}
            className="flex-1 min-w-[150px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700 shadow-xs"
          >
            <Banknote className="h-3.5 w-3.5" />
            <span>ใช้ยอดต่องวดนี้รับชำระ</span>
          </button>
          <button
            type="button"
            onClick={() => handleCopyInstallmentPlan(customer, installmentCount, copyKey)}
            className={`flex-1 min-w-[160px] inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
              isCopied
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-indigo-300 bg-white text-indigo-800 hover:bg-indigo-100'
            }`}
          >
            {isCopied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                <span>คัดลอกแผนผ่อนแล้ว!</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>คัดลอกแผนผ่อนชำระส่ง LINE</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  };

  const handleCopyDebtSummary = async () => {
    const debtors = customers
      .filter((c) => Number(c.total_debt) > 0)
      .sort(
        (a, b) =>
          Number(b.total_debt) - Number(a.total_debt) ||
          a.name.localeCompare(b.name, 'th')
      );

    const storeTitle = settings?.store_name || 'ร้านขายของชำ POS';
    const dateStr = new Date().toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const lines: string[] = [
      `📋 สรุปยอดลูกหนี้ทั้งร้าน - ${storeTitle}`,
      `📅 วันที่: ${dateStr}`,
      `------------------------`,
    ];

    if (debtors.length === 0) {
      lines.push('- ไม่มีลูกค้าที่มียอดค้างชำระ -');
    } else {
      debtors.forEach((c, idx) => {
        const phoneStr = c.phone?.trim() ? ` (${c.phone.trim()})` : '';
        lines.push(`${idx + 1}. ${c.name}${phoneStr}: ${formatBaht(c.total_debt)}`);
      });
      lines.push(`------------------------`);
      lines.push(`รวมลูกหนี้: ${formatNumber(debtors.length)} ราย`);
      lines.push(`ยอดค้างชำระรวมทั้งร้าน: ${formatBaht(totalAllDebt)}`);
      if (overdueCustomersCount > 0) {
        lines.push(
          `⚠️ เลยกำหนดชำระ: ${formatNumber(overdueCustomersCount)} ราย (${formatBaht(overdueDebtAmount)})`
        );
      }
    }

    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedDebtSummary(true);
    setTimeout(() => setCopiedDebtSummary(false), 2500);
  };

  const handleCopyDueSoon7dLine = async () => {
    const storeTitle = settings?.store_name || 'ร้านขายของชำ POS';
    const dateStr = new Date().toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const lines: string[] = [
      `📅 คิวนัดชำระหนี้ใน 7 วันข้างหน้า - ${storeTitle}`,
      `ข้อมูล ณ วันที่: ${dateStr}`,
      `------------------------`,
    ];

    if (dueSoon7dItems.length === 0) {
      lines.push('- ไม่มีลูกหนี้ที่นัดชำระภายใน 7 วันข้างหน้า -');
    } else {
      dueSoon7dItems.forEach(({ customer: c, debt, dueInfo }, idx) => {
        const phoneStr = c.phone?.trim() ? ` (${c.phone.trim()})` : '';
        const dayLabel = dueInfo.daysDiff === 0 ? 'ครบกำหนดวันนี้' : `อีก ${dueInfo.daysDiff} วัน`;
        lines.push(
          `${idx + 1}. ${c.name}${phoneStr} • ${dueInfo.formattedDate} (${dayLabel}) : ${formatBaht(debt)}`
        );
      });
      lines.push(`------------------------`);
      lines.push(
        `รวม ${formatNumber(dueSoon7dCustomersCount)} ราย • ยอดรอรับชำระรวม ${formatBaht(dueSoon7dDebtAmount)}`
      );
    }

    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedDueSoon7d(true);
    setTimeout(() => setCopiedDueSoon7d(false), 2500);
  };

  const handleExportCustomersCsv = () => {
    const escapeCsv = (val: unknown) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
      'ชื่อลูกค้า',
      'เบอร์โทร',
      'ที่อยู่ / ช่องทางติดต่อ',
      'กลุ่มลูกค้า',
      'รอบจ่ายเงินประจำ',
      'ยอดค้างชำระ',
      'วันนัดชำระหนี้',
      'วงเงินเชื่อ',
      'แต้มสะสม',
      'เงินฝากทอนสะสม',
      'ส่วนลด VIP (%)',
      'สถานะ',
      'บันทึกการติดตามล่าสุด',
      'หมายเหตุ',
    ];

    const rows = filteredCustomers.map((c) => {
      const debt = Number(c.total_debt) || 0;
      const creditLimit = creditLimits[c.id];
      const hasCreditLimit = typeof creditLimit === 'number' && creditLimit > 0;
      const isOverCreditLimit = hasCreditLimit && debt > creditLimit;
      const points = loyaltyPoints[c.id] ?? 0;
      const storeCredit = storeCredits[c.id] ?? 0;
      const vipDiscountPct = defaultDiscounts[c.id] ?? 0;
      const dueIso = dueDates[c.id] || '-';
      const contactNote = contactNotes[c.id] || '-';
      const customerTag = customerTags[c.id] || '-';
      const paydayCycle = paydayCycles[c.id] || '-';
      const latestFollowup = followupLogs[c.id]?.[0];
      const latestFollowupText = latestFollowup
        ? `${latestFollowup.text} (${formatDateTime(latestFollowup.createdAt)})`
        : '-';
      return [
        c.name,
        c.phone || '-',
        contactNote,
        customerTag,
        paydayCycle,
        debt.toFixed(2),
        dueIso,
        hasCreditLimit ? creditLimit.toFixed(2) : '-',
        points,
        storeCredit.toFixed(2),
        vipDiscountPct > 0 ? `${vipDiscountPct}%` : '-',
        isOverCreditLimit ? 'เกินวงเงิน' : 'ปกติ',
        latestFollowupText,
        c.note || '-',
      ]
        .map(escapeCsv)
        .join(',');
    });

    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `customers-debt-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const buildCustomerMetaBackupPayload = () => {
    let nextCreditLimits = creditLimits;
    let nextLoyaltyPoints = loyaltyPoints;
    let nextStoreCredits = storeCredits;
    let nextDiscounts = defaultDiscounts;
    let nextLastReminded = lastRemindedMap;
    let nextDueDates = dueDates;
    let nextContactNotes = contactNotes;
    let nextFollowupLogs = followupLogs;
    let nextPaydayCycles = paydayCycles;
    let nextCustomerTags = customerTags;

    try {
      const rawLimits = window.localStorage.getItem(CREDIT_LIMITS_STORAGE_KEY);
      if (rawLimits !== null) nextCreditLimits = parseCreditLimitsMap(rawLimits);
      const rawPoints = window.localStorage.getItem(LOYALTY_POINTS_STORAGE_KEY);
      if (rawPoints !== null) nextLoyaltyPoints = parseLoyaltyPointsMap(rawPoints);
      const rawStoreCredits = window.localStorage.getItem(STORE_CREDIT_STORAGE_KEY);
      if (rawStoreCredits !== null) nextStoreCredits = parseStoreCreditMap(rawStoreCredits);
      const rawDiscounts = window.localStorage.getItem(DEFAULT_DISCOUNT_PCT_STORAGE_KEY);
      if (rawDiscounts !== null) nextDiscounts = parseDefaultDiscountPctMap(rawDiscounts);
      const rawReminded = window.localStorage.getItem(LAST_REMINDED_STORAGE_KEY);
      if (rawReminded !== null) nextLastReminded = parseLastRemindedMap(rawReminded);
      const rawDueDates = window.localStorage.getItem(DUE_DATES_STORAGE_KEY);
      if (rawDueDates !== null) nextDueDates = parseDueDatesMap(rawDueDates);
      const rawContactNotes = window.localStorage.getItem(CONTACT_NOTES_STORAGE_KEY);
      if (rawContactNotes !== null) nextContactNotes = parseContactNotesMap(rawContactNotes);
      const rawFollowupLogs = window.localStorage.getItem(FOLLOWUP_LOGS_STORAGE_KEY);
      if (rawFollowupLogs !== null) nextFollowupLogs = parseFollowupLogsMap(rawFollowupLogs);
      const rawPaydayCycles = window.localStorage.getItem(PAYDAY_CYCLES_STORAGE_KEY);
      if (rawPaydayCycles !== null) nextPaydayCycles = parsePaydayCyclesMap(rawPaydayCycles);
      const rawCustomerTags = window.localStorage.getItem(CUSTOMER_TAGS_STORAGE_KEY);
      if (rawCustomerTags !== null) nextCustomerTags = parseCustomerTagsMap(rawCustomerTags);
    } catch {
      // Fallback to in-memory state
    }

    return {
      version: 1,
      [CREDIT_LIMITS_STORAGE_KEY]: nextCreditLimits,
      [LOYALTY_POINTS_STORAGE_KEY]: nextLoyaltyPoints,
      [STORE_CREDIT_STORAGE_KEY]: nextStoreCredits,
      [DEFAULT_DISCOUNT_PCT_STORAGE_KEY]: nextDiscounts,
      [LAST_REMINDED_STORAGE_KEY]: nextLastReminded,
      [DUE_DATES_STORAGE_KEY]: nextDueDates,
      [CONTACT_NOTES_STORAGE_KEY]: nextContactNotes,
      [FOLLOWUP_LOGS_STORAGE_KEY]: nextFollowupLogs,
      [PAYDAY_CYCLES_STORAGE_KEY]: nextPaydayCycles,
      [CUSTOMER_TAGS_STORAGE_KEY]: nextCustomerTags,
    };
  };

  const openMetaBackupModal = () => {
    setMetaBackupJsonInput('');
    setMetaBackupFileName('');
    setMetaRestoreMode('replace');
    setMetaBackupError('');
    setMetaBackupSuccess('');
    setMetaCopied(false);
    setMetaBackupOpen(true);
  };

  const handleExportCustomerMetaJson = () => {
    setMetaBackupError('');
    const payload = buildCustomerMetaBackupPayload();
    const jsonText = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `customers-metadata-backup-${dateStamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setMetaBackupSuccess(`ดาวน์โหลดไฟล์สำรองข้อมูล (${link.download}) เรียบร้อยแล้ว`);
  };

  const handleCopyCustomerMetaJson = async () => {
    try {
      const payload = buildCustomerMetaBackupPayload();
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setMetaCopied(true);
      setTimeout(() => setMetaCopied(false), 2000);
    } catch {
      setMetaBackupError('ไม่สามารถคัดลอก JSON ได้ กรุณาใช้ปุ่มดาวน์โหลดไฟล์ .json แทน');
    }
  };

  const handleMetaBackupFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setMetaBackupError('');
    setMetaBackupSuccess('');
    setMetaBackupFileName(file.name);
    try {
      const rawText = await file.text();
      setMetaBackupJsonInput(rawText);
    } catch {
      setMetaBackupError('ไม่สามารถอ่านไฟล์ที่เลือกได้ กรุณาลองใหม่อีกครั้ง');
    }
  };

  const metaBackupPreview = useMemo(() => {
    if (!metaBackupJsonInput.trim()) return null;
    return parseCustomerMetaBackupJson(metaBackupJsonInput);
  }, [metaBackupJsonInput]);

  const handleRestoreCustomerMetaJson = () => {
    setMetaBackupError('');
    setMetaBackupSuccess('');

    const parsed = parseCustomerMetaBackupJson(metaBackupJsonInput);
    if (parsed.error) {
      setMetaBackupError(parsed.error);
      return;
    }

    const readLatestMap = <T,>(
      key: string,
      fallback: Record<string, T>,
      parser: (raw: string | null) => Record<string, T>
    ): Record<string, T> => {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw !== null) return parser(raw);
      } catch {
        // Fallback to in-memory state
      }
      return fallback;
    };

    const writeAndSyncMap = <T,>(
      key: string,
      incoming: Record<string, T>,
      currentFallback: Record<string, T>,
      parser: (raw: string | null) => Record<string, T>,
      setter: (next: Record<string, T>) => void
    ): number => {
      const next =
        metaRestoreMode === 'merge'
          ? { ...readLatestMap(key, currentFallback, parser), ...incoming }
          : incoming;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Ignore storage errors while still updating in-memory state
      }
      setter(next);
      return Object.keys(incoming).length;
    };

    const restoredSummary: string[] = [];

    if (parsed.creditLimits !== undefined) {
      const count = writeAndSyncMap(
        CREDIT_LIMITS_STORAGE_KEY,
        parsed.creditLimits,
        creditLimits,
        parseCreditLimitsMap,
        setCreditLimits
      );
      restoredSummary.push(`วงเงินเชื่อ ${formatNumber(count)} ราย`);
    }
    if (parsed.loyaltyPoints !== undefined) {
      const count = writeAndSyncMap(
        LOYALTY_POINTS_STORAGE_KEY,
        parsed.loyaltyPoints,
        loyaltyPoints,
        parseLoyaltyPointsMap,
        setLoyaltyPoints
      );
      restoredSummary.push(`แต้มสะสม ${formatNumber(count)} ราย`);
    }
    if (parsed.storeCredits !== undefined) {
      const count = writeAndSyncMap(
        STORE_CREDIT_STORAGE_KEY,
        parsed.storeCredits,
        storeCredits,
        parseStoreCreditMap,
        setStoreCredits
      );
      restoredSummary.push(`เงินฝากทอน ${formatNumber(count)} ราย`);
    }
    if (parsed.defaultDiscounts !== undefined) {
      const count = writeAndSyncMap(
        DEFAULT_DISCOUNT_PCT_STORAGE_KEY,
        parsed.defaultDiscounts,
        defaultDiscounts,
        parseDefaultDiscountPctMap,
        setDefaultDiscounts
      );
      restoredSummary.push(`ส่วนลด VIP ${formatNumber(count)} ราย`);
    }
    if (parsed.lastRemindedMap !== undefined) {
      const count = writeAndSyncMap(
        LAST_REMINDED_STORAGE_KEY,
        parsed.lastRemindedMap,
        lastRemindedMap,
        parseLastRemindedMap,
        setLastRemindedMap
      );
      restoredSummary.push(`ประวัติแจ้งยอด ${formatNumber(count)} ราย`);
    }
    if (parsed.dueDates !== undefined) {
      const count = writeAndSyncMap(
        DUE_DATES_STORAGE_KEY,
        parsed.dueDates,
        dueDates,
        parseDueDatesMap,
        setDueDates
      );
      restoredSummary.push(`วันนัดชำระ ${formatNumber(count)} ราย`);
    }
    if (parsed.contactNotes !== undefined) {
      const count = writeAndSyncMap(
        CONTACT_NOTES_STORAGE_KEY,
        parsed.contactNotes,
        contactNotes,
        parseContactNotesMap,
        setContactNotes
      );
      restoredSummary.push(`ที่อยู่/ติดต่อ ${formatNumber(count)} ราย`);
    }
    if (parsed.followupLogs !== undefined) {
      const count = writeAndSyncMap(
        FOLLOWUP_LOGS_STORAGE_KEY,
        parsed.followupLogs,
        followupLogs,
        parseFollowupLogsMap,
        setFollowupLogs
      );
      restoredSummary.push(`บันทึกติดตาม ${formatNumber(count)} ราย`);
    }
    if (parsed.paydayCycles !== undefined) {
      const count = writeAndSyncMap(
        PAYDAY_CYCLES_STORAGE_KEY,
        parsed.paydayCycles,
        paydayCycles,
        parsePaydayCyclesMap,
        setPaydayCycles
      );
      restoredSummary.push(`รอบจ่ายประจำ ${formatNumber(count)} ราย`);
    }
    if (parsed.customerTags !== undefined) {
      const count = writeAndSyncMap(
        CUSTOMER_TAGS_STORAGE_KEY,
        parsed.customerTags,
        customerTags,
        parseCustomerTagsMap,
        setCustomerTags
      );
      restoredSummary.push(`กลุ่มลูกค้า ${formatNumber(count)} ราย`);
    }

    const modeLabel =
      metaRestoreMode === 'merge' ? 'ผสานข้อมูลเพิ่ม' : 'กู้คืนทับข้อมูลเดิม';
    setMetaBackupSuccess(`${modeLabel}สำเร็จ (${restoredSummary.join(', ')})`);
  };

  const recentPaymentsSummary = useMemo(() => {
    let total = 0;
    let cash = 0;
    let qr = 0;
    let cashCount = 0;
    let qrCount = 0;
    let waivedTotal = 0;
    let waivedCount = 0;
    let grossTotal = 0;
    for (const p of recentPayments) {
      const amt = Number(p.amount) || 0;
      const waiveMatch = (p.note ?? '').match(/\(ยกเว้น\/ลดเศษหนี้ให้\s*฿([\d,]+(?:\.\d+)?)\)/);
      const parsedWaive = waiveMatch ? Number(waiveMatch[1].replace(/,/g, '')) : 0;
      const waived =
        Number.isFinite(parsedWaive) && parsedWaive > 0 ? Math.min(amt, parsedWaive) : 0;
      const actualReceived = Math.max(0, Math.round((amt - waived) * 100) / 100);

      grossTotal += amt;
      total += actualReceived;
      if (waived > 0) {
        waivedTotal += waived;
        waivedCount += 1;
      }
      if (p.payment_method === 'qr') {
        qr += actualReceived;
        qrCount += 1;
      } else {
        cash += actualReceived;
        cashCount += 1;
      }
    }
    return { total, cash, qr, cashCount, qrCount, waivedTotal, waivedCount, grossTotal };
  }, [recentPayments]);

  const handleExportRecentPaymentsCsv = () => {
    if (recentPayments.length === 0) return;

    const escapeCsv = (val: unknown) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
      'ลำดับ',
      'วันที่และเวลา',
      'ชื่อลูกค้า',
      'วิธีชำระ',
      'ยอดชำระ (บาท)',
      'หมายเหตุ',
    ];

    const rows = recentPayments.map((p, idx) =>
      [
        idx + 1,
        formatDateTime(p.created_at),
        p.customers?.name ?? 'ไม่ระบุลูกค้า',
        p.payment_method === 'qr' ? 'โอน / QR' : 'เงินสด',
        Number(p.amount).toFixed(2),
        p.note || '-',
      ]
        .map(escapeCsv)
        .join(','),
    );

    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `debt-payments-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportCustomerHistoryCsv = () => {
    if (!historyCustomer || (customerSales.length === 0 && customerPayments.length === 0)) return;

    const escapeCsv = (val: unknown) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = ['วันที่-เวลา', 'ประเภท', 'ยอดเงิน', 'ช่องทาง', 'รายละเอียด/หมายเหตุ'];

    const combinedRows: Array<{
      createdAt: string;
      dateText: string;
      type: string;
      amount: string;
      channel: string;
      detail: string;
    }> = [
      ...customerSales.map((s) => {
        const itemsSummary = (s.sale_items ?? [])
          .map((item) => `${item.product_name} x ${item.qty} ${item.unit_name}`)
          .join(', ');
        const detailParts = [itemsSummary, s.note ? `หมายเหตุ: ${s.note}` : ''].filter(Boolean);
        return {
          createdAt: s.created_at,
          dateText: formatDateTime(s.created_at),
          type: 'ซื้อเชื่อ',
          amount: Number(s.total_amount || 0).toFixed(2),
          channel: 'เงินเชื่อ',
          detail: detailParts.join(' | ') || '-',
        };
      }),
      ...customerPayments.map((p) => ({
        createdAt: p.created_at,
        dateText: formatDateTime(p.created_at),
        type: 'ชำระหนี้',
        amount: Number(p.amount || 0).toFixed(2),
        channel: p.payment_method === 'qr' ? 'โอน / QR' : 'เงินสด',
        detail: p.note || '-',
      })),
    ];

    combinedRows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const rows = combinedRows.map((r) =>
      [r.dateText, r.type, r.amount, r.channel, r.detail].map(escapeCsv).join(',')
    );

    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    const safeName = historyCustomer.name.replace(/[\\/:*?"<>|]/g, '_');
    link.href = url;
    link.download = `customer-history-${safeName}-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDeleteCustomer = async () => {
    if (!confirmDeleteCustomer || Number(confirmDeleteCustomer.total_debt) !== 0) return;
    setDeletingCustomer(true);
    // Unlink any historical sales & remove old payment logs before deleting customer record
    await supabase
      .from('sales')
      .update({ customer_id: null })
      .eq('customer_id', confirmDeleteCustomer.id);
    await supabase
      .from('debt_payments')
      .delete()
      .eq('customer_id', confirmDeleteCustomer.id);
    await supabase.from('customers').delete().eq('id', confirmDeleteCustomer.id);
    saveCustomerLoyaltyPoints(confirmDeleteCustomer.id, 0);
    saveCustomerStoreCredit(confirmDeleteCustomer.id, 0);
    saveCustomerDefaultDiscountPct(confirmDeleteCustomer.id, 0);
    saveCustomerLastReminded(confirmDeleteCustomer.id, null);
    saveCustomerDueDate(confirmDeleteCustomer.id, '');
    saveCustomerContactNote(confirmDeleteCustomer.id, '');
    setDeletingCustomer(false);
    setConfirmDeleteCustomer(null);
    await loadData();
  };

  const openRecentPayments = async () => {
    setRecentPaymentsOpen(true);
    setRecentPaymentsLoading(true);
    const { data } = await supabase
      .from('debt_payments')
      .select('*, customers(name)')
      .order('created_at', { ascending: false })
      .limit(30);
    setRecentPayments((data as RecentDebtPayment[]) ?? []);
    setRecentPaymentsLoading(false);
  };

  useEffect(() => {
    if (printSeq === 0) return;
    const timer = window.setTimeout(() => {
      window.print();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [printSeq]);

  const historyPrintRows = useMemo(() => {
    const rows: Array<{
      id: string;
      createdAt: string;
      kind: 'sale' | 'payment';
      typeLabel: string;
      detail: string;
      amount: number;
    }> = [
      ...customerSales.map((s) => {
        const itemsText = (s.sale_items ?? [])
          .map((item) => `${item.product_name} x ${item.qty} ${item.unit_name}`)
          .join(', ');
        const detailParts = [
          itemsText || 'บิลซื้อเชื่อ',
          s.note ? `หมายเหตุ: ${s.note}` : '',
        ].filter(Boolean);
        return {
          id: `sale-${s.id}`,
          createdAt: s.created_at,
          kind: 'sale' as const,
          typeLabel: 'ซื้อเชื่อ',
          detail: detailParts.join(' · '),
          amount: Number(s.total_amount || 0),
        };
      }),
      ...customerPayments.map((p) => {
        const methodText = p.payment_method === 'qr' ? 'โอน / QR' : 'เงินสด';
        const detailParts = [methodText, p.note ? p.note : ''].filter(Boolean);
        return {
          id: `payment-${p.id}`,
          createdAt: p.created_at,
          kind: 'payment' as const,
          typeLabel: 'ชำระหนี้',
          detail: detailParts.join(' · '),
          amount: Number(p.amount || 0),
        };
      }),
    ];
    rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return rows;
  }, [customerSales, customerPayments]);

  const handlePrintDebtStatement = () => {
    setPrintMode('statement');
    setPrintDateText(
      new Date().toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    );
    setPrintSeq((prev) => prev + 1);
  };

  const handlePrintPayReceipt = () => {
    setPrintMode('pay_receipt');
    setPrintSeq((prev) => prev + 1);
  };

  const handlePrintCompactPayReceipt = () => {
    if (!payReceipt) return;
    const debtBefore =
      typeof payReceipt.debtBefore === 'number'
        ? payReceipt.debtBefore
        : Math.round(
            (payReceipt.remainingDebt + payReceipt.amountPaid + (payReceipt.waivedAmount ?? 0)) *
              100
          ) / 100;
    setCompactPayReceipt({
      customerName: payReceipt.customerName,
      debtBefore,
      amountPaid: payReceipt.amountPaid,
      waivedAmount: payReceipt.waivedAmount,
      paymentMethod: payReceipt.paymentMethod,
      remainingDebt: payReceipt.remainingDebt,
      paidAt: payReceipt.paidAt,
      note: payReceipt.note,
    });
    setPrintMode('payment_receipt');
    setPrintSeq((prev) => prev + 1);
  };

  const handlePrintHistoryPaymentReceipt = (payment: DebtPayment) => {
    if (!historyCustomer) return;
    const currentDebt = Math.max(0, Number(historyCustomer.total_debt) || 0);
    const paymentTime = Date.parse(payment.created_at);
    let salesAfter = 0;
    for (const s of customerSales) {
      if (Date.parse(s.created_at) > paymentTime) {
        salesAfter += Number(s.total_amount) || 0;
      }
    }
    let paymentsAfter = 0;
    for (const other of customerPayments) {
      if (other.id === payment.id) continue;
      if (Date.parse(other.created_at) > paymentTime) {
        paymentsAfter += Number(other.amount) || 0;
      }
    }
    const amountPaid = Number(payment.amount) || 0;
    const remainingDebt = Math.max(
      0,
      Math.round((currentDebt - salesAfter + paymentsAfter) * 100) / 100
    );
    const debtBefore = Math.round((remainingDebt + amountPaid) * 100) / 100;
    setCompactPayReceipt({
      customerName: historyCustomer.name,
      debtBefore,
      amountPaid,
      paymentMethod: payment.payment_method === 'qr' ? 'qr' : 'cash',
      remainingDebt,
      paidAt: formatDateTime(payment.created_at),
      note: payment.note ?? undefined,
    });
    setPrintMode('payment_receipt');
    setPrintSeq((prev) => prev + 1);
  };

  const allDebtorsForPrint = useMemo(
    () =>
      customers
        .filter((c) => {
          if (Number(c.total_debt) <= 0) return false;
          if (selectedPaydayCycle === '__none__') {
            return (paydayCycles[c.id] ?? '').trim() === '';
          }
          if (selectedPaydayCycle !== 'all') {
            return (paydayCycles[c.id] ?? '').trim() === selectedPaydayCycle;
          }
          return true;
        })
        .sort(
          (a, b) =>
            Number(b.total_debt) - Number(a.total_debt) || a.name.localeCompare(b.name, 'th')
        ),
    [customers, selectedPaydayCycle, paydayCycles]
  );

  const totalDebtorsForPrint = useMemo(
    () => allDebtorsForPrint.reduce((sum, c) => sum + (Number(c.total_debt) || 0), 0),
    [allDebtorsForPrint]
  );

  const handlePrintAllDebtors = () => {
    setPrintMode('all_debtors');
    setPrintDateText(
      new Date().toLocaleString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    );
    setPrintSeq((prev) => prev + 1);
  };

  return (
    <>
      <div className="print:hidden">
        <AppShell storeName={settings?.store_name || 'ร้านขายของชำ POS'}>
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
        <div className="space-y-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 leading-snug">
              ลูกค้าเงินเชื่อ (เซ็นไว้ก่อน)
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              ยอดค้างชำระรวมทั้งหมด:{' '}
              <span className="font-bold text-amber-700 tabular-nums">
                {formatBaht(totalAllDebt)}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openRecentPayments}
              className="flex items-center gap-1.5 rounded-xl border border-teal-300 bg-teal-50 px-3.5 py-2.5 text-sm font-semibold text-teal-800 hover:bg-teal-100"
            >
              <History className="h-4 w-4" />
              <span>ประวัติรับชำระหนี้ทั้งร้าน</span>
            </button>
            <button
              type="button"
              disabled={debtCustomersCount === 0}
              onClick={handleCopyDebtSummary}
              className="flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {copiedDebtSummary ? (
                <>
                  <Check className="h-4 w-4 text-emerald-600" />
                  <span className="text-emerald-700">คัดลอกสรุปยอดแล้ว</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  <span>คัดลอกสรุปยอดลูกหนี้ ({debtCustomersCount})</span>
                </>
              )}
            </button>
            <button
              type="button"
              disabled={customers.length === 0}
              onClick={openBulkCreditModal}
              className="flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 shadow-sm disabled:opacity-50"
            >
              <Banknote className="h-4 w-4" />
              <span>ตั้งวงเงินเชื่อแบบกลุ่ม</span>
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 shadow-sm"
            >
              <UserPlus className="h-4 w-4" />
              <span>เพิ่มลูกค้าใหม่</span>
            </button>
            <button
              type="button"
              onClick={() => setShowMoreCustomerTools((prev) => !prev)}
              aria-expanded={showMoreCustomerTools}
              className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition-colors ${
                showMoreCustomerTools
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>{showMoreCustomerTools ? 'ซ่อนเครื่องมือเสริม' : 'เครื่องมือลูกหนี้เสริม (⋯)'}</span>
            </button>
          </div>
        </div>

        {showMoreCustomerTools && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
            <button
              type="button"
              onClick={() => setQuickCustomerTableMode((prev) => !prev)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                quickCustomerTableMode
                  ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm hover:bg-indigo-700'
                  : 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
              }`}
            >
              <ClipboardCheck className="h-4 w-4" />
              <span>
                {quickCustomerTableMode
                  ? 'ปิดโหมดตารางจัดการลูกหนี้เร็ว'
                  : 'โหมดตารางจัดการลูกหนี้เร็ว'}
              </span>
            </button>
            <button
              type="button"
              disabled={filteredCustomers.length === 0}
              onClick={handleExportCustomersCsv}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              <span>ส่งออก CSV ({filteredCustomers.length})</span>
            </button>
            <button
              type="button"
              onClick={openMetaBackupModal}
              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Database className="h-4 w-4" />
              <span>สำรอง/กู้คืนตั้งค่า (JSON)</span>
            </button>
            <button
              type="button"
              disabled={allDebtorsForPrint.length === 0}
              onClick={handlePrintAllDebtors}
              className="flex items-center gap-1.5 rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              <span>
                {selectedPaydayCycle === 'all'
                  ? 'พิมพ์สรุปลูกหนี้ทั้งร้าน (A4)'
                  : `พิมพ์สรุปลูกหนี้ (${allDebtorsForPrint.length}) (A4)`}
              </span>
            </button>
            <button
              type="button"
              disabled={customers.length === 0}
              onClick={openBulkTagModal}
              className="flex items-center gap-1.5 rounded-xl border border-teal-300 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50"
            >
              <Users className="h-4 w-4" />
              <span>จัดกลุ่มลูกค้าแบบกลุ่ม</span>
            </button>
            <button
              type="button"
              disabled={debtCustomersCount === 0}
              onClick={handleBulkSetDueDateAllStore}
              className="flex items-center gap-1.5 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50"
            >
              <CalendarClock className="h-4 w-4" />
              <span>คำนวณวันนัดชำระจากรอบจ่ายทั้งร้าน</span>
            </button>
          </div>
        )}

        {/* Debt & Loyalty Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          <div className="rounded-2xl bg-white border border-amber-200 p-4 flex items-center justify-between shadow-xs">
            <div>
              <p className="text-xs font-semibold text-amber-800">ลูกค้าที่มียอดค้างชำระ</p>
              <p className="text-2xl font-extrabold text-amber-600 tabular-nums mt-0.5">
                {formatNumber(debtCustomersCount)}{' '}
                <span className="text-xs font-semibold text-amber-700">ราย</span>
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Users className="h-5 w-5" />
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-rose-200 p-4 flex items-center justify-between shadow-xs">
            <div>
              <p className="text-xs font-semibold text-rose-800">ยอดค้างชำระรวมทั้งร้าน</p>
              <p className="text-2xl font-extrabold text-rose-600 tabular-nums mt-0.5">
                {formatBaht(totalAllDebt)}
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
              <Banknote className="h-5 w-5" />
            </div>
          </div>

          <div
            className={`rounded-2xl border p-4 flex items-center justify-between shadow-xs ${
              overdueCustomersCount > 0
                ? 'bg-red-50/40 border-red-300'
                : 'bg-white border-slate-200'
            }`}
          >
            <div>
              <p
                className={`text-xs font-semibold ${
                  overdueCustomersCount > 0 ? 'text-red-800' : 'text-slate-600'
                }`}
              >
                ยอดหนี้เลยกำหนดชำระ
              </p>
              <p
                className={`text-2xl font-extrabold tabular-nums mt-0.5 ${
                  overdueCustomersCount > 0 ? 'text-red-600' : 'text-slate-700'
                }`}
              >
                {formatBaht(overdueDebtAmount)}
              </p>
              <p className="text-[11px] font-medium text-slate-600 mt-0.5 tabular-nums">
                ลูกหนี้เลยกำหนด:{' '}
                <span
                  className={`font-bold ${
                    overdueCustomersCount > 0 ? 'text-red-700' : 'text-slate-700'
                  }`}
                >
                  {formatNumber(overdueCustomersCount)} ราย
                </span>
              </p>
            </div>
            <div
              className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                overdueCustomersCount > 0
                  ? 'bg-red-100 text-red-600'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              <CalendarClock className="h-5 w-5" />
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-emerald-200 p-4 flex items-center justify-between shadow-xs">
            <div>
              <p className="text-xs font-semibold text-emerald-800">ยอดรับชำระหนี้วันนี้</p>
              <p className="text-2xl font-extrabold text-emerald-600 tabular-nums mt-0.5">
                {formatBaht(todayDebtPaid)}
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-amber-200 p-4 flex items-center justify-between shadow-xs">
            <div>
              <p className="text-xs font-semibold text-amber-900">แต้มสะสมรวมทั้งร้าน</p>
              <p className="text-2xl font-extrabold text-amber-700 tabular-nums mt-0.5">
                {formatNumber(loyaltySummary.totalPoints)}{' '}
                <span className="text-xs font-semibold text-amber-700">แต้ม</span>
              </p>
              <p className="text-[11px] font-medium text-slate-600 mt-0.5 tabular-nums">
                แลกส่วนลดได้ (&ge; 10 แต้ม):{' '}
                <span className="font-bold text-emerald-700">
                  {formatNumber(loyaltySummary.redeemableCustomersCount)} ราย
                </span>
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
              <Award className="h-5 w-5" />
            </div>
          </div>
        </div>

        {/* Credit Health Summary Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white border border-slate-200 px-4 py-2.5 shadow-xs">
          <span className="text-xs font-semibold text-slate-600">
            สรุปลูกหนี้ตามระดับเครดิต ({formatNumber(debtCustomersCount)} รายที่มียอดค้าง):
          </span>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold tabular-nums">
            <button
              type="button"
              onClick={() =>
                setFilterMode((prev) => (prev === 'credit_good' ? 'all' : 'credit_good'))
              }
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 transition ${
                filterMode === 'credit_good'
                  ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              ⭐ เครดิตดี: {formatNumber(creditHealthSummary.good)} ราย
            </button>
            <button
              type="button"
              onClick={() =>
                setFilterMode((prev) => (prev === 'credit_watch' ? 'all' : 'credit_watch'))
              }
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 transition ${
                filterMode === 'credit_watch'
                  ? 'bg-amber-600 border-amber-600 text-white shadow-xs'
                  : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
              }`}
            >
              ⚠️ เฝ้าระวัง: {formatNumber(creditHealthSummary.watch)} ราย
            </button>
            <button
              type="button"
              onClick={() =>
                setFilterMode((prev) => (prev === 'credit_risk' ? 'all' : 'credit_risk'))
              }
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 transition ${
                filterMode === 'credit_risk'
                  ? 'bg-rose-600 border-rose-600 text-white shadow-xs'
                  : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
              }`}
            >
              🚨 เสี่ยง/เกินกำหนด: {formatNumber(creditHealthSummary.risk)} ราย
            </button>
          </div>
        </div>

        {/* Upcoming 7-Day Due Dates Alert Strip */}
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-2.5 shadow-xs ${
            dueSoon7dCustomersCount > 0
              ? 'bg-sky-50/70 border-sky-200'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
            <span className={dueSoon7dCustomersCount > 0 ? 'text-sky-900' : 'text-slate-600'}>
              📅 นัดชำระภายใน 7 วันข้างหน้า ({formatNumber(dueSoon7dCustomersCount)} ราย • ยอดรอรับชำระรวม{' '}
              <span className="font-bold text-sky-700 tabular-nums">
                {formatBaht(dueSoon7dDebtAmount)}
              </span>
              )
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <button
              type="button"
              onClick={() =>
                setFilterMode((prev) => (prev === 'due_soon_7d' ? 'all' : 'due_soon_7d'))
              }
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 transition ${
                filterMode === 'due_soon_7d'
                  ? 'bg-sky-600 border-sky-600 text-white shadow-xs'
                  : 'bg-white border-sky-200 text-sky-700 hover:bg-sky-100'
              }`}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              <span>นัดชำระใน 7 วัน ({formatNumber(dueSoon7dCustomersCount)})</span>
            </button>
            <button
              type="button"
              disabled={dueSoon7dCustomersCount === 0}
              onClick={handleCopyDueSoon7dLine}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              {copiedDueSoon7d ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span>คัดลอกคิวแล้ว</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>คัดลอกคิวนัดชำระ 7 วัน (LINE)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Search, Filter & Sort */}
        <div className="flex flex-wrap items-center gap-3 bg-white p-3.5 rounded-2xl border border-slate-200">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อลูกค้า เบอร์โทร ที่อยู่/จุดสังเกต หรือหมายเหตุ..."
              className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              ทั้งหมด ({customers.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('debt')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'debt'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              <span>เฉพาะมียอดค้างชำระ ({debtCustomersCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('overdue')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'overdue'
                  ? 'bg-red-600 text-white'
                  : 'bg-red-50 text-red-700 hover:bg-red-100'
              }`}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              <span>เลยกำหนดชำระ ({overdueCustomersCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('due_soon_7d')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'due_soon_7d'
                  ? 'bg-sky-600 text-white'
                  : 'bg-sky-50 text-sky-700 hover:bg-sky-100'
              }`}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              <span>นัดชำระใน 7 วัน ({dueSoon7dCustomersCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('stale_debt')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'stale_debt'
                  ? 'bg-orange-600 text-white'
                  : 'bg-orange-50 text-orange-800 hover:bg-orange-100'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>ขาดส่งเกิน 14 วัน ({staleDebtCustomersCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('over_limit')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'over_limit'
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
              }`}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              <span>เกินวงเงิน ({overLimitCustomersCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('has_points')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'has_points'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
              }`}
            >
              <Award className="h-3.5 w-3.5" />
              <span>มีแต้มสะสม ({loyaltySummary.customersWithPointsCount})</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setFilterMode((prev) => (prev === 'has_credit' ? 'all' : 'has_credit'))
              }
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'has_credit'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              <span>💰 มีเงินฝากทอน ({storeCreditSummary.customersWithCreditCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('vip')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'vip'
                  ? 'bg-violet-600 text-white'
                  : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
              }`}
            >
              <Crown className="h-3.5 w-3.5" />
              <span>VIP ลดพิเศษ ({vipCustomersCount})</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setFilterMode((prev) => (prev === 'has_followup' ? 'all' : 'has_followup'))
              }
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'has_followup'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
              }`}
            >
              <History className="h-3.5 w-3.5" />
              <span>มีบันทึกติดตาม ({hasFollowupCustomersCount})</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setFilterMode((prev) => (prev === 'credit_good' ? 'all' : 'credit_good'))
              }
              className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                filterMode === 'credit_good'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              ⭐ เครดิตดี ({creditHealthSummary.good})
            </button>
            <button
              type="button"
              onClick={() =>
                setFilterMode((prev) => (prev === 'credit_watch' ? 'all' : 'credit_watch'))
              }
              className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                filterMode === 'credit_watch'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              ⚠️ เฝ้าระวัง ({creditHealthSummary.watch})
            </button>
            <button
              type="button"
              onClick={() =>
                setFilterMode((prev) => (prev === 'credit_risk' ? 'all' : 'credit_risk'))
              }
              className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                filterMode === 'credit_risk'
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
              }`}
            >
              🚨 เสี่ยง/เกินกำหนด ({creditHealthSummary.risk})
            </button>
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5">
              <span className="text-xs font-semibold text-slate-500 shrink-0">กลุ่ม:</span>
              <select
                aria-label="กรองตามกลุ่มประเภทลูกค้า"
                value={selectedCustomerTag}
                onChange={(e) => setSelectedCustomerTag(e.target.value)}
                className="text-xs font-semibold text-slate-700 bg-transparent focus:outline-none"
              >
                <option value="all">ทุกกลุ่ม ({customers.length})</option>
                {customerTagOptions.list.map((opt) => (
                  <option key={opt.name} value={opt.name}>
                    {opt.name} ({opt.count})
                  </option>
                ))}
                {customerTagOptions.unassignedCount > 0 && (
                  <option value="__none__">
                    ยังไม่ระบุกลุ่ม ({customerTagOptions.unassignedCount})
                  </option>
                )}
              </select>
            </div>
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5">
              <span className="text-xs font-semibold text-slate-500 shrink-0">รอบจ่าย:</span>
              <select
                aria-label="กรองตามรอบจ่ายเงินประจำ"
                value={selectedPaydayCycle}
                onChange={(e) => {
                  setSelectedPaydayCycle(e.target.value);
                  setBulkDueDateNotice('');
                }}
                className="text-xs font-semibold text-slate-700 bg-transparent focus:outline-none"
              >
                <option value="all">ทุกรอบจ่าย ({customers.length})</option>
                {paydayCycleOptions.list.map((opt) => (
                  <option key={opt.name} value={opt.name}>
                    {opt.name} ({opt.count})
                  </option>
                ))}
                {paydayCycleOptions.unassignedCount > 0 && (
                  <option value="__none__">
                    ยังไม่ระบุรอบจ่าย ({paydayCycleOptions.unassignedCount})
                  </option>
                )}
              </select>
            </div>
            {selectedPaydayCycle !== 'all' && selectedPaydayCycle !== '__none__' && (
              <button
                type="button"
                onClick={handleBulkSetDueDateByPaydayCycle}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-800 hover:bg-indigo-100 transition"
              >
                <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                <span>ตั้งวันนัดชำระตามรอบจ่ายให้ลูกหนี้กลุ่มนี้ทั้งหมด</span>
              </button>
            )}
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5">
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              <select
                aria-label="เรียงลำดับลูกค้า"
                value={sortBy}
                onChange={(e) =>
                  setSortBy(
                    e.target.value as
                      | 'debt_desc'
                      | 'debt_asc'
                      | 'name_asc'
                      | 'newest'
                      | 'points_desc'
                      | 'credit_desc'
                  )
                }
                className="text-xs font-semibold text-slate-700 bg-transparent focus:outline-none"
              >
                <option value="debt_desc">ยอดค้างชำระมาก → น้อย</option>
                <option value="debt_asc">ยอดค้างชำระน้อย → มาก</option>
                <option value="points_desc">แต้มสะสมมาก → น้อย</option>
                <option value="credit_desc">เงินฝากทอนมาก → น้อย</option>
                <option value="name_asc">ชื่อ ก → ฮ</option>
                <option value="newest">สร้างล่าสุด</option>
              </select>
            </div>
          </div>
        </div>

        {bulkDueDateNotice && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-900">
            <span>{bulkDueDateNotice}</span>
            <button
              type="button"
              onClick={() => setBulkDueDateNotice('')}
              className="rounded p-0.5 text-indigo-600 hover:bg-indigo-100"
              aria-label="ปิดข้อความแจ้งเตือน"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">กำลังโหลด...</div>
        ) : filteredCustomers.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
            {customers.length === 0
              ? 'ยังไม่มีรายชื่อลูกค้าเงินเชื่อ'
              : filterMode === 'has_points' && !search.trim()
                ? 'ยังไม่มีลูกค้าที่มีแต้มสะสม'
                : filterMode === 'has_credit' && !search.trim()
                  ? 'ยังไม่มีลูกค้าที่มีเงินฝากทอนสะสม'
                  : filterMode === 'overdue' && !search.trim()
                  ? 'ไม่มีลูกหนี้ที่เลยกำหนดชำระ'
                  : filterMode === 'due_soon_7d' && !search.trim()
                    ? 'ไม่มีลูกหนี้ที่มีนัดชำระภายใน 7 วันข้างหน้า'
                    : filterMode === 'stale_debt' && !search.trim()
                    ? 'ไม่มีลูกหนี้ที่ขาดการชำระเกิน 14 วัน'
                    : filterMode === 'vip' && !search.trim()
                      ? 'ยังไม่มีลูกค้าที่กำหนดส่วนลดประจำตัว VIP'
                      : filterMode === 'has_followup' && !search.trim()
                        ? 'ยังไม่มีลูกค้าที่มีบันทึกการติดตาม'
                        : filterMode === 'credit_good' && !search.trim()
                        ? 'ไม่มีลูกหนี้ที่อยู่ในระดับเครดิตดี'
                        : filterMode === 'credit_watch' && !search.trim()
                          ? 'ไม่มีลูกหนี้ที่อยู่ในระดับเฝ้าระวัง'
                          : filterMode === 'credit_risk' && !search.trim()
                            ? 'ไม่มีลูกหนี้ที่อยู่ในระดับเสี่ยง/เกินกำหนด'
                            : 'ไม่พบรายชื่อลูกค้าตามเงื่อนไขที่ค้นหา'}
          </div>
        ) : quickCustomerTableMode ? (
          <div className="bg-white rounded-2xl border border-indigo-200 overflow-hidden shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-50/70 px-4 py-2.5 border-b border-indigo-100">
              <span className="text-xs font-bold text-indigo-900">
                โหมดตารางจัดการลูกหนี้เร็ว ({formatNumber(filteredCustomers.length)} ราย) — แก้ไขวงเงิน, วันนัดชำระ, รอบจ่าย หรือกลุ่มลูกค้าได้ทันที
              </span>
              <button
                type="button"
                onClick={() => setQuickCustomerTableMode(false)}
                className="rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                สลับกลับมุมมองการ์ด
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="px-3 py-2.5">ลูกค้า</th>
                    <th className="px-3 py-2.5 text-right">ยอดค้าง (฿)</th>
                    <th className="px-3 py-2.5">วงเงินเชื่อ (฿)</th>
                    <th className="px-3 py-2.5">วันนัดชำระ</th>
                    <th className="px-3 py-2.5">รอบจ่ายเงินเดือน</th>
                    <th className="px-3 py-2.5">ป้ายกลุ่มลูกค้า</th>
                    <th className="px-3 py-2.5 text-right">จัดการด่วน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCustomers.map((c) => {
                    const debt = Number(c.total_debt) || 0;
                    const creditLimit = creditLimits[c.id];
                    const dueIso = dueDates[c.id] ?? '';
                    const paydayCycle = paydayCycles[c.id] ?? '';
                    const customerTag = customerTags[c.id] ?? '';
                    return (
                      <tr key={c.id} className="cv-auto-row hover:bg-slate-50/80">
                        <td className="px-3 py-2.5 font-semibold text-slate-900">
                          <div>{c.name}</div>
                          {c.phone && (
                            <div className="text-[11px] font-normal text-slate-500">{c.phone}</div>
                          )}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-bold tabular-nums ${
                            debt > 0 ? 'text-amber-700' : 'text-emerald-700'
                          }`}
                        >
                          {formatBaht(debt)}
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            aria-label={`วงเงินเชื่อของ ${c.name}`}
                            defaultValue={creditLimit !== undefined ? String(creditLimit) : ''}
                            placeholder="ไม่จำกัด"
                            onBlur={(e) => saveCustomerCreditLimit(c.id, e.target.value)}
                            className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs tabular-nums focus:border-emerald-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="date"
                            aria-label={`วันนัดชำระของ ${c.name}`}
                            value={dueIso}
                            onChange={(e) => saveCustomerDueDate(c.id, e.target.value)}
                            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs tabular-nums focus:border-emerald-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            aria-label={`รอบจ่ายเงินเดือนของ ${c.name}`}
                            defaultValue={paydayCycle}
                            placeholder="เช่น สิ้นเดือน"
                            onBlur={(e) => saveCustomerPaydayCycle(c.id, e.target.value)}
                            className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            aria-label={`ป้ายกลุ่มของ ${c.name}`}
                            defaultValue={customerTag}
                            placeholder="เช่น ขาประจำ"
                            onBlur={(e) => saveCustomerTag(c.id, e.target.value)}
                            className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {debt > 0 ? (
                            <button
                              type="button"
                              onClick={() => openPayModal(c)}
                              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                            >
                              รับชำระ
                            </button>
                          ) : (
                            <span className="text-[11px] font-semibold text-emerald-700">
                              ✓ ไม่มียอดค้าง
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredCustomers.map((c) => {
              const debt = Number(c.total_debt) || 0;
              const creditLimit = creditLimits[c.id];
              const hasCreditLimit = typeof creditLimit === 'number' && creditLimit > 0;
              const isOverCreditLimit = hasCreditLimit && debt > creditLimit;
              const points = loyaltyPoints[c.id] ?? 0;
              const storeCredit = storeCredits[c.id] ?? 0;
              const vipDiscountPct = defaultDiscounts[c.id] ?? 0;
              const lastRemindedIso = lastRemindedMap[c.id];
              const lastPayment = lastPaymentMap[c.id];
              const dueIso = dueDates[c.id] ?? '';
              const contactNote = contactNotes[c.id] ?? '';
              const paydayCycle = paydayCycles[c.id] ?? '';
              const customerTag = customerTags[c.id] ?? '';
              const dueInfo = getCustomerDueDateInfo(dueIso, todayIso, debt);
              const staleInfo = getCustomerStaleDebtInfo(
                debt,
                lastPayment?.paidAt,
                c.created_at,
                todayIso
              );
              const creditHealth = getCustomerCreditHealth(debt, creditLimit, dueInfo);

              return (
              <div
                key={c.id}
                className={`cv-auto-card rounded-2xl bg-white border p-4 flex flex-col justify-between gap-3 shadow-xs ${
                  isOverCreditLimit
                    ? 'border-rose-300'
                    : debt > 0 && dueInfo?.status === 'overdue'
                      ? 'border-red-300'
                      : debt > 0 && (dueInfo?.status === 'due_today' || staleInfo?.isStale)
                        ? 'border-orange-300'
                        : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="font-bold text-slate-900">{c.name}</h3>
                      {creditHealth && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                            creditHealth.level === 'risk'
                              ? 'bg-rose-100 border-rose-300 text-rose-800'
                              : creditHealth.level === 'watch'
                                ? 'bg-amber-100 border-amber-300 text-amber-900'
                                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          }`}
                          title={creditHealth.detail}
                        >
                          {creditHealth.label}
                        </span>
                      )}
                      {vipDiscountPct > 0 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-violet-100 border border-violet-300 px-2 py-0.5 text-[11px] font-bold text-violet-800 tabular-nums"
                          title="ส่วนลดประจำตัวลูกค้า VIP"
                        >
                          <Crown className="h-3 w-3 shrink-0" />
                          <span>VIP ลด {formatNumber(vipDiscountPct)}%</span>
                        </span>
                      )}
                      {isOverCreditLimit && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 border border-rose-200 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                          <AlertCircle className="h-3 w-3" />
                          เกินวงเงิน
                        </span>
                      )}
                      {Number(c.total_debt) > 0 && dueInfo && (
                        dueInfo.status === 'overdue' ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-red-100 border border-red-300 px-2 py-0.5 text-[11px] font-bold text-red-700"
                            title={`วันนัดชำระหนี้: ${dueInfo.formattedDate}`}
                          >
                            <CalendarClock className="h-3 w-3 shrink-0" />
                            <span>
                              เลยกำหนดชำระ ({Math.abs(dueInfo.daysDiff)} วัน)
                            </span>
                          </span>
                        ) : dueInfo.status === 'due_today' ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-orange-100 border border-orange-300 px-2 py-0.5 text-[11px] font-bold text-orange-800"
                            title={`วันนัดชำระหนี้: ${dueInfo.formattedDate}`}
                          >
                            <CalendarClock className="h-3 w-3 shrink-0" />
                            <span>ครบกำหนดวันนี้</span>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[11px] font-semibold text-sky-800"
                            title={`วันนัดชำระหนี้: ${dueInfo.formattedDate}`}
                          >
                            <CalendarClock className="h-3 w-3 shrink-0" />
                            <span>นัดชำระ {dueInfo.formattedDate}</span>
                          </span>
                        )
                      )}
                      {staleInfo?.isStale && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-orange-100 border border-orange-300 px-2 py-0.5 text-[11px] font-bold text-orange-800 tabular-nums"
                          title={
                            staleInfo.hasPaidBefore
                              ? `ขาดการชำระหนี้มาแล้ว ${staleInfo.daysSinceLastPayment} วัน (ชำระล่าสุด: ${formatDateTime(staleInfo.referenceIso)})`
                              : `ยังไม่เคยมีประวัติชำระหนี้ตั้งแต่สร้างข้อมูล (${staleInfo.daysSinceLastPayment} วัน)`
                          }
                        >
                          <Clock className="h-3 w-3 shrink-0" />
                          <span>ขาดส่ง {staleInfo.daysSinceLastPayment} วัน</span>
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                          points > 0
                            ? 'bg-amber-50 border-amber-200 text-amber-800'
                            : 'bg-slate-50 border-slate-200 text-slate-500'
                        }`}
                        title="แต้มสะสมของลูกค้า"
                      >
                        🏆 {formatNumber(points)} แต้ม
                      </span>
                      {points >= 10 && (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-bold text-emerald-700 tabular-nums">
                          แลกส่วนลดได้ {formatBaht(Math.floor(points / 10))}
                        </span>
                      )}
                      {storeCredit > 0 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-bold text-emerald-800 tabular-nums"
                          title="ยอดเงินฝากทอนสะสมของลูกค้า"
                        >
                          💰 เงินฝากทอน: {formatBaht(storeCredit)}
                        </span>
                      )}
                    </div>
                    {c.phone && c.phone.trim() && (
                      <a
                        href={`tel:${c.phone.replace(/[^\d+]/g, '') || c.phone.trim()}`}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                        title={`โทรหา ${c.name}`}
                      >
                        <Phone className="h-3 w-3 shrink-0" />
                        <span>{c.phone}</span>
                      </a>
                    )}
                    {contactNote && (
                      <div className="mt-1">
                        <span
                          className="inline-flex max-w-full items-start gap-1 rounded-md bg-teal-50 border border-teal-200 px-2 py-0.5 text-[11px] font-medium text-teal-800"
                          title={`ที่อยู่ / ช่องทางติดต่อ: ${contactNote}`}
                        >
                          <MapPin className="h-3 w-3 shrink-0 mt-0.5 text-teal-600" />
                          <span className="break-words">{contactNote}</span>
                        </span>
                      </div>
                    )}
                    {customerTag && (
                      <div className="mt-1">
                        <span
                          className="inline-flex max-w-full items-center gap-1 rounded-md bg-fuchsia-50 border border-fuchsia-200 px-2 py-0.5 text-[11px] font-semibold text-fuchsia-800"
                          title={`กลุ่มประเภทลูกค้า: ${customerTag}`}
                        >
                          <span>{customerTag}</span>
                        </span>
                      </div>
                    )}
                    {paydayCycle && (
                      <div className="mt-1">
                        <span
                          className="inline-flex max-w-full items-center gap-1 rounded-md bg-sky-50 border border-sky-200 px-2 py-0.5 text-[11px] font-semibold text-sky-800"
                          title={`รอบจ่ายเงินประจำ: ${paydayCycle}`}
                        >
                          <span>🗓️ รอบจ่าย: {paydayCycle}</span>
                        </span>
                      </div>
                    )}
                    {c.note && <p className="text-xs text-slate-500 mt-0.5">{c.note}</p>}
                    {hasCreditLimit && (
                      <p
                        className={`text-[11px] mt-0.5 font-medium ${
                          isOverCreditLimit ? 'text-rose-600' : 'text-slate-500'
                        }`}
                      >
                        วงเงินเชื่อสูงสุด: {formatBaht(creditLimit)}
                      </p>
                    )}
                    {lastRemindedIso && (
                      <p className="inline-flex items-center gap-1 mt-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span>แจ้งยอดล่าสุด: {formatDateTime(lastRemindedIso)}</span>
                      </p>
                    )}
                    {(() => {
                      const latestFollowup = (followupLogs[c.id] ?? [])[0];
                      if (!latestFollowup) return null;
                      return (
                        <div className="mt-1">
                          <span
                            className="inline-flex max-w-full items-start gap-1 rounded-md bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[11px] font-medium text-indigo-800"
                            title={`ติดตามล่าสุดเมื่อ ${formatDateTime(latestFollowup.createdAt)}`}
                          >
                            <History className="h-3 w-3 shrink-0 mt-0.5 text-indigo-600" />
                            <span className="break-words">
                              ติดตามล่าสุด: {latestFollowup.text} (
                              {formatDateTime(latestFollowup.createdAt)})
                            </span>
                          </span>
                        </div>
                      );
                    })()}
                    {debt > 0 && (
                      <div className="mt-1">
                        {lastPayment ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium text-emerald-800 tabular-nums"
                            title={`ชำระหนี้ครั้งล่าสุดเมื่อ ${formatDateTime(lastPayment.paidAt)} จำนวน ${formatBaht(lastPayment.amount)}`}
                          >
                            <Banknote className="h-3 w-3 shrink-0 text-emerald-600" />
                            <span>
                              ชำระล่าสุด: {formatDateTime(lastPayment.paidAt)} (฿
                              {formatNumber(lastPayment.amount)})
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                            <History className="h-3 w-3 shrink-0 text-slate-500" />
                            <span>ยังไม่เคยมีประวัติชำระหนี้</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500 block">ยอดค้างชำระ</span>
                    <span
                      className={`text-lg font-extrabold tabular-nums ${
                        isOverCreditLimit
                          ? 'text-rose-600'
                          : c.total_debt > 0
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                      }`}
                    >
                      {formatBaht(c.total_debt)}
                    </span>
                  </div>
                </div>

                {Number(c.total_debt) > 0 && (
                  <div
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                      dueInfo?.status === 'overdue'
                        ? 'bg-red-50/70 border-red-200'
                        : dueInfo?.status === 'due_today'
                          ? 'bg-orange-50/70 border-orange-200'
                          : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                      <CalendarClock className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                      <span>วันนัดชำระหนี้:</span>
                      {dueInfo ? (
                        <span
                          className={
                            dueInfo.status === 'overdue'
                              ? 'text-red-700 font-bold'
                              : dueInfo.status === 'due_today'
                                ? 'text-orange-700 font-bold'
                                : 'text-slate-800'
                          }
                        >
                          {dueInfo.formattedDate}
                        </span>
                      ) : (
                        <span className="text-slate-500 font-normal">ยังไม่ระบุ</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        aria-label={`วันนัดชำระหนี้ของ ${c.name}`}
                        value={dueIso}
                        onChange={(e) => saveCustomerDueDate(c.id, e.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 tabular-nums"
                      />
                      {dueIso && (
                        <button
                          type="button"
                          onClick={() => saveCustomerDueDate(c.id, '')}
                          title="ล้างวันนัดชำระหนี้"
                          className="inline-flex items-center gap-0.5 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                        >
                          <X className="h-3 w-3" />
                          <span>ล้าง</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => openEditCustomer(c)}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>แก้ไข</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openHistory(c)}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                  >
                    <Receipt className="h-3.5 w-3.5" />
                    <span>ประวัติบิล / ชำระหนี้</span>
                  </button>
                  {c.total_debt > 0 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleCopyDebtReminder(c, `card-${c.id}`)}
                        title="คัดลอกข้อความแจ้งยอดค้างชำระสำหรับส่ง LINE"
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                          copiedReminderKey === `card-${c.id}`
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                        }`}
                      >
                        {copiedReminderKey === `card-${c.id}` ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>คัดลอกแล้ว</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>คัดลอกสรุปยอด</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQuickFollowupCustomerId((prev) => (prev === c.id ? null : c.id));
                          setQuickFollowupInput('');
                        }}
                        title="จดบันทึกติดตามหนี้ด่วน"
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                          quickFollowupCustomerId === c.id
                            ? 'bg-indigo-600 text-white'
                            : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                        }`}
                      >
                        <span>+ จดติดตาม</span>
                        {(followupLogs[c.id]?.length ?? 0) > 0 && (
                          <span
                            className={`rounded-full px-1.5 py-0.2 text-[11px] font-bold tabular-nums ${
                              quickFollowupCustomerId === c.id
                                ? 'bg-indigo-500 text-white'
                                : 'bg-indigo-100 text-indigo-800'
                            }`}
                          >
                            {followupLogs[c.id].length}
                          </span>
                        )}
                      </button>
                      {Number(c.total_debt) > 0 && (storeCredits[c.id] || 0) > 0 && (
                        <button
                          type="button"
                          disabled={applyingStoreCreditDebt}
                          onClick={() => handleApplyStoreCreditToDebt(c)}
                          title="หักยอดเงินฝากทอนมาชำระหนี้ค้างทันที"
                          className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                        >
                          <span>
                            {applyingStoreCreditDebt
                              ? 'กำลังหักเงินฝาก...'
                              : `⚡ หักเงินฝากล้างหนี้ (${formatBaht(
                                  Math.round(
                                    Math.min(
                                      storeCredits[c.id] || 0,
                                      Number(c.total_debt) || 0
                                    ) * 100
                                  ) / 100
                                )})`}
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openPayModal(c)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        <Banknote className="h-3.5 w-3.5" />
                        <span>รับชำระหนี้</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 px-2">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        ไม่มียอดค้าง
                      </span>
                      {Number(c.total_debt) === 0 && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteCustomer(c)}
                          title="ลบรายชื่อลูกค้าที่ไม่มีหนี้ค้าง"
                          className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>ลบรายชื่อ</span>
                        </button>
                      )}
                    </>
                  )}
                </div>

                {c.total_debt > 0 && quickFollowupCustomerId === c.id && (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-indigo-900">
                        จดติดตามหนี้ด่วน ({c.name})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setQuickFollowupCustomerId(null);
                          setQuickFollowupInput('');
                        }}
                        className="rounded p-0.5 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-800"
                        aria-label="ปิดหน้าต่างจดติดตามด่วน"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {FOLLOWUP_QUICK_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            handleAddFollowupLog(c.id, preset);
                            setQuickFollowupCustomerId(null);
                            setQuickFollowupInput('');
                          }}
                          className="rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-semibold text-indigo-800 hover:bg-indigo-100 transition"
                        >
                          + {preset}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={quickFollowupInput}
                        onChange={(e) => setQuickFollowupInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (!quickFollowupInput.trim()) return;
                            handleAddFollowupLog(c.id, quickFollowupInput);
                            setQuickFollowupInput('');
                            setQuickFollowupCustomerId(null);
                          }
                        }}
                        placeholder="พิมพ์บันทึกติดตามเพิ่มเติม..."
                        className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={!quickFollowupInput.trim()}
                        onClick={() => {
                          handleAddFollowupLog(c.id, quickFollowupInput);
                          setQuickFollowupInput('');
                          setQuickFollowupCustomerId(null);
                        }}
                        className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
                      >
                        บันทึก
                      </button>
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Customer Modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="เพิ่มลูกค้าประจำ / เงินเชื่อ"
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={handleAddCustomer} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              ชื่อลูกค้า *
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              เบอร์โทร
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              หมายเหตุ
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น บ้านหลังสีฟ้า"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <ContactNoteField
            inputId="add-customer-contact-note"
            value={contactNoteInput}
            onChange={setContactNoteInput}
          />
          <PaydayCycleField
            inputId="add-customer-payday-cycle"
            value={paydayCycleInput}
            onChange={setPaydayCycleInput}
          />
          <CustomerTagField
            inputId="add-customer-tag"
            value={customerTagInput}
            onChange={setCustomerTagInput}
          />
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              วงเงินเชื่อสูงสุด (บาท, ไม่บังคับ)
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={creditLimitInput}
              onChange={(e) => setCreditLimitInput(e.target.value)}
              placeholder="ไม่จำกัดวงเงิน"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-xs font-semibold text-slate-700">
                แต้มสะสมเริ่มต้น (แต้ม, ไม่บังคับ)
              </label>
              <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-800 tabular-nums">
                🏆 {formatNumber(Math.max(0, Math.floor(Number(loyaltyPointsInput) || 0)))} แต้ม
              </span>
            </div>
            <input
              type="number"
              min="0"
              step="1"
              value={loyaltyPointsInput}
              onChange={(e) => setLoyaltyPointsInput(e.target.value)}
              placeholder="0"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
            />
          </div>
          <VipDiscountField
            inputId="add-customer-vip-discount"
            value={discountPctInput}
            onChange={setDiscountPctInput}
          />
          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
          >
            บันทึกข้อมูลลูกค้า
          </button>
        </form>
      </Modal>

      {/* Edit Customer Modal */}
      <Modal
        open={!!editingCustomer}
        onClose={() => !editSaving && setEditingCustomer(null)}
        title={`แก้ไขข้อมูลลูกค้า: ${editingCustomer?.name ?? ''}`}
        maxWidthClass="max-w-sm"
      >
        {editingCustomer && (
          <form onSubmit={handleEditCustomer} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ชื่อลูกค้า *
              </label>
              <input
                type="text"
                required
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                เบอร์โทร
              </label>
              <input
                type="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                หมายเหตุ
              </label>
              <input
                type="text"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="เช่น บ้านหลังสีฟ้า"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <ContactNoteField
              inputId="edit-customer-contact-note"
              value={editContactNoteInput}
              onChange={setEditContactNoteInput}
            />
            <PaydayCycleField
              inputId="edit-customer-payday-cycle"
              value={editPaydayCycleInput}
              onChange={setEditPaydayCycleInput}
            />
            <CustomerTagField
              inputId="edit-customer-tag"
              value={editCustomerTagInput}
              onChange={setEditCustomerTagInput}
            />
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                วงเงินเชื่อสูงสุด (บาท, ไม่บังคับ)
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={editCreditLimitInput}
                onChange={(e) => setEditCreditLimitInput(e.target.value)}
                placeholder="ไม่จำกัดวงเงิน"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="rounded-xl bg-amber-50/70 border border-amber-200 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs font-semibold text-amber-900">
                  แต้มสะสมลูกค้า (แต้ม)
                </label>
                <span className="inline-flex items-center rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[11px] font-extrabold text-amber-900 tabular-nums">
                  🏆 {formatNumber(Math.max(0, Math.floor(Number(editLoyaltyPointsInput) || 0)))} แต้ม
                </span>
              </div>
              <input
                type="number"
                min="0"
                step="1"
                value={editLoyaltyPointsInput}
                onChange={(e) => setEditLoyaltyPointsInput(e.target.value)}
                placeholder="0"
                className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-bold tabular-nums"
              />
              <div className="flex flex-wrap items-center gap-1">
                {[-10, -1, 1, 10, 50].map((delta) => {
                  const currentVal = Math.max(0, Math.floor(Number(editLoyaltyPointsInput) || 0));
                  return (
                    <button
                      key={delta}
                      type="button"
                      disabled={delta < 0 && currentVal <= 0}
                      onClick={() =>
                        setEditLoyaltyPointsInput(String(Math.max(0, currentVal + delta)))
                      }
                      className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11px] font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-40 tabular-nums"
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={Math.max(0, Math.floor(Number(editLoyaltyPointsInput) || 0)) === 0}
                  onClick={() => setEditLoyaltyPointsInput('0')}
                  className="ml-auto rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  ล้างเป็น 0
                </button>
              </div>
            </div>
            <VipDiscountField
              inputId="edit-customer-vip-discount"
              value={editDiscountPctInput}
              onChange={setEditDiscountPctInput}
            />
            <DueDateField
              inputId="edit-customer-due-date"
              value={editDueDateInput}
              todayIso={todayIso}
              totalDebt={Number(editingCustomer.total_debt)}
              paydayCycle={editPaydayCycleInput.trim() || paydayCycles[editingCustomer.id] || ''}
              onChange={setEditDueDateInput}
            />
            <button
              type="submit"
              disabled={editSaving}
              className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {editSaving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
            </button>
          </form>
        )}
      </Modal>

      {/* Pay Debt Modal */}
      <Modal
        open={!!payCustomer}
        onClose={() => setPayCustomer(null)}
        title={`รับชำระหนี้: ${payCustomer?.name ?? ''}`}
        maxWidthClass="max-w-md"
      >
        {payCustomer && (() => {
          const totalDebt = Math.max(0, Number(payCustomer.total_debt) || 0);
          const calcPctAmount = (pct: number) =>
            totalDebt > 0
              ? Math.min(totalDebt, Math.max(0.01, Math.round(totalDebt * pct * 100) / 100))
              : 0;
          const split25 = calcPctAmount(0.25);
          const split50 = calcPctAmount(0.5);
          const split75 = calcPctAmount(0.75);
          const oddRemainder = (Math.round(totalDebt * 100) % 10000) / 100;
          const canPayOddBaht = oddRemainder > 0 && oddRemainder < totalDebt;
          const roundedRemaining = canPayOddBaht
            ? Math.max(0, Math.round((totalDebt - oddRemainder) * 100) / 100)
            : totalDebt;
          const parsedPayAmt = Number(payAmount);
          const parsedWaiveAmt = Math.max(0, Number(payWaiveAmount) || 0);
          const hasValidPayAmt =
            payAmount.trim() !== '' &&
            Number.isFinite(parsedPayAmt) &&
            parsedPayAmt > 0 &&
            parsedPayAmt <= totalDebt;
          const remainingAfterPay = hasValidPayAmt
            ? Math.max(0, Math.round((totalDebt - parsedPayAmt) * 100) / 100)
            : 0;
          const totalReduction =
            hasValidPayAmt ? Math.round((parsedPayAmt + parsedWaiveAmt) * 100) / 100 : 0;
          const isOverReduction = hasValidPayAmt && totalReduction > totalDebt + 0.001;
          const hasValidPreview = hasValidPayAmt && !isOverReduction;
          const previewRemaining = hasValidPreview
            ? Math.max(0, Math.round((totalDebt - totalReduction) * 100) / 100)
            : null;

          return (
          <form onSubmit={handlePayDebt} className="space-y-4">
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex justify-between items-center">
              <span className="text-xs font-medium text-amber-800">ยอดค้างปัจจุบัน</span>
              <span className="text-lg font-extrabold text-amber-700 tabular-nums">
                {formatBaht(payCustomer.total_debt)}
              </span>
            </div>
            {(storeCredits[payCustomer.id] ?? 0) > 0 && totalDebt > 0 && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-900">
                    💰 เงินฝากทอนสะสมของลูกค้า
                  </span>
                  <span className="font-extrabold text-emerald-700 tabular-nums">
                    {formatBaht(storeCredits[payCustomer.id] ?? 0)}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={applyingStoreCreditDebt}
                  onClick={() => handleApplyStoreCreditToDebt(payCustomer)}
                  className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 shadow-xs"
                >
                  {applyingStoreCreditDebt
                    ? 'กำลังหักเงินฝากทอน...'
                    : `นำเงินฝากทอน (${formatBaht(
                        Math.min(storeCredits[payCustomer.id] ?? 0, totalDebt)
                      )}) ไปหักชำระหนี้ค้างทันที`}
                </button>
              </div>
            )}
            {contactNotes[payCustomer.id] && (
              <div className="flex items-start gap-1.5 rounded-xl bg-teal-50 border border-teal-200 px-3 py-2 text-xs font-medium text-teal-800">
                <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5 text-teal-600" />
                <span className="break-words">
                  ที่อยู่ / ช่องทางติดต่อ: {contactNotes[payCustomer.id]}
                </span>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  จำนวนเงินที่จ่าย (บาท)
                </label>
                <button
                  type="button"
                  onClick={() => setPayAmount(String(payCustomer.total_debt))}
                  className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs"
                >
                  จ่ายเต็มยอด ({formatBaht(payCustomer.total_debt)})
                </button>
              </div>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={payCustomer.total_debt}
                required
                autoFocus
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-lg font-bold tabular-nums"
              />
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {[
                  { label: 'จ่ายทั้งหมด', value: payCustomer.total_debt },
                  { label: '100฿', value: Math.min(100, payCustomer.total_debt) },
                  { label: '500฿', value: Math.min(500, payCustomer.total_debt) },
                  { label: '1,000฿', value: Math.min(1000, payCustomer.total_debt) },
                ].map((preset) => {
                  const isActive =
                    payAmount.trim() !== '' && Math.abs(parsedPayAmt - preset.value) < 0.001;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setPayAmount(String(preset.value))}
                      className={`rounded-lg border py-1.5 text-xs font-semibold transition ${
                        isActive
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2.5 space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-500">
                  แบ่งจ่ายตามสัดส่วน / จ่ายเฉพาะเศษบาท
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { label: 'จ่าย 25%', value: split25 },
                    { label: 'จ่าย 50%', value: split50 },
                    { label: 'จ่าย 75%', value: split75 },
                  ].map((item) => {
                    const isActive =
                      payAmount.trim() !== '' && Math.abs(parsedPayAmt - item.value) < 0.001;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        disabled={totalDebt <= 0}
                        onClick={() => setPayAmount(String(item.value))}
                        className={`rounded-lg border px-2.5 py-1.5 text-left transition disabled:opacity-40 disabled:cursor-not-allowed ${
                          isActive
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 text-xs font-bold">
                          <span>{item.label}</span>
                          <span className="tabular-nums text-[11px] font-semibold opacity-85">
                            {formatBaht(item.value)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    disabled={!canPayOddBaht}
                    onClick={() => {
                      if (!canPayOddBaht) return;
                      setPayAmount(String(oddRemainder));
                    }}
                    title={
                      canPayOddBaht
                        ? `จ่ายเฉพาะเศษ ${formatBaht(oddRemainder)} เพื่อให้เหลือหนี้ ${formatBaht(roundedRemaining)}`
                        : 'ยอดหนี้ลงท้ายด้วย 00 แล้ว หรือไม่มียอดเศษให้ตัด'
                    }
                    className={`rounded-lg border px-2.5 py-1.5 text-left transition disabled:opacity-40 disabled:cursor-not-allowed ${
                      canPayOddBaht &&
                      payAmount.trim() !== '' &&
                      Math.abs(parsedPayAmt - oddRemainder) < 0.001
                        ? 'border-violet-600 bg-violet-50 text-violet-800'
                        : 'border-violet-200 bg-violet-50/50 text-violet-800 hover:border-violet-300 hover:bg-violet-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 text-xs font-bold">
                      <span>จ่ายเฉพาะเศษบาท</span>
                      <span className="tabular-nums text-[11px] font-semibold">
                        {canPayOddBaht ? formatBaht(oddRemainder) : 'ไม่มีเศษ'}
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              {previewRemaining !== null && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs tabular-nums space-y-1">
                  {parsedWaiveAmt > 0 && (
                    <div className="flex items-center justify-between text-[11px] text-emerald-700">
                      <span>จ่ายจริง + ยกเว้นเศษหนี้</span>
                      <span className="font-semibold">
                        {formatBaht(parsedPayAmt)} + {formatBaht(parsedWaiveAmt)} ={' '}
                        {formatBaht(totalReduction)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">ยอดหนี้คงเหลือหลังจ่าย</span>
                    <span
                      className={`font-bold ${
                        previewRemaining === 0 ? 'text-emerald-600' : 'text-amber-700'
                      }`}
                    >
                      {previewRemaining === 0
                        ? '0 ฿ (ปิดยอดหนี้)'
                        : formatBaht(previewRemaining)}
                    </span>
                  </div>
                </div>
              )}
              {isOverReduction && (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
                  ยอดรับชำระรวมกับยอดยกเว้นเศษหนี้ ({formatBaht(totalReduction)}) เกินยอดค้างปัจจุบัน (
                  {formatBaht(totalDebt)})
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  ลดหนี้ / ยกเว้นเศษหนี้ให้ (บาท, ไม่บังคับ)
                </label>
                <button
                  type="button"
                  disabled={!hasValidPayAmt || remainingAfterPay <= 0}
                  onClick={() => {
                    if (!hasValidPayAmt || remainingAfterPay <= 0) return;
                    setPayWaiveAmount(String(remainingAfterPay));
                  }}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ยกเว้นเศษหนี้ส่วนที่เหลือ
                  {hasValidPayAmt && remainingAfterPay > 0
                    ? ` (${formatBaht(remainingAfterPay)})`
                    : ''}
                </button>
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                max={hasValidPayAmt ? remainingAfterPay : totalDebt}
                value={payWaiveAmount}
                onChange={(e) => setPayWaiveAmount(e.target.value)}
                placeholder="0.00 (ไม่บังคับ)"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold tabular-nums"
              />
            </div>
            {renderInstallmentPlanHelper(payCustomer, 'pay')}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPayMethod('cash')}
                className={`rounded-xl border py-2.5 text-xs font-bold ${
                  payMethod === 'cash'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                เงินสด
              </button>
              <button
                type="button"
                onClick={() => setPayMethod('qr')}
                className={`rounded-xl border py-2.5 text-xs font-bold ${
                  payMethod === 'qr'
                    ? 'border-sky-600 bg-sky-50 text-sky-700'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                โอน / QR
              </button>
            </div>
            {payMethod === 'qr' && (
              <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3 text-center space-y-2">
                {payQrDataUrl ? (
                  <>
                    <img
                      src={payQrDataUrl}
                      alt="PromptPay QR Code"
                      className="w-44 h-44 mx-auto rounded-xl border border-slate-200 p-2 bg-white"
                    />
                    <p className="text-xs font-semibold text-sky-700 tabular-nums">
                      ยอดสแกนชำระ: {formatBaht(Number(payAmount) || 0)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      พร้อมเพย์: {settings?.promptpay_id?.trim()}
                    </p>
                  </>
                ) : !settings?.promptpay_id?.trim() ? (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    ยังไม่ได้ตั้งค่าเบอร์/เลข PromptPay กรุณาไปตั้งค่าที่หน้า &quot;สรุปยอด &amp; ตั้งค่า&quot;
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    กรุณาระบุยอดเงินที่ต้องการรับชำระเพื่อสร้าง QR Code
                  </p>
                )}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                หมายเหตุ (ถ้ามี)
              </label>
              <input
                type="text"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="เช่น โอนเข้าบัญชีร้าน, จ่ายบางส่วน"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700"
            >
              ยืนยันรับชำระหนี้
            </button>
          </form>
          );
        })()}
      </Modal>

      {/* Debt Payment Receipt Modal */}
      <Modal
        open={!!payReceipt}
        onClose={() => setPayReceipt(null)}
        title="บันทึกการรับชำระหนี้สำเร็จ"
      >
        {payReceipt && (
          <div className="space-y-4">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-center space-y-1">
              <CheckCircle2 className="h-9 w-9 text-emerald-600 mx-auto" />
              <p className="text-sm font-bold text-emerald-900">
                รับชำระหนี้จาก คุณ{payReceipt.customerName} เรียบร้อยแล้ว
              </p>
              <p className="text-xs text-emerald-700">{payReceipt.paidAt}</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">ชื่อลูกค้า</span>
                <span className="font-bold text-slate-900">{payReceipt.customerName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">ยอดที่จ่าย</span>
                <span className="font-extrabold text-emerald-600 tabular-nums">
                  {formatBaht(payReceipt.amountPaid)}
                </span>
              </div>
              {payReceipt.waivedAmount && payReceipt.waivedAmount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">ยกเว้น/ลดเศษหนี้ให้</span>
                  <span className="font-bold text-amber-700 tabular-nums">
                    {formatBaht(payReceipt.waivedAmount)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-slate-600">ช่องทางชำระ</span>
                <span
                  className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${
                    payReceipt.paymentMethod === 'qr'
                      ? 'bg-sky-100 text-sky-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {payReceipt.paymentMethod === 'qr' ? 'โอน / QR' : 'เงินสด'}
                </span>
              </div>
              <div className="border-t border-slate-200 pt-2 flex items-center justify-between">
                <span className="text-slate-600 font-semibold">ยอดหนี้คงเหลือล่าสุด</span>
                <span
                  className={`text-base font-extrabold tabular-nums ${
                    payReceipt.remainingDebt > 0 ? 'text-amber-700' : 'text-emerald-600'
                  }`}
                >
                  {formatBaht(payReceipt.remainingDebt)}
                </span>
              </div>
              {payReceipt.note && (
                <div className="text-xs text-slate-500 pt-1">
                  หมายเหตุ: {payReceipt.note}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handlePrintPayReceipt}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-2.5 px-4 text-sm font-bold text-slate-800 hover:bg-slate-50"
              >
                <Printer className="h-4 w-4" />
                <span>พิมพ์ใบเสร็จ</span>
              </button>
              <button
                type="button"
                onClick={handlePrintCompactPayReceipt}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-300 bg-indigo-50 py-2.5 px-4 text-sm font-bold text-indigo-800 hover:bg-indigo-100"
              >
                <Printer className="h-4 w-4" />
                <span>พิมพ์สลิป 80mm</span>
              </button>
              <button
                type="button"
                onClick={handleCopyPayReceipt}
                className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl py-2.5 px-4 text-sm font-bold transition ${
                  copiedPayReceipt
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                {copiedPayReceipt ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>คัดลอกใบเสร็จแล้ว!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>คัดลอกใบเสร็จส่ง LINE</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setPayReceipt(null)}
                className="rounded-xl border border-slate-300 bg-white py-2.5 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                ปิด
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Customer Bill & Debt Payment History Modal */}
      <Modal
        open={!!historyCustomer}
        onClose={() => setHistoryCustomer(null)}
        title={`ประวัติบิลและการชำระหนี้: ${historyCustomer?.name ?? ''}`}
        maxWidthClass="max-w-lg"
      >
        {historyCustomer && (
          <div className="space-y-4">
            {/* Summary Banner */}
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 border border-slate-200 p-3 text-center">
              <div>
                <span className="block text-[11px] text-slate-500">ยอดค้างปัจจุบัน</span>
                <span
                  className={`text-sm font-extrabold tabular-nums ${
                    historyCustomer.total_debt > 0 ? 'text-amber-700' : 'text-emerald-600'
                  }`}
                >
                  {formatBaht(historyCustomer.total_debt)}
                </span>
              </div>
              <div className="border-x border-slate-200 px-2">
                <span className="block text-[11px] text-slate-500">บิลที่ติดไว้ (ล่าสุด)</span>
                <span className="text-sm font-bold text-slate-800 tabular-nums">
                  {formatBaht(
                    customerSales.reduce((sum, s) => sum + Number(s.total_amount || 0), 0)
                  )}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-slate-500">ชำระคืนแล้ว (ล่าสุด)</span>
                <span className="text-sm font-bold text-emerald-600 tabular-nums">
                  {formatBaht(
                    customerPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
                  )}
                </span>
              </div>
            </div>

            {(contactNotes[historyCustomer.id] ||
              paydayCycles[historyCustomer.id] ||
              customerTags[historyCustomer.id] ||
              historyCustomer.phone?.trim() ||
              historyCustomer.note?.trim()) && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs">
                {historyCustomer.phone?.trim() && (
                  <a
                    href={`tel:${historyCustomer.phone.replace(/[^\d+]/g, '') || historyCustomer.phone.trim()}`}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-semibold text-emerald-800 hover:bg-emerald-100"
                  >
                    <Phone className="h-3 w-3 shrink-0" />
                    <span>{historyCustomer.phone}</span>
                  </a>
                )}
                {contactNotes[historyCustomer.id] && (
                  <span className="inline-flex items-start gap-1 rounded-md bg-teal-50 border border-teal-200 px-2 py-0.5 font-semibold text-teal-800">
                    <MapPin className="h-3 w-3 shrink-0 mt-0.5 text-teal-600" />
                    <span className="break-words">
                      ที่อยู่ / ช่องทางติดต่อ: {contactNotes[historyCustomer.id]}
                    </span>
                  </span>
                )}
                {paydayCycles[historyCustomer.id] && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 border border-sky-200 px-2 py-0.5 font-semibold text-sky-800">
                    <span>🗓️ รอบจ่าย: {paydayCycles[historyCustomer.id]}</span>
                  </span>
                )}
                {customerTags[historyCustomer.id] && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-fuchsia-50 border border-fuchsia-200 px-2 py-0.5 font-semibold text-fuchsia-800">
                    <span>{customerTags[historyCustomer.id]}</span>
                  </span>
                )}
                {historyCustomer.note?.trim() && (
                  <span className="text-slate-500">หมายเหตุ: {historyCustomer.note}</span>
                )}
              </div>
            )}

            {/* Loyalty Points Banner & Quick Adjust */}
            <div className="rounded-2xl bg-amber-50/70 border border-amber-200 px-3.5 py-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-xs font-extrabold text-amber-900 tabular-nums">
                    🏆 {formatNumber(loyaltyPoints[historyCustomer.id] ?? 0)} แต้ม
                  </span>
                  <span className="text-xs font-medium text-amber-800">แต้มสะสมปัจจุบัน</span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {[-10, -1, 1, 10, 50].map((delta) => {
                    const currentPts = loyaltyPoints[historyCustomer.id] ?? 0;
                    return (
                      <button
                        key={delta}
                        type="button"
                        disabled={delta < 0 && currentPts <= 0}
                        onClick={() => {
                          const nextPts = Math.max(0, currentPts + delta);
                          saveCustomerLoyaltyPoints(historyCustomer.id, nextPts);
                          setHistoryPointsInput(String(nextPts));
                        }}
                        className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11px] font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-40 tabular-nums"
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold text-amber-900 shrink-0">
                  กำหนดแต้มเอง:
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={historyPointsInput}
                  onChange={(e) => setHistoryPointsInput(e.target.value)}
                  className="w-24 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-bold tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => {
                    const nextPts = Math.max(0, Math.floor(Number(historyPointsInput) || 0));
                    saveCustomerLoyaltyPoints(historyCustomer.id, nextPts);
                    setHistoryPointsInput(String(nextPts));
                  }}
                  className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700"
                >
                  บันทึกแต้ม
                </button>
              </div>
            </div>

            {/* Store Credit Banner & Quick Adjust / Offset Debt */}
            {(() => {
              const currentCredit = storeCredits[historyCustomer.id] ?? 0;
              const currentDebt = Math.max(0, Number(historyCustomer.total_debt) || 0);
              const offsetAmount = Math.round(Math.min(currentCredit, currentDebt) * 100) / 100;
              return (
                <div className="rounded-2xl bg-emerald-50/70 border border-emerald-200 px-3.5 py-2.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 text-xs font-extrabold text-emerald-900 tabular-nums">
                        💰 เงินฝากทอน: {formatBaht(currentCredit)}
                      </span>
                      <span className="text-xs font-medium text-emerald-800">สมุดเงินฝากทอนลูกค้า</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {[-50, -10, 10, 50, 100].map((delta) => (
                        <button
                          key={delta}
                          type="button"
                          disabled={delta < 0 && currentCredit <= 0}
                          onClick={() => {
                            const nextCredit = Math.max(
                              0,
                              Math.round((currentCredit + delta) * 100) / 100
                            );
                            saveCustomerStoreCredit(historyCustomer.id, nextCredit);
                            setHistoryStoreCreditInput(String(nextCredit));
                          }}
                          className="rounded-lg border border-emerald-300 bg-white px-2 py-1 text-[11px] font-bold text-emerald-900 hover:bg-emerald-100 disabled:opacity-40 tabular-nums"
                        >
                          {delta > 0 ? `+${delta}` : delta}
                        </button>
                      ))}
                      {currentCredit > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            saveCustomerStoreCredit(historyCustomer.id, 0);
                            setHistoryStoreCreditInput('0');
                          }}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
                        >
                          คืนเงินทั้งหมด
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-[11px] font-semibold text-emerald-900 shrink-0">
                      กำหนดเงินฝากทอน (฿):
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={historyStoreCreditInput}
                      onChange={(e) => setHistoryStoreCreditInput(e.target.value)}
                      className="w-28 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-xs font-bold tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const nextCredit = Math.max(
                          0,
                          Math.round((Number(historyStoreCreditInput) || 0) * 100) / 100
                        );
                        saveCustomerStoreCredit(historyCustomer.id, nextCredit);
                        setHistoryStoreCreditInput(String(nextCredit));
                      }}
                      className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                    >
                      บันทึกเงินฝากทอน
                    </button>
                  </div>
                  {currentCredit > 0 && currentDebt > 0 && (
                    <button
                      type="button"
                      disabled={applyingStoreCreditDebt}
                      onClick={() => handleApplyStoreCreditToDebt(historyCustomer)}
                      className="w-full rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50 shadow-xs"
                    >
                      {applyingStoreCreditDebt
                        ? 'กำลังหักเงินฝากทอน...'
                        : `นำเงินฝากทอน (${formatBaht(offsetAmount)}) ไปหักชำระหนี้ค้างทันที`}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Due Date Quick Setting */}
            <DueDateField
              inputId="history-customer-due-date"
              value={dueDates[historyCustomer.id] ?? ''}
              todayIso={todayIso}
              totalDebt={Number(historyCustomer.total_debt)}
              paydayCycle={paydayCycles[historyCustomer.id] ?? ''}
              onChange={(val) => saveCustomerDueDate(historyCustomer.id, val)}
            />

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => handleCopyBenefitsSummary(historyCustomer)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold shadow-xs transition ${
                  copiedBenefitsKey === historyCustomer.id
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
                }`}
              >
                {copiedBenefitsKey === historyCustomer.id ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>คัดลอกสิทธิประโยชน์แล้ว</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>คัดลอกสรุปสิทธิประโยชน์ส่ง LINE</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleExportCustomerHistoryCsv}
                disabled={historyLoading || (customerSales.length === 0 && customerPayments.length === 0)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 shadow-xs"
              >
                <Download className="h-3.5 w-3.5" />
                <span>ส่งออกประวัติ CSV</span>
              </button>
              <button
                type="button"
                onClick={handlePrintDebtStatement}
                disabled={historyLoading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 shadow-xs"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>พิมพ์ใบแจ้งยอด</span>
              </button>
            </div>

            {historyCustomer.total_debt > 0 && (
              <div className="rounded-2xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-amber-900 space-y-1">
                    <div>
                      <span className="font-bold">ส่งแจ้งยอดทาง LINE / แชท:</span>{' '}
                      <span className="text-amber-700">
                        พร้อมระบุชื่อร้าน ยอดค้าง และพร้อมเพย์ ({settings?.promptpay_id || 'ยังไม่ระบุ'})
                      </span>
                    </div>
                    {lastRemindedMap[historyCustomer.id] && (
                      <div className="inline-flex items-center gap-1 rounded-md bg-white/80 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span>
                          แจ้งยอดล่าสุด: {formatDateTime(lastRemindedMap[historyCustomer.id])}
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyDebtReminder(
                        historyCustomer,
                        `modal-${historyCustomer.id}`,
                        customerSales,
                        reminderTone
                      )
                    }
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold shadow-xs transition ${
                      copiedReminderKey === `modal-${historyCustomer.id}`
                        ? 'bg-emerald-600 text-white'
                        : 'bg-amber-600 text-white hover:bg-amber-700'
                    }`}
                  >
                    {copiedReminderKey === `modal-${historyCustomer.id}` ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span>คัดลอกแล้ว</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>คัดลอกสรุปยอด</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-amber-200/70">
                  <span className="text-[11px] font-semibold text-amber-900 mr-1">
                    โทนข้อความ:
                  </span>
                  {DEBT_REMINDER_TONE_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setReminderTone(opt.key)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                        reminderTone === opt.key
                          ? 'bg-amber-700 text-white shadow-xs'
                          : 'bg-white text-amber-900 border border-amber-200 hover:bg-amber-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {historyCustomer.total_debt > 0 && renderInstallmentPlanHelper(historyCustomer, 'history')}

            {historyCustomer.total_debt <= 0 && lastRemindedMap[historyCustomer.id] && (
              <div className="inline-flex items-center gap-1.5 rounded-xl bg-slate-50 border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600">
                <Clock className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                <span>
                  แจ้งยอดล่าสุด: {formatDateTime(lastRemindedMap[historyCustomer.id])}
                </span>
              </div>
            )}

            {/* Follow-up & Payment Agreement Logs */}
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <History className="h-4 w-4 text-indigo-600 shrink-0" />
                  <h4 className="text-xs font-bold text-indigo-950">
                    สมุดบันทึกการติดตาม / ข้อตกลงการชำระ
                  </h4>
                </div>
                <span className="text-[11px] font-semibold text-indigo-700 tabular-nums">
                  {(followupLogs[historyCustomer.id] ?? []).length} รายการ
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {FOLLOWUP_QUICK_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleAddFollowupLog(historyCustomer.id, preset)}
                    className="rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-800 hover:bg-indigo-100/70 transition"
                  >
                    + {preset}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={followupInput}
                  onChange={(e) => setFollowupInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddFollowupLog(historyCustomer.id, followupInput, true);
                    }
                  }}
                  placeholder="บันทึกเพิ่มเติม เช่น นัดจ่ายวันศุกร์ 500 บาท..."
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!followupInput.trim()}
                  onClick={() => handleAddFollowupLog(historyCustomer.id, followupInput, true)}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  บันทึก
                </button>
              </div>

              {(followupLogs[historyCustomer.id] ?? []).length > 0 ? (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {(followupLogs[historyCustomer.id] ?? []).map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-start justify-between gap-2 rounded-lg border border-indigo-100 bg-white px-2.5 py-1.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 break-words">{entry.text}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {formatDateTime(entry.createdAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteFollowupLog(historyCustomer.id, entry.id)}
                        title="ลบบันทึกนี้"
                        className="shrink-0 rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-500">
                  ยังไม่มีบันทึกการติดตาม กดปุ่มข้อความด่วนหรือพิมพ์บันทึกด้านบนได้ทันที
                </p>
              )}
            </div>

            {/* Tabs Switcher */}
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setHistoryTab('sales')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition ${
                  historyTab === 'sales'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Receipt className="h-3.5 w-3.5" />
                <span>บิลที่ติดไว้ ({customerSales.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setHistoryTab('payments')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition ${
                  historyTab === 'payments'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <History className="h-3.5 w-3.5" />
                <span>ประวัติการชำระหนี้ ({customerPayments.length})</span>
              </button>
            </div>

            {historyLoading ? (
              <p className="text-sm text-slate-500 text-center py-6">กำลังโหลดประวัติ...</p>
            ) : historyTab === 'sales' ? (
              <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                {customerSales.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-6">ยังไม่มีประวัติบิลที่ติดไว้</p>
                ) : (
                  customerSales.map((s) => (
                    <div
                      key={s.id}
                      className="rounded-xl border border-slate-200 p-3 text-sm space-y-1.5 bg-white"
                    >
                      <div className="flex items-center justify-between font-semibold">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
                            เงินเชื่อ
                          </span>
                          <span className="text-slate-600 text-xs">
                            {formatDateTime(s.created_at)}
                          </span>
                        </div>
                        <span className="text-slate-900 font-bold tabular-nums">
                          {formatBaht(s.total_amount)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 space-y-0.5 border-t border-slate-100 pt-1.5">
                        {(s.sale_items ?? []).map((item) => (
                          <div key={item.id} className="flex justify-between">
                            <span>
                              {item.product_name} x {item.qty} {item.unit_name}
                            </span>
                            <span className="tabular-nums">{formatBaht(item.subtotal)}</span>
                          </div>
                        ))}
                      </div>
                      {s.note && (
                        <p className="text-[11px] text-slate-500 pt-0.5">หมายเหตุ: {s.note}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                {customerPayments.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-6">
                    ยังไม่มีประวัติการชำระหนี้
                  </p>
                ) : (
                  customerPayments.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-xl border border-slate-200 p-3 text-sm flex items-center justify-between gap-3 bg-white"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold ${
                              p.payment_method === 'qr'
                                ? 'bg-sky-50 text-sky-700'
                                : 'bg-emerald-50 text-emerald-700'
                            }`}
                          >
                            {p.payment_method === 'qr' ? 'โอน / QR' : 'เงินสด'}
                          </span>
                          <span className="text-xs text-slate-600">
                            {formatDateTime(p.created_at)}
                          </span>
                        </div>
                        {p.note && <p className="text-xs text-slate-500">{p.note}</p>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <span className="text-sm font-extrabold text-emerald-600 tabular-nums">
                            +{formatBaht(p.amount)}
                          </span>
                          <span className="block text-[11px] text-slate-500">ชำระคืน</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handlePrintHistoryPaymentReceipt(p)}
                          title="พิมพ์สลิปใบรับชำระหนี้ 80mm"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          <span>สลิป 80mm</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Confirm Delete Customer Modal */}
      <Modal
        open={!!confirmDeleteCustomer}
        onClose={() => !deletingCustomer && setConfirmDeleteCustomer(null)}
        title="ยืนยันการลบรายชื่อลูกค้า"
        maxWidthClass="max-w-sm"
      >
        {confirmDeleteCustomer && (
          <div className="space-y-4">
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 text-xs text-rose-800 space-y-1">
              <p className="font-bold text-sm text-rose-900">
                ต้องการลบรายชื่อ &quot;{confirmDeleteCustomer.name}&quot; หรือไม่?
              </p>
              <p>
                ลูกค้าท่านนี้มียอดค้างชำระเป็น {formatBaht(0)} ระบบจะลบรายชื่อออกจากสมุดลูกค้าเงินเชื่อ
                (ประวัติบิลขายเก่าจะยังคงอยู่ในระบบตามปกติ)
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={deletingCustomer}
                onClick={() => setConfirmDeleteCustomer(null)}
                className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={deletingCustomer}
                onClick={handleDeleteCustomer}
                className="flex-1 rounded-xl bg-rose-600 py-2.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {deletingCustomer ? 'กำลังลบ...' : 'ยืนยันลบรายชื่อ'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Store-wide Recent Debt Payments Modal */}
      <Modal
        open={recentPaymentsOpen}
        onClose={() => setRecentPaymentsOpen(false)}
        title="ประวัติรับชำระหนี้ทั้งร้าน (ล่าสุด 30 รายการ)"
        maxWidthClass="max-w-lg"
      >
        {recentPaymentsLoading ? (
          <p className="text-sm text-slate-500 text-center py-8">กำลังโหลดประวัติรับชำระหนี้...</p>
        ) : recentPayments.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">
            ยังไม่มีประวัติการรับชำระหนี้ในระบบ
          </p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-semibold text-emerald-800">
                    แสดง {recentPayments.length} รายการล่าสุด
                  </span>
                  <span className="font-extrabold text-emerald-700 tabular-nums">
                    รับเงินจริง {formatBaht(recentPaymentsSummary.total)}
                  </span>
                  {recentPaymentsSummary.waivedTotal > 0 && (
                    <span className="text-[11px] font-semibold text-amber-800 tabular-nums">
                      (ตัดยอดหนี้รวม {formatBaht(recentPaymentsSummary.grossTotal)})
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleExportRecentPaymentsCsv}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-emerald-300 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>ส่งออก CSV</span>
                </button>
              </div>
              <div
                className={`grid gap-2 ${
                  recentPaymentsSummary.waivedTotal > 0
                    ? 'grid-cols-1 sm:grid-cols-3'
                    : 'grid-cols-2'
                }`}
              >
                <div className="rounded-lg bg-white/90 border border-emerald-200 px-2.5 py-1.5 flex items-center justify-between">
                  <span className="font-semibold text-emerald-800">
                    เงินสด ({recentPaymentsSummary.cashCount})
                  </span>
                  <span className="font-bold text-emerald-700 tabular-nums">
                    {formatBaht(recentPaymentsSummary.cash)}
                  </span>
                </div>
                <div className="rounded-lg bg-white/90 border border-sky-200 px-2.5 py-1.5 flex items-center justify-between">
                  <span className="font-semibold text-sky-800">
                    โอน / QR ({recentPaymentsSummary.qrCount})
                  </span>
                  <span className="font-bold text-sky-700 tabular-nums">
                    {formatBaht(recentPaymentsSummary.qr)}
                  </span>
                </div>
                {recentPaymentsSummary.waivedTotal > 0 && (
                  <div className="rounded-lg bg-white/90 border border-amber-200 px-2.5 py-1.5 flex items-center justify-between">
                    <span className="font-semibold text-amber-800">
                      ยกเว้น/ลดหนี้ ({recentPaymentsSummary.waivedCount})
                    </span>
                    <span className="font-bold text-amber-700 tabular-nums">
                      {formatBaht(recentPaymentsSummary.waivedTotal)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {recentPayments.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-200 p-3 text-sm flex items-center justify-between gap-3 bg-white"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 truncate">
                        {p.customers?.name ?? 'ไม่ระบุลูกค้า'}
                      </span>
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold ${
                          p.payment_method === 'qr'
                            ? 'bg-sky-50 text-sky-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {p.payment_method === 'qr' ? 'โอน / QR' : 'เงินสด'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{formatDateTime(p.created_at)}</p>
                    {p.note && <p className="text-xs text-slate-500 truncate">{p.note}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-sm font-extrabold text-emerald-600 tabular-nums">
                      +{formatBaht(p.amount)}
                    </span>
                    <span className="block text-[11px] text-slate-500">ชำระคืน</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* Customer Metadata Backup / Restore JSON Modal */}
      <Modal
        open={metaBackupOpen}
        onClose={() => setMetaBackupOpen(false)}
        title="สำรอง / กู้คืนตั้งค่าลูกค้า (JSON)"
        maxWidthClass="max-w-3xl"
      >
        <div className="space-y-4">
          {/* Export Section */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  1. สำรองข้อมูลตั้งค่าลูกค้า (Export JSON)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  รวมข้อมูลวงเงินเชื่อ, แต้มสะสม, ส่วนลด VIP, ประวัติแจ้งยอดล่าสุด, วันนัดชำระหนี้ และที่อยู่/ช่องทางติดต่อที่บันทึกไว้ในเครื่องนี้
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyCustomerMetaJson}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  {metaCopied ? (
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
                  onClick={handleExportCustomerMetaJson}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>ดาวน์โหลดไฟล์ (.json)</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                วงเงินเชื่อ: {formatNumber(Object.keys(creditLimits).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                แต้มสะสม: {formatNumber(Object.keys(loyaltyPoints).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                เงินฝากทอน: {formatNumber(Object.keys(storeCredits).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                ส่วนลด VIP: {formatNumber(Object.keys(defaultDiscounts).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                แจ้งยอดล่าสุด: {formatNumber(Object.keys(lastRemindedMap).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                วันนัดชำระ: {formatNumber(Object.keys(dueDates).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                ที่อยู่/ติดต่อ: {formatNumber(Object.keys(contactNotes).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                รอบจ่ายประจำ: {formatNumber(Object.keys(paydayCycles).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                กลุ่มลูกค้า: {formatNumber(Object.keys(customerTags).length)}
              </span>
            </div>
          </div>

          {/* Import / Restore Section */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                2. กู้คืนข้อมูลจากไฟล์หรือวาง JSON (Import / Restore)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                เลือกไฟล์ .json ที่สำรองไว้ หรือวางข้อความ JSON ลงในช่องด้านล่างเพื่อกู้คืนกลับเข้าสู่ระบบทันที
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/70 px-3.5 py-2 text-xs font-bold text-sky-800 hover:bg-sky-50 transition">
                <Upload className="h-4 w-4" />
                <span>
                  {metaBackupFileName
                    ? `เลือกไฟล์ใหม่ (${metaBackupFileName})`
                    : 'อัปโหลดไฟล์ .json จากเครื่อง'}
                </span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleMetaBackupFileChange}
                  className="hidden"
                />
              </label>

              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500 font-medium">รูปแบบกู้คืน:</span>
                <button
                  type="button"
                  onClick={() => setMetaRestoreMode('replace')}
                  className={`rounded-lg border px-2.5 py-1 font-semibold transition ${
                    metaRestoreMode === 'replace'
                      ? 'border-sky-600 bg-sky-600 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  เขียนทับข้อมูลเดิม
                </button>
                <button
                  type="button"
                  onClick={() => setMetaRestoreMode('merge')}
                  className={`rounded-lg border px-2.5 py-1 font-semibold transition ${
                    metaRestoreMode === 'merge'
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
                htmlFor="customer-meta-json-textarea"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                วางข้อมูล JSON ที่นี่
              </label>
              <textarea
                id="customer-meta-json-textarea"
                rows={7}
                value={metaBackupJsonInput}
                onChange={(e) => {
                  setMetaBackupJsonInput(e.target.value);
                  setMetaBackupError('');
                  setMetaBackupSuccess('');
                }}
                placeholder='{"customer_credit_limits_v1": {...}, "customer_loyalty_points_v1": {...}, ...}'
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-800 focus:border-sky-500 focus:bg-white focus:outline-none"
              />
            </div>

            {metaBackupPreview && !metaBackupPreview.error && (
              <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 flex flex-wrap items-center gap-2">
                <span className="font-bold">ตรวจพบข้อมูลพร้อมกู้คืน:</span>
                {metaBackupPreview.creditLimits !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    วงเงินเชื่อ {formatNumber(Object.keys(metaBackupPreview.creditLimits).length)}
                  </span>
                )}
                {metaBackupPreview.loyaltyPoints !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    แต้มสะสม {formatNumber(Object.keys(metaBackupPreview.loyaltyPoints).length)}
                  </span>
                )}
                {metaBackupPreview.storeCredits !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    เงินฝากทอน {formatNumber(Object.keys(metaBackupPreview.storeCredits).length)}
                  </span>
                )}
                {metaBackupPreview.defaultDiscounts !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    ส่วนลด VIP {formatNumber(Object.keys(metaBackupPreview.defaultDiscounts).length)}
                  </span>
                )}
                {metaBackupPreview.lastRemindedMap !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    แจ้งยอดล่าสุด {formatNumber(Object.keys(metaBackupPreview.lastRemindedMap).length)}
                  </span>
                )}
                {metaBackupPreview.dueDates !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    วันนัดชำระ {formatNumber(Object.keys(metaBackupPreview.dueDates).length)}
                  </span>
                )}
                {metaBackupPreview.contactNotes !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    ที่อยู่/ติดต่อ {formatNumber(Object.keys(metaBackupPreview.contactNotes).length)}
                  </span>
                )}
                {metaBackupPreview.followupLogs !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    บันทึกติดตาม {formatNumber(Object.keys(metaBackupPreview.followupLogs).length)}
                  </span>
                )}
                {metaBackupPreview.paydayCycles !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    รอบจ่ายประจำ {formatNumber(Object.keys(metaBackupPreview.paydayCycles).length)}
                  </span>
                )}
                {metaBackupPreview.customerTags !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    กลุ่มลูกค้า {formatNumber(Object.keys(metaBackupPreview.customerTags).length)}
                  </span>
                )}
              </div>
            )}

            {metaBackupPreview?.error && !metaBackupError && (
              <div
                role="alert"
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
              >
                {metaBackupPreview.error}
              </div>
            )}

            {metaBackupError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
              >
                {metaBackupError}
              </div>
            )}

            {metaBackupSuccess && (
              <div
                role="status"
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 flex items-center gap-1.5"
              >
                <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{metaBackupSuccess}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setMetaBackupOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ปิด
            </button>
            <button
              type="button"
              disabled={!metaBackupJsonInput.trim() || Boolean(metaBackupPreview?.error)}
              onClick={handleRestoreCustomerMetaJson}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              <span>กู้คืนข้อมูลเข้าสู่ระบบ</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Bulk Credit Limit Assignment Modal */}
      <Modal
        open={bulkCreditOpen}
        onClose={() => setBulkCreditOpen(false)}
        title="ตั้งวงเงินเชื่อแบบกลุ่ม"
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              1. เลือกกลุ่มเป้าหมาย
            </label>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setBulkCreditTarget('unset');
                  setBulkCreditError('');
                }}
                className={`w-full flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors ${
                  bulkCreditTarget === 'unset'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="font-semibold">เฉพาะลูกค้าที่ยังไม่ได้ตั้งวงเงิน</span>
                <span className="rounded-lg bg-white/80 border border-slate-200 px-2 py-0.5 text-xs font-bold tabular-nums">
                  {formatNumber(bulkCreditUnsetCustomers.length)} ราย
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setBulkCreditTarget('credit_good');
                  setBulkCreditError('');
                }}
                className={`w-full flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors ${
                  bulkCreditTarget === 'credit_good'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="font-semibold">เฉพาะกลุ่ม ⭐ เครดิตดี</span>
                <span className="rounded-lg bg-white/80 border border-slate-200 px-2 py-0.5 text-xs font-bold tabular-nums">
                  {formatNumber(bulkCreditGoodCustomers.length)} ราย
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setBulkCreditTarget('filtered');
                  setBulkCreditError('');
                }}
                className={`w-full flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors ${
                  bulkCreditTarget === 'filtered'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="font-semibold">
                  ลูกค้าที่กรองอยู่ทั้งหมด ({filteredCustomers.length} ราย)
                </span>
                <span className="rounded-lg bg-white/80 border border-slate-200 px-2 py-0.5 text-xs font-bold tabular-nums">
                  {formatNumber(filteredCustomers.length)} ราย
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              2. กำหนดวงเงินเชื่อมาตรฐาน (บาท)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[500, 1000, 2000, 5000].map((preset) => {
                const active =
                  !bulkCreditClearMode && Number(bulkCreditAmountInput) === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setBulkCreditClearMode(false);
                      setBulkCreditAmountInput(String(preset));
                      setBulkCreditError('');
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold tabular-nums transition-colors ${
                      active
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    ฿{formatNumber(preset)}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setBulkCreditClearMode(true);
                  setBulkCreditAmountInput('');
                  setBulkCreditError('');
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                  bulkCreditClearMode
                    ? 'border-rose-600 bg-rose-600 text-white'
                    : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                }`}
              >
                ล้างวงเงิน
              </button>
            </div>

            <input
              type="number"
              min="1"
              step="any"
              value={bulkCreditClearMode ? '' : bulkCreditAmountInput}
              onChange={(e) => {
                setBulkCreditClearMode(false);
                setBulkCreditAmountInput(e.target.value);
                setBulkCreditError('');
              }}
              placeholder={
                bulkCreditClearMode
                  ? 'โหมดล้างวงเงิน (จะลบวงเงินเชื่อของกลุ่มที่เลือก)'
                  : 'ระบุวงเงินเชื่อ เช่น 1500'
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {bulkCreditError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700"
            >
              {bulkCreditError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setBulkCreditOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={bulkCreditTargetCustomers.length === 0}
              onClick={handleApplyBulkCreditLimit}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${
                bulkCreditClearMode
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              <Check className="h-4 w-4" />
              <span>
                {bulkCreditClearMode
                  ? `ยืนยันล้างวงเงิน (${formatNumber(bulkCreditTargetCustomers.length)} ราย)`
                  : `ยืนยันตั้งวงเงิน (${formatNumber(bulkCreditTargetCustomers.length)} ราย)`}
              </span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Bulk Customer Tag Assignment Modal */}
      <Modal
        open={bulkTagOpen}
        onClose={() => setBulkTagOpen(false)}
        title="จัดกลุ่มลูกค้าแบบกลุ่ม"
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              1. เลือกกลุ่มเป้าหมาย
            </label>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setBulkTagTarget('unset');
                  setBulkTagError('');
                }}
                className={`w-full flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors ${
                  bulkTagTarget === 'unset'
                    ? 'border-teal-500 bg-teal-50 text-teal-900 ring-1 ring-teal-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="font-semibold">เฉพาะลูกค้าที่ยังไม่ได้ระบุกลุ่ม</span>
                <span className="rounded-lg bg-white/80 border border-slate-200 px-2 py-0.5 text-xs font-bold tabular-nums">
                  {formatNumber(bulkTagUnsetCustomers.length)} ราย
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setBulkTagTarget('has_debt');
                  setBulkTagError('');
                }}
                className={`w-full flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors ${
                  bulkTagTarget === 'has_debt'
                    ? 'border-teal-500 bg-teal-50 text-teal-900 ring-1 ring-teal-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="font-semibold">เฉพาะลูกค้าที่มียอดหนี้ค้าง</span>
                <span className="rounded-lg bg-white/80 border border-slate-200 px-2 py-0.5 text-xs font-bold tabular-nums">
                  {formatNumber(bulkTagDebtCustomers.length)} ราย
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setBulkTagTarget('filtered');
                  setBulkTagError('');
                }}
                className={`w-full flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors ${
                  bulkTagTarget === 'filtered'
                    ? 'border-teal-500 bg-teal-50 text-teal-900 ring-1 ring-teal-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="font-semibold">
                  ลูกค้าที่กรองอยู่ทั้งหมด ({filteredCustomers.length} ราย)
                </span>
                <span className="rounded-lg bg-white/80 border border-slate-200 px-2 py-0.5 text-xs font-bold tabular-nums">
                  {formatNumber(filteredCustomers.length)} ราย
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              2. เลือกหรือกรอกป้ายกลุ่มประเภทลูกค้า
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CUSTOMER_TAG_PRESETS.map((preset) => {
                const active = !bulkTagClearMode && bulkTagInput.trim() === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setBulkTagClearMode(false);
                      setBulkTagInput(preset);
                      setBulkTagError('');
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                      active
                        ? 'border-teal-600 bg-teal-600 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setBulkTagClearMode(true);
                  setBulkTagInput('');
                  setBulkTagError('');
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                  bulkTagClearMode
                    ? 'border-rose-600 bg-rose-600 text-white'
                    : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                }`}
              >
                ล้างป้ายกลุ่ม
              </button>
            </div>

            <input
              type="text"
              value={bulkTagClearMode ? '' : bulkTagInput}
              onChange={(e) => {
                setBulkTagClearMode(false);
                setBulkTagInput(e.target.value);
                setBulkTagError('');
              }}
              placeholder={
                bulkTagClearMode
                  ? 'โหมดล้างป้ายกลุ่ม (จะลบป้ายกลุ่มของลูกค้าที่เลือก)'
                  : 'เช่น 🍳 ร้านอาหาร/แม่ค้า, 🏡 เพื่อนบ้านประจำ'
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none"
            />
          </div>

          {bulkTagError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700"
            >
              {bulkTagError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setBulkTagOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={bulkTagTargetCustomers.length === 0}
              onClick={handleApplyBulkCustomerTag}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${
                bulkTagClearMode
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-teal-600 hover:bg-teal-700'
              }`}
            >
              <Check className="h-4 w-4" />
              <span>
                {bulkTagClearMode
                  ? `ยืนยันล้างป้ายกลุ่ม (${formatNumber(bulkTagTargetCustomers.length)} ราย)`
                  : `ยืนยันจัดกลุ่ม (${formatNumber(bulkTagTargetCustomers.length)} ราย)`}
              </span>
            </button>
          </div>
        </div>
      </Modal>
        </AppShell>
      </div>

      {/* Printable Customer Debt Statement */}
      {printMode === 'statement' && historyCustomer && (() => {
        const statementDebt = Number(historyCustomer.total_debt) || 0;
        const statementCreditLimit = creditLimits[historyCustomer.id];
        const hasStatementLimit =
          typeof statementCreditLimit === 'number' && statementCreditLimit > 0;
        const isOverStatementLimit =
          hasStatementLimit && statementDebt > statementCreditLimit;
        const statementDueInfo = getCustomerDueDateInfo(
          dueDates[historyCustomer.id],
          todayIso,
          statementDebt
        );
        const totalRecentSales = customerSales.reduce(
          (sum, s) => sum + Number(s.total_amount || 0),
          0
        );
        const totalRecentPayments = customerPayments.reduce(
          (sum, p) => sum + Number(p.amount || 0),
          0
        );

        return (
          <div className="hidden print:block bg-white text-slate-900 p-5 max-w-xl mx-auto text-xs leading-relaxed">
            <div className="border-b-2 border-slate-800 pb-2.5 mb-3 text-center">
              <h1 className="text-lg font-extrabold">
                {settings?.store_name || 'ร้านขายของชำ POS'}
              </h1>
              {settings?.phone && (
                <p className="text-[11px] text-slate-600">โทร: {settings.phone}</p>
              )}
              {settings?.address && (
                <p className="text-[11px] text-slate-600">{settings.address}</p>
              )}
              <p className="text-sm font-bold mt-1.5">
                ใบแจ้งยอดลูกหนี้ / สรุปประวัติลูกหนี้รายบุคคล
              </p>
              {printDateText && (
                <p className="text-[11px] text-slate-500">วันที่พิมพ์: {printDateText}</p>
              )}
            </div>

            {/* Customer Info & Balances */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-slate-300 p-3 mb-3">
              <div>
                <span className="block text-[11px] text-slate-500">ชื่อลูกค้า</span>
                <span className="text-sm font-bold text-slate-900">
                  {historyCustomer.name}
                </span>
                {contactNotes[historyCustomer.id] && (
                  <span className="block text-[11px] text-slate-600">
                    ที่อยู่ / ช่องทางติดต่อ: {contactNotes[historyCustomer.id]}
                  </span>
                )}
                {historyCustomer.note && (
                  <span className="block text-[11px] text-slate-500">
                    หมายเหตุ: {historyCustomer.note}
                  </span>
                )}
              </div>
              <div className="text-right">
                <span className="block text-[11px] text-slate-500">ยอดค้างชำระปัจจุบัน</span>
                <span className="text-lg font-extrabold tabular-nums text-slate-900">
                  {formatBaht(statementDebt)}
                </span>
              </div>

              <div>
                <span className="block text-[11px] text-slate-500">เบอร์โทร</span>
                <span className="font-semibold text-slate-800 tabular-nums">
                  {historyCustomer.phone?.trim() || '-'}
                </span>
              </div>
              <div className="text-right">
                <span className="block text-[11px] text-slate-500">วงเงินเชื่อ</span>
                <span className="font-semibold text-slate-800 tabular-nums">
                  {hasStatementLimit ? formatBaht(statementCreditLimit) : 'ไม่จำกัดวงเงิน'}
                  {isOverStatementLimit && (
                    <span className="ml-1 font-bold text-rose-700">
                      (เกินวงเงิน {formatBaht(statementDebt - statementCreditLimit)})
                    </span>
                  )}
                </span>
              </div>

              <div className="col-span-2 border-t border-slate-200 pt-2 flex items-center justify-between">
                <span className="text-[11px] text-slate-600 font-semibold">
                  วันนัดชำระหนี้
                </span>
                <span className="font-bold text-slate-900">
                  {statementDueInfo ? (
                    <>
                      {statementDueInfo.formattedDate}
                      {statementDebt > 0 && statementDueInfo.status === 'overdue' && (
                        <span className="ml-1.5 text-red-700">
                          (เลยกำหนด {Math.abs(statementDueInfo.daysDiff)} วัน)
                        </span>
                      )}
                      {statementDebt > 0 && statementDueInfo.status === 'due_today' && (
                        <span className="ml-1.5 text-orange-700">(ครบกำหนดวันนี้)</span>
                      )}
                    </>
                  ) : (
                    'ยังไม่กำหนด'
                  )}
                </span>
              </div>
              {(() => {
                const statementLatestFollowup = followupLogs[historyCustomer.id]?.[0];
                if (!statementLatestFollowup) return null;
                return (
                  <div className="col-span-2 border-t border-slate-200 pt-2 flex items-start justify-between gap-2">
                    <span className="text-[11px] text-slate-600 font-semibold shrink-0">
                      บันทึกการติดตามล่าสุด
                    </span>
                    <span className="text-right font-medium text-slate-900">
                      {statementLatestFollowup.text} (
                      {formatDateTime(statementLatestFollowup.createdAt)})
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Compact Activity Summary */}
            <div className="grid grid-cols-2 gap-2 mb-3 text-center">
              <div className="rounded border border-slate-300 px-2.5 py-1.5">
                <span className="block text-[11px] text-slate-500">
                  ซื้อเชื่อล่าสุด ({customerSales.length} บิล)
                </span>
                <span className="text-xs font-bold tabular-nums text-slate-900">
                  {formatBaht(totalRecentSales)}
                </span>
              </div>
              <div className="rounded border border-slate-300 px-2.5 py-1.5">
                <span className="block text-[11px] text-slate-500">
                  ชำระหนี้ล่าสุด ({customerPayments.length} ครั้ง)
                </span>
                <span className="text-xs font-bold tabular-nums text-slate-900">
                  {formatBaht(totalRecentPayments)}
                </span>
              </div>
            </div>

            {/* Combined Recent Credit Purchases & Debt Payments Table */}
            <div className="mb-3">
              <h2 className="text-[11px] font-bold text-slate-700 mb-1.5">
                ตารางประวัติรายการซื้อเชื่อ / ชำระหนี้ล่าสุด ({historyPrintRows.length} รายการ)
              </h2>
              {historyPrintRows.length === 0 ? (
                <p className="text-[11px] text-slate-500 border border-slate-200 rounded py-3 text-center">
                  ยังไม่มีประวัติรายการซื้อเชื่อหรือการชำระหนี้
                </p>
              ) : (
                <table className="w-full border-collapse border border-slate-300 text-[11px]">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700">
                      <th className="border border-slate-300 px-2 py-1.5 text-left whitespace-nowrap">
                        วัน-เวลา
                      </th>
                      <th className="border border-slate-300 px-2 py-1.5 text-center whitespace-nowrap">
                        ประเภท
                      </th>
                      <th className="border border-slate-300 px-2 py-1.5 text-left">
                        รายละเอียด
                      </th>
                      <th className="border border-slate-300 px-2 py-1.5 text-right whitespace-nowrap">
                        ยอดเงิน
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyPrintRows.map((row) => (
                      <tr key={row.id}>
                        <td className="border border-slate-300 px-2 py-1 whitespace-nowrap align-top tabular-nums">
                          {formatDateTime(row.createdAt)}
                        </td>
                        <td className="border border-slate-300 px-2 py-1 text-center whitespace-nowrap align-top font-bold">
                          {row.typeLabel}
                        </td>
                        <td className="border border-slate-300 px-2 py-1 align-top">
                          {row.detail}
                        </td>
                        <td className="border border-slate-300 px-2 py-1 text-right whitespace-nowrap align-top font-bold tabular-nums">
                          {row.kind === 'payment'
                            ? `-${formatBaht(row.amount)}`
                            : formatBaht(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {settings?.promptpay_id?.trim() && (
              <div className="rounded-lg border border-slate-400 p-2.5 text-center mt-3">
                <p className="text-[11px] font-semibold text-slate-600">
                  ช่องทางโอนชำระ (พร้อมเพย์ / PromptPay)
                </p>
                <p className="text-sm font-extrabold tracking-wide mt-0.5 tabular-nums">
                  {settings.promptpay_id.trim()}
                </p>
              </div>
            )}

            <p className="text-center text-[11px] text-slate-500 mt-4">
              ขอบคุณที่อุดหนุนครับ/ค่ะ
            </p>
          </div>
        );
      })()}

      {/* Printable Debt Payment Receipt */}
      {printMode === 'pay_receipt' && payReceipt && (
        <div className="hidden print:block bg-white text-slate-900 p-6 max-w-md mx-auto text-sm">
          <div className="border-b-2 border-slate-800 pb-3 mb-4 text-center">
            <h1 className="text-xl font-extrabold">
              {settings?.store_name || 'ร้านขายของชำ POS'}
            </h1>
            {settings?.phone && (
              <p className="text-xs text-slate-600 mt-0.5">โทร: {settings.phone}</p>
            )}
            {settings?.address && (
              <p className="text-xs text-slate-600">{settings.address}</p>
            )}
            <p className="text-base font-bold mt-2">ใบเสร็จรับชำระหนี้</p>
            <p className="text-xs text-slate-500">{payReceipt.paidAt}</p>
          </div>

          <div className="space-y-2.5 border-b border-slate-300 pb-3 mb-3">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">ชื่อลูกค้า</span>
              <span className="font-bold text-slate-900">{payReceipt.customerName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">ช่องทางชำระ</span>
              <span className="font-semibold text-slate-900">
                {payReceipt.paymentMethod === 'qr' ? 'โอน / QR' : 'เงินสด'}
              </span>
            </div>
            <div className="flex items-center justify-between text-base">
              <span className="font-bold text-slate-800">ยอดที่ชำระ</span>
              <span className="font-extrabold text-slate-900 tabular-nums">
                {formatBaht(payReceipt.amountPaid)}
              </span>
            </div>
            {payReceipt.waivedAmount && payReceipt.waivedAmount > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-slate-600">ยกเว้น/ลดเศษหนี้ให้</span>
                <span className="font-bold text-slate-900 tabular-nums">
                  {formatBaht(payReceipt.waivedAmount)}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-b border-slate-300 pb-3 mb-3">
            <span className="font-semibold text-slate-700">ยอดหนี้คงเหลือล่าสุด</span>
            <span className="text-base font-extrabold text-slate-900 tabular-nums">
              {formatBaht(payReceipt.remainingDebt)}
            </span>
          </div>

          {payReceipt.note && (
            <p className="text-xs text-slate-600 mb-3">
              หมายเหตุ: {payReceipt.note}
            </p>
          )}

          <p className="text-center text-xs text-slate-500 mt-5">
            ขอบคุณที่ชำระหนี้และอุดหนุนครับ/ค่ะ
          </p>
        </div>
      )}

      {/* Printable Compact 80mm Debt Payment Receipt */}
      {printMode === 'payment_receipt' && compactPayReceipt && (
        <div className="hidden print:block bg-white text-slate-900 w-[80mm] max-w-[80mm] mx-auto p-3 text-xs leading-snug">
          <div className="border-b border-dashed border-slate-400 pb-2 mb-2 text-center">
            <h1 className="text-sm font-extrabold">
              {settings?.store_name || 'ร้านขายของชำ POS'}
            </h1>
            {settings?.phone && (
              <p className="text-[11px] text-slate-600 mt-0.5">โทร: {settings.phone}</p>
            )}
            {settings?.address && (
              <p className="text-[11px] text-slate-600">{settings.address}</p>
            )}
            <p className="text-xs font-bold mt-1.5">สลิปใบเสร็จรับชำระหนี้</p>
            <p className="text-[11px] text-slate-600">{compactPayReceipt.paidAt}</p>
          </div>

          <div className="space-y-1.5 border-b border-dashed border-slate-400 pb-2 mb-2">
            <div className="flex items-start justify-between gap-2">
              <span className="text-slate-600 shrink-0">ลูกค้า</span>
              <span className="font-bold text-slate-900 text-right">
                {compactPayReceipt.customerName}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-600">ยอดหนี้ก่อนจ่าย</span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {formatBaht(compactPayReceipt.debtBefore)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-bold text-slate-800">ยอดรับชำระ</span>
              <span className="font-extrabold text-slate-900 tabular-nums">
                {formatBaht(compactPayReceipt.amountPaid)}
              </span>
            </div>
            {compactPayReceipt.waivedAmount && compactPayReceipt.waivedAmount > 0 && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600">ยกเว้น/ลดเศษหนี้</span>
                <span className="font-semibold text-slate-900 tabular-nums">
                  {formatBaht(compactPayReceipt.waivedAmount)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-600">ช่องทาง</span>
              <span className="font-semibold text-slate-900">
                {compactPayReceipt.paymentMethod === 'qr' ? 'โอน / QR' : 'เงินสด'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-b border-dashed border-slate-400 pb-2 mb-2">
            <span className="font-bold text-slate-800">ยอดหนี้คงเหลือ</span>
            <span className="text-sm font-extrabold text-slate-900 tabular-nums">
              {formatBaht(compactPayReceipt.remainingDebt)}
            </span>
          </div>

          {compactPayReceipt.note && (
            <p className="text-[11px] text-slate-600 mb-2">
              หมายเหตุ: {compactPayReceipt.note}
            </p>
          )}

          <p className="text-center text-[11px] text-slate-500 mt-3">
            ขอบคุณที่ชำระหนี้ครับ/ค่ะ
          </p>
        </div>
      )}

      {/* Printable All Debtors Summary Report (A4) */}
      {printMode === 'all_debtors' && (
        <div className="hidden print:block bg-white text-slate-900 p-6 max-w-5xl mx-auto text-xs leading-relaxed">
          <div className="border-b-2 border-slate-800 pb-3 mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="text-xl font-extrabold">
                {settings?.store_name || 'ร้านขายของชำ POS'}
              </h1>
              {settings?.phone && (
                <p className="text-[11px] text-slate-600">โทร: {settings.phone}</p>
              )}
              {settings?.address && (
                <p className="text-[11px] text-slate-600">{settings.address}</p>
              )}
              <p className="text-base font-bold mt-1.5">
                {selectedPaydayCycle === 'all'
                  ? 'รายงานสรุปลูกหนี้เงินเชื่อทั้งร้าน'
                  : `รายงานสรุปลูกหนี้เงินเชื่อ (รอบจ่าย: ${
                      selectedPaydayCycle === '__none__' ? 'ยังไม่ระบุรอบจ่าย' : selectedPaydayCycle
                    })`}
              </p>
            </div>
            <div className="text-right">
              {printDateText && (
                <p className="text-[11px] text-slate-500">พิมพ์เมื่อ: {printDateText}</p>
              )}
              <p className="text-xs font-semibold text-slate-700 mt-1">
                ลูกหนี้ค้างชำระทั้งหมด {formatNumber(allDebtorsForPrint.length)} ราย
              </p>
              <p className="text-sm font-extrabold text-slate-900 tabular-nums">
                ยอดหนี้ค้างรวม: {formatBaht(totalDebtorsForPrint)}
              </p>
            </div>
          </div>

          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-y-2 border-slate-800 bg-slate-100 text-left font-bold text-slate-800">
                <th className="py-2 px-1.5 w-8 text-center">#</th>
                <th className="py-2 px-2">ชื่อลูกค้า</th>
                <th className="py-2 px-2">เบอร์โทร</th>
                <th className="py-2 px-2">ที่อยู่ / จุดสังเกต</th>
                <th className="py-2 px-2 text-right">ยอดค้างชำระ</th>
                <th className="py-2 px-2 text-right">วงเงินเชื่อ</th>
                <th className="py-2 px-2">วันนัดชำระ</th>
                <th className="py-2 px-2">ชำระล่าสุด</th>
                <th className="py-2 px-2">บันทึกติดตามล่าสุด</th>
                <th className="py-2 px-2">สถานะเครดิต</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {allDebtorsForPrint.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-slate-500">
                    ไม่มีลูกหนี้ค้างชำระในขณะนี้
                  </td>
                </tr>
              ) : (
                allDebtorsForPrint.map((c, idx) => {
                  const debt = Number(c.total_debt) || 0;
                  const creditLimit = creditLimits[c.id];
                  const hasLimit = typeof creditLimit === 'number' && creditLimit > 0;
                  const dueInfo = getCustomerDueDateInfo(dueDates[c.id], todayIso, debt);
                  const lastPayment = lastPaymentMap[c.id];
                  const contactNote = (contactNotes[c.id] ?? '').trim();
                  const creditHealth = getCustomerCreditHealth(debt, creditLimit, dueInfo);
                  const latestFollowup = followupLogs[c.id]?.[0];

                  return (
                    <tr key={c.id} className="align-top">
                      <td className="py-1.5 px-1.5 text-center tabular-nums text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="py-1.5 px-2">
                        <div className="font-bold text-slate-900">{c.name}</div>
                        {c.note && (
                          <div className="text-[11px] text-slate-500">{c.note}</div>
                        )}
                      </td>
                      <td className="py-1.5 px-2 tabular-nums whitespace-nowrap">
                        {c.phone?.trim() || '-'}
                      </td>
                      <td className="py-1.5 px-2 text-slate-700">
                        {contactNote || '-'}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold tabular-nums text-slate-900 whitespace-nowrap">
                        {formatBaht(debt)}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-700 whitespace-nowrap">
                        {hasLimit ? formatBaht(creditLimit) : 'ไม่จำกัด'}
                      </td>
                      <td className="py-1.5 px-2 whitespace-nowrap">
                        {dueInfo ? (
                          <div>
                            <span className="font-semibold">{dueInfo.formattedDate}</span>
                            {dueInfo.status === 'overdue' && (
                              <div className="text-[11px] font-bold text-red-700">
                                เลยกำหนด {Math.abs(dueInfo.daysDiff)} วัน
                              </div>
                            )}
                            {dueInfo.status === 'due_today' && (
                              <div className="text-[11px] font-bold text-orange-700">
                                ครบกำหนดวันนี้
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2">
                        {lastPayment ? (
                          <div>
                            <div className="tabular-nums">{formatDateTime(lastPayment.paidAt)}</div>
                            <div className="text-[11px] text-slate-600 tabular-nums">
                              {formatBaht(lastPayment.amount)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500">ยังไม่เคยชำระ</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2">
                        {latestFollowup ? (
                          <div>
                            <div className="text-slate-800">{latestFollowup.text}</div>
                            <div className="text-[11px] text-slate-500 tabular-nums">
                              {formatDateTime(latestFollowup.createdAt)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2">
                        <div className="font-semibold text-slate-800">
                          {creditHealth?.label ?? 'ปกติ'}
                        </div>
                        {creditHealth?.detail && (
                          <div className="text-[11px] text-slate-500">
                            {creditHealth.detail}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-800 bg-slate-50 font-bold text-slate-900">
                <td colSpan={4} className="py-2 px-2 text-right">
                  {selectedPaydayCycle === 'all'
                    ? `ยอดรวมหนี้ค้างชำระทั้งร้าน (${formatNumber(allDebtorsForPrint.length)} ราย)`
                    : `ยอดรวมหนี้ค้างชำระตามรอบจ่าย (${formatNumber(allDebtorsForPrint.length)} ราย)`}
                </td>
                <td className="py-2 px-2 text-right tabular-nums text-sm">
                  {formatBaht(totalDebtorsForPrint)}
                </td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
