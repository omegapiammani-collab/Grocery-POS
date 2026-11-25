'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Banknote,
  QrCode,
  UserCheck,
  ShoppingBag,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Clock,
  Receipt,
  PauseCircle,
  RotateCcw,
  Tag,
  Copy,
  Printer,
  Check,
  XCircle,
  Volume2,
  VolumeX,
  ArrowUpDown,
  Pencil,
  X,
  LayoutGrid,
  Grid3x3,
  Calculator,
  Maximize2,
  Minimize2,
  HelpCircle,
  Star,
  CalendarClock,
  Settings,
  Package,
  PackagePlus,
  Monitor,
  StickyNote,
  Download,
  Upload,
  Lock,
  Undo2,
} from 'lucide-react';
import generatePayload from 'promptpay-qr';
import QRCode from 'qrcode';
import { AppShell } from '@/components/AppShell';
import { Modal } from '@/components/Modal';
import { createClient } from '@/lib/supabase/client';
import { formatBaht, formatDateTime, formatNumber, formatTime } from '@/lib/format';
import { seedSampleGroceryData } from '@/lib/seed';
import type {
  CartItem,
  Category,
  Customer,
  PaymentMethod,
  Product,
  ProductUnit,
  Sale,
  Shift,
  StoreSettings,
} from '@/types/pos';

interface ReceiptCartItem extends CartItem {
  itemNote?: string;
}

interface CompletedReceipt {
  items: ReceiptCartItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  cashReceived: number;
  changeAmount: number;
  partialCash?: number;
  qrAmount?: number;
  creditDownPayment?: number;
  creditRemainingDebt?: number;
  creditDueDate?: string;
  oldDebtSettled?: number;
  oldDebtRemaining?: number;
  customerId?: string | null;
  customerName?: string | null;
  customerContactNote?: string | null;
  note?: string;
  createdAt: string;
  pointsEarned?: number;
  pointsRedeemed?: number;
  pointsBalance?: number;
  vipDiscountPct?: number;
  storeCreditUsed?: number;
  storeCreditDeposited?: number;
  storeCreditBalance?: number;
}

type HeldBillOrderType = 'walk_in' | 'pickup' | 'delivery';

interface HeldBill {
  id: string;
  items: CartItem[];
  total: number;
  count: number;
  note: string;
  tag?: string;
  orderType?: HeldBillOrderType;
  deliveryInfo?: string;
  packingStatus?: 'pending' | 'packed';
  deliveryStatus?: 'waiting' | 'out_for_delivery';
  riderName?: string;
  customerId?: string;
  customerName?: string;
  itemNotes?: Record<string, string>;
  createdAt: string;
}

const HELD_BILL_ORDER_TYPE_OPTIONS: ReadonlyArray<{
  value: HeldBillOrderType;
  label: string;
  shortLabel: string;
  badgeText: string;
  badgeClass: string;
}> = [
  {
    value: 'walk_in',
    label: '⏸️ พักบิลหน้าร้าน',
    shortLabel: 'พักหน้าร้าน',
    badgeText: '⏸️ พักหน้าร้าน',
    badgeClass: 'border-slate-200 bg-slate-100 text-slate-700',
  },
  {
    value: 'pickup',
    label: '📱 โทร/LINE สั่งมารับเอง',
    shortLabel: 'นัดรับเอง',
    badgeText: '📱 สั่งมารับเอง',
    badgeClass: 'border-sky-200 bg-sky-100 text-sky-800',
  },
  {
    value: 'delivery',
    label: '🛵 จัดส่งถึงบ้าน (Delivery)',
    shortLabel: 'จัดส่งถึงบ้าน',
    badgeText: '🛵 จัดส่งถึงบ้าน',
    badgeClass: 'border-emerald-200 bg-emerald-100 text-emerald-800',
  },
];

function getHeldBillOrderTypeMeta(orderType?: HeldBillOrderType) {
  return (
    HELD_BILL_ORDER_TYPE_OPTIONS.find((opt) => opt.value === orderType) ??
    HELD_BILL_ORDER_TYPE_OPTIONS[0]
  );
}

const QUICK_DELIVERY_RIDERS = [
  'เจ้าของร้าน',
  'พนักงานหน้าร้าน',
  'วินมอเตอร์ไซค์',
] as const;

const QUICK_MISC_ITEM_NAMES = [
  'ผักสด/ของสด',
  'ของฝากขาย',
  'สินค้าเบ็ดเตล็ด',
  'น้ำแข็ง/น้ำดื่มแบ่งขาย',
] as const;

const QUICK_MISC_ITEM_PRICES = [5, 10, 15, 20, 25, 30, 50] as const;

interface PosBundleItem {
  product_id: string;
  unit_id?: string | null;
  qty: number;
}

interface PosBundle {
  id: string;
  name: string;
  items: PosBundleItem[];
}

interface ContainerDeposit {
  id: string;
  customerName: string;
  itemLabel: string;
  qty: number;
  depositAmount: number;
  createdAt: string;
}

const QUICK_HELD_BILL_TAGS = [
  'รอกลับมาหยิบของ',
  'รอโอนเงิน',
  'ใส่ถุงไว้แล้ว',
] as const;

const QUICK_CART_ITEM_NOTES = [
  'แยกถุง',
  'แช่เย็น',
  'มัดจำขวด',
  'ฝากของไว้ก่อน',
] as const;

const QUICK_CONTAINER_TYPES = [
  'ขวดเบียร์/โซดา',
  'ลังพลาสติก',
  'ถังน้ำดื่ม 20L',
  'ถังน้ำแข็ง',
] as const;

const QUICK_DEPOSIT_AMOUNTS = [10, 20, 50, 100, 150, 200] as const;

const PARTIAL_RETURN_REASONS = [
  'ลูกค้าเปลี่ยนใจ',
  'หยิบผิดรุ่น/ขนาด',
  'สินค้าชำรุด',
] as const;

type PartialReturnReason = (typeof PARTIAL_RETURN_REASONS)[number];

function toggleCartItemNoteTag(currentNote: string, tag: string): string {
  const parts = currentNote
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.includes(tag)) {
    return parts.filter((part) => part !== tag).join(', ');
  }
  return [...parts, tag].join(', ');
}

function buildItemNotesSummary(
  items: ReadonlyArray<CartItem>,
  notesMap: Record<string, string>
): string {
  const entries = items
    .map((item) => {
      const note = (notesMap[item.key] ?? '').trim();
      if (!note) return '';
      return `${item.product_name} (${note})`;
    })
    .filter(Boolean);
  if (entries.length === 0) return '';
  return `โน้ตรายสินค้า: ${entries.join(', ')}`;
}

const THAI_CHANGE_DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;

interface ChangeBreakdownItem {
  key: string;
  label: string;
  count: number;
  kind: 'banknote' | 'coin';
  denomBaht: number;
  showMultiplier: boolean;
}

/** Break a positive Baht amount into Thai banknotes and coins for cashier change picking. */
function getChangeBreakdownItems(amount: number): ChangeBreakdownItem[] {
  const totalSatang = Math.round(amount * 100);
  if (!Number.isFinite(totalSatang) || totalSatang <= 0) return [];

  const items: ChangeBreakdownItem[] = [];
  let remainingBaht = Math.floor(totalSatang / 100);
  let remainingSatang = totalSatang % 100;

  for (const denom of THAI_CHANGE_DENOMINATIONS) {
    const count = Math.floor(remainingBaht / denom);
    if (count > 0) {
      items.push({
        key: `baht-${denom}`,
        label: `฿${formatNumber(denom)}`,
        count,
        kind: denom >= 20 ? 'banknote' : 'coin',
        denomBaht: denom,
        showMultiplier: true,
      });
      remainingBaht -= count * denom;
    }
  }

  if (remainingSatang >= 50) {
    const count50 = Math.floor(remainingSatang / 50);
    items.push({
      key: 'satang-50',
      label: '50 สต.',
      count: count50,
      kind: 'coin',
      denomBaht: 0.5,
      showMultiplier: true,
    });
    remainingSatang -= count50 * 50;
  }

  if (remainingSatang >= 25) {
    const count25 = Math.floor(remainingSatang / 25);
    items.push({
      key: 'satang-25',
      label: '25 สต.',
      count: count25,
      kind: 'coin',
      denomBaht: 0.25,
      showMultiplier: true,
    });
    remainingSatang -= count25 * 25;
  }

  if (remainingSatang > 0) {
    items.push({
      key: `satang-${remainingSatang}`,
      label: `${remainingSatang} สตางค์`,
      count: 1,
      kind: 'coin',
      denomBaht: remainingSatang / 100,
      showMultiplier: false,
    });
  }

  return items;
}

const BANKNOTE_CHIP_STYLES: Record<number, string> = {
  1000: 'border-stone-300 bg-stone-100 text-stone-800',
  500: 'border-purple-300 bg-purple-100 text-purple-900',
  100: 'border-rose-300 bg-rose-100 text-rose-900',
  50: 'border-sky-300 bg-sky-100 text-sky-900',
  20: 'border-emerald-300 bg-emerald-100 text-emerald-900',
};

function renderChangeBreakdownBar(amount: number, variant: 'checkout' | 'receipt') {
  const items = getChangeBreakdownItems(amount);
  if (items.length === 0) return null;

  const totalPieces = items.reduce((sum, item) => sum + item.count, 0);
  const containerClass =
    variant === 'receipt'
      ? 'rounded-xl bg-white/95 border border-emerald-400/50 px-3 py-2.5 text-slate-800 space-y-1.5'
      : 'border-t border-emerald-200/80 pt-2 mt-1.5 space-y-1.5';

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-emerald-800">
        <span>แนะนำการหยิบธนบัตร / เหรียญทอน</span>
        <span className="tabular-nums text-emerald-700">
          รวม {formatNumber(totalPieces)} ชิ้น
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map((item) => {
          const chipColor =
            item.kind === 'banknote'
              ? BANKNOTE_CHIP_STYLES[item.denomBaht] ??
                'border-slate-300 bg-slate-100 text-slate-800'
              : 'border-amber-300 bg-amber-100 text-amber-900';
          const unitWord = item.kind === 'banknote' ? 'ใบ' : 'เหรียญ';
          const kindLabel = item.kind === 'banknote' ? 'ธนบัตร' : 'เหรียญ';
          return (
            <span
              key={item.key}
              title={
                item.showMultiplier
                  ? `${kindLabel} ${item.label} จำนวน ${item.count} ${unitWord}`
                  : item.label
              }
              className={`inline-flex items-center gap-1 border px-2 py-0.5 text-xs font-bold tabular-nums shadow-2xs ${
                item.kind === 'banknote' ? 'rounded-md' : 'rounded-full'
              } ${chipColor}`}
            >
              {item.showMultiplier ? `${item.label} × ${item.count}` : item.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const HELD_BILLS_STORAGE_KEY = 'pos_held_bills_v1';
const SOUND_ENABLED_STORAGE_KEY = 'pos_sound_enabled_v1';
const GRID_DENSITY_STORAGE_KEY = 'pos_grid_density_v1';
const CREDIT_LIMITS_STORAGE_KEY = 'customer_credit_limits_v1';
const DUE_DATES_STORAGE_KEY = 'customer_due_dates_v1';
const PINNED_PRODUCTS_STORAGE_KEY = 'pos_pinned_product_ids_v1';
const LOYALTY_POINTS_STORAGE_KEY = 'customer_loyalty_points_v1';
const DEFAULT_DISCOUNT_PCT_STORAGE_KEY = 'customer_default_discount_pct_v1';
const STORE_CREDIT_STORAGE_KEY = 'customer_store_credit_v1';
const CONTACT_NOTES_STORAGE_KEY = 'customer_contact_notes_v1';
const EXPIRY_DATES_STORAGE_KEY = 'inventory_expiry_dates_v1';
const SHELF_LOCATIONS_STORAGE_KEY = 'inventory_shelf_locations_v1';
const SUBSTITUTE_NOTES_STORAGE_KEY = 'inventory_substitute_notes_v1';
const PROMO_LABELS_STORAGE_KEY = 'inventory_promo_labels_v1';
const WHOLESALE_TIERS_STORAGE_KEY = 'inventory_wholesale_tiers_v1';
const POS_BUNDLES_STORAGE_KEY = 'pos_bundles_v1';
const CONTAINER_DEPOSITS_STORAGE_KEY = 'pos_container_deposits_v1';
const RECEIPT_FOOTER_STORAGE_KEY = 'pos_receipt_footer_v1';
const SHIFT_HANDOVER_MEMO_STORAGE_KEY = 'pos_shift_handover_memo_v1';
const MISC_PRESETS_STORAGE_KEY = 'pos_misc_presets_v1';
const UNIT_BARCODES_STORAGE_KEY = 'inventory_unit_barcodes_v1';
const LAST_COST_HISTORY_STORAGE_KEY = 'inventory_last_cost_history_v1';
const CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY = 'customer_followup_logs_v1';
const CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY = 'customer_payday_cycles_v1';
const CUSTOMER_TAGS_STORAGE_KEY = 'customer_tags_v1';
const TARGET_STOCK_STORAGE_KEY = 'inventory_target_stock_v1';
const SUPPLIERS_STORAGE_KEY = 'inventory_suppliers_v1';
const DEFAULT_RECEIPT_FOOTER = 'ขอบคุณที่อุดหนุนครับ/ค่ะ โอกาสหน้าเชิญใหม่';
const LOYALTY_BAHT_PER_EARN_POINT = 25;
const LOYALTY_POINTS_PER_DISCOUNT_BAHT = 10;

interface LastCostHistoryEntry {
  prevCost: number;
  updatedAt: string;
}

function parseLastCostHistoryMap(raw: string | null): Record<string, LastCostHistoryEntry> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, LastCostHistoryEntry> = {};
    for (const [productId, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
      const entry = val as Record<string, unknown>;
      const prevCost = Number(entry.prevCost);
      const updatedAt = typeof entry.updatedAt === 'string' ? entry.updatedAt.trim() : '';
      if (Number.isFinite(prevCost) && prevCost >= 0 && updatedAt) {
        clean[productId] = { prevCost, updatedAt };
      }
    }
    return clean;
  } catch {
    return {};
  }
}

interface ShiftHandoverMemo {
  text: string;
  author: string;
  updatedAt: string;
  urgent: boolean;
}

function parseShiftHandoverMemo(raw: string | null): ShiftHandoverMemo | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const text = typeof obj.text === 'string' ? obj.text.trim() : '';
    if (!text) return null;
    const author = typeof obj.author === 'string' ? obj.author.trim() : '';
    const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : '';
    const urgent = Boolean(obj.urgent);
    return { text, author, updatedAt, urgent };
  } catch {
    return null;
  }
}

interface QuickMiscPreset {
  name: string;
  price: number;
  cost: number;
}

function parseQuickMiscPresets(raw: string | null): QuickMiscPreset[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const results: QuickMiscPreset[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const obj = item as Record<string, unknown>;
      const name = typeof obj.name === 'string' ? obj.name.trim() : '';
      const price = Number(obj.price);
      const rawCost = Number(obj.cost);
      const cost = Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : 0;
      if (!name || !Number.isFinite(price) || price <= 0) continue;
      const dedupeKey = name.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      results.push({ name, price, cost });
    }
    return results;
  } catch {
    return [];
  }
}

const QUICK_SERVICE_FEES = [
  { id: 'ice_bag', label: '+฿5 ค่าถุง/น้ำแข็ง', name: 'ค่าถุง/น้ำแข็ง', price: 5 },
  { id: 'delivery_near', label: '+฿10 ค่าส่งใกล้บ้าน', name: 'ค่าส่งใกล้บ้าน', price: 10 },
  { id: 'delivery_home', label: '+฿20 ค่าส่งถึงบ้าน', name: 'ค่าส่งถึงบ้าน', price: 20 },
] as const;

interface WholesaleTier {
  minQty: number;
  unitPrice: number;
}

type ExpiryStatus = 'expired' | 'expiring_soon' | 'normal';

interface ExpiryInfo {
  expiryIso: string;
  formattedDate: string;
  daysRemaining: number;
  status: ExpiryStatus;
}

function parseIsoDateUtcMs(iso: string): number | null {
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
}

/** Parse a JSON Record<string, string> retaining only valid YYYY-MM-DD entries. */
function parseIsoDateMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, string> = {};
    for (const [entryId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (parseIsoDateUtcMs(trimmed) !== null) {
          clean[entryId] = trimmed;
        }
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function toLocalIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addLocalDaysIso(baseDate: Date, days: number): string {
  return toLocalIsoDate(
    new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + days)
  );
}

function endOfMonthIso(baseDate: Date): string {
  return toLocalIsoDate(new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0));
}

function computeNextPaydayDueDateIso(baseDate: Date, cycleRaw: string): string {
  const cycle = cycleRaw.trim();
  const todayIsoLocal = toLocalIsoDate(baseDate);
  if (!cycle) return addLocalDaysIso(baseDate, 7);

  if (cycle.includes('สัปดาห์')) {
    const dow = baseDate.getDay();
    let targetDow = -1;
    if (cycle.includes('เสาร์')) targetDow = 6;
    else if (cycle.includes('ศุกร์')) targetDow = 5;
    else if (cycle.includes('อาทิตย์')) targetDow = 0;
    if (targetDow >= 0) {
      const diff = (targetDow - dow + 7) % 7;
      return addLocalDaysIso(baseDate, diff === 0 ? 7 : diff);
    }
    return addLocalDaysIso(baseDate, 7);
  }

  const dayNumbers: number[] = [];
  const matches = cycle.match(/\b(\d{1,2})\b/g);
  if (matches) {
    for (const m of matches) {
      const n = Number(m);
      if (Number.isInteger(n) && n >= 1 && n <= 31) {
        dayNumbers.push(n);
      }
    }
  }
  const hasEndOfMonth = cycle.includes('สิ้นเดือน');

  if (dayNumbers.length > 0 || hasEndOfMonth) {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const candidates: string[] = [];

    for (const offset of [0, 1]) {
      const lastDay = new Date(year, month + offset + 1, 0).getDate();
      for (const day of dayNumbers) {
        const clampedDay = Math.min(day, lastDay);
        candidates.push(toLocalIsoDate(new Date(year, month + offset, clampedDay)));
      }
      if (hasEndOfMonth) {
        candidates.push(toLocalIsoDate(new Date(year, month + offset + 1, 0)));
      }
    }

    candidates.sort();
    const nextIso = candidates.find((iso) => iso > todayIsoLocal);
    if (nextIso) return nextIso;
  }

  return addLocalDaysIso(baseDate, 7);
}

type CustomerDueStatus = 'overdue' | 'due_today' | 'upcoming';

interface CustomerDueInfo {
  dueDate: string;
  formattedDate: string;
  daysDiff: number;
  status: CustomerDueStatus;
}

/** Evaluate a customer's due date status relative to todayIso when debt > 0. */
function getCustomerDueInfo(
  dueDate: string | undefined,
  todayIso: string,
  totalDebt: number
): CustomerDueInfo | null {
  if (!dueDate || !todayIso || totalDebt <= 0) return null;
  const dueMs = parseIsoDateUtcMs(dueDate);
  const todayMs = parseIsoDateUtcMs(todayIso);
  if (dueMs === null || todayMs === null) return null;
  const daysDiff = Math.round((dueMs - todayMs) / 86_400_000);
  const status: CustomerDueStatus =
    dueDate < todayIso
      ? 'overdue'
      : dueDate === todayIso
        ? 'due_today'
        : 'upcoming';
  return {
    dueDate,
    formattedDate: formatExpiryDateTh(dueDate),
    daysDiff,
    status,
  };
}

function getCustomerDueSelectLabel(dueInfo: CustomerDueInfo | null): string {
  if (!dueInfo) return '';
  if (dueInfo.status === 'overdue') return ' | ⚠️ เลยกำหนดชำระ';
  if (dueInfo.status === 'due_today') return ' | นัดชำระวันนี้';
  return '';
}

function renderCustomerDueBadge(
  dueInfo: CustomerDueInfo | null,
  totalDebt: number,
  compact = false
) {
  if (!dueInfo || (dueInfo.status !== 'overdue' && dueInfo.status !== 'due_today')) {
    return null;
  }
  const sizeClass = compact
    ? 'px-1.5 py-0.5 text-[10px]'
    : 'px-2 py-0.5 text-[11px]';
  if (dueInfo.status === 'overdue') {
    return (
      <span
        title={`นัดชำระ ${dueInfo.formattedDate} • ค้าง ${formatBaht(totalDebt)}`}
        className={`inline-flex items-center gap-0.5 rounded-full border border-rose-300 bg-rose-100 ${sizeClass} font-bold text-rose-700 whitespace-nowrap shrink-0`}
      >
        ⚠️ เลยกำหนดชำระ
      </span>
    );
  }
  return (
    <span
      title={`นัดชำระวันนี้ (${dueInfo.formattedDate}) • ค้าง ${formatBaht(totalDebt)}`}
      className={`inline-flex items-center gap-0.5 rounded-full border border-orange-300 bg-orange-100 ${sizeClass} font-bold text-orange-800 whitespace-nowrap shrink-0`}
    >
      นัดชำระวันนี้
    </span>
  );
}

type CreditHealthLevel = 'good' | 'watch' | 'risk';

interface CreditHealthInfo {
  level: CreditHealthLevel;
  label: string;
  usagePct: number | null;
  detail: string;
}

/** Evaluate customer credit discipline badge consistent with the customers page. */
function getCustomerCreditHealth(
  debt: number,
  creditLimit: number | undefined,
  dueInfo: CustomerDueInfo | null
): CreditHealthInfo | null {
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
}

function renderCustomerCreditHealthBadge(
  creditHealth: CreditHealthInfo | null,
  compact = false
) {
  if (!creditHealth) return null;
  const sizeClass = compact
    ? 'px-1.5 py-0.5 text-[10px]'
    : 'px-2 py-0.5 text-[11px]';
  const toneClass =
    creditHealth.level === 'risk'
      ? 'border-rose-300 bg-rose-100 text-rose-800'
      : creditHealth.level === 'watch'
        ? 'border-amber-300 bg-amber-100 text-amber-900'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  return (
    <span
      title={creditHealth.detail}
      className={`inline-flex items-center gap-0.5 rounded-full border ${sizeClass} ${toneClass} font-bold whitespace-nowrap shrink-0`}
    >
      {creditHealth.label}
    </span>
  );
}

function formatExpiryDateTh(iso: string): string {
  const utcMs = parseIsoDateUtcMs(iso);
  if (utcMs === null) return iso;
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(utcMs));
}

function getProductExpiryInfo(
  expiryIso: string | undefined,
  todayIso: string
): ExpiryInfo | null {
  if (!expiryIso || !todayIso) return null;
  const expiryMs = parseIsoDateUtcMs(expiryIso);
  const todayMs = parseIsoDateUtcMs(todayIso);
  if (expiryMs === null || todayMs === null) return null;
  const daysRemaining = Math.round((expiryMs - todayMs) / 86_400_000);
  const status: ExpiryStatus =
    expiryIso < todayIso
      ? 'expired'
      : daysRemaining <= 7
        ? 'expiring_soon'
        : 'normal';
  return {
    expiryIso,
    formattedDate: formatExpiryDateTh(expiryIso),
    daysRemaining,
    status,
  };
}

function parseLoyaltyPointsMap(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const normalized: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const num = Math.floor(Number(v));
        if (Number.isFinite(num) && num >= 0) {
          normalized[k] = num;
        }
      }
      return normalized;
    }
  } catch {
    // ignore malformed JSON
  }
  return {};
}

function parseStoreCreditMap(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const normalized: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const num = Number(v);
        if (Number.isFinite(num) && num > 0) {
          normalized[k] = Math.round(num * 100) / 100;
        }
      }
      return normalized;
    }
  } catch {
    // ignore malformed JSON
  }
  return {};
}

function normalizeDiscountPct(val: unknown): number {
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(100, Math.round(num * 100) / 100);
}

function parseDefaultDiscountPctMap(raw: string | null): Record<string, number> {
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
}

function parseProductStringMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, string> = {};
    for (const [productId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          clean[productId] = trimmed;
        }
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function parseProductNumberMap(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, number> = {};
    for (const [productId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const num = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(num) && num > 0) {
        clean[productId] = num;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

interface CustomerFollowupLogItem {
  id: string;
  text: string;
  createdAt: string;
}

function parseCustomerFollowupLogsMap(
  raw: string | null
): Record<string, CustomerFollowupLogItem[]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, CustomerFollowupLogItem[]> = {};
    for (const [customerId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const entries: CustomerFollowupLogItem[] = [];
      for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const obj = item as Record<string, unknown>;
        const text = typeof obj.text === 'string' ? obj.text.trim() : '';
        if (!text) continue;
        const id = typeof obj.id === 'string' ? obj.id : '';
        const createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : '';
        entries.push({ id, text, createdAt });
      }
      if (entries.length > 0) {
        clean[customerId] = entries;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function parseUnitBarcodesMap(
  raw: string | null
): Record<string, Record<string, string>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, Record<string, string>> = {};
    for (const [productId, unitMap] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (!unitMap || typeof unitMap !== 'object' || Array.isArray(unitMap)) continue;
      const inner: Record<string, string> = {};
      for (const [unitKey, barcode] of Object.entries(
        unitMap as Record<string, unknown>
      )) {
        if (typeof barcode === 'string') {
          const trimmed = barcode.trim();
          if (trimmed) {
            inner[unitKey] = trimmed;
          }
        }
      }
      if (Object.keys(inner).length > 0) {
        clean[productId] = inner;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function parsePosBundles(raw: string | null): PosBundle[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const bundles: PosBundle[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const rec = entry as Record<string, unknown>;
      const id = typeof rec.id === 'string' ? rec.id.trim() : '';
      const name = typeof rec.name === 'string' ? rec.name.trim() : '';
      if (!id || !name || !Array.isArray(rec.items)) continue;
      const items: PosBundleItem[] = [];
      for (const rawItem of rec.items) {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
        const itemRec = rawItem as Record<string, unknown>;
        const productId =
          typeof itemRec.product_id === 'string' ? itemRec.product_id.trim() : '';
        const qty = Math.floor(Number(itemRec.qty));
        if (!productId || !Number.isFinite(qty) || qty <= 0) continue;
        const unitId =
          typeof itemRec.unit_id === 'string' && itemRec.unit_id.trim()
            ? itemRec.unit_id.trim()
            : null;
        items.push({
          product_id: productId,
          unit_id: unitId,
          qty,
        });
      }
      if (items.length > 0) {
        bundles.push({ id, name, items });
      }
    }
    return bundles;
  } catch {
    return [];
  }
}

function parseWholesaleTiersMap(raw: string | null): Record<string, WholesaleTier> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, WholesaleTier> = {};
    for (const [productId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const trimmedId = productId.trim();
      if (!trimmedId || !value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      const rec = value as Record<string, unknown>;
      const minQty = Math.floor(Number(rec.minQty));
      const unitPrice = Math.round(Number(rec.unitPrice) * 100) / 100;
      if (
        Number.isFinite(minQty) &&
        minQty >= 2 &&
        Number.isFinite(unitPrice) &&
        unitPrice > 0
      ) {
        clean[trimmedId] = { minQty, unitPrice };
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function resolveWholesaleItemPrice(params: {
  productId: string | null;
  unitName: string;
  conversionRate: number;
  qty: number;
  availableUnits?: ProductUnit[];
  product?: Product;
  wholesaleTiers: Record<string, WholesaleTier>;
  isManualPrice: boolean;
}): number | null {
  if (params.isManualPrice || !params.productId || params.product?.allow_custom_price) {
    return null;
  }
  if (Math.abs(Number(params.conversionRate) - 1) > 1e-9) {
    return null;
  }
  const units = params.availableUnits ?? params.product?.product_units ?? [];
  const standardUnit = units.find((u) => u.unit_name === params.unitName);
  if (!standardUnit) {
    return null;
  }
  const tier = params.wholesaleTiers[params.productId];
  if (tier && params.qty >= tier.minQty) {
    return tier.unitPrice;
  }
  return Number(standardUnit.selling_price);
}

function syncCartWholesalePrices(
  items: CartItem[],
  wholesaleTiers: Record<string, WholesaleTier>,
  productById: Map<string, Product>,
  manualPriceKeys: Set<string>
): CartItem[] {
  let changed = false;
  const next = items.map((item) => {
    const prod = item.product_id ? productById.get(item.product_id) : undefined;
    const resolved = resolveWholesaleItemPrice({
      productId: item.product_id,
      unitName: item.unit_name,
      conversionRate: item.conversion_rate,
      qty: item.qty,
      availableUnits: item.available_units,
      product: prod,
      wholesaleTiers,
      isManualPrice: manualPriceKeys.has(item.key),
    });
    if (resolved !== null && resolved !== item.unit_price) {
      changed = true;
      return { ...item, unit_price: resolved };
    }
    return item;
  });
  return changed ? next : items;
}

function parseSplitAmountsFromNote(
  note: string | null | undefined
): { partialCash: number; qrAmount: number } | null {
  if (!note) return null;
  const match =
    /แยกจ่าย:\s*เงินสด\s*฿([\d,]+(?:\.\d+)?)\s*\+\s*โอน QR\s*฿([\d,]+(?:\.\d+)?)/.exec(
      note
    ) ??
    /แบ่งจ่ายเงินสด\s*([\d,]+(?:\.\d+)?)\s*฿\s*\+\s*สแกน QR\s*([\d,]+(?:\.\d+)?)\s*฿/.exec(
      note
    );
  if (!match) return null;
  const partialCash = Number(match[1].replace(/,/g, ''));
  const qrAmount = Number(match[2].replace(/,/g, ''));
  if (!Number.isFinite(partialCash) || !Number.isFinite(qrAmount) || partialCash <= 0) {
    return null;
  }
  return { partialCash, qrAmount };
}

function getReceiptSplitInfo(receipt: CompletedReceipt): {
  hasSplit: boolean;
  cashPart: number;
  qrPart: number;
} {
  const cashPart = Number(receipt.partialCash ?? 0);
  if (
    (receipt.paymentMethod === 'cash' || receipt.paymentMethod === 'qr') &&
    cashPart > 0
  ) {
    const qrPart =
      receipt.qrAmount !== undefined
        ? Number(receipt.qrAmount)
        : Math.max(0, Number((receipt.total - cashPart).toFixed(2)));
    return { hasSplit: true, cashPart, qrPart };
  }
  return { hasSplit: false, cashPart: 0, qrPart: 0 };
}

function parseCreditDownPaymentFromNote(
  note: string | null | undefined
): { downPayment: number; netCreditRemaining: number } | null {
  if (!note) return null;
  const match =
    /จ่ายสดบางส่วนวันนี้\s*฿([\d,]+(?:\.\d+)?)\s*\(ค้างเชื่อสุทธิ\s*฿([\d,]+(?:\.\d+)?)\)/.exec(
      note
    );
  if (!match) return null;
  const downPayment = Number(match[1].replace(/,/g, ''));
  const netCreditRemaining = Number(match[2].replace(/,/g, ''));
  if (
    !Number.isFinite(downPayment) ||
    !Number.isFinite(netCreditRemaining) ||
    downPayment <= 0
  ) {
    return null;
  }
  return { downPayment, netCreditRemaining };
}

function getReceiptCreditDownPaymentInfo(receipt: CompletedReceipt): {
  hasCreditDownPayment: boolean;
  downPayment: number;
  netCreditRemaining: number;
} {
  if (receipt.paymentMethod !== 'credit') {
    return { hasCreditDownPayment: false, downPayment: 0, netCreditRemaining: 0 };
  }
  const downPayment = Number(receipt.creditDownPayment ?? 0);
  if (downPayment > 0 && downPayment < receipt.total) {
    const netCreditRemaining =
      receipt.creditRemainingDebt !== undefined
        ? Number(receipt.creditRemainingDebt)
        : Math.max(0, Number((receipt.total - downPayment).toFixed(2)));
    return { hasCreditDownPayment: true, downPayment, netCreditRemaining };
  }
  const parsed = parseCreditDownPaymentFromNote(receipt.note);
  if (parsed && parsed.downPayment > 0 && parsed.downPayment < receipt.total) {
    return {
      hasCreditDownPayment: true,
      downPayment: parsed.downPayment,
      netCreditRemaining: parsed.netCreditRemaining,
    };
  }
  return { hasCreditDownPayment: false, downPayment: 0, netCreditRemaining: 0 };
}

function computeDebtFractionAmount(debt: number): number {
  if (!Number.isFinite(debt) || debt <= 0) return 0;
  const mod100 = Math.round((debt % 100) * 100) / 100;
  if (debt > 100 && mod100 > 0) return mod100;
  const mod10 = Math.round((debt % 10) * 100) / 100;
  if (debt > 10 && mod10 > 0) return mod10;
  const decimalPart = Math.round((debt - Math.floor(debt)) * 100) / 100;
  return decimalPart > 0 ? decimalPart : 0;
}

function formatCombinedDebtSettlementSummary(
  billTotal: number,
  oldDebtSettled: number,
  oldDebtRemaining: number
): string {
  const totalCollected = Number((billTotal + oldDebtSettled).toFixed(2));
  return `ยอดซื้อบิลนี้ ฿${formatNumber(billTotal)} + ชำระหนี้เดิม ฿${formatNumber(
    oldDebtSettled
  )} = รวมรับชำระ ฿${formatNumber(totalCollected)} (หนี้คงเหลือ ฿${formatNumber(
    Math.max(0, oldDebtRemaining)
  )})`;
}

function createBundleId(): string {
  return `bundle_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function parseContainerDeposits(raw: string | null): ContainerDeposit[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const list: ContainerDeposit[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const rec = entry as Record<string, unknown>;
      const id = typeof rec.id === 'string' ? rec.id.trim() : '';
      const customerName =
        typeof rec.customerName === 'string' ? rec.customerName.trim() : '';
      const itemLabel =
        typeof rec.itemLabel === 'string' ? rec.itemLabel.trim() : '';
      const qty = Number(rec.qty);
      const depositAmount = Number(rec.depositAmount);
      const createdAt =
        typeof rec.createdAt === 'string' ? rec.createdAt.trim() : '';
      if (
        !id ||
        !itemLabel ||
        !Number.isFinite(qty) ||
        qty <= 0 ||
        !Number.isFinite(depositAmount) ||
        depositAmount < 0 ||
        !createdAt
      ) {
        continue;
      }
      list.push({
        id,
        customerName: customerName || 'ลูกค้าทั่วไป',
        itemLabel,
        qty: Math.round(qty * 100) / 100,
        depositAmount: Math.round(depositAmount * 100) / 100,
        createdAt,
      });
    }
    return list;
  } catch {
    return [];
  }
}

function createContainerDepositId(): string {
  return `dep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function formatDepositDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return formatDateTime(iso);
}

function parsePinnedProductIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const entry of parsed) {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (trimmed && !seen.has(trimmed)) {
          seen.add(trimmed);
          clean.push(trimmed);
        }
      }
    }
    return clean;
  } catch {
    return [];
  }
}

function parseHeldBills(raw: string | null): HeldBill[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const bills: HeldBill[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const rec = entry as Record<string, unknown>;
      const id = typeof rec.id === 'string' ? rec.id.trim() : '';
      const createdAt = typeof rec.createdAt === 'string' ? rec.createdAt.trim() : '';
      if (!id || !createdAt || !Array.isArray(rec.items)) continue;
      const items: CartItem[] = [];
      for (const rawItem of rec.items) {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
        const itemRec = rawItem as Record<string, unknown>;
        const key = typeof itemRec.key === 'string' ? itemRec.key.trim() : '';
        const productName =
          typeof itemRec.product_name === 'string' ? itemRec.product_name.trim() : '';
        const unitName =
          typeof itemRec.unit_name === 'string' ? itemRec.unit_name.trim() : '';
        const qty = Number(itemRec.qty);
        const unitPrice = Number(itemRec.unit_price);
        if (
          !key ||
          !productName ||
          !unitName ||
          !Number.isFinite(qty) ||
          qty <= 0 ||
          !Number.isFinite(unitPrice) ||
          unitPrice < 0
        ) {
          continue;
        }
        items.push({
          key,
          product_id: typeof itemRec.product_id === 'string' ? itemRec.product_id : null,
          product_name: productName,
          unit_name: unitName,
          conversion_rate: Number.isFinite(Number(itemRec.conversion_rate))
            ? Number(itemRec.conversion_rate)
            : 1,
          unit_price: unitPrice,
          unit_cost: Number.isFinite(Number(itemRec.unit_cost))
            ? Number(itemRec.unit_cost)
            : 0,
          qty,
          available_units: Array.isArray(itemRec.available_units)
            ? (itemRec.available_units as ProductUnit[])
            : undefined,
        });
      }
      if (items.length === 0) continue;
      const computedTotal = items.reduce((sum, i) => sum + i.unit_price * i.qty, 0);
      const computedCount = items.reduce((sum, i) => sum + i.qty, 0);
      let itemNotes: Record<string, string> | undefined;
      if (
        rec.itemNotes &&
        typeof rec.itemNotes === 'object' &&
        !Array.isArray(rec.itemNotes)
      ) {
        const cleanNotes: Record<string, string> = {};
        for (const [k, v] of Object.entries(rec.itemNotes as Record<string, unknown>)) {
          if (typeof v === 'string' && v.trim()) {
            cleanNotes[k] = v.trim();
          }
        }
        if (Object.keys(cleanNotes).length > 0) {
          itemNotes = cleanNotes;
        }
      }
      const rawOrderType = rec.orderType;
      const orderType: HeldBillOrderType | undefined =
        rawOrderType === 'walk_in' ||
        rawOrderType === 'pickup' ||
        rawOrderType === 'delivery'
          ? rawOrderType
          : undefined;
      const deliveryInfo =
        typeof rec.deliveryInfo === 'string' && rec.deliveryInfo.trim()
          ? rec.deliveryInfo.trim()
          : undefined;
      const rawPackingStatus = rec.packingStatus;
      const packingStatus: 'pending' | 'packed' | undefined =
        rawPackingStatus === 'pending' || rawPackingStatus === 'packed'
          ? rawPackingStatus
          : undefined;
      const rawDeliveryStatus = rec.deliveryStatus;
      const deliveryStatus: 'waiting' | 'out_for_delivery' | undefined =
        rawDeliveryStatus === 'waiting' || rawDeliveryStatus === 'out_for_delivery'
          ? rawDeliveryStatus
          : undefined;
      const riderName =
        typeof rec.riderName === 'string' && rec.riderName.trim()
          ? rec.riderName.trim()
          : undefined;
      bills.push({
        id,
        items,
        total: Number.isFinite(Number(rec.total)) ? Number(rec.total) : computedTotal,
        count: Number.isFinite(Number(rec.count)) ? Number(rec.count) : computedCount,
        note: typeof rec.note === 'string' ? rec.note : '',
        tag: typeof rec.tag === 'string' && rec.tag.trim() ? rec.tag.trim() : undefined,
        orderType,
        deliveryInfo,
        packingStatus,
        deliveryStatus,
        riderName,
        customerId:
          typeof rec.customerId === 'string' && rec.customerId.trim()
            ? rec.customerId.trim()
            : undefined,
        customerName:
          typeof rec.customerName === 'string' && rec.customerName.trim()
            ? rec.customerName.trim()
            : undefined,
        itemNotes,
        createdAt,
      });
    }
    return bills;
  } catch {
    return [];
  }
}

interface PosMetaBackupParsed {
  keysPresent: Array<
    | typeof PINNED_PRODUCTS_STORAGE_KEY
    | typeof POS_BUNDLES_STORAGE_KEY
    | typeof RECEIPT_FOOTER_STORAGE_KEY
    | typeof CONTAINER_DEPOSITS_STORAGE_KEY
    | typeof HELD_BILLS_STORAGE_KEY
    | typeof SHIFT_HANDOVER_MEMO_STORAGE_KEY
    | typeof MISC_PRESETS_STORAGE_KEY
    | typeof STORE_CREDIT_STORAGE_KEY
  >;
  pinnedIds?: string[];
  bundles?: PosBundle[];
  receiptFooter?: string;
  containerDeposits?: ContainerDeposit[];
  heldBills?: HeldBill[];
  shiftHandoverMemo?: ShiftHandoverMemo | null;
  miscPresets?: QuickMiscPreset[];
  customerStoreCredits?: Record<string, number>;
  error?: string;
}

function isPlainRecordObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function parsePosMetaBackupJson(rawText: string): PosMetaBackupParsed {
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
    PINNED_PRODUCTS_STORAGE_KEY,
    POS_BUNDLES_STORAGE_KEY,
    RECEIPT_FOOTER_STORAGE_KEY,
    CONTAINER_DEPOSITS_STORAGE_KEY,
    HELD_BILLS_STORAGE_KEY,
    SHIFT_HANDOVER_MEMO_STORAGE_KEY,
    MISC_PRESETS_STORAGE_KEY,
    STORE_CREDIT_STORAGE_KEY,
  ] as const;

  const hasRootKey = allKeys.some((k) =>
    Object.prototype.hasOwnProperty.call(parsed, k)
  );
  const source: Record<string, unknown> =
    !hasRootKey && isPlainRecordObject(parsed.data) ? parsed.data : parsed;

  const keysPresent: PosMetaBackupParsed['keysPresent'] = [];
  const result: PosMetaBackupParsed = { keysPresent };

  for (const key of allKeys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const rawVal = source[key];
    if (key === RECEIPT_FOOTER_STORAGE_KEY) {
      if (typeof rawVal !== 'string') {
        return {
          keysPresent: [],
          error: `ข้อมูลของ "${key}" ต้องเป็นข้อความ (String)`,
        };
      }
      keysPresent.push(key);
      result.receiptFooter = rawVal.trim() || DEFAULT_RECEIPT_FOOTER;
      continue;
    }

    if (key === SHIFT_HANDOVER_MEMO_STORAGE_KEY) {
      if (rawVal !== null && !isPlainRecordObject(rawVal)) {
        return {
          keysPresent: [],
          error: `ข้อมูลของ "${key}" ต้องเป็น Object ({ ... }) หรือ null`,
        };
      }
      keysPresent.push(key);
      result.shiftHandoverMemo =
        rawVal === null ? null : parseShiftHandoverMemo(JSON.stringify(rawVal));
      continue;
    }

    if (key === STORE_CREDIT_STORAGE_KEY) {
      if (!isPlainRecordObject(rawVal)) {
        return {
          keysPresent: [],
          error: `ข้อมูลของ "${key}" ต้องเป็น Object ({ ... })`,
        };
      }
      keysPresent.push(key);
      result.customerStoreCredits = parseStoreCreditMap(JSON.stringify(rawVal));
      continue;
    }

    if (!Array.isArray(rawVal)) {
      return {
        keysPresent: [],
        error: `ข้อมูลของ "${key}" ต้องเป็น Array ([ ... ])`,
      };
    }
    keysPresent.push(key);
    const serialized = JSON.stringify(rawVal);
    if (key === PINNED_PRODUCTS_STORAGE_KEY) {
      result.pinnedIds = parsePinnedProductIds(serialized);
    } else if (key === POS_BUNDLES_STORAGE_KEY) {
      result.bundles = parsePosBundles(serialized);
    } else if (key === CONTAINER_DEPOSITS_STORAGE_KEY) {
      result.containerDeposits = parseContainerDeposits(serialized);
    } else if (key === HELD_BILLS_STORAGE_KEY) {
      result.heldBills = parseHeldBills(serialized);
    } else if (key === MISC_PRESETS_STORAGE_KEY) {
      result.miscPresets = parseQuickMiscPresets(serialized);
    }
  }

  if (keysPresent.length === 0) {
    return {
      keysPresent: [],
      error:
        'ไม่พบคีย์ตั้งค่า POS ที่รองรับ (pos_pinned_product_ids_v1, pos_bundles_v1, pos_receipt_footer_v1, pos_container_deposits_v1, pos_held_bills_v1, pos_shift_handover_memo_v1, pos_misc_presets_v1, customer_store_credit_v1)',
    };
  }

  return result;
}

export default function PosPage() {
  const supabase = useMemo(() => createClient(), []);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState<string>('quick'); // 'all' | 'quick' | 'pinned' | 'promo' | 'wholesale' | category_id
  const [productSort, setProductSort] = useState<'name' | 'quick'>('name');
  const [gridDensity, setGridDensity] = useState<'large' | 'compact'>('large');
  const [qtyMultiplier, setQtyMultiplier] = useState<1 | 2 | 5 | 10>(1);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  // Cart & Hold Bills
  const [cart, setCart] = useState<CartItem[]>([]);
  const [confirmClearCart, setConfirmClearCart] = useState(false);
  const [lastClearedCartSnapshot, setLastClearedCartSnapshot] = useState<{
    cart: CartItem[];
    cartItemNotes: Record<string, string>;
    manualPriceKeys: string[];
    selectedCustomerId: string;
    pointsToRedeem: number;
    vipDiscountApplied: boolean;
    billDiscount: string;
    orderNote: string;
  } | null>(null);
  const [showMorePosTools, setShowMorePosTools] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [cartItemNotes, setCartItemNotes] = useState<Record<string, string>>({});
  const [editingNoteKey, setEditingNoteKey] = useState<string | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [heldBills, setHeldBills] = useState<HeldBill[]>([]);
  const [heldBillsOpen, setHeldBillsOpen] = useState(false);
  const [heldBillsFilter, setHeldBillsFilter] = useState<'all' | HeldBillOrderType>('all');
  const [copiedHeldBillId, setCopiedHeldBillId] = useState<string | null>(null);
  const [copiedRiderSheetBillId, setCopiedRiderSheetBillId] = useState<string | null>(null);
  const [confirmClearHeldBills, setConfirmClearHeldBills] = useState(false);
  const [holdModalOpen, setHoldModalOpen] = useState(false);
  const [holdNoteInput, setHoldNoteInput] = useState('');
  const [holdTagInput, setHoldTagInput] = useState('');
  const [holdOrderTypeInput, setHoldOrderTypeInput] = useState<HeldBillOrderType>('walk_in');
  const [holdDeliveryInfoInput, setHoldDeliveryInfoInput] = useState('');
  const [splitHoldMode, setSplitHoldMode] = useState(false);
  const [splitSelectedKeys, setSplitSelectedKeys] = useState<Set<string>>(() => new Set());

  // Custom price modal
  const [customPriceProduct, setCustomPriceProduct] = useState<Product | null>(null);
  const [customPriceInput, setCustomPriceInput] = useState('');
  const [adHocOpen, setAdHocOpen] = useState(false);
  const [adHocName, setAdHocName] = useState('สินค้าเบ็ดเตล็ด');
  const [adHocPrice, setAdHocPrice] = useState('');

  // Weight & Target Budget Calculator Modal
  const [weightBudgetItemKey, setWeightBudgetItemKey] = useState<string | null>(null);
  const [weightBudgetMode, setWeightBudgetMode] = useState<'weight' | 'budget'>('weight');
  const [weightQtyInput, setWeightQtyInput] = useState('');
  const [budgetBahtInput, setBudgetBahtInput] = useState('');

  // Checkout modal
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [billDiscount, setBillDiscount] = useState<string>('');
  const [cashReceived, setCashReceived] = useState<string>('');
  const [splitCashQrEnabled, setSplitCashQrEnabled] = useState(false);
  const [partialCash, setPartialCash] = useState<string>('0');
  const [creditDownPaymentInput, setCreditDownPaymentInput] = useState<string>('');
  const [creditDueDateInput, setCreditDueDateInput] = useState<string>('');
  const [settleOldDebtInput, setSettleOldDebtInput] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [creditLimits, setCreditLimits] = useState<Record<string, number>>({});
  const [dueDates, setDueDates] = useState<Record<string, string>>({});
  const [loyaltyPoints, setLoyaltyPoints] = useState<Record<string, number>>({});
  const [storeCredits, setStoreCredits] = useState<Record<string, number>>({});
  const [defaultDiscounts, setDefaultDiscounts] = useState<Record<string, number>>({});
  const [contactNotes, setContactNotes] = useState<Record<string, string>>({});
  const [customerFollowupLogs, setCustomerFollowupLogs] = useState<
    Record<string, CustomerFollowupLogItem[]>
  >({});
  const [customerPaydayCycles, setCustomerPaydayCycles] = useState<Record<string, string>>({});
  const [customerTags, setCustomerTags] = useState<Record<string, string>>({});
  const [vipDiscountApplied, setVipDiscountApplied] = useState(false);
  const [pointsToRedeem, setPointsToRedeem] = useState<number>(0);
  const [storeCreditToUse, setStoreCreditToUse] = useState<number>(0);
  const [depositChangeToCredit, setDepositChangeToCredit] = useState<boolean>(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustContactNote, setNewCustContactNote] = useState('');
  const [quickCustomerModalOpen, setQuickCustomerModalOpen] = useState(false);
  const [quickCustName, setQuickCustName] = useState('');
  const [quickCustPhone, setQuickCustPhone] = useState('');
  const [quickCustContactNote, setQuickCustContactNote] = useState('');
  const [quickCustNote, setQuickCustNote] = useState('');
  const [savingQuickCustomer, setSavingQuickCustomer] = useState(false);
  const [orderNote, setOrderNote] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Quick open shift modal
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [openingCash, setOpeningCash] = useState('500');

  // Today's sales history modal & completed receipt modal
  const [todaySales, setTodaySales] = useState<Sale[]>([]);
  const [todaySalesOpen, setTodaySalesOpen] = useState(false);
  const [todaySalesLoading, setTodaySalesLoading] = useState(false);
  const [todaySalesSearch, setTodaySalesSearch] = useState('');
  const [todaySalesFilter, setTodaySalesFilter] = useState<
    'all' | 'cash' | 'qr' | 'credit' | 'returned_or_void'
  >('all');
  const [confirmVoidSaleId, setConfirmVoidSaleId] = useState<string | null>(null);
  const [voidingSaleId, setVoidingSaleId] = useState<string | null>(null);
  const [partialReturnSale, setPartialReturnSale] = useState<Sale | null>(null);
  const [partialReturnQtyInputs, setPartialReturnQtyInputs] = useState<
    Record<string, string>
  >({});
  const [partialReturnReason, setPartialReturnReason] =
    useState<PartialReturnReason>('ลูกค้าเปลี่ยนใจ');
  const [partialReturnSubmitting, setPartialReturnSubmitting] = useState(false);
  const [partialReturnError, setPartialReturnError] = useState('');
  const [todaySalesNotice, setTodaySalesNotice] = useState('');
  const [lastReceipt, setLastReceipt] = useState<CompletedReceipt | null>(null);
  const [recentSaleBanner, setRecentSaleBanner] = useState<CompletedReceipt | null>(null);
  const [receiptCopied, setReceiptCopied] = useState(false);
  const [printMode, setPrintMode] = useState<'receipt' | 'packing_slip' | 'held_packing_slip'>(
    'receipt'
  );
  const [printingHeldBill, setPrintingHeldBill] = useState<HeldBill | null>(null);
  const [lastCostHistory, setLastCostHistory] = useState<Record<string, LastCostHistoryEntry>>({});

  // Direct quantity & unit price editing in cart
  const [editingQtyKey, setEditingQtyKey] = useState<string | null>(null);
  const [editingQtyValue, setEditingQtyValue] = useState<string>('');
  const [editingPriceKey, setEditingPriceKey] = useState<string | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState<string>('');
  const [manualPriceKeys, setManualPriceKeys] = useState<Set<string>>(() => new Set());

  // Fullscreen, Quick Calculator & Shortcuts Help
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [calcDisplay, setCalcDisplay] = useState('0');
  const [calcPrevValue, setCalcPrevValue] = useState<number | null>(null);
  const [calcOperator, setCalcOperator] = useState<'+' | '-' | '×' | '÷' | null>(null);
  const [calcWaitingForOperand, setCalcWaitingForOperand] = useState(false);
  const [calcExpression, setCalcExpression] = useState('');

  // Product expiry alerts & customizable receipt footer
  const [expiryDates, setExpiryDates] = useState<Record<string, string>>({});
  const [todayIso, setTodayIso] = useState('');
  const [receiptFooter, setReceiptFooter] = useState(DEFAULT_RECEIPT_FOOTER);
  const [receiptSettingsOpen, setReceiptSettingsOpen] = useState(false);
  const [receiptFooterDraft, setReceiptFooterDraft] = useState('');
  const [posMetaJsonInput, setPosMetaJsonInput] = useState('');
  const [posMetaFileName, setPosMetaFileName] = useState('');
  const [posMetaRestoreMode, setPosMetaRestoreMode] = useState<'replace' | 'merge'>('replace');
  const [posMetaError, setPosMetaError] = useState('');
  const [posMetaSuccess, setPosMetaSuccess] = useState('');
  const [posMetaCopied, setPosMetaCopied] = useState(false);

  // Shelf locations, substitute notes, wholesale tiers & quick combo bundles
  const [shelfLocations, setShelfLocations] = useState<Record<string, string>>({});
  const [unitBarcodes, setUnitBarcodes] = useState<Record<string, Record<string, string>>>({});
  const [substituteNotes, setSubstituteNotes] = useState<Record<string, string>>({});
  const [promoLabels, setPromoLabels] = useState<Record<string, string>>({});
  const [targetStocks, setTargetStocks] = useState<Record<string, number>>({});
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [screenLockedAt, setScreenLockedAt] = useState<string | null>(null);
  const [wholesaleTiers, setWholesaleTiers] = useState<Record<string, WholesaleTier>>({});
  const [bundles, setBundles] = useState<PosBundle[]>([]);
  const [saveBundleModalOpen, setSaveBundleModalOpen] = useState(false);
  const [bundleNameInput, setBundleNameInput] = useState('');

  // Customer-facing display modal
  const [customerDisplayOpen, setCustomerDisplayOpen] = useState(false);
  const [customerDisplayQrResult, setCustomerDisplayQrResult] = useState<{
    key: string;
    url: string;
  }>({ key: '', url: '' });

  // Container deposits ledger modal
  const [containerDeposits, setContainerDeposits] = useState<ContainerDeposit[]>([]);
  const [containerDepositsOpen, setContainerDepositsOpen] = useState(false);
  const [depositCustomerName, setDepositCustomerName] = useState('');
  const [depositItemLabel, setDepositItemLabel] = useState<string>(QUICK_CONTAINER_TYPES[0]);
  const [depositQty, setDepositQty] = useState('1');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositSearch, setDepositSearch] = useState('');

  // Shift handover memo banner
  const [handoverMemo, setHandoverMemo] = useState<ShiftHandoverMemo | null>(null);
  const [handoverMemoHidden, setHandoverMemoHidden] = useState(false);

  // Quick debt collection modal (Phase 36)
  const [quickDebtModalOpen, setQuickDebtModalOpen] = useState(false);

  // Quick Price Checker modal (Phase 40, F6)
  const [priceCheckerOpen, setPriceCheckerOpen] = useState(false);
  const [priceCheckerQuery, setPriceCheckerQuery] = useState('');
  const [priceCheckerSelectedId, setPriceCheckerSelectedId] = useState<string | null>(null);
  const [priceCheckerMatchedUnitId, setPriceCheckerMatchedUnitId] = useState<string | null>(null);
  const priceCheckerInputRef = useRef<HTMLInputElement>(null);

  // Quick Miscellaneous Item modal (Phase 49, F7)
  const [quickMiscOpen, setQuickMiscOpen] = useState(false);
  const [quickMiscName, setQuickMiscName] = useState('สินค้าเบ็ดเตล็ด');
  const [quickMiscPrice, setQuickMiscPrice] = useState('');
  const [quickMiscCost, setQuickMiscCost] = useState('');
  const [quickMiscQty, setQuickMiscQty] = useState('1');
  const [quickMiscPresets, setQuickMiscPresets] = useState<QuickMiscPreset[]>([]);
  const [cartLineQuoteCopied, setCartLineQuoteCopied] = useState(false);
  const quickMiscPriceInputRef = useRef<HTMLInputElement>(null);
  const [quickDebtCustomerId, setQuickDebtCustomerId] = useState('');
  const [quickDebtAmount, setQuickDebtAmount] = useState('');
  const [quickDebtMethod, setQuickDebtMethod] = useState<'cash' | 'qr'>('cash');
  const [quickDebtNote, setQuickDebtNote] = useState('');
  const [quickDebtSubmitting, setQuickDebtSubmitting] = useState(false);
  const [quickDebtQrResult, setQuickDebtQrResult] = useState<{
    key: string;
    url: string;
  }>({ key: '', url: '' });
  const [quickDebtReceipt, setQuickDebtReceipt] = useState<{
    customerName: string;
    amountPaid: number;
    paymentMethod: 'cash' | 'qr';
    remainingDebt: number;
    note: string;
    paidAt: string;
  } | null>(null);
  const [copiedQuickDebtReceipt, setCopiedQuickDebtReceipt] = useState(false);

  const fetchTodaySales = useCallback(async () => {
    setTodaySalesLoading(true);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('sales')
      .select('*, sale_items(*), customers(name)')
      .gte('created_at', startOfToday.toISOString())
      .order('created_at', { ascending: false });
    setTodaySales((data as Sale[]) ?? []);
    setTodaySalesLoading(false);
  }, [supabase]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const [
      { data: st },
      { data: cats },
      { data: prods },
      { data: custs },
      { data: shifts },
      { data: salesToday },
    ] = await Promise.all([
      supabase.from('store_settings').select('*').limit(1).maybeSingle(),
      supabase.from('categories').select('*').order('sort_order', { ascending: true }),
      supabase
        .from('products')
        .select('*, product_units(*), categories(*)')
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase.from('customers').select('*').order('name', { ascending: true }),
      supabase.from('shifts').select('*').eq('status', 'open').limit(1).maybeSingle(),
      supabase
        .from('sales')
        .select('*, sale_items(*), customers(name)')
        .gte('created_at', startOfToday.toISOString())
        .order('created_at', { ascending: false }),
    ]);

    setSettings(st ?? null);
    setCategories(cats ?? []);
    setProducts((prods as Product[]) ?? []);
    setCustomers(custs ?? []);
    setActiveShift(shifts ?? null);
    setTodaySales((salesToday as Sale[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load held bills from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HELD_BILLS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setHeldBills(parsed);
        }
      }
    } catch {
      // ignore localStorage read errors
    }
  }, []);

  // Load customer credit limits from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CREDIT_LIMITS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const normalized: Record<string, number> = {};
          for (const [k, v] of Object.entries(parsed)) {
            const num = Number(v);
            if (Number.isFinite(num) && num > 0) {
              normalized[k] = num;
            }
          }
          setCreditLimits(normalized);
        }
      }
    } catch {
      // ignore localStorage read errors
    }
  }, [checkoutOpen]);

  // Load customer loyalty points from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOYALTY_POINTS_STORAGE_KEY);
      if (raw !== null) {
        setLoyaltyPoints(parseLoyaltyPointsMap(raw));
      }
    } catch {
      // ignore localStorage read errors
    }
  }, [checkoutOpen]);

  // Load customer store credit from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_CREDIT_STORAGE_KEY);
      if (raw !== null) {
        setStoreCredits(parseStoreCreditMap(raw));
      }
    } catch {
      // ignore localStorage read errors
    }
  }, [checkoutOpen]);

  // Load customer default VIP discounts from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DEFAULT_DISCOUNT_PCT_STORAGE_KEY);
      setDefaultDiscounts(parseDefaultDiscountPctMap(raw));
    } catch {
      // ignore localStorage read errors
    }
  }, [checkoutOpen]);

  // Load customer contact notes (address / landmark / LINE) from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONTACT_NOTES_STORAGE_KEY);
      setContactNotes(parseProductStringMap(raw));
    } catch {
      // ignore localStorage read errors
    }
  }, [checkoutOpen]);

  // Load customer followup logs from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY);
      setCustomerFollowupLogs(parseCustomerFollowupLogsMap(raw));
    } catch {
      // ignore localStorage read errors
    }
  }, [checkoutOpen]);

  // Load customer payday cycles from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY);
      setCustomerPaydayCycles(parseProductStringMap(raw));
    } catch {
      // ignore localStorage read errors
    }
  }, [checkoutOpen]);

  // Load customer tags from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOMER_TAGS_STORAGE_KEY);
      setCustomerTags(parseProductStringMap(raw));
    } catch {
      // ignore localStorage read errors
    }
  }, [checkoutOpen]);

  const saveCustomerContactNote = useCallback(
    (customerId: string, rawNote: string): string => {
      const trimmed = rawNote.trim();
      if (!customerId || !trimmed) return '';
      let latestNotes = contactNotes;
      try {
        const raw = localStorage.getItem(CONTACT_NOTES_STORAGE_KEY);
        if (raw !== null) {
          latestNotes = parseProductStringMap(raw);
        }
      } catch {
        // fallback to in-memory state
      }
      const nextNotes: Record<string, string> = {
        ...latestNotes,
        [customerId]: trimmed,
      };
      setContactNotes(nextNotes);
      try {
        localStorage.setItem(CONTACT_NOTES_STORAGE_KEY, JSON.stringify(nextNotes));
      } catch {
        // ignore localStorage write errors
      }
      return trimmed;
    },
    [contactNotes]
  );

  // Refresh customer due dates & local todayIso when checkout modal toggles
  useEffect(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    setTodayIso(`${yyyy}-${mm}-${dd}`);
    try {
      const rawDueDates = localStorage.getItem(DUE_DATES_STORAGE_KEY);
      setDueDates(parseIsoDateMap(rawDueDates));
    } catch {
      // ignore localStorage read errors
    }
  }, [checkoutOpen]);

  const saveHeldBills = useCallback((bills: HeldBill[]) => {
    setHeldBills(bills);
    try {
      localStorage.setItem(HELD_BILLS_STORAGE_KEY, JSON.stringify(bills));
    } catch {
      // ignore localStorage write errors
    }
  }, []);

  // Load sound preference from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SOUND_ENABLED_STORAGE_KEY);
      if (saved === 'false') {
        setSoundEnabled(false);
      } else if (saved === 'true') {
        setSoundEnabled(true);
      }
    } catch {
      // ignore localStorage read errors
    }
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SOUND_ENABLED_STORAGE_KEY, String(next));
      } catch {
        // ignore localStorage write errors
      }
      return next;
    });
  }, []);

  // Load grid density preference from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(GRID_DENSITY_STORAGE_KEY);
      if (saved === 'compact' || saved === 'large') {
        setGridDensity(saved);
      }
    } catch {
      // ignore localStorage read errors
    }
  }, []);

  // Load pinned product IDs from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINNED_PRODUCTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setPinnedIds(parsed.filter((id): id is string => typeof id === 'string'));
        }
      }
    } catch {
      // ignore localStorage read errors
    }
  }, []);

  // Load expiry dates, shelf locations, quick bundles, today's ISO date, and receipt footer from localStorage on mount
  useEffect(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    setTodayIso(`${yyyy}-${mm}-${dd}`);

    try {
      const rawExpiry = localStorage.getItem(EXPIRY_DATES_STORAGE_KEY);
      setExpiryDates(parseIsoDateMap(rawExpiry));
    } catch {
      // ignore localStorage read errors
    }

    try {
      const rawDueDates = localStorage.getItem(DUE_DATES_STORAGE_KEY);
      setDueDates(parseIsoDateMap(rawDueDates));
    } catch {
      // ignore localStorage read errors
    }

    try {
      const rawShelfLocations = localStorage.getItem(SHELF_LOCATIONS_STORAGE_KEY);
      setShelfLocations(parseProductStringMap(rawShelfLocations));
    } catch {
      // ignore localStorage read errors
    }

    try {
      const rawSubstituteNotes = localStorage.getItem(SUBSTITUTE_NOTES_STORAGE_KEY);
      setSubstituteNotes(parseProductStringMap(rawSubstituteNotes));
    } catch {
      // ignore localStorage read errors
    }

    try {
      const rawPromoLabels = localStorage.getItem(PROMO_LABELS_STORAGE_KEY);
      setPromoLabels(parseProductStringMap(rawPromoLabels));
    } catch {
      // ignore localStorage read errors
    }

    try {
      const rawWholesaleTiers = localStorage.getItem(WHOLESALE_TIERS_STORAGE_KEY);
      setWholesaleTiers(parseWholesaleTiersMap(rawWholesaleTiers));
    } catch {
      // ignore localStorage read errors
    }

    try {
      const rawBundles = localStorage.getItem(POS_BUNDLES_STORAGE_KEY);
      setBundles(parsePosBundles(rawBundles));
    } catch {
      // ignore localStorage read errors
    }

    try {
      const rawDeposits = localStorage.getItem(CONTAINER_DEPOSITS_STORAGE_KEY);
      setContainerDeposits(parseContainerDeposits(rawDeposits));
    } catch {
      // ignore localStorage read errors
    }

    try {
      const savedFooter = localStorage.getItem(RECEIPT_FOOTER_STORAGE_KEY);
      if (savedFooter !== null && savedFooter.trim() !== '') {
        setReceiptFooter(savedFooter);
      }
    } catch {
      // ignore localStorage read errors
    }

    try {
      const rawHandoverMemo = localStorage.getItem(SHIFT_HANDOVER_MEMO_STORAGE_KEY);
      setHandoverMemo(parseShiftHandoverMemo(rawHandoverMemo));
    } catch {
      // ignore localStorage read errors
    }

    try {
      const rawMiscPresets = localStorage.getItem(MISC_PRESETS_STORAGE_KEY);
      setQuickMiscPresets(parseQuickMiscPresets(rawMiscPresets));
    } catch {
      // ignore localStorage read errors
    }

    try {
      const rawUnitBarcodes = localStorage.getItem(UNIT_BARCODES_STORAGE_KEY);
      setUnitBarcodes(parseUnitBarcodesMap(rawUnitBarcodes));
    } catch {
      // ignore localStorage read errors
    }

    try {
      const rawLastCostHistory = localStorage.getItem(LAST_COST_HISTORY_STORAGE_KEY);
      setLastCostHistory(parseLastCostHistoryMap(rawLastCostHistory));
    } catch {
      // ignore localStorage read errors
    }

    try {
      const rawTargetStocks = localStorage.getItem(TARGET_STOCK_STORAGE_KEY);
      setTargetStocks(parseProductNumberMap(rawTargetStocks));
    } catch {
      // ignore localStorage read errors
    }

    try {
      const rawSuppliers = localStorage.getItem(SUPPLIERS_STORAGE_KEY);
      setSuppliers(parseProductStringMap(rawSuppliers));
    } catch {
      // ignore localStorage read errors
    }
  }, []);

  // Keep expiry dates, due dates, shelf locations, quick bundles, container deposits, receipt footer & VIP discounts synced across tabs
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === EXPIRY_DATES_STORAGE_KEY || e.key === null) {
        try {
          const rawExpiry = localStorage.getItem(EXPIRY_DATES_STORAGE_KEY);
          setExpiryDates(parseIsoDateMap(rawExpiry));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === DUE_DATES_STORAGE_KEY || e.key === null) {
        try {
          const rawDueDates = localStorage.getItem(DUE_DATES_STORAGE_KEY);
          setDueDates(parseIsoDateMap(rawDueDates));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === SHELF_LOCATIONS_STORAGE_KEY || e.key === null) {
        try {
          const rawShelfLocations = localStorage.getItem(SHELF_LOCATIONS_STORAGE_KEY);
          setShelfLocations(parseProductStringMap(rawShelfLocations));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === UNIT_BARCODES_STORAGE_KEY || e.key === null) {
        try {
          const rawUnitBarcodes = localStorage.getItem(UNIT_BARCODES_STORAGE_KEY);
          setUnitBarcodes(parseUnitBarcodesMap(rawUnitBarcodes));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === SUBSTITUTE_NOTES_STORAGE_KEY || e.key === null) {
        try {
          const rawSubstituteNotes = localStorage.getItem(SUBSTITUTE_NOTES_STORAGE_KEY);
          setSubstituteNotes(parseProductStringMap(rawSubstituteNotes));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === PROMO_LABELS_STORAGE_KEY || e.key === null) {
        try {
          const rawPromoLabels = localStorage.getItem(PROMO_LABELS_STORAGE_KEY);
          setPromoLabels(parseProductStringMap(rawPromoLabels));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === TARGET_STOCK_STORAGE_KEY || e.key === null) {
        try {
          const rawTargetStocks = localStorage.getItem(TARGET_STOCK_STORAGE_KEY);
          setTargetStocks(parseProductNumberMap(rawTargetStocks));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === SUPPLIERS_STORAGE_KEY || e.key === null) {
        try {
          const rawSuppliers = localStorage.getItem(SUPPLIERS_STORAGE_KEY);
          setSuppliers(parseProductStringMap(rawSuppliers));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === POS_BUNDLES_STORAGE_KEY || e.key === null) {
        try {
          const rawBundles = localStorage.getItem(POS_BUNDLES_STORAGE_KEY);
          setBundles(parsePosBundles(rawBundles));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === CONTAINER_DEPOSITS_STORAGE_KEY || e.key === null) {
        try {
          const rawDeposits = localStorage.getItem(CONTAINER_DEPOSITS_STORAGE_KEY);
          setContainerDeposits(parseContainerDeposits(rawDeposits));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === RECEIPT_FOOTER_STORAGE_KEY || e.key === null) {
        try {
          const savedFooter = localStorage.getItem(RECEIPT_FOOTER_STORAGE_KEY);
          setReceiptFooter(
            savedFooter !== null && savedFooter.trim() !== ''
              ? savedFooter
              : DEFAULT_RECEIPT_FOOTER
          );
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === PINNED_PRODUCTS_STORAGE_KEY || e.key === null) {
        try {
          setPinnedIds(
            parsePinnedProductIds(localStorage.getItem(PINNED_PRODUCTS_STORAGE_KEY))
          );
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === HELD_BILLS_STORAGE_KEY || e.key === null) {
        try {
          setHeldBills(parseHeldBills(localStorage.getItem(HELD_BILLS_STORAGE_KEY)));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === DEFAULT_DISCOUNT_PCT_STORAGE_KEY || e.key === null) {
        try {
          const rawDiscounts = localStorage.getItem(DEFAULT_DISCOUNT_PCT_STORAGE_KEY);
          setDefaultDiscounts(parseDefaultDiscountPctMap(rawDiscounts));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === STORE_CREDIT_STORAGE_KEY || e.key === null) {
        try {
          const rawStoreCredits = localStorage.getItem(STORE_CREDIT_STORAGE_KEY);
          setStoreCredits(parseStoreCreditMap(rawStoreCredits));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === CONTACT_NOTES_STORAGE_KEY || e.key === null) {
        try {
          const rawContactNotes = localStorage.getItem(CONTACT_NOTES_STORAGE_KEY);
          setContactNotes(parseProductStringMap(rawContactNotes));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY || e.key === null) {
        try {
          const rawFollowups = localStorage.getItem(CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY);
          setCustomerFollowupLogs(parseCustomerFollowupLogsMap(rawFollowups));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY || e.key === null) {
        try {
          const rawPaydayCycles = localStorage.getItem(CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY);
          setCustomerPaydayCycles(parseProductStringMap(rawPaydayCycles));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === CUSTOMER_TAGS_STORAGE_KEY || e.key === null) {
        try {
          const rawCustomerTags = localStorage.getItem(CUSTOMER_TAGS_STORAGE_KEY);
          setCustomerTags(parseProductStringMap(rawCustomerTags));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === SHIFT_HANDOVER_MEMO_STORAGE_KEY || e.key === null) {
        try {
          const rawHandoverMemo = localStorage.getItem(SHIFT_HANDOVER_MEMO_STORAGE_KEY);
          setHandoverMemo(parseShiftHandoverMemo(rawHandoverMemo));
          setHandoverMemoHidden(false);
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === MISC_PRESETS_STORAGE_KEY || e.key === null) {
        try {
          const rawMiscPresets = localStorage.getItem(MISC_PRESETS_STORAGE_KEY);
          setQuickMiscPresets(parseQuickMiscPresets(rawMiscPresets));
        } catch {
          // ignore localStorage read errors
        }
      }
      if (e.key === LAST_COST_HISTORY_STORAGE_KEY || e.key === null) {
        try {
          const rawLastCostHistory = localStorage.getItem(LAST_COST_HISTORY_STORAGE_KEY);
          setLastCostHistory(parseLastCostHistoryMap(rawLastCostHistory));
        } catch {
          // ignore localStorage read errors
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const saveBundles = useCallback((nextBundles: PosBundle[]) => {
    setBundles(nextBundles);
    try {
      localStorage.setItem(POS_BUNDLES_STORAGE_KEY, JSON.stringify(nextBundles));
    } catch {
      // ignore localStorage write errors
    }
  }, []);

  const saveQuickMiscPresets = useCallback((nextPresets: QuickMiscPreset[]) => {
    setQuickMiscPresets(nextPresets);
    try {
      localStorage.setItem(MISC_PRESETS_STORAGE_KEY, JSON.stringify(nextPresets));
    } catch {
      // ignore localStorage write errors
    }
  }, []);

  const saveContainerDeposits = useCallback((nextDeposits: ContainerDeposit[]) => {
    setContainerDeposits(nextDeposits);
    try {
      localStorage.setItem(
        CONTAINER_DEPOSITS_STORAGE_KEY,
        JSON.stringify(nextDeposits)
      );
    } catch {
      // ignore localStorage write errors
    }
  }, []);

  const effectiveReceiptFooter = receiptFooter.trim() || DEFAULT_RECEIPT_FOOTER;

  const openReceiptSettingsModal = () => {
    setReceiptFooterDraft(receiptFooter);
    setPosMetaJsonInput('');
    setPosMetaFileName('');
    setPosMetaError('');
    setPosMetaSuccess('');
    setPosMetaCopied(false);
    setReceiptSettingsOpen(true);
  };

  const handleSaveReceiptFooter = (e: React.FormEvent) => {
    e.preventDefault();
    const nextFooter = receiptFooterDraft.trim() || DEFAULT_RECEIPT_FOOTER;
    setReceiptFooter(nextFooter);
    setReceiptFooterDraft(nextFooter);
    try {
      localStorage.setItem(RECEIPT_FOOTER_STORAGE_KEY, nextFooter);
    } catch {
      // ignore localStorage write errors
    }
    setReceiptSettingsOpen(false);
    showToast('success', 'บันทึกข้อความท้ายใบเสร็จเรียบร้อยแล้ว');
  };

  const handleResetReceiptFooterDraft = () => {
    setReceiptFooterDraft(DEFAULT_RECEIPT_FOOTER);
  };

  const posMetaPreview = useMemo(
    () => (posMetaJsonInput.trim() ? parsePosMetaBackupJson(posMetaJsonInput) : null),
    [posMetaJsonInput]
  );

  const buildPosMetaBackupPayload = () => ({
    [PINNED_PRODUCTS_STORAGE_KEY]: pinnedIds,
    [POS_BUNDLES_STORAGE_KEY]: bundles,
    [RECEIPT_FOOTER_STORAGE_KEY]: effectiveReceiptFooter,
    [CONTAINER_DEPOSITS_STORAGE_KEY]: containerDeposits,
    [HELD_BILLS_STORAGE_KEY]: heldBills,
    [SHIFT_HANDOVER_MEMO_STORAGE_KEY]: handoverMemo,
    [MISC_PRESETS_STORAGE_KEY]: quickMiscPresets,
    [STORE_CREDIT_STORAGE_KEY]: storeCredits,
  });

  const handleCopyPosMetaJson = async () => {
    const jsonText = JSON.stringify(buildPosMetaBackupPayload(), null, 2);
    try {
      await navigator.clipboard.writeText(jsonText);
      setPosMetaCopied(true);
      setTimeout(() => setPosMetaCopied(false), 2500);
      showToast('success', 'คัดลอก JSON ตั้งค่า POS ลง Clipboard แล้ว');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = jsonText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setPosMetaCopied(true);
      setTimeout(() => setPosMetaCopied(false), 2500);
      showToast('success', 'คัดลอก JSON ตั้งค่า POS ลง Clipboard แล้ว');
    }
  };

  const handleDownloadPosMetaJson = () => {
    const jsonText = JSON.stringify(buildPosMetaBackupPayload(), null, 2);
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `pos-metadata-backup-${dateStamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('success', 'ดาวน์โหลดไฟล์สำรองข้อมูลตั้งค่า POS (.json) แล้ว');
  };

  const handlePosMetaFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      setPosMetaFileName(file.name);
      setPosMetaJsonInput(text);
      setPosMetaError('');
      setPosMetaSuccess('');
    } catch {
      setPosMetaError('ไม่สามารถอ่านไฟล์ที่เลือกได้ กรุณาลองใหม่อีกครั้ง');
    }
  };

  const handleRestorePosMetaJson = () => {
    const parsed = parsePosMetaBackupJson(posMetaJsonInput);
    if (parsed.error) {
      setPosMetaError(parsed.error);
      setPosMetaSuccess('');
      return;
    }

    const restoredParts: string[] = [];

    if (parsed.pinnedIds !== undefined) {
      const nextPinned =
        posMetaRestoreMode === 'merge'
          ? Array.from(new Set([...pinnedIds, ...parsed.pinnedIds]))
          : parsed.pinnedIds;
      setPinnedIds(nextPinned);
      try {
        localStorage.setItem(PINNED_PRODUCTS_STORAGE_KEY, JSON.stringify(nextPinned));
      } catch {
        // ignore localStorage write errors
      }
      restoredParts.push(`สินค้าปักหมุด ${formatNumber(nextPinned.length)} รายการ`);
    }

    if (parsed.bundles !== undefined) {
      let nextBundles = parsed.bundles;
      if (posMetaRestoreMode === 'merge') {
        const map = new Map<string, PosBundle>();
        for (const b of bundles) map.set(b.id, b);
        for (const b of parsed.bundles) map.set(b.id, b);
        nextBundles = Array.from(map.values());
      }
      saveBundles(nextBundles);
      restoredParts.push(`ชุดขายด่วน ${formatNumber(nextBundles.length)} ชุด`);
    }

    if (parsed.receiptFooter !== undefined) {
      const nextFooter = parsed.receiptFooter.trim() || DEFAULT_RECEIPT_FOOTER;
      setReceiptFooter(nextFooter);
      setReceiptFooterDraft(nextFooter);
      try {
        localStorage.setItem(RECEIPT_FOOTER_STORAGE_KEY, nextFooter);
      } catch {
        // ignore localStorage write errors
      }
      restoredParts.push('ข้อความท้ายใบเสร็จ');
    }

    if (parsed.containerDeposits !== undefined) {
      let nextDeposits = parsed.containerDeposits;
      if (posMetaRestoreMode === 'merge') {
        const map = new Map<string, ContainerDeposit>();
        for (const d of containerDeposits) map.set(d.id, d);
        for (const d of parsed.containerDeposits) map.set(d.id, d);
        nextDeposits = Array.from(map.values());
      }
      saveContainerDeposits(nextDeposits);
      restoredParts.push(`มัดจำภาชนะ ${formatNumber(nextDeposits.length)} รายการ`);
    }

    if (parsed.heldBills !== undefined) {
      let nextHeld = parsed.heldBills;
      if (posMetaRestoreMode === 'merge') {
        const map = new Map<string, HeldBill>();
        for (const h of heldBills) map.set(h.id, h);
        for (const h of parsed.heldBills) map.set(h.id, h);
        nextHeld = Array.from(map.values());
      }
      saveHeldBills(nextHeld);
      restoredParts.push(`บิลที่พักไว้ ${formatNumber(nextHeld.length)} บิล`);
    }

    if (parsed.shiftHandoverMemo !== undefined) {
      const nextMemo =
        posMetaRestoreMode === 'merge' && parsed.shiftHandoverMemo === null
          ? handoverMemo
          : parsed.shiftHandoverMemo;
      setHandoverMemo(nextMemo);
      setHandoverMemoHidden(false);
      try {
        if (nextMemo) {
          localStorage.setItem(SHIFT_HANDOVER_MEMO_STORAGE_KEY, JSON.stringify(nextMemo));
        } else {
          localStorage.removeItem(SHIFT_HANDOVER_MEMO_STORAGE_KEY);
        }
      } catch {
        // ignore localStorage write errors
      }
      restoredParts.push(nextMemo ? 'ข้อความฝากส่งต่อกะ' : 'ล้างข้อความส่งต่อกะ');
    }

    if (parsed.miscPresets !== undefined) {
      let nextPresets = parsed.miscPresets;
      if (posMetaRestoreMode === 'merge') {
        const map = new Map<string, QuickMiscPreset>();
        for (const p of quickMiscPresets) map.set(p.name.toLowerCase(), p);
        for (const p of parsed.miscPresets) map.set(p.name.toLowerCase(), p);
        nextPresets = Array.from(map.values());
      }
      saveQuickMiscPresets(nextPresets);
      restoredParts.push(`ปุ่มลัดจิปาถะ ${formatNumber(nextPresets.length)} รายการ`);
    }

    if (parsed.customerStoreCredits !== undefined) {
      const nextCredits =
        posMetaRestoreMode === 'merge'
          ? { ...storeCredits, ...parsed.customerStoreCredits }
          : parsed.customerStoreCredits;
      setStoreCredits(nextCredits);
      try {
        localStorage.setItem(STORE_CREDIT_STORAGE_KEY, JSON.stringify(nextCredits));
      } catch {
        // ignore localStorage write errors
      }
      restoredParts.push(
        `เงินฝากทอนลูกค้า ${formatNumber(Object.keys(nextCredits).length)} ราย`
      );
    }

    const summaryText = `กู้คืนข้อมูลสำเร็จ: ${restoredParts.join(', ')}`;
    setPosMetaError('');
    setPosMetaSuccess(summaryText);
    showToast('success', summaryText);
  };

  const togglePinProduct = useCallback((productId: string) => {
    setPinnedIds((prev) => {
      const exists = prev.includes(productId);
      const next = exists
        ? prev.filter((id) => id !== productId)
        : [...prev, productId];
      try {
        localStorage.setItem(PINNED_PRODUCTS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore localStorage write errors
      }
      return next;
    });
  }, []);

  const toggleGridDensity = useCallback(() => {
    setGridDensity((prev) => {
      const next = prev === 'large' ? 'compact' : 'large';
      try {
        localStorage.setItem(GRID_DENSITY_STORAGE_KEY, next);
      } catch {
        // ignore localStorage write errors
      }
      return next;
    });
  }, []);

  // Hide last sale change banner once a new item is added to cart
  useEffect(() => {
    if (cart.length > 0) {
      setRecentSaleBanner(null);
    }
  }, [cart.length]);

  const playBeep = useCallback(
    (type: 'add' | 'success') => {
      if (!soundEnabled) return;
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;

        if (!audioCtxRef.current) {
          audioCtxRef.current = new AudioCtx();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }

        const now = ctx.currentTime;
        const playTone = (freq: number, startOffset: number, duration: number, peakGain: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + startOffset);
          gain.gain.setValueAtTime(0.001, now + startOffset);
          gain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + startOffset);
          osc.stop(now + startOffset + duration + 0.01);
        };

        if (type === 'add') {
          playTone(880, 0, 0.065, 0.06);
        } else {
          playTone(784, 0, 0.08, 0.07);
          playTone(1046.5, 0.075, 0.14, 0.07);
        }
      } catch {
        // ignore Web Audio API errors on unsupported browsers
      }
    },
    [soundEnabled]
  );

  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.unit_price * item.qty, 0),
    [cart]
  );

  const cartCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.qty, 0),
    [cart]
  );

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) {
      map.set(p.id, p);
    }
    return map;
  }, [products]);

  useEffect(() => {
    const handleWholesaleStorage = (e: StorageEvent) => {
      if (e.key !== WHOLESALE_TIERS_STORAGE_KEY && e.key !== null) return;
      try {
        const nextTiers = parseWholesaleTiersMap(
          localStorage.getItem(WHOLESALE_TIERS_STORAGE_KEY)
        );
        setWholesaleTiers(nextTiers);
        setCart((prev) =>
          syncCartWholesalePrices(prev, nextTiers, productById, manualPriceKeys)
        );
      } catch {
        // ignore localStorage read errors
      }
    };
    window.addEventListener('storage', handleWholesaleStorage);
    return () => window.removeEventListener('storage', handleWholesaleStorage);
  }, [productById, manualPriceKeys]);

  const bundleDraftItems = useMemo(() => {
    const grouped = new Map<
      string,
      {
        product_id: string;
        unit_id: string | null;
        qty: number;
        product_name: string;
        unit_name: string;
        unit_price: number;
      }
    >();
    for (const item of cart) {
      if (!item.product_id) continue;
      const prod = productById.get(item.product_id);
      const units = item.available_units ?? prod?.product_units ?? [];
      const matchedUnit = units.find((u) => u.unit_name === item.unit_name);
      const unitId = matchedUnit && matchedUnit.id !== 'base' ? matchedUnit.id : null;
      const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
      const mapKey = `${item.product_id}::${unitId ?? ''}`;
      const existing = grouped.get(mapKey);
      if (existing) {
        existing.qty += qty;
      } else {
        grouped.set(mapKey, {
          product_id: item.product_id,
          unit_id: unitId,
          qty,
          product_name: item.product_name,
          unit_name: item.unit_name,
          unit_price: Number(item.unit_price) || 0,
        });
      }
    }
    return Array.from(grouped.values());
  }, [cart, productById]);

  const cartStockNeededByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of cart) {
      if (!item.product_id) continue;
      const prev = map.get(item.product_id) ?? 0;
      map.set(item.product_id, prev + item.qty * item.conversion_rate);
    }
    return map;
  }, [cart]);

  const discountAmount = useMemo(() => {
    const raw = Math.max(0, Number(billDiscount) || 0);
    return Math.min(cartTotal, raw);
  }, [billDiscount, cartTotal]);

  const roundDownOptions = useMemo(() => {
    const normalizedTotal = Number(cartTotal.toFixed(2));
    if (normalizedTotal <= 10) return [];
    const options: Array<{ target: number; discount: number }> = [];
    const seenTargets = new Set<number>();

    const candidates = [
      normalizedTotal % 5 !== 0 ? Math.floor(normalizedTotal / 5) * 5 : null,
      normalizedTotal % 10 !== 0 ? Math.floor(normalizedTotal / 10) * 10 : null,
    ];

    for (const target of candidates) {
      if (target === null || target <= 0 || seenTargets.has(target)) continue;
      const discount = Number((normalizedTotal - target).toFixed(2));
      if (discount > 0 && discount < normalizedTotal) {
        seenTargets.add(target);
        options.push({ target, discount });
      }
    }

    return options;
  }, [cartTotal]);

  const finalTotal = useMemo(
    () => Math.max(0, cartTotal - discountAmount),
    [cartTotal, discountAmount]
  );

  const selectedCustomer = useMemo(
    () =>
      selectedCustomerId && selectedCustomerId !== '__new__'
        ? customers.find((c) => c.id === selectedCustomerId) ?? null
        : null,
    [customers, selectedCustomerId]
  );

  const selectedCustomerOldDebt = useMemo(
    () =>
      selectedCustomer && Number(selectedCustomer.total_debt) > 0
        ? Number(Number(selectedCustomer.total_debt).toFixed(2))
        : 0,
    [selectedCustomer]
  );

  const settleOldDebtFractionAmount = useMemo(
    () => computeDebtFractionAmount(selectedCustomerOldDebt),
    [selectedCustomerOldDebt]
  );

  const halfOldDebtAmount = useMemo(() => {
    if (selectedCustomerOldDebt <= 0) return 0;
    return Number((selectedCustomerOldDebt / 2).toFixed(2));
  }, [selectedCustomerOldDebt]);

  const rawSettleOldDebtAmount = useMemo(() => {
    if (
      (paymentMethod !== 'cash' && paymentMethod !== 'qr') ||
      selectedCustomerOldDebt <= 0
    ) {
      return 0;
    }
    const parsed = Number(settleOldDebtInput);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Number(parsed.toFixed(2));
  }, [paymentMethod, selectedCustomerOldDebt, settleOldDebtInput]);

  const settleOldDebtAmount = useMemo(
    () => Math.min(selectedCustomerOldDebt, rawSettleOldDebtAmount),
    [selectedCustomerOldDebt, rawSettleOldDebtAmount]
  );

  const totalToCollectWithDebt = useMemo(
    () => Number((finalTotal + settleOldDebtAmount).toFixed(2)),
    [finalTotal, settleOldDebtAmount]
  );

  const partialCashAmount = useMemo(() => {
    if (paymentMethod !== 'qr') return 0;
    const raw = Math.max(0, Number(partialCash) || 0);
    return Math.min(totalToCollectWithDebt, raw);
  }, [paymentMethod, partialCash, totalToCollectWithDebt]);

  const qrPayAmount = useMemo(
    () =>
      Math.max(0, Number((totalToCollectWithDebt - partialCashAmount).toFixed(2))),
    [totalToCollectWithDebt, partialCashAmount]
  );

  const rawCreditDownPayment = useMemo(() => {
    if (paymentMethod !== 'credit' || !selectedCustomerId) return 0;
    const parsed = Number(creditDownPaymentInput);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Number(parsed.toFixed(2));
  }, [paymentMethod, selectedCustomerId, creditDownPaymentInput]);

  const isCreditDownPaymentInvalid = useMemo(
    () =>
      paymentMethod === 'credit' &&
      Boolean(selectedCustomerId) &&
      rawCreditDownPayment > 0 &&
      (finalTotal <= 0 || rawCreditDownPayment >= finalTotal),
    [paymentMethod, selectedCustomerId, rawCreditDownPayment, finalTotal]
  );

  const creditDownPayment = useMemo(() => {
    if (
      paymentMethod !== 'credit' ||
      !selectedCustomerId ||
      finalTotal <= 0 ||
      rawCreditDownPayment <= 0 ||
      rawCreditDownPayment >= finalTotal
    ) {
      return 0;
    }
    return rawCreditDownPayment;
  }, [paymentMethod, selectedCustomerId, finalTotal, rawCreditDownPayment]);

  const netCreditAmount = useMemo(
    () =>
      paymentMethod === 'credit'
        ? Math.max(0, Number((finalTotal - creditDownPayment).toFixed(2)))
        : finalTotal,
    [paymentMethod, finalTotal, creditDownPayment]
  );

  const halfCreditDownPayment = useMemo(() => {
    if (finalTotal <= 0) return 0;
    const half = Math.floor((finalTotal / 2) * 100) / 100;
    return half > 0 && half < finalTotal ? half : 0;
  }, [finalTotal]);

  const cashReceivedNum = Number(cashReceived) || 0;
  const cashChange = Math.max(
    0,
    Number((cashReceivedNum - totalToCollectWithDebt).toFixed(2))
  );
  const cashShortfall = Math.max(
    0,
    Number((totalToCollectWithDebt - cashReceivedNum).toFixed(2))
  );
  const isCashShort =
    paymentMethod === 'cash' &&
    cashReceivedNum > 0 &&
    cashReceivedNum < totalToCollectWithDebt &&
    cashShortfall > 0;
  const isCashZeroShort =
    paymentMethod === 'cash' &&
    cashReceived.trim() !== '' &&
    cashReceivedNum <= 0 &&
    cashShortfall > 0;
  const splitQrAmount = isCashShort ? cashShortfall : 0;
  const isSplitCashQr = splitCashQrEnabled && isCashShort && splitQrAmount > 0;
  const isCashPaymentBlocked =
    paymentMethod === 'cash' && cashShortfall > 0 && !isSplitCashQr;
  const activeQrTargetAmount =
    paymentMethod === 'qr' ? qrPayAmount : isSplitCashQr ? splitQrAmount : 0;

  const cartItemNotesSummary = useMemo(
    () => buildItemNotesSummary(cart, cartItemNotes),
    [cart, cartItemNotes]
  );

  const customerDisplayDiscount = checkoutOpen ? discountAmount : 0;
  const customerDisplayNetTotal = checkoutOpen ? totalToCollectWithDebt : cartTotal;
  const customerDisplaySplitCashPaid =
    checkoutOpen && paymentMethod === 'qr' && partialCashAmount > 0
      ? partialCashAmount
      : checkoutOpen && paymentMethod === 'cash' && isSplitCashQr
        ? cashReceivedNum
        : 0;
  const customerDisplayQrAmount =
    checkoutOpen && paymentMethod === 'qr'
      ? qrPayAmount
      : checkoutOpen && paymentMethod === 'cash' && isSplitCashQr
        ? splitQrAmount
        : customerDisplayNetTotal;
  const customerDisplayPromptPayId = settings?.promptpay_id?.trim() ?? '';
  const customerDisplayQrKey =
    customerDisplayOpen && customerDisplayQrAmount > 0 && customerDisplayPromptPayId
      ? `${customerDisplayQrAmount}_${customerDisplayPromptPayId}`
      : '';
  const customerDisplayQrDataUrl =
    customerDisplayQrKey && customerDisplayQrResult.key === customerDisplayQrKey
      ? customerDisplayQrResult.url
      : '';

  const selectedCustomerContactNote = useMemo(
    () => (selectedCustomer ? contactNotes[selectedCustomer.id] ?? '' : ''),
    [selectedCustomer, contactNotes]
  );

  const selectedCustomerPaydayCycle = useMemo(
    () => (selectedCustomer ? (customerPaydayCycles[selectedCustomer.id] ?? '').trim() : ''),
    [selectedCustomer, customerPaydayCycles]
  );

  const selectedCustomerTag = useMemo(
    () => (selectedCustomer ? (customerTags[selectedCustomer.id] ?? '').trim() : ''),
    [selectedCustomer, customerTags]
  );

  const weightBudgetItem = useMemo(
    () =>
      weightBudgetItemKey ? cart.find((item) => item.key === weightBudgetItemKey) ?? null : null,
    [cart, weightBudgetItemKey]
  );

  const selectedCustomerLatestFollowup = useMemo(() => {
    if (!selectedCustomer) return null;
    const logs = customerFollowupLogs[selectedCustomer.id];
    if (!logs || logs.length === 0) return null;
    let latest = logs[0];
    let latestTs = Date.parse(latest.createdAt);
    for (let i = 1; i < logs.length; i++) {
      const ts = Date.parse(logs[i].createdAt);
      if (!Number.isNaN(ts) && (Number.isNaN(latestTs) || ts > latestTs)) {
        latest = logs[i];
        latestTs = ts;
      }
    }
    return latest;
  }, [selectedCustomer, customerFollowupLogs]);

  const lastReceiptContactNote = useMemo(() => {
    if (!lastReceipt) return '';
    return (
      (lastReceipt.customerId ? contactNotes[lastReceipt.customerId] : '') ||
      lastReceipt.customerContactNote ||
      ''
    );
  }, [lastReceipt, contactNotes]);

  const lastReceiptCustomer = useMemo(
    () =>
      lastReceipt?.customerId
        ? customers.find((c) => c.id === lastReceipt.customerId) ?? null
        : null,
    [lastReceipt, customers]
  );

  const selectedCustomerDueInfo = useMemo(
    () =>
      selectedCustomer
        ? getCustomerDueInfo(
            dueDates[selectedCustomer.id],
            todayIso,
            selectedCustomer.total_debt
          )
        : null,
    [selectedCustomer, dueDates, todayIso]
  );

  const selectedCustomerCreditLimit = useMemo(
    () => (selectedCustomer ? creditLimits[selectedCustomer.id] ?? 0 : 0),
    [selectedCustomer, creditLimits]
  );

  const selectedCustomerCreditHealth = useMemo(
    () =>
      selectedCustomer
        ? getCustomerCreditHealth(
            Number(selectedCustomer.total_debt ?? 0),
            selectedCustomerCreditLimit,
            selectedCustomerDueInfo
          )
        : null,
    [selectedCustomer, selectedCustomerCreditLimit, selectedCustomerDueInfo]
  );

  const projectedCustomerDebt = useMemo(
    () =>
      selectedCustomer
        ? Number(
            (
              Number(selectedCustomer.total_debt) +
              (paymentMethod === 'credit' ? netCreditAmount : finalTotal)
            ).toFixed(2)
          )
        : 0,
    [selectedCustomer, paymentMethod, netCreditAmount, finalTotal]
  );

  const isOverCreditLimit =
    paymentMethod === 'credit' &&
    Boolean(selectedCustomer) &&
    selectedCustomerCreditLimit > 0 &&
    projectedCustomerDebt > selectedCustomerCreditLimit;

  const selectedCustomerPoints = useMemo(
    () => (selectedCustomer ? loyaltyPoints[selectedCustomer.id] ?? 0 : 0),
    [selectedCustomer, loyaltyPoints]
  );

  const selectedCustomerStoreCredit = useMemo(
    () => (selectedCustomer ? storeCredits[selectedCustomer.id] ?? 0 : 0),
    [selectedCustomer, storeCredits]
  );

  const maxUsableStoreCredit = useMemo(() => {
    if (!selectedCustomer || selectedCustomerStoreCredit <= 0 || cartTotal <= 0) {
      return 0;
    }
    return Number(Math.min(selectedCustomerStoreCredit, cartTotal).toFixed(2));
  }, [selectedCustomer, selectedCustomerStoreCredit, cartTotal]);

  const selectedCustomerVipPct = useMemo(
    () => (selectedCustomer ? defaultDiscounts[selectedCustomer.id] ?? 0 : 0),
    [selectedCustomer, defaultDiscounts]
  );

  const selectedCustomerVipDiscountAmount = useMemo(() => {
    if (selectedCustomerVipPct <= 0 || cartTotal <= 0) return 0;
    return Math.min(
      cartTotal,
      Number(((cartTotal * selectedCustomerVipPct) / 100).toFixed(2))
    );
  }, [selectedCustomerVipPct, cartTotal]);

  const appliedVipPct =
    selectedCustomer &&
    vipDiscountApplied &&
    selectedCustomerVipPct > 0 &&
    discountAmount > 0 &&
    pointsToRedeem === 0
      ? selectedCustomerVipPct
      : 0;

  const earnedPointsThisBill = useMemo(
    () =>
      selectedCustomer || selectedCustomerId === '__new__'
        ? Math.floor(finalTotal / LOYALTY_BAHT_PER_EARN_POINT)
        : 0,
    [selectedCustomer, selectedCustomerId, finalTotal]
  );

  const maxRedeemableBaht = useMemo(() => {
    if (!selectedCustomer) return 0;
    const byPoints = Math.floor(
      selectedCustomerPoints / LOYALTY_POINTS_PER_DISCOUNT_BAHT
    );
    const byTotal = Math.floor(cartTotal);
    return Math.max(0, Math.min(byPoints, byTotal));
  }, [selectedCustomer, selectedCustomerPoints, cartTotal]);

  const maxRedeemablePoints = useMemo(
    () => maxRedeemableBaht * LOYALTY_POINTS_PER_DISCOUNT_BAHT,
    [maxRedeemableBaht]
  );

  const selectPaymentMethod = useCallback((method: PaymentMethod) => {
    setPaymentMethod(method);
    if (method !== 'cash') {
      setSplitCashQrEnabled(false);
    }
    if (method === 'credit') {
      setSettleOldDebtInput('');
    }
  }, []);

  const updateCashReceived = (nextValue: string) => {
    setCashReceived(nextValue);
    const nextNum = Number(nextValue) || 0;
    const nextShortfall = Math.max(
      0,
      Number((totalToCollectWithDebt - nextNum).toFixed(2))
    );
    if (!(nextNum > 0 && nextNum < totalToCollectWithDebt && nextShortfall > 0)) {
      setSplitCashQrEnabled(false);
    }
  };

  const handleSelectCustomer = (nextCustomerId: string) => {
    setSelectedCustomerId(nextCustomerId);
    setSettleOldDebtInput('');
    setDepositChangeToCredit(false);
    if (!nextCustomerId) {
      setCreditDownPaymentInput('');
      setCreditDueDateInput('');
    } else if (nextCustomerId === '__new__') {
      setCreditDueDateInput('');
    } else {
      setCreditDueDateInput(dueDates[nextCustomerId] ?? '');
    }
    if (pointsToRedeem > 0 || vipDiscountApplied || storeCreditToUse > 0) {
      setPointsToRedeem(0);
      setVipDiscountApplied(false);
      setStoreCreditToUse(0);
      setBillDiscount('');
      setCashReceived(String(cartTotal));
      setSplitCashQrEnabled(false);
    }
  };

  const handleDiscountChange = (val: string) => {
    if (pointsToRedeem > 0) {
      setPointsToRedeem(0);
    }
    if (vipDiscountApplied) {
      setVipDiscountApplied(false);
    }
    if (storeCreditToUse > 0) {
      setStoreCreditToUse(0);
    }
    setBillDiscount(val);
    const disc = Math.min(cartTotal, Math.max(0, Number(val) || 0));
    const nextFinal = Math.max(0, cartTotal - disc);
    setCashReceived(String(nextFinal));
    setSplitCashQrEnabled(false);
  };

  const handleApplyVipDiscount = () => {
    if (
      !selectedCustomer ||
      selectedCustomerVipPct <= 0 ||
      selectedCustomerVipDiscountAmount <= 0
    ) {
      return;
    }
    if (pointsToRedeem > 0) {
      setPointsToRedeem(0);
    }
    if (storeCreditToUse > 0) {
      setStoreCreditToUse(0);
    }
    setVipDiscountApplied(true);
    const val = String(selectedCustomerVipDiscountAmount);
    setBillDiscount(val);
    const disc = Math.min(cartTotal, Math.max(0, Number(val) || 0));
    const nextFinal = Math.max(0, cartTotal - disc);
    setCashReceived(String(nextFinal));
    setSplitCashQrEnabled(false);
  };

  const handleRedeemPoints = (points: number) => {
    if (!selectedCustomer) return;
    const usablePoints = Math.min(
      maxRedeemablePoints,
      Math.max(
        0,
        Math.floor(points / LOYALTY_POINTS_PER_DISCOUNT_BAHT) *
          LOYALTY_POINTS_PER_DISCOUNT_BAHT
      )
    );
    if (usablePoints <= 0) return;
    const discountBaht = usablePoints / LOYALTY_POINTS_PER_DISCOUNT_BAHT;
    setVipDiscountApplied(false);
    setStoreCreditToUse(0);
    setPointsToRedeem(usablePoints);
    setBillDiscount(String(discountBaht));
    const nextFinal = Math.max(0, cartTotal - discountBaht);
    setCashReceived(String(nextFinal));
    setSplitCashQrEnabled(false);
  };

  const handleClearRedeemedPoints = () => {
    setPointsToRedeem(0);
    setVipDiscountApplied(false);
    setStoreCreditToUse(0);
    setDepositChangeToCredit(false);
    setStoreCreditToUse(0);
    setBillDiscount('');
    setCashReceived(String(cartTotal));
    setSplitCashQrEnabled(false);
  };

  const handleApplyStoreCredit = () => {
    if (!selectedCustomer || maxUsableStoreCredit <= 0) return;
    const creditAmount = Number(maxUsableStoreCredit.toFixed(2));
    setPointsToRedeem(0);
    setVipDiscountApplied(false);
    setStoreCreditToUse(0);
    setDepositChangeToCredit(false);
    setStoreCreditToUse(creditAmount);
    setBillDiscount(String(creditAmount));
    const nextFinal = Math.max(0, Number((cartTotal - creditAmount).toFixed(2)));
    setCashReceived(String(nextFinal));
    setSplitCashQrEnabled(false);
  };

  const handleClearStoreCredit = () => {
    setStoreCreditToUse(0);
    setBillDiscount('');
    setCashReceived(String(cartTotal));
    setSplitCashQrEnabled(false);
  };

  const focusSearchOnDesktop = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, []);

  const buildDefaultDeliveryInfo = useCallback(() => {
    if (!selectedCustomer) return '';
    const parts: string[] = [];
    if (selectedCustomer.name?.trim()) parts.push(selectedCustomer.name.trim());
    if (selectedCustomer.phone?.trim()) parts.push(`โทร ${selectedCustomer.phone.trim()}`);
    if (selectedCustomerContactNote.trim()) parts.push(selectedCustomerContactNote.trim());
    return parts.join(' • ');
  }, [selectedCustomer, selectedCustomerContactNote]);

  const handleOpenHoldModal = useCallback(() => {
    if (cart.length === 0) return;
    setHoldNoteInput('');
    setHoldTagInput('');
    setHoldOrderTypeInput('walk_in');
    setHoldDeliveryInfoInput(buildDefaultDeliveryInfo());
    setHoldModalOpen(true);
  }, [cart.length, buildDefaultDeliveryInfo]);

  const handleSelectHoldOrderType = (nextType: HeldBillOrderType) => {
    setHoldOrderTypeInput(nextType);
    if (nextType !== 'walk_in' && !holdDeliveryInfoInput.trim()) {
      const fallback = buildDefaultDeliveryInfo();
      if (fallback) setHoldDeliveryInfoInput(fallback);
    }
  };

  const handleConfirmHoldBill = (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;
    const trimmedNote = holdNoteInput.trim();
    const resolvedNote = trimmedNote || selectedCustomer?.name?.trim() || '';
    const resolvedTag = holdTagInput.trim() || undefined;
    const trimmedDeliveryInfo =
      holdOrderTypeInput !== 'walk_in' ? holdDeliveryInfoInput.trim() : '';
    const activeItemNotes: Record<string, string> = {};
    for (const item of cart) {
      const trimmedItemNote = (cartItemNotes[item.key] ?? '').trim();
      if (trimmedItemNote) {
        activeItemNotes[item.key] = trimmedItemNote;
      }
    }
    const newHeld: HeldBill = {
      id: `hold_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      items: [...cart],
      total: cartTotal,
      count: cartCount,
      note: resolvedNote,
      tag: resolvedTag,
      orderType: holdOrderTypeInput,
      deliveryInfo: trimmedDeliveryInfo || undefined,
      customerId: selectedCustomer?.id,
      customerName: selectedCustomer?.name,
      itemNotes: Object.keys(activeItemNotes).length > 0 ? activeItemNotes : undefined,
      createdAt: new Date().toISOString(),
    };
    const updated = [newHeld, ...heldBills];
    saveHeldBills(updated);
    setCart([]);
    setCartItemNotes({});
    setEditingNoteKey(null);
    setManualPriceKeys(new Set());
    setSelectedCustomerId('');
    setPointsToRedeem(0);
    setVipDiscountApplied(false);
    setStoreCreditToUse(0);
    setDepositChangeToCredit(false);
    setBillDiscount('');
    setOrderNote('');
    setHoldModalOpen(false);
    setHoldNoteInput('');
    setHoldTagInput('');
    setHoldOrderTypeInput('walk_in');
    setHoldDeliveryInfoInput('');
    setSplitHoldMode(false);
    setSplitSelectedKeys(new Set());
    setMobileCartOpen(false);
    const label = resolvedNote || resolvedTag;
    showToast(
      'success',
      label ? `พักบิล "${label}" ไว้ชั่วคราวเรียบร้อยแล้ว` : 'พักบิลไว้ชั่วคราวเรียบร้อยแล้ว'
    );
  };

  const handleToggleSplitHoldMode = () => {
    setSplitHoldMode((prev) => !prev);
    setSplitSelectedKeys(new Set());
  };

  const handleToggleSplitSelectKey = (key: string) => {
    setSplitSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSplitCartToHeldBill = () => {
    if (cart.length < 2) return;
    const selectedItems = cart.filter((item) => splitSelectedKeys.has(item.key));
    const remainingItems = cart.filter((item) => !splitSelectedKeys.has(item.key));
    if (selectedItems.length === 0 || remainingItems.length === 0) return;

    const splitItemNotes: Record<string, string> = {};
    const remainingItemNotes: Record<string, string> = {};
    for (const item of selectedItems) {
      const trimmed = (cartItemNotes[item.key] ?? '').trim();
      if (trimmed) splitItemNotes[item.key] = trimmed;
    }
    for (const item of remainingItems) {
      const note = cartItemNotes[item.key];
      if (note !== undefined) remainingItemNotes[item.key] = note;
    }

    const splitTotal = selectedItems.reduce(
      (sum, item) => sum + item.unit_price * item.qty,
      0
    );
    const splitCount = selectedItems.reduce((sum, item) => sum + item.qty, 0);

    const newHeld: HeldBill = {
      id: `hold_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      items: selectedItems,
      total: splitTotal,
      count: splitCount,
      note: `แยกจากตะกร้า (${selectedItems.length} รายการ)`,
      itemNotes: Object.keys(splitItemNotes).length > 0 ? splitItemNotes : undefined,
      createdAt: new Date().toISOString(),
    };

    saveHeldBills([newHeld, ...heldBills]);
    setCart(remainingItems);
    setCartItemNotes(remainingItemNotes);
    if (editingNoteKey && splitSelectedKeys.has(editingNoteKey)) {
      setEditingNoteKey(null);
    }
    setManualPriceKeys((prev) => {
      const next = new Set(prev);
      for (const item of selectedItems) {
        next.delete(item.key);
      }
      return next;
    });
    setSplitHoldMode(false);
    setSplitSelectedKeys(new Set());
    showToast(
      'success',
      `ย้าย ${selectedItems.length} รายการไปพักบิลใหม่เรียบร้อยแล้ว (เหลือ ${remainingItems.length} รายการในตะกร้า)`
    );
  };

  const handleToggleHeldBillTag = (id: string, tag: string) => {
    const updated = heldBills.map((b) =>
      b.id === id ? { ...b, tag: b.tag === tag ? undefined : tag } : b
    );
    saveHeldBills(updated);
  };

  const handleToggleHeldBillPackingStatus = (id: string) => {
    const updated = heldBills.map((b) =>
      b.id === id
        ? {
            ...b,
            packingStatus: (b.packingStatus === 'packed' ? 'pending' : 'packed') as
              | 'pending'
              | 'packed',
          }
        : b
    );
    saveHeldBills(updated);
  };

  const handleToggleHeldBillDeliveryStatus = (id: string) => {
    const updated = heldBills.map((b) =>
      b.id === id
        ? {
            ...b,
            deliveryStatus: (b.deliveryStatus === 'out_for_delivery'
              ? 'waiting'
              : 'out_for_delivery') as 'waiting' | 'out_for_delivery',
          }
        : b
    );
    saveHeldBills(updated);
  };

  const handleSelectHeldBillRider = (id: string, rider: string) => {
    const trimmed = rider.trim();
    const updated = heldBills.map((b) =>
      b.id === id
        ? {
            ...b,
            riderName: b.riderName === trimmed ? undefined : trimmed || undefined,
          }
        : b
    );
    saveHeldBills(updated);
  };

  const handlePrintHeldBillPackingSlip = (bill: HeldBill) => {
    setPrintingHeldBill(bill);
    setPrintMode('held_packing_slip');
    setTimeout(() => {
      window.print();
    }, 80);
  };

  const restoreHeldBillToCart = (
    id: string,
    options?: { preserveNote?: boolean }
  ): { target: HeldBill; restoredTotal: number; resolvedCustomerId: string } | null => {
    const target = heldBills.find((b) => b.id === id);
    if (!target) return null;

    let remaining = heldBills.filter((b) => b.id !== id);
    if (cart.length > 0) {
      // Auto-park current active cart so items are not lost
      const swapItemNotes: Record<string, string> = {};
      for (const item of cart) {
        const trimmedItemNote = (cartItemNotes[item.key] ?? '').trim();
        if (trimmedItemNote) {
          swapItemNotes[item.key] = trimmedItemNote;
        }
      }
      const autoParked: HeldBill = {
        id: `hold_${Date.now()}_swap`,
        items: [...cart],
        total: cartTotal,
        count: cartCount,
        note: selectedCustomer?.name
          ? `${selectedCustomer.name} (สลับจากตะกร้าก่อนหน้า)`
          : 'สลับจากตะกร้าก่อนหน้า',
        customerId: selectedCustomer?.id,
        customerName: selectedCustomer?.name,
        itemNotes: Object.keys(swapItemNotes).length > 0 ? swapItemNotes : undefined,
        createdAt: new Date().toISOString(),
      };
      remaining = [autoParked, ...remaining];
    }

    saveHeldBills(remaining);
    const restoredManualKeys = new Set<string>();
    const syncedRestoredItems = target.items.map((item) => {
      const prod = item.product_id ? productById.get(item.product_id) : undefined;
      if (
        !item.product_id ||
        prod?.allow_custom_price ||
        Math.abs(Number(item.conversion_rate) - 1) > 1e-9
      ) {
        return item;
      }
      const units = item.available_units ?? prod?.product_units ?? [];
      const standardUnit = units.find((u) => u.unit_name === item.unit_name);
      if (!standardUnit) return item;
      const tier = wholesaleTiers[item.product_id];
      const matchesStandardOrTier =
        item.unit_price === Number(standardUnit.selling_price) ||
        (tier !== undefined && item.unit_price === tier.unitPrice);
      if (!matchesStandardOrTier) {
        restoredManualKeys.add(item.key);
        return item;
      }
      const resolved = resolveWholesaleItemPrice({
        productId: item.product_id,
        unitName: item.unit_name,
        conversionRate: item.conversion_rate,
        qty: item.qty,
        availableUnits: item.available_units,
        product: prod,
        wholesaleTiers,
        isManualPrice: false,
      });
      return resolved !== null && resolved !== item.unit_price
        ? { ...item, unit_price: resolved }
        : item;
    });
    const restoredTotal = syncedRestoredItems.reduce(
      (sum, item) => sum + item.unit_price * item.qty,
      0
    );
    const resolvedCustomerId =
      target.customerId && customers.some((c) => c.id === target.customerId)
        ? target.customerId
        : cart.length > 0
          ? ''
          : selectedCustomerId;

    setManualPriceKeys(restoredManualKeys);
    setCart(syncedRestoredItems);
    setCartItemNotes(target.itemNotes ? { ...target.itemNotes } : {});
    setEditingNoteKey(null);
    if (target.customerId && customers.some((c) => c.id === target.customerId)) {
      setSelectedCustomerId(target.customerId);
    } else if (cart.length > 0) {
      setSelectedCustomerId('');
    }
    setPointsToRedeem(0);
    setVipDiscountApplied(false);
    setStoreCreditToUse(0);
    setDepositChangeToCredit(false);
    setBillDiscount('');
    setOrderNote(options?.preserveNote ? target.note || '' : '');
    setHeldBillsOpen(false);
    return { target, restoredTotal, resolvedCustomerId };
  };

  const handleRestoreHeldBill = (id: string) => {
    const restored = restoreHeldBillToCart(id);
    if (!restored) return;
    const restoreLabel = restored.target.note || restored.target.tag;
    showToast(
      'success',
      restoreLabel
        ? `เรียกคืนบิล "${restoreLabel}" แล้ว`
        : 'เรียกคืนบิลที่พักไว้เรียบร้อยแล้ว'
    );
  };

  const handleQuickCheckoutHeldBill = (id: string) => {
    const restored = restoreHeldBillToCart(id, { preserveNote: true });
    if (!restored) return;
    const { target, restoredTotal, resolvedCustomerId } = restored;
    setPaymentMethod('cash');
    setSplitCashQrEnabled(false);
    setCashReceived(String(Math.max(0, restoredTotal)));
    setPartialCash('0');
    setCreditDownPaymentInput('');
    setSettleOldDebtInput('');
    setCreditDueDateInput(resolvedCustomerId ? (dueDates[resolvedCustomerId] ?? '') : '');
    setCheckoutOpen(true);
    setMobileCartOpen(false);
    const restoreLabel = target.note || target.tag || target.customerName;
    showToast(
      'success',
      restoreLabel
        ? `พร้อมคิดเงินบิล "${restoreLabel}" แล้ว`
        : 'ดึงบิลเข้าหน้าคิดเงินเรียบร้อยแล้ว'
    );
  };

  const handleDeleteHeldBill = (id: string) => {
    const updated = heldBills.filter((b) => b.id !== id);
    saveHeldBills(updated);
    if (updated.length <= 1) {
      setConfirmClearHeldBills(false);
    }
    showToast('success', 'ลบบิลที่พักไว้เรียบร้อยแล้ว');
  };

  const handleClearAllHeldBills = () => {
    saveHeldBills([]);
    setConfirmClearHeldBills(false);
    showToast('success', 'ล้างบิลที่พักไว้ทั้งหมดเรียบร้อยแล้ว');
  };

  const handleMergeCartIntoHeldBill = (heldBillId: string) => {
    if (cart.length === 0) return;
    const target = heldBills.find((b) => b.id === heldBillId);
    if (!target) return;

    const mergedItems: CartItem[] = target.items.map((item) => ({ ...item }));
    const mergedItemNotes: Record<string, string> = { ...(target.itemNotes ?? {}) };

    for (const incoming of cart) {
      const matchIdx = mergedItems.findIndex(
        (existing) =>
          existing.key === incoming.key ||
          (Boolean(existing.product_id) &&
            existing.product_id === incoming.product_id &&
            existing.unit_name === incoming.unit_name)
      );

      let noteTargetKey = incoming.key;
      if (matchIdx >= 0) {
        const existing = mergedItems[matchIdx];
        noteTargetKey = existing.key;
        const nextQty = existing.qty + incoming.qty;
        const prod = existing.product_id ? productById.get(existing.product_id) : undefined;
        const units = existing.available_units ?? prod?.product_units ?? [];
        const standardUnit = units.find((u) => u.unit_name === existing.unit_name);
        const tier = existing.product_id ? wholesaleTiers[existing.product_id] : undefined;
        const existingWasManual =
          Boolean(standardUnit) &&
          existing.unit_price !== Number(standardUnit!.selling_price) &&
          (tier === undefined || existing.unit_price !== tier.unitPrice);
        const resolvedPrice = resolveWholesaleItemPrice({
          productId: existing.product_id,
          unitName: existing.unit_name,
          conversionRate: existing.conversion_rate,
          qty: nextQty,
          availableUnits: existing.available_units,
          product: prod,
          wholesaleTiers,
          isManualPrice: existingWasManual || manualPriceKeys.has(incoming.key),
        });
        mergedItems[matchIdx] = {
          ...existing,
          qty: nextQty,
          unit_price: resolvedPrice !== null ? resolvedPrice : existing.unit_price,
        };
      } else {
        const prod = incoming.product_id ? productById.get(incoming.product_id) : undefined;
        const resolvedPrice = resolveWholesaleItemPrice({
          productId: incoming.product_id,
          unitName: incoming.unit_name,
          conversionRate: incoming.conversion_rate,
          qty: incoming.qty,
          availableUnits: incoming.available_units,
          product: prod,
          wholesaleTiers,
          isManualPrice: manualPriceKeys.has(incoming.key),
        });
        mergedItems.push({
          ...incoming,
          unit_price: resolvedPrice !== null ? resolvedPrice : incoming.unit_price,
        });
      }

      const incomingNote = (cartItemNotes[incoming.key] ?? '').trim();
      if (incomingNote) {
        const existingNote = (mergedItemNotes[noteTargetKey] ?? '').trim();
        if (!existingNote) {
          mergedItemNotes[noteTargetKey] = incomingNote;
        } else if (existingNote !== incomingNote) {
          mergedItemNotes[noteTargetKey] = `${existingNote} | ${incomingNote}`;
        }
      }
    }

    const nextTotal = mergedItems.reduce((sum, item) => sum + item.unit_price * item.qty, 0);
    const nextCount = mergedItems.reduce((sum, item) => sum + item.qty, 0);

    const updatedBills = heldBills.map((bill) =>
      bill.id === heldBillId
        ? {
            ...bill,
            items: mergedItems,
            total: nextTotal,
            count: nextCount,
            itemNotes: Object.keys(mergedItemNotes).length > 0 ? mergedItemNotes : undefined,
          }
        : bill
    );

    saveHeldBills(updatedBills);
    const mergedCount = cartCount;
    setCart([]);
    setCartItemNotes({});
    setEditingNoteKey(null);
    setManualPriceKeys(new Set());
    setSelectedCustomerId('');
    setPointsToRedeem(0);
    setVipDiscountApplied(false);
    setStoreCreditToUse(0);
    setDepositChangeToCredit(false);
    setBillDiscount('');
    setOrderNote('');
    setHoldModalOpen(false);
    setHoldNoteInput('');
    setHoldTagInput('');
    setHoldOrderTypeInput('walk_in');
    setHoldDeliveryInfoInput('');
    setSplitHoldMode(false);
    setSplitSelectedKeys(new Set());
    setMobileCartOpen(false);

    const targetLabel = target.note || target.tag || target.customerName;
    showToast(
      'success',
      targetLabel
        ? `รวมสินค้าในตะกร้า (${mergedCount} ชิ้น) เข้าบิลพัก "${targetLabel}" เรียบร้อยแล้ว`
        : `รวมสินค้าในตะกร้า (${mergedCount} ชิ้น) เข้าบิลพักเรียบร้อยแล้ว`
    );
  };

  const handleCopyHeldBillLineSummary = async (bill: HeldBill) => {
    const storeTitle = settings?.store_name?.trim() || 'ร้านขายของชำ POS';
    const typeMeta = getHeldBillOrderTypeMeta(bill.orderType);
    const lines: string[] = [
      `[${storeTitle}] สรุปออเดอร์ (${typeMeta.badgeText})`,
    ];
    if (bill.customerName || bill.note) {
      const who =
        bill.customerName && bill.note && bill.customerName !== bill.note
          ? `${bill.customerName} (${bill.note})`
          : bill.customerName || bill.note;
      lines.push(`ลูกค้า/อ้างอิง: ${who}`);
    }
    if (bill.deliveryInfo) {
      lines.push(`นัดรับ/จัดส่ง: ${bill.deliveryInfo}`);
    }
    lines.push('รายการสินค้า:');
    for (const item of bill.items) {
      const itemTotal = formatBaht(item.unit_price * item.qty);
      lines.push(`- ${item.product_name} x ${item.qty} ${item.unit_name} = ${itemTotal}`);
      const itemNote = bill.itemNotes?.[item.key]?.trim();
      if (itemNote) {
        lines.push(`  (โน้ต: ${itemNote})`);
      }
    }
    lines.push(`รวม ${formatNumber(bill.count)} ชิ้น | ยอดรวม ${formatBaht(bill.total)}`);
    lines.push('รบกวนตรวจสอบและยืนยันออเดอร์อีกครั้งนะครับ/คะ 🙏');
    const summaryText = lines.join('\n');

    try {
      await navigator.clipboard.writeText(summaryText);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = summaryText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedHeldBillId(bill.id);
    setTimeout(() => {
      setCopiedHeldBillId((prev) => (prev === bill.id ? null : prev));
    }, 2000);
    showToast('success', 'คัดลอกสรุปออเดอร์ส่ง LINE แล้ว');
  };

  const handleCopyRiderDeliverySheet = async (hb: HeldBill) => {
    const storeTitle = settings?.store_name?.trim() || 'ร้านขายของชำ POS';
    const packingLabel =
      hb.packingStatus === 'packed' ? '✅ จัดใส่ถุงเสร็จแล้ว' : '⏳ รอจัดของ';
    const deliveryStatusLabel =
      hb.deliveryStatus === 'out_for_delivery' ? '🛵 กำลังออกไปส่ง' : '🏠 รอจัดส่ง';
    const customerLabel =
      hb.customerName && hb.note && hb.customerName !== hb.note
        ? `${hb.customerName} (${hb.note})`
        : hb.customerName || hb.note || '-';
    const tagSuffix = hb.tag ? ` [${hb.tag}]` : '';
    const lines: string[] = [
      `🛵 ใบงานคนส่งของ (${storeTitle})`,
      `ผู้ส่ง: ${hb.riderName || 'ยังไม่ระบุผู้ส่ง'}`,
      `สถานะ: ${packingLabel} | ${deliveryStatusLabel}`,
      `ลูกค้า/อ้างอิง: ${customerLabel}${tagSuffix}`,
      `ที่อยู่/เบอร์โทร/จุดสังเกต: ${hb.deliveryInfo || 'ยังไม่ระบุ'}`,
      `รายการสินค้า (${formatNumber(hb.items.length)} รายการ / ${formatNumber(hb.count)} ชิ้น):`,
    ];
    for (const item of hb.items) {
      const itemNote = hb.itemNotes?.[item.key]?.trim();
      lines.push(
        `- ${item.product_name} x ${item.qty} ${item.unit_name}${itemNote ? ` (${itemNote})` : ''}`
      );
    }
    lines.push(`💰 ยอดเงินที่ต้องเก็บปลายทาง: ${formatBaht(hb.total)}`);
    const sheetText = lines.join('\n');

    try {
      await navigator.clipboard.writeText(sheetText);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = sheetText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedRiderSheetBillId(hb.id);
    setTimeout(() => {
      setCopiedRiderSheetBillId((prev) => (prev === hb.id ? null : prev));
    }, 2000);
    showToast('success', 'คัดลอกใบงานคนส่งของสำหรับส่ง LINE แล้ว');
  };

  const openSaveBundleModal = () => {
    if (cart.length < 2) return;
    if (bundleDraftItems.length === 0) {
      showToast(
        'error',
        'สินค้าคิดราคาด่วนไม่มีรหัสสินค้า ไม่สามารถบันทึกเป็นชุดขายด่วนได้'
      );
      return;
    }
    setBundleNameInput('');
    setSaveBundleModalOpen(true);
  };

  const handleConfirmSaveBundle = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = bundleNameInput.trim();
    if (!trimmedName) {
      showToast('error', 'กรุณาระบุชื่อชุดสินค้าขายด่วน');
      return;
    }
    if (bundleDraftItems.length === 0) {
      showToast('error', 'ไม่พบรายการสินค้าที่สามารถบันทึกเป็นชุดได้');
      return;
    }
    const newBundle: PosBundle = {
      id: createBundleId(),
      name: trimmedName,
      items: bundleDraftItems.map(({ product_id, unit_id, qty }) => ({
        product_id,
        unit_id,
        qty,
      })),
    };
    saveBundles([newBundle, ...bundles]);
    setSaveBundleModalOpen(false);
    setBundleNameInput('');
    showToast('success', `บันทึกชุดขายด่วน "${trimmedName}" เรียบร้อยแล้ว`);
  };

  const handleAddBundleToCart = (bundle: PosBundle) => {
    const resolvedAdditions: Array<{
      key: string;
      product: Product;
      unit: ProductUnit;
      units: ProductUnit[];
      qty: number;
    }> = [];
    let missingCount = 0;

    for (const bundleItem of bundle.items) {
      const product = productById.get(bundleItem.product_id);
      if (!product) {
        missingCount += 1;
        continue;
      }
      const units = product.product_units ?? [];
      const chosenUnit =
        (bundleItem.unit_id
          ? units.find((u) => u.id === bundleItem.unit_id)
          : undefined) ??
        units.find((u) => u.is_default) ??
        units[0] ?? {
          id: 'base',
          product_id: product.id,
          unit_name: product.base_unit,
          conversion_rate: 1,
          selling_price: 0,
          is_default: true,
        };
      const qtyToAdd = Math.max(1, Math.floor(Number(bundleItem.qty) || 1));
      resolvedAdditions.push({
        key: `${product.id}_${chosenUnit.unit_name}`,
        product,
        unit: chosenUnit,
        units,
        qty: qtyToAdd,
      });
    }

    if (resolvedAdditions.length === 0) {
      showToast('error', `ไม่พบสินค้าในชุด "${bundle.name}" ในระบบ`);
      return;
    }

    setCart((prev) => {
      const next = [...prev];
      for (const entry of resolvedAdditions) {
        const existingIdx = next.findIndex((i) => i.key === entry.key);
        if (existingIdx >= 0) {
          const existingItem = next[existingIdx];
          const nextQty = existingItem.qty + entry.qty;
          const resolvedPrice = resolveWholesaleItemPrice({
            productId: existingItem.product_id,
            unitName: existingItem.unit_name,
            conversionRate: existingItem.conversion_rate,
            qty: nextQty,
            availableUnits: existingItem.available_units,
            product: entry.product,
            wholesaleTiers,
            isManualPrice: manualPriceKeys.has(entry.key),
          });
          next[existingIdx] = {
            ...existingItem,
            qty: nextQty,
            unit_price: resolvedPrice ?? existingItem.unit_price,
          };
        } else {
          const conversionRate = Number(entry.unit.conversion_rate);
          const resolvedPrice = resolveWholesaleItemPrice({
            productId: entry.product.id,
            unitName: entry.unit.unit_name,
            conversionRate,
            qty: entry.qty,
            availableUnits: entry.units,
            product: entry.product,
            wholesaleTiers,
            isManualPrice: false,
          });
          next.push({
            key: entry.key,
            product_id: entry.product.id,
            product_name: entry.product.name,
            unit_name: entry.unit.unit_name,
            conversion_rate: conversionRate,
            unit_price: resolvedPrice ?? Number(entry.unit.selling_price),
            unit_cost: Number(entry.product.cost_price),
            qty: entry.qty,
            available_units: entry.units,
          });
        }
      }
      return next;
    });

    playBeep('add');
    if (missingCount > 0) {
      showToast(
        'success',
        `เพิ่มชุด "${bundle.name}" (${resolvedAdditions.length} รายการ) แล้ว (ข้าม ${missingCount} รายการที่ไม่มีในระบบ)`
      );
    } else {
      showToast(
        'success',
        `เพิ่มชุด "${bundle.name}" (${resolvedAdditions.length} รายการ) ลงตะกร้าแล้ว`
      );
    }
  };

  const handleDeleteBundle = (bundleId: string) => {
    const target = bundles.find((b) => b.id === bundleId);
    const updated = bundles.filter((b) => b.id !== bundleId);
    saveBundles(updated);
    showToast(
      'success',
      target ? `ลบชุดขายด่วน "${target.name}" แล้ว` : 'ลบชุดขายด่วนแล้ว'
    );
  };

  const totalContainerDepositAmount = useMemo(
    () =>
      Math.round(
        containerDeposits.reduce((sum, item) => sum + item.depositAmount, 0) * 100
      ) / 100,
    [containerDeposits]
  );

  const totalContainerDepositQty = useMemo(
    () =>
      Math.round(
        containerDeposits.reduce((sum, item) => sum + item.qty, 0) * 100
      ) / 100,
    [containerDeposits]
  );

  const filteredContainerDeposits = useMemo(() => {
    const q = depositSearch.trim().toLowerCase();
    if (!q) return containerDeposits;
    return containerDeposits.filter(
      (dep) =>
        dep.customerName.toLowerCase().includes(q) ||
        dep.itemLabel.toLowerCase().includes(q)
    );
  }, [containerDeposits, depositSearch]);

  const openContainerDepositsModal = () => {
    setDepositSearch('');
    setContainerDepositsOpen(true);
  };

  const openContainerDepositFromCartItem = (item: CartItem) => {
    setDepositSearch('');
    setDepositItemLabel(item.product_name);
    setDepositQty(String(item.qty));
    setDepositCustomerName(selectedCustomer?.name ?? '');
    setDepositAmount('');
    setContainerDepositsOpen(true);
  };

  const handleAddContainerDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedLabel = depositItemLabel.trim();
    if (!trimmedLabel) {
      showToast('error', 'กรุณาระบุประเภทภาชนะที่มัดจำ');
      return;
    }
    const qtyNum = Math.round(Number(depositQty) * 100) / 100;
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      showToast('error', 'กรุณาระบุจำนวนภาชนะให้ถูกต้อง');
      return;
    }
    const amountNum = Math.round(Number(depositAmount) * 100) / 100;
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      showToast('error', 'กรุณาระบุยอดเงินมัดจำให้ถูกต้อง');
      return;
    }
    const resolvedCustomer = depositCustomerName.trim() || 'ลูกค้าทั่วไป';
    const newDeposit: ContainerDeposit = {
      id: createContainerDepositId(),
      customerName: resolvedCustomer,
      itemLabel: trimmedLabel,
      qty: qtyNum,
      depositAmount: amountNum,
      createdAt: new Date().toISOString(),
    };
    saveContainerDeposits([newDeposit, ...containerDeposits]);
    playBeep('success');
    showToast(
      'success',
      `บันทึกมัดจำ ${trimmedLabel} (${resolvedCustomer}) ${formatBaht(amountNum)} แล้ว`
    );
    setDepositCustomerName('');
    setDepositQty('1');
    setDepositAmount('');
    setDepositSearch('');
  };

  const handleReturnContainerDeposit = (id: string) => {
    const target = containerDeposits.find((item) => item.id === id);
    const updated = containerDeposits.filter((item) => item.id !== id);
    saveContainerDeposits(updated);
    playBeep('success');
    showToast(
      'success',
      target
        ? `คืนภาชนะ "${target.itemLabel}" และคืนเงินมัดจำ ${formatBaht(target.depositAmount)} ให้ ${target.customerName} แล้ว`
        : 'บันทึกคืนภาชนะและคืนเงินมัดจำเรียบร้อยแล้ว'
    );
  };

  const handleDeductContainerDepositInBill = (id: string) => {
    if (cart.length === 0) {
      showToast('error', 'กรุณาเพิ่มสินค้าลงตะกร้าก่อนหักคืนเงินมัดจำ');
      return;
    }
    const target = containerDeposits.find((item) => item.id === id);
    if (!target) return;

    const currentDiscount = Math.max(0, Number(billDiscount) || 0);
    const nextDiscount =
      Math.round((currentDiscount + target.depositAmount) * 100) / 100;
    setPointsToRedeem(0);
    setVipDiscountApplied(false);
    setStoreCreditToUse(0);
    setDepositChangeToCredit(false);
    setBillDiscount(String(nextDiscount));
    const clampedDiscount = Math.min(cartTotal, nextDiscount);
    setCashReceived(String(Math.max(0, cartTotal - clampedDiscount)));
    setSplitCashQrEnabled(false);

    const depositNote = `หักคืนมัดจำภาชนะ ${target.itemLabel} (${target.customerName} ×${formatNumber(target.qty)}) -${formatBaht(target.depositAmount)}`;
    setOrderNote((prev) =>
      prev.trim() ? `${prev.trim()} | ${depositNote}` : depositNote
    );

    const updated = containerDeposits.filter((item) => item.id !== id);
    saveContainerDeposits(updated);
    playBeep('success');
    showToast(
      'success',
      `คืนขวด "${target.itemLabel}" และหักลดในบิลนี้ -${formatBaht(target.depositAmount)} เรียบร้อยแล้ว`
    );
  };

  const pinnedIdSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);

  const pinnedCount = useMemo(
    () => products.filter((p) => pinnedIdSet.has(p.id)).length,
    [products, pinnedIdSet]
  );

  const promoProductsCount = useMemo(
    () => products.filter((p) => Boolean(promoLabels[p.id]?.trim())).length,
    [products, promoLabels]
  );

  const wholesaleProductsCount = useMemo(
    () => products.filter((p) => Boolean(wholesaleTiers[p.id])).length,
    [products, wholesaleTiers]
  );

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = products.filter((p) => {
      if (q) {
        const shelf = shelfLocations[p.id]?.toLowerCase() ?? '';
        const promo = promoLabels[p.id]?.toLowerCase() ?? '';
        const unitBarcodeMatch = Object.values(unitBarcodes[p.id] ?? {}).some((bc) =>
          bc.toLowerCase().includes(q)
        );
        return (
          p.name.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q)) ||
          unitBarcodeMatch ||
          (shelf !== '' && shelf.includes(q)) ||
          (promo !== '' && promo.includes(q))
        );
      }
      if (selectedCat === 'pinned') return pinnedIdSet.has(p.id);
      if (selectedCat === 'promo') return Boolean(promoLabels[p.id]?.trim());
      if (selectedCat === 'wholesale') return Boolean(wholesaleTiers[p.id]);
      if (selectedCat === 'quick') return p.is_quick_item;
      if (selectedCat === 'all') return true;
      return p.category_id === selectedCat;
    });

    return [...list].sort((a, b) => {
      const aPinned = pinnedIdSet.has(a.id);
      const bPinned = pinnedIdSet.has(b.id);
      if (aPinned !== bPinned) {
        return aPinned ? -1 : 1;
      }
      if (productSort === 'quick' && a.is_quick_item !== b.is_quick_item) {
        return a.is_quick_item ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'th');
    });
  }, [products, search, selectedCat, productSort, pinnedIdSet, shelfLocations, promoLabels, wholesaleTiers, unitBarcodes]);

  const addProductToCart = (product: Product, chosenUnit?: ProductUnit) => {
    if (product.allow_custom_price) {
      setCustomPriceProduct(product);
      setCustomPriceInput('');
      return;
    }

    const units = product.product_units ?? [];
    const unit =
      chosenUnit ??
      units.find((u) => u.is_default) ??
      units[0] ?? {
        id: 'base',
        product_id: product.id,
        unit_name: product.base_unit,
        conversion_rate: 1,
        selling_price: 0,
        is_default: true,
      };

    const key = `${product.id}_${unit.unit_name}`;
    const addQty = qtyMultiplier;
    const conversionRate = Number(unit.conversion_rate);
    const isExistingInCart = cart.some((i) => i.key === key);
    if (!isExistingInCart && manualPriceKeys.has(key)) {
      setManualPriceKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
    setCart((prev) => {
      const existing = prev.find((i) => i.key === key);
      if (existing) {
        const nextQty = existing.qty + addQty;
        const resolvedPrice = resolveWholesaleItemPrice({
          productId: existing.product_id,
          unitName: existing.unit_name,
          conversionRate: existing.conversion_rate,
          qty: nextQty,
          availableUnits: existing.available_units,
          product,
          wholesaleTiers,
          isManualPrice: manualPriceKeys.has(key),
        });
        return prev.map((i) =>
          i.key === key
            ? { ...i, qty: nextQty, unit_price: resolvedPrice ?? i.unit_price }
            : i
        );
      }
      const resolvedPrice = resolveWholesaleItemPrice({
        productId: product.id,
        unitName: unit.unit_name,
        conversionRate,
        qty: addQty,
        availableUnits: units,
        product,
        wholesaleTiers,
        isManualPrice: false,
      });
      return [
        ...prev,
        {
          key,
          product_id: product.id,
          product_name: product.name,
          unit_name: unit.unit_name,
          conversion_rate: conversionRate,
          unit_price: resolvedPrice ?? Number(unit.selling_price),
          unit_cost: Number(product.cost_price),
          qty: addQty,
          available_units: units,
        },
      ];
    });
    if (qtyMultiplier !== 1) {
      setQtyMultiplier(1);
    }
    playBeep('add');
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const q = search.trim().toLowerCase();
    if (!q) return;

    const exactBarcodeProduct = products.find(
      (p) => p.barcode && p.barcode.trim().toLowerCase() === q
    );
    let matchedUnitProduct: Product | null = null;
    let matchedUnit: ProductUnit | undefined;
    if (!exactBarcodeProduct) {
      for (const p of products) {
        const pUnitBarcodes = unitBarcodes[p.id];
        if (!pUnitBarcodes) continue;
        const foundUnit = (p.product_units ?? []).find((u) => {
          const bc = pUnitBarcodes[u.id] ?? pUnitBarcodes[u.unit_name];
          return bc && bc.trim().toLowerCase() === q;
        });
        if (foundUnit) {
          matchedUnitProduct = p;
          matchedUnit = foundUnit;
          break;
        }
      }
    }
    const targetProduct =
      exactBarcodeProduct ??
      matchedUnitProduct ??
      (filteredProducts.length === 1 ? filteredProducts[0] : null);

    if (targetProduct) {
      e.preventDefault();
      addProductToCart(targetProduct, matchedUnit);
      setSearch('');
      if (!targetProduct.allow_custom_price) {
        showToast(
          'success',
          matchedUnit
            ? `เพิ่ม "${targetProduct.name}" (${matchedUnit.unit_name}) ลงตะกร้าแล้ว`
            : `เพิ่ม "${targetProduct.name}" ลงตะกร้าแล้ว`
        );
      }
    }
  };

  const handleConfirmCustomPrice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPriceProduct) return;
    const price = Number(customPriceInput);
    if (!price || price <= 0) return;

    const key = `${customPriceProduct.id}_custom_${Date.now()}`;
    const addQty = qtyMultiplier;
    setCart((prev) => [
      ...prev,
      {
        key,
        product_id: customPriceProduct.id,
        product_name: customPriceProduct.name,
        unit_name: customPriceProduct.base_unit,
        conversion_rate: 1,
        unit_price: price,
        unit_cost: Number(customPriceProduct.cost_price),
        qty: addQty,
      },
    ]);
    if (qtyMultiplier !== 1) {
      setQtyMultiplier(1);
    }
    playBeep('add');
    setCustomPriceProduct(null);
  };

  const handleConfirmAdHoc = (e: React.FormEvent) => {
    e.preventDefault();
    const price = Number(adHocPrice);
    if (!price || price <= 0) return;

    setCart((prev) => [
      ...prev,
      {
        key: `adhoc_${Date.now()}`,
        product_id: null,
        product_name: adHocName.trim() || 'สินค้าเบ็ดเตล็ด',
        unit_name: 'รายการ',
        conversion_rate: 1,
        unit_price: price,
        unit_cost: 0,
        qty: 1,
      },
    ]);
    playBeep('add');
    setAdHocOpen(false);
    setAdHocName('สินค้าเบ็ดเตล็ด');
    setAdHocPrice('');
  };

  const openQuickMiscModal = useCallback(() => {
    setQuickMiscName('สินค้าเบ็ดเตล็ด');
    setQuickMiscPrice('');
    setQuickMiscCost('');
    setQuickMiscQty('1');
    setQuickMiscOpen(true);
    setTimeout(() => {
      quickMiscPriceInputRef.current?.focus();
    }, 40);
  }, []);

  const handleConfirmQuickMisc = (e: React.FormEvent) => {
    e.preventDefault();
    const price = Number(quickMiscPrice);
    const parsedCost = Number(quickMiscCost);
    const unitCost =
      quickMiscCost.trim() !== '' && Number.isFinite(parsedCost) && parsedCost >= 0
        ? parsedCost
        : 0;
    const qty = Math.floor(Number(quickMiscQty));
    if (!Number.isFinite(price) || price <= 0) return;
    if (!Number.isFinite(qty) || qty <= 0) return;

    setCart((prev) => [
      ...prev,
      {
        key: `misc_${Date.now()}`,
        product_id: null,
        product_name: quickMiscName.trim() || 'สินค้าเบ็ดเตล็ด',
        unit_name: 'รายการ',
        conversion_rate: 1,
        unit_price: price,
        unit_cost: unitCost,
        qty,
      },
    ]);
    playBeep('add');
    setQuickMiscOpen(false);
    setQuickMiscName('สินค้าเบ็ดเตล็ด');
    setQuickMiscPrice('');
    setQuickMiscCost('');
    setQuickMiscQty('1');
  };

  const handleSaveQuickMiscPreset = () => {
    const name = quickMiscName.trim();
    const price = Number(quickMiscPrice);
    const parsedCost = Number(quickMiscCost);
    const cost =
      quickMiscCost.trim() !== '' && Number.isFinite(parsedCost) && parsedCost >= 0
        ? parsedCost
        : 0;
    if (!name || !Number.isFinite(price) || price <= 0) {
      showToast('error', 'กรุณาระบุชื่อรายการและราคามากกว่า 0 ก่อนบันทึกปุ่มลัด');
      return;
    }

    const existingIdx = quickMiscPresets.findIndex(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
    const nextPresets =
      existingIdx >= 0
        ? quickMiscPresets.map((p, idx) => (idx === existingIdx ? { name, price, cost } : p))
        : [...quickMiscPresets, { name, price, cost }];
    saveQuickMiscPresets(nextPresets);
    showToast('success', `บันทึกปุ่มลัด "${name}" (฿${formatNumber(price)}) แล้ว`);
  };

  const handleApplyQuickMiscPreset = (preset: QuickMiscPreset) => {
    setQuickMiscName(preset.name);
    setQuickMiscPrice(String(preset.price));
    setQuickMiscCost(preset.cost > 0 ? String(preset.cost) : '');
  };

  const handleDeleteQuickMiscPreset = (presetName: string) => {
    const nextPresets = quickMiscPresets.filter(
      (p) => p.name.toLowerCase() !== presetName.toLowerCase()
    );
    saveQuickMiscPresets(nextPresets);
    showToast('success', `ลบปุ่มลัด "${presetName}" แล้ว`);
  };

  const handleCopyCurrentCartLineQuote = async () => {
    if (cart.length === 0) return;
    const storeTitle = settings?.store_name?.trim() || 'ร้านขายของชำ POS';
    const lines: string[] = [`[${storeTitle}] สรุปรายการสินค้า`];
    if (selectedCustomer) {
      lines.push(
        `ลูกค้า: ${selectedCustomer.name}${
          selectedCustomer.phone ? ` (${selectedCustomer.phone})` : ''
        }`
      );
    }

    const productItems = cart.filter((item) => !item.key.startsWith('service_'));
    const serviceItems = cart.filter((item) => item.key.startsWith('service_'));

    if (productItems.length > 0) {
      lines.push('รายการสินค้า:');
      for (const item of productItems) {
        const itemTotal = formatBaht(item.unit_price * item.qty);
        lines.push(
          `- ${item.product_name} x ${formatNumber(item.qty)} ${item.unit_name} = ${itemTotal}`
        );
        const itemNote = cartItemNotes[item.key]?.trim();
        if (itemNote) {
          lines.push(`  (โน้ต: ${itemNote})`);
        }
      }
    }

    if (serviceItems.length > 0) {
      lines.push('ค่าบริการ:');
      let serviceTotal = 0;
      for (const item of serviceItems) {
        const lineAmt = item.unit_price * item.qty;
        serviceTotal += lineAmt;
        lines.push(
          `- ${item.product_name} x ${formatNumber(item.qty)} = ${formatBaht(lineAmt)}`
        );
        const itemNote = cartItemNotes[item.key]?.trim();
        if (itemNote) {
          lines.push(`  (โน้ต: ${itemNote})`);
        }
      }
      lines.push(`รวมค่าบริการ: ${formatBaht(serviceTotal)}`);
    }

    if (discountAmount > 0) {
      lines.push(`ยอดรวมก่อนลด: ${formatBaht(cartTotal)}`);
      lines.push(`ส่วนลด: -${formatBaht(discountAmount)}`);
    }

    if (orderNote.trim()) {
      lines.push(`หมายเหตุ: ${orderNote.trim()}`);
    }

    const netTotal = discountAmount > 0 ? finalTotal : cartTotal;
    lines.push(`รวม ${formatNumber(cartCount)} ชิ้น | ยอดรวมสุทธิ: ${formatBaht(netTotal)}`);
    lines.push('รบกวนตรวจสอบรายการและยอดรวมอีกครั้งนะครับ/คะ 🙏');
    const quoteText = lines.join('\n');

    try {
      await navigator.clipboard.writeText(quoteText);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = quoteText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    setCartLineQuoteCopied(true);
    setTimeout(() => setCartLineQuoteCopied(false), 2000);
    showToast('success', 'คัดลอกบิลส่ง LINE ลง Clipboard แล้ว');
  };

  const handleAddQuickServiceFee = (fee: (typeof QUICK_SERVICE_FEES)[number]) => {
    const serviceKey = `service_${fee.id}`;
    setCart((prev) => {
      const existing = prev.find((item) => item.key === serviceKey);
      if (existing) {
        return prev.map((item) =>
          item.key === serviceKey ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [
        ...prev,
        {
          key: serviceKey,
          product_id: null,
          product_name: fee.name,
          unit_name: 'บริการ',
          conversion_rate: 1,
          unit_price: fee.price,
          unit_cost: 0,
          qty: 1,
        },
      ];
    });
    playBeep('add');
  };

  const handleAcknowledgeHandoverMemo = () => {
    try {
      localStorage.removeItem(SHIFT_HANDOVER_MEMO_STORAGE_KEY);
    } catch {
      // ignore localStorage write errors
    }
    setHandoverMemo(null);
    setHandoverMemoHidden(false);
    showToast('success', 'รับทราบและเคลียร์ข้อความฝากส่งต่อกะแล้ว');
  };

  const updateCartItemNote = (key: string, nextNote: string) => {
    setCartItemNotes((prev) => {
      if (nextNote === '') {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: nextNote };
    });
  };

  const toggleCartItemQuickTag = (key: string, tag: string) => {
    setCartItemNotes((prev) => {
      const updated = toggleCartItemNoteTag(prev[key] ?? '', tag);
      if (!updated) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: updated };
    });
  };

  const updateCartQty = (key: string, delta: number) => {
    if (editingQtyKey === key) {
      setEditingQtyKey(null);
      setEditingQtyValue('');
    }
    if (editingPriceKey === key) {
      setEditingPriceKey(null);
      setEditingPriceValue('');
    }
    const targetItem = cart.find((item) => item.key === key);
    if (targetItem && targetItem.qty + delta <= 0) {
      if (manualPriceKeys.has(key)) {
        setManualPriceKeys((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
      setCartItemNotes((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      if (editingNoteKey === key) {
        setEditingNoteKey(null);
      }
    }
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.key !== key) return item;
          const nextQty = item.qty + delta;
          if (nextQty <= 0) return { ...item, qty: nextQty };
          const prod = item.product_id ? productById.get(item.product_id) : undefined;
          const resolvedPrice = resolveWholesaleItemPrice({
            productId: item.product_id,
            unitName: item.unit_name,
            conversionRate: item.conversion_rate,
            qty: nextQty,
            availableUnits: item.available_units,
            product: prod,
            wholesaleTiers,
            isManualPrice: manualPriceKeys.has(key),
          });
          return {
            ...item,
            qty: nextQty,
            unit_price: resolvedPrice ?? item.unit_price,
          };
        })
        .filter((item) => item.qty > 0)
    );
  };

  const setCartQtyDirect = (key: string, newQty: number) => {
    const rawNum = Number(newQty);
    const validQty = Number.isFinite(rawNum) ? Math.round(rawNum * 1000) / 1000 : NaN;
    if (Number.isNaN(validQty) || validQty <= 0) {
      if (manualPriceKeys.has(key)) {
        setManualPriceKeys((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
      setCartItemNotes((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      if (editingNoteKey === key) {
        setEditingNoteKey(null);
      }
      setCart((prev) => prev.filter((item) => item.key !== key));
      return;
    }
    setCart((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const prod = item.product_id ? productById.get(item.product_id) : undefined;
        const resolvedPrice = resolveWholesaleItemPrice({
          productId: item.product_id,
          unitName: item.unit_name,
          conversionRate: item.conversion_rate,
          qty: validQty,
          availableUnits: item.available_units,
          product: prod,
          wholesaleTiers,
          isManualPrice: manualPriceKeys.has(key),
        });
        return {
          ...item,
          qty: validQty,
          unit_price: resolvedPrice ?? item.unit_price,
        };
      })
    );
  };

  const openWeightBudgetModal = (item: CartItem) => {
    setWeightBudgetItemKey(item.key);
    setWeightBudgetMode('weight');
    setWeightQtyInput(String(item.qty));
    setBudgetBahtInput('');
  };

  const handleApplyWeightBudget = (e: React.FormEvent) => {
    e.preventDefault();
    if (!weightBudgetItem) return;

    if (weightBudgetMode === 'weight') {
      const parsedQty = Math.round(Number(weightQtyInput) * 1000) / 1000;
      if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
        showToast('error', 'กรุณาระบุน้ำหนักหรือปริมาณที่มากกว่า 0');
        return;
      }
      setCartQtyDirect(weightBudgetItem.key, parsedQty);
      setWeightBudgetItemKey(null);
      return;
    }

    const targetBaht = Number(budgetBahtInput);
    const unitPrice = weightBudgetItem.unit_price;
    if (!Number.isFinite(targetBaht) || targetBaht <= 0) {
      showToast('error', 'กรุณาระบุงบเงินที่ลูกค้าต้องการซื้อมากกว่า 0 บาท');
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      showToast('error', 'ไม่สามารถคำนวณตามงบได้ เนื่องจากราคาต่อหน่วยเป็น 0 บาท');
      return;
    }

    const calcQty = Number((targetBaht / unitPrice).toFixed(3));
    if (!Number.isFinite(calcQty) || calcQty <= 0) {
      showToast('error', 'งบเงินน้อยเกินไปสำหรับคำนวณปริมาณขั้นต่ำ');
      return;
    }

    setCartQtyDirect(weightBudgetItem.key, calcQty);
    const budgetNote = `ตักตามงบ ฿${formatNumber(targetBaht)} (~${formatNumber(calcQty)} ${weightBudgetItem.unit_name})`;
    setCartItemNotes((prev) => {
      const existing = (prev[weightBudgetItem.key] ?? '').trim();
      if (!existing) {
        return { ...prev, [weightBudgetItem.key]: budgetNote };
      }
      const parts = existing
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p && !p.startsWith('ตักตามงบ ฿'));
      return {
        ...prev,
        [weightBudgetItem.key]: [...parts, budgetNote].join(', '),
      };
    });
    setWeightBudgetItemKey(null);
  };

  const startEditCartPrice = (item: CartItem) => {
    setEditingPriceKey(item.key);
    setEditingPriceValue(String(item.unit_price));
  };

  const cancelEditCartPrice = () => {
    setEditingPriceKey(null);
    setEditingPriceValue('');
  };

  const commitEditCartPrice = (key: string) => {
    const trimmed = editingPriceValue.trim();
    const parsed = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(parsed) || parsed < 0) {
      showToast('error', 'กรุณาระบุราคาต่อหน่วยที่ถูกต้อง (0 ขึ้นไป)');
      return;
    }
    const targetItem = cart.find((item) => item.key === key);
    if (targetItem) {
      const prod = targetItem.product_id
        ? productById.get(targetItem.product_id)
        : undefined;
      const autoPrice = resolveWholesaleItemPrice({
        productId: targetItem.product_id,
        unitName: targetItem.unit_name,
        conversionRate: targetItem.conversion_rate,
        qty: targetItem.qty,
        availableUnits: targetItem.available_units,
        product: prod,
        wholesaleTiers,
        isManualPrice: false,
      });
      setManualPriceKeys((prev) => {
        const next = new Set(prev);
        if (autoPrice !== null && parsed === autoPrice) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    }
    setCart((prev) =>
      prev.map((item) => (item.key === key ? { ...item, unit_price: parsed } : item))
    );
    setEditingPriceKey(null);
    setEditingPriceValue('');
  };

  const changeCartUnit = (key: string, unitId: string) => {
    if (editingPriceKey === key) {
      setEditingPriceKey(null);
      setEditingPriceValue('');
    }
    if (manualPriceKeys.has(key)) {
      setManualPriceKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
    const targetItem = cart.find((item) => item.key === key);
    const targetUnit = targetItem?.available_units?.find((u) => u.id === unitId);
    if (!targetItem || !targetUnit) return;
    const nextKey = `${targetItem.product_id}_${targetUnit.unit_name}_${Date.now()}`;
    if (key in cartItemNotes) {
      setCartItemNotes((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev, [nextKey]: prev[key] };
        delete next[key];
        return next;
      });
    }
    if (editingNoteKey === key) {
      setEditingNoteKey(nextKey);
    }
    setCart((prev) =>
      prev.map((item) => {
        if (item.key !== key || !item.available_units) return item;
        const unit = item.available_units.find((u) => u.id === unitId);
        if (!unit) return item;
        const prod = item.product_id ? productById.get(item.product_id) : undefined;
        const conversionRate = Number(unit.conversion_rate);
        const resolvedPrice = resolveWholesaleItemPrice({
          productId: item.product_id,
          unitName: unit.unit_name,
          conversionRate,
          qty: item.qty,
          availableUnits: item.available_units,
          product: prod,
          wholesaleTiers,
          isManualPrice: false,
        });
        return {
          ...item,
          key: nextKey,
          unit_name: unit.unit_name,
          conversion_rate: conversionRate,
          unit_price: resolvedPrice ?? Number(unit.selling_price),
        };
      })
    );
  };

  // Generate PromptPay QR when paymentMethod === 'qr' or split Cash + QR is active
  useEffect(() => {
    if (!checkoutOpen || activeQrTargetAmount <= 0) {
      setQrDataUrl('');
      return;
    }
    const ppId = settings?.promptpay_id?.trim();
    if (!ppId) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    try {
      const payload = generatePayload(ppId, { amount: activeQrTargetAmount });
      QRCode.toDataURL(payload, { width: 260, margin: 2 })
        .then((url) => {
          if (!cancelled) {
            setQrDataUrl(url);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setQrDataUrl('');
          }
        });
    } catch {
      setQrDataUrl('');
    }
    return () => {
      cancelled = true;
    };
  }, [checkoutOpen, activeQrTargetAmount, settings]);

  // Generate PromptPay QR for Customer-Facing Display Modal whenever open and PromptPay is configured
  useEffect(() => {
    if (!customerDisplayQrKey) return;
    let cancelled = false;
    try {
      const payload = generatePayload(customerDisplayPromptPayId, {
        amount: customerDisplayQrAmount,
      });
      QRCode.toDataURL(payload, { width: 320, margin: 2 })
        .then((url) => {
          if (!cancelled) {
            setCustomerDisplayQrResult({ key: customerDisplayQrKey, url });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCustomerDisplayQrResult({ key: customerDisplayQrKey, url: '' });
          }
        });
    } catch {
      // ignore QR payload generation errors
    }
    return () => {
      cancelled = true;
    };
  }, [customerDisplayQrKey, customerDisplayPromptPayId, customerDisplayQrAmount]);

  // Quick Debt Collection derived values & QR generation (Phase 36)
  const debtorCustomers = useMemo(
    () =>
      customers
        .filter((c) => Number(c.total_debt) > 0)
        .sort((a, b) => Number(b.total_debt) - Number(a.total_debt)),
    [customers]
  );

  const quickDebtTargetCustomer = useMemo(
    () => debtorCustomers.find((c) => c.id === quickDebtCustomerId) ?? null,
    [debtorCustomers, quickDebtCustomerId]
  );

  const quickDebtParsedAmount = useMemo(() => {
    const val = Number(quickDebtAmount);
    return Number.isFinite(val) && val > 0 ? Math.round(val * 100) / 100 : 0;
  }, [quickDebtAmount]);

  const quickDebtFractionAmount = useMemo(
    () => computeDebtFractionAmount(Number(quickDebtTargetCustomer?.total_debt ?? 0)),
    [quickDebtTargetCustomer]
  );

  const quickDebtPromptPayId = settings?.promptpay_id?.trim() ?? '';
  const quickDebtQrKey =
    quickDebtModalOpen &&
    !quickDebtReceipt &&
    quickDebtMethod === 'qr' &&
    quickDebtParsedAmount > 0 &&
    quickDebtPromptPayId
      ? `${quickDebtParsedAmount}_${quickDebtPromptPayId}`
      : '';
  const quickDebtQrDataUrl =
    quickDebtQrKey && quickDebtQrResult.key === quickDebtQrKey
      ? quickDebtQrResult.url
      : '';

  useEffect(() => {
    if (!quickDebtQrKey) return;
    let cancelled = false;
    try {
      const payload = generatePayload(quickDebtPromptPayId, {
        amount: quickDebtParsedAmount,
      });
      QRCode.toDataURL(payload, { width: 240, margin: 2 })
        .then((url) => {
          if (!cancelled) {
            setQuickDebtQrResult({ key: quickDebtQrKey, url });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setQuickDebtQrResult({ key: quickDebtQrKey, url: '' });
          }
        });
    } catch {
      // ignore QR payload generation errors
    }
    return () => {
      cancelled = true;
    };
  }, [quickDebtQrKey, quickDebtPromptPayId, quickDebtParsedAmount]);

  const openQuickDebtModal = useCallback(
    (preferredCustomerId?: string) => {
      const preferred = preferredCustomerId
        ? debtorCustomers.find((c) => c.id === preferredCustomerId)
        : undefined;
      const fromSelected =
        !preferred && selectedCustomer && Number(selectedCustomer.total_debt) > 0
          ? selectedCustomer
          : undefined;
      const target = preferred ?? fromSelected ?? debtorCustomers[0] ?? null;

      setQuickDebtCustomerId(target?.id ?? '');
      setQuickDebtAmount(target ? String(Number(target.total_debt)) : '');
      setQuickDebtMethod('cash');
      setQuickDebtNote('');
      setQuickDebtReceipt(null);
      setCopiedQuickDebtReceipt(false);
      setQuickDebtModalOpen(true);
    },
    [debtorCustomers, selectedCustomer]
  );

  const handleQuickDebtCustomerChange = useCallback(
    (nextId: string) => {
      setQuickDebtCustomerId(nextId);
      const found = debtorCustomers.find((c) => c.id === nextId);
      setQuickDebtAmount(found ? String(Number(found.total_debt)) : '');
    },
    [debtorCustomers]
  );

  const handleQuickDebtSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickDebtTargetCustomer || quickDebtSubmitting) return;
    const currentDebt = Number(quickDebtTargetCustomer.total_debt);
    if (quickDebtParsedAmount <= 0 || quickDebtParsedAmount > currentDebt) {
      showToast('error', 'กรุณาระบุยอดรับชำระที่มากกว่า 0 และไม่เกินยอดค้างชำระ');
      return;
    }

    setQuickDebtSubmitting(true);
    const trimmedNote = quickDebtNote.trim();
    const { error } = await supabase.rpc('record_debt_payment', {
      p_customer_id: quickDebtTargetCustomer.id,
      p_shift_id: activeShift?.id ?? null,
      p_amount: quickDebtParsedAmount,
      p_payment_method: quickDebtMethod,
      p_note: trimmedNote || 'รับชำระหนี้ด่วนหน้าเครื่อง POS',
    });
    setQuickDebtSubmitting(false);

    if (error) {
      showToast('error', `บันทึกรับชำระหนี้ไม่สำเร็จ: ${error.message}`);
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
      Math.round((currentDebt - quickDebtParsedAmount) * 100) / 100
    );

    setQuickDebtReceipt({
      customerName: quickDebtTargetCustomer.name,
      amountPaid: quickDebtParsedAmount,
      paymentMethod: quickDebtMethod,
      remainingDebt,
      note: trimmedNote,
      paidAt,
    });
    setCopiedQuickDebtReceipt(false);
    setQuickDebtNote('');
    showToast(
      'success',
      `รับชำระหนี้ ${quickDebtTargetCustomer.name} ${formatBaht(quickDebtParsedAmount)} สำเร็จ`
    );
    await loadData();
  };

  const handleCopyQuickDebtReceipt = async () => {
    if (!quickDebtReceipt) return;
    const storeTitle = settings?.store_name || 'ร้านขายของชำ POS';
    const storePhone = settings?.phone?.trim();
    const methodLabel =
      quickDebtReceipt.paymentMethod === 'qr' ? 'โอนพร้อมเพย์ / QR' : 'เงินสด';
    const lines = [
      `✅ ใบเสร็จรับชำระหนี้ - ${storeTitle}`,
      `📅 วันที่: ${quickDebtReceipt.paidAt}`,
      `👤 ลูกค้า: คุณ${quickDebtReceipt.customerName}`,
      `------------------------`,
      `💵 ยอดที่รับชำระ: ${formatBaht(quickDebtReceipt.amountPaid)}`,
      `💳 ช่องทางชำระ: ${methodLabel}`,
      `📌 ยอดหนี้คงเหลือล่าสุด: ${formatBaht(quickDebtReceipt.remainingDebt)}`,
    ];
    if (quickDebtReceipt.note) {
      lines.push(`📝 หมายเหตุ: ${quickDebtReceipt.note}`);
    }
    if (storePhone) {
      lines.push(`📞 ติดต่อร้าน: ${storePhone}`);
    }
    lines.push(`ขอบคุณที่ชำระเงินครับ/ค่ะ 🙏`);
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
    setCopiedQuickDebtReceipt(true);
    showToast('success', 'คัดลอกข้อความใบรับชำระหนี้สำหรับส่ง LINE แล้ว');
    setTimeout(() => setCopiedQuickDebtReceipt(false), 2500);
  };

  const openCheckout = useCallback(() => {
    if (cart.length === 0) return;
    const existingDiscount = Math.min(cartTotal, Math.max(0, Number(billDiscount) || 0));
    setPaymentMethod('cash');
    setSplitCashQrEnabled(false);
    setPointsToRedeem(0);
    setVipDiscountApplied(false);
    setStoreCreditToUse(0);
    setDepositChangeToCredit(false);
    setCashReceived(String(Math.max(0, cartTotal - existingDiscount)));
    setPartialCash('0');
    setCreditDownPaymentInput('');
    setCreditDueDateInput('');
    setSettleOldDebtInput('');
    const isInvalidSelectedCustomer =
      selectedCustomerId === '__new__' ||
      (selectedCustomerId && !customers.some((c) => c.id === selectedCustomerId));
    if (isInvalidSelectedCustomer) {
      setSelectedCustomerId('');
      setCreditDueDateInput('');
    } else {
      setCreditDueDateInput(selectedCustomerId ? (dueDates[selectedCustomerId] ?? '') : '');
    }
    setCheckoutOpen(true);
    setMobileCartOpen(false);
  }, [billDiscount, cart.length, cartTotal, customers, selectedCustomerId]);

  const exactCashCheckoutRef = useRef<() => void>(() => {});

  const openPriceCheckerModal = useCallback(() => {
    setPriceCheckerOpen(true);
    setPriceCheckerQuery('');
    setPriceCheckerSelectedId(null);
    setPriceCheckerMatchedUnitId(null);
  }, []);

  useEffect(() => {
    if (!priceCheckerOpen) return;
    const timer = window.setTimeout(() => {
      priceCheckerInputRef.current?.focus();
      priceCheckerInputRef.current?.select();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [priceCheckerOpen]);

  const priceCheckerMatches = useMemo(() => {
    const q = priceCheckerQuery.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => {
        if (p.name.toLowerCase().includes(q)) return true;
        if (p.barcode && p.barcode.toLowerCase().includes(q)) return true;
        const pUnitBarcodes = unitBarcodes[p.id];
        if (
          pUnitBarcodes &&
          Object.values(pUnitBarcodes).some((bc) => bc.toLowerCase().includes(q))
        ) {
          return true;
        }
        const shelf = shelfLocations[p.id];
        if (shelf && shelf.toLowerCase().includes(q)) return true;
        const promo = promoLabels[p.id];
        if (promo && promo.toLowerCase().includes(q)) return true;
        return false;
      })
      .slice(0, 12);
  }, [products, priceCheckerQuery, unitBarcodes, shelfLocations, promoLabels]);

  const priceCheckerProduct = useMemo(() => {
    if (priceCheckerSelectedId) {
      return products.find((p) => p.id === priceCheckerSelectedId) ?? null;
    }
    if (priceCheckerQuery.trim() && priceCheckerMatches.length === 1) {
      return priceCheckerMatches[0];
    }
    return null;
  }, [priceCheckerSelectedId, products, priceCheckerQuery, priceCheckerMatches]);

  const handlePriceCheckerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const q = priceCheckerQuery.trim().toLowerCase();
    if (!q) return;

    const exactBarcodeProduct = products.find(
      (p) => p.barcode && p.barcode.trim().toLowerCase() === q
    );
    if (exactBarcodeProduct) {
      e.preventDefault();
      setPriceCheckerSelectedId(exactBarcodeProduct.id);
      setPriceCheckerMatchedUnitId(null);
      priceCheckerInputRef.current?.select();
      return;
    }

    for (const p of products) {
      const pUnitBarcodes = unitBarcodes[p.id];
      if (!pUnitBarcodes) continue;
      const foundUnit = (p.product_units ?? []).find((u) => {
        const bc = pUnitBarcodes[u.id] ?? pUnitBarcodes[u.unit_name];
        return bc && bc.trim().toLowerCase() === q;
      });
      if (foundUnit) {
        e.preventDefault();
        setPriceCheckerSelectedId(p.id);
        setPriceCheckerMatchedUnitId(foundUnit.id);
        priceCheckerInputRef.current?.select();
        return;
      }
    }

    if (priceCheckerMatches.length > 0) {
      e.preventDefault();
      setPriceCheckerSelectedId(priceCheckerMatches[0].id);
      setPriceCheckerMatchedUnitId(null);
      priceCheckerInputRef.current?.select();
    }
  };

  const handleAddFromPriceChecker = (product: Product, chosenUnit?: ProductUnit) => {
    addProductToCart(product, chosenUnit);
    if (!product.allow_custom_price) {
      showToast(
        'success',
        chosenUnit
          ? `เพิ่ม "${product.name}" (${chosenUnit.unit_name}) ลงตะกร้าแล้ว`
          : `เพิ่ม "${product.name}" ลงตะกร้าแล้ว`
      );
    }
    setPriceCheckerOpen(false);
  };

  // Keyboard shortcuts: F1 for shortcuts help, F2 to focus product search, F4 to hold bill / view held bills, F6 quick price checker, F8/F9/F10 in checkout modal (or F9 open checkout / F10 exact cash)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (screenLockedAt !== null) {
        return;
      }

      const hasOpenModal =
        checkoutOpen ||
        customerDisplayOpen ||
        containerDepositsOpen ||
        quickDebtModalOpen ||
        !!quickDebtReceipt ||
        holdModalOpen ||
        heldBillsOpen ||
        shiftModalOpen ||
        !!lastReceipt ||
        todaySalesOpen ||
        !!partialReturnSale ||
        shortcutsOpen ||
        calcOpen ||
        adHocOpen ||
        receiptSettingsOpen ||
        quickCustomerModalOpen ||
        saveBundleModalOpen ||
        priceCheckerOpen ||
        quickMiscOpen ||
        !!customPriceProduct ||
        !!weightBudgetItem;

      if (e.key === 'F1') {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
      } else if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (!hasOpenModal) {
          if (cart.length > 0) {
            handleOpenHoldModal();
          } else if (heldBills.length > 0) {
            setHeldBillsOpen(true);
          }
        }
      } else if (e.key === 'F6') {
        e.preventDefault();
        if (priceCheckerOpen) {
          setPriceCheckerOpen(false);
        } else if (!hasOpenModal) {
          openPriceCheckerModal();
        }
      } else if (e.key === 'F7') {
        e.preventDefault();
        if (quickMiscOpen) {
          setQuickMiscOpen(false);
        } else if (!hasOpenModal) {
          openQuickMiscModal();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (cart.length > 0 && !hasOpenModal && !submitting) {
          e.preventDefault();
          exactCashCheckoutRef.current();
        }
      } else if (e.key === 'F8') {
        if (checkoutOpen && !customerDisplayOpen) {
          e.preventDefault();
          selectPaymentMethod('cash');
        } else if (cart.length > 0 && !hasOpenModal) {
          e.preventDefault();
          setPaymentMethod('cash');
          openCheckout();
        }
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (checkoutOpen && !customerDisplayOpen) {
          selectPaymentMethod('qr');
        } else if (cart.length > 0 && !customerDisplayOpen) {
          openCheckout();
        }
      } else if (e.key === 'F10') {
        e.preventDefault();
        if (checkoutOpen && !customerDisplayOpen) {
          selectPaymentMethod('credit');
        } else if (cart.length > 0 && !hasOpenModal) {
          setPaymentMethod('credit');
          openCheckout();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    cart.length,
    heldBills.length,
    checkoutOpen,
    customerDisplayOpen,
    containerDepositsOpen,
    holdModalOpen,
    heldBillsOpen,
    shiftModalOpen,
    lastReceipt,
    todaySalesOpen,
    partialReturnSale,
    shortcutsOpen,
    calcOpen,
    adHocOpen,
    receiptSettingsOpen,
    quickCustomerModalOpen,
    saveBundleModalOpen,
    priceCheckerOpen,
    quickMiscOpen,
    customPriceProduct,
    weightBudgetItem,
    submitting,
    handleOpenHoldModal,
    openPriceCheckerModal,
    openQuickMiscModal,
    openCheckout,
    selectPaymentMethod,
    screenLockedAt,
  ]);

  const handleLockScreen = useCallback(() => {
    const now = new Date();
    setScreenLockedAt(formatTime(now.toISOString()));
  }, []);

  const handleUnlockScreen = useCallback(() => {
    setScreenLockedAt(null);
    focusSearchOnDesktop();
  }, [focusSearchOnDesktop]);

  // Fullscreen listener & toggle
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      showToast('error', 'เบราว์เซอร์ไม่รองรับหรือไม่อนุญาตโหมดเต็มจอ');
    }
  };

  // Quick Calculator helpers
  const computeCalc = (a: number, b: number, op: '+' | '-' | '×' | '÷'): number | null => {
    let result = 0;
    if (op === '+') result = a + b;
    else if (op === '-') result = a - b;
    else if (op === '×') result = a * b;
    else if (op === '÷') {
      if (b === 0) return null;
      result = a / b;
    }
    return Math.round(result * 1000000) / 1000000;
  };

  const handleCalcDigit = (digit: string) => {
    if (calcDisplay === 'Error') {
      setCalcDisplay(digit === '.' ? '0.' : digit === '00' ? '0' : digit);
      setCalcPrevValue(null);
      setCalcOperator(null);
      setCalcWaitingForOperand(false);
      setCalcExpression('');
      return;
    }
    if (calcWaitingForOperand) {
      if (digit === '.') {
        setCalcDisplay('0.');
      } else if (digit === '00') {
        setCalcDisplay('0');
      } else {
        setCalcDisplay(digit);
      }
      setCalcWaitingForOperand(false);
      return;
    }
    if (digit === '.') {
      if (!calcDisplay.includes('.')) {
        setCalcDisplay(`${calcDisplay}.`);
      }
      return;
    }
    if (digit === '00') {
      if (calcDisplay !== '0') {
        setCalcDisplay(`${calcDisplay}00`);
      }
      return;
    }
    setCalcDisplay(calcDisplay === '0' ? digit : `${calcDisplay}${digit}`);
  };

  const handleCalcOperator = (nextOp: '+' | '-' | '×' | '÷') => {
    const inputValue = Number(calcDisplay);
    if (!Number.isFinite(inputValue)) {
      setCalcDisplay('0');
      setCalcPrevValue(null);
      setCalcOperator(null);
      setCalcWaitingForOperand(false);
      setCalcExpression('');
      return;
    }
    if (calcOperator && !calcWaitingForOperand && calcPrevValue !== null) {
      const result = computeCalc(calcPrevValue, inputValue, calcOperator);
      if (result === null) {
        setCalcDisplay('Error');
        setCalcPrevValue(null);
        setCalcOperator(null);
        setCalcWaitingForOperand(true);
        setCalcExpression('');
        return;
      }
      setCalcPrevValue(result);
      setCalcDisplay(String(result));
      setCalcExpression(`${result} ${nextOp}`);
    } else {
      setCalcPrevValue(inputValue);
      setCalcExpression(`${inputValue} ${nextOp}`);
    }
    setCalcOperator(nextOp);
    setCalcWaitingForOperand(true);
  };

  const handleCalcEquals = () => {
    if (calcOperator === null || calcPrevValue === null) return;
    const inputValue = Number(calcDisplay);
    if (!Number.isFinite(inputValue)) return;
    const result = computeCalc(calcPrevValue, inputValue, calcOperator);
    if (result === null) {
      setCalcDisplay('Error');
      setCalcPrevValue(null);
      setCalcOperator(null);
      setCalcWaitingForOperand(true);
      setCalcExpression('');
      return;
    }
    setCalcExpression(`${calcPrevValue} ${calcOperator} ${inputValue} =`);
    setCalcDisplay(String(result));
    setCalcPrevValue(null);
    setCalcOperator(null);
    setCalcWaitingForOperand(true);
  };

  const handleCalcClear = () => {
    setCalcDisplay('0');
    setCalcPrevValue(null);
    setCalcOperator(null);
    setCalcWaitingForOperand(false);
    setCalcExpression('');
  };

  const handleCalcBackspace = () => {
    if (calcWaitingForOperand || calcDisplay === 'Error') {
      setCalcDisplay('0');
      setCalcWaitingForOperand(false);
      return;
    }
    if (calcDisplay.length <= 1 || (calcDisplay.length === 2 && calcDisplay.startsWith('-'))) {
      setCalcDisplay('0');
      return;
    }
    setCalcDisplay(calcDisplay.slice(0, -1));
  };

  const handleSendCalcToAdHoc = () => {
    let finalAmount = Number(calcDisplay);
    if (calcOperator && calcPrevValue !== null && !calcWaitingForOperand && Number.isFinite(finalAmount)) {
      const evaluated = computeCalc(calcPrevValue, finalAmount, calcOperator);
      if (evaluated === null) {
        showToast('error', 'ไม่สามารถคำนวณยอดได้');
        return;
      }
      finalAmount = evaluated;
    }
    if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
      showToast('error', 'ยอดเงินต้องมากกว่า 0 บาท');
      return;
    }
    const formatted = Number.isInteger(finalAmount)
      ? String(finalAmount)
      : String(Math.round(finalAmount * 100) / 100);
    setAdHocPrice(formatted);
    setCalcOpen(false);
    setAdHocOpen(true);
  };

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data, error } = await supabase
      .from('shifts')
      .insert({ opening_cash: Number(openingCash) || 0, status: 'open' })
      .select()
      .single();
    if (error) {
      showToast('error', 'เปิดกะไม่สำเร็จ: ' + error.message);
      return;
    }
    setActiveShift(data);
    setShiftModalOpen(false);
    showToast('success', 'เปิดกะขายเรียบร้อยแล้ว');
  };

  const openTodaySalesModal = () => {
    setConfirmVoidSaleId(null);
    setPartialReturnSale(null);
    setPartialReturnQtyInputs({});
    setPartialReturnError('');
    setTodaySalesNotice('');
    setTodaySalesSearch('');
    setTodaySalesFilter('all');
    setTodaySalesOpen(true);
    fetchTodaySales();
  };

  const todayTotalAmount = useMemo(
    () => todaySales.reduce((sum, s) => sum + Number(s.total_amount ?? 0), 0),
    [todaySales]
  );

  const filteredTodaySales = useMemo(() => {
    const q = todaySalesSearch.trim().toLowerCase();
    const qNoHash = q.startsWith('#') ? q.slice(1) : q;
    return todaySales.filter((sale) => {
      if (todaySalesFilter === 'cash' && sale.payment_method !== 'cash') return false;
      if (todaySalesFilter === 'qr' && sale.payment_method !== 'qr') return false;
      if (todaySalesFilter === 'credit' && sale.payment_method !== 'credit') return false;
      if (todaySalesFilter === 'returned_or_void') {
        const noteText = sale.note ?? '';
        if (!noteText.includes('รับคืน') && !noteText.includes('ยกเลิก')) {
          return false;
        }
      }
      if (!q) return true;
      const idMatch =
        sale.id.toLowerCase().includes(q) ||
        (qNoHash.length > 0 && sale.id.toLowerCase().includes(qNoHash));
      const customerMatch = (sale.customers?.name ?? '').toLowerCase().includes(q);
      const noteMatch = (sale.note ?? '').toLowerCase().includes(q);
      const itemMatch = (sale.sale_items ?? []).some((item) =>
        item.product_name.toLowerCase().includes(q)
      );
      return idMatch || customerMatch || noteMatch || itemMatch;
    });
  }, [todaySales, todaySalesSearch, todaySalesFilter]);

  const filteredTodayTotalAmount = useMemo(
    () => filteredTodaySales.reduce((sum, s) => sum + Number(s.total_amount ?? 0), 0),
    [filteredTodaySales]
  );

  const paymentMethodLabel = (method: PaymentMethod) => {
    if (method === 'cash') return 'เงินสด';
    if (method === 'qr') return 'PromptPay QR';
    return 'เงินเชื่อ';
  };

  const cloneItemsIntoCart = (
    sourceItems: ReadonlyArray<
      Pick<
        CartItem,
        | 'product_id'
        | 'product_name'
        | 'unit_name'
        | 'conversion_rate'
        | 'unit_price'
        | 'unit_cost'
        | 'qty'
      >
    >
  ) => {
    const nowTs = Date.now();
    setCart((prev) => {
      const next = [...prev];
      sourceItems.forEach((item, idx) => {
        const qtyToAdd = Math.max(1, Number(item.qty) || 1);
        const matchedProduct = item.product_id
          ? products.find((p) => p.id === item.product_id)
          : undefined;

        if (matchedProduct && !matchedProduct.allow_custom_price) {
          const units = matchedProduct.product_units ?? [];
          const matchedUnit = units.find((u) => u.unit_name === item.unit_name);
          const key = `${matchedProduct.id}_${item.unit_name}`;
          const existingIdx = next.findIndex((c) => c.key === key);
          const conversionRate = matchedUnit
            ? Number(matchedUnit.conversion_rate)
            : Number(item.conversion_rate || 1);
          const fallbackUnitPrice = matchedUnit
            ? Number(matchedUnit.selling_price)
            : Number(item.unit_price) > 0
            ? Number(item.unit_price)
            : Number(units[0]?.selling_price ?? 0);

          if (existingIdx >= 0) {
            const existingItem = next[existingIdx];
            const nextQty = existingItem.qty + qtyToAdd;
            const resolvedWholesale = resolveWholesaleItemPrice({
              productId: existingItem.product_id,
              unitName: existingItem.unit_name,
              conversionRate: existingItem.conversion_rate,
              qty: nextQty,
              availableUnits: existingItem.available_units,
              product: matchedProduct,
              wholesaleTiers,
              isManualPrice: manualPriceKeys.has(key),
            });
            next[existingIdx] = {
              ...existingItem,
              qty: nextQty,
              unit_price: resolvedWholesale ?? existingItem.unit_price,
            };
          } else {
            const resolvedWholesale = resolveWholesaleItemPrice({
              productId: matchedProduct.id,
              unitName: item.unit_name,
              conversionRate,
              qty: qtyToAdd,
              availableUnits: units,
              product: matchedProduct,
              wholesaleTiers,
              isManualPrice: false,
            });
            next.push({
              key,
              product_id: matchedProduct.id,
              product_name: matchedProduct.name,
              unit_name: item.unit_name,
              conversion_rate: conversionRate,
              unit_price: resolvedWholesale ?? fallbackUnitPrice,
              unit_cost: Number(matchedProduct.cost_price ?? item.unit_cost ?? 0),
              qty: qtyToAdd,
              available_units: units,
            });
          }
        } else {
          const key = matchedProduct
            ? `${matchedProduct.id}_custom_${nowTs}_${idx}`
            : `adhoc_clone_${nowTs}_${idx}`;
          next.push({
            key,
            product_id: matchedProduct ? matchedProduct.id : item.product_id ?? null,
            product_name: item.product_name,
            unit_name: item.unit_name,
            conversion_rate: Number(item.conversion_rate || 1),
            unit_price: Number(item.unit_price || 0),
            unit_cost: Number(item.unit_cost || 0),
            qty: qtyToAdd,
            available_units: matchedProduct?.product_units,
          });
        }
      });
      return next;
    });
  };

  const handleCloneSaleToCart = (sale: Sale) => {
    const items = sale.sale_items ?? [];
    if (items.length === 0) {
      showToast('error', 'ไม่พบรายการสินค้าในบิลนี้');
      return;
    }

    cloneItemsIntoCart(items);
    setTodaySalesOpen(false);
    playBeep('add');
    showToast('success', 'สั่งซ้ำรายการสินค้าลงตะกร้าเรียบร้อยแล้ว');
  };

  const handleRepeatReceiptItems = (receipt: CompletedReceipt | null) => {
    if (!receipt || receipt.items.length === 0) {
      showToast('error', 'ไม่พบรายการสินค้าในบิลล่าสุด');
      return;
    }

    cloneItemsIntoCart(receipt.items);
    setLastReceipt(null);
    playBeep('add');
    focusSearchOnDesktop();
    showToast('success', 'ดึงรายการจากบิลล่าสุดเข้าตะกร้าซ้ำเรียบร้อยแล้ว');
  };

  const handleVoidSale = async (sale: Sale) => {
    if (voidingSaleId) return;
    setVoidingSaleId(sale.id);
    try {
      const items = sale.sale_items ?? [];

      // (ก) คืนสต็อกสินค้าแต่ละรายการใน sale_items กลับเข้า products.stock_qty (+ qty * conversion_rate) และบันทึก stock_movements
      for (const item of items) {
        if (!item.product_id) continue;
        const restoreQty = Number(item.qty || 0) * Number(item.conversion_rate || 1);
        if (restoreQty <= 0) continue;

        const { data: prodData } = await supabase
          .from('products')
          .select('stock_qty')
          .eq('id', item.product_id)
          .maybeSingle();

        const currentStock = Number(
          prodData?.stock_qty ??
            products.find((p) => p.id === item.product_id)?.stock_qty ??
            0
        );
        const updatedStock = Number((currentStock + restoreQty).toFixed(4));

        await supabase
          .from('products')
          .update({
            stock_qty: updatedStock,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.product_id);

        await supabase.from('stock_movements').insert({
          product_id: item.product_id,
          type: 'adjust',
          qty_change: restoreQty,
          note: 'ยกเลิกบิลขาย',
        });
      }

      // (ข) หากเป็นบิล credit ที่มี customer_id ให้ลดยอด customers.total_debt คืนตามยอดค้างสุทธิของบิล
      if (sale.payment_method === 'credit' && sale.customer_id) {
        const voidCreditInfo = parseCreditDownPaymentFromNote(sale.note);
        const debtToReverse = voidCreditInfo
          ? voidCreditInfo.netCreditRemaining
          : Number(sale.total_amount || 0);
        const { data: custData } = await supabase
          .from('customers')
          .select('total_debt')
          .eq('id', sale.customer_id)
          .maybeSingle();

        const currentDebt = Number(
          custData?.total_debt ??
            customers.find((c) => c.id === sale.customer_id)?.total_debt ??
            0
        );
        const updatedDebt = Math.max(
          0,
          Number((currentDebt - debtToReverse).toFixed(2))
        );

        await supabase
          .from('customers')
          .update({ total_debt: updatedDebt })
          .eq('id', sale.customer_id);
      }

      // (ค) ลบบิลนั้นออกจากตาราง sales แล้วโหลดข้อมูลใหม่
      await supabase.from('sale_items').delete().eq('sale_id', sale.id);
      const { error: deleteErr } = await supabase
        .from('sales')
        .delete()
        .eq('id', sale.id);

      if (deleteErr) {
        showToast('error', 'ยกเลิกบิลไม่สำเร็จ: ' + deleteErr.message);
        setVoidingSaleId(null);
        return;
      }

      setConfirmVoidSaleId(null);
      showToast('success', 'ยกเลิกบิลและคืนสต็อกสินค้าเรียบร้อยแล้ว');
      await Promise.all([loadData(), fetchTodaySales()]);
    } catch {
      showToast('error', 'เกิดข้อผิดพลาดในการยกเลิกบิล');
    } finally {
      setVoidingSaleId(null);
    }
  };

  const openPartialReturnModal = (sale: Sale) => {
    setConfirmVoidSaleId(null);
    setTodaySalesNotice('');
    setPartialReturnSale(sale);
    setPartialReturnQtyInputs({});
    setPartialReturnReason('ลูกค้าเปลี่ยนใจ');
    setPartialReturnError('');
  };

  const closePartialReturnModal = () => {
    if (partialReturnSubmitting) return;
    setPartialReturnSale(null);
    setPartialReturnQtyInputs({});
    setPartialReturnError('');
  };

  const parseClampedReturnQty = (
    rawValue: string | undefined,
    maxQty: number
  ): number => {
    const safeMax = Math.max(0, Number(maxQty) || 0);
    if (!rawValue || rawValue.trim() === '') return 0;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(safeMax, Math.round(parsed * 1000) / 1000);
  };

  const stepPartialReturnItemQty = (
    itemId: string,
    maxQty: number,
    nextQty: number
  ) => {
    const safeMax = Math.max(0, Number(maxQty) || 0);
    const clamped = Number.isFinite(nextQty)
      ? Math.min(safeMax, Math.max(0, Math.round(nextQty * 1000) / 1000))
      : 0;
    setPartialReturnError('');
    setPartialReturnQtyInputs((prev) => ({
      ...prev,
      [itemId]: clamped > 0 ? String(clamped) : '',
    }));
  };

  const partialReturnSummary = useMemo(() => {
    if (!partialReturnSale) {
      return {
        selectedItems: [] as Array<{
          item: NonNullable<Sale['sale_items']>[number];
          returnQty: number;
          returnBaseQty: number;
          refundAmount: number;
        }>,
        totalReturnUnits: 0,
        totalReturnBaseUnits: 0,
        refundTotal: 0,
      };
    }

    const selectedItems: Array<{
      item: NonNullable<Sale['sale_items']>[number];
      returnQty: number;
      returnBaseQty: number;
      refundAmount: number;
    }> = [];
    let totalReturnUnits = 0;
    let totalReturnBaseUnits = 0;
    let refundTotal = 0;

    for (const item of partialReturnSale.sale_items ?? []) {
      const maxQty = Math.max(0, Number(item.qty) || 0);
      const returnQty = parseClampedReturnQty(partialReturnQtyInputs[item.id], maxQty);
      if (returnQty <= 0) continue;

      const conversionRate = Number(item.conversion_rate || 1);
      const returnBaseQty = Number((returnQty * conversionRate).toFixed(4));
      const refundAmount = Number(
        (returnQty * Number(item.unit_price || 0)).toFixed(2)
      );

      selectedItems.push({
        item,
        returnQty,
        returnBaseQty,
        refundAmount,
      });
      totalReturnUnits = Number((totalReturnUnits + returnQty).toFixed(4));
      totalReturnBaseUnits = Number(
        (totalReturnBaseUnits + returnBaseQty).toFixed(4)
      );
      refundTotal = Number((refundTotal + refundAmount).toFixed(2));
    }

    return {
      selectedItems,
      totalReturnUnits,
      totalReturnBaseUnits,
      refundTotal,
    };
  }, [partialReturnSale, partialReturnQtyInputs]);

  const executePartialReturn = async (mode: 'refund' | 'exchange_credit') => {
    if (!partialReturnSale || partialReturnSubmitting) return;
    if (partialReturnSummary.selectedItems.length === 0) {
      setPartialReturnError('กรุณาเลือกสินค้าและจำนวนที่ต้องการรับคืนอย่างน้อย 1 รายการ');
      return;
    }

    setPartialReturnSubmitting(true);
    setPartialReturnError('');

    try {
      const saleRef = partialReturnSale.id.slice(0, 8);
      const refundTotal = partialReturnSummary.refundTotal;
      const nowIso = new Date().toISOString();

      // 1) คืนสต็อกสินค้าที่รับคืนกลับเข้าตาราง products และบันทึก stock_movements (type: 'restock')
      for (const entry of partialReturnSummary.selectedItems) {
        const { item, returnQty, returnBaseQty } = entry;
        if (!item.product_id || returnBaseQty <= 0) continue;

        const { data: prodData, error: prodErr } = await supabase
          .from('products')
          .select('stock_qty')
          .eq('id', item.product_id)
          .maybeSingle();

        if (prodErr) {
          throw new Error(
            `ดึงข้อมูลสต็อก "${item.product_name}" ไม่สำเร็จ: ${prodErr.message}`
          );
        }

        const currentStock = Number(
          prodData?.stock_qty ??
            products.find((p) => p.id === item.product_id)?.stock_qty ??
            0
        );
        const updatedStock = Number((currentStock + returnBaseQty).toFixed(4));

        const { error: updateStockErr } = await supabase
          .from('products')
          .update({
            stock_qty: updatedStock,
            updated_at: nowIso,
          })
          .eq('id', item.product_id);

        if (updateStockErr) {
          throw new Error(
            `คืนสต็อก "${item.product_name}" ไม่สำเร็จ: ${updateStockErr.message}`
          );
        }

        const { error: moveErr } = await supabase.from('stock_movements').insert({
          product_id: item.product_id,
          type: 'restock',
          qty_change: returnBaseQty,
          note:
            mode === 'exchange_credit'
              ? `รับคืนเพื่อเปลี่ยนสินค้าจากบิล #${saleRef} (${formatNumber(returnQty)} ${item.unit_name} · ${partialReturnReason})`
              : `รับคืนสินค้าจากบิล #${saleRef} (${formatNumber(returnQty)} ${item.unit_name} · ${partialReturnReason})`,
        });

        if (moveErr) {
          throw new Error(
            `บันทึกประวัติสต็อก "${item.product_name}" ไม่สำเร็จ: ${moveErr.message}`
          );
        }
      }

      // 2) อัปเดตหมายเหตุบิล (sales.note) ต่อท้ายรายการรับคืนและยอดคืนเงิน/เครดิตเปลี่ยนสินค้า
      const returnedItemsText = partialReturnSummary.selectedItems
        .map(
          ({ item, returnQty }) =>
            `${item.product_name} ×${formatNumber(returnQty)} ${item.unit_name}`
        )
        .join(', ');
      const returnNoteLine =
        mode === 'exchange_credit'
          ? `รับคืนสินค้า: ${returnedItemsText} [เหตุผล: ${partialReturnReason}] (รับคืนเพื่อเปลี่ยนสินค้า · เครดิต ฿${formatNumber(
              refundTotal
            )})`
          : `รับคืนสินค้า: ${returnedItemsText} [เหตุผล: ${partialReturnReason}] (คืนเงิน ฿${formatNumber(
              refundTotal
            )})`;
      const existingSaleNote = (partialReturnSale.note ?? '').trim();
      const updatedSaleNote = existingSaleNote
        ? `${existingSaleNote} | ${returnNoteLine}`
        : returnNoteLine;

      const { error: updateSaleErr } = await supabase
        .from('sales')
        .update({ note: updatedSaleNote })
        .eq('id', partialReturnSale.id);

      if (updateSaleErr) {
        throw new Error(`อัปเดตหมายเหตุบิลไม่สำเร็จ: ${updateSaleErr.message}`);
      }

      if (mode === 'exchange_credit') {
        const creditNoteText = `เครดิตเปลี่ยนสินค้าจากบิล #${saleRef} (-฿${formatNumber(
          refundTotal
        )})`;
        setBillDiscount((prev) => {
          const prevNum = Number(prev) || 0;
          const next = Number((prevNum + refundTotal).toFixed(2));
          return next > 0 ? String(next) : '';
        });
        setOrderNote((prev) => {
          const trimmed = prev.trim();
          return trimmed ? `${trimmed} | ${creditNoteText}` : creditNoteText;
        });

        const successMessage = `รับคืนเพื่อเปลี่ยนสินค้าจากบิล #${saleRef} เรียบร้อย · นำยอด ${formatBaht(
          refundTotal
        )} ไปหักลดในตะกร้าแล้ว`;
        setPartialReturnSale(null);
        setPartialReturnQtyInputs({});
        setPartialReturnError('');
        setTodaySalesOpen(false);
        playBeep('success');
        showToast('success', successMessage);
        await Promise.all([loadData(), fetchTodaySales()]);
        return;
      }

      // 3) หากเป็นบิลขายเชื่อที่มี customer_id ให้เรียก record_debt_payment เพื่อลดยอดค้างชำระตามมูลค่าที่คืนทันที
      let creditNoticeSuffix = '';
      if (
        partialReturnSale.payment_method === 'credit' &&
        partialReturnSale.customer_id &&
        refundTotal > 0
      ) {
        const { data: custData, error: custErr } = await supabase
          .from('customers')
          .select('total_debt')
          .eq('id', partialReturnSale.customer_id)
          .maybeSingle();

        if (custErr) {
          throw new Error(`ดึงยอดค้างชำระลูกค้าไม่สำเร็จ: ${custErr.message}`);
        }

        const currentDebt = Number(
          custData?.total_debt ??
            customers.find((c) => c.id === partialReturnSale.customer_id)
              ?.total_debt ??
            0
        );
        const debtReductionAmount =
          currentDebt > 0
            ? Math.min(refundTotal, Number(currentDebt.toFixed(2)))
            : 0;

        if (debtReductionAmount > 0) {
          const { error: dpErr } = await supabase.rpc('record_debt_payment', {
            p_customer_id: partialReturnSale.customer_id,
            p_shift_id: null,
            p_amount: debtReductionAmount,
            p_payment_method: 'cash',
            p_note: `ลดยอดค้างชำระจากรับคืนสินค้าบิล #${saleRef} (${returnedItemsText} · ${partialReturnReason})`,
          });

          if (dpErr) {
            throw new Error(`ลดยอดค้างชำระลูกค้าไม่สำเร็จ: ${dpErr.message}`);
          }

          if (debtReductionAmount < refundTotal) {
            const diffRefund = Number((refundTotal - debtReductionAmount).toFixed(2));
            creditNoticeSuffix = ` · ลดยอดค้างชำระลูกค้า ${formatBaht(
              debtReductionAmount
            )} (คืนเงินส่วนต่าง ${formatBaht(diffRefund)})`;
          } else {
            creditNoticeSuffix = ` · ลดยอดค้างชำระลูกค้า ${formatBaht(
              debtReductionAmount
            )}`;
          }
        } else {
          creditNoticeSuffix = ' · ลูกค้าไม่มียอดค้างชำระคงเหลือแล้ว';
        }
      }

      const successMessage = `รับคืนสินค้าจากบิล #${saleRef} เรียบร้อย (คืนเงิน ${formatBaht(
        refundTotal
      )})${creditNoticeSuffix}`;
      setPartialReturnSale(null);
      setPartialReturnQtyInputs({});
      setPartialReturnError('');
      setTodaySalesNotice(successMessage);
      playBeep('success');
      showToast('success', successMessage);
      await Promise.all([loadData(), fetchTodaySales()]);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดในการบันทึกการรับคืนสินค้า';
      setPartialReturnError(msg);
    } finally {
      setPartialReturnSubmitting(false);
    }
  };

  const handleConfirmPartialReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    await executePartialReturn('refund');
  };

  const handleExchangeCreditPartialReturn = async () => {
    await executePartialReturn('exchange_credit');
  };

  const handleCopyReceipt = async () => {
    if (!lastReceipt) return;
    const storeTitle = settings?.store_name || 'ร้านขายของชำ POS';
    const lines: string[] = [
      `🧾 ใบเสร็จรับเงิน - ${storeTitle}`,
      ...(settings?.phone ? [`โทร: ${settings.phone}`] : []),
      `วันที่: ${formatDateTime(lastReceipt.createdAt)}`,
      '----------------------------',
      ...lastReceipt.items.map((item) => {
        const baseLine = `• ${item.product_name} (${formatNumber(item.qty)} ${
          item.unit_name
        } × ${formatBaht(item.unit_price)}) = ${formatBaht(
          item.unit_price * item.qty
        )}`;
        return item.itemNote ? `${baseLine}\n  ↳ โน้ต: ${item.itemNote}` : baseLine;
      }),
      '----------------------------',
    ];

    if (lastReceipt.discount > 0) {
      lines.push(`ยอดรวมก่อนลด: ${formatBaht(lastReceipt.subtotal)}`);
      lines.push(
        lastReceipt.vipDiscountPct && lastReceipt.vipDiscountPct > 0
          ? `ส่วนลดท้ายบิล (👑 VIP ลด ${formatNumber(lastReceipt.vipDiscountPct)}%): -${formatBaht(lastReceipt.discount)}`
          : `ส่วนลดท้ายบิล: -${formatBaht(lastReceipt.discount)}`
      );
    }
    lines.push(`ยอดรวมสุทธิ: ${formatBaht(lastReceipt.total)}`);
    if ((lastReceipt.oldDebtSettled ?? 0) > 0) {
      lines.push(
        formatCombinedDebtSettlementSummary(
          lastReceipt.total,
          lastReceipt.oldDebtSettled ?? 0,
          lastReceipt.oldDebtRemaining ?? 0
        )
      );
    }
    const splitInfo = getReceiptSplitInfo(lastReceipt);
    const creditDownInfo = getReceiptCreditDownPaymentInfo(lastReceipt);
    lines.push(
      `วิธีชำระเงิน: ${
        splitInfo.hasSplit
          ? 'แยกจ่าย (เงินสด + PromptPay QR)'
          : creditDownInfo.hasCreditDownPayment
          ? 'เงินเชื่อ (จ่ายสดบางส่วน)'
          : paymentMethodLabel(lastReceipt.paymentMethod)
      }${lastReceipt.customerName ? ` (${lastReceipt.customerName})` : ''}`
    );
    if (lastReceiptContactNote) {
      lines.push(`ที่อยู่ / ติดต่อลูกค้า: 🏠 ${lastReceiptContactNote}`);
    }
    if (splitInfo.hasSplit) {
      lines.push(
        `แยกจ่าย: เงินสด ฿${formatNumber(splitInfo.cashPart)} + โอน QR ฿${formatNumber(
          splitInfo.qrPart
        )}`
      );
      if (lastReceipt.paymentMethod === 'cash') {
        lines.push(`เงินทอน: ${formatBaht(lastReceipt.changeAmount)}`);
      }
    } else if (creditDownInfo.hasCreditDownPayment) {
      lines.push(
        `จ่ายสดบางส่วนวันนี้ ฿${formatNumber(
          creditDownInfo.downPayment
        )} (ค้างเชื่อสุทธิ ฿${formatNumber(creditDownInfo.netCreditRemaining)})`
      );
    } else if (lastReceipt.paymentMethod === 'cash') {
      lines.push(`รับเงินมา: ${formatBaht(lastReceipt.cashReceived)}`);
      lines.push(`เงินทอน: ${formatBaht(lastReceipt.changeAmount)}`);
    }
    if (lastReceipt.paymentMethod === 'credit' && lastReceipt.creditDueDate) {
      lines.push(`📅 วันนัดชำระหนี้: ${formatExpiryDateTh(lastReceipt.creditDueDate)}`);
    }
    if (lastReceipt.pointsBalance !== undefined) {
      const redeemedLine =
        (lastReceipt.pointsRedeemed ?? 0) > 0
          ? ` (ใช้แลก -${formatNumber(lastReceipt.pointsRedeemed ?? 0)} แต้ม)`
          : '';
      lines.push(
        `🏆 แต้มที่ได้รับ: +${formatNumber(lastReceipt.pointsEarned ?? 0)} แต้ม${redeemedLine} | คงเหลือ ${formatNumber(
          lastReceipt.pointsBalance
        )} แต้ม`
      );
    }
    if (lastReceipt.storeCreditBalance !== undefined) {
      const creditParts: string[] = [];
      if ((lastReceipt.storeCreditUsed ?? 0) > 0) {
        creditParts.push(`ใช้ไป -${formatBaht(lastReceipt.storeCreditUsed ?? 0)}`);
      }
      if ((lastReceipt.storeCreditDeposited ?? 0) > 0) {
        creditParts.push(`ฝากเพิ่ม +${formatBaht(lastReceipt.storeCreditDeposited ?? 0)}`);
      }
      const detailText = creditParts.length > 0 ? ` (${creditParts.join(', ')})` : '';
      lines.push(
        `💰 เงินฝากทอน${detailText} | คงเหลือ ${formatBaht(lastReceipt.storeCreditBalance)}`
      );
    }
    if (lastReceipt.note) {
      lines.push(`หมายเหตุ: ${lastReceipt.note}`);
    }
    if (settings?.address) {
      lines.push('----------------------------');
      lines.push(settings.address);
    }
    if (effectiveReceiptFooter) {
      if (!settings?.address) {
        lines.push('----------------------------');
      }
      lines.push(effectiveReceiptFooter);
    }

    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setReceiptCopied(true);
      setTimeout(() => setReceiptCopied(false), 2000);
      showToast('success', 'คัดลอกข้อความใบเสร็จลง Clipboard เรียบร้อยแล้ว');
    } catch {
      showToast('error', 'ไม่สามารถคัดลอกข้อความใบเสร็จได้');
    }
  };

  const handlePrintReceipt = () => {
    setPrintMode('receipt');
    setTimeout(() => {
      window.print();
    }, 80);
  };

  const handlePrintPackingSlip = () => {
    setPrintMode('packing_slip');
    setTimeout(() => {
      window.print();
    }, 80);
  };

  const handleReprintSale = (sale: Sale) => {
    const items = sale.sale_items ?? [];
    const mappedItems: CartItem[] = items.map((si) => ({
      key: si.id,
      product_id: si.product_id,
      product_name: si.product_name,
      unit_name: si.unit_name,
      conversion_rate: Number(si.conversion_rate ?? 1),
      unit_price: Number(si.unit_price),
      unit_cost: Number(si.unit_cost ?? 0),
      qty: Number(si.qty),
    }));
    const itemsSubtotal = mappedItems.reduce(
      (sum, item) => sum + item.unit_price * item.qty,
      0
    );
    const total = Number(sale.total_amount);
    const discount = items.length > 0 ? Math.max(0, itemsSubtotal - total) : 0;
    const vipMatch = /ส่วนลด VIP (\d+(?:\.\d+)?)%/.exec(sale.note ?? '');
    const vipDiscountPct =
      discount > 0 && vipMatch ? normalizeDiscountPct(vipMatch[1]) : 0;
    const splitInfo = parseSplitAmountsFromNote(sale.note);
    const creditDownInfo =
      sale.payment_method === 'credit'
        ? parseCreditDownPaymentFromNote(sale.note)
        : null;

    setTodaySalesOpen(false);
    setPrintMode('receipt');
    setLastReceipt({
      items: mappedItems,
      subtotal: items.length > 0 ? itemsSubtotal : total,
      discount,
      total,
      paymentMethod: sale.payment_method,
      cashReceived: Number(sale.cash_received ?? 0),
      changeAmount: Number(sale.change_amount ?? 0),
      partialCash: splitInfo?.partialCash,
      qrAmount: splitInfo?.qrAmount,
      creditDownPayment: creditDownInfo?.downPayment,
      creditRemainingDebt: creditDownInfo?.netCreditRemaining,
      customerId: sale.customer_id ?? null,
      customerName: sale.customers?.name ?? null,
      customerContactNote:
        (sale.customer_id ? contactNotes[sale.customer_id] : '') || undefined,
      note: sale.note?.trim() || undefined,
      createdAt: sale.created_at,
      vipDiscountPct: vipDiscountPct > 0 ? vipDiscountPct : undefined,
    });

    setTimeout(() => {
      window.print();
    }, 100);
  };

  const openQuickCustomerModal = () => {
    setQuickCustName('');
    setQuickCustPhone('');
    setQuickCustContactNote('');
    setQuickCustNote('');
    setQuickCustomerModalOpen(true);
  };

  const handleSaveQuickCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = quickCustName.trim();
    if (!trimmedName) {
      showToast('error', 'กรุณากรอกชื่อลูกค้า');
      return;
    }

    setSavingQuickCustomer(true);
    try {
      const { data: newCust, error: custErr } = await supabase
        .from('customers')
        .insert({
          name: trimmedName,
          phone: quickCustPhone.trim(),
          note: quickCustNote.trim(),
        })
        .select()
        .single();

      if (custErr || !newCust) {
        showToast(
          'error',
          'เพิ่มลูกค้าไม่สำเร็จ' + (custErr?.message ? `: ${custErr.message}` : '')
        );
        return;
      }

      const createdCustomer = newCust as Customer;
      saveCustomerContactNote(createdCustomer.id, quickCustContactNote);
      setCustomers((prev) =>
        [...prev, createdCustomer].sort((a, b) =>
          a.name.localeCompare(b.name, 'th')
        )
      );
      setSelectedCustomerId(createdCustomer.id);
      if (pointsToRedeem > 0 || vipDiscountApplied) {
        setPointsToRedeem(0);
        setVipDiscountApplied(false);
        setBillDiscount('');
        setCashReceived(String(cartTotal));
        setSplitCashQrEnabled(false);
      }
      setQuickCustomerModalOpen(false);
      setQuickCustName('');
      setQuickCustPhone('');
      setQuickCustContactNote('');
      setQuickCustNote('');
      showToast('success', `เพิ่มลูกค้า "${createdCustomer.name}" เรียบร้อยแล้ว`);
    } catch {
      showToast('error', 'เกิดข้อผิดพลาดในการเพิ่มลูกค้า');
    } finally {
      setSavingQuickCustomer(false);
    }
  };

  const handleCompleteSale = async () => {
    if (cart.length === 0) return;

    if (selectedCustomerId === '__new__' && !newCustName.trim()) {
      showToast(
        'error',
        paymentMethod === 'credit'
          ? 'กรุณากรอกชื่อลูกค้าเงินเชื่อ'
          : 'กรุณากรอกชื่อลูกค้า'
      );
      return;
    }

    if (paymentMethod === 'credit' && !selectedCustomerId) {
      showToast('error', 'กรุณาเลือกลูกค้าเงินเชื่อ');
      return;
    }

    if (paymentMethod === 'credit' && isCreditDownPaymentInvalid) {
      showToast(
        'error',
        'ยอดจ่ายสดบางส่วนต้องน้อยกว่ายอดรวมสุทธิ (หากจ่ายครบ กรุณาเลือกวิธีชำระเงินสด)'
      );
      return;
    }

    const effectiveOldDebtSettled =
      (paymentMethod === 'cash' || paymentMethod === 'qr') &&
      selectedCustomer &&
      settleOldDebtAmount > 0
        ? settleOldDebtAmount
        : 0;
    const effectiveOldDebtPreviousTotal =
      effectiveOldDebtSettled > 0 ? selectedCustomerOldDebt : 0;
    const effectiveTotalToCollect = Number(
      (finalTotal + effectiveOldDebtSettled).toFixed(2)
    );

    const received =
      paymentMethod === 'cash'
        ? isSplitCashQr
          ? Number(cashReceivedNum.toFixed(2))
          : Number(cashReceived) || 0
        : effectiveTotalToCollect;
    if (
      paymentMethod === 'cash' &&
      !isSplitCashQr &&
      received < effectiveTotalToCollect
    ) {
      showToast('error', 'จำนวนเงินที่รับมาน้อยกว่ายอดสุทธิที่ต้องชำระ');
      return;
    }

    let customerId: string | null = null;
    let customerName: string | null = null;
    let customerContactNote: string | undefined;
    if (selectedCustomerId === '__new__') {
      const { data: newCust, error: custErr } = await supabase
        .from('customers')
        .insert({ name: newCustName.trim(), phone: newCustPhone.trim() })
        .select()
        .single();
      if (custErr || !newCust) {
        showToast('error', 'เพิ่มลูกค้าไม่สำเร็จ');
        return;
      }
      customerId = newCust.id;
      customerName = newCust.name;
      const savedNote = saveCustomerContactNote(newCust.id, newCustContactNote);
      if (savedNote) {
        customerContactNote = savedNote;
      }
    } else if (selectedCustomerId) {
      customerId = selectedCustomerId;
      customerName =
        customers.find((c) => c.id === selectedCustomerId)?.name ?? null;
      customerContactNote = contactNotes[selectedCustomerId] || undefined;
    }

    const change =
      paymentMethod === 'cash' && !isSplitCashQr
        ? Math.max(0, Number((received - effectiveTotalToCollect).toFixed(2)))
        : 0;
    const effectiveRedeemedPoints =
      customerId && discountAmount > 0 && pointsToRedeem > 0
        ? Math.min(loyaltyPoints[customerId] ?? 0, pointsToRedeem)
        : 0;
    const effectiveVipPct =
      customerId &&
      appliedVipPct > 0 &&
      discountAmount > 0 &&
      effectiveRedeemedPoints === 0
        ? appliedVipPct
        : 0;
    const effectiveUsedStoreCredit =
      customerId &&
      discountAmount > 0 &&
      storeCreditToUse > 0 &&
      effectiveRedeemedPoints === 0 &&
      effectiveVipPct === 0
        ? Math.min(storeCredits[customerId] ?? 0, discountAmount, storeCreditToUse)
        : 0;
    const effectiveDepositChangeToCredit =
      Boolean(customerId) &&
      paymentMethod === 'cash' &&
      !isSplitCashQr &&
      change > 0 &&
      depositChangeToCredit;

    setSubmitting(true);

    // Build itemsPayload and distribute discount if discountAmount > 0 so DB total_amount matches finalTotal
    let remainingDisc = discountAmount;
    const itemsPayload: Array<{
      product_id: string;
      product_name: string;
      unit_name: string;
      qty: number;
      conversion_rate: number;
      unit_price: number;
      unit_cost: number;
    }> = [];

    for (const item of cart) {
      const baseItem = {
        product_id: item.product_id ?? '',
        product_name: item.product_name,
        unit_name: item.unit_name,
        qty: item.qty,
        conversion_rate: item.conversion_rate,
        unit_price: item.unit_price,
        unit_cost: item.unit_cost,
      };

      if (remainingDisc <= 0) {
        itemsPayload.push(baseItem);
        continue;
      }

      const lineTotal = item.unit_price * item.qty;
      const deduct = Math.min(remainingDisc, lineTotal);
      remainingDisc = Number((remainingDisc - deduct).toFixed(2));

      if (deduct <= 0) {
        itemsPayload.push(baseItem);
      } else if (
        item.qty === 1 ||
        Number(((lineTotal - deduct) / item.qty).toFixed(2)) * item.qty ===
          Number((lineTotal - deduct).toFixed(2))
      ) {
        itemsPayload.push({
          ...baseItem,
          unit_price: Math.max(0, Number(((lineTotal - deduct) / item.qty).toFixed(2))),
        });
      } else {
        // Split units so unit_price stays exact without rounding drift
        const zeroedUnits = Math.min(item.qty - 1, Math.floor(deduct / item.unit_price));
        const remDeduct = Number((deduct - zeroedUnits * item.unit_price).toFixed(2));
        const normalUnits = item.qty - zeroedUnits - 1;
        if (normalUnits > 0) {
          itemsPayload.push({
            ...baseItem,
            qty: normalUnits,
          });
        }
        itemsPayload.push({
          ...baseItem,
          qty: 1,
          unit_price: Math.max(0, Number((item.unit_price - remDeduct).toFixed(2))),
        });
        if (zeroedUnits > 0) {
          itemsPayload.push({
            ...baseItem,
            qty: zeroedUnits,
            unit_price: 0,
          });
        }
      }
    }

    const noteParts: string[] = [];
    if (discountAmount > 0) {
      if (effectiveRedeemedPoints > 0) {
        noteParts.push(
          `ส่วนลดท้ายบิล ${formatBaht(discountAmount)} (ใช้แต้ม ${formatNumber(effectiveRedeemedPoints)} แต้ม, ยอดก่อนลด ${formatBaht(cartTotal)})`
        );
      } else if (effectiveVipPct > 0) {
        noteParts.push(
          `ส่วนลด VIP ${formatNumber(effectiveVipPct)}% ${formatBaht(discountAmount)} (ยอดก่อนลด ${formatBaht(cartTotal)})`
        );
      } else if (effectiveUsedStoreCredit > 0) {
        noteParts.push(
          `ใช้เงินฝากทอนหักลดบิล ${formatBaht(effectiveUsedStoreCredit)} (ยอดก่อนลด ${formatBaht(cartTotal)})`
        );
      } else {
        noteParts.push(
          `ส่วนลดท้ายบิล ${formatBaht(discountAmount)} (ยอดก่อนลด ${formatBaht(cartTotal)})`
        );
      }
    }
    if (effectiveDepositChangeToCredit) {
      noteParts.push(`ฝากเงินทอน ${formatBaht(change)} เข้าเครดิตรอบหน้า`);
    }
    if (paymentMethod === 'cash' && isSplitCashQr) {
      noteParts.push(
        `แยกจ่าย: เงินสด ฿${formatNumber(received)} + โอน QR ฿${formatNumber(splitQrAmount)}`
      );
    } else if (paymentMethod === 'qr' && partialCashAmount > 0) {
      noteParts.push(
        `แบ่งจ่ายเงินสด ${formatBaht(partialCashAmount)} + สแกน QR ${formatBaht(qrPayAmount)}`
      );
    }
    const trimmedOrderNote = orderNote.trim();
    if (trimmedOrderNote) {
      noteParts.push(trimmedOrderNote);
    }
    const saleNote = noteParts.join(' | ');

    const effectiveCreditDownPayment =
      paymentMethod === 'credit' &&
      customerId &&
      creditDownPayment > 0 &&
      creditDownPayment < finalTotal
        ? creditDownPayment
        : 0;
    const effectiveNetCreditRemaining =
      effectiveCreditDownPayment > 0
        ? Math.max(0, Number((finalTotal - effectiveCreditDownPayment).toFixed(2)))
        : finalTotal;

    await submitSale({
      effectivePaymentMethod: paymentMethod,
      effectiveDiscount: discountAmount,
      effectiveTotal: finalTotal,
      received,
      change,
      customerId,
      customerName,
      customerContactNote,
      redeemedPoints: effectiveRedeemedPoints,
      vipDiscountPct: effectiveVipPct > 0 ? effectiveVipPct : undefined,
      usedStoreCredit: effectiveUsedStoreCredit > 0 ? effectiveUsedStoreCredit : undefined,
      depositChangeToCredit: effectiveDepositChangeToCredit,
      saleNote,
      trimmedOrderNote,
      partialCashAmount:
        paymentMethod === 'cash' && isSplitCashQr
          ? received
          : paymentMethod === 'qr'
          ? partialCashAmount
          : 0,
      qrPayAmount:
        paymentMethod === 'cash' && isSplitCashQr
          ? splitQrAmount
          : paymentMethod === 'qr'
          ? qrPayAmount
          : 0,
      creditDownPayment: effectiveCreditDownPayment,
      creditDueDate:
        paymentMethod === 'credit' &&
        selectedCustomer &&
        parseIsoDateUtcMs(creditDueDateInput) !== null
          ? creditDueDateInput.trim()
          : undefined,
      oldDebtSettledAmount: effectiveOldDebtSettled,
      oldDebtPreviousTotal: effectiveOldDebtPreviousTotal,
      itemsPayload,
      successToast:
        effectiveOldDebtSettled > 0
          ? `บันทึกบิล ฿${formatNumber(finalTotal)} + ชำระหนี้เดิม ฿${formatNumber(effectiveOldDebtSettled)} (รวมรับ ฿${formatNumber(effectiveTotalToCollect)}) เรียบร้อย!`
          : paymentMethod === 'cash' && isSplitCashQr
          ? `บันทึกการขายแยกจ่าย (เงินสด ฿${formatNumber(received)} + โอน QR ฿${formatNumber(splitQrAmount)}) เรียบร้อย!`
          : paymentMethod === 'credit' && effectiveCreditDownPayment > 0
          ? `บันทึกบิลเชื่อสำเร็จ! จ่ายสดวันนี้ ฿${formatNumber(effectiveCreditDownPayment)} • ค้างเชื่อสุทธิ ฿${formatNumber(effectiveNetCreditRemaining)}`
          : paymentMethod === 'cash' && change > 0
          ? `ขายสำเร็จ! เงินทอน ${formatBaht(change)}`
          : 'บันทึกการขายสำเร็จเรียบร้อย!',
    });
  };

  const submitSale = async (params: {
    effectivePaymentMethod: PaymentMethod;
    effectiveDiscount: number;
    effectiveTotal: number;
    received: number;
    change: number;
    customerId: string | null;
    customerName: string | null;
    customerContactNote?: string;
    redeemedPoints: number;
    vipDiscountPct?: number;
    usedStoreCredit?: number;
    depositChangeToCredit?: boolean;
    saleNote: string;
    trimmedOrderNote: string;
    partialCashAmount: number;
    qrPayAmount: number;
    creditDownPayment?: number;
    creditDueDate?: string;
    oldDebtSettledAmount?: number;
    oldDebtPreviousTotal?: number;
    itemsPayload: Array<{
      product_id: string;
      product_name: string;
      unit_name: string;
      qty: number;
      conversion_rate: number;
      unit_price: number;
      unit_cost: number;
    }>;
    successToast: string;
  }) => {
    setSubmitting(true);

    const effectiveCreditDownPayment =
      params.effectivePaymentMethod === 'credit' &&
      params.customerId &&
      (params.creditDownPayment ?? 0) > 0 &&
      (params.creditDownPayment ?? 0) < params.effectiveTotal
        ? Number((params.creditDownPayment ?? 0).toFixed(2))
        : 0;
    const effectiveCreditRemainingDebt =
      effectiveCreditDownPayment > 0
        ? Math.max(
            0,
            Number((params.effectiveTotal - effectiveCreditDownPayment).toFixed(2))
          )
        : 0;
    const creditDownPaymentNoteText =
      effectiveCreditDownPayment > 0
        ? `จ่ายสดบางส่วนวันนี้ ฿${formatNumber(
            effectiveCreditDownPayment
          )} (ค้างเชื่อสุทธิ ฿${formatNumber(effectiveCreditRemainingDebt)})`
        : '';

    const itemNotesSummary = buildItemNotesSummary(cart, cartItemNotes);
    const effectiveSaleNote = [
      params.saleNote.trim(),
      creditDownPaymentNoteText,
      itemNotesSummary,
    ]
      .filter(Boolean)
      .join(' | ');

    const { error } = await supabase.rpc('complete_sale', {
      p_shift_id: activeShift?.id ?? null,
      p_customer_id: params.customerId,
      p_payment_method: params.effectivePaymentMethod,
      p_cash_received: params.received,
      p_change_amount: params.change,
      p_note: effectiveSaleNote,
      p_items: params.itemsPayload,
    });

    if (error) {
      setSubmitting(false);
      showToast('error', 'บันทึกการขายไม่สำเร็จ: ' + error.message);
      return;
    }

    let recordedCreditDownPayment = 0;
    let recordedCreditRemainingDebt = 0;
    let creditDownPaymentError = '';
    if (effectiveCreditDownPayment > 0 && params.customerId) {
      const { error: dpError } = await supabase.rpc('record_debt_payment', {
        p_customer_id: params.customerId,
        p_shift_id: activeShift?.id ?? null,
        p_amount: effectiveCreditDownPayment,
        p_payment_method: 'cash',
        p_note: creditDownPaymentNoteText,
      });
      if (dpError) {
        creditDownPaymentError = dpError.message;
      } else {
        recordedCreditDownPayment = effectiveCreditDownPayment;
        recordedCreditRemainingDebt = effectiveCreditRemainingDebt;
      }
    }

    const effectiveOldDebtSettled =
      (params.effectivePaymentMethod === 'cash' ||
        params.effectivePaymentMethod === 'qr') &&
      params.customerId &&
      (params.oldDebtSettledAmount ?? 0) > 0
        ? Number((params.oldDebtSettledAmount ?? 0).toFixed(2))
        : 0;
    let recordedOldDebtSettled = 0;
    let recordedOldDebtRemaining = 0;
    let oldDebtSettleError = '';
    if (effectiveOldDebtSettled > 0 && params.customerId) {
      const { error: settleError } = await supabase.rpc('record_debt_payment', {
        p_customer_id: params.customerId,
        p_shift_id: activeShift?.id ?? null,
        p_amount: effectiveOldDebtSettled,
        p_payment_method: params.effectivePaymentMethod === 'qr' ? 'qr' : 'cash',
        p_note: 'ชำระหนี้พร้อมบิลขายหน้าร้าน',
      });
      if (settleError) {
        oldDebtSettleError = settleError.message;
      } else {
        recordedOldDebtSettled = effectiveOldDebtSettled;
        recordedOldDebtRemaining = Math.max(
          0,
          Number(
            (
              (params.oldDebtPreviousTotal ?? effectiveOldDebtSettled) -
              effectiveOldDebtSettled
            ).toFixed(2)
          )
        );
      }
    }

    setSubmitting(false);

    let pointsEarned: number | undefined;
    let pointsRedeemed: number | undefined;
    let pointsBalance: number | undefined;
    let storeCreditUsed: number | undefined;
    let storeCreditDeposited: number | undefined;
    let storeCreditBalance: number | undefined;

    if (params.customerId) {
      let latestMap = loyaltyPoints;
      try {
        const raw = localStorage.getItem(LOYALTY_POINTS_STORAGE_KEY);
        if (raw !== null) {
          latestMap = parseLoyaltyPointsMap(raw);
        }
      } catch {
        // fallback to in-memory state
      }
      const currentPoints = latestMap[params.customerId] ?? 0;
      const redeemedPoints = Math.min(
        currentPoints,
        Math.max(0, Math.floor(params.redeemedPoints))
      );
      const earnedPoints = Math.floor(
        params.effectiveTotal / LOYALTY_BAHT_PER_EARN_POINT
      );
      const nextPoints = Math.max(0, currentPoints - redeemedPoints) + earnedPoints;
      const updatedMap: Record<string, number> = {
        ...latestMap,
        [params.customerId]: nextPoints,
      };
      setLoyaltyPoints(updatedMap);
      try {
        localStorage.setItem(LOYALTY_POINTS_STORAGE_KEY, JSON.stringify(updatedMap));
      } catch {
        // ignore localStorage write errors
      }
      pointsEarned = earnedPoints;
      pointsRedeemed = redeemedPoints;
      pointsBalance = nextPoints;

      let latestCreditMap = storeCredits;
      try {
        const rawCredit = localStorage.getItem(STORE_CREDIT_STORAGE_KEY);
        if (rawCredit !== null) {
          latestCreditMap = parseStoreCreditMap(rawCredit);
        }
      } catch {
        // fallback to in-memory state
      }
      const currentCredit = latestCreditMap[params.customerId] ?? 0;
      const usedCredit = Math.min(
        currentCredit,
        Math.max(0, Number((params.usedStoreCredit ?? 0).toFixed(2)))
      );
      const depositedCredit =
        params.depositChangeToCredit &&
        params.effectivePaymentMethod === 'cash' &&
        params.change > 0
          ? Number(params.change.toFixed(2))
          : 0;
      const nextCredit = Number(
        (Math.max(0, currentCredit - usedCredit) + depositedCredit).toFixed(2)
      );
      if (usedCredit > 0 || depositedCredit > 0 || currentCredit > 0) {
        const updatedCreditMap: Record<string, number> = { ...latestCreditMap };
        if (nextCredit > 0) {
          updatedCreditMap[params.customerId] = nextCredit;
        } else {
          delete updatedCreditMap[params.customerId];
        }
        setStoreCredits(updatedCreditMap);
        try {
          localStorage.setItem(
            STORE_CREDIT_STORAGE_KEY,
            JSON.stringify(updatedCreditMap)
          );
        } catch {
          // ignore localStorage write errors
        }
        if (usedCredit > 0) storeCreditUsed = usedCredit;
        if (depositedCredit > 0) storeCreditDeposited = depositedCredit;
        storeCreditBalance = nextCredit;
      }
    }

    const savedCreditDueDate =
      params.effectivePaymentMethod === 'credit' &&
      params.customerId &&
      params.creditDueDate &&
      parseIsoDateUtcMs(params.creditDueDate) !== null
        ? params.creditDueDate.trim()
        : undefined;

    if (savedCreditDueDate && params.customerId) {
      let latestDueMap = dueDates;
      try {
        const rawDue = localStorage.getItem(DUE_DATES_STORAGE_KEY);
        if (rawDue !== null) {
          latestDueMap = parseIsoDateMap(rawDue);
        }
      } catch {
        // fallback to in-memory state
      }
      const updatedDueMap: Record<string, string> = {
        ...latestDueMap,
        [params.customerId]: savedCreditDueDate,
      };
      setDueDates(updatedDueMap);
      try {
        localStorage.setItem(DUE_DATES_STORAGE_KEY, JSON.stringify(updatedDueMap));
      } catch {
        // ignore localStorage write errors
      }
    }

    const receiptItems: ReceiptCartItem[] = cart.map((item) => {
      const trimmedNote = (cartItemNotes[item.key] ?? '').trim();
      return trimmedNote ? { ...item, itemNote: trimmedNote } : { ...item };
    });

    const completedSnapshot: CompletedReceipt = {
      items: receiptItems,
      subtotal: cartTotal,
      discount: params.effectiveDiscount,
      total: params.effectiveTotal,
      paymentMethod: params.effectivePaymentMethod,
      cashReceived:
        recordedCreditDownPayment > 0 ? recordedCreditDownPayment : params.received,
      changeAmount: params.change,
      partialCash: params.partialCashAmount,
      qrAmount: params.qrPayAmount,
      creditDownPayment:
        recordedCreditDownPayment > 0 ? recordedCreditDownPayment : undefined,
      creditRemainingDebt:
        recordedCreditDownPayment > 0 ? recordedCreditRemainingDebt : undefined,
      creditDueDate: savedCreditDueDate,
      oldDebtSettled:
        recordedOldDebtSettled > 0 ? recordedOldDebtSettled : undefined,
      oldDebtRemaining:
        recordedOldDebtSettled > 0 ? recordedOldDebtRemaining : undefined,
      customerId: params.customerId,
      customerName: params.customerName,
      customerContactNote:
        params.customerContactNote ??
        (params.customerId ? contactNotes[params.customerId] || null : null),
      note: params.trimmedOrderNote || undefined,
      createdAt: new Date().toISOString(),
      pointsEarned,
      pointsRedeemed,
      pointsBalance,
      vipDiscountPct: params.vipDiscountPct,
      storeCreditUsed,
      storeCreditDeposited,
      storeCreditBalance,
    };

    setCart([]);
    setCartItemNotes({});
    setEditingNoteKey(null);
    setManualPriceKeys(new Set());
    setBillDiscount('');
    setPointsToRedeem(0);
    setVipDiscountApplied(false);
    setStoreCreditToUse(0);
    setDepositChangeToCredit(false);
    setSplitCashQrEnabled(false);
    setPartialCash('0');
    setCreditDownPaymentInput('');
    setCreditDueDateInput('');
    setSettleOldDebtInput('');
    setOrderNote('');
    setSelectedCustomerId('');
    setCheckoutOpen(false);
    setCustomerDisplayOpen(false);
    setMobileCartOpen(false);
    setNewCustName('');
    setNewCustPhone('');
    setNewCustContactNote('');
    setLastReceipt(completedSnapshot);
    setRecentSaleBanner(completedSnapshot);
    playBeep('success');
    if (creditDownPaymentError) {
      showToast(
        'error',
        `บันทึกบิลเชื่อแล้ว แต่บันทึกจ่ายสดบางส่วนไม่สำเร็จ: ${creditDownPaymentError}`
      );
    } else if (oldDebtSettleError) {
      showToast(
        'error',
        `บันทึกบิลขายแล้ว แต่บันทึกชำระหนี้เดิมไม่สำเร็จ: ${oldDebtSettleError}`
      );
    } else {
      showToast('success', params.successToast);
    }
    loadData();
  };

  const handleExactCashCheckout = async () => {
    if (cart.length === 0 || submitting) return;

    const itemsPayload = cart.map((item) => ({
      product_id: item.product_id ?? '',
      product_name: item.product_name,
      unit_name: item.unit_name,
      qty: item.qty,
      conversion_rate: item.conversion_rate,
      unit_price: item.unit_price,
      unit_cost: item.unit_cost,
    }));

    await submitSale({
      effectivePaymentMethod: 'cash',
      effectiveDiscount: 0,
      effectiveTotal: cartTotal,
      received: cartTotal,
      change: 0,
      customerId: selectedCustomer?.id ?? null,
      customerName: selectedCustomer?.name ?? null,
      customerContactNote: selectedCustomer
        ? contactNotes[selectedCustomer.id] || undefined
        : undefined,
      redeemedPoints: 0,
      saleNote: '',
      trimmedOrderNote: '',
      partialCashAmount: 0,
      qrPayAmount: 0,
      itemsPayload,
      successToast: 'บันทึกการขายเงินสดพอดีเรียบร้อย!',
    });
  };
  exactCashCheckoutRef.current = handleExactCashCheckout;

  const handleSeedData = async () => {
    setLoading(true);
    await seedSampleGroceryData(supabase);
    await loadData();
    showToast('success', 'เพิ่มสินค้าตัวอย่างร้านขายของชำเรียบร้อยแล้ว');
  };

  const isSplitHoldActive = splitHoldMode && cart.length >= 2;
  const splitSelectedCount = isSplitHoldActive
    ? cart.filter((item) => splitSelectedKeys.has(item.key)).length
    : 0;

  const CartPanel = (
    <div className="flex flex-col h-full bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5 text-emerald-600" />
          <h2 className="font-bold text-slate-900">ตะกร้าสินค้า ({cartCount})</h2>
        </div>
        {cart.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyCurrentCartLineQuote}
              title="คัดลอกสรุปรายการในตะกร้าส่งให้ลูกค้าทาง LINE"
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors whitespace-nowrap"
            >
              <span>{cartLineQuoteCopied ? '✓ คัดลอกแล้ว' : '💬 คัดลอกบิลส่ง LINE'}</span>
            </button>
            {cart.length >= 2 && (
              <>
                <button
                  type="button"
                  onClick={handleToggleSplitHoldMode}
                  title="เลือกบางรายการในตะกร้าเพื่อแยกไปพักบิลใหม่"
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                    isSplitHoldActive
                      ? 'border-amber-400 bg-amber-100 text-amber-900'
                      : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                  }`}
                >
                  <PauseCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{isSplitHoldActive ? 'ยกเลิกแยกบิล' : 'แยกรายการไปพักบิล'}</span>
                </button>
                <button
                  type="button"
                  onClick={openSaveBundleModal}
                  title="บันทึกสินค้าในตะกร้านี้เป็นชุดขายด่วน"
                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors whitespace-nowrap"
                >
                  <PackagePlus className="h-3.5 w-3.5 shrink-0" />
                  <span>บันทึกเป็นชุดขายด่วน</span>
                </button>
              </>
            )}
            {confirmClearCart ? (
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setLastClearedCartSnapshot({
                      cart: [...cart],
                      cartItemNotes: { ...cartItemNotes },
                      manualPriceKeys: Array.from(manualPriceKeys),
                      selectedCustomerId,
                      pointsToRedeem,
                      vipDiscountApplied,
                      billDiscount,
                      orderNote,
                    });
                    setCart([]);
                    setCartItemNotes({});
                    setEditingNoteKey(null);
                    setManualPriceKeys(new Set());
                    setSelectedCustomerId('');
                    setPointsToRedeem(0);
                    setVipDiscountApplied(false);
                    setBillDiscount('');
                    setOrderNote('');
                    setSplitHoldMode(false);
                    setSplitSelectedKeys(new Set());
                    setConfirmClearCart(false);
                    showToast('success', 'ล้างตะกร้าแล้ว (สามารถกดกู้คืนตะกร้าล่าสุดได้)');
                  }}
                  className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-rose-700 whitespace-nowrap"
                >
                  ยืนยันล้างตะกร้า?
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearCart(false)}
                  className="text-xs font-medium text-slate-600 hover:underline whitespace-nowrap"
                >
                  ยกเลิก
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClearCart(true)}
                className="text-xs font-medium text-rose-600 hover:underline whitespace-nowrap"
              >
                ล้างตะกร้า
              </button>
            )}
          </div>
        )}
        {cart.length === 0 && lastClearedCartSnapshot && (
          <button
            type="button"
            onClick={() => {
              setCart(lastClearedCartSnapshot.cart);
              setCartItemNotes(lastClearedCartSnapshot.cartItemNotes);
              setManualPriceKeys(new Set(lastClearedCartSnapshot.manualPriceKeys));
              setSelectedCustomerId(lastClearedCartSnapshot.selectedCustomerId);
              setPointsToRedeem(lastClearedCartSnapshot.pointsToRedeem);
              setVipDiscountApplied(lastClearedCartSnapshot.vipDiscountApplied);
              setBillDiscount(lastClearedCartSnapshot.billDiscount);
              setOrderNote(lastClearedCartSnapshot.orderNote);
              setLastClearedCartSnapshot(null);
              showToast('success', 'กู้คืนตะกร้าล่าสุดเรียบร้อย');
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 whitespace-nowrap"
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span>กู้คืนตะกร้าล่าสุด</span>
          </button>
        )}
      </div>

      {isSplitHoldActive && (
        <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">
              ติ๊กเลือกรายการที่จะย้ายไปพักบิล ({splitSelectedCount}/{cart.length} รายการ)
            </span>
            <button
              type="button"
              onClick={handleToggleSplitHoldMode}
              className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 underline shrink-0"
            >
              ยกเลิก
            </button>
          </div>
          <p className="text-[11px] text-amber-800">
            เลือกอย่างน้อย 1 รายการ แต่ไม่ใช่ทั้งหมด เพื่อเก็บรายการที่เหลือไว้คิดเงินต่อ
          </p>
          <button
            type="button"
            disabled={splitSelectedCount === 0 || splitSelectedCount >= cart.length}
            onClick={handleSplitCartToHeldBill}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <PauseCircle className="h-3.5 w-3.5 shrink-0" />
            <span>
              ย้ายที่เลือกไปพักบิล
              {splitSelectedCount > 0 ? ` (${splitSelectedCount} รายการ)` : ''}
            </span>
          </button>
        </div>
      )}

      {cart.length === 0 && recentSaleBanner && !lastReceipt && (
        <div className="mx-4 mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900 space-y-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="font-semibold truncate tabular-nums">
              {recentSaleBanner.partialCash && recentSaleBanner.partialCash > 0
                ? `บิลล่าสุด: ${formatBaht(recentSaleBanner.total)} | แยกจ่าย สด ฿${formatNumber(
                    recentSaleBanner.partialCash
                  )} + QR ฿${formatNumber(
                    recentSaleBanner.qrAmount ??
                      Math.max(0, recentSaleBanner.total - recentSaleBanner.partialCash)
                  )}`
                : recentSaleBanner.creditDownPayment &&
                  recentSaleBanner.creditDownPayment > 0
                ? `บิลล่าสุด: ${formatBaht(
                    recentSaleBanner.total
                  )} | จ่ายสดวันนี้ ฿${formatNumber(
                    recentSaleBanner.creditDownPayment
                  )} • ค้างเชื่อสุทธิ ฿${formatNumber(
                    recentSaleBanner.creditRemainingDebt ??
                      Math.max(
                        0,
                        recentSaleBanner.total - recentSaleBanner.creditDownPayment
                      )
                  )}`
                : `บิลล่าสุด: ${formatBaht(recentSaleBanner.total)} | เงินทอน: ${formatBaht(
                    recentSaleBanner.changeAmount
                  )}`}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={recentSaleBanner.items.length === 0}
              onClick={() => handleRepeatReceiptItems(recentSaleBanner)}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors"
            >
              <RotateCcw className="h-3 w-3 shrink-0" />
              <span>ดึงรายการเข้าตะกร้าซ้ำ</span>
            </button>
            <button
              type="button"
              onClick={() => setLastReceipt(recentSaleBanner)}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-white border border-emerald-200 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 transition-colors shrink-0"
            >
              <Printer className="h-3 w-3 shrink-0" />
              <span>ดู/พิมพ์ใบเสร็จ</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 px-4">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
            <ShoppingBag className="h-10 w-10 mb-2 opacity-40" />
            <p className="text-sm font-medium">ยังไม่มีสินค้าในตะกร้า</p>
            <p className="text-xs mt-1">แตะที่สินค้าด้านซ้ายเพื่อเพิ่มรายการ</p>
          </div>
        ) : (
          cart.map((item) => {
            const prod = item.product_id ? productById.get(item.product_id) : undefined;
            const totalNeeded = prod
              ? (cartStockNeededByProduct.get(prod.id) ?? item.qty * item.conversion_rate)
              : 0;
            const isOverStock = Boolean(
              prod && !prod.allow_custom_price && totalNeeded > prod.stock_qty
            );
            const cartExpiryInfo = item.product_id
              ? getProductExpiryInfo(expiryDates[item.product_id], todayIso)
              : null;
            const cartExpiryWarning =
              cartExpiryInfo &&
              (cartExpiryInfo.status === 'expired' ||
                cartExpiryInfo.status === 'expiring_soon')
                ? cartExpiryInfo
                : null;
            const standardUnit = (item.available_units ?? prod?.product_units)?.find(
              (u) => u.unit_name === item.unit_name
            );
            const wholesaleTier =
              item.product_id &&
              !prod?.allow_custom_price &&
              Math.abs(Number(item.conversion_rate) - 1) <= 1e-9
                ? wholesaleTiers[item.product_id]
                : undefined;
            const isWholesaleApplied = Boolean(
              wholesaleTier &&
                standardUnit &&
                !manualPriceKeys.has(item.key) &&
                item.qty >= wholesaleTier.minQty &&
                item.unit_price === wholesaleTier.unitPrice
            );
            const isPriceOverridden = Boolean(
              standardUnit &&
                !prod?.allow_custom_price &&
                !isWholesaleApplied &&
                Number(standardUnit.selling_price) !== item.unit_price
            );
            const itemNote = cartItemNotes[item.key] ?? '';
            const trimmedItemNote = itemNote.trim();
            const isEditingNote = editingNoteKey === item.key;
            const activeItemQuickTags = itemNote
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean);
            const hasBottleDepositTag = activeItemQuickTags.includes('มัดจำขวด');
            const promoLabel = item.product_id ? promoLabels[item.product_id] : undefined;

            const isSplitChecked = isSplitHoldActive && splitSelectedKeys.has(item.key);

            return (
              <div
                key={item.key}
                className={`py-3 flex flex-col gap-2 ${
                  isSplitChecked ? 'bg-amber-50/70 rounded-lg px-2 -mx-2' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    {isSplitHoldActive && (
                      <input
                        type="checkbox"
                        checked={isSplitChecked}
                        onChange={() => handleToggleSplitSelectKey(item.key)}
                        aria-label={`เลือก ${item.product_name} เพื่อย้ายไปพักบิล`}
                        className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500 shrink-0 cursor-pointer"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {item.product_name}
                      </p>
                    {editingPriceKey === item.key ? (
                      <div className="mt-1 flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          autoFocus
                          aria-label={`แก้ไขราคาต่อหน่วย ${item.product_name}`}
                          value={editingPriceValue}
                          onChange={(e) => setEditingPriceValue(e.target.value)}
                          onFocus={(e) => e.currentTarget.select()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitEditCartPrice(item.key);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelEditCartPrice();
                            }
                          }}
                          className="h-7 w-20 rounded-md border border-emerald-400 bg-white px-2 text-xs font-bold text-slate-900 tabular-nums focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-xs text-slate-500">/ {item.unit_name}</span>
                        <button
                          type="button"
                          onClick={() => commitEditCartPrice(item.key)}
                          title="ยืนยันราคาใหม่"
                          aria-label="ยืนยันราคาใหม่"
                          className="h-7 w-7 flex items-center justify-center rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditCartPrice}
                          title="ยกเลิกการแก้ราคา"
                          aria-label="ยกเลิกการแก้ราคา"
                          className="h-7 w-7 flex items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEditCartPrice(item)}
                          title="คลิกเพื่อแก้ไขราคาต่อหน่วยเฉพาะบิลนี้"
                          className="group inline-flex items-center gap-1 rounded-md px-1 -ml-1 py-0.5 text-xs text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 transition-colors tabular-nums"
                        >
                          <span>
                            {formatBaht(item.unit_price)} / {item.unit_name}
                          </span>
                          <Pencil className="h-3 w-3 opacity-50 group-hover:opacity-100" />
                        </button>
                        {isWholesaleApplied && wholesaleTier && (
                          <>
                            {standardUnit &&
                              Number(standardUnit.selling_price) > item.unit_price && (
                                <span className="text-[11px] text-slate-400 line-through tabular-nums">
                                  {formatBaht(standardUnit.selling_price)}
                                </span>
                              )}
                            <span
                              title={
                                standardUnit &&
                                Number(standardUnit.selling_price) > item.unit_price
                                  ? `ราคาปกติ ${formatBaht(standardUnit.selling_price)} — ประหยัด ${formatBaht(
                                      (Number(standardUnit.selling_price) -
                                        item.unit_price) *
                                        item.qty
                                    )}`
                                  : `ใช้ราคาส่งอัตโนมัติ (≥${formatNumber(wholesaleTier.minQty)} ชิ้น)`
                              }
                              className="inline-flex items-center gap-0.5 rounded-md border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-teal-800 leading-none tabular-nums"
                            >
                              ราคาส่ง ≥{formatNumber(wholesaleTier.minQty)} ชิ้น
                            </span>
                          </>
                        )}
                        {isPriceOverridden && (
                          <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 leading-none">
                            ปรับราคา
                          </span>
                        )}
                        {!isWholesaleApplied &&
                          wholesaleTier &&
                          standardUnit &&
                          !manualPriceKeys.has(item.key) &&
                          item.qty < wholesaleTier.minQty && (
                            <span className="text-[10px] font-medium text-teal-700/90 tabular-nums">
                              อีก {formatNumber(wholesaleTier.minQty - item.qty)}{' '}
                              {item.unit_name} ได้ราคาส่ง ฿
                              {formatNumber(wholesaleTier.unitPrice)}
                            </span>
                          )}
                      </div>
                    )}
                    {(promoLabel || isOverStock || cartExpiryWarning) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {promoLabel && (
                          <span
                            title={`ป้ายโปรโมชั่น: ${promoLabel}`}
                            className="inline-flex items-center gap-1 rounded-md bg-gradient-to-r from-rose-500 to-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-2xs max-w-full"
                          >
                            <Tag className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{promoLabel}</span>
                          </span>
                        )}
                        {isOverStock && prod && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[11px] font-medium text-orange-700">
                            <AlertCircle className="h-3 w-3 shrink-0 text-orange-600" />
                            <span>
                              สต็อกเหลือ {formatNumber(prod.stock_qty)} {prod.base_unit} (จะติดลบ)
                            </span>
                          </span>
                        )}
                        {cartExpiryWarning && (
                          <span
                            title={`วันหมดอายุล็อตใกล้สุด: ${cartExpiryWarning.formattedDate} — กรุณาตรวจเช็กก่อนส่งมอบสินค้า`}
                            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${
                              cartExpiryWarning.status === 'expired'
                                ? 'border-red-200 bg-red-100 text-red-700'
                                : 'border-orange-200 bg-orange-100 text-orange-800'
                            }`}
                          >
                            <CalendarClock className="h-3 w-3 shrink-0" />
                            <span>
                              {cartExpiryWarning.status === 'expired'
                                ? `หมดอายุแล้ว (${cartExpiryWarning.formattedDate}) · เช็กก่อนส่งมอบ`
                                : `ใกล้หมดอายุ (${
                                    cartExpiryWarning.daysRemaining === 0
                                      ? 'วันนี้'
                                      : `อีก ${cartExpiryWarning.daysRemaining} วัน`
                                  } · ${cartExpiryWarning.formattedDate})`}
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                    </div>
                  </div>
                  <p className="text-sm font-bold text-slate-900 tabular-nums shrink-0">
                    {formatBaht(item.unit_price * item.qty)}
                  </p>
                </div>

              <div className="flex items-center justify-between gap-2">
                {item.available_units && item.available_units.length > 1 ? (
                  <select
                    value={
                      item.available_units.find((u) => u.unit_name === item.unit_name)?.id ?? ''
                    }
                    onChange={(e) => changeCartUnit(item.key, e.target.value)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700"
                  >
                    {item.available_units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.unit_name} ({formatBaht(u.selling_price)})
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-slate-400">{item.unit_name}</span>
                )}

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => updateCartQty(item.key, -1)}
                    aria-label="ลดจำนวน"
                    className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  >
                    {item.qty <= 1 ? (
                      <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                    ) : (
                      <Minus className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <input
                    type="number"
                    min={0.001}
                    step="any"
                    aria-label={`จำนวน ${item.product_name}`}
                    title="คลิกเพื่อพิมพ์ระบุจำนวนสินค้าโดยตรง"
                    value={editingQtyKey === item.key ? editingQtyValue : String(item.qty)}
                    onFocus={(e) => {
                      setEditingQtyKey(item.key);
                      setEditingQtyValue(String(item.qty));
                      e.currentTarget.select();
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setEditingQtyValue(raw);
                      const parsed = Math.round(Number(raw) * 1000) / 1000;
                      if (raw.trim() !== '' && Number.isFinite(parsed) && parsed > 0) {
                        setCartQtyDirect(item.key, parsed);
                      }
                    }}
                    onBlur={() => {
                      const parsed = Math.round(Number(editingQtyValue) * 1000) / 1000;
                      if (
                        editingQtyValue.trim() === '' ||
                        !Number.isFinite(parsed) ||
                        parsed <= 0
                      ) {
                        setCartQtyDirect(item.key, item.qty > 0 ? item.qty : 1);
                      } else {
                        setCartQtyDirect(item.key, parsed);
                      }
                      setEditingQtyKey(null);
                      setEditingQtyValue('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    className="h-8 w-14 rounded-lg border border-slate-200 bg-white px-1 text-center text-sm font-bold text-slate-900 tabular-nums focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => updateCartQty(item.key, 1)}
                    aria-label="เพิ่มจำนวน"
                    className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => updateCartQty(item.key, 5)}
                    aria-label={`เพิ่มจำนวน ${item.product_name} ทีละ 5`}
                    title="เพิ่มทีละ 5"
                    className="h-8 px-2 flex items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition-colors"
                  >
                    +5
                  </button>
                </div>
              </div>

              {/* Per-item note & quick tags */}
              {isEditingNote ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-2.5 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {QUICK_CART_ITEM_NOTES.map((tag) => {
                      const isActive = activeItemQuickTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          aria-pressed={isActive}
                          onClick={() => toggleCartItemQuickTag(item.key, tag)}
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                            isActive
                              ? 'border-amber-600 bg-amber-500 text-white shadow-2xs'
                              : 'border-amber-200 bg-white text-amber-800 hover:bg-amber-100'
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      autoFocus
                      aria-label={`โน้ตกำกับ ${item.product_name}`}
                      value={itemNote}
                      onChange={(e) => updateCartItemNote(item.key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Escape') {
                          e.preventDefault();
                          setEditingNoteKey(null);
                        }
                      }}
                      placeholder="พิมพ์โน้ตกำกับสินค้านี้..."
                      className="flex-1 min-w-0 h-7 rounded-lg border border-amber-300 bg-white px-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none"
                    />
                    {itemNote !== '' && (
                      <button
                        type="button"
                        onClick={() => updateCartItemNote(item.key, '')}
                        title="ล้างโน้ตสินค้านี้"
                        className="h-7 px-2 rounded-lg border border-rose-200 bg-rose-50 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 transition-colors shrink-0"
                      >
                        ล้าง
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditingNoteKey(null)}
                      className="h-7 px-2.5 rounded-lg bg-amber-600 text-[11px] font-bold text-white hover:bg-amber-700 transition-colors shrink-0"
                    >
                      เสร็จ
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => openContainerDepositFromCartItem(item)}
                      className="inline-flex items-center gap-1 rounded-lg border border-cyan-300 bg-cyan-50 px-2.5 py-1 text-[11px] font-bold text-cyan-800 hover:bg-cyan-100 transition-colors"
                    >
                      <Package className="h-3 w-3 shrink-0 text-cyan-600" />
                      <span>+ บันทึกมัดจำขวด/ถังจากรายการนี้</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  {trimmedItemNote ? (
                    <div className="flex items-center gap-1 min-w-0 max-w-full">
                      <button
                        type="button"
                        onClick={() => setEditingNoteKey(item.key)}
                        title="คลิกเพื่อแก้ไขโน้ตกำกับสินค้า"
                        className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 transition-colors min-w-0 max-w-full"
                      >
                        <StickyNote className="h-3 w-3 shrink-0 text-amber-600" />
                        <span className="truncate">{trimmedItemNote}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => updateCartItemNote(item.key, '')}
                        aria-label={`ลบโน้ต ${item.product_name}`}
                        title="ลบโน้ต"
                        className="h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors shrink-0"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingNoteKey(item.key)}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-amber-50 hover:text-amber-700 transition-colors"
                    >
                      <StickyNote className="h-3 w-3 shrink-0" />
                      <span>+ โน้ตสินค้า</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openWeightBudgetModal(item)}
                    title="คำนวณปริมาณชั่งกิโล หรือตักแบ่งขายตามงบเงินลูกค้า"
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors shrink-0"
                  >
                    <span>⚖️ ชั่งกิโล / ตักตามงบ</span>
                  </button>
                  {hasBottleDepositTag && (
                    <button
                      type="button"
                      onClick={() => openContainerDepositFromCartItem(item)}
                      className="inline-flex items-center gap-1 rounded-md border border-cyan-300 bg-cyan-50 px-2 py-0.5 text-[11px] font-bold text-cyan-800 hover:bg-cyan-100 transition-colors shrink-0"
                    >
                      <Package className="h-3 w-3 shrink-0 text-cyan-600" />
                      <span>+ บันทึกมัดจำขวด/ถังจากรายการนี้</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            );
          })
        )}
      </div>

      <div className="border-t border-slate-200 p-4 bg-slate-50 space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <UserCheck className="h-4 w-4 text-slate-500 shrink-0" />
            <select
              aria-label="เลือกลูกค้าสมาชิก"
              value={selectedCustomerId === '__new__' ? '' : selectedCustomerId}
              onChange={(e) => handleSelectCustomer(e.target.value)}
              className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">ลูกค้าทั่วไป (ไม่ระบุสมาชิก)</option>
              {customers.map((c) => {
                const vipPct = defaultDiscounts[c.id] ?? 0;
                const dueInfo = getCustomerDueInfo(dueDates[c.id], todayIso, c.total_debt);
                return (
                  <option key={c.id} value={c.id}>
                    {c.name} (🏆 {formatNumber(loyaltyPoints[c.id] ?? 0)} แต้ม
                    {vipPct > 0 ? ` | 👑 VIP ลด ${formatNumber(vipPct)}%` : ''}
                    {getCustomerDueSelectLabel(dueInfo)})
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              onClick={openQuickCustomerModal}
              title="เพิ่มลูกค้าด่วน"
              aria-label="เพิ่มลูกค้าด่วน"
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {selectedCustomer && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-1.5 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  <span className="font-semibold text-amber-900 truncate">
                    {selectedCustomer.name}
                  </span>
                  {selectedCustomerTag && (
                    <span
                      title={`กลุ่มลูกค้า: ${selectedCustomerTag}`}
                      className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-purple-300 bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800 truncate"
                    >
                      🏷️ {selectedCustomerTag}
                    </span>
                  )}
                  {selectedCustomerContactNote && (
                    <span
                      title={`ที่อยู่ / ช่องทางติดต่อ: ${selectedCustomerContactNote}`}
                      className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-teal-300 bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800 truncate"
                    >
                      🏠 {selectedCustomerContactNote}
                    </span>
                  )}
                  {selectedCustomerPaydayCycle && (
                    <span
                      title={`รอบจ่ายเงินประจำ: ${selectedCustomerPaydayCycle}`}
                      className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 truncate"
                    >
                      🗓️ รอบจ่าย: {selectedCustomerPaydayCycle}
                    </span>
                  )}
                  {selectedCustomerVipPct > 0 && (
                    <span
                      title={`ส่วนลดประจำตัวลูกค้า VIP ${formatNumber(selectedCustomerVipPct)}%`}
                      className="inline-flex items-center gap-0.5 rounded-full border border-violet-300 bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-800 whitespace-nowrap shrink-0 tabular-nums"
                    >
                      👑 VIP ลด {formatNumber(selectedCustomerVipPct)}%
                    </span>
                  )}
                  {selectedCustomerStoreCredit > 0 && (
                    <span
                      title={`เงินฝากทอนคงเหลือ ${formatBaht(selectedCustomerStoreCredit)}`}
                      className="inline-flex items-center gap-0.5 rounded-full border border-teal-300 bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-800 whitespace-nowrap shrink-0 tabular-nums"
                    >
                      💰 เงินฝากทอน: {formatBaht(selectedCustomerStoreCredit)}
                    </span>
                  )}
                  {renderCustomerCreditHealthBadge(selectedCustomerCreditHealth, true)}
                  {renderCustomerDueBadge(selectedCustomerDueInfo, selectedCustomer.total_debt, true)}
                </div>
                <span className="font-bold text-amber-700 tabular-nums shrink-0">
                  🏆 {formatNumber(selectedCustomerPoints)} แต้ม
                </span>
              </div>
              {selectedCustomerLatestFollowup && (
                <p
                  title={`ติดตามล่าสุด: ${selectedCustomerLatestFollowup.text}`}
                  className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-800 truncate"
                >
                  📝 ติดตามล่าสุด: {selectedCustomerLatestFollowup.text}
                </p>
              )}
            </div>
          )}
        </div>
        {(discountAmount > 0 || orderNote.trim() !== '') && cart.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/90 px-2.5 py-1.5 text-[11px] text-amber-900 space-y-0.5">
            {discountAmount > 0 && (
              <div className="flex items-center justify-between font-bold tabular-nums">
                <span>ส่วนลดท้ายบิลที่ตั้งไว้</span>
                <span className="text-rose-600">-{formatBaht(discountAmount)}</span>
              </div>
            )}
            {orderNote.trim() !== '' && (
              <p className="truncate text-amber-800" title={orderNote}>
                หมายเหตุ: {orderNote}
              </p>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-slate-500">บริการเสริมด่วน</p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_SERVICE_FEES.map((fee) => (
              <button
                key={fee.id}
                type="button"
                onClick={() => handleAddQuickServiceFee(fee)}
                className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-800 hover:bg-sky-100 transition-colors whitespace-nowrap"
              >
                {fee.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-slate-600">ยอดรวมสุทธิ</span>
          <span className="text-2xl font-extrabold text-emerald-700 tabular-nums">
            {formatBaht(discountAmount > 0 ? finalTotal : cartTotal)}
          </span>
        </div>
        <button
          type="button"
          disabled={cart.length === 0}
          onClick={() => setCustomerDisplayOpen(true)}
          title="เปิดหน้าจอแสดงยอดขนาดใหญ่ให้ลูกค้าดูและสแกนจ่าย"
          className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 py-2 px-3 text-xs font-bold text-sky-800 hover:bg-sky-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Monitor className="h-3.5 w-3.5 shrink-0" />
          <span>จอแสดงยอดลูกค้า</span>
        </button>
        <div className="flex items-center gap-1.5">
          {cart.length > 0 && (
            <button
              type="button"
              onClick={handleOpenHoldModal}
              className="flex items-center justify-center gap-1 rounded-xl border border-amber-300 bg-amber-50 px-2.5 py-3.5 text-xs sm:text-sm font-bold text-amber-800 hover:bg-amber-100 transition-colors shrink-0"
              title="พักบิลไว้ชั่วคราว (F4)"
            >
              <PauseCircle className="h-4 w-4" />
              <span>พักบิล</span>
              <kbd className="hidden sm:inline-block rounded bg-amber-200/80 border border-amber-300 px-1 py-0.5 text-[10px] font-semibold text-amber-900">
                F4
              </kbd>
            </button>
          )}
          <button
            type="button"
            disabled={cart.length === 0 || submitting}
            onClick={handleExactCashCheckout}
            title="จ่ายเงินสดพอดีทันที (Ctrl+Enter)"
            className="flex items-center justify-center gap-1 rounded-xl border border-emerald-300 bg-emerald-50 px-2.5 py-3.5 text-xs sm:text-sm font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <Banknote className="h-4 w-4" />
            <span>สดพอดี</span>
            <kbd className="hidden sm:inline-block rounded bg-emerald-200/80 border border-emerald-300 px-1 py-0.5 text-[10px] font-semibold text-emerald-900">
              Ctrl+↵
            </kbd>
          </button>
          <button
            type="button"
            disabled={cart.length === 0}
            onClick={openCheckout}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-3.5 px-3 text-sm sm:text-base font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <span>ชำระเงิน ({formatBaht(discountAmount > 0 ? finalTotal : cartTotal)})</span>
            <kbd className="hidden sm:inline-block rounded bg-emerald-700/80 border border-emerald-400/40 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-100">
              F9
            </kbd>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="print:hidden">
        <AppShell storeName={settings?.store_name || 'ร้านขายของชำ POS'}>
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ${
            toast.type === 'success'
              ? 'bg-emerald-600 text-white'
              : 'bg-rose-600 text-white'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      <div className="flex flex-col lg:flex-row h-[calc(100dvh-3.5rem)] md:h-dvh overflow-hidden">
        {/* Left: Product Grid */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {handoverMemo?.text && !handoverMemoHidden && (
            <div
              role="alert"
              className={`shrink-0 border-b px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 ${
                handoverMemo.urgent
                  ? 'bg-rose-50 border-rose-200 text-rose-950'
                  : 'bg-amber-50 border-amber-200 text-amber-950'
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <AlertCircle
                  className={`h-4 w-4 shrink-0 mt-0.5 ${
                    handoverMemo.urgent ? 'text-rose-600' : 'text-amber-600'
                  }`}
                />
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        handoverMemo.urgent
                          ? 'bg-rose-600 text-white'
                          : 'bg-amber-500 text-white'
                      }`}
                    >
                      {handoverMemo.urgent ? 'ฝากส่งต่อกะ (ด่วน)' : 'ข้อความฝากส่งต่อกะ'}
                    </span>
                    <span className="font-semibold">
                      ผู้ฝาก: {handoverMemo.author || 'ไม่ระบุ'}
                    </span>
                    {handoverMemo.updatedAt &&
                      !Number.isNaN(Date.parse(handoverMemo.updatedAt)) && (
                        <span className="text-[11px] opacity-80 tabular-nums">
                          • {formatDateTime(handoverMemo.updatedAt)}
                        </span>
                      )}
                  </div>
                  <p className="text-sm font-medium break-words">{handoverMemo.text}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setHandoverMemoHidden(true)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    handoverMemo.urgent
                      ? 'border-rose-300 bg-white text-rose-800 hover:bg-rose-100'
                      : 'border-amber-300 bg-white text-amber-800 hover:bg-amber-100'
                  }`}
                >
                  ซ่อนชั่วคราว
                </button>
                <button
                  type="button"
                  onClick={handleAcknowledgeHandoverMemo}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-bold text-white transition-colors whitespace-nowrap ${
                    handoverMemo.urgent
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  รับทราบ &amp; เคลียร์ข้อความ
                </button>
              </div>
            </div>
          )}
          {/* Top Bar */}
          <div className="bg-white border-b border-slate-200 p-3 sm:p-4 space-y-3 shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={search}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSearch(next);
                    if (next === '') {
                      focusSearchOnDesktop();
                    }
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="ค้นหาชื่อสินค้า บาร์โค้ด หรือตำแหน่งชั้นวาง (กด Enter เพื่อเพิ่มทันที)..."
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 pl-9 pr-12 py-2.5 text-sm focus:bg-white focus:border-emerald-500 focus:outline-none"
                />
                <kbd className="pointer-events-none hidden sm:inline-flex items-center rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2">
                  F2
                </kbd>
              </div>
              <button
                type="button"
                onClick={() => setAdHocOpen(true)}
                className="flex items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100 transition-colors shrink-0"
              >
                <Plus className="h-4 w-4" />
                <span>คิดราคาด่วน</span>
              </button>
              <button
                type="button"
                onClick={() => setHeldBillsOpen(true)}
                title="เปิดดูรายการบิลที่พักไว้ (F4 เมื่อตะกร้าว่าง)"
                className="flex items-center gap-1.5 rounded-xl bg-violet-50 border border-violet-200 px-3 py-2.5 text-sm font-semibold text-violet-800 hover:bg-violet-100 transition-colors shrink-0"
              >
                <PauseCircle className="h-4 w-4 text-violet-600" />
                <span>บิลที่พักไว้ ({heldBills.length})</span>
              </button>
              <button
                type="button"
                onClick={openTodaySalesModal}
                className="flex items-center gap-1.5 rounded-xl bg-slate-100 border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors shrink-0"
              >
                <Receipt className="h-4 w-4 text-emerald-600" />
                <span>ประวัติบิลวันนี้</span>
                {todaySales.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-emerald-600 px-1.5 py-0.2 text-[11px] font-bold text-white tabular-nums">
                    {todaySales.length}
                  </span>
                )}
              </button>
              {activeShift ? (
                <div
                  title={`เปิดกะเมื่อ ${formatTime(activeShift.opened_at)} น. (ระบบกำลังบันทึกบิลเข้ากะปัจจุบัน)`}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 shrink-0"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>กะเปิดอยู่</span>
                  <span className="hidden sm:inline text-emerald-600 tabular-nums">
                    ({formatTime(activeShift.opened_at)})
                  </span>
                </div>
              ) : (
                !loading && (
                  <button
                    type="button"
                    onClick={() => setShiftModalOpen(true)}
                    className="flex items-center gap-1.5 rounded-xl bg-sky-50 border border-sky-200 px-3 py-2.5 text-sm font-semibold text-sky-700 hover:bg-sky-100 transition-colors shrink-0"
                  >
                    <Clock className="h-4 w-4" />
                    <span>เปิดกะขาย</span>
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => setShowMorePosTools((prev) => !prev)}
                aria-expanded={showMorePosTools}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors shrink-0 ${
                  showMorePosTools
                    ? 'bg-slate-800 border-slate-800 text-white'
                    : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Settings className="h-4 w-4" />
                <span>{showMorePosTools ? 'ซ่อนเครื่องมือเสริม' : 'เครื่องมือเสริม (⋯)'}</span>
              </button>
            </div>

            {showMorePosTools && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={openContainerDepositsModal}
                title="สมุดบันทึกมัดจำขวด/ลัง/ถังน้ำ และคืนเงินมัดจำด่วน"
                className="flex items-center gap-1.5 rounded-xl bg-cyan-50 border border-cyan-200 px-3 py-2 text-xs font-semibold text-cyan-800 hover:bg-cyan-100 transition-colors shrink-0"
              >
                <Package className="h-4 w-4 text-cyan-600" />
                <span>มัดจำขวด/ถัง</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                    containerDeposits.length > 0
                      ? 'bg-cyan-600 text-white'
                      : 'bg-cyan-100 text-cyan-700'
                  }`}
                >
                  {containerDeposits.length} • {formatBaht(totalContainerDepositAmount)}
                </span>
              </button>
              <button
                type="button"
                onClick={toggleSound}
                title={soundEnabled ? 'ปิดเสียงปุ่มกด' : 'เปิดเสียงปุ่มกด'}
                aria-label={soundEnabled ? 'ปิดเสียงปุ่มกด' : 'เปิดเสียงปุ่มกด'}
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-semibold transition-colors shrink-0 ${
                  soundEnabled
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                <span>{soundEnabled ? 'เสียงเปิด' : 'เสียงปิด'}</span>
              </button>
              <button
                type="button"
                onClick={toggleGridDensity}
                title={
                  gridDensity === 'large'
                    ? 'กำลังแสดงการ์ดใหญ่ (จอสัมผัส) — คลิกเพื่อสลับเป็นการ์ดกระชับ'
                    : 'กำลังแสดงการ์ดกระชับ (แสดงหลายรายการ) — คลิกเพื่อสลับเป็นการ์ดใหญ่'
                }
                aria-label={
                  gridDensity === 'large'
                    ? 'สลับเป็นโหมดการ์ดกระชับ'
                    : 'สลับเป็นโหมดการ์ดใหญ่'
                }
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-semibold transition-colors shrink-0 ${
                  gridDensity === 'compact'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {gridDensity === 'large' ? (
                  <LayoutGrid className="h-4 w-4" />
                ) : (
                  <Grid3x3 className="h-4 w-4" />
                )}
                <span>
                  {gridDensity === 'large'
                    ? 'การ์ดใหญ่ (จอสัมผัส)'
                    : 'การ์ดกระชับ (แสดงหลายรายการ)'}
                </span>
              </button>
              <button
                type="button"
                onClick={openPriceCheckerModal}
                title="เช็กราคาและข้อมูลสินค้าด่วนโดยไม่เพิ่มลงตะกร้า (F6)"
                className="flex items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors shrink-0"
              >
                <Tag className="h-4 w-4 text-amber-600" />
                <span>เช็กราคา (F6)</span>
              </button>
              <button
                type="button"
                onClick={openQuickMiscModal}
                title="เพิ่มสินค้าเบ็ดเตล็ด / สินค้านอกรายการด่วน (F7)"
                className="flex items-center gap-1.5 rounded-xl bg-teal-50 border border-teal-200 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100 transition-colors shrink-0"
              >
                <PackagePlus className="h-4 w-4 text-teal-600" />
                <span>+ สินค้าเบ็ดเตล็ด (F7)</span>
              </button>
              <button
                type="button"
                onClick={() => setCalcOpen(true)}
                title="เปิดเครื่องคิดเลขด่วน"
                className="flex items-center gap-1.5 rounded-xl bg-slate-100 border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors shrink-0"
              >
                <Calculator className="h-4 w-4 text-sky-600" />
                <span>เครื่องคิดเลข</span>
              </button>
              <button
                type="button"
                onClick={openReceiptSettingsModal}
                title="ตั้งค่าร้าน / ข้อความท้ายใบเสร็จ"
                className="flex items-center gap-1.5 rounded-xl bg-slate-100 border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors shrink-0"
              >
                <Settings className="h-4 w-4 text-slate-600" />
                <span>ตั้งค่าร้าน / ใบเสร็จ</span>
              </button>
              <button
                type="button"
                onClick={() => setShortcutsOpen(true)}
                title="คู่มือคีย์ลัดแป้นพิมพ์ (F1)"
                className="flex items-center gap-1.5 rounded-xl bg-slate-100 border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors shrink-0"
              >
                <HelpCircle className="h-4 w-4 text-emerald-600" />
                <span>? คีย์ลัด (F1)</span>
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                title={isFullscreen ? 'ออกจากโหมดเต็มจอ' : 'ขยายเต็มจอ'}
                aria-label={isFullscreen ? 'ย่อจอ' : 'เต็มจอ'}
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-semibold transition-colors shrink-0 ${
                  isFullscreen
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
                <span>{isFullscreen ? 'ย่อจอ' : 'เต็มจอ'}</span>
              </button>
              <button
                type="button"
                onClick={handleLockScreen}
                title="ล็อกหน้าจอขายชั่วคราวเพื่อความเป็นส่วนตัว (ยังคงตะกร้าและบิลพักไว้ครบถ้วน)"
                className="flex items-center gap-1.5 rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-900 transition-colors shrink-0"
              >
                <Lock className="h-4 w-4" />
                <span>ล็อกหน้าจอ</span>
              </button>
              </div>
            )}

            {/* Category Tabs, Multiplier & Sort Toggle */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 overflow-x-auto pb-1 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setSelectedCat('pinned')}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedCat === 'pinned'
                      ? 'bg-amber-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  ★ ปักหมุด ({pinnedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCat('promo')}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedCat === 'promo'
                      ? 'bg-rose-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  🔥 โปรโมชั่น ({promoProductsCount})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCat('wholesale')}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedCat === 'wholesale'
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  📦 มีราคาส่ง ({wholesaleProductsCount})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCat('quick')}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedCat === 'quick'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  ★ ปุ่มด่วน
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCat('all')}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedCat === 'all'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  ทั้งหมด
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCat(cat.id)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                      selectedCat === cat.id
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 shrink-0 mb-1">
                <div
                  role="group"
                  aria-label="ตัวคูณจำนวนสินค้า"
                  className="flex items-center rounded-xl border border-slate-200 bg-slate-100 p-0.5"
                >
                  {([1, 2, 5, 10] as const).map((mult) => {
                    const active = qtyMultiplier === mult;
                    return (
                      <button
                        key={mult}
                        type="button"
                        onClick={() => setQtyMultiplier(mult)}
                        aria-pressed={active}
                        title={`เพิ่มครั้งละ ${mult} ชิ้น/หน่วย`}
                        className={`rounded-lg px-2.5 py-1 text-xs font-bold tabular-nums transition-colors ${
                          active
                            ? mult === 1
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'bg-emerald-600 text-white shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        ×{mult}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setProductSort((prev) => (prev === 'name' ? 'quick' : 'name'))
                  }
                  title={
                    productSort === 'name'
                      ? 'กำลังเรียงตามชื่อ ก-ฮ (คลิกเพื่อเรียงปุ่มด่วนขึ้นก่อน)'
                      : 'กำลังเรียงปุ่มด่วนขึ้นก่อน (คลิกเพื่อเรียงตามชื่อ ก-ฮ)'
                  }
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors shrink-0 ${
                    productSort === 'quick'
                      ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                      : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  <span>{productSort === 'name' ? 'ชื่อ ก-ฮ' : 'ปุ่มด่วนขึ้นก่อน'}</span>
                </button>
              </div>
            </div>

            {/* Quick Bundles Bar */}
            {bundles.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-0.5 pt-1.5 border-t border-slate-100">
                <span className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 whitespace-nowrap shrink-0">
                  <Package className="h-3.5 w-3.5 text-indigo-600" />
                  <span>ชุดขายด่วน:</span>
                </span>
                <div className="flex items-center gap-1.5">
                  {bundles.map((bundle) => {
                    const totalItemsQty = bundle.items.reduce(
                      (sum, item) => sum + Math.max(1, Number(item.qty) || 1),
                      0
                    );
                    const bundlePreviewPrice = bundle.items.reduce((sum, item) => {
                      const prod = productById.get(item.product_id);
                      if (!prod) return sum;
                      const units = prod.product_units ?? [];
                      const unit =
                        (item.unit_id
                          ? units.find((u) => u.id === item.unit_id)
                          : undefined) ??
                        units.find((u) => u.is_default) ??
                        units[0];
                      return (
                        sum +
                        Number(unit?.selling_price ?? 0) *
                          Math.max(1, Number(item.qty) || 1)
                      );
                    }, 0);

                    return (
                      <div
                        key={bundle.id}
                        className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50/80 shadow-2xs shrink-0 overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => handleAddBundleToCart(bundle)}
                          title={`คลิกเพื่อเพิ่มชุด "${bundle.name}" (${bundle.items.length} รายการ · ${totalItemsQty} ชิ้น) ลงตะกร้า`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-indigo-900 hover:bg-indigo-100 transition-colors whitespace-nowrap"
                        >
                          <span>{bundle.name}</span>
                          <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 tabular-nums">
                            {bundle.items.length} รายการ
                            {bundlePreviewPrice > 0
                              ? ` · ${formatBaht(bundlePreviewPrice)}`
                              : ''}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBundle(bundle.id)}
                          aria-label={`ลบชุดขายด่วน ${bundle.name}`}
                          title={`ลบชุด "${bundle.name}"`}
                          className="px-1.5 py-1.5 text-indigo-400 hover:text-rose-600 hover:bg-rose-50 border-l border-indigo-200 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Product Grid */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 pb-24 lg:pb-4">
            {loading ? (
              <div
                className={
                  gridDensity === 'compact'
                    ? 'grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-6 gap-2'
                    : 'grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3'
                }
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <div
                    key={n}
                    className={
                      gridDensity === 'compact'
                        ? 'h-20 rounded-xl bg-slate-200/70 animate-pulse'
                        : 'h-28 rounded-2xl bg-slate-200/70 animate-pulse'
                    }
                  />
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-2xl border border-dashed border-slate-300 p-6">
                <Sparkles className="h-10 w-10 text-emerald-500 mb-3" />
                <h3 className="text-base font-bold text-slate-900">
                  ยังไม่มีสินค้าในระบบ
                </h3>
                <p className="text-sm text-slate-500 mt-1 max-w-sm">
                  สามารถเพิ่มสินค้าเองในหน้า &quot;สินค้า &amp; สต็อก&quot; หรือกดปุ่มด้านล่างเพื่อสร้างข้อมูลตัวอย่างร้านขายของชำได้ทันที
                </p>
                <button
                  type="button"
                  onClick={handleSeedData}
                  className="mt-4 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  สร้างสินค้าตัวอย่างร้านขายของชำ
                </button>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-sm">
                {selectedCat === 'pinned' && !search.trim()
                  ? 'ยังไม่มีสินค้าที่ปักหมุด กดปุ่มดาว ★ ที่มุมการ์ดสินค้าเพื่อปักหมุดขายด่วน'
                  : selectedCat === 'promo' && !search.trim()
                  ? 'ยังไม่มีสินค้าที่มีป้ายโปรโมชั่น'
                  : selectedCat === 'wholesale' && !search.trim()
                  ? 'ยังไม่มีสินค้าที่ตั้งค่าราคาส่ง'
                  : 'ไม่พบสินค้าในหมวดหมู่นี้'}
              </div>
            ) : (
              <div
                className={
                  gridDensity === 'compact'
                    ? 'grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-6 gap-2'
                    : 'grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3'
                }
              >
                {filteredProducts.map((product) => {
                  const units = product.product_units ?? [];
                  const defaultUnit =
                    units.find((u) => u.is_default) ?? units[0];
                  const isLow =
                    !product.allow_custom_price &&
                    product.stock_qty <= product.low_stock_alert;
                  const isOutOrLowStock =
                    !product.allow_custom_price &&
                    (product.stock_qty <= 0 ||
                      product.stock_qty <= product.low_stock_alert);
                  const isCompact = gridDensity === 'compact';
                  const isPinned = pinnedIdSet.has(product.id);
                  const shelfLocation = shelfLocations[product.id];
                  const promoLabel = promoLabels[product.id];
                  const substituteNote = isOutOrLowStock
                    ? substituteNotes[product.id]
                    : undefined;
                  const wholesaleTier = wholesaleTiers[product.id];
                  const expiryInfo = getProductExpiryInfo(
                    expiryDates[product.id],
                    todayIso
                  );
                  const expiryWarning =
                    expiryInfo &&
                    (expiryInfo.status === 'expired' ||
                      expiryInfo.status === 'expiring_soon')
                      ? expiryInfo
                      : null;

                  return (
                    <div
                      key={product.id}
                      className={`group relative flex flex-col justify-between bg-white border shadow-xs hover:border-emerald-400 hover:shadow-md transition-all text-left ${
                        isPinned
                          ? 'border-amber-300 bg-amber-50/30'
                          : 'border-slate-200'
                      } ${isCompact ? 'rounded-xl p-2.5' : 'rounded-2xl p-3.5'}`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePinProduct(product.id);
                        }}
                        aria-label={
                          isPinned
                            ? `เลิกปักหมุด ${product.name}`
                            : `ปักหมุด ${product.name}`
                        }
                        aria-pressed={isPinned}
                        title={
                          isPinned ? 'เลิกปักหมุดสินค้าด่วน' : 'ปักหมุดสินค้าด่วน'
                        }
                        className={`absolute z-10 min-h-8 min-w-8 flex items-center justify-center rounded-lg p-1.5 transition-colors ${
                          isCompact ? 'top-1 right-1' : 'top-1.5 right-1.5'
                        } ${
                          isPinned
                            ? 'text-amber-500 hover:bg-amber-100'
                            : 'text-slate-400 opacity-75 group-hover:opacity-100 hover:text-amber-500 hover:bg-slate-100'
                        }`}
                      >
                        <Star
                          className={`${isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${
                            isPinned ? 'fill-amber-400 text-amber-500' : ''
                          }`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => addProductToCart(product)}
                        className="text-left w-full flex-1 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-1 pr-6">
                            <span
                              className={`font-bold text-slate-900 line-clamp-2 leading-snug ${
                                isCompact ? 'text-xs' : 'text-sm'
                              }`}
                            >
                              {product.name}
                            </span>
                          </div>
                          <p
                            className={`text-slate-600 ${
                              isCompact ? 'text-[11px] mt-0.5' : 'text-xs mt-1'
                            }`}
                          >
                            {product.allow_custom_price
                              ? 'กรอกราคาหน้างาน'
                              : `คงเหลือ ${formatNumber(product.stock_qty)} ${product.base_unit}`}
                          </p>
                        </div>

                        <div
                          className={`flex items-baseline justify-between ${
                            isCompact ? 'mt-1.5' : 'mt-3'
                          }`}
                        >
                          <span
                            className={`font-extrabold text-emerald-700 tabular-nums ${
                              isCompact ? 'text-sm' : 'text-base'
                            }`}
                          >
                            {product.allow_custom_price
                              ? 'กำหนดราคา'
                              : formatBaht(defaultUnit?.selling_price ?? 0)}
                          </span>
                          {!product.allow_custom_price && defaultUnit && (
                            <span className="text-[11px] text-slate-500">
                              /{defaultUnit.unit_name}
                            </span>
                          )}
                        </div>
                      </button>

                      {/* Multi-unit quick buttons if product has >1 unit */}
                      {units.length > 1 && (
                        <div
                          className={`border-t border-slate-100 flex flex-wrap gap-1 ${
                            isCompact ? 'mt-1.5 pt-1.5' : 'mt-2.5 pt-2'
                          }`}
                        >
                          {units.map((u) => (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => addProductToCart(product, u)}
                              className={`rounded-lg bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 font-medium text-slate-700 transition-colors ${
                                isCompact
                                  ? 'px-1.5 py-0.5 text-[10px]'
                                  : 'px-2 py-1 text-[11px]'
                              }`}
                            >
                              {u.unit_name} {formatBaht(u.selling_price)}
                            </button>
                          ))}
                        </div>
                      )}

                      {(promoLabel || wholesaleTier || shelfLocation || isLow || expiryWarning || substituteNote) && (
                        <div
                          className={`flex flex-wrap items-center gap-1 ${
                            isCompact ? 'mt-1.5' : 'mt-2'
                          }`}
                        >
                          {promoLabel && (
                            <span
                              title={`ป้ายโปรโมชั่น: ${promoLabel}`}
                              className="inline-flex items-center gap-1 rounded-md bg-gradient-to-r from-rose-500 to-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-2xs max-w-full"
                            >
                              <Tag className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{promoLabel}</span>
                            </span>
                          )}
                          {wholesaleTier && (
                            <span
                              title={`ซื้อครบ ${formatNumber(wholesaleTier.minQty)} ${product.base_unit} ขึ้นไป ราคาส่ง ฿${formatNumber(wholesaleTier.unitPrice)}/${product.base_unit}`}
                              className="inline-flex items-center gap-0.5 rounded-md border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-teal-800 tabular-nums"
                            >
                              <span>
                                ราคาส่ง ≥{formatNumber(wholesaleTier.minQty)} ชิ้น ฿
                                {formatNumber(wholesaleTier.unitPrice)}
                              </span>
                            </span>
                          )}
                          {shelfLocation && (
                            <span
                              title={`ตำแหน่งชั้นวาง: ${shelfLocation}`}
                              className="inline-flex items-center gap-0.5 rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 max-w-full"
                            >
                              <span aria-hidden="true">📍</span>
                              <span className="truncate">{shelfLocation}</span>
                            </span>
                          )}
                          {isLow && (
                            <span className="inline-block rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                              ใกล้หมด
                            </span>
                          )}
                          {substituteNote && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSearch(substituteNote);
                                focusSearchOnDesktop();
                              }}
                              title={`กดเพื่อค้นหาสินค้าทดแทน: ${substituteNote}`}
                              className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 hover:bg-sky-100 transition-colors max-w-full text-left"
                            >
                              <Search className="h-3 w-3 shrink-0" />
                              <span className="truncate">ทดแทน: {substituteNote}</span>
                            </button>
                          )}
                          {expiryWarning && (
                            <span
                              title={`วันหมดอายุล็อตใกล้สุด: ${expiryWarning.formattedDate} — กรุณาตรวจเช็กก่อนส่งมอบ`}
                              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${
                                expiryWarning.status === 'expired'
                                  ? 'border-red-200 bg-red-100 text-red-700'
                                  : 'border-orange-200 bg-orange-100 text-orange-800'
                              }`}
                            >
                              <CalendarClock className="h-3 w-3 shrink-0" />
                              <span>
                                {expiryWarning.status === 'expired'
                                  ? isCompact
                                    ? 'หมดอายุแล้ว'
                                    : `หมดอายุแล้ว (${expiryWarning.formattedDate})`
                                  : isCompact
                                    ? `ใกล้หมดอายุ (${
                                        expiryWarning.daysRemaining === 0
                                          ? 'วันนี้'
                                          : `${expiryWarning.daysRemaining} วัน`
                                      })`
                                    : `ใกล้หมดอายุ (${
                                        expiryWarning.daysRemaining === 0
                                          ? 'วันนี้'
                                          : `อีก ${expiryWarning.daysRemaining} วัน`
                                      })`}
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Desktop Right Cart */}
        <div className="hidden lg:flex lg:w-96 xl:w-[420px] border-l border-slate-200 flex-col shrink-0">
          {CartPanel}
        </div>
      </div>

      {/* Mobile Floating Cart Bar */}
      {cart.length > 0 && (
        <div className="lg:hidden fixed bottom-16 inset-x-3 z-30">
          <button
            type="button"
            onClick={() => setMobileCartOpen(true)}
            className="w-full flex items-center justify-between rounded-2xl bg-emerald-600 px-4 py-3.5 text-white shadow-xl"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20 text-xs font-bold">
                {cartCount}
              </span>
              <span className="text-sm font-bold">ดูตะกร้า &amp; คิดเงิน</span>
            </div>
            <span className="text-base font-extrabold tabular-nums">
              {formatBaht(cartTotal)}
            </span>
          </button>
        </div>
      )}

      {/* Mobile Cart Modal */}
      <Modal
        open={mobileCartOpen}
        onClose={() => setMobileCartOpen(false)}
        title="ตะกร้าสินค้า"
      >
        <div className="-m-5 h-[70dvh] flex flex-col">{CartPanel}</div>
      </Modal>

      {/* Custom Price Modal (e.g. vegetables / weighed items) */}
      <Modal
        open={!!customPriceProduct}
        onClose={() => setCustomPriceProduct(null)}
        title={customPriceProduct?.name || 'กรอกราคา'}
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={handleConfirmCustomPrice} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              ระบุราคาขาย (บาท)
            </label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              required
              autoFocus
              value={customPriceInput}
              onChange={(e) => setCustomPriceInput(e.target.value)}
              placeholder="เช่น 25"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-xl font-bold tabular-nums focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {[5, 10, 15, 20, 30, 50, 100].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setCustomPriceInput(String(amt))}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
              >
                {amt}฿
              </button>
            ))}
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700"
          >
            เพิ่มลงตะกร้า
          </button>
        </form>
      </Modal>

      {/* Weight & Target Budget Calculator Modal */}
      <Modal
        open={!!weightBudgetItem}
        onClose={() => setWeightBudgetItemKey(null)}
        title={
          weightBudgetItem
            ? `⚖️ ชั่งกิโล / ตักตามงบ — ${weightBudgetItem.product_name}`
            : '⚖️ ชั่งกิโล / ตักตามงบ'
        }
        maxWidthClass="max-w-md"
      >
        {weightBudgetItem && (
          <form onSubmit={handleApplyWeightBudget} className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <span className="text-slate-600">
                ราคาต่อหน่วย ({weightBudgetItem.unit_name})
              </span>
              <span className="font-bold text-slate-900 tabular-nums">
                {formatBaht(weightBudgetItem.unit_price)} / {weightBudgetItem.unit_name}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setWeightBudgetMode('weight')}
                className={`rounded-lg py-2 text-xs font-bold transition-colors ${
                  weightBudgetMode === 'weight'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ⚖️ ชั่งน้ำหนัก / ทศนิยม
              </button>
              <button
                type="button"
                onClick={() => setWeightBudgetMode('budget')}
                className={`rounded-lg py-2 text-xs font-bold transition-colors ${
                  weightBudgetMode === 'budget'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                💰 ตักตามงบเงินลูกค้า
              </button>
            </div>

            {weightBudgetMode === 'weight' ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    เลือกน้ำหนัก / ปริมาณด่วน ({weightBudgetItem.unit_name})
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { value: 0.25, label: '0.25 (1 ขีดครึ่ง/1ส่วน4)' },
                      { value: 0.5, label: '0.5 (ครึ่งหน่วย/ครึ่งโล)' },
                      { value: 0.75, label: '0.75' },
                      { value: 1.5, label: '1.5' },
                      { value: 2.5, label: '2.5' },
                    ].map((preset) => {
                      const isSelected = Number(weightQtyInput) === preset.value;
                      return (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => setWeightQtyInput(String(preset.value))}
                          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors tabular-nums ${
                            isSelected
                              ? 'border-emerald-500 bg-emerald-600 text-white'
                              : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-emerald-50 hover:border-emerald-300'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="weight-qty-input"
                    className="block text-sm font-medium text-slate-700 mb-1"
                  >
                    กรอกปริมาณทศนิยมเอง ({weightBudgetItem.unit_name})
                  </label>
                  <input
                    id="weight-qty-input"
                    type="number"
                    step="any"
                    min="0.001"
                    required
                    autoFocus
                    value={weightQtyInput}
                    onChange={(e) => setWeightQtyInput(e.target.value)}
                    placeholder="เช่น 0.35 หรือ 1.25"
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-xl font-bold tabular-nums focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-800">ยอดเงินรวมทันที</span>
                  <span className="text-lg font-extrabold text-emerald-700 tabular-nums">
                    {Number(weightQtyInput) > 0
                      ? formatBaht(
                          Math.round(Number(weightQtyInput) * 1000) /
                            1000 *
                            weightBudgetItem.unit_price
                        )
                      : formatBaht(0)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="target-budget-baht-input"
                    className="block text-sm font-medium text-slate-700 mb-1"
                  >
                    งบเงินที่ลูกค้าต้องการซื้อ (บาท)
                  </label>
                  <input
                    id="target-budget-baht-input"
                    type="number"
                    step="any"
                    min="0.01"
                    required
                    autoFocus
                    value={budgetBahtInput}
                    onChange={(e) => setBudgetBahtInput(e.target.value)}
                    placeholder="เช่น 20"
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-xl font-bold tabular-nums focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {[10, 20, 30, 50, 100].map((amt) => {
                    const isSelected = Number(budgetBahtInput) === amt;
                    return (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setBudgetBahtInput(String(amt))}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors tabular-nums ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-600 text-white'
                            : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:border-emerald-300'
                        }`}
                      >
                        ฿{amt}
                      </button>
                    );
                  })}
                </div>

                {(() => {
                  const targetBaht = Number(budgetBahtInput);
                  const unitPrice = weightBudgetItem.unit_price;
                  const calcQty =
                    Number.isFinite(targetBaht) && targetBaht > 0 && unitPrice > 0
                      ? Number((targetBaht / unitPrice).toFixed(3))
                      : 0;
                  return (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-emerald-800">ปริมาณที่คำนวณได้</span>
                        <span className="font-extrabold text-emerald-900 tabular-nums">
                          {calcQty > 0
                            ? `${formatNumber(calcQty)} ${weightBudgetItem.unit_name}`
                            : `0 ${weightBudgetItem.unit_name}`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-emerald-800">ยอดรวมรายการ</span>
                        <span className="text-base font-extrabold text-emerald-700 tabular-nums">
                          {calcQty > 0 ? formatBaht(calcQty * unitPrice) : formatBaht(0)}
                        </span>
                      </div>
                      {calcQty > 0 && (
                        <p className="pt-1 border-t border-emerald-200/70 text-[11px] text-emerald-700">
                          จะแนบโน้ต: &quot;ตักตามงบ ฿{formatNumber(targetBaht)} (~{formatNumber(calcQty)}{' '}
                          {weightBudgetItem.unit_name})&quot;
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setWeightBudgetItemKey(null)}
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
              >
                นำไปใช้กับรายการนี้
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Ad-hoc Item Modal */}
      <Modal
        open={adHocOpen}
        onClose={() => setAdHocOpen(false)}
        title="คิดราคาสินค้าด่วน"
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={handleConfirmAdHoc} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              ชื่อรายการ
            </label>
            <input
              type="text"
              required
              value={adHocName}
              onChange={(e) => setAdHocName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              ราคา (บาท)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              autoFocus
              value={adHocPrice}
              onChange={(e) => setAdHocPrice(e.target.value)}
              placeholder="0"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xl font-bold tabular-nums focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700"
          >
            เพิ่มลงตะกร้า
          </button>
        </form>
      </Modal>

      {/* Quick Calculator Modal */}
      <Modal
        open={calcOpen}
        onClose={() => setCalcOpen(false)}
        title="เครื่องคิดเลขด่วน"
        maxWidthClass="max-w-sm"
      >
        <div className="space-y-3">
          <div className="rounded-2xl bg-slate-900 px-4 py-3.5 text-right text-white shadow-inner">
            <div className="min-h-[1.125rem] text-xs font-medium text-slate-400 tabular-nums truncate">
              {calcExpression || '\u00A0'}
            </div>
            <div className="mt-1 text-3xl font-bold tabular-nums tracking-tight truncate">
              {calcDisplay}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={handleCalcClear}
              className="col-span-2 h-14 rounded-xl bg-rose-50 border border-rose-200 text-lg font-bold text-rose-700 hover:bg-rose-100 active:scale-95 transition-transform"
            >
              C
            </button>
            <button
              type="button"
              onClick={handleCalcBackspace}
              aria-label="ลบตัวเลข"
              className="h-14 rounded-xl bg-slate-100 border border-slate-200 text-xl font-bold text-slate-700 hover:bg-slate-200 active:scale-95 transition-transform"
            >
              ⌫
            </button>
            <button
              type="button"
              onClick={() => handleCalcOperator('÷')}
              className={`h-14 rounded-xl border text-2xl font-bold active:scale-95 transition-transform ${
                calcOperator === '÷' && calcWaitingForOperand
                  ? 'bg-sky-600 border-sky-600 text-white'
                  : 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100'
              }`}
            >
              ÷
            </button>

            {['7', '8', '9'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => handleCalcDigit(d)}
                className="h-14 rounded-xl bg-white border border-slate-200 text-xl font-bold text-slate-800 hover:bg-slate-50 active:scale-95 transition-transform tabular-nums"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => handleCalcOperator('×')}
              className={`h-14 rounded-xl border text-2xl font-bold active:scale-95 transition-transform ${
                calcOperator === '×' && calcWaitingForOperand
                  ? 'bg-sky-600 border-sky-600 text-white'
                  : 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100'
              }`}
            >
              ×
            </button>

            {['4', '5', '6'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => handleCalcDigit(d)}
                className="h-14 rounded-xl bg-white border border-slate-200 text-xl font-bold text-slate-800 hover:bg-slate-50 active:scale-95 transition-transform tabular-nums"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => handleCalcOperator('-')}
              className={`h-14 rounded-xl border text-2xl font-bold active:scale-95 transition-transform ${
                calcOperator === '-' && calcWaitingForOperand
                  ? 'bg-sky-600 border-sky-600 text-white'
                  : 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100'
              }`}
            >
              -
            </button>

            {['1', '2', '3'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => handleCalcDigit(d)}
                className="h-14 rounded-xl bg-white border border-slate-200 text-xl font-bold text-slate-800 hover:bg-slate-50 active:scale-95 transition-transform tabular-nums"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => handleCalcOperator('+')}
              className={`h-14 rounded-xl border text-2xl font-bold active:scale-95 transition-transform ${
                calcOperator === '+' && calcWaitingForOperand
                  ? 'bg-sky-600 border-sky-600 text-white'
                  : 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100'
              }`}
            >
              +
            </button>

            {['0', '00', '.'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => handleCalcDigit(d)}
                className="h-14 rounded-xl bg-white border border-slate-200 text-xl font-bold text-slate-800 hover:bg-slate-50 active:scale-95 transition-transform tabular-nums"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={handleCalcEquals}
              className="h-14 rounded-xl bg-emerald-600 text-2xl font-bold text-white hover:bg-emerald-700 active:scale-95 transition-transform"
            >
              =
            </button>
          </div>

          <button
            type="button"
            onClick={handleSendCalcToAdHoc}
            className="w-full rounded-xl bg-amber-500 py-3 text-sm font-bold text-white hover:bg-amber-600 transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="h-4 w-4" />
            <span>ส่งยอดเข้าคิดราคาด่วน</span>
          </button>
        </div>
      </Modal>

      {/* Checkout Modal */}
      <Modal
        open={checkoutOpen}
        onClose={() => {
          setCheckoutOpen(false);
          setSplitCashQrEnabled(false);
          setPointsToRedeem(0);
          setVipDiscountApplied(false);
          setCustomerSearchQuery('');
          if (selectedCustomerId === '__new__') {
            setSelectedCustomerId('');
            setNewCustContactNote('');
          }
        }}
        title="ชำระเงิน"
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-4">
          {/* Customer / Member & Loyalty Points */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <UserCheck className="h-4 w-4 text-emerald-600" />
                <span>ลูกค้า / สมาชิกสะสมแต้ม</span>
                {paymentMethod === 'credit' && (
                  <span className="text-rose-600">*จำเป็นสำหรับเงินเชื่อ</span>
                )}
              </label>
              {selectedCustomer && (
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {selectedCustomerVipPct > 0 && (
                    <span
                      title={`ส่วนลดประจำตัวลูกค้า VIP ${formatNumber(selectedCustomerVipPct)}%`}
                      className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-100 px-2.5 py-0.5 text-xs font-bold text-violet-800 tabular-nums"
                    >
                      👑 VIP ลด {formatNumber(selectedCustomerVipPct)}%
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-800 tabular-nums">
                    🏆 {formatNumber(selectedCustomerPoints)} แต้ม
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <input
                type="search"
                value={customerSearchQuery}
                onChange={(e) => setCustomerSearchQuery(e.target.value)}
                placeholder="พิมพ์ค้นหาชื่อ หรือเบอร์โทรลูกค้า..."
                aria-label="ค้นหาชื่อลูกค้าในหน้าชำระเงิน"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs focus:border-emerald-500 focus:outline-none"
              />
              <div className="flex items-center gap-2">
              <select
                aria-label="เลือกลูกค้าในหน้าชำระเงิน"
                value={selectedCustomerId}
                onChange={(e) => handleSelectCustomer(e.target.value)}
                className={`flex-1 min-w-0 rounded-xl border px-3 py-2 text-sm bg-white focus:outline-none ${
                  paymentMethod === 'credit' && !selectedCustomerId
                    ? 'border-amber-400 focus:border-amber-500'
                    : 'border-slate-300 focus:border-emerald-500'
                }`}
              >
                <option value="">-- ลูกค้าทั่วไป (ไม่ระบุสมาชิก) --</option>
                {customers
                  .filter((c) => {
                    const q = customerSearchQuery.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      c.name.toLowerCase().includes(q) ||
                      (c.phone ?? '').toLowerCase().includes(q) ||
                      c.id === selectedCustomerId
                    );
                  })
                  .map((c) => {
                  const vipPct = defaultDiscounts[c.id] ?? 0;
                  const dueInfo = getCustomerDueInfo(dueDates[c.id], todayIso, c.total_debt);
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name} (🏆 {formatNumber(loyaltyPoints[c.id] ?? 0)} แต้ม
                      {vipPct > 0 ? ` | 👑 VIP ลด ${formatNumber(vipPct)}%` : ''}
                      {c.total_debt > 0 ? ` | ค้าง ${formatBaht(c.total_debt)}` : ''}
                      {getCustomerDueSelectLabel(dueInfo)})
                    </option>
                  );
                })}
                <option value="__new__">+ เพิ่มลูกค้าใหม่ด่วน</option>
              </select>
              <button
                type="button"
                onClick={openQuickCustomerModal}
                className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                เพิ่มลูกค้าด่วน
              </button>
              </div>
            </div>

            {selectedCustomerId === '__new__' && (
              <div className="space-y-2 rounded-xl bg-white p-3 border border-slate-200">
                <input
                  type="text"
                  placeholder="ชื่อลูกค้า (จำเป็น)"
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="tel"
                  placeholder="เบอร์โทร (ไม่บังคับ)"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="ที่อยู่ / จุดสังเกตบ้าน / LINE (ไม่บังคับ)"
                  value={newCustContactNote}
                  onChange={(e) => setNewCustContactNote(e.target.value)}
                  className="w-full rounded-lg border border-teal-300 bg-teal-50/40 px-3 py-2 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                />
                <p className="text-[11px] text-emerald-700 font-medium tabular-nums">
                  บิลนี้จะได้รับ +{formatNumber(earnedPointsThisBill)} แต้มเข้าบัญชีลูกค้าใหม่ทันที
                </p>
              </div>
            )}

            {selectedCustomer && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <span className="font-bold text-slate-900 truncate">
                      {selectedCustomer.name}
                    </span>
                    {selectedCustomerTag && (
                      <span
                        title={`กลุ่มลูกค้า: ${selectedCustomerTag}`}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-purple-300 bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-800 break-words"
                      >
                        🏷️ {selectedCustomerTag}
                      </span>
                    )}
                    {Number(selectedCustomer.total_debt) > 0 && (
                      <button
                        type="button"
                        onClick={() => openQuickDebtModal(selectedCustomer.id)}
                        title={`รับชำระหนี้ให้ ${selectedCustomer.name} (ค้าง ${formatBaht(selectedCustomer.total_debt)})`}
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100 transition-colors shrink-0"
                      >
                        <Banknote className="h-3 w-3 text-emerald-600" />
                        <span>รับชำระหนี้</span>
                      </button>
                    )}
                    {selectedCustomerContactNote && (
                      <span
                        title={`ที่อยู่ / ช่องทางติดต่อ: ${selectedCustomerContactNote}`}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-teal-300 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-800 break-words"
                      >
                        🏠 {selectedCustomerContactNote}
                      </span>
                    )}
                    {selectedCustomerPaydayCycle && (
                      <span
                        title={`รอบจ่ายเงินประจำ: ${selectedCustomerPaydayCycle}`}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 break-words"
                      >
                        🗓️ รอบจ่าย: {selectedCustomerPaydayCycle}
                      </span>
                    )}
                    {selectedCustomerVipPct > 0 && (
                      <span
                        title={`ส่วนลดประจำตัวลูกค้า VIP ${formatNumber(selectedCustomerVipPct)}%`}
                        className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800 tabular-nums shrink-0"
                      >
                        👑 VIP ลด {formatNumber(selectedCustomerVipPct)}%
                      </span>
                    )}
                    {selectedCustomerStoreCredit > 0 && (
                      <span
                        title={`เงินฝากทอนคงเหลือ ${formatBaht(selectedCustomerStoreCredit)}`}
                        className="inline-flex items-center gap-1 rounded-full border border-teal-300 bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800 tabular-nums shrink-0"
                      >
                        💰 เงินฝากทอน: {formatBaht(selectedCustomerStoreCredit)}
                      </span>
                    )}
                    {renderCustomerCreditHealthBadge(selectedCustomerCreditHealth)}
                    {renderCustomerDueBadge(selectedCustomerDueInfo, selectedCustomer.total_debt)}
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800 tabular-nums shrink-0">
                    จะได้รับ +{formatNumber(earnedPointsThisBill)} แต้ม
                    <span className="font-normal text-emerald-700">(ทุก 25฿ = 1 แต้ม)</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-amber-900">
                  <div>
                    แต้มสะสมปัจจุบัน:{' '}
                    <strong className="text-amber-800 tabular-nums">
                      🏆 {formatNumber(selectedCustomerPoints)} แต้ม
                    </strong>
                  </div>
                  {(selectedCustomerDueInfo?.status === 'overdue' ||
                    selectedCustomerDueInfo?.status === 'due_today') && (
                    <span
                      className={`text-[11px] font-semibold tabular-nums ${
                        selectedCustomerDueInfo.status === 'overdue'
                          ? 'text-rose-700'
                          : 'text-orange-800'
                      }`}
                    >
                      ค้างเดิม {formatBaht(selectedCustomer.total_debt)} • นัดชำระ{' '}
                      {selectedCustomerDueInfo.formattedDate}
                    </span>
                  )}
                </div>

                {selectedCustomerLatestFollowup && (
                  <div className="flex items-start gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/90 px-2.5 py-1.5 text-xs text-indigo-900">
                    <span className="shrink-0">📝</span>
                    <div className="min-w-0 flex-1">
                      <span className="font-bold">ติดตามล่าสุด: </span>
                      <span className="break-words">{selectedCustomerLatestFollowup.text}</span>
                      {selectedCustomerLatestFollowup.createdAt && (
                        <span className="ml-1.5 text-[10px] text-indigo-600 tabular-nums">
                          ({formatDateTime(selectedCustomerLatestFollowup.createdAt)})
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {maxRedeemablePoints >= LOYALTY_POINTS_PER_DISCOUNT_BAHT ? (
                  <div className="space-y-1.5 pt-1 border-t border-amber-200/70">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleRedeemPoints(maxRedeemablePoints)}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors ${
                          pointsToRedeem === maxRedeemablePoints
                            ? 'bg-amber-600 text-white'
                            : 'bg-amber-500 text-white hover:bg-amber-600'
                        }`}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>
                          ใช้แต้มแลกส่วนลด (สูงสุด {formatNumber(maxRedeemablePoints)} แต้ม = ลด{' '}
                          {formatBaht(maxRedeemableBaht)})
                        </span>
                      </button>
                      {[10, 50, 100]
                        .filter((pts) => pts < maxRedeemablePoints)
                        .map((pts) => (
                          <button
                            key={pts}
                            type="button"
                            onClick={() => handleRedeemPoints(pts)}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors tabular-nums ${
                              pointsToRedeem === pts
                                ? 'bg-amber-600 text-white'
                                : 'bg-white border border-amber-300 text-amber-900 hover:bg-amber-100'
                            }`}
                          >
                            {pts} แต้ม (-{pts / LOYALTY_POINTS_PER_DISCOUNT_BAHT}฿)
                          </button>
                        ))}
                      {pointsToRedeem > 0 && (
                        <button
                          type="button"
                          onClick={handleClearRedeemedPoints}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
                        >
                          ยกเลิกใช้แต้ม
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-amber-800/90 tabular-nums">
                      อัตราแลก: 10 แต้ม = ส่วนลด 1 บาท
                      {pointsToRedeem > 0 && (
                        <span className="ml-1.5 font-bold text-emerald-700">
                          • กำลังใช้ {formatNumber(pointsToRedeem)} แต้ม (ลด{' '}
                          {formatBaht(pointsToRedeem / LOYALTY_POINTS_PER_DISCOUNT_BAHT)})
                        </span>
                      )}
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-amber-800/80 pt-1 border-t border-amber-200/70">
                    {selectedCustomerPoints < LOYALTY_POINTS_PER_DISCOUNT_BAHT
                      ? 'สะสมครบ 10 แต้มขึ้นไปเพื่อใช้แลกส่วนลด (10 แต้ม = 1 บาท)'
                      : 'ยอดบิลต้องอย่างน้อย 1 บาทเพื่อใช้แต้มแลกส่วนลด'}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Bill Discount Input */}
          <div className="rounded-xl bg-amber-50/60 border border-amber-200 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <label className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-amber-900">
                <Tag className="h-4 w-4 text-amber-600" />
                <span>ส่วนลดท้ายบิล (บาท)</span>
                {pointsToRedeem > 0 && (
                  <span className="rounded-md bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-900 tabular-nums">
                    ใช้ {formatNumber(pointsToRedeem)} แต้ม
                  </span>
                )}
                {appliedVipPct > 0 && (
                  <span className="rounded-md bg-violet-100 border border-violet-200 px-1.5 py-0.5 text-[10px] font-bold text-violet-800 tabular-nums">
                    👑 VIP ลด {formatNumber(appliedVipPct)}%
                  </span>
                )}
                {storeCreditToUse > 0 && (
                  <span className="rounded-md bg-teal-100 border border-teal-200 px-1.5 py-0.5 text-[10px] font-bold text-teal-800 tabular-nums">
                    💰 ใช้เงินฝากทอน {formatBaht(storeCreditToUse)}
                  </span>
                )}
              </label>
              <input
                type="number"
                min={0}
                max={cartTotal}
                step="0.5"
                value={billDiscount}
                onChange={(e) => handleDiscountChange(e.target.value)}
                placeholder="0"
                className="w-32 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-right text-base font-bold text-amber-900 tabular-nums focus:border-amber-500 focus:outline-none"
              />
            </div>
            {selectedCustomer && selectedCustomerVipPct > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={selectedCustomerVipDiscountAmount <= 0}
                  onClick={handleApplyVipDiscount}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40 tabular-nums ${
                    vipDiscountApplied &&
                    (Number(billDiscount) || 0) === selectedCustomerVipDiscountAmount
                      ? 'border-violet-600 bg-violet-600 text-white shadow-xs'
                      : 'border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100'
                  }`}
                >
                  <span>
                    {`ใช้สิทธิ์ VIP ลด ${formatNumber(selectedCustomerVipPct)}% (฿${formatNumber(selectedCustomerVipDiscountAmount)})`}
                  </span>
                </button>
                {vipDiscountApplied && (
                  <button
                    type="button"
                    onClick={() => handleDiscountChange('')}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
                  >
                    ยกเลิกส่วนลด VIP
                  </button>
                )}
              </div>
            )}
            {selectedCustomer && selectedCustomerStoreCredit > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={maxUsableStoreCredit <= 0}
                  onClick={handleApplyStoreCredit}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40 tabular-nums ${
                    storeCreditToUse > 0 &&
                    (Number(billDiscount) || 0) === storeCreditToUse
                      ? 'border-teal-600 bg-teal-600 text-white shadow-xs'
                      : 'border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100'
                  }`}
                >
                  <span>
                    {`ใช้เงินฝากทอนหักลดบิลนี้ (สูงสุด ${formatBaht(maxUsableStoreCredit)})`}
                  </span>
                </button>
                {storeCreditToUse > 0 && (
                  <button
                    type="button"
                    onClick={handleClearStoreCredit}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
                  >
                    ยกเลิกใช้เงินฝากทอน
                  </button>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {[0, 2, 5, 10, 20].map((disc) => (
                <button
                  key={disc}
                  type="button"
                  onClick={() => handleDiscountChange(disc === 0 ? '' : String(disc))}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                    (Number(billDiscount) || 0) === disc
                      ? 'bg-amber-600 text-white'
                      : 'bg-white border border-amber-200 text-amber-800 hover:bg-amber-100'
                  }`}
                >
                  {disc === 0 ? 'ไม่ลด' : `ลด ${disc}฿`}
                </button>
              ))}
              {[5, 10, 15].map((pct) => {
                const pctDiscount = Number(((cartTotal * pct) / 100).toFixed(2));
                const isActive =
                  pctDiscount > 0 && (Number(billDiscount) || 0) === pctDiscount;
                return (
                  <button
                    key={`pct-${pct}`}
                    type="button"
                    onClick={() =>
                      handleDiscountChange(pctDiscount === 0 ? '' : String(pctDiscount))
                    }
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                      isActive
                        ? 'bg-amber-600 text-white'
                        : 'bg-white border border-amber-200 text-amber-800 hover:bg-amber-100'
                    }`}
                  >
                    ลด {pct}%
                  </button>
                );
              })}
              {roundDownOptions.map((option) => {
                const isActive =
                  pointsToRedeem === 0 &&
                  !vipDiscountApplied &&
                  (Number(billDiscount) || 0) === option.discount;
                return (
                  <button
                    key={`round-${option.target}`}
                    type="button"
                    onClick={() => handleDiscountChange(String(option.discount))}
                    title={`ปัดเศษลงเหลือ ฿${formatNumber(option.target)} (ส่วนลด ฿${formatNumber(option.discount)})`}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors tabular-nums ${
                      isActive
                        ? 'bg-amber-600 text-white'
                        : 'bg-white border border-amber-200 text-amber-800 hover:bg-amber-100'
                    }`}
                  >
                    ปัดเศษลงเหลือ ฿{formatNumber(option.target)} (-฿
                    {formatNumber(option.discount)})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Net Total Box */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-1.5">
            {discountAmount > 0 && (
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>ยอดรวมก่อนลด {formatBaht(cartTotal)}</span>
                <span className="font-semibold text-rose-600">
                  {appliedVipPct > 0
                    ? `ส่วนลด VIP ${formatNumber(appliedVipPct)}% -${formatBaht(discountAmount)}`
                    : `ส่วนลด -${formatBaht(discountAmount)}`}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">ยอดสุทธิที่ต้องชำระ</span>
              <span className="text-2xl font-extrabold text-emerald-700 tabular-nums">
                {formatBaht(finalTotal)}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-200/80">
              <button
                type="button"
                onClick={() => setCustomerDisplayOpen(true)}
                className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-xs sm:text-sm font-bold text-sky-800 hover:bg-sky-100 transition-colors"
              >
                <Monitor className="h-4 w-4 shrink-0" />
                <span>จอแสดงยอดลูกค้า</span>
              </button>
            </div>
          </div>

          {/* Payment Method Tabs */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => selectPaymentMethod('cash')}
              className={`relative flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-bold transition-colors ${
                paymentMethod === 'cash'
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <kbd
                className={`absolute top-1.5 right-1.5 rounded border px-1 py-0.5 text-[10px] font-bold leading-none ${
                  paymentMethod === 'cash'
                    ? 'border-emerald-300 bg-white text-emerald-700'
                    : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}
              >
                F8
              </kbd>
              <Banknote className="h-5 w-5" />
              <span>เงินสด</span>
            </button>
            <button
              type="button"
              onClick={() => selectPaymentMethod('qr')}
              className={`relative flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-bold transition-colors ${
                paymentMethod === 'qr'
                  ? 'border-sky-600 bg-sky-50 text-sky-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <kbd
                className={`absolute top-1.5 right-1.5 rounded border px-1 py-0.5 text-[10px] font-bold leading-none ${
                  paymentMethod === 'qr'
                    ? 'border-sky-300 bg-white text-sky-700'
                    : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}
              >
                F9
              </kbd>
              <QrCode className="h-5 w-5" />
              <span>PromptPay QR</span>
            </button>
            <button
              type="button"
              onClick={() => selectPaymentMethod('credit')}
              className={`relative flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-bold transition-colors ${
                paymentMethod === 'credit'
                  ? 'border-amber-600 bg-amber-50 text-amber-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <kbd
                className={`absolute top-1.5 right-1.5 rounded border px-1 py-0.5 text-[10px] font-bold leading-none ${
                  paymentMethod === 'credit'
                    ? 'border-amber-300 bg-white text-amber-700'
                    : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}
              >
                F10
              </kbd>
              <UserCheck className="h-5 w-5" />
              <span>เงินเชื่อ</span>
            </button>
          </div>

          {/* Combined Sale + Old Debt Settlement */}
          {selectedCustomer &&
            selectedCustomerOldDebt > 0 &&
            (paymentMethod === 'cash' || paymentMethod === 'qr') && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="settle-old-debt-input"
                    className="flex items-center gap-1.5 text-xs font-bold text-indigo-900"
                  >
                    <Receipt className="h-4 w-4 text-indigo-600 shrink-0" />
                    <span>ชำระหนี้ค้างเดิมพร้อมบิลนี้ (ไม่บังคับ)</span>
                  </label>
                  <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-800 tabular-nums">
                    ค้างเดิม {formatBaht(selectedCustomerOldDebt)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-indigo-900">
                    ยอดชำระหนี้เดิมเพิ่ม (บาท)
                  </span>
                  <input
                    id="settle-old-debt-input"
                    type="number"
                    min={0}
                    max={selectedCustomerOldDebt}
                    step="0.5"
                    value={settleOldDebtInput}
                    onChange={(e) => setSettleOldDebtInput(e.target.value)}
                    placeholder="0"
                    className="w-36 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-right text-base font-bold text-indigo-900 tabular-nums focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSettleOldDebtInput('')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                      settleOldDebtAmount === 0
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white border border-indigo-200 text-indigo-800 hover:bg-indigo-100'
                    }`}
                  >
                    ไม่รวมหนี้เดิม
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettleOldDebtInput(String(halfOldDebtAmount))}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors tabular-nums ${
                      settleOldDebtAmount > 0 &&
                      settleOldDebtAmount === halfOldDebtAmount
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white border border-indigo-200 text-indigo-800 hover:bg-indigo-100'
                    }`}
                  >
                    เคลียร์ครึ่งหนึ่ง 50%
                  </button>
                  <button
                    type="button"
                    disabled={settleOldDebtFractionAmount <= 0}
                    onClick={() =>
                      setSettleOldDebtInput(String(settleOldDebtFractionAmount))
                    }
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors tabular-nums disabled:opacity-40 disabled:cursor-not-allowed ${
                      settleOldDebtAmount > 0 &&
                      settleOldDebtAmount === settleOldDebtFractionAmount
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white border border-indigo-200 text-indigo-800 hover:bg-indigo-100'
                    }`}
                  >
                    เคลียร์เฉพาะเศษบาท
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSettleOldDebtInput(String(selectedCustomerOldDebt))
                    }
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors tabular-nums ${
                      settleOldDebtAmount > 0 &&
                      settleOldDebtAmount === selectedCustomerOldDebt
                        ? 'bg-emerald-600 text-white'
                        : 'bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                    }`}
                  >
                    เคลียร์หนี้เดิมเต็มยอด (+฿{formatNumber(selectedCustomerOldDebt)})
                  </button>
                </div>

                {rawSettleOldDebtAmount > selectedCustomerOldDebt && (
                  <p className="text-[11px] font-semibold text-amber-700 tabular-nums">
                    ยอดที่กรอกเกินหนี้ค้างเดิม ระบบจะจำกัดยอดชำระหนี้เดิมที่{' '}
                    {formatBaht(selectedCustomerOldDebt)}
                  </p>
                )}

                {settleOldDebtAmount > 0 && (
                  <div className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs space-y-0.5 tabular-nums">
                    <div className="flex items-center justify-between text-indigo-900 font-bold">
                      <span>
                        ยอดซื้อบิลนี้ {formatBaht(finalTotal)} + ชำระหนี้เดิม{' '}
                        {formatBaht(settleOldDebtAmount)}
                      </span>
                      <span className="text-sm font-extrabold text-indigo-700">
                        รวมรับ {formatBaht(totalToCollectWithDebt)}
                      </span>
                    </div>
                    <p className="text-[11px] font-medium text-slate-600">
                      หนี้คงเหลือหลังชำระ:{' '}
                      <span className="font-bold text-slate-800">
                        {formatBaht(
                          Math.max(
                            0,
                            Number(
                              (selectedCustomerOldDebt - settleOldDebtAmount).toFixed(2)
                            )
                          )
                        )}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            )}

          {/* Cash UI */}
          {paymentMethod === 'cash' && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  รับเงินสดมา (บาท)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={cashReceived}
                  onChange={(e) => updateCashReceived(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-xl font-bold tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => updateCashReceived(String(totalToCollectWithDebt))}
                  className="rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-200"
                >
                  พอดี ({totalToCollectWithDebt})
                </button>
                {[20, 50, 100, 500, 1000].map((bill) => (
                  <button
                    key={bill}
                    type="button"
                    onClick={() => updateCashReceived(String(bill))}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
                  >
                    {bill}฿
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-500 mr-0.5">บวกเพิ่ม:</span>
                {[20, 50, 100, 500, 1000].map((addAmount) => (
                  <button
                    key={addAmount}
                    type="button"
                    onClick={() =>
                      updateCashReceived(
                        String(Number(((Number(cashReceived) || 0) + addAmount).toFixed(2)))
                      )
                    }
                    className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition-colors tabular-nums"
                  >
                    +{addAmount.toLocaleString('en-US')}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => updateCashReceived('0')}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100 transition-colors"
                >
                  ล้าง (0)
                </button>
              </div>
              {isCashShort ? (
                <div className="space-y-2.5">
                  <div className="rounded-xl bg-amber-50 border border-amber-300 px-4 py-3 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-bold text-amber-800 tabular-nums">
                      <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                      ยังขาดอีก ฿{formatNumber(cashShortfall)}
                    </span>
                    <span className="text-xs font-medium text-amber-700 tabular-nums">
                      รับแล้ว {formatBaht(cashReceivedNum)} / {formatBaht(totalToCollectWithDebt)}
                    </span>
                  </div>

                  <button
                    type="button"
                    aria-pressed={isSplitCashQr}
                    onClick={() => setSplitCashQrEnabled((prev) => !prev)}
                    className={`w-full flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs sm:text-sm font-bold transition-colors tabular-nums ${
                      isSplitCashQr
                        ? 'border-sky-600 bg-sky-600 text-white shadow-xs'
                        : 'border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-left">
                      <QrCode className="h-4 w-4 shrink-0" />
                      <span>
                        โอนส่วนที่เหลือ ฿{formatNumber(splitQrAmount)} ด้วย PromptPay QR (แยกจ่าย เงินสด + QR)
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        isSplitCashQr
                          ? 'bg-white text-sky-700'
                          : 'bg-sky-200/70 text-sky-900'
                      }`}
                    >
                      {isSplitCashQr ? 'เปิดอยู่' : 'เปิดโหมด'}
                    </span>
                  </button>

                  {isSplitCashQr && (
                    <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3.5 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2">
                          <p className="text-[11px] font-medium text-slate-500">
                            เงินสดที่รับ
                          </p>
                          <p className="text-base font-extrabold text-emerald-700 tabular-nums">
                            ฿{formatNumber(cashReceivedNum)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-sky-200 bg-white px-3 py-2">
                          <p className="text-[11px] font-medium text-slate-500">
                            โอน QR ส่วนที่เหลือ
                          </p>
                          <p className="text-base font-extrabold text-sky-700 tabular-nums">
                            ฿{formatNumber(splitQrAmount)}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col items-center text-center space-y-1.5">
                        {qrDataUrl ? (
                          <>
                            <img
                              src={qrDataUrl}
                              alt="PromptPay QR Code ส่วนที่เหลือ"
                              className="w-48 h-48 rounded-xl border border-slate-200 p-2 bg-white"
                            />
                            <p className="text-xs font-bold text-sky-800 tabular-nums">
                              สแกนโอนส่วนที่เหลือ: ฿{formatNumber(splitQrAmount)}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              พร้อมเพย์: {settings?.promptpay_id}
                            </p>
                          </>
                        ) : (
                          <div className="w-full rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                            ยังไม่ได้ตั้งค่าเบอร์/เลข PromptPay กรุณาไปตั้งค่าที่หน้า &quot;สรุปยอด &amp; ตั้งค่า&quot;
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : isCashZeroShort || cashShortfall > 0 ? (
                <div className="rounded-xl bg-amber-50 border border-amber-300 px-4 py-3 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-bold text-amber-800 tabular-nums">
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                    ยังขาดอีก ฿{formatNumber(cashShortfall)}
                  </span>
                  <span className="text-xs font-medium text-amber-700 tabular-nums">
                    รับแล้ว {formatBaht(cashReceivedNum)} / {formatBaht(finalTotal)}
                  </span>
                </div>
              ) : (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-emerald-800">เงินทอน</span>
                    <span className="text-xl font-extrabold text-emerald-700 tabular-nums">
                      {formatBaht(cashChange)}
                    </span>
                  </div>
                  {cashChange > 0 && renderChangeBreakdownBar(cashChange, 'checkout')}
                  {(selectedCustomer || selectedCustomerId === '__new__') &&
                    paymentMethod === 'cash' &&
                    cashChange > 0 && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={depositChangeToCredit}
                        onClick={() => setDepositChangeToCredit((prev) => !prev)}
                        className={`w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
                          depositChangeToCredit
                            ? 'border-teal-600 bg-teal-600 text-white shadow-xs'
                            : 'border-teal-300 bg-white text-teal-800 hover:bg-teal-50'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 tabular-nums">
                          <span>💰</span>
                          <span>
                            ฝากเงินทอน {formatBaht(cashChange)} ไว้เป็นเครดิตรอบหน้า
                          </span>
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            depositChangeToCredit
                              ? 'bg-white text-teal-700'
                              : 'bg-teal-100 text-teal-700'
                          }`}
                        >
                          {depositChangeToCredit ? 'เปิดใช้งาน' : 'กดเพื่อฝาก'}
                        </span>
                      </button>
                    )}
                </div>
              )}
            </div>
          )}

          {/* QR UI */}
          {paymentMethod === 'qr' && (
            <div className="space-y-3">
              {/* Split Cash + QR Helper */}
              <div className="rounded-xl bg-sky-50/70 border border-sky-200 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-sky-900">
                    <Banknote className="h-4 w-4 text-sky-600" />
                    <span>จ่ายเงินสดบางส่วน (บาท)</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={totalToCollectWithDebt}
                    step="0.5"
                    value={partialCash}
                    onChange={(e) => setPartialCash(e.target.value)}
                    placeholder="0"
                    className="w-32 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-right text-base font-bold text-sky-900 tabular-nums focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPartialCash('0')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                      partialCashAmount === 0
                        ? 'bg-sky-600 text-white'
                        : 'bg-white border border-sky-200 text-sky-800 hover:bg-sky-100'
                    }`}
                  >
                    สแกนเต็มจำนวน (0฿)
                  </button>
                  {[20, 40, 50, 100]
                    .filter((amt) => amt < totalToCollectWithDebt)
                    .map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setPartialCash(String(amt))}
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                          partialCashAmount === amt
                            ? 'bg-sky-600 text-white'
                            : 'bg-white border border-sky-200 text-sky-800 hover:bg-sky-100'
                        }`}
                      >
                        สด {amt}฿
                      </button>
                    ))}
                </div>
                {partialCashAmount > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-white border border-sky-200 px-3 py-2 text-xs">
                    <span className="font-semibold text-emerald-700">
                      รับเงินสด: {formatBaht(partialCashAmount)}
                    </span>
                    <span className="font-bold text-sky-700">
                      คงเหลือสแกน QR: {formatBaht(qrPayAmount)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center text-center space-y-2 py-1">
                {qrDataUrl ? (
                  <>
                    <img
                      src={qrDataUrl}
                      alt="PromptPay QR Code"
                      className="w-56 h-56 rounded-xl border border-slate-200 p-2 bg-white"
                    />
                    <p className="text-xs font-semibold text-sky-700">
                      ยอดสแกนชำระสุทธิ: {formatBaht(qrPayAmount)}
                      {settleOldDebtAmount > 0
                        ? ` (รวมชำระหนี้เดิม ${formatBaht(settleOldDebtAmount)})`
                        : ''}
                      {partialCashAmount > 0
                        ? ` (หักเงินสด ${formatBaht(partialCashAmount)})`
                        : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      พร้อมเพย์: {settings?.promptpay_id}
                    </p>
                  </>
                ) : qrPayAmount <= 0 ? (
                  <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800">
                    {partialCashAmount > 0
                      ? `รับเงินสดครบ ${formatBaht(partialCashAmount)} แล้ว ไม่มียอดที่ต้องสแกน QR เพิ่ม`
                      : 'ยอดชำระสุทธิเป็น 0 บาท สามารถกดยืนยันบันทึกบิลได้ทันที'}
                  </div>
                ) : (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
                    ยังไม่ได้ตั้งค่าเบอร์/เลข PromptPay กรุณาไปตั้งค่าที่หน้า &quot;สรุปยอด &amp; ตั้งค่า&quot;
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Credit UI */}
          {paymentMethod === 'credit' && (
            <div className="space-y-3">
              {!selectedCustomerId ? (
                <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>กรุณาเลือกลูกค้าด้านบนสำหรับบิลเงินเชื่อ</span>
                </div>
              ) : selectedCustomer ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-xs text-amber-900 space-y-1 tabular-nums">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">ลูกค้าเงินเชื่อ: {selectedCustomer.name}</span>
                    <span className="font-bold">
                      ค้างเดิม {formatBaht(selectedCustomer.total_debt)}
                    </span>
                  </div>
                  {creditDownPayment > 0 && (
                    <div className="flex items-center justify-between text-emerald-800">
                      <span>บิลนี้ค้างเพิ่มสุทธิ (หักจ่ายสด ฿{formatNumber(creditDownPayment)})</span>
                      <span className="font-bold">+{formatBaht(netCreditAmount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-amber-800">
                    <span>ค้างรวมหลังบิลนี้</span>
                    <span className="font-extrabold">{formatBaht(projectedCustomerDebt)}</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800 space-y-1 tabular-nums">
                  <p>
                    จะบันทึกบิลเงินเชื่อให้ลูกค้าใหม่: {newCustName.trim() || '(กรุณากรอกชื่อด้านบน)'}
                  </p>
                  {creditDownPayment > 0 && (
                    <p className="font-bold text-emerald-900">
                      ยอดบิล {formatBaht(finalTotal)} • จ่ายสดวันนี้ ฿{formatNumber(creditDownPayment)} • ค้างเชื่อสุทธิ ฿{formatNumber(netCreditAmount)}
                    </p>
                  )}
                </div>
              )}

              {selectedCustomerId && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <label
                      htmlFor="credit-down-payment-input"
                      className="flex items-center gap-1.5 text-xs font-bold text-amber-900"
                    >
                      <Banknote className="h-4 w-4 text-amber-600 shrink-0" />
                      <span>จ่ายเงินสดบางส่วนวันนี้ (บาท, ไม่บังคับ)</span>
                    </label>
                    <input
                      id="credit-down-payment-input"
                      type="number"
                      min={0}
                      max={finalTotal}
                      step="0.5"
                      value={creditDownPaymentInput}
                      onChange={(e) => setCreditDownPaymentInput(e.target.value)}
                      placeholder="0"
                      className="w-32 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-right text-base font-bold text-amber-900 tabular-nums focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[20, 50, 100].map((amt) => {
                      const disabled = finalTotal <= amt;
                      const active = !disabled && creditDownPayment === amt;
                      return (
                        <button
                          key={amt}
                          type="button"
                          disabled={disabled}
                          onClick={() => setCreditDownPaymentInput(String(amt))}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors tabular-nums disabled:opacity-40 disabled:cursor-not-allowed ${
                            active
                              ? 'bg-amber-600 text-white'
                              : 'bg-white border border-amber-200 text-amber-900 hover:bg-amber-100'
                          }`}
                        >
                          ฿{amt}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      disabled={halfCreditDownPayment <= 0}
                      onClick={() =>
                        setCreditDownPaymentInput(String(halfCreditDownPayment))
                      }
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors tabular-nums disabled:opacity-40 disabled:cursor-not-allowed ${
                        halfCreditDownPayment > 0 &&
                        creditDownPayment === halfCreditDownPayment
                          ? 'bg-amber-600 text-white'
                          : 'bg-white border border-amber-200 text-amber-900 hover:bg-amber-100'
                      }`}
                    >
                      จ่ายครึ่งหนึ่ง 50%
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreditDownPaymentInput('')}
                      className="rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                    >
                      ล้างค่า
                    </button>
                  </div>
                  {creditDownPayment > 0 && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900 tabular-nums">
                      จ่ายสดวันนี้ ฿{formatNumber(creditDownPayment)} • คงเหลือค้างเชื่อสุทธิ ฿{formatNumber(netCreditAmount)}
                    </div>
                  )}
                  {isCreditDownPaymentInvalid && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800"
                    >
                      <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                      <span>
                        ยอดจ่ายสดบางส่วนต้องน้อยกว่ายอดรวมสุทธิ ({formatBaht(finalTotal)}) — หากจ่ายเต็มจำนวน กรุณาเลือกวิธีชำระเงินสด
                      </span>
                    </div>
                  )}
                </div>
              )}

              {selectedCustomer && (
                <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="checkout-credit-due-date-input"
                      className="text-xs font-bold text-sky-950"
                    >
                      กำหนดวันนัดชำระหนี้ (ไม่บังคับ)
                    </label>
                    {selectedCustomerPaydayCycle ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">
                        🗓️ รอบจ่าย: {selectedCustomerPaydayCycle}
                      </span>
                    ) : creditDueDateInput ? (
                      <span className="text-[11px] font-semibold text-sky-800 tabular-nums">
                        {formatExpiryDateTh(creditDueDateInput)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id="checkout-credit-due-date-input"
                      type="date"
                      value={creditDueDateInput}
                      onChange={(e) => setCreditDueDateInput(e.target.value)}
                      className="flex-1 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 tabular-nums focus:border-sky-500 focus:outline-none"
                    />
                    {creditDueDateInput && (
                      <button
                        type="button"
                        onClick={() => setCreditDueDateInput('')}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                      >
                        ล้างวันนัด
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCreditDueDateInput(addLocalDaysIso(new Date(), 3))}
                      className="rounded-lg border border-sky-200 bg-white px-2.5 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100 transition-colors"
                    >
                      +3 วัน
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreditDueDateInput(addLocalDaysIso(new Date(), 7))}
                      className="rounded-lg border border-sky-200 bg-white px-2.5 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100 transition-colors"
                    >
                      +7 วัน
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreditDueDateInput(addLocalDaysIso(new Date(), 15))}
                      className="rounded-lg border border-sky-200 bg-white px-2.5 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100 transition-colors"
                    >
                      +15 วัน
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreditDueDateInput(endOfMonthIso(new Date()))}
                      className="rounded-lg border border-sky-200 bg-white px-2.5 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100 transition-colors"
                    >
                      สิ้นเดือนนี้
                    </button>
                    {selectedCustomerPaydayCycle && (
                      <button
                        type="button"
                        title={`คำนวณวันนัดชำระถัดไปจากรอบจ่าย: ${selectedCustomerPaydayCycle}`}
                        onClick={() =>
                          setCreditDueDateInput(
                            computeNextPaydayDueDateIso(new Date(), selectedCustomerPaydayCycle)
                          )
                        }
                        className="rounded-lg border border-indigo-300 bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-indigo-700 transition-colors"
                      >
                        ตั้งตามรอบจ่ายประจำ
                      </button>
                    )}
                  </div>
                </div>
              )}

              {selectedCustomerDueInfo?.status === 'overdue' && selectedCustomer && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl border-2 border-rose-400 bg-rose-50 px-3.5 py-2.5 text-rose-800"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                  <div className="text-xs leading-relaxed">
                    <p className="font-bold text-rose-900">
                      ⚠️ เตือน: ลูกค้ามียอดค้างเดิมที่เลยกำหนดชำระแล้ว (
                      {formatBaht(selectedCustomer.total_debt)})
                    </p>
                    <p className="text-rose-700 mt-0.5 tabular-nums">
                      วันนัดชำระ: {selectedCustomerDueInfo.formattedDate}
                      {selectedCustomerDueInfo.daysDiff < 0
                        ? ` (เลยกำหนด ${formatNumber(Math.abs(selectedCustomerDueInfo.daysDiff))} วัน)`
                        : ''}{' '}
                      — ยังสามารถกดยืนยันขายได้ตามดุลยพินิจเจ้าของร้าน
                    </p>
                  </div>
                </div>
              )}

              {isOverCreditLimit && selectedCustomer && (
                <div className="flex items-start gap-2.5 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-rose-800">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                  <div className="text-xs leading-relaxed">
                    <p className="font-bold text-rose-900">
                      เตือน: ยอดค้างหลังบิลนี้ {formatBaht(projectedCustomerDebt)} เกินวงเงินที่ตั้งไว้{' '}
                      {formatBaht(selectedCustomerCreditLimit)}
                    </p>
                    <p className="text-rose-700 mt-0.5">
                      ค้างเดิม {formatBaht(selectedCustomer.total_debt)} +{' '}
                      {creditDownPayment > 0
                        ? `ค้างเชื่อสุทธิบิลนี้ ${formatBaht(netCreditAmount)}`
                        : `บิลนี้ ${formatBaht(finalTotal)}`}{' '}
                      (เกิน {formatBaht(projectedCustomerDebt - selectedCustomerCreditLimit)}) — ยังสามารถกดยืนยันขายได้ตามดุลยพินิจ
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Per-item notes summary preview */}
          {cartItemNotesSummary && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2 text-xs text-amber-900">
              <span className="font-bold">โน้ตรายสินค้าที่จะบันทึกอัตโนมัติ:</span>{' '}
              <span>{cartItemNotesSummary.replace(/^โน้ตรายสินค้า:\s*/, '')}</span>
            </div>
          )}

          {/* Order Note */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              หมายเหตุบิล (ถ้ามี)
            </label>
            <input
              type="text"
              value={orderNote}
              onChange={(e) => setOrderNote(e.target.value)}
              placeholder="เช่น ฝากหน้าบ้าน, แยกถุง..."
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm bg-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <button
            type="button"
            disabled={submitting || isCashPaymentBlocked || isCreditDownPaymentInvalid}
            onClick={handleCompleteSale}
            className="w-full rounded-xl bg-emerald-600 py-3.5 text-base font-bold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting
              ? 'กำลังบันทึก...'
              : isSplitCashQr
              ? `ยืนยันแยกจ่าย (สด ฿${formatNumber(cashReceivedNum)} + QR ฿${formatNumber(splitQrAmount)})`
              : isCashPaymentBlocked
              ? `เงินสดไม่พอ (ขาดอีก ฿${formatNumber(cashShortfall)})`
              : isCreditDownPaymentInvalid
              ? `ยอดจ่ายสดต้องน้อยกว่ายอดสุทธิ (฿${formatNumber(finalTotal)})`
              : paymentMethod === 'credit' && creditDownPayment > 0
              ? `ยืนยันขายเชื่อ (จ่ายสด ฿${formatNumber(creditDownPayment)} • ค้าง ฿${formatNumber(netCreditAmount)})`
              : settleOldDebtAmount > 0
              ? `ยืนยันรับเงิน ฿${formatNumber(totalToCollectWithDebt)} (บิลนี้ + ชำระหนี้เดิม)`
              : 'ยืนยันรับเงิน / บันทึกบิล'}
          </button>
        </div>
      </Modal>

      {/* Quick Add Customer Modal */}
      <Modal
        open={quickCustomerModalOpen}
        onClose={() => {
          if (!savingQuickCustomer) setQuickCustomerModalOpen(false);
        }}
        title="เพิ่มลูกค้าด่วน"
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={handleSaveQuickCustomer} className="space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              ชื่อลูกค้า <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={quickCustName}
              onChange={(e) => setQuickCustName(e.target.value)}
              placeholder="เช่น ป้าแดง ซอย 3"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              เบอร์โทร (ไม่บังคับ)
            </label>
            <input
              type="tel"
              value={quickCustPhone}
              onChange={(e) => setQuickCustPhone(e.target.value)}
              placeholder="เช่น 081-234-5678"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              ที่อยู่ / จุดสังเกตบ้าน / LINE (ไม่บังคับ)
            </label>
            <input
              type="text"
              value={quickCustContactNote}
              onChange={(e) => setQuickCustContactNote(e.target.value)}
              placeholder="เช่น ซอย 3 บ้านรั้วเขียว, LINE: @somchai"
              className="w-full rounded-xl border border-teal-300 bg-teal-50/40 px-3.5 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              หมายเหตุ (ไม่บังคับ)
            </label>
            <input
              type="text"
              value={quickCustNote}
              onChange={(e) => setQuickCustNote(e.target.value)}
              placeholder="เช่น บ้านตรงข้ามร้าน, จ่ายสิ้นเดือน"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={savingQuickCustomer}
              onClick={() => setQuickCustomerModalOpen(false)}
              className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={savingQuickCustomer}
              className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              {savingQuickCustomer ? 'กำลังบันทึก...' : 'บันทึกลูกค้า'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Hold / Park Bill Modal */}
      <Modal
        open={holdModalOpen}
        onClose={() => setHoldModalOpen(false)}
        title="พักบิลไว้ชั่วคราว"
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={handleConfirmHoldBill} className="space-y-4">
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-center justify-between">
            <span>รายการในตะกร้า ({cartCount} ชิ้น)</span>
            <span className="font-bold text-sm tabular-nums">{formatBaht(cartTotal)}</span>
          </div>
          {selectedCustomer && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800 space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold truncate">ลูกค้า: {selectedCustomer.name}</span>
                <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 shrink-0">
                  อ้างอิงอัตโนมัติ
                </span>
              </div>
              <p className="text-[11px] text-emerald-700">
                หากไม่ได้กรอกหมายเหตุ จะใช้ชื่อลูกค้าเป็นชื่ออ้างอิงบิลพักโดยอัตโนมัติ
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">
              ประเภทบิลพัก / คิวออเดอร์
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {HELD_BILL_ORDER_TYPE_OPTIONS.map((opt) => {
                const isSelected = holdOrderTypeInput === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => handleSelectHoldOrderType(opt.value)}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                      isSelected
                        ? 'border-amber-500 bg-amber-500 text-white shadow-xs'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          {(holdOrderTypeInput === 'pickup' || holdOrderTypeInput === 'delivery') && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                เวลานัดรับ / ที่อยู่จัดส่ง / เบอร์ติดต่อ
              </label>
              <input
                type="text"
                value={holdDeliveryInfoInput}
                onChange={(e) => setHoldDeliveryInfoInput(e.target.value)}
                placeholder={
                  holdOrderTypeInput === 'pickup'
                    ? 'เช่น รับ 17:30 น. / คุณสมชาย 081-xxx-xxxx'
                    : 'เช่น ซอย 3 บ้านสีฟ้า / คุณสมหญิง 089-xxx-xxxx'
                }
                className="w-full rounded-xl border border-sky-300 bg-sky-50/40 px-3.5 py-2.5 text-sm focus:border-sky-500 focus:bg-white focus:outline-none"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              หมายเหตุ / ชื่อลูกค้า (ไม่บังคับ)
            </label>
            <input
              type="text"
              autoFocus
              value={holdNoteInput}
              onChange={(e) => setHoldNoteInput(e.target.value)}
              placeholder={
                selectedCustomer
                  ? `ปล่อยว่างเพื่อใช้ชื่อ "${selectedCustomer.name}"...`
                  : 'เช่น ป้าแดง รอหยิบของเพิ่ม...'
              }
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-600 flex items-center gap-1">
              <Tag className="h-3.5 w-3.5 text-amber-600" />
              <span>ป้ายกำกับด่วน (คลิกเดียว)</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_HELD_BILL_TAGS.map((tag) => {
                const isActive = holdTagInput === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setHoldTagInput((prev) => (prev === tag ? '' : tag))}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      isActive
                        ? 'border-amber-500 bg-amber-500 text-white shadow-xs'
                        : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                    }`}
                  >
                    <Tag className="h-3 w-3" />
                    <span>{tag}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-slate-500">ข้อความหมายเหตุแนะนำ</p>
            <div className="flex flex-wrap gap-1.5">
              {['ลูกค้าไปหยิบของเพิ่ม', 'รอถามราคา', 'ลืมกระเป๋าสตางค์'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setHoldNoteInput(preset)}
                  className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-amber-600 py-3 text-sm font-bold text-white hover:bg-amber-700 transition-colors"
          >
            ยืนยันพักบิล
          </button>
          {cart.length > 0 && heldBills.length > 0 && (
            <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
              <p className="text-xs font-bold text-indigo-900">
                หรือรวมเข้าบิลที่พักไว้อยู่แล้ว ({heldBills.length} บิล)
              </p>
              <div className="max-h-40 space-y-1.5 overflow-y-auto pr-0.5">
                {heldBills.map((bill, idx) => {
                  const billLabel =
                    bill.note ||
                    bill.customerName ||
                    bill.tag ||
                    `บิลพัก #${heldBills.length - idx}`;
                  return (
                    <div
                      key={bill.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-indigo-200/80 bg-white px-2.5 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-slate-800">{billLabel}</p>
                        <p className="text-[11px] text-slate-500 tabular-nums">
                          {bill.count} ชิ้น • {formatBaht(bill.total)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleMergeCartIntoHeldBill(bill.id)}
                        className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-700 transition-colors"
                      >
                        ➕ รวมตะกร้าปัจจุบันเข้าบิลพักนี้
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </form>
      </Modal>

      {/* Save Quick Bundle / Combo Modal */}
      <Modal
        open={saveBundleModalOpen}
        onClose={() => setSaveBundleModalOpen(false)}
        title="บันทึกเป็นชุดขายด่วน"
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={handleConfirmSaveBundle} className="space-y-4">
          <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-3 text-xs text-indigo-900 flex items-center justify-between">
            <span>สินค้าในชุด ({bundleDraftItems.length} รายการ)</span>
            <span className="font-bold text-sm tabular-nums">
              {formatBaht(
                bundleDraftItems.reduce(
                  (sum, item) => sum + item.unit_price * item.qty,
                  0
                )
              )}
            </span>
          </div>

          <div>
            <label
              htmlFor="pos-bundle-name-input"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              ชื่อชุดสินค้าขายด่วน <span className="text-rose-500">*</span>
            </label>
            <input
              id="pos-bundle-name-input"
              type="text"
              required
              autoFocus
              value={bundleNameInput}
              onChange={(e) => setBundleNameInput(e.target.value)}
              placeholder="เช่น ชุดต้มยำ, ชุดใส่บาตร, ชุดมาม่า+ไข่"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-600">รายการสินค้าที่จะบันทึก</p>
            <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 bg-slate-50/60">
              {bundleDraftItems.map((item) => (
                <div
                  key={`${item.product_id}_${item.unit_id ?? 'default'}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                >
                  <span className="font-medium text-slate-800 truncate">
                    {item.product_name}
                  </span>
                  <span className="text-slate-600 tabular-nums shrink-0">
                    {formatNumber(item.qty)} {item.unit_name}
                  </span>
                </div>
              ))}
            </div>
            {cart.some((item) => !item.product_id) && (
              <p className="text-[11px] text-amber-700">
                * รายการคิดราคาด่วนที่ไม่มีรหัสสินค้าจะไม่ถูกรวมในชุดขายด่วน
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setSaveBundleModalOpen(false)}
              className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={!bundleNameInput.trim() || bundleDraftItems.length === 0}
              className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              บันทึกชุดขายด่วน
            </button>
          </div>
        </form>
      </Modal>

      {/* Held Bills List Modal */}
      <Modal
        open={heldBillsOpen}
        onClose={() => {
          setHeldBillsOpen(false);
          setConfirmClearHeldBills(false);
          setHeldBillsFilter('all');
        }}
        title={`บิลที่พักไว้ (${heldBills.length})`}
        maxWidthClass="max-w-lg"
      >
        {heldBills.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-500">
            ยังไม่มีบิลที่พักไว้ในขณะนี้
          </div>
        ) : (
          <div className="space-y-3">
            {heldBills.length > 1 && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2">
                <span className="text-xs font-medium text-rose-800">
                  มีบิลที่พักไว้ {heldBills.length} บิล
                </span>
                {confirmClearHeldBills ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmClearHeldBills(false)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      onClick={handleClearAllHeldBills}
                      className="flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-rose-700 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>ยืนยันล้างทั้งหมด</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearHeldBills(true)}
                    className="flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>ล้างทั้งหมด</span>
                  </button>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { value: 'all', label: 'ทั้งหมด' },
                  ...HELD_BILL_ORDER_TYPE_OPTIONS.map((opt) => ({
                    value: opt.value,
                    label: opt.shortLabel,
                  })),
                ] as const
              ).map((tab) => {
                const count =
                  tab.value === 'all'
                    ? heldBills.length
                    : heldBills.filter((b) => (b.orderType ?? 'walk_in') === tab.value).length;
                const isActive = heldBillsFilter === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setHeldBillsFilter(tab.value)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      isActive
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {tab.label} ({count})
                  </button>
                );
              })}
            </div>
            {(() => {
              const filteredBills =
                heldBillsFilter === 'all'
                  ? heldBills
                  : heldBills.filter((b) => (b.orderType ?? 'walk_in') === heldBillsFilter);
              if (filteredBills.length === 0) {
                return (
                  <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center space-y-2">
                    <p className="text-sm text-slate-500">ไม่พบบิลพักในหมวดหมู่นี้</p>
                    <button
                      type="button"
                      onClick={() => setHeldBillsFilter('all')}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      แสดงทั้งหมด
                    </button>
                  </div>
                );
              }
              return (
                <div className="space-y-3 max-h-[65dvh] overflow-y-auto pr-1">
                  {filteredBills.map((bill, idx) => {
                    const orderTypeMeta = getHeldBillOrderTypeMeta(bill.orderType);
                    const isCopied = copiedHeldBillId === bill.id;
                    return (
                      <div
                        key={bill.id}
                        className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5 shadow-2xs"
                      >
                        <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="rounded-md bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-800">
                                บิลพัก #{filteredBills.length - idx}
                              </span>
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${orderTypeMeta.badgeClass}`}
                              >
                                {orderTypeMeta.badgeText}
                              </span>
                              {bill.orderType === 'delivery' && (
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                                    bill.deliveryStatus === 'out_for_delivery'
                                      ? 'border-indigo-300 bg-indigo-100 text-indigo-800'
                                      : 'border-amber-200 bg-amber-50 text-amber-800'
                                  }`}
                                >
                                  {bill.deliveryStatus === 'out_for_delivery'
                                    ? '🛵 กำลังออกไปส่ง'
                                    : '🏠 รอจัดส่ง'}
                                </span>
                              )}
                              {bill.orderType === 'delivery' && bill.riderName && (
                                <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-800">
                                  ผู้ส่ง: {bill.riderName}
                                </span>
                              )}
                              <span className="text-xs text-slate-500 tabular-nums">
                                เวลา {formatTime(bill.createdAt)} น.
                              </span>
                              {bill.tag && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                                  <Tag className="h-3 w-3" />
                                  <span>{bill.tag}</span>
                                </span>
                              )}
                            </div>
                            {bill.note && (
                              <p className="text-sm font-bold text-slate-900 mt-1">
                                หมายเหตุ: {bill.note}
                              </p>
                            )}
                            {bill.customerName && bill.customerName !== bill.note && (
                              <p className="text-xs font-medium text-emerald-700 mt-0.5">
                                ลูกค้า: {bill.customerName}
                              </p>
                            )}
                            {bill.deliveryInfo && (
                              <p className="mt-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-900">
                                📍 นัดรับ/จัดส่ง: {bill.deliveryInfo}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-base font-extrabold text-emerald-700 tabular-nums">
                              {formatBaht(bill.total)}
                            </p>
                            <p className="text-[11px] text-slate-500">{bill.count} ชิ้น</p>
                          </div>
                        </div>

                        <div className="space-y-1 text-xs text-slate-600">
                          {bill.items.slice(0, 3).map((item) => {
                            const heldItemNote = bill.itemNotes?.[item.key]?.trim();
                            return (
                              <div key={item.key} className="space-y-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">
                                    • {item.product_name}{' '}
                                    <span className="text-slate-400">
                                      ({item.qty} {item.unit_name})
                                    </span>
                                  </span>
                                  <span className="font-semibold text-slate-800 tabular-nums shrink-0">
                                    {formatBaht(item.unit_price * item.qty)}
                                  </span>
                                </div>
                                {heldItemNote && (
                                  <p className="pl-3 text-[11px] font-medium text-amber-800 truncate">
                                    ↳ โน้ต: {heldItemNote}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                          {bill.items.length > 3 && (
                            <p className="text-[11px] font-medium text-slate-400 pt-0.5">
                              + อีก {bill.items.length - 3} รายการ
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-[11px] font-medium text-slate-500 mr-0.5">
                            ป้ายกำกับด่วน:
                          </span>
                          {QUICK_HELD_BILL_TAGS.map((tag) => {
                            const isTagged = bill.tag === tag;
                            return (
                              <button
                                key={tag}
                                type="button"
                                aria-pressed={isTagged}
                                onClick={() => handleToggleHeldBillTag(bill.id, tag)}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                                  isTagged
                                    ? 'border-amber-500 bg-amber-500 text-white'
                                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800'
                                }`}
                              >
                                <Tag className="h-2.5 w-2.5" />
                                <span>{tag}</span>
                              </button>
                            );
                          })}
                        </div>

                        {bill.orderType === 'delivery' && (
                          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2">
                            <button
                              type="button"
                              aria-pressed={bill.deliveryStatus === 'out_for_delivery'}
                              onClick={() => handleToggleHeldBillDeliveryStatus(bill.id)}
                              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                                bill.deliveryStatus === 'out_for_delivery'
                                  ? 'border-indigo-500 bg-indigo-600 text-white hover:bg-indigo-700'
                                  : 'border-amber-300 bg-white text-amber-800 hover:bg-amber-50'
                              }`}
                            >
                              <span>
                                {bill.deliveryStatus === 'out_for_delivery'
                                  ? '🛵 กำลังออกไปส่ง'
                                  : '🏠 รอจัดส่ง'}
                              </span>
                            </button>
                            <span className="text-[11px] font-medium text-slate-600 ml-1">
                              ผู้ส่ง:
                            </span>
                            {QUICK_DELIVERY_RIDERS.map((rider) => {
                              const isSelected = bill.riderName === rider;
                              return (
                                <button
                                  key={rider}
                                  type="button"
                                  aria-pressed={isSelected}
                                  onClick={() => handleSelectHeldBillRider(bill.id, rider)}
                                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                                    isSelected
                                      ? 'border-teal-600 bg-teal-600 text-white'
                                      : 'border-slate-200 bg-white text-slate-700 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800'
                                  }`}
                                >
                                  {rider}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            aria-pressed={bill.packingStatus === 'packed'}
                            onClick={() => handleToggleHeldBillPackingStatus(bill.id)}
                            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                              bill.packingStatus === 'packed'
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                            }`}
                          >
                            <span>
                              {bill.packingStatus === 'packed'
                                ? '✅ จัดใส่ถุงเสร็จแล้ว'
                                : '⏳ รอจัดของ'}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePrintHeldBillPackingSlip(bill)}
                            className="flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100 transition-colors"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            <span>พิมพ์ใบจัดของ</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyHeldBillLineSummary(bill)}
                            className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                              isCopied
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                : 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100'
                            }`}
                          >
                            {isCopied ? (
                              <>
                                <Check className="h-3.5 w-3.5" />
                                <span>คัดลอกแล้ว</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                <span>คัดลอกสรุปออเดอร์ส่ง LINE</span>
                              </>
                            )}
                          </button>
                          {bill.orderType === 'delivery' && (
                            <button
                              type="button"
                              onClick={() => handleCopyRiderDeliverySheet(bill)}
                              className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                                copiedRiderSheetBillId === bill.id
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                  : 'border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100'
                              }`}
                            >
                              {copiedRiderSheetBillId === bill.id ? (
                                <>
                                  <Check className="h-3.5 w-3.5" />
                                  <span>คัดลอกใบงานแล้ว</span>
                                </>
                              ) : (
                                <span>🛵 คัดลอกใบงานคนส่งของ</span>
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteHeldBill(bill.id)}
                            className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>ลบบิล</span>
                          </button>
                          {cart.length > 0 && heldBills.length > 0 && (
                            <button
                              type="button"
                              onClick={() => handleMergeCartIntoHeldBill(bill.id)}
                              className="flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition-colors"
                            >
                              <span>➕ รวมตะกร้าปัจจุบันเข้าบิลพักนี้</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRestoreHeldBill(bill.id)}
                            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>เรียกคืนบิล</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickCheckoutHeldBill(bill.id)}
                            className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-amber-600 transition-colors shadow-2xs"
                          >
                            <span>⚡ คิดเงินบิลนี้ทันที</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}
      </Modal>

      {/* Quick Open Shift Modal */}
      <Modal
        open={shiftModalOpen}
        onClose={() => setShiftModalOpen(false)}
        title="เปิดกะขายใหม่"
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={handleOpenShift} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              เงินทอนตั้งต้นในลิ้นชัก (บาท)
            </label>
            <input
              type="number"
              min="0"
              step="1"
              required
              autoFocus
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg font-bold tabular-nums"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700"
          >
            เริ่มเปิดกะขาย
          </button>
        </form>
      </Modal>

      {/* Completed Sale Receipt Summary Modal */}
      <Modal
        open={!!lastReceipt}
        onClose={() => {
          setLastReceipt(null);
          focusSearchOnDesktop();
        }}
        title="สรุปบิลใบเสร็จ"
        maxWidthClass="max-w-md"
      >
        {lastReceipt && (
          <div className="space-y-4">
            <div className="flex flex-col items-center text-center rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
              <CheckCircle2 className="h-10 w-10 text-emerald-600 mb-1.5" />
              <p className="text-base font-extrabold text-emerald-900">
                บันทึกการขายเรียบร้อย
              </p>
              <p className="text-xs text-emerald-700 mt-0.5">
                {formatDateTime(lastReceipt.createdAt)}
              </p>
            </div>

            {/* Items list */}
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-y-auto">
              {lastReceipt.items.map((item) => (
                <div
                  key={item.key}
                  className="flex items-start justify-between gap-2 px-3.5 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">
                      {item.product_name}
                    </p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {item.qty} {item.unit_name} × {formatBaht(item.unit_price)}
                    </p>
                    {item.itemNote && (
                      <p className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                        <StickyNote className="h-3 w-3 shrink-0" />
                        <span>โน้ต: {item.itemNote}</span>
                      </p>
                    )}
                  </div>
                  <span className="font-bold text-slate-900 tabular-nums shrink-0">
                    {formatBaht(item.unit_price * item.qty)}
                  </span>
                </div>
              ))}
            </div>

            {/* Payment Breakdown */}
            {(() => {
              const splitInfo = getReceiptSplitInfo(lastReceipt);
              const creditDownInfo = getReceiptCreditDownPaymentInfo(lastReceipt);
              return (
                <>
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2 text-sm">
                    {lastReceipt.customerName && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-600 font-medium">ลูกค้า</span>
                        <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
                          <span>{lastReceipt.customerName}</span>
                          {lastReceipt.vipDiscountPct && lastReceipt.vipDiscountPct > 0 ? (
                            <span className="inline-flex items-center rounded-full border border-violet-300 bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-800">
                              👑 VIP ลด {formatNumber(lastReceipt.vipDiscountPct)}%
                            </span>
                          ) : null}
                        </span>
                      </div>
                    )}
                    {lastReceiptContactNote && (
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-slate-600 font-medium shrink-0">
                          ที่อยู่ / ติดต่อ
                        </span>
                        <span className="text-right font-semibold text-teal-800 break-words">
                          🏠 {lastReceiptContactNote}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 font-medium">วิธีชำระเงิน</span>
                      <span className="font-bold text-slate-900">
                        {splitInfo.hasSplit
                          ? 'แยกจ่าย (เงินสด + PromptPay QR)'
                          : creditDownInfo.hasCreditDownPayment
                          ? 'เงินเชื่อ (จ่ายสดบางส่วน)'
                          : paymentMethodLabel(lastReceipt.paymentMethod)}
                        {lastReceipt.paymentMethod === 'credit' && lastReceipt.customerName
                          ? ` (${lastReceipt.customerName})`
                          : ''}
                      </span>
                    </div>
                    {lastReceipt.discount > 0 && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600 font-medium">ยอดรวมก่อนลด</span>
                          <span className="font-semibold text-slate-700 tabular-nums">
                            {formatBaht(lastReceipt.subtotal)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-rose-600">
                          <span className="font-medium">
                            {lastReceipt.vipDiscountPct && lastReceipt.vipDiscountPct > 0
                              ? `ส่วนลดท้ายบิล (👑 VIP ลด ${formatNumber(lastReceipt.vipDiscountPct)}%)`
                              : 'ส่วนลดท้ายบิล'}
                          </span>
                          <span className="font-bold tabular-nums">
                            -{formatBaht(lastReceipt.discount)}
                          </span>
                        </div>
                      </>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 font-medium">ยอดรวมสุทธิ</span>
                      <span className="text-base font-extrabold text-slate-900 tabular-nums">
                        {formatBaht(lastReceipt.total)}
                      </span>
                    </div>
                    {(lastReceipt.oldDebtSettled ?? 0) > 0 && (
                      <div className="rounded-lg border border-indigo-200 bg-indigo-50/80 px-2.5 py-2 text-xs font-semibold text-indigo-900 tabular-nums">
                        {formatCombinedDebtSettlementSummary(
                          lastReceipt.total,
                          lastReceipt.oldDebtSettled ?? 0,
                          lastReceipt.oldDebtRemaining ?? 0
                        )}
                      </div>
                    )}
                    {splitInfo.hasSplit && (
                      <div className="flex items-center justify-between gap-2 text-sky-700">
                        <span className="font-medium">แยกจ่าย (เงินสด + โอน QR)</span>
                        <span className="font-bold tabular-nums text-right">
                          เงินสด ฿{formatNumber(splitInfo.cashPart)} + โอน QR ฿
                          {formatNumber(splitInfo.qrPart)}
                        </span>
                      </div>
                    )}
                    {splitInfo.hasSplit ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600 font-medium">เงินสดที่รับ</span>
                          <span className="font-bold text-slate-800 tabular-nums">
                            {formatBaht(splitInfo.cashPart)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600 font-medium">โอน PromptPay QR</span>
                          <span className="font-bold text-sky-700 tabular-nums">
                            {formatBaht(splitInfo.qrPart)}
                          </span>
                        </div>
                      </>
                    ) : creditDownInfo.hasCreditDownPayment ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600 font-medium">จ่ายสดวันนี้</span>
                          <span className="font-bold text-emerald-700 tabular-nums">
                            {formatBaht(creditDownInfo.downPayment)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600 font-medium">คงเหลือค้างเชื่อสุทธิ</span>
                          <span className="font-bold text-amber-800 tabular-nums">
                            {formatBaht(creditDownInfo.netCreditRemaining)}
                          </span>
                        </div>
                        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-1.5 text-xs font-semibold text-amber-900 tabular-nums">
                          จ่ายสดบางส่วนวันนี้ ฿{formatNumber(creditDownInfo.downPayment)} (ค้างเชื่อสุทธิ ฿
                          {formatNumber(creditDownInfo.netCreditRemaining)})
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 font-medium">เงินที่รับมา</span>
                        <span className="font-bold text-slate-800 tabular-nums">
                          {formatBaht(lastReceipt.cashReceived)}
                        </span>
                      </div>
                    )}
                    {lastReceipt.paymentMethod === 'credit' && lastReceipt.creditDueDate && (
                      <div className="flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50/90 px-2.5 py-1.5 text-xs font-semibold text-sky-900">
                        <span>📅 วันนัดชำระหนี้</span>
                        <span className="font-bold tabular-nums">
                          {formatExpiryDateTh(lastReceipt.creditDueDate)}
                        </span>
                      </div>
                    )}
                  </div>

                  {lastReceipt.pointsBalance !== undefined && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 space-y-1.5 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-amber-900">🏆 แต้มสะสมลูกค้า</span>
                        {lastReceipt.customerName && (
                          <span className="text-xs font-semibold text-amber-800">
                            {lastReceipt.customerName}
                          </span>
                        )}
                      </div>
                      {(lastReceipt.pointsRedeemed ?? 0) > 0 && (
                        <div className="flex items-center justify-between text-xs text-rose-700">
                          <span>แต้มที่ใช้แลกส่วนลด</span>
                          <span className="font-bold tabular-nums">
                            -{formatNumber(lastReceipt.pointsRedeemed ?? 0)} แต้ม
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-xs text-emerald-700">
                        <span>แต้มที่ได้รับจากบิลนี้</span>
                        <span className="font-bold tabular-nums">
                          +{formatNumber(lastReceipt.pointsEarned ?? 0)} แต้ม
                        </span>
                      </div>
                      <div className="flex items-center justify-between border-t border-amber-200/80 pt-1.5 text-sm">
                        <span className="font-semibold text-amber-900">แต้มสะสมคงเหลือ</span>
                        <span className="font-extrabold text-amber-800 tabular-nums">
                          🏆 {formatNumber(lastReceipt.pointsBalance)} แต้ม
                        </span>
                      </div>
                    </div>
                  )}

                  {lastReceipt.storeCreditBalance !== undefined && (
                    <div className="rounded-xl border border-teal-200 bg-teal-50 p-3.5 space-y-1.5 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-teal-900">💰 สมุดเงินฝากทอนลูกค้า</span>
                        {lastReceipt.customerName && (
                          <span className="text-xs font-semibold text-teal-800">
                            {lastReceipt.customerName}
                          </span>
                        )}
                      </div>
                      {(lastReceipt.storeCreditUsed ?? 0) > 0 && (
                        <div className="flex items-center justify-between text-xs text-rose-700">
                          <span>ใช้เงินฝากทอนหักลดบิลนี้</span>
                          <span className="font-bold tabular-nums">
                            -{formatBaht(lastReceipt.storeCreditUsed ?? 0)}
                          </span>
                        </div>
                      )}
                      {(lastReceipt.storeCreditDeposited ?? 0) > 0 && (
                        <div className="flex items-center justify-between text-xs text-emerald-700">
                          <span>ฝากเงินทอนเข้าเครดิต</span>
                          <span className="font-bold tabular-nums">
                            +{formatBaht(lastReceipt.storeCreditDeposited ?? 0)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t border-teal-200/80 pt-1.5 text-sm">
                        <span className="font-semibold text-teal-900">เงินฝากทอนคงเหลือ</span>
                        <span className="font-extrabold text-teal-800 tabular-nums">
                          💰 {formatBaht(lastReceipt.storeCreditBalance)}
                        </span>
                      </div>
                    </div>
                  )}

                  {lastReceipt.note && (
                    <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs sm:text-sm text-amber-900">
                      <span className="font-bold">หมายเหตุ:</span> {lastReceipt.note}
                    </div>
                  )}

                  {/* Prominent Change Display */}
                  <div className="rounded-2xl bg-emerald-600 text-white p-4 space-y-1.5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100">
                          เงินทอนลูกค้า
                        </p>
                        <p className="text-xs text-emerald-100 mt-0.5">
                          {splitInfo.hasSplit
                            ? 'แยกจ่ายเงินสด + โอน QR ครบแล้ว (ไม่มีเงินทอน)'
                            : creditDownInfo.hasCreditDownPayment
                            ? `จ่ายสดบางส่วนวันนี้ ฿${formatNumber(
                                creditDownInfo.downPayment
                              )} • คงเหลือค้างเชื่อสุทธิ ฿${formatNumber(
                                creditDownInfo.netCreditRemaining
                              )}`
                            : lastReceipt.paymentMethod === 'cash'
                            ? 'กรุณาตรวจสอบเงินทอนให้ครบถ้วน'
                            : 'ไม่มีเงินทอน'}
                        </p>
                      </div>
                      <span className="text-3xl font-extrabold tabular-nums">
                        {formatBaht(lastReceipt.changeAmount)}
                      </span>
                    </div>
                    {lastReceipt.changeAmount > 0 &&
                      renderChangeBreakdownBar(lastReceipt.changeAmount, 'receipt')}
                  </div>
                </>
              );
            })()}

            {effectiveReceiptFooter && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2.5 text-center text-xs sm:text-sm font-medium text-slate-700 whitespace-pre-line">
                {effectiveReceiptFooter}
              </div>
            )}

            {/* Copy & Print Actions */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={handleCopyReceipt}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 px-3 text-xs sm:text-sm font-bold text-emerald-800 hover:bg-emerald-100 transition-colors"
              >
                {receiptCopied ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-600" />
                    <span>คัดลอกแล้ว!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 text-emerald-600" />
                    <span>คัดลอกใบเสร็จ</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handlePrintReceipt}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 py-2.5 px-3 text-xs sm:text-sm font-bold text-slate-700 hover:bg-slate-200 transition-colors"
              >
                <Printer className="h-4 w-4 text-slate-600" />
                <span>พิมพ์ใบเสร็จ</span>
              </button>
              <button
                type="button"
                onClick={handlePrintPackingSlip}
                className="col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 py-2.5 px-3 text-xs sm:text-sm font-bold text-sky-800 hover:bg-sky-100 transition-colors"
              >
                <Package className="h-4 w-4 text-sky-600" />
                <span>พิมพ์ใบจัดของ / ใบส่งของ</span>
              </button>
            </div>

            <button
              type="button"
              disabled={lastReceipt.items.length === 0}
              onClick={() => handleRepeatReceiptItems(lastReceipt)}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 py-3 px-4 text-sm font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <RotateCcw className="h-4 w-4 text-emerald-600" />
              <span>ดึงรายการเข้าตะกร้าซ้ำ</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setLastReceipt(null);
                focusSearchOnDesktop();
              }}
              className="w-full rounded-xl bg-slate-900 py-3.5 text-base font-bold text-white hover:bg-slate-800 transition-colors"
            >
              เริ่มบิลถัดไป
            </button>
          </div>
        )}
      </Modal>

      {/* Today's Sales History Modal */}
      <Modal
        open={todaySalesOpen}
        onClose={() => {
          if (!partialReturnSale && !partialReturnSubmitting) {
            setTodaySalesOpen(false);
          }
        }}
        title="ประวัติบิลวันนี้"
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-4">
          {todaySalesNotice && (
            <div className="flex items-start justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                <span>{todaySalesNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setTodaySalesNotice('')}
                aria-label="ปิดข้อความแจ้งเตือน"
                className="text-emerald-600 hover:text-emerald-800 shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
              <p className="text-xs font-medium text-slate-500">จำนวนบิลวันนี้</p>
              <p className="text-xl font-extrabold text-slate-900 tabular-nums mt-0.5">
                {todaySales.length} บิล
              </p>
            </div>
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5">
              <p className="text-xs font-medium text-emerald-800">ยอดขายรวมวันนี้</p>
              <p className="text-xl font-extrabold text-emerald-700 tabular-nums mt-0.5">
                {formatBaht(todayTotalAmount)}
              </p>
            </div>
          </div>

          {todaySales.length > 0 && (
            <div className="space-y-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={todaySalesSearch}
                  onChange={(e) => setTodaySalesSearch(e.target.value)}
                  placeholder="ค้นหาจากเลขรหัสบิล, หมายเหตุบิล, ชื่อลูกค้า หรือชื่อสินค้า..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-9 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                />
                {todaySalesSearch && (
                  <button
                    type="button"
                    onClick={() => setTodaySalesSearch('')}
                    aria-label="ล้างคำค้นหา"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { key: 'all', label: 'ทั้งหมด' },
                    { key: 'cash', label: 'เงินสด' },
                    { key: 'qr', label: 'โอน QR' },
                    { key: 'credit', label: 'ขายเชื่อ' },
                    { key: 'returned_or_void', label: 'มีรับคืน/ยกเลิก' },
                  ] as const
                ).map((tab) => {
                  const active = todaySalesFilter === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setTodaySalesFilter(tab.key)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        active
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2 text-slate-600">
                  <span>
                    แสดง{' '}
                    <strong className="font-bold text-slate-900 tabular-nums">
                      {formatNumber(filteredTodaySales.length)} บิล
                    </strong>
                    {filteredTodaySales.length !== todaySales.length && (
                      <span className="text-slate-400 tabular-nums">
                        {' '}
                        (จากทั้งหมด {formatNumber(todaySales.length)} บิล)
                      </span>
                    )}
                  </span>
                  {(todaySalesSearch.trim() !== '' || todaySalesFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setTodaySalesSearch('');
                        setTodaySalesFilter('all');
                      }}
                      className="font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-2"
                    >
                      ล้างตัวกรอง
                    </button>
                  )}
                </div>
                <span className="font-semibold text-slate-700 tabular-nums">
                  ยอดรวมที่กรอง:{' '}
                  <strong className="font-extrabold text-emerald-700">
                    {formatBaht(filteredTodayTotalAmount)}
                  </strong>
                </span>
              </div>
            </div>
          )}

          {todaySalesLoading ? (
            <div className="py-12 text-center text-sm text-slate-500">
              กำลังโหลดรายการบิลวันนี้...
            </div>
          ) : todaySales.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-500">
              ยังไม่มีรายการขายในวันนี้
            </div>
          ) : filteredTodaySales.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-500">
              {todaySalesSearch.trim()
                ? `ไม่พบบิลที่ตรงกับ "${todaySalesSearch.trim()}"`
                : 'ไม่พบบิลที่ตรงกับตัวกรองที่เลือก'}
            </div>
          ) : (
            <div className="space-y-3 max-h-[60dvh] overflow-y-auto pr-1">
              {filteredTodaySales.map((sale) => {
                const items = sale.sale_items ?? [];
                const saleSplitInfo = parseSplitAmountsFromNote(sale.note);
                const saleCreditDownInfo =
                  sale.payment_method === 'credit'
                    ? parseCreditDownPaymentFromNote(sale.note)
                    : null;
                const badgeClass =
                  sale.payment_method === 'cash'
                    ? 'bg-emerald-100 text-emerald-800'
                    : sale.payment_method === 'qr'
                    ? 'bg-sky-100 text-sky-800'
                    : 'bg-amber-100 text-amber-800';

                return (
                  <div
                    key={sale.id}
                    className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5 shadow-2xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-slate-700 tabular-nums">
                          เวลา {formatTime(sale.created_at)} น.
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${badgeClass}`}
                        >
                          {paymentMethodLabel(sale.payment_method)}
                        </span>
                        {saleSplitInfo && (
                          <span className="rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[11px] font-bold text-sky-800 tabular-nums">
                            แยกจ่าย สด ฿{formatNumber(saleSplitInfo.partialCash)} + QR ฿
                            {formatNumber(saleSplitInfo.qrAmount)}
                          </span>
                        )}
                        {saleCreditDownInfo && (
                          <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-bold text-emerald-800 tabular-nums">
                            จ่ายสด ฿{formatNumber(saleCreditDownInfo.downPayment)} • ค้างเชื่อสุทธิ ฿
                            {formatNumber(saleCreditDownInfo.netCreditRemaining)}
                          </span>
                        )}
                        {sale.customers?.name && (
                          <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-0.5">
                            ลูกค้า: {sale.customers.name}
                          </span>
                        )}
                        {(sale.note ?? '').includes('รับคืนสินค้า:') && (
                          <span className="rounded-full bg-orange-50 border border-orange-200 px-2 py-0.5 text-[11px] font-bold text-orange-800">
                            มีรับคืนบางรายการ
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-base font-extrabold text-emerald-700 tabular-nums">
                          {formatBaht(sale.total_amount)}
                        </span>
                      </div>
                    </div>

                    {sale.note && (
                      <div className="rounded-lg bg-amber-50/70 border border-amber-200/70 px-2.5 py-1 text-xs font-medium text-amber-800">
                        หมายเหตุ: {sale.note}
                      </div>
                    )}

                    {items.length > 0 && (
                      <div className="space-y-1 text-xs text-slate-600">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="truncate">
                              • {item.product_name}{' '}
                              <span className="text-slate-400">
                                ({formatNumber(item.qty)} {item.unit_name} ×{' '}
                                {formatBaht(item.unit_price)})
                              </span>
                            </span>
                            <span className="font-semibold text-slate-800 tabular-nums shrink-0">
                              {formatBaht(item.subtotal)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {sale.payment_method === 'cash' && (
                      <div className="flex items-center justify-end gap-4 pt-1 border-t border-slate-100 text-xs text-slate-500 tabular-nums">
                        <span>รับเงิน: {formatBaht(sale.cash_received)}</span>
                        <span className="font-semibold text-emerald-700">
                          เงินทอน: {formatBaht(sale.change_amount)}
                        </span>
                      </div>
                    )}

                    {/* Void Bill / Restore Stock Action */}
                    <div className="pt-2 border-t border-slate-100">
                      {confirmVoidSaleId === sale.id ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-2.5">
                          <div className="text-xs text-rose-800">
                            <p className="font-bold">
                              ยืนยันการยกเลิกบิลและคืนสต็อกสินค้า ({items.length} รายการ) ใช่หรือไม่?
                            </p>
                            <p className="mt-0.5 text-rose-700">
                              ระบบจะคืนสต็อกเข้าคลัง บันทึกประวัติปรับสต็อก
                              {sale.payment_method === 'credit' && sale.customer_id
                                ? ` ลดยอดค้างชำระลูกค้า ${formatBaht(
                                    saleCreditDownInfo
                                      ? saleCreditDownInfo.netCreditRemaining
                                      : sale.total_amount
                                  )}`
                                : ''}{' '}
                              และลบบิลนี้ออกจากระบบ
                            </p>
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              disabled={voidingSaleId === sale.id}
                              onClick={() => setConfirmVoidSaleId(null)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              ไม่ยกเลิก
                            </button>
                            <button
                              type="button"
                              disabled={voidingSaleId === sale.id}
                              onClick={() => handleVoidSale(sale)}
                              className="flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>
                                {voidingSaleId === sale.id
                                  ? 'กำลังยกเลิกบิล...'
                                  : 'ยืนยันยกเลิกบิล'}
                              </span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleReprintSale(sale)}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            <span>พิมพ์ใบเสร็จ</span>
                          </button>
                          <button
                            type="button"
                            disabled={items.length === 0}
                            onClick={() => handleCloneSaleToCart(sale)}
                            className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 transition-colors"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>สั่งซ้ำลงตะกร้า</span>
                          </button>
                          <button
                            type="button"
                            disabled={items.length === 0 || voidingSaleId === sale.id}
                            onClick={() => openPartialReturnModal(sale)}
                            className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-40 transition-colors"
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                            <span>รับคืนบางรายการ</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmVoidSaleId(sale.id)}
                            className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition-colors"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            <span>ยกเลิกบิล (คืนสต็อก)</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      {/* Partial Item Return / Refund Modal */}
      <Modal
        open={partialReturnSale !== null}
        onClose={closePartialReturnModal}
        title="รับคืนสินค้าบางรายการจากบิล"
        maxWidthClass="max-w-xl"
      >
        {partialReturnSale && (
          <form onSubmit={handleConfirmPartialReturn} className="space-y-4">
            {/* Bill Summary Header */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700 tabular-nums">
                    บิล #{partialReturnSale.id.slice(0, 8)}
                  </span>
                  <span className="text-xs font-semibold text-slate-600 tabular-nums">
                    เวลา {formatTime(partialReturnSale.created_at)} น.
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      partialReturnSale.payment_method === 'cash'
                        ? 'bg-emerald-100 text-emerald-800'
                        : partialReturnSale.payment_method === 'qr'
                        ? 'bg-sky-100 text-sky-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {paymentMethodLabel(partialReturnSale.payment_method)}
                  </span>
                  {partialReturnSale.customers?.name && (
                    <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      ลูกค้า: {partialReturnSale.customers.name}
                    </span>
                  )}
                </div>
                <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                  ยอดบิล {formatBaht(partialReturnSale.total_amount)}
                </span>
              </div>

              {(partialReturnSale.note ?? '').includes('รับคืนสินค้า:') && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                  <p className="font-bold">บิลนี้มีประวัติรับคืนสินค้าก่อนหน้าแล้ว</p>
                  <p className="mt-0.5 wrap-break-word">{partialReturnSale.note}</p>
                </div>
              )}

              {partialReturnSale.payment_method === 'credit' &&
                partialReturnSale.customer_id && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
                    <span className="font-bold">บิลขายเชื่อ:</span>{' '}
                    ระบบจะลดยอดค้างชำระของลูกค้าทันทีตามมูลค่าสินค้าที่รับคืน
                    {(() => {
                      const creditCustomer = customers.find(
                        (c) => c.id === partialReturnSale.customer_id
                      );
                      return creditCustomer ? (
                        <span className="font-bold tabular-nums">
                          {' '}
                          (ค้างชำระปัจจุบัน {formatBaht(creditCustomer.total_debt)})
                        </span>
                      ) : null;
                    })()}
                  </div>
                )}
            </div>

            {/* Sale Items Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  เลือกรายการและจำนวนสินค้าที่รับคืน
                </h3>
                {partialReturnSummary.selectedItems.length > 0 && (
                  <button
                    type="button"
                    disabled={partialReturnSubmitting}
                    onClick={() => {
                      setPartialReturnQtyInputs({});
                      setPartialReturnError('');
                    }}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50"
                  >
                    ล้างที่เลือกทั้งหมด
                  </button>
                )}
              </div>

              {(partialReturnSale.sale_items ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
                  ไม่พบรายการสินค้าในบิลนี้
                </div>
              ) : (
                <div className="max-h-[34dvh] overflow-y-auto space-y-2 pr-1">
                  {(partialReturnSale.sale_items ?? []).map((item) => {
                    const maxQty = Math.max(0, Number(item.qty) || 0);
                    const rawInput = partialReturnQtyInputs[item.id] ?? '';
                    const selectedQty = parseClampedReturnQty(rawInput, maxQty);
                    const conversionRate = Number(item.conversion_rate || 1);
                    const baseReturnQty = Number(
                      (selectedQty * conversionRate).toFixed(4)
                    );
                    const lineRefund = Number(
                      (selectedQty * Number(item.unit_price || 0)).toFixed(2)
                    );
                    const isSelected = selectedQty > 0;

                    return (
                      <div
                        key={item.id}
                        className={`rounded-xl border p-3 transition-colors space-y-2 ${
                          isSelected
                            ? 'border-amber-300 bg-amber-50/50'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="text-sm font-bold text-slate-900 wrap-break-word">
                              {item.product_name}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500 tabular-nums">
                              <span>
                                ซื้อในบิล: {formatNumber(maxQty)} {item.unit_name}
                              </span>
                              <span>
                                ราคา/หน่วย: {formatBaht(item.unit_price)}
                              </span>
                              {conversionRate !== 1 && (
                                <span className="text-slate-400">
                                  (1 {item.unit_name} = {formatNumber(conversionRate)} หน่วยฐาน)
                                </span>
                              )}
                            </div>
                            {!item.product_id && (
                              <p className="text-[11px] text-amber-700 font-medium">
                                รายการคิดราคาด่วน (ไม่มีสินค้าในคลัง — จะไม่ปรับยอดสต็อก)
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={partialReturnSubmitting || selectedQty <= 0}
                              onClick={() =>
                                stepPartialReturnItemQty(
                                  item.id,
                                  maxQty,
                                  selectedQty >= 1 ? selectedQty - 1 : 0
                                )
                              }
                              aria-label={`ลดจำนวนคืน ${item.product_name}`}
                              className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={maxQty}
                              step="any"
                              disabled={partialReturnSubmitting || maxQty <= 0}
                              aria-label={`จำนวนที่คืน ${item.product_name}`}
                              value={rawInput}
                              placeholder="0"
                              onChange={(e) => {
                                const nextRaw = e.target.value;
                                if (nextRaw.trim() === '') {
                                  setPartialReturnQtyInputs((prev) => ({
                                    ...prev,
                                    [item.id]: '',
                                  }));
                                  setPartialReturnError('');
                                  return;
                                }
                                const parsed = Number(nextRaw);
                                if (Number.isNaN(parsed) || parsed < 0) return;
                                setPartialReturnQtyInputs((prev) => ({
                                  ...prev,
                                  [item.id]:
                                    parsed > maxQty ? String(maxQty) : nextRaw,
                                }));
                                setPartialReturnError('');
                              }}
                              onBlur={() =>
                                stepPartialReturnItemQty(item.id, maxQty, selectedQty)
                              }
                              className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 text-center text-sm font-bold text-slate-900 tabular-nums focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={partialReturnSubmitting || selectedQty >= maxQty}
                              onClick={() =>
                                stepPartialReturnItemQty(
                                  item.id,
                                  maxQty,
                                  selectedQty + 1
                                )
                              }
                              aria-label={`เพิ่มจำนวนคืน ${item.product_name}`}
                              className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={partialReturnSubmitting || maxQty <= 0}
                              onClick={() =>
                                stepPartialReturnItemQty(
                                  item.id,
                                  maxQty,
                                  selectedQty >= maxQty ? 0 : maxQty
                                )
                              }
                              className={`ml-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                                selectedQty >= maxQty && maxQty > 0
                                  ? 'border-amber-600 bg-amber-600 text-white'
                                  : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              {selectedQty >= maxQty && maxQty > 0 ? 'คืนครบ' : 'คืนหมด'}
                            </button>
                          </div>
                        </div>

                        {isSelected && (
                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200/70 pt-1.5 text-xs tabular-nums">
                            <span className="font-semibold text-emerald-700">
                              {item.product_id
                                ? `คืนสต็อกคลัง +${formatNumber(baseReturnQty)} หน่วยฐาน`
                                : 'ไม่กระทบสต็อกคลัง'}
                            </span>
                            <span className="font-bold text-amber-900">
                              ยอดคืนรายการนี้: {formatBaht(lineRefund)}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Return Reason Selector */}
            <div className="space-y-2">
              <p className="text-sm font-bold text-slate-900">เหตุผลการคืนสินค้า</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {PARTIAL_RETURN_REASONS.map((reason) => {
                  const isActive = partialReturnReason === reason;
                  return (
                    <button
                      key={reason}
                      type="button"
                      disabled={partialReturnSubmitting}
                      aria-pressed={isActive}
                      onClick={() => setPartialReturnReason(reason)}
                      className={`rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${
                        isActive
                          ? 'border-amber-600 bg-amber-600 text-white shadow-xs'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {reason}
                    </button>
                  );
                })}
              </div>
              {partialReturnReason === 'สินค้าชำรุด' && (
                <p className="text-[11px] text-slate-500">
                  หมายเหตุ: ระบบจะคืนจำนวนเข้าสต็อกตามรายการรับคืน หากสินค้าชำรุดขายต่อไม่ได้ สามารถปรับตัดของเสียในหน้าคลังสินค้าเพิ่มเติมได้
                </p>
              )}
            </div>

            {/* Auto Refund Summary */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-amber-800 tabular-nums">
                <span>จำนวนรายการที่เลือกรับคืน</span>
                <span className="font-bold">
                  {formatNumber(partialReturnSummary.selectedItems.length)} รายการ (รวม{' '}
                  {formatNumber(partialReturnSummary.totalReturnUnits)} หน่วยขาย)
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-amber-200/80 pt-2">
                <span className="text-sm font-bold text-amber-950">
                  {partialReturnSale.payment_method === 'credit' &&
                  partialReturnSale.customer_id
                    ? 'มูลค่ารับคืน / ลดยอดค้างชำระ'
                    : 'ยอดเงินที่ต้องคืนลูกค้า'}
                </span>
                <span className="text-2xl font-black text-amber-800 tabular-nums">
                  {formatBaht(partialReturnSummary.refundTotal)}
                </span>
              </div>
            </div>

            {partialReturnError && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{partialReturnError}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={partialReturnSubmitting}
                onClick={closePartialReturnModal}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={
                  partialReturnSubmitting ||
                  partialReturnSummary.selectedItems.length === 0 ||
                  partialReturnSummary.refundTotal <= 0
                }
                onClick={handleExchangeCreditPartialReturn}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ShoppingBag className="h-4 w-4" />
                <span>
                  {partialReturnSubmitting
                    ? 'กำลังดำเนินการ...'
                    : `รับคืน & นำยอด ฿${formatNumber(
                        partialReturnSummary.refundTotal
                      )} ไปหักลดซื้อของใหม่ในตะกร้า`}
                </span>
              </button>
              <button
                type="submit"
                disabled={
                  partialReturnSubmitting ||
                  partialReturnSummary.selectedItems.length === 0
                }
                className="flex items-center gap-1.5 rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Undo2 className="h-4 w-4" />
                <span>
                  {partialReturnSubmitting
                    ? 'กำลังบันทึกรับคืน...'
                    : 'ยืนยันรับคืนสินค้า'}
                </span>
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Keyboard Shortcuts Help Modal (F1) */}
      <Modal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="คู่มือคีย์ลัดแป้นพิมพ์ (F1)"
        maxWidthClass="max-w-md"
      >
        <div className="space-y-2.5 text-sm">
          {[
            { key: 'F1', desc: 'เปิด / ปิดหน้าต่างคู่มือคีย์ลัด' },
            { key: 'F2', desc: 'โฟกัสช่องค้นหาสินค้า / ยิงบาร์โค้ด' },
            {
              key: 'F4',
              desc: 'พักบิลด่วน (เมื่อมีสินค้าในตะกร้า) / เปิดดูบิลที่พักไว้ (เมื่อตะกร้าว่าง)',
            },
            {
              key: 'F6',
              desc: 'เปิด / ปิดโหมดเช็กราคาและข้อมูลสินค้าด่วน (ไม่เพิ่มลงตะกร้า)',
            },
            {
              key: 'F7',
              desc: 'เปิด / ปิดโหมดเพิ่มสินค้าเบ็ดเตล็ด / สินค้านอกรายการด่วน',
            },
            { key: 'Ctrl+Enter', desc: 'จ่ายเงินสดพอดีทันที (เมื่อมีสินค้าในตะกร้า)' },
            { key: 'F8 / F9 / F10', desc: 'เปิด/เลือก เงินสด / พร้อมเพย์ / เงินเชื่อ (ใช้ได้ทั้งหน้าหลักและหน้าชำระเงิน)' },
            { key: 'Enter', desc: 'เพิ่มสินค้าทันที (เมื่ออยู่ในช่องค้นหา)' },
          ].map((shortcut) => (
            <div
              key={shortcut.key}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5"
            >
              <span className="text-slate-700 font-medium">{shortcut.desc}</span>
              <kbd className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-800 shadow-xs">
                {shortcut.key}
              </kbd>
            </div>
          ))}
          <p className="pt-1 text-xs text-slate-500 text-center">
            กดปุ่ม <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">F1</kbd> หรือ <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">Esc</kbd> เพื่อปิดหน้าต่างนี้
          </p>
        </div>
      </Modal>

      {/* Quick Miscellaneous Item Modal (F7) */}
      <Modal
        open={quickMiscOpen}
        onClose={() => setQuickMiscOpen(false)}
        title="เพิ่มสินค้าเบ็ดเตล็ด / สินค้านอกรายการด่วน (F7)"
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleConfirmQuickMisc} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              ชื่อรายการ
            </label>
            <input
              type="text"
              required
              value={quickMiscName}
              onChange={(e) => setQuickMiscName(e.target.value)}
              placeholder="ระบุชื่อสินค้าเบ็ดเตล็ด..."
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium focus:border-teal-500 focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_MISC_ITEM_NAMES.map((presetName) => {
                const isSelected = quickMiscName === presetName;
                return (
                  <button
                    key={presetName}
                    type="button"
                    onClick={() => setQuickMiscName(presetName)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      isSelected
                        ? 'border-teal-600 bg-teal-600 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800'
                    }`}
                  >
                    {presetName}
                  </button>
                );
              })}
            </div>
            {quickMiscPresets.length > 0 && (
              <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50/50 p-2.5 space-y-1.5">
                <p className="text-[11px] font-bold text-teal-800">
                  ปุ่มลัดที่บันทึกไว้ ({formatNumber(quickMiscPresets.length)})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {quickMiscPresets.map((preset) => {
                    const isActive =
                      quickMiscName.trim() === preset.name &&
                      Number(quickMiscPrice) === preset.price;
                    return (
                      <div
                        key={preset.name}
                        className={`inline-flex items-center rounded-lg border text-xs font-semibold transition-colors ${
                          isActive
                            ? 'border-teal-600 bg-teal-600 text-white'
                            : 'border-teal-200 bg-white text-teal-900 hover:bg-teal-50'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleApplyQuickMiscPreset(preset)}
                          className="px-2.5 py-1 text-left"
                          title={
                            preset.cost > 0
                              ? `${preset.name} • ขาย ${formatBaht(preset.price)} (ทุน ${formatBaht(preset.cost)})`
                              : `${preset.name} • ขาย ${formatBaht(preset.price)}`
                          }
                        >
                          {preset.name} • ฿{formatNumber(preset.price)}
                          {preset.cost > 0 ? ` (ทุน ฿${formatNumber(preset.cost)})` : ''}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteQuickMiscPreset(preset.name);
                          }}
                          title={`ลบปุ่มลัด "${preset.name}"`}
                          className={`pr-2 pl-1 py-1 text-xs font-bold ${
                            isActive
                              ? 'text-teal-100 hover:text-white'
                              : 'text-slate-400 hover:text-rose-600'
                          }`}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              ราคาต่อหน่วย (บาท)
            </label>
            <input
              ref={quickMiscPriceInputRef}
              type="number"
              step="0.01"
              min="0.01"
              required
              value={quickMiscPrice}
              onChange={(e) => setQuickMiscPrice(e.target.value)}
              placeholder="0"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xl font-bold tabular-nums focus:border-teal-500 focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_MISC_ITEM_PRICES.map((presetPrice) => {
                const isSelected = Number(quickMiscPrice) === presetPrice;
                return (
                  <button
                    key={presetPrice}
                    type="button"
                    onClick={() => setQuickMiscPrice(String(presetPrice))}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-bold tabular-nums transition-colors ${
                      isSelected
                        ? 'border-teal-600 bg-teal-600 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800'
                    }`}
                  >
                    ฿{presetPrice}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              ต้นทุนต่อหน่วย (บาท, ไม่บังคับ)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={quickMiscCost}
              onChange={(e) => setQuickMiscCost(e.target.value)}
              placeholder="0"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold tabular-nums focus:border-teal-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              จำนวนชิ้น
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const current = Math.floor(Number(quickMiscQty)) || 1;
                  setQuickMiscQty(String(Math.max(1, current - 1)));
                }}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                type="number"
                step="1"
                min="1"
                required
                value={quickMiscQty}
                onChange={(e) => setQuickMiscQty(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-center text-lg font-bold tabular-nums focus:border-teal-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  const current = Math.floor(Number(quickMiscQty)) || 0;
                  setQuickMiscQty(String(current + 1));
                }}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {Number(quickMiscPrice) > 0 && Math.floor(Number(quickMiscQty)) > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2 text-sm font-bold text-teal-900">
              <span>รวมเป็นเงิน</span>
              <span className="tabular-nums">
                {formatBaht(Number(quickMiscPrice) * Math.floor(Number(quickMiscQty)))}
              </span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={handleSaveQuickMiscPreset}
              className="sm:w-auto rounded-xl border border-teal-300 bg-teal-50 px-3.5 py-3 text-xs font-bold text-teal-800 hover:bg-teal-100 transition-colors whitespace-nowrap"
            >
              + บันทึกเป็นปุ่มลัดใช้บ่อย
            </button>
            <button
              type="submit"
              className="flex-1 rounded-xl bg-teal-600 py-3 text-sm font-bold text-white hover:bg-teal-700 transition-colors"
            >
              เพิ่มลงตะกร้า
            </button>
          </div>
        </form>
      </Modal>

      {/* Quick Price Checker Modal (F6) */}
      <Modal
        open={priceCheckerOpen}
        onClose={() => setPriceCheckerOpen(false)}
        title="เช็กราคาและข้อมูลสินค้าด่วน (F6)"
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-900 flex items-center justify-between gap-2">
            <span>
              สแกนบาร์โค้ดหรือพิมพ์ชื่อสินค้าเพื่อเช็กราคาและข้อมูล — <strong>จะยังไม่เพิ่มลงตะกร้า</strong> จนกว่าจะกดหยิบใส่ตะกร้า
            </span>
            <kbd className="shrink-0 rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-bold text-amber-800">
              F6
            </kbd>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              ref={priceCheckerInputRef}
              type="text"
              value={priceCheckerQuery}
              onChange={(e) => {
                const val = e.target.value;
                setPriceCheckerQuery(val);
                setPriceCheckerSelectedId(null);
                setPriceCheckerMatchedUnitId(null);
              }}
              onKeyDown={handlePriceCheckerKeyDown}
              placeholder="พิมพ์ชื่อสินค้า, บาร์โค้ดหลัก, บาร์โค้ดแพ็ค/ลัง หรือตำแหน่งชั้นวาง แล้วกด Enter..."
              className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-20 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            {priceCheckerQuery && (
              <button
                type="button"
                onClick={() => {
                  setPriceCheckerQuery('');
                  setPriceCheckerSelectedId(null);
                  setPriceCheckerMatchedUnitId(null);
                  priceCheckerInputRef.current?.focus();
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200"
              >
                ล้าง
              </button>
            )}
          </div>

          {/* Search matches selector when multiple items match */}
          {priceCheckerQuery.trim() && priceCheckerMatches.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-500">
                พบ {formatNumber(priceCheckerMatches.length)} รายการ — คลิกเพื่อดูรายละเอียด:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-1">
                {priceCheckerMatches.map((item) => {
                  const itemUnits = item.product_units ?? [];
                  const itemDefaultUnit =
                    itemUnits.find((u) => u.is_default) ?? itemUnits[0];
                  const isSelected = priceCheckerProduct?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setPriceCheckerSelectedId(item.id);
                        setPriceCheckerMatchedUnitId(null);
                      }}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                          : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="font-semibold truncate">{item.name}</p>
                          {promoLabels[item.id] && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 rounded bg-gradient-to-r from-rose-500 to-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              {promoLabels[item.id]}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">
                          {item.barcode || 'ไม่มีบาร์โค้ด'} · คงเหลือ{' '}
                          {formatNumber(item.stock_qty)} {item.base_unit}
                        </p>
                      </div>
                      <span className="shrink-0 font-bold text-emerald-700 tabular-nums">
                        {item.allow_custom_price
                          ? 'ราคาเอง'
                          : `฿${formatBaht(Number(itemDefaultUnit?.selling_price ?? 0))}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* No results state */}
          {priceCheckerQuery.trim() && priceCheckerMatches.length === 0 && !priceCheckerProduct && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center space-y-1">
              <p className="text-sm font-semibold text-slate-700">
                ไม่พบสินค้าที่ตรงกับ &ldquo;{priceCheckerQuery.trim()}&rdquo;
              </p>
              <p className="text-xs text-slate-500">
                ลองตรวจสอบตัวสะกด หรือยิงบาร์โค้ดหลัก / บาร์โค้ดหน่วยแพ็คใหม่อีกครั้ง
              </p>
            </div>
          )}

          {/* Empty initial state */}
          {!priceCheckerQuery.trim() && !priceCheckerProduct && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center space-y-1.5">
              <Tag className="h-7 w-7 text-amber-500 mx-auto" />
              <p className="text-sm font-semibold text-slate-700">
                พร้อมเช็กราคาสินค้า
              </p>
              <p className="text-xs text-slate-500">
                ยิงบาร์โค้ดสินค้า (รองรับทั้งบาร์โค้ดชิ้นและบาร์โค้ดแพ็ค/ลัง) หรือพิมพ์ชื่อสินค้าเพื่อดูราคาขาย โปรราคาส่ง สต็อก ชั้นวาง และวันหมดอายุ
              </p>
            </div>
          )}

          {/* Detailed Product Card */}
          {priceCheckerProduct && (() => {
            const p = priceCheckerProduct;
            const units: ProductUnit[] =
              (p.product_units && p.product_units.length > 0
                ? p.product_units
                : [
                    {
                      id: 'base',
                      product_id: p.id,
                      unit_name: p.base_unit,
                      conversion_rate: 1,
                      selling_price: 0,
                      is_default: true,
                    },
                  ]);
            const defaultUnit = units.find((u) => u.is_default) ?? units[0];
            const matchedUnit = priceCheckerMatchedUnitId
              ? units.find((u) => u.id === priceCheckerMatchedUnitId)
              : undefined;
            const primaryAddUnit = matchedUnit ?? defaultUnit;
            const pUnitBarcodes = unitBarcodes[p.id] ?? {};
            const wholesaleTier = wholesaleTiers[p.id];
            const shelfLocation = shelfLocations[p.id];
            const promoLabel = promoLabels[p.id];
            const substituteNote = substituteNotes[p.id];
            const targetStock = targetStocks[p.id];
            const supplierName = suppliers[p.id];
            const restockNeeded =
              !p.allow_custom_price && targetStock && targetStock > p.stock_qty
                ? targetStock - p.stock_qty
                : 0;
            const expiryInfo = getProductExpiryInfo(expiryDates[p.id], todayIso);
            const costHistoryEntry = lastCostHistory[p.id];
            const currentCost = Number(p.cost_price) || 0;
            const hasCostIncrease =
              Boolean(costHistoryEntry) && currentCost > (costHistoryEntry?.prevCost ?? 0);
            const isOutOfStock = !p.allow_custom_price && p.stock_qty <= 0;
            const isLowStock =
              !p.allow_custom_price &&
              p.stock_qty > 0 &&
              p.stock_qty <= p.low_stock_alert;

            return (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                {/* Header & Extra-large Retail Price */}
                <div className="bg-gradient-to-r from-emerald-50 via-white to-amber-50/60 border-b border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.categories?.name && (
                        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          {p.categories.name}
                        </span>
                      )}
                      {p.barcode && (
                        <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-mono text-slate-600">
                          บาร์โค้ด: {p.barcode}
                        </span>
                      )}
                      {matchedUnit && (
                        <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                          สแกนตรงกับหน่วย: {matchedUnit.unit_name}
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg sm:text-xl font-bold text-slate-900 leading-snug">
                      {p.name}
                    </h3>
                  </div>

                  <div className="shrink-0 sm:text-right">
                    <p className="text-[11px] font-semibold text-slate-500">
                      {matchedUnit
                        ? `ราคาขาย (${matchedUnit.unit_name})`
                        : `ราคาขายปลีก (${defaultUnit.unit_name})`}
                    </p>
                    {p.allow_custom_price ? (
                      <p className="text-2xl font-extrabold text-amber-700">
                        กำหนดราคาเอง
                      </p>
                    ) : (
                      <p className="text-3xl sm:text-4xl font-extrabold text-emerald-700 tabular-nums tracking-tight">
                        ฿{formatBaht(Number((matchedUnit ?? defaultUnit).selling_price))}
                        <span className="ml-1 text-sm font-semibold text-slate-500">
                          / {(matchedUnit ?? defaultUnit).unit_name}
                        </span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  {/* Promo Label Banner */}
                  {promoLabel && (
                    <div className="rounded-xl border border-rose-200 bg-gradient-to-r from-rose-500 to-orange-500 px-3.5 py-2.5 flex items-center gap-2 text-xs font-bold text-white shadow-xs">
                      <Tag className="h-4 w-4 shrink-0" />
                      <span>โปรโมชั่น / ป้ายเชียร์ขาย: {promoLabel}</span>
                    </div>
                  )}

                  {/* Cost Increase Alert Badge */}
                  {hasCostIncrease && costHistoryEntry && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-bold text-rose-800">
                      <span>
                        🔺 ทุนเพิ่งปรับขึ้นจาก {formatBaht(costHistoryEntry.prevCost)} เป็น{' '}
                        {formatBaht(currentCost)}
                      </span>
                    </div>
                  )}

                  {/* Wholesale Tier Banner */}
                  {wholesaleTier && (
                    <div className="rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 font-semibold text-teal-900">
                        <Sparkles className="h-4 w-4 text-teal-600 shrink-0" />
                        <span>
                          โปรราคาส่ง: ซื้อครบ{' '}
                          <strong className="tabular-nums">
                            {formatNumber(wholesaleTier.minQty)} {p.base_unit}
                          </strong>{' '}
                          ขึ้นไป
                        </span>
                      </div>
                      <span className="shrink-0 rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-bold text-white tabular-nums">
                        ฿{formatBaht(wholesaleTier.unitPrice)} / {p.base_unit}
                      </span>
                    </div>
                  )}

                  {/* Stock, Shelf, Expiry, Substitute Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                    {/* Stock */}
                    <div
                      className={`rounded-xl border px-3 py-2.5 flex items-center justify-between gap-2 ${
                        isOutOfStock
                          ? 'border-red-200 bg-red-50 text-red-800'
                          : isLowStock
                            ? 'border-amber-200 bg-amber-50 text-amber-900'
                            : 'border-slate-200 bg-slate-50 text-slate-800'
                      }`}
                    >
                      <span className="font-semibold flex items-center gap-1.5">
                        <Package className="h-4 w-4 shrink-0 opacity-80" />
                        สต็อกคงเหลือ
                      </span>
                      <span className="font-bold tabular-nums">
                        {p.allow_custom_price
                          ? 'ไม่จำกัด (กำหนดราคาเอง)'
                          : `${formatNumber(p.stock_qty)} ${p.base_unit}${
                              isOutOfStock
                                ? ' (หมด)'
                                : isLowStock
                                  ? ' (ใกล้หมด)'
                                  : ''
                            }`}
                      </span>
                    </div>

                    {/* Shelf Location */}
                    <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/50 px-3 py-2.5 flex items-center justify-between gap-2 text-indigo-950">
                      <span className="font-semibold shrink-0">📍 ตำแหน่งชั้นวาง</span>
                      <span className="font-bold truncate">
                        {shelfLocation || 'ยังไม่ระบุ'}
                      </span>
                    </div>

                    {/* Expiry Date */}
                    <div
                      className={`rounded-xl border px-3 py-2.5 flex items-center justify-between gap-2 ${
                        expiryInfo?.status === 'expired'
                          ? 'border-red-200 bg-red-50 text-red-800'
                          : expiryInfo?.status === 'expiring_soon'
                            ? 'border-orange-200 bg-orange-50 text-orange-900'
                            : 'border-slate-200 bg-slate-50 text-slate-800'
                      }`}
                    >
                      <span className="font-semibold flex items-center gap-1.5 shrink-0">
                        <CalendarClock className="h-4 w-4 shrink-0 opacity-80" />
                        วันหมดอายุ
                      </span>
                      <span className="font-bold text-right">
                        {expiryInfo
                          ? expiryInfo.status === 'expired'
                            ? `หมดอายุแล้ว (${expiryInfo.formattedDate})`
                            : expiryInfo.status === 'expiring_soon'
                              ? `${expiryInfo.formattedDate} (อีก ${
                                  expiryInfo.daysRemaining === 0
                                    ? 'วันนี้'
                                    : `${expiryInfo.daysRemaining} วัน`
                                })`
                              : `${expiryInfo.formattedDate} (อีก ${expiryInfo.daysRemaining} วัน)`
                          : expiryDates[p.id]
                            ? expiryDates[p.id]
                            : 'ยังไม่ระบุ'}
                      </span>
                    </div>

                    {/* Substitute Notes */}
                    <div className="rounded-xl border border-sky-200/80 bg-sky-50/50 px-3 py-2.5 flex items-center justify-between gap-2 text-sky-950">
                      <span className="font-semibold shrink-0">สินค้าทดแทน</span>
                      {substituteNote ? (
                        <button
                          type="button"
                          onClick={() => {
                            setPriceCheckerQuery(substituteNote);
                            setPriceCheckerSelectedId(null);
                            setPriceCheckerMatchedUnitId(null);
                          }}
                          title={`กดเพื่อเช็กราคาสินค้าทดแทน: ${substituteNote}`}
                          className="font-bold text-sky-700 hover:underline truncate text-right"
                        >
                          {substituteNote}
                        </button>
                      ) : (
                        <span className="text-slate-500">ไม่มีบันทึก</span>
                      )}
                    </div>

                    {/* Target Stock (Full Shelf) */}
                    {targetStock && (
                      <div
                        className={`rounded-xl border px-3 py-2.5 flex items-center justify-between gap-2 ${
                          restockNeeded > 0
                            ? 'border-amber-200 bg-amber-50/70 text-amber-900'
                            : 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                        }`}
                      >
                        <span className="font-semibold shrink-0">
                          🎯 เป้าเต็มชั้น: {formatNumber(targetStock)} {p.base_unit}
                        </span>
                        <span className="font-bold text-right tabular-nums">
                          {restockNeeded > 0
                            ? `ต้องเติมเพิ่ม ${formatNumber(restockNeeded)} ${p.base_unit}`
                            : 'เต็มชั้นแล้ว'}
                        </span>
                      </div>
                    )}

                    {/* Supplier */}
                    {supplierName && (
                      <div className="rounded-xl border border-violet-200/80 bg-violet-50/60 px-3 py-2.5 flex items-center justify-between gap-2 text-violet-950">
                        <span className="font-semibold shrink-0">🏪 ร้านค้าส่ง:</span>
                        <span className="font-bold truncate text-right">{supplierName}</span>
                      </div>
                    )}
                  </div>

                  {/* All Selling Units Table */}
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-700">
                      ตารางราคาทุกหน่วยขาย
                    </p>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                          <tr>
                            <th className="px-3 py-2 font-semibold">หน่วยขาย</th>
                            <th className="px-3 py-2 font-semibold">บาร์โค้ดหน่วย</th>
                            <th className="px-3 py-2 font-semibold text-right">ราคาขาย</th>
                            <th className="px-3 py-2 font-semibold text-right">หยิบขาย</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {units.map((u) => {
                            const unitBc =
                              pUnitBarcodes[u.id] ??
                              pUnitBarcodes[u.unit_name] ??
                              (u.is_default ? p.barcode : '');
                            const conv = Number(u.conversion_rate) || 1;
                            const price = Number(u.selling_price);
                            const perBase = conv > 1 ? price / conv : null;
                            const isHighlighted = u.id === priceCheckerMatchedUnitId;
                            return (
                              <tr
                                key={u.id}
                                className={
                                  isHighlighted ? 'bg-amber-50/70' : 'bg-white'
                                }
                              >
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-bold text-slate-900">
                                      {u.unit_name}
                                    </span>
                                    {u.is_default && (
                                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                                        หลัก
                                      </span>
                                    )}
                                    {isHighlighted && (
                                      <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                                        ตรงบาร์โค้ด
                                      </span>
                                    )}
                                  </div>
                                  {conv > 1 && (
                                    <p className="text-[11px] text-slate-500">
                                      1 {u.unit_name} = {formatNumber(conv)}{' '}
                                      {p.base_unit}
                                    </p>
                                  )}
                                </td>
                                <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                                  {unitBc || '—'}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  <p className="font-bold text-emerald-700 text-sm">
                                    {p.allow_custom_price
                                      ? 'กำหนดเอง'
                                      : `฿${formatBaht(price)}`}
                                  </p>
                                  {!p.allow_custom_price && perBase !== null && (
                                    <p className="text-[10px] text-slate-500">
                                      เฉลี่ย ฿{formatBaht(perBase)}/{p.base_unit}
                                    </p>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => handleAddFromPriceChecker(p, u)}
                                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700 transition-colors"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    <span>หยิบ</span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Primary Action Footer */}
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setPriceCheckerOpen(false)}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      ปิดหน้าต่าง (Esc)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddFromPriceChecker(p, primaryAddUnit)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs transition-colors"
                    >
                      <ShoppingBag className="h-4 w-4" />
                      <span>
                        หยิบใส่ตะกร้าขาย ({primaryAddUnit.unit_name})
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </Modal>

      {/* Store & Receipt Settings Modal */}
      <Modal
        open={receiptSettingsOpen}
        onClose={() => setReceiptSettingsOpen(false)}
        title="ตั้งค่าร้าน & ใบเสร็จ"
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-6">
          <form onSubmit={handleSaveReceiptFooter} className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1 text-xs text-slate-600">
            <p className="font-bold text-slate-800 text-sm">
              {settings?.store_name || 'ร้านขายของชำ POS'}
            </p>
            {settings?.phone && <p>โทร: {settings.phone}</p>}
            {settings?.address && (
              <p className="whitespace-pre-line">{settings.address}</p>
            )}
            {settings?.promptpay_id && (
              <p className="text-emerald-700 font-medium">
                PromptPay: {settings.promptpay_id}
              </p>
            )}
            <p className="pt-1 text-[11px] text-slate-400">
              แก้ไขชื่อร้าน เบอร์โทร ที่อยู่ และ PromptPay ได้ที่หน้า &ldquo;สรุปยอด &amp; ตั้งค่า&rdquo;
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="pos-receipt-footer-input"
                className="text-sm font-bold text-slate-800"
              >
                ข้อความท้ายใบเสร็จ
              </label>
              <button
                type="button"
                onClick={handleResetReceiptFooterDraft}
                className="text-xs font-semibold text-emerald-700 hover:underline"
              >
                คืนค่าเริ่มต้น
              </button>
            </div>
            <textarea
              id="pos-receipt-footer-input"
              rows={3}
              value={receiptFooterDraft}
              onChange={(e) => setReceiptFooterDraft(e.target.value)}
              placeholder={DEFAULT_RECEIPT_FOOTER}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
            />
            <p className="text-[11px] text-slate-500">
              แสดงผลในหน้าต่างสรุปใบเสร็จ ใบเสร็จพิมพ์ 80mm และข้อความคัดลอกใบเสร็จ (หากเว้นว่างจะใช้ข้อความเริ่มต้น)
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-slate-500">
              ข้อความแนะนำ (คลิกเพื่อเลือกใช้)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                DEFAULT_RECEIPT_FOOTER,
                'ขอบคุณที่ใช้บริการ สินค้าซื้อแล้วไม่รับเปลี่ยนคืน',
                'ขอบคุณครับ/ค่ะ ยินดีให้บริการทุกวัน',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReceiptFooterDraft(preset)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors text-left ${
                    receiptFooterDraft.trim() === preset
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800 font-semibold'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-3 space-y-1">
            <p className="text-[11px] font-semibold text-slate-400 text-center">
              ตัวอย่างท้ายใบเสร็จ
            </p>
            <p className="text-center text-xs font-medium text-slate-800 whitespace-pre-line">
              {receiptFooterDraft.trim() || DEFAULT_RECEIPT_FOOTER}
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setReceiptSettingsOpen(false)}
              className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 transition-colors"
            >
              บันทึกข้อความท้ายใบเสร็จ
            </button>
          </div>
        </form>

          {/* POS Metadata Backup / Restore (JSON) */}
          <div className="border-t border-slate-200 pt-5 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    สำรอง/กู้คืนข้อมูลตั้งค่า POS (JSON)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    รวบรวมข้อมูล 8 คีย์: สินค้าปักหมุด, ชุดขายด่วน, ท้ายใบเสร็จ, มัดจำภาชนะ, บิลที่พักไว้, ข้อความส่งต่อกะ, ปุ่มลัดจิปาถะ และเงินฝากทอนลูกค้า
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopyPosMetaJson}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                  >
                    {posMetaCopied ? (
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
                    onClick={handleDownloadPosMetaJson}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>ดาวน์โหลดไฟล์ (.json)</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                  สินค้าปักหมุด: {formatNumber(pinnedIds.length)}
                </span>
                <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                  ชุดขายด่วน: {formatNumber(bundles.length)}
                </span>
                <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700">
                  ท้ายใบเสร็จ: {effectiveReceiptFooter ? 'ตั้งค่าแล้ว' : '-'}
                </span>
                <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                  มัดจำภาชนะ: {formatNumber(containerDeposits.length)}
                </span>
                <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                  บิลที่พักไว้: {formatNumber(heldBills.length)}
                </span>
                <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700">
                  ข้อความส่งต่อกะ: {handoverMemo ? 'มีข้อความ' : 'ไม่มี'}
                </span>
                <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                  ปุ่มลัดจิปาถะ: {formatNumber(quickMiscPresets.length)}
                </span>
                <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                  เงินฝากทอนลูกค้า: {formatNumber(Object.keys(storeCredits).length)} ราย
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/70 px-3.5 py-2 text-xs font-bold text-sky-800 hover:bg-sky-50 transition">
                  <Upload className="h-4 w-4" />
                  <span>
                    {posMetaFileName
                      ? `เลือกไฟล์ใหม่ (${posMetaFileName})`
                      : 'อัปโหลดไฟล์ .json จากเครื่อง'}
                  </span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handlePosMetaFileChange}
                    className="hidden"
                  />
                </label>

                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-500 font-medium">รูปแบบกู้คืน:</span>
                  <button
                    type="button"
                    onClick={() => setPosMetaRestoreMode('replace')}
                    className={`rounded-lg border px-2.5 py-1 font-semibold transition ${
                      posMetaRestoreMode === 'replace'
                        ? 'border-sky-600 bg-sky-600 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    เขียนทับข้อมูลเดิม
                  </button>
                  <button
                    type="button"
                    onClick={() => setPosMetaRestoreMode('merge')}
                    className={`rounded-lg border px-2.5 py-1 font-semibold transition ${
                      posMetaRestoreMode === 'merge'
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
                  htmlFor="pos-meta-json-textarea"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  วางข้อมูล JSON เพื่อกู้คืน
                </label>
                <textarea
                  id="pos-meta-json-textarea"
                  rows={5}
                  value={posMetaJsonInput}
                  onChange={(e) => {
                    setPosMetaJsonInput(e.target.value);
                    setPosMetaError('');
                    setPosMetaSuccess('');
                  }}
                  placeholder='{"pos_pinned_product_ids_v1": [...], "pos_bundles_v1": [...], ...}'
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-800 focus:border-sky-500 focus:bg-white focus:outline-none"
                />
              </div>

              {posMetaPreview && !posMetaPreview.error && (
                <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 flex flex-wrap items-center gap-2">
                  <span className="font-bold">ตรวจพบข้อมูลพร้อมกู้คืน:</span>
                  {posMetaPreview.pinnedIds !== undefined && (
                    <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                      ปักหมุด {formatNumber(posMetaPreview.pinnedIds.length)}
                    </span>
                  )}
                  {posMetaPreview.bundles !== undefined && (
                    <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                      ชุดขายด่วน {formatNumber(posMetaPreview.bundles.length)}
                    </span>
                  )}
                  {posMetaPreview.receiptFooter !== undefined && (
                    <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold">
                      ท้ายใบเสร็จ
                    </span>
                  )}
                  {posMetaPreview.containerDeposits !== undefined && (
                    <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                      มัดจำภาชนะ {formatNumber(posMetaPreview.containerDeposits.length)}
                    </span>
                  )}
                  {posMetaPreview.heldBills !== undefined && (
                    <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                      บิลพักไว้ {formatNumber(posMetaPreview.heldBills.length)}
                    </span>
                  )}
                  {posMetaPreview.shiftHandoverMemo !== undefined && (
                    <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold">
                      ข้อความส่งต่อกะ
                    </span>
                  )}
                  {posMetaPreview.miscPresets !== undefined && (
                    <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                      ปุ่มลัดจิปาถะ {formatNumber(posMetaPreview.miscPresets.length)}
                    </span>
                  )}
                  {posMetaPreview.customerStoreCredits !== undefined && (
                    <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                      เงินฝากทอน{' '}
                      {formatNumber(Object.keys(posMetaPreview.customerStoreCredits).length)} ราย
                    </span>
                  )}
                </div>
              )}

              {posMetaPreview?.error && !posMetaError && (
                <div
                  role="alert"
                  className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
                >
                  {posMetaPreview.error}
                </div>
              )}

              {posMetaError && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                >
                  {posMetaError}
                </div>
              )}

              {posMetaSuccess && (
                <div
                  role="status"
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 flex items-center gap-1.5"
                >
                  <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>{posMetaSuccess}</span>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={!posMetaJsonInput.trim() || Boolean(posMetaPreview?.error)}
                  onClick={handleRestorePosMetaJson}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>กู้คืนข้อมูลเข้าสู่ระบบ</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Customer-Facing Display Modal */}
      <Modal
        open={customerDisplayOpen}
        onClose={() => setCustomerDisplayOpen(false)}
        title="จอแสดงยอดลูกค้า"
        maxWidthClass="max-w-4xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-slate-900 truncate">
                {settings?.store_name || 'ร้านขายของชำ POS'}
              </p>
              {selectedCustomer && (
                <p className="text-xs font-semibold text-emerald-700 truncate">
                  ลูกค้าสมาชิก: {selectedCustomer.name}
                </p>
              )}
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 tabular-nums shrink-0">
              <ShoppingBag className="h-3.5 w-3.5" />
              <span>
                {formatNumber(cart.length)} รายการ ({formatNumber(cartCount)} ชิ้น)
              </span>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
            {/* Left: Itemized Cart & Extra-Large Net Total */}
            <div className="md:col-span-7 flex flex-col gap-3">
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden flex-1 flex flex-col">
                <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/70 text-xs font-bold text-slate-600">
                  รายการสินค้าในตะกร้า
                </div>
                {cart.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 text-center text-slate-400">
                    <ShoppingBag className="h-10 w-10 mb-2 opacity-40" />
                    <p className="text-sm font-medium">ยังไม่มีสินค้าในตะกร้า</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-[38dvh] md:max-h-[44dvh] overflow-y-auto">
                    {cart.map((item) => {
                      const displayItemNote = (cartItemNotes[item.key] ?? '').trim();
                      return (
                        <div
                          key={item.key}
                          className="flex items-start justify-between gap-3 px-4 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm sm:text-base font-bold text-slate-900 break-words">
                              {item.product_name}
                            </p>
                            <p className="text-xs sm:text-sm text-slate-500 tabular-nums">
                              {formatNumber(item.qty)} {item.unit_name} ×{' '}
                              {formatBaht(item.unit_price)}
                            </p>
                            {displayItemNote && (
                              <p className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                <StickyNote className="h-3 w-3 shrink-0" />
                                <span>{displayItemNote}</span>
                              </p>
                            )}
                          </div>
                          <span className="text-base sm:text-lg font-extrabold text-slate-900 tabular-nums shrink-0">
                            {formatBaht(item.unit_price * item.qty)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-emerald-600 text-white p-5 shadow-md space-y-2.5">
                {customerDisplayDiscount > 0 && (
                  <div className="space-y-1 border-b border-emerald-500/60 pb-2.5 text-sm">
                    <div className="flex items-center justify-between text-emerald-100 tabular-nums">
                      <span>ยอดรวมก่อนลด</span>
                      <span className="font-semibold">{formatBaht(cartTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between text-amber-200 tabular-nums">
                      <span>
                        {appliedVipPct > 0
                          ? `ส่วนลด VIP (${formatNumber(appliedVipPct)}%)`
                          : pointsToRedeem > 0
                            ? `ส่วนลดแลกแต้ม (${formatNumber(pointsToRedeem)} แต้ม)`
                            : 'ส่วนลดท้ายบิล'}
                      </span>
                      <span className="font-bold">
                        -{formatBaht(customerDisplayDiscount)}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <span className="text-xs sm:text-sm font-bold uppercase tracking-wide text-emerald-100">
                    ยอดรวมสุทธิที่ต้องชำระ
                  </span>
                  <span className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight tabular-nums leading-none">
                    {formatBaht(customerDisplayNetTotal)}
                  </span>
                </div>

                {customerDisplaySplitCashPaid > 0 && (
                  <div className="pt-2 border-t border-emerald-500/60 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-semibold text-emerald-50 tabular-nums">
                    <span>รับเงินสดแล้ว {formatBaht(customerDisplaySplitCashPaid)}</span>
                    <span className="rounded-lg bg-white/15 px-2.5 py-1 font-bold text-white">
                      สแกน QR คงเหลือ {formatBaht(customerDisplayQrAmount)}
                    </span>
                  </div>
                )}

                {checkoutOpen &&
                  paymentMethod === 'cash' &&
                  !isSplitCashQr &&
                  cashReceivedNum > 0 &&
                  cashReceivedNum >= finalTotal && (
                    <div className="pt-2 border-t border-emerald-500/60 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-semibold text-emerald-50 tabular-nums">
                      <span>รับเงินสด {formatBaht(cashReceivedNum)}</span>
                      <span className="rounded-lg bg-white/15 px-2.5 py-1 font-bold text-white">
                        เงินทอน {formatBaht(cashChange)}
                      </span>
                    </div>
                  )}
              </div>
            </div>

            {/* Right: PromptPay QR Display */}
            <div className="md:col-span-5 flex flex-col">
              <div className="flex-1 rounded-2xl border-2 border-sky-200 bg-sky-50/70 p-5 flex flex-col items-center justify-center text-center space-y-3">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-sky-600 px-3 py-1 text-xs font-bold text-white">
                  <QrCode className="h-3.5 w-3.5" />
                  <span>PromptPay QR</span>
                </div>

                {settings?.promptpay_id?.trim() ? (
                  customerDisplayQrAmount > 0 ? (
                    <>
                      {customerDisplayQrDataUrl ? (
                        <img
                          src={customerDisplayQrDataUrl}
                          alt="PromptPay QR Code สำหรับลูกค้าสแกนจ่าย"
                          className="w-56 h-56 sm:w-64 sm:h-64 rounded-2xl border border-sky-200 bg-white p-3 shadow-sm"
                        />
                      ) : (
                        <div className="w-56 h-56 sm:w-64 sm:h-64 rounded-2xl border border-sky-200 bg-white flex items-center justify-center text-xs font-semibold text-slate-400">
                          กำลังสร้าง QR Code...
                        </div>
                      )}
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-sky-900">
                          สแกนจ่ายยอดสุทธิ
                        </p>
                        <p className="text-3xl font-black text-sky-700 tabular-nums">
                          {formatBaht(customerDisplayQrAmount)}
                        </p>
                        <p className="text-xs font-medium text-slate-600">
                          พร้อมเพย์: {settings.promptpay_id}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-emerald-200 bg-white p-4 text-sm font-semibold text-emerald-800">
                      ไม่มียอดคงเหลือที่ต้องสแกนจ่าย
                    </div>
                  )
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs sm:text-sm font-medium text-amber-800 space-y-1">
                    <p className="font-bold">ยังไม่ได้ตั้งค่า PromptPay</p>
                    <p>กรุณาตรวจสอบรายการสินค้าและยอดชำระที่หน้าจอด้านซ้าย</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setCustomerDisplayOpen(false)}
            className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
          >
            ปิดหน้าจอแสดงยอดลูกค้า
          </button>
        </div>
      </Modal>

      {/* Container Deposits Ledger Modal */}
      <Modal
        open={containerDepositsOpen}
        onClose={() => setContainerDepositsOpen(false)}
        title="สมุดบันทึกมัดจำขวด / ลัง / ถังน้ำ"
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-5">
          {/* Summary Banner */}
          <div className="rounded-xl border border-cyan-200 bg-cyan-50/80 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-cyan-800">มัดจำภาชนะค้างคืนทั้งหมด</p>
              <p className="text-sm font-bold text-cyan-950 tabular-nums">
                {formatNumber(containerDeposits.length)} รายการ •{' '}
                {formatNumber(totalContainerDepositQty)} ชิ้น/ใบ
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-cyan-800">ยอดเงินมัดจำคงค้างรวม</p>
              <p className="text-xl font-black text-cyan-700 tabular-nums">
                {formatBaht(totalContainerDepositAmount)}
              </p>
            </div>
          </div>

          {/* New Deposit Form */}
          <form
            onSubmit={handleAddContainerDeposit}
            className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Package className="h-4 w-4 text-cyan-600" />
                <span>บันทึกรับมัดจำใหม่</span>
              </h3>
              {selectedCustomer && (
                <button
                  type="button"
                  onClick={() => setDepositCustomerName(selectedCustomer.name)}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
                >
                  ใช้ลูกค้าในบิล: {selectedCustomer.name}
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-600">เลือกภาชนะด่วน</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_CONTAINER_TYPES.map((typeLabel) => {
                  const isActive = depositItemLabel === typeLabel;
                  return (
                    <button
                      key={typeLabel}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setDepositItemLabel(typeLabel)}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        isActive
                          ? 'border-cyan-600 bg-cyan-600 text-white shadow-xs'
                          : 'border-cyan-200 bg-white text-cyan-800 hover:bg-cyan-50'
                      }`}
                    >
                      {typeLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="deposit-item-label-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  ชนิดภาชนะ / รายการ <span className="text-rose-500">*</span>
                </label>
                <input
                  id="deposit-item-label-input"
                  type="text"
                  required
                  value={depositItemLabel}
                  onChange={(e) => setDepositItemLabel(e.target.value)}
                  placeholder="เช่น ขวดเบียร์/โซดา, ถังน้ำดื่ม 20L"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="deposit-customer-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  ชื่อลูกค้า / หมายเหตุ
                </label>
                <input
                  id="deposit-customer-input"
                  type="text"
                  value={depositCustomerName}
                  onChange={(e) => setDepositCustomerName(e.target.value)}
                  placeholder="เช่น ป้าสมใจ, บ้านเลขที่ 12, 081-xxx"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="deposit-qty-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  จำนวน (ใบ/ลัง/ถัง) <span className="text-rose-500">*</span>
                </label>
                <input
                  id="deposit-qty-input"
                  type="number"
                  min="1"
                  step="any"
                  required
                  value={depositQty}
                  onChange={(e) => setDepositQty(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="deposit-amount-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  ยอดเงินมัดจำ (บาท) <span className="text-rose-500">*</span>
                </label>
                <input
                  id="deposit-amount-input"
                  type="number"
                  min="1"
                  step="any"
                  required
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="เช่น 100"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-500">ยอดด่วน:</span>
                {QUICK_DEPOSIT_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setDepositAmount(String(amt))}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 tabular-nums transition-colors"
                  >
                    {formatNumber(amt)}฿
                  </button>
                ))}
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-cyan-700 transition-colors shrink-0"
              >
                <Plus className="h-4 w-4" />
                <span>บันทึกรับมัดจำ</span>
              </button>
            </div>
          </form>

          {/* Outstanding Deposits List */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900">
                รายการมัดจำค้างคืน ({formatNumber(containerDeposits.length)})
              </h3>
              {containerDeposits.length > 0 && (
                <div className="relative w-full sm:w-56">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="search"
                    value={depositSearch}
                    onChange={(e) => setDepositSearch(e.target.value)}
                    placeholder="ค้นหาชื่อลูกค้า / ภาชนะ..."
                    className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-2.5 py-1.5 text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {containerDeposits.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">
                ยังไม่มีรายการมัดจำภาชนะค้างคืนในขณะนี้
              </div>
            ) : filteredContainerDeposits.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
                ไม่พบรายการมัดจำที่ตรงกับคำค้นหา &quot;{depositSearch}&quot;
              </div>
            ) : (
              <div className="max-h-[38dvh] overflow-y-auto space-y-2 pr-1">
                {filteredContainerDeposits.map((dep) => (
                  <div
                    key={dep.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-cyan-100 px-2 py-0.5 text-xs font-bold text-cyan-800">
                          {dep.itemLabel}
                        </span>
                        <span className="font-bold text-sm text-slate-900 truncate">
                          {dep.customerName}
                        </span>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 tabular-nums">
                          จำนวน {formatNumber(dep.qty)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 tabular-nums">
                        รับมัดจำเมื่อ {formatDepositDateTime(dep.createdAt)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 shrink-0">
                      <span className="text-base font-extrabold text-cyan-700 tabular-nums">
                        {formatBaht(dep.depositAmount)}
                      </span>
                      {cart.length > 0 && (
                        <button
                          type="button"
                          onClick={() => handleDeductContainerDepositInBill(dep.id)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-600 transition-colors tabular-nums"
                        >
                          <Tag className="h-3.5 w-3.5" />
                          <span>คืนขวด &amp; หักลดในบิลนี้ (-฿{formatNumber(dep.depositAmount)})</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleReturnContainerDeposit(dep.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>คืนภาชนะ / คืนเงินมัดจำแล้ว</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
      {/* Quick Debt Collection Modal (Phase 36) */}
      <Modal
        open={quickDebtModalOpen}
        onClose={() => {
          setQuickDebtModalOpen(false);
          setQuickDebtReceipt(null);
        }}
        title={
          quickDebtReceipt
            ? 'สรุปผลการรับชำระหนี้'
            : 'รับชำระหนี้ลูกหนี้ด่วน'
        }
        maxWidthClass="max-w-lg"
      >
        {quickDebtReceipt ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center space-y-1.5">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <p className="text-base font-extrabold text-emerald-900">
                รับชำระหนี้สำเร็จ
              </p>
              <p className="text-xs text-emerald-700 tabular-nums">
                {quickDebtReceipt.paidAt}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600">ลูกค้า</span>
                <span className="font-bold text-slate-900">
                  {quickDebtReceipt.customerName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600">ยอดที่รับชำระ</span>
                <span className="text-lg font-extrabold text-emerald-700 tabular-nums">
                  {formatBaht(quickDebtReceipt.amountPaid)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600">ช่องทางรับชำระ</span>
                <span className="font-semibold text-slate-800">
                  {quickDebtReceipt.paymentMethod === 'qr'
                    ? 'โอนพร้อมเพย์ (QR)'
                    : 'เงินสด'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200">
                <span className="text-slate-600">ยอดหนี้คงเหลือล่าสุด</span>
                <span
                  className={`font-extrabold tabular-nums ${
                    quickDebtReceipt.remainingDebt > 0
                      ? 'text-rose-600'
                      : 'text-emerald-700'
                  }`}
                >
                  {formatBaht(quickDebtReceipt.remainingDebt)}
                </span>
              </div>
              {quickDebtReceipt.note && (
                <div className="pt-1 text-xs text-slate-600">
                  <span className="font-semibold">หมายเหตุ:</span>{' '}
                  {quickDebtReceipt.note}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleCopyQuickDebtReceipt}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 transition-colors"
              >
                {copiedQuickDebtReceipt ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>คัดลอกข้อความแล้ว</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>คัดลอกใบรับชำระหนี้ส่ง LINE</span>
                  </>
                )}
              </button>
              {debtorCustomers.length > 0 && (
                <button
                  type="button"
                  onClick={() => openQuickDebtModal()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <span>รับชำระรายการอื่น</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setQuickDebtModalOpen(false);
                  setQuickDebtReceipt(null);
                }}
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
              >
                ปิด
              </button>
            </div>
          </div>
        ) : debtorCustomers.length === 0 ? (
          <div className="py-8 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <p className="text-sm font-bold text-slate-800">
              ไม่มีลูกค้าที่มียอดค้างชำระในขณะนี้
            </p>
            <p className="text-xs text-slate-500">
              ลูกค้าเงินเชื่อทุกรายชำระครบถ้วนแล้ว
            </p>
            <button
              type="button"
              onClick={() => setQuickDebtModalOpen(false)}
              className="mt-2 inline-flex items-center justify-center rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-900"
            >
              ปิดหน้าต่าง
            </button>
          </div>
        ) : (
          <form onSubmit={handleQuickDebtSubmit} className="space-y-4">
            {/* Customer selector */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                เลือกลูกค้าที่มียอดค้างชำระ ({formatNumber(debtorCustomers.length)} ราย)
              </label>
              <select
                value={quickDebtCustomerId}
                onChange={(e) => handleQuickDebtCustomerChange(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-amber-500 focus:outline-none"
                required
              >
                {debtorCustomers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — ค้าง {formatBaht(c.total_debt)}
                    {c.phone ? ` (${c.phone})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {quickDebtTargetCustomer && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-amber-800">
                    ยอดค้างชำระปัจจุบัน
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    {quickDebtTargetCustomer.name}
                  </p>
                </div>
                <p className="text-xl font-extrabold text-rose-600 tabular-nums">
                  {formatBaht(quickDebtTargetCustomer.total_debt)}
                </p>
              </div>
            )}

            {/* Amount input & preset buttons */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">
                ยอดเงินที่รับชำระ (บาท)
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                max={quickDebtTargetCustomer ? Number(quickDebtTargetCustomer.total_debt) : undefined}
                value={quickDebtAmount}
                onChange={(e) => setQuickDebtAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-lg font-extrabold text-slate-900 tabular-nums focus:border-emerald-500 focus:outline-none"
                required
              />
              {quickDebtTargetCustomer && (
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setQuickDebtAmount(
                        String(
                          Math.round(Number(quickDebtTargetCustomer.total_debt) * 0.5 * 100) /
                            100
                        )
                      )
                    }
                    className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    จ่าย 50%
                  </button>
                  <button
                    type="button"
                    disabled={quickDebtFractionAmount <= 0}
                    onClick={() =>
                      setQuickDebtAmount(String(quickDebtFractionAmount))
                    }
                    className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    จ่ายเฉพาะเศษบาท
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setQuickDebtAmount(
                        String(Number(quickDebtTargetCustomer.total_debt))
                      )
                    }
                    className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition-colors"
                  >
                    จ่ายเต็มยอด
                  </button>
                </div>
              )}
              {quickDebtTargetCustomer && quickDebtParsedAmount > 0 && (
                <p className="text-xs font-semibold text-slate-600 tabular-nums">
                  {quickDebtParsedAmount > Number(quickDebtTargetCustomer.total_debt) ? (
                    <span className="text-rose-600">
                      ยอดรับชำระเกินกว่ายอดค้างชำระปัจจุบัน
                    </span>
                  ) : (
                    <>
                      ยอดหนี้คงเหลือหลังชำระ:{' '}
                      <span className="font-bold text-slate-900">
                        {formatBaht(
                          Math.max(
                            0,
                            Math.round(
                              (Number(quickDebtTargetCustomer.total_debt) -
                                quickDebtParsedAmount) *
                                100
                            ) / 100
                          )
                        )}
                      </span>
                    </>
                  )}
                </p>
              )}
            </div>

            {/* Payment method */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">
                ช่องทางรับชำระ
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setQuickDebtMethod('cash')}
                  className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 px-3 text-sm font-bold transition-colors ${
                    quickDebtMethod === 'cash'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Banknote className="h-4 w-4" />
                  <span>เงินสด</span>
                </button>
                <button
                  type="button"
                  onClick={() => setQuickDebtMethod('qr')}
                  className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 px-3 text-sm font-bold transition-colors ${
                    quickDebtMethod === 'qr'
                      ? 'border-sky-500 bg-sky-50 text-sky-800'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <QrCode className="h-4 w-4" />
                  <span>โอนพร้อมเพย์</span>
                </button>
              </div>
            </div>

            {/* PromptPay QR preview */}
            {quickDebtMethod === 'qr' && (
              <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-center space-y-2">
                {quickDebtPromptPayId ? (
                  quickDebtParsedAmount > 0 && quickDebtQrDataUrl ? (
                    <>
                      <p className="text-xs font-bold text-sky-900">
                        สแกน PromptPay เพื่อรับชำระ {formatBaht(quickDebtParsedAmount)}
                      </p>
                      <div className="inline-block rounded-xl bg-white p-2 shadow-2xs border border-sky-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={quickDebtQrDataUrl}
                          alt="PromptPay QR Code รับชำระหนี้"
                          className="h-44 w-44 mx-auto"
                        />
                      </div>
                      <p className="text-[11px] font-semibold text-sky-700 tabular-nums">
                        พร้อมเพย์: {settings?.promptpay_id}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-sky-700 py-2">
                      ระบุยอดรับชำระมากกว่า 0 เพื่อสร้าง QR Code
                    </p>
                  )
                ) : (
                  <p className="text-xs font-semibold text-amber-800">
                    ยังไม่ได้ตั้งค่าเบอร์/เลข PromptPay กรุณาไปตั้งค่าที่หน้า &quot;สรุปยอด &amp; ตั้งค่า&quot;
                  </p>
                )}
              </div>
            )}

            {/* Note */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                หมายเหตุ (ไม่บังคับ)
              </label>
              <input
                type="text"
                value={quickDebtNote}
                onChange={(e) => setQuickDebtNote(e.target.value)}
                placeholder="เช่น จ่ายบางส่วนหน้าเคาน์เตอร์"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setQuickDebtModalOpen(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={
                  quickDebtSubmitting ||
                  !quickDebtTargetCustomer ||
                  quickDebtParsedAmount <= 0 ||
                  quickDebtParsedAmount > Number(quickDebtTargetCustomer.total_debt)
                }
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  {quickDebtSubmitting ? 'กำลังบันทึก...' : 'ยืนยันรับชำระหนี้'}
                </span>
              </button>
            </div>
          </form>
        )}
      </Modal>
      {screenLockedAt !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="หน้าจอขายถูกล็อกชั่วคราว"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-900/95 backdrop-blur-md p-6 text-center text-white"
        >
          <div className="max-w-md w-full rounded-3xl border border-slate-700/80 bg-slate-800/90 p-8 shadow-2xl space-y-5">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-400">
              <Lock className="h-8 w-8" />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                {settings?.store_name || 'ร้านขายของชำ POS'}
              </p>
              <h2 className="text-2xl font-extrabold text-white">
                ล็อกหน้าจอขายชั่วคราว
              </h2>
              <p className="text-sm text-slate-300">
                เวลาที่ล็อก:{' '}
                <span className="font-bold text-white tabular-nums">
                  {screenLockedAt} น.
                </span>
              </p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3 text-xs text-slate-300">
              ข้อมูลสินค้าในตะกร้า ({cart.length} รายการ) และบิลที่พักไว้ ({heldBills.length} บิล) ยังคงถูกเก็บรักษาไว้ครบถ้วน
            </div>
            <button
              type="button"
              onClick={handleUnlockScreen}
              autoFocus
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-3.5 text-base font-bold text-white shadow-lg hover:bg-emerald-500 transition-colors"
            >
              <span>ปลดล็อกกลับมาขายต่อ</span>
            </button>
          </div>
        </div>
      )}
        </AppShell>
      </div>

      {/* Print-only Held Bill Pre-Packing Slip Layout */}
      {printingHeldBill && printMode === 'held_packing_slip' && (() => {
        const orderTypeMeta = getHeldBillOrderTypeMeta(printingHeldBill.orderType);
        const totalItemQty = printingHeldBill.items.reduce((sum, item) => sum + item.qty, 0);
        return (
          <div className="hidden print:block w-full max-w-[148mm] mx-auto p-4 text-black bg-white text-sm leading-snug">
            <div className="text-center space-y-1 border-b-2 border-black pb-2">
              <h1 className="text-lg font-extrabold tracking-tight">
                ใบจัดของล่วงหน้า (บิลพัก)
              </h1>
              <p className="text-xs font-semibold">
                {settings?.store_name || 'ร้านขายของชำ POS'}
                {settings?.phone ? ` • โทร: ${settings.phone}` : ''}
              </p>
              <p className="text-xs">{formatDateTime(printingHeldBill.createdAt)}</p>
            </div>

            <div className="my-3 rounded border-2 border-black p-2.5 space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs font-bold">
                <span>ประเภทออเดอร์: {orderTypeMeta.badgeText}</span>
                <span>
                  สถานะ:{' '}
                  {printingHeldBill.packingStatus === 'packed'
                    ? '✅ จัดใส่ถุงเสร็จแล้ว'
                    : '⏳ รอจัดของ'}
                </span>
              </div>
              <p className="text-base font-extrabold leading-tight">
                ลูกค้า: {printingHeldBill.customerName || 'ลูกค้าทั่วไป (หน้าร้าน)'}
              </p>
              {printingHeldBill.deliveryInfo && (
                <p className="text-sm font-semibold wrap-break-word whitespace-pre-line">
                  นัดรับ/จัดส่ง: {printingHeldBill.deliveryInfo}
                </p>
              )}
              {printingHeldBill.note && (
                <p className="text-xs pt-0.5 wrap-break-word">
                  <span className="font-bold">หมายเหตุบิล:</span> {printingHeldBill.note}
                </p>
              )}
            </div>

            <table className="w-full border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-y-2 border-black text-left">
                  <th className="py-1.5 pr-2 w-10 text-center font-bold">เช็ก</th>
                  <th className="py-1.5 pr-2 font-bold">รายการสินค้า</th>
                  <th className="py-1.5 text-right font-bold whitespace-nowrap">จำนวน</th>
                </tr>
              </thead>
              <tbody>
                {printingHeldBill.items.map((item) => {
                  const heldItemNote = printingHeldBill.itemNotes?.[item.key]?.trim();
                  return (
                    <tr key={item.key} className="border-b border-dashed border-black align-top">
                      <td className="py-2 pr-2 text-center font-mono font-bold whitespace-nowrap">
                        [ ]
                      </td>
                      <td className="py-2 pr-2">
                        <p className="font-semibold wrap-break-word">{item.product_name}</p>
                        {heldItemNote && (
                          <p className="text-xs italic wrap-break-word">
                            * โน้ต: {heldItemNote}
                          </p>
                        )}
                      </td>
                      <td className="py-2 text-right font-bold tabular-nums whitespace-nowrap">
                        {formatNumber(item.qty)} {item.unit_name}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="mt-3 border-t-2 border-black pt-2.5 space-y-1.5">
              <div className="flex justify-between text-xs tabular-nums">
                <span>จำนวนรวมทั้งหมด</span>
                <span className="font-semibold">
                  {formatNumber(printingHeldBill.items.length)} รายการ (
                  {formatNumber(totalItemQty)} ชิ้น)
                </span>
              </div>
              <div className="flex justify-between text-base font-extrabold tabular-nums">
                <span>ยอดรวม</span>
                <span>{formatBaht(printingHeldBill.total)}</span>
              </div>
              <div className="flex justify-between items-center rounded border border-black px-2.5 py-1.5 text-xs font-bold">
                <span>สถานะบิล</span>
                <span>บิลพักในคิว (รอรับของ / ชำระเงิน)</span>
              </div>
            </div>

            <div className="mt-6 pt-2 flex justify-between gap-4 text-xs">
              <span>ผู้จัดของ: ____________________</span>
              <span>ผู้ตรวจเช็ก: ____________________</span>
            </div>
          </div>
        );
      })()}

      {/* Print-only 80mm Receipt / Packing & Delivery Slip Layout */}
      {lastReceipt && printMode === 'packing_slip' && (
        <div className="hidden print:block w-full max-w-[148mm] mx-auto p-4 text-black bg-white text-sm leading-snug">
          <div className="text-center space-y-1 border-b-2 border-black pb-2">
            <h1 className="text-lg font-extrabold tracking-tight">
              ใบจัดของ / ใบส่งสินค้า
            </h1>
            <p className="text-xs font-semibold">
              {settings?.store_name || 'ร้านขายของชำ POS'}
              {settings?.phone ? ` • โทร: ${settings.phone}` : ''}
            </p>
            <p className="text-xs">{formatDateTime(lastReceipt.createdAt)}</p>
          </div>

          <div className="my-3 rounded border-2 border-black p-2.5 space-y-1">
            <p className="text-base font-extrabold leading-tight">
              ลูกค้า: {lastReceipt.customerName || 'ลูกค้าทั่วไป (หน้าร้าน)'}
            </p>
            {lastReceiptCustomer?.phone && (
              <p className="text-sm font-bold tabular-nums">
                โทร: {lastReceiptCustomer.phone}
              </p>
            )}
            {lastReceiptContactNote && (
              <p className="text-sm font-semibold wrap-break-word whitespace-pre-line">
                ที่อยู่/จุดสังเกต: {lastReceiptContactNote}
              </p>
            )}
            {lastReceipt.note && (
              <p className="text-xs pt-0.5 wrap-break-word">
                <span className="font-bold">หมายเหตุบิล:</span> {lastReceipt.note}
              </p>
            )}
          </div>

          <table className="w-full border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="border-y-2 border-black text-left">
                <th className="py-1.5 pr-2 w-10 text-center font-bold">เช็ก</th>
                <th className="py-1.5 pr-2 font-bold">รายการสินค้า</th>
                <th className="py-1.5 text-right font-bold whitespace-nowrap">จำนวน</th>
              </tr>
            </thead>
            <tbody>
              {lastReceipt.items.map((item) => (
                <tr key={item.key} className="border-b border-dashed border-black align-top">
                  <td className="py-2 pr-2 text-center font-mono font-bold whitespace-nowrap">
                    [ ]
                  </td>
                  <td className="py-2 pr-2">
                    <p className="font-semibold wrap-break-word">{item.product_name}</p>
                    {item.itemNote && (
                      <p className="text-xs italic wrap-break-word">
                        * โน้ต: {item.itemNote}
                      </p>
                    )}
                  </td>
                  <td className="py-2 text-right font-bold tabular-nums whitespace-nowrap">
                    {formatNumber(item.qty)} {item.unit_name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {(() => {
            const splitInfo = getReceiptSplitInfo(lastReceipt);
            const creditDownInfo = getReceiptCreditDownPaymentInfo(lastReceipt);
            const isCredit = lastReceipt.paymentMethod === 'credit';
            const collectAmount = isCredit
              ? creditDownInfo.hasCreditDownPayment
                ? creditDownInfo.netCreditRemaining
                : lastReceipt.total
              : 0;
            const totalItemQty = lastReceipt.items.reduce((sum, item) => sum + item.qty, 0);

            return (
              <div className="mt-3 border-t-2 border-black pt-2.5 space-y-1.5">
                <div className="flex justify-between text-xs tabular-nums">
                  <span>จำนวนรวมทั้งหมด</span>
                  <span className="font-semibold">
                    {formatNumber(lastReceipt.items.length)} รายการ ({formatNumber(totalItemQty)} ชิ้น)
                  </span>
                </div>
                <div className="flex justify-between text-base font-extrabold tabular-nums">
                  <span>ยอดรวมสุทธิ</span>
                  <span>{formatBaht(lastReceipt.total)}</span>
                </div>
                <div className="flex justify-between items-center rounded border border-black px-2.5 py-1.5 text-sm font-bold tabular-nums">
                  <span>สถานะการชำระ</span>
                  <span>
                    {isCredit
                      ? `ค้างชำระ/เก็บเงิน ${formatBaht(collectAmount)}`
                      : `ชำระแล้ว (${
                          splitInfo.hasSplit
                            ? 'เงินสด + QR'
                            : paymentMethodLabel(lastReceipt.paymentMethod)
                        })`}
                  </span>
                </div>
                {isCredit && creditDownInfo.hasCreditDownPayment && (
                  <p className="text-xs text-right tabular-nums">
                    (จ่ายสดแล้ว {formatBaht(creditDownInfo.downPayment)})
                  </p>
                )}
              </div>
            );
          })()}

          <div className="mt-6 pt-2 flex justify-between gap-4 text-xs">
            <span>ผู้จัดของ: ____________________</span>
            <span>ผู้รับของ: ____________________</span>
          </div>
        </div>
      )}

      {lastReceipt && printMode === 'receipt' && (
        <div className="hidden print:block w-[80mm] max-w-full mx-auto p-3 text-black bg-white text-xs leading-snug">
          <div className="text-center space-y-0.5">
            <h1 className="text-sm font-bold">
              {settings?.store_name || 'ร้านขายของชำ POS'}
            </h1>
            {settings?.phone && <p>โทร: {settings.phone}</p>}
            {settings?.address && (
              <p className="text-[11px] whitespace-pre-line">{settings.address}</p>
            )}
            <p className="pt-1 font-semibold">ใบเสร็จรับเงิน</p>
            <p className="text-[11px]">{formatDateTime(lastReceipt.createdAt)}</p>
          </div>

          <div className="border-t border-dashed border-black my-2" />

          <div className="space-y-1">
            {lastReceipt.items.map((item) => (
              <div key={item.key} className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium wrap-break-word">{item.product_name}</p>
                  <p className="text-[11px] tabular-nums">
                    {formatNumber(item.qty)} {item.unit_name} × {formatBaht(item.unit_price)}
                  </p>
                  {item.itemNote && (
                    <p className="text-[10px] italic wrap-break-word">
                      * โน้ต: {item.itemNote}
                    </p>
                  )}
                </div>
                <span className="font-semibold tabular-nums shrink-0">
                  {formatBaht(item.unit_price * item.qty)}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-black my-2" />

          <div className="space-y-1">
            {lastReceipt.discount > 0 && (
              <>
                <div className="flex justify-between tabular-nums">
                  <span>ยอดรวมก่อนลด</span>
                  <span>{formatBaht(lastReceipt.subtotal)}</span>
                </div>
                <div className="flex justify-between tabular-nums">
                  <span>
                    {lastReceipt.vipDiscountPct && lastReceipt.vipDiscountPct > 0
                      ? `ส่วนลด VIP (${formatNumber(lastReceipt.vipDiscountPct)}%)`
                      : 'ส่วนลดท้ายบิล'}
                  </span>
                  <span>-{formatBaht(lastReceipt.discount)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-sm font-bold tabular-nums">
              <span>ยอดรวมสุทธิ</span>
              <span>{formatBaht(lastReceipt.total)}</span>
            </div>
            {(lastReceipt.oldDebtSettled ?? 0) > 0 && (
              <p className="text-[11px] font-semibold tabular-nums pt-0.5">
                {formatCombinedDebtSettlementSummary(
                  lastReceipt.total,
                  lastReceipt.oldDebtSettled ?? 0,
                  lastReceipt.oldDebtRemaining ?? 0
                )}
              </p>
            )}
          </div>

          <div className="border-t border-dashed border-black my-2" />

          {(() => {
            const splitInfo = getReceiptSplitInfo(lastReceipt);
            const creditDownInfo = getReceiptCreditDownPaymentInfo(lastReceipt);
            return (
              <div className="space-y-1">
                {lastReceipt.customerName && (
                  <div className="flex justify-between">
                    <span>ลูกค้า</span>
                    <span className="font-semibold">
                      {lastReceipt.customerName}
                      {lastReceipt.vipDiscountPct && lastReceipt.vipDiscountPct > 0
                        ? ` (VIP ลด ${formatNumber(lastReceipt.vipDiscountPct)}%)`
                        : ''}
                    </span>
                  </div>
                )}
                {lastReceiptContactNote && (
                  <div className="flex justify-between gap-2 text-[11px]">
                    <span className="shrink-0">ที่อยู่/ติดต่อ</span>
                    <span className="text-right font-medium wrap-break-word">
                      {lastReceiptContactNote}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>ช่องทางชำระ</span>
                  <span className="font-semibold">
                    {splitInfo.hasSplit
                      ? 'แยกจ่าย (เงินสด + QR)'
                      : creditDownInfo.hasCreditDownPayment
                      ? 'เงินเชื่อ (จ่ายสดบางส่วน)'
                      : paymentMethodLabel(lastReceipt.paymentMethod)}
                    {lastReceipt.paymentMethod === 'credit' && lastReceipt.customerName
                      ? ` (${lastReceipt.customerName})`
                      : ''}
                  </span>
                </div>
                {splitInfo.hasSplit && (
                  <>
                    <div className="flex justify-between text-[11px] tabular-nums">
                      <span>แยกจ่าย</span>
                      <span>
                        เงินสด ฿{formatNumber(splitInfo.cashPart)} + โอน QR ฿
                        {formatNumber(splitInfo.qrPart)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px] tabular-nums">
                      <span>รับเงินสด</span>
                      <span>{formatBaht(splitInfo.cashPart)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] tabular-nums">
                      <span>โอน PromptPay QR</span>
                      <span>{formatBaht(splitInfo.qrPart)}</span>
                    </div>
                  </>
                )}
                {creditDownInfo.hasCreditDownPayment && (
                  <>
                    <div className="flex justify-between text-[11px] tabular-nums">
                      <span>จ่ายสดวันนี้</span>
                      <span>{formatBaht(creditDownInfo.downPayment)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] font-semibold tabular-nums">
                      <span>คงเหลือค้างเชื่อสุทธิ</span>
                      <span>{formatBaht(creditDownInfo.netCreditRemaining)}</span>
                    </div>
                    <p className="text-[10px] tabular-nums">
                      จ่ายสดบางส่วนวันนี้ ฿{formatNumber(creditDownInfo.downPayment)} (ค้างเชื่อสุทธิ ฿
                      {formatNumber(creditDownInfo.netCreditRemaining)})
                    </p>
                  </>
                )}
                {!splitInfo.hasSplit && !creditDownInfo.hasCreditDownPayment && (
                  <div className="flex justify-between tabular-nums">
                    <span>รับเงิน</span>
                    <span>{formatBaht(lastReceipt.cashReceived)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold tabular-nums">
                  <span>เงินทอน</span>
                  <span>{formatBaht(lastReceipt.changeAmount)}</span>
                </div>
                {lastReceipt.paymentMethod === 'credit' && lastReceipt.creditDueDate && (
                  <div className="flex justify-between text-[11px] font-semibold tabular-nums">
                    <span>วันนัดชำระหนี้</span>
                    <span>{formatExpiryDateTh(lastReceipt.creditDueDate)}</span>
                  </div>
                )}
                {lastReceipt.note && (
                  <p className="pt-1 text-[11px] wrap-break-word">
                    <span className="font-bold">หมายเหตุ:</span> {lastReceipt.note}
                  </p>
                )}
              </div>
            );
          })()}

          {lastReceipt.pointsBalance !== undefined && (
            <>
              <div className="border-t border-dashed border-black my-2" />
              <div className="space-y-0.5 text-[11px] tabular-nums">
                {(lastReceipt.pointsRedeemed ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span>แต้มที่ใช้แลก</span>
                    <span>-{formatNumber(lastReceipt.pointsRedeemed ?? 0)} แต้ม</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>แต้มที่ได้รับ</span>
                  <span>+{formatNumber(lastReceipt.pointsEarned ?? 0)} แต้ม</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>แต้มสะสมคงเหลือ</span>
                  <span>{formatNumber(lastReceipt.pointsBalance)} แต้ม</span>
                </div>
              </div>
            </>
          )}

          {lastReceipt.storeCreditBalance !== undefined && (
            <>
              <div className="border-t border-dashed border-black my-2" />
              <div className="space-y-0.5 text-[11px] tabular-nums">
                {(lastReceipt.storeCreditUsed ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span>เงินฝากทอนที่ใช้</span>
                    <span>-{formatBaht(lastReceipt.storeCreditUsed ?? 0)}</span>
                  </div>
                )}
                {(lastReceipt.storeCreditDeposited ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span>ฝากเงินทอนเข้าเครดิต</span>
                    <span>+{formatBaht(lastReceipt.storeCreditDeposited ?? 0)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold">
                  <span>เงินฝากทอนคงเหลือ</span>
                  <span>{formatBaht(lastReceipt.storeCreditBalance)}</span>
                </div>
              </div>
            </>
          )}

          <div className="border-t border-dashed border-black my-2" />

          <p className="text-center text-[11px] font-medium pt-1 whitespace-pre-line">
            {effectiveReceiptFooter}
          </p>
        </div>
      )}
    </>
  );
}
