'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Plus,
  Settings,
  ArrowDownCircle,
  ArrowUpCircle,
  Award,
  Copy,
  Check,
  CheckCircle2,
  ArrowRight,
  Receipt,
  Download,
  BarChart3,
  PieChart,
  Trash2,
  Search,
  X,
  Calendar,
  Eye,
  Layers,
  Target,
  Edit3,
  Package,
  PackageX,
  Printer,
  Clock,
  ShoppingBag,
  BadgePercent,
  Users,
  Wallet,
  Truck,
  Database,
  Upload,
  RotateCcw,
  Tag,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Modal } from '@/components/Modal';
import { createClient } from '@/lib/supabase/client';
import {
  formatBaht,
  formatDateTime,
  formatExpiryDateTh,
  formatNumber,
  parseExpiryDatesMap,
  parseIsoDateUtcMs,
} from '@/lib/format';
import type {
  CartItem,
  Category,
  Customer,
  DebtPayment,
  Expense,
  PaymentMethod,
  Product,
  ProductUnit,
  Sale,
  SaleItem,
  StoreSettings,
} from '@/types/pos';

type PeriodKey = 'today' | 'yesterday' | '7days' | 'month' | 'custom';

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

const DAILY_GOAL_STORAGE_KEY = 'pos_daily_sales_goal_v1';
const DEFAULT_DAILY_GOAL = 5000;
const SUPPLIERS_STORAGE_KEY = 'inventory_suppliers_v1';
const EXPIRY_DATES_STORAGE_KEY = 'inventory_expiry_dates_v1';

// Additional POS, Inventory, Customer & Shift localStorage keys for Master All-in-One Backup
const POS_PINNED_STORAGE_KEY = 'pos_pinned_product_ids_v1';
const POS_BUNDLES_STORAGE_KEY = 'pos_bundles_v1';
const POS_RECEIPT_FOOTER_STORAGE_KEY = 'pos_receipt_footer_v1';
const POS_CONTAINER_DEPOSITS_STORAGE_KEY = 'pos_container_deposits_v1';
const POS_HELD_BILLS_STORAGE_KEY = 'pos_held_bills_v1';
const POS_SOUND_ENABLED_STORAGE_KEY = 'pos_sound_enabled_v1';
const POS_GRID_DENSITY_STORAGE_KEY = 'pos_grid_density_v1';
const POS_SHIFT_HANDOVER_MEMO_STORAGE_KEY = 'pos_shift_handover_memo_v1';
const POS_MISC_PRESETS_STORAGE_KEY = 'pos_misc_presets_v1';
const MASTER_DEFAULT_RECEIPT_FOOTER = 'ขอบคุณที่อุดหนุนครับ/ค่ะ โอกาสหน้าเชิญใหม่';

const INVENTORY_SHELF_LOCATIONS_STORAGE_KEY = 'inventory_shelf_locations_v1';
const INVENTORY_ORDER_PACK_INFO_STORAGE_KEY = 'inventory_order_pack_info_v1';
const INVENTORY_WHOLESALE_TIERS_STORAGE_KEY = 'inventory_wholesale_tiers_v1';
const INVENTORY_SUBSTITUTE_NOTES_STORAGE_KEY = 'inventory_substitute_notes_v1';
const INVENTORY_UNIT_BARCODES_STORAGE_KEY = 'inventory_unit_barcodes_v1';
const INVENTORY_LAST_COST_HISTORY_STORAGE_KEY = 'inventory_last_cost_history_v1';
const INVENTORY_TARGET_STOCK_STORAGE_KEY = 'inventory_target_stock_v1';
const INVENTORY_PROMO_LABELS_STORAGE_KEY = 'inventory_promo_labels_v1';

const CUSTOMER_CREDIT_LIMITS_STORAGE_KEY = 'customer_credit_limits_v1';
const CUSTOMER_STORE_CREDIT_STORAGE_KEY = 'customer_store_credit_v1';
const CUSTOMER_LOYALTY_POINTS_STORAGE_KEY = 'customer_loyalty_points_v1';
const CUSTOMER_DEFAULT_DISCOUNT_PCT_STORAGE_KEY = 'customer_default_discount_pct_v1';
const CUSTOMER_LAST_REMINDED_STORAGE_KEY = 'customer_last_reminded_v1';
const CUSTOMER_DUE_DATES_STORAGE_KEY = 'customer_due_dates_v1';
const CUSTOMER_CONTACT_NOTES_STORAGE_KEY = 'customer_contact_notes_v1';
const CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY = 'customer_followup_logs_v1';
const CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY = 'customer_payday_cycles_v1';
const CUSTOMER_TAGS_STORAGE_KEY = 'customer_tags_v1';

const SHIFT_CASHIER_NAMES_STORAGE_KEY = 'shift_cashier_names_v1';
const SHIFT_NEXT_FLOATS_STORAGE_KEY = 'shift_next_floats_v1';
const SHIFT_SALES_TARGET_STORAGE_KEY = 'shift_sales_target_v1';
const SHIFT_VARIANCE_REASONS_STORAGE_KEY = 'shift_variance_reasons_v1';
const DEFAULT_SHIFT_SALES_TARGET = 3000;

const MASTER_KNOWN_KEYS = [
  DAILY_GOAL_STORAGE_KEY,
  POS_PINNED_STORAGE_KEY,
  POS_BUNDLES_STORAGE_KEY,
  POS_RECEIPT_FOOTER_STORAGE_KEY,
  POS_CONTAINER_DEPOSITS_STORAGE_KEY,
  POS_HELD_BILLS_STORAGE_KEY,
  POS_SOUND_ENABLED_STORAGE_KEY,
  POS_GRID_DENSITY_STORAGE_KEY,
  POS_SHIFT_HANDOVER_MEMO_STORAGE_KEY,
  POS_MISC_PRESETS_STORAGE_KEY,
  EXPIRY_DATES_STORAGE_KEY,
  SUPPLIERS_STORAGE_KEY,
  INVENTORY_SHELF_LOCATIONS_STORAGE_KEY,
  INVENTORY_ORDER_PACK_INFO_STORAGE_KEY,
  INVENTORY_WHOLESALE_TIERS_STORAGE_KEY,
  INVENTORY_SUBSTITUTE_NOTES_STORAGE_KEY,
  INVENTORY_UNIT_BARCODES_STORAGE_KEY,
  INVENTORY_LAST_COST_HISTORY_STORAGE_KEY,
  INVENTORY_TARGET_STOCK_STORAGE_KEY,
  INVENTORY_PROMO_LABELS_STORAGE_KEY,
  CUSTOMER_CREDIT_LIMITS_STORAGE_KEY,
  CUSTOMER_STORE_CREDIT_STORAGE_KEY,
  CUSTOMER_LOYALTY_POINTS_STORAGE_KEY,
  CUSTOMER_DEFAULT_DISCOUNT_PCT_STORAGE_KEY,
  CUSTOMER_LAST_REMINDED_STORAGE_KEY,
  CUSTOMER_DUE_DATES_STORAGE_KEY,
  CUSTOMER_CONTACT_NOTES_STORAGE_KEY,
  CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY,
  CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY,
  CUSTOMER_TAGS_STORAGE_KEY,
  SHIFT_CASHIER_NAMES_STORAGE_KEY,
  SHIFT_NEXT_FLOATS_STORAGE_KEY,
  SHIFT_SALES_TARGET_STORAGE_KEY,
  SHIFT_VARIANCE_REASONS_STORAGE_KEY,
] as const;

type MasterKnownKey = (typeof MASTER_KNOWN_KEYS)[number];

const MASTER_KNOWN_KEY_SET = new Set<string>(MASTER_KNOWN_KEYS);
const isMasterPrefixKey = (key: string): boolean =>
  key.startsWith('pos_') ||
  key.startsWith('inventory_') ||
  key.startsWith('customer_') ||
  key.startsWith('shift_');

interface MasterPosBundleItem {
  product_id: string;
  unit_id?: string | null;
  qty: number;
}

interface MasterPosBundle {
  id: string;
  name: string;
  items: MasterPosBundleItem[];
}

interface MasterContainerDeposit {
  id: string;
  customerName: string;
  itemLabel: string;
  qty: number;
  depositAmount: number;
  createdAt: string;
}

interface MasterHeldBill {
  id: string;
  items: CartItem[];
  total: number;
  count: number;
  note: string;
  tag?: string;
  orderType?: 'walk_in' | 'pickup' | 'delivery';
  deliveryInfo?: string;
  customerId?: string;
  customerName?: string;
  itemNotes?: Record<string, string>;
  createdAt: string;
}

interface MasterCostHistoryEntry {
  prevCost: number;
  updatedAt: string;
}

interface MasterWholesaleTier {
  minQty: number;
  unitPrice: number;
}

interface MasterShiftHandoverMemo {
  text: string;
  author: string;
  updatedAt: string;
  urgent: boolean;
}

type MasterFlexibleJson = Record<string, unknown> | unknown[];

interface MasterBackupData {
  [DAILY_GOAL_STORAGE_KEY]: number;
  [POS_PINNED_STORAGE_KEY]: string[];
  [POS_BUNDLES_STORAGE_KEY]: MasterPosBundle[];
  [POS_RECEIPT_FOOTER_STORAGE_KEY]: string;
  [POS_CONTAINER_DEPOSITS_STORAGE_KEY]: MasterContainerDeposit[];
  [POS_HELD_BILLS_STORAGE_KEY]: MasterHeldBill[];
  [POS_SOUND_ENABLED_STORAGE_KEY]: boolean;
  [POS_GRID_DENSITY_STORAGE_KEY]: 'large' | 'compact';
  [POS_SHIFT_HANDOVER_MEMO_STORAGE_KEY]: MasterShiftHandoverMemo | null;
  [POS_MISC_PRESETS_STORAGE_KEY]: MasterFlexibleJson;
  [EXPIRY_DATES_STORAGE_KEY]: Record<string, string>;
  [SUPPLIERS_STORAGE_KEY]: Record<string, string>;
  [INVENTORY_SHELF_LOCATIONS_STORAGE_KEY]: Record<string, string>;
  [INVENTORY_ORDER_PACK_INFO_STORAGE_KEY]: Record<string, string>;
  [INVENTORY_WHOLESALE_TIERS_STORAGE_KEY]: Record<string, MasterWholesaleTier>;
  [INVENTORY_SUBSTITUTE_NOTES_STORAGE_KEY]: Record<string, string>;
  [INVENTORY_UNIT_BARCODES_STORAGE_KEY]: MasterFlexibleJson;
  [INVENTORY_LAST_COST_HISTORY_STORAGE_KEY]: Record<string, MasterCostHistoryEntry>;
  [INVENTORY_TARGET_STOCK_STORAGE_KEY]: Record<string, number>;
  [INVENTORY_PROMO_LABELS_STORAGE_KEY]: Record<string, string>;
  [CUSTOMER_CREDIT_LIMITS_STORAGE_KEY]: Record<string, number>;
  [CUSTOMER_STORE_CREDIT_STORAGE_KEY]: Record<string, number>;
  [CUSTOMER_LOYALTY_POINTS_STORAGE_KEY]: Record<string, number>;
  [CUSTOMER_DEFAULT_DISCOUNT_PCT_STORAGE_KEY]: Record<string, number>;
  [CUSTOMER_LAST_REMINDED_STORAGE_KEY]: Record<string, string>;
  [CUSTOMER_DUE_DATES_STORAGE_KEY]: Record<string, string>;
  [CUSTOMER_CONTACT_NOTES_STORAGE_KEY]: Record<string, string>;
  [CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY]: MasterFlexibleJson;
  [CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY]: MasterFlexibleJson;
  [CUSTOMER_TAGS_STORAGE_KEY]: Record<string, string>;
  [SHIFT_CASHIER_NAMES_STORAGE_KEY]: Record<string, string>;
  [SHIFT_NEXT_FLOATS_STORAGE_KEY]: Record<string, number>;
  [SHIFT_SALES_TARGET_STORAGE_KEY]: number;
  [SHIFT_VARIANCE_REASONS_STORAGE_KEY]: Record<string, string>;
}

interface MasterBackupSnapshot {
  data: MasterBackupData;
  extraKeys: Record<string, unknown>;
  populatedKeys: string[];
}

interface MasterBackupParsed {
  keysPresent: string[];
  data: Partial<MasterBackupData>;
  extraKeys: Record<string, unknown>;
  error?: string;
}

type ExpiryStatus = 'expired' | 'expiring_soon' | 'normal';

interface ExpiryInfo {
  expiryIso: string;
  formattedDate: string;
  daysRemaining: number;
  status: ExpiryStatus;
}

interface StockAdjustmentMovement {
  id: string;
  product_id: string;
  type: 'sale' | 'restock' | 'adjust';
  qty_change: number;
  note: string | null;
  created_at: string;
  products?:
    | {
        name: string;
        base_unit: string;
        cost_price: number;
      }
    | Array<{
        name: string;
        base_unit: string;
        cost_price: number;
      }>
    | null;
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

function isPlainRecordObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function parseTrimmedTextMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecordObject(parsed)) return {};
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          clean[key] = trimmed;
        }
      }
    }
    return clean;
  } catch {
    return {};
  }
}

const parseSupplierMap = parseTrimmedTextMap;

function parseIsoTimestampMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecordObject(parsed)) return {};
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed && Number.isFinite(Date.parse(trimmed))) {
          clean[key] = trimmed;
        }
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function parseNumberMap(
  raw: string | null,
  options: { allowZero?: boolean; roundDecimals?: number; integer?: boolean; max?: number } = {}
): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecordObject(parsed)) return {};
    const clean: Record<string, number> = {};
    const factor =
      options.roundDecimals !== undefined ? Math.pow(10, options.roundDecimals) : null;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) {
        continue;
      }
      let num = Number(value);
      if (!Number.isFinite(num)) continue;
      if (options.integer) num = Math.floor(num);
      else if (factor !== null) num = Math.round(num * factor) / factor;
      if (options.allowZero ? num < 0 : num <= 0) continue;
      if (options.max !== undefined && num > options.max) num = options.max;
      clean[key] = num;
    }
    return clean;
  } catch {
    return {};
  }
}

function parseWholesaleTiersMap(raw: string | null): Record<string, MasterWholesaleTier> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecordObject(parsed)) return {};
    const clean: Record<string, MasterWholesaleTier> = {};
    for (const [productId, value] of Object.entries(parsed)) {
      const trimmedId = productId.trim();
      if (!trimmedId || !isPlainRecordObject(value)) continue;
      const minQty = Math.floor(Number(value.minQty));
      const unitPrice = Math.round(Number(value.unitPrice) * 100) / 100;
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

function parsePinnedProductIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
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

function parseMasterPosBundles(raw: string | null): MasterPosBundle[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const bundles: MasterPosBundle[] = [];
    for (const entry of parsed) {
      if (!isPlainRecordObject(entry)) continue;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (!id || !name || !Array.isArray(entry.items)) continue;
      const items: MasterPosBundleItem[] = [];
      for (const rawItem of entry.items) {
        if (!isPlainRecordObject(rawItem)) continue;
        const productId =
          typeof rawItem.product_id === 'string' ? rawItem.product_id.trim() : '';
        const qty = Math.floor(Number(rawItem.qty));
        if (!productId || !Number.isFinite(qty) || qty <= 0) continue;
        const unitId =
          typeof rawItem.unit_id === 'string' && rawItem.unit_id.trim()
            ? rawItem.unit_id.trim()
            : null;
        items.push({ product_id: productId, unit_id: unitId, qty });
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

function parseMasterContainerDeposits(raw: string | null): MasterContainerDeposit[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const list: MasterContainerDeposit[] = [];
    for (const entry of parsed) {
      if (!isPlainRecordObject(entry)) continue;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      const customerName =
        typeof entry.customerName === 'string' ? entry.customerName.trim() : '';
      const itemLabel =
        typeof entry.itemLabel === 'string' ? entry.itemLabel.trim() : '';
      const qty = Number(entry.qty);
      const depositAmount = Number(entry.depositAmount);
      const createdAt =
        typeof entry.createdAt === 'string' ? entry.createdAt.trim() : '';
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

function parseMasterHeldBills(raw: string | null): MasterHeldBill[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const bills: MasterHeldBill[] = [];
    for (const entry of parsed) {
      if (!isPlainRecordObject(entry)) continue;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      const createdAt =
        typeof entry.createdAt === 'string' ? entry.createdAt.trim() : '';
      if (!id || !createdAt || !Array.isArray(entry.items)) continue;
      const items: CartItem[] = [];
      for (const rawItem of entry.items) {
        if (!isPlainRecordObject(rawItem)) continue;
        const key = typeof rawItem.key === 'string' ? rawItem.key.trim() : '';
        const productName =
          typeof rawItem.product_name === 'string' ? rawItem.product_name.trim() : '';
        const unitName =
          typeof rawItem.unit_name === 'string' ? rawItem.unit_name.trim() : '';
        const qty = Number(rawItem.qty);
        const unitPrice = Number(rawItem.unit_price);
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
          product_id: typeof rawItem.product_id === 'string' ? rawItem.product_id : null,
          product_name: productName,
          unit_name: unitName,
          conversion_rate: Number.isFinite(Number(rawItem.conversion_rate))
            ? Number(rawItem.conversion_rate)
            : 1,
          unit_price: unitPrice,
          unit_cost: Number.isFinite(Number(rawItem.unit_cost))
            ? Number(rawItem.unit_cost)
            : 0,
          qty,
          available_units: Array.isArray(rawItem.available_units)
            ? (rawItem.available_units as ProductUnit[])
            : undefined,
        });
      }
      if (items.length === 0) continue;
      const computedTotal = items.reduce((sum, it) => sum + it.unit_price * it.qty, 0);
      const computedCount = items.reduce((sum, it) => sum + it.qty, 0);
      let itemNotes: Record<string, string> | undefined;
      if (isPlainRecordObject(entry.itemNotes)) {
        const cleanNotes: Record<string, string> = {};
        for (const [k, v] of Object.entries(entry.itemNotes)) {
          if (typeof v === 'string' && v.trim()) {
            cleanNotes[k] = v.trim();
          }
        }
        if (Object.keys(cleanNotes).length > 0) {
          itemNotes = cleanNotes;
        }
      }
      bills.push({
        id,
        items,
        total: Number.isFinite(Number(entry.total)) ? Number(entry.total) : computedTotal,
        count: Number.isFinite(Number(entry.count)) ? Number(entry.count) : computedCount,
        note: typeof entry.note === 'string' ? entry.note : '',
        tag:
          typeof entry.tag === 'string' && entry.tag.trim()
            ? entry.tag.trim()
            : undefined,
        orderType:
          entry.orderType === 'walk_in' ||
          entry.orderType === 'pickup' ||
          entry.orderType === 'delivery'
            ? entry.orderType
            : undefined,
        deliveryInfo:
          typeof entry.deliveryInfo === 'string' && entry.deliveryInfo.trim()
            ? entry.deliveryInfo.trim()
            : undefined,
        customerId:
          typeof entry.customerId === 'string' && entry.customerId.trim()
            ? entry.customerId.trim()
            : undefined,
        customerName:
          typeof entry.customerName === 'string' && entry.customerName.trim()
            ? entry.customerName.trim()
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

function parseDailyGoalValue(val: unknown): number | null {
  if (typeof val === 'number') {
    return Number.isFinite(val) && val > 0 ? Math.round(val * 100) / 100 : null;
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const num = Number(val.trim());
    return Number.isFinite(num) && num > 0 ? Math.round(num * 100) / 100 : null;
  }
  return null;
}

function parseSoundEnabledValue(val: unknown): boolean | null {
  if (typeof val === 'boolean') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  return null;
}

function parseGridDensityValue(val: unknown): 'large' | 'compact' | null {
  if (val === 'large' || val === 'compact') return val;
  return null;
}

function parseShiftHandoverMemoValue(val: unknown): MasterShiftHandoverMemo | null {
  if (!val) return null;
  let obj: unknown = val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!isPlainRecordObject(obj)) return null;
  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!text) return null;
  return {
    text,
    author: typeof obj.author === 'string' ? obj.author.trim() : '',
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt.trim() : '',
    urgent: Boolean(obj.urgent),
  };
}

function parseCostHistoryMap(raw: string | null): Record<string, MasterCostHistoryEntry> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecordObject(parsed)) return {};
    const out: Record<string, MasterCostHistoryEntry> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!isPlainRecordObject(v)) continue;
      const prevCost = Number(v.prevCost);
      const updatedAt = typeof v.updatedAt === 'string' ? v.updatedAt.trim() : '';
      if (!Number.isFinite(prevCost) || prevCost < 0) continue;
      out[k] = {
        prevCost: Math.round(prevCost * 100) / 100,
        updatedAt,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function parseFlexibleJsonContainer(raw: string | null): MasterFlexibleJson {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) || isPlainRecordObject(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function readMasterBackupFromStorage(): MasterBackupSnapshot {
  const getRaw = (key: string): string | null => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const goalVal = parseDailyGoalValue(getRaw(DAILY_GOAL_STORAGE_KEY)) ?? DEFAULT_DAILY_GOAL;
  const rawFooter = getRaw(POS_RECEIPT_FOOTER_STORAGE_KEY);
  const receiptFooter =
    rawFooter !== null && rawFooter.trim() !== ''
      ? rawFooter
      : MASTER_DEFAULT_RECEIPT_FOOTER;
  const soundEnabled = parseSoundEnabledValue(getRaw(POS_SOUND_ENABLED_STORAGE_KEY)) ?? true;
  const gridDensity = parseGridDensityValue(getRaw(POS_GRID_DENSITY_STORAGE_KEY)) ?? 'large';
  const shiftSalesTargetVal =
    parseDailyGoalValue(getRaw(SHIFT_SALES_TARGET_STORAGE_KEY)) ?? DEFAULT_SHIFT_SALES_TARGET;

  const data: MasterBackupData = {
    [DAILY_GOAL_STORAGE_KEY]: goalVal,
    [POS_PINNED_STORAGE_KEY]: parsePinnedProductIds(getRaw(POS_PINNED_STORAGE_KEY)),
    [POS_BUNDLES_STORAGE_KEY]: parseMasterPosBundles(getRaw(POS_BUNDLES_STORAGE_KEY)),
    [POS_RECEIPT_FOOTER_STORAGE_KEY]: receiptFooter,
    [POS_CONTAINER_DEPOSITS_STORAGE_KEY]: parseMasterContainerDeposits(
      getRaw(POS_CONTAINER_DEPOSITS_STORAGE_KEY)
    ),
    [POS_HELD_BILLS_STORAGE_KEY]: parseMasterHeldBills(getRaw(POS_HELD_BILLS_STORAGE_KEY)),
    [POS_SOUND_ENABLED_STORAGE_KEY]: soundEnabled,
    [POS_GRID_DENSITY_STORAGE_KEY]: gridDensity,
    [POS_SHIFT_HANDOVER_MEMO_STORAGE_KEY]: parseShiftHandoverMemoValue(
      getRaw(POS_SHIFT_HANDOVER_MEMO_STORAGE_KEY)
    ),
    [POS_MISC_PRESETS_STORAGE_KEY]: parseFlexibleJsonContainer(
      getRaw(POS_MISC_PRESETS_STORAGE_KEY)
    ),
    [EXPIRY_DATES_STORAGE_KEY]: parseExpiryDatesMap(getRaw(EXPIRY_DATES_STORAGE_KEY)),
    [SUPPLIERS_STORAGE_KEY]: parseTrimmedTextMap(getRaw(SUPPLIERS_STORAGE_KEY)),
    [INVENTORY_SHELF_LOCATIONS_STORAGE_KEY]: parseTrimmedTextMap(
      getRaw(INVENTORY_SHELF_LOCATIONS_STORAGE_KEY)
    ),
    [INVENTORY_ORDER_PACK_INFO_STORAGE_KEY]: parseTrimmedTextMap(
      getRaw(INVENTORY_ORDER_PACK_INFO_STORAGE_KEY)
    ),
    [INVENTORY_WHOLESALE_TIERS_STORAGE_KEY]: parseWholesaleTiersMap(
      getRaw(INVENTORY_WHOLESALE_TIERS_STORAGE_KEY)
    ),
    [INVENTORY_SUBSTITUTE_NOTES_STORAGE_KEY]: parseTrimmedTextMap(
      getRaw(INVENTORY_SUBSTITUTE_NOTES_STORAGE_KEY)
    ),
    [INVENTORY_UNIT_BARCODES_STORAGE_KEY]: parseFlexibleJsonContainer(
      getRaw(INVENTORY_UNIT_BARCODES_STORAGE_KEY)
    ),
    [INVENTORY_LAST_COST_HISTORY_STORAGE_KEY]: parseCostHistoryMap(
      getRaw(INVENTORY_LAST_COST_HISTORY_STORAGE_KEY)
    ),
    [INVENTORY_TARGET_STOCK_STORAGE_KEY]: parseNumberMap(
      getRaw(INVENTORY_TARGET_STOCK_STORAGE_KEY),
      { roundDecimals: 2 }
    ),
    [INVENTORY_PROMO_LABELS_STORAGE_KEY]: parseTrimmedTextMap(
      getRaw(INVENTORY_PROMO_LABELS_STORAGE_KEY)
    ),
    [CUSTOMER_CREDIT_LIMITS_STORAGE_KEY]: parseNumberMap(
      getRaw(CUSTOMER_CREDIT_LIMITS_STORAGE_KEY)
    ),
    [CUSTOMER_STORE_CREDIT_STORAGE_KEY]: parseNumberMap(
      getRaw(CUSTOMER_STORE_CREDIT_STORAGE_KEY),
      { roundDecimals: 2 }
    ),
    [CUSTOMER_LOYALTY_POINTS_STORAGE_KEY]: parseNumberMap(
      getRaw(CUSTOMER_LOYALTY_POINTS_STORAGE_KEY),
      { integer: true }
    ),
    [CUSTOMER_DEFAULT_DISCOUNT_PCT_STORAGE_KEY]: parseNumberMap(
      getRaw(CUSTOMER_DEFAULT_DISCOUNT_PCT_STORAGE_KEY),
      { roundDecimals: 2, max: 100 }
    ),
    [CUSTOMER_LAST_REMINDED_STORAGE_KEY]: parseIsoTimestampMap(
      getRaw(CUSTOMER_LAST_REMINDED_STORAGE_KEY)
    ),
    [CUSTOMER_DUE_DATES_STORAGE_KEY]: parseExpiryDatesMap(
      getRaw(CUSTOMER_DUE_DATES_STORAGE_KEY)
    ),
    [CUSTOMER_CONTACT_NOTES_STORAGE_KEY]: parseTrimmedTextMap(
      getRaw(CUSTOMER_CONTACT_NOTES_STORAGE_KEY)
    ),
    [CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY]: parseFlexibleJsonContainer(
      getRaw(CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY)
    ),
    [CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY]: parseFlexibleJsonContainer(
      getRaw(CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY)
    ),
    [CUSTOMER_TAGS_STORAGE_KEY]: parseTrimmedTextMap(
      getRaw(CUSTOMER_TAGS_STORAGE_KEY)
    ),
    [SHIFT_CASHIER_NAMES_STORAGE_KEY]: parseTrimmedTextMap(
      getRaw(SHIFT_CASHIER_NAMES_STORAGE_KEY)
    ),
    [SHIFT_NEXT_FLOATS_STORAGE_KEY]: parseNumberMap(
      getRaw(SHIFT_NEXT_FLOATS_STORAGE_KEY),
      { allowZero: true, roundDecimals: 2 }
    ),
    [SHIFT_SALES_TARGET_STORAGE_KEY]: shiftSalesTargetVal,
    [SHIFT_VARIANCE_REASONS_STORAGE_KEY]: parseTrimmedTextMap(
      getRaw(SHIFT_VARIANCE_REASONS_STORAGE_KEY)
    ),
  };

  const extraKeys: Record<string, unknown> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (!k || MASTER_KNOWN_KEY_SET.has(k) || !isMasterPrefixKey(k)) continue;
      const rawVal = window.localStorage.getItem(k);
      if (rawVal === null) continue;
      try {
        extraKeys[k] = JSON.parse(rawVal);
      } catch {
        extraKeys[k] = rawVal;
      }
    }
  } catch {
    // ignore storage iteration errors
  }

  const populatedKeys: string[] = [];
  const hasNonEmptyRaw = (key: string): boolean => {
    const raw = getRaw(key);
    return raw !== null && raw.trim() !== '';
  };
  const countContainerEntries = (val: MasterFlexibleJson): number =>
    Array.isArray(val) ? val.length : Object.keys(val).length;

  for (const key of MASTER_KNOWN_KEYS) {
    if (
      key === DAILY_GOAL_STORAGE_KEY ||
      key === POS_RECEIPT_FOOTER_STORAGE_KEY ||
      key === POS_SOUND_ENABLED_STORAGE_KEY ||
      key === POS_GRID_DENSITY_STORAGE_KEY ||
      key === SHIFT_SALES_TARGET_STORAGE_KEY
    ) {
      if (hasNonEmptyRaw(key)) populatedKeys.push(key);
    } else if (key === POS_SHIFT_HANDOVER_MEMO_STORAGE_KEY) {
      if (data[POS_SHIFT_HANDOVER_MEMO_STORAGE_KEY] !== null) populatedKeys.push(key);
    } else if (
      key === POS_PINNED_STORAGE_KEY ||
      key === POS_BUNDLES_STORAGE_KEY ||
      key === POS_CONTAINER_DEPOSITS_STORAGE_KEY ||
      key === POS_HELD_BILLS_STORAGE_KEY
    ) {
      if (data[key].length > 0) populatedKeys.push(key);
    } else if (
      key === POS_MISC_PRESETS_STORAGE_KEY ||
      key === INVENTORY_UNIT_BARCODES_STORAGE_KEY ||
      key === CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY ||
      key === CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY
    ) {
      if (countContainerEntries(data[key]) > 0) populatedKeys.push(key);
    } else {
      const recordVal = data[key] as Record<string, unknown>;
      if (Object.keys(recordVal).length > 0) populatedKeys.push(key);
    }
  }

  return { data, extraKeys, populatedKeys };
}

const MASTER_RECORD_PARSERS: Readonly<
  Record<
    | typeof EXPIRY_DATES_STORAGE_KEY
    | typeof SUPPLIERS_STORAGE_KEY
    | typeof INVENTORY_SHELF_LOCATIONS_STORAGE_KEY
    | typeof INVENTORY_ORDER_PACK_INFO_STORAGE_KEY
    | typeof INVENTORY_WHOLESALE_TIERS_STORAGE_KEY
    | typeof INVENTORY_SUBSTITUTE_NOTES_STORAGE_KEY
    | typeof INVENTORY_LAST_COST_HISTORY_STORAGE_KEY
    | typeof INVENTORY_TARGET_STOCK_STORAGE_KEY
    | typeof INVENTORY_PROMO_LABELS_STORAGE_KEY
    | typeof CUSTOMER_CREDIT_LIMITS_STORAGE_KEY
    | typeof CUSTOMER_STORE_CREDIT_STORAGE_KEY
    | typeof CUSTOMER_LOYALTY_POINTS_STORAGE_KEY
    | typeof CUSTOMER_DEFAULT_DISCOUNT_PCT_STORAGE_KEY
    | typeof CUSTOMER_LAST_REMINDED_STORAGE_KEY
    | typeof CUSTOMER_DUE_DATES_STORAGE_KEY
    | typeof CUSTOMER_CONTACT_NOTES_STORAGE_KEY
    | typeof CUSTOMER_TAGS_STORAGE_KEY
    | typeof SHIFT_CASHIER_NAMES_STORAGE_KEY
    | typeof SHIFT_NEXT_FLOATS_STORAGE_KEY
    | typeof SHIFT_VARIANCE_REASONS_STORAGE_KEY,
    (raw: string | null) => Record<string, unknown>
  >
> = {
  [EXPIRY_DATES_STORAGE_KEY]: parseExpiryDatesMap,
  [SUPPLIERS_STORAGE_KEY]: parseTrimmedTextMap,
  [INVENTORY_SHELF_LOCATIONS_STORAGE_KEY]: parseTrimmedTextMap,
  [INVENTORY_ORDER_PACK_INFO_STORAGE_KEY]: parseTrimmedTextMap,
  [INVENTORY_WHOLESALE_TIERS_STORAGE_KEY]: parseWholesaleTiersMap,
  [INVENTORY_SUBSTITUTE_NOTES_STORAGE_KEY]: parseTrimmedTextMap,
  [INVENTORY_LAST_COST_HISTORY_STORAGE_KEY]: parseCostHistoryMap,
  [INVENTORY_TARGET_STOCK_STORAGE_KEY]: (raw) => parseNumberMap(raw, { roundDecimals: 2 }),
  [INVENTORY_PROMO_LABELS_STORAGE_KEY]: parseTrimmedTextMap,
  [CUSTOMER_CREDIT_LIMITS_STORAGE_KEY]: (raw) => parseNumberMap(raw),
  [CUSTOMER_STORE_CREDIT_STORAGE_KEY]: (raw) =>
    parseNumberMap(raw, { roundDecimals: 2 }),
  [CUSTOMER_LOYALTY_POINTS_STORAGE_KEY]: (raw) => parseNumberMap(raw, { integer: true }),
  [CUSTOMER_DEFAULT_DISCOUNT_PCT_STORAGE_KEY]: (raw) =>
    parseNumberMap(raw, { roundDecimals: 2, max: 100 }),
  [CUSTOMER_LAST_REMINDED_STORAGE_KEY]: parseIsoTimestampMap,
  [CUSTOMER_DUE_DATES_STORAGE_KEY]: parseExpiryDatesMap,
  [CUSTOMER_CONTACT_NOTES_STORAGE_KEY]: parseTrimmedTextMap,
  [CUSTOMER_TAGS_STORAGE_KEY]: parseTrimmedTextMap,
  [SHIFT_CASHIER_NAMES_STORAGE_KEY]: parseTrimmedTextMap,
  [SHIFT_NEXT_FLOATS_STORAGE_KEY]: (raw) =>
    parseNumberMap(raw, { allowZero: true, roundDecimals: 2 }),
  [SHIFT_VARIANCE_REASONS_STORAGE_KEY]: parseTrimmedTextMap,
};

function parseMasterBackupJson(rawText: string): MasterBackupParsed {
  const cleaned = rawText.replace(/^\uFEFF/, '').trim();
  if (!cleaned) {
    return {
      keysPresent: [],
      data: {},
      extraKeys: {},
      error: 'กรุณาวางข้อความ JSON หรือเลือกไฟล์ .json ก่อนกู้คืนข้อมูล',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      keysPresent: [],
      data: {},
      extraKeys: {},
      error: 'รูปแบบ JSON ไม่ถูกต้อง กรุณาตรวจสอบไฟล์หรือข้อความที่วาง',
    };
  }

  if (!isPlainRecordObject(parsed)) {
    return {
      keysPresent: [],
      data: {},
      extraKeys: {},
      error: 'ข้อมูล JSON ต้องอยู่ในรูปแบบ Object ({ ... })',
    };
  }

  const hasRootKnownKey = Object.keys(parsed).some(
    (k) => MASTER_KNOWN_KEY_SET.has(k) || isMasterPrefixKey(k)
  );
  const source: Record<string, unknown> =
    !hasRootKnownKey && isPlainRecordObject(parsed.data) ? parsed.data : parsed;

  const keysPresent: string[] = [];
  const data: Partial<MasterBackupData> = {};
  const extraKeys: Record<string, unknown> = {};

  for (const key of MASTER_KNOWN_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const rawVal = source[key];

    if (key === DAILY_GOAL_STORAGE_KEY) {
      const goalVal = parseDailyGoalValue(rawVal);
      if (goalVal === null) {
        return {
          keysPresent: [],
          data: {},
          extraKeys: {},
          error: `ข้อมูลของ "${key}" ต้องเป็นตัวเลขมากกว่า 0`,
        };
      }
      keysPresent.push(key);
      data[DAILY_GOAL_STORAGE_KEY] = goalVal;
      continue;
    }

    if (key === SHIFT_SALES_TARGET_STORAGE_KEY) {
      const targetVal = parseDailyGoalValue(rawVal);
      if (targetVal === null) {
        return {
          keysPresent: [],
          data: {},
          extraKeys: {},
          error: `ข้อมูลของ "${key}" ต้องเป็นตัวเลขมากกว่า 0`,
        };
      }
      keysPresent.push(key);
      data[SHIFT_SALES_TARGET_STORAGE_KEY] = targetVal;
      continue;
    }

    if (key === POS_SOUND_ENABLED_STORAGE_KEY) {
      const soundVal = parseSoundEnabledValue(rawVal);
      if (soundVal === null) {
        return {
          keysPresent: [],
          data: {},
          extraKeys: {},
          error: `ข้อมูลของ "${key}" ต้องเป็นค่า true หรือ false`,
        };
      }
      keysPresent.push(key);
      data[POS_SOUND_ENABLED_STORAGE_KEY] = soundVal;
      continue;
    }

    if (key === POS_GRID_DENSITY_STORAGE_KEY) {
      const densityVal = parseGridDensityValue(rawVal);
      if (densityVal === null) {
        return {
          keysPresent: [],
          data: {},
          extraKeys: {},
          error: `ข้อมูลของ "${key}" ต้องเป็น "large" หรือ "compact"`,
        };
      }
      keysPresent.push(key);
      data[POS_GRID_DENSITY_STORAGE_KEY] = densityVal;
      continue;
    }

    if (key === POS_RECEIPT_FOOTER_STORAGE_KEY) {
      if (typeof rawVal !== 'string') {
        return {
          keysPresent: [],
          data: {},
          extraKeys: {},
          error: `ข้อมูลของ "${key}" ต้องเป็นข้อความ (String)`,
        };
      }
      keysPresent.push(key);
      data[POS_RECEIPT_FOOTER_STORAGE_KEY] =
        rawVal.trim() || MASTER_DEFAULT_RECEIPT_FOOTER;
      continue;
    }

    if (key === POS_SHIFT_HANDOVER_MEMO_STORAGE_KEY) {
      if (rawVal !== null && !isPlainRecordObject(rawVal)) {
        return {
          keysPresent: [],
          data: {},
          extraKeys: {},
          error: `ข้อมูลของ "${key}" ต้องเป็น Object ({ ... }) หรือ null`,
        };
      }
      keysPresent.push(key);
      data[POS_SHIFT_HANDOVER_MEMO_STORAGE_KEY] = parseShiftHandoverMemoValue(rawVal);
      continue;
    }

    if (
      key === POS_MISC_PRESETS_STORAGE_KEY ||
      key === INVENTORY_UNIT_BARCODES_STORAGE_KEY ||
      key === CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY ||
      key === CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY
    ) {
      if (!Array.isArray(rawVal) && !isPlainRecordObject(rawVal)) {
        return {
          keysPresent: [],
          data: {},
          extraKeys: {},
          error: `ข้อมูลของ "${key}" ต้องเป็น Object ({ ... }) หรือ Array ([ ... ])`,
        };
      }
      keysPresent.push(key);
      if (key === POS_MISC_PRESETS_STORAGE_KEY) {
        data[POS_MISC_PRESETS_STORAGE_KEY] = rawVal;
      } else if (key === INVENTORY_UNIT_BARCODES_STORAGE_KEY) {
        data[INVENTORY_UNIT_BARCODES_STORAGE_KEY] = rawVal;
      } else if (key === CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY) {
        data[CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY] = rawVal;
      } else {
        data[CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY] = rawVal;
      }
      continue;
    }

    if (
      key === POS_PINNED_STORAGE_KEY ||
      key === POS_BUNDLES_STORAGE_KEY ||
      key === POS_CONTAINER_DEPOSITS_STORAGE_KEY ||
      key === POS_HELD_BILLS_STORAGE_KEY
    ) {
      if (!Array.isArray(rawVal)) {
        return {
          keysPresent: [],
          data: {},
          extraKeys: {},
          error: `ข้อมูลของ "${key}" ต้องเป็น Array ([ ... ])`,
        };
      }
      keysPresent.push(key);
      const serialized = JSON.stringify(rawVal);
      if (key === POS_PINNED_STORAGE_KEY) {
        data[POS_PINNED_STORAGE_KEY] = parsePinnedProductIds(serialized);
      } else if (key === POS_BUNDLES_STORAGE_KEY) {
        data[POS_BUNDLES_STORAGE_KEY] = parseMasterPosBundles(serialized);
      } else if (key === POS_CONTAINER_DEPOSITS_STORAGE_KEY) {
        data[POS_CONTAINER_DEPOSITS_STORAGE_KEY] = parseMasterContainerDeposits(serialized);
      } else {
        data[POS_HELD_BILLS_STORAGE_KEY] = parseMasterHeldBills(serialized);
      }
      continue;
    }

    if (!isPlainRecordObject(rawVal)) {
      return {
        keysPresent: [],
        data: {},
        extraKeys: {},
        error: `ข้อมูลของ "${key}" ต้องเป็น Object ({ ... })`,
      };
    }

    keysPresent.push(key);
    const parser = MASTER_RECORD_PARSERS[key];
    (data as Record<string, unknown>)[key] = parser(JSON.stringify(rawVal));
  }

  for (const [key, val] of Object.entries(source)) {
    if (MASTER_KNOWN_KEY_SET.has(key) || !isMasterPrefixKey(key)) continue;
    keysPresent.push(key);
    extraKeys[key] = val;
  }

  if (keysPresent.length === 0) {
    return {
      keysPresent: [],
      data: {},
      extraKeys: {},
      error:
        'ไม่พบคีย์ตั้งค่าของระบบ POS ที่รองรับ (pos_*, inventory_*, customer_*, shift_*)',
    };
  }

  return { keysPresent, data, extraKeys };
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

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'วันนี้' },
  { key: 'yesterday', label: 'เมื่อวาน' },
  { key: '7days', label: '7 วันย้อนหลัง' },
  { key: 'month', label: 'เดือนนี้' },
  { key: 'custom', label: 'กำหนดเอง' },
];

const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: 'วันนี้',
  yesterday: 'เมื่อวาน',
  '7days': '7 วันย้อนหลัง',
  month: 'เดือนนี้',
  custom: 'กำหนดเอง',
};

const PREV_PERIOD_LABEL: Partial<Record<PeriodKey, string>> = {
  today: 'เมื่อวาน',
  yesterday: 'วันก่อนหน้า',
  '7days': '7 วันก่อนหน้า',
  month: 'เดือนที่แล้ว',
  custom: 'ช่วงก่อนหน้า',
};

function calcPctChange(current: number, previous: number): number {
  if (previous === 0) {
    if (current > 0) return 100;
    if (current < 0) return -100;
    return 0;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

type SaleDiscountSource = 'vip' | 'points' | 'manual' | 'none';

interface SaleDiscountInfo {
  netAmount: number;
  discountAmt: number;
  beforeDiscount: number;
  source: SaleDiscountSource;
}

function parseFormattedNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const num = Number(raw.replace(/,/g, ''));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function getSaleDiscountInfo(sale: Sale): SaleDiscountInfo {
  const saleAny = sale as Sale & {
    discount_amount?: number;
    discount?: number;
    subtotal_amount?: number;
  };
  const netAmount = Number(sale.total_amount ?? 0);
  const note = sale.note ?? '';
  const isVipNote = /ส่วนลด\s+VIP\s+\d+(?:\.\d+)?%/.test(note);
  const isPointsNote = /ใช้แต้ม\s+[\d,]+\s+แต้ม/.test(note);

  const itemsSubtotal = (sale.sale_items ?? []).reduce(
    (sum, it) => sum + Number(it.subtotal ?? 0),
    0
  );

  const rawColumnDiscount = Number(saleAny.discount_amount ?? saleAny.discount ?? 0);
  let discountAmt =
    Number.isFinite(rawColumnDiscount) && rawColumnDiscount > 0 ? rawColumnDiscount : 0;

  if (discountAmt === 0 && saleAny.subtotal_amount !== undefined) {
    const colSubtotal = Number(saleAny.subtotal_amount);
    if (Number.isFinite(colSubtotal) && colSubtotal > netAmount + 0.005) {
      discountAmt = Number((colSubtotal - netAmount).toFixed(2));
    }
  }

  if (discountAmt === 0 && itemsSubtotal > netAmount + 0.005 && itemsSubtotal > 0) {
    discountAmt = Number((itemsSubtotal - netAmount).toFixed(2));
  }

  // POS checkout distributes bill discounts across sale_items, storing original discount in sale.note
  if (discountAmt === 0 && note) {
    const vipMatch = /ส่วนลด\s+VIP\s+\d+(?:\.\d+)?%\s+([\d,]+(?:\.\d+)?)/.exec(note);
    const tailMatch = /ส่วนลดท้ายบิล(?::)?\s*-?\s*([\d,]+(?:\.\d+)?)/.exec(note);
    const parsedFromNote = parseFormattedNumber(vipMatch?.[1] ?? tailMatch?.[1]);
    if (parsedFromNote > 0) {
      discountAmt = parsedFromNote;
    } else if (note.includes('ส่วนลด')) {
      const beforeMatch = /ยอดก่อนลด\s+([\d,]+(?:\.\d+)?)/.exec(note);
      const parsedBefore = parseFormattedNumber(beforeMatch?.[1]);
      if (parsedBefore > netAmount + 0.005) {
        discountAmt = Number((parsedBefore - netAmount).toFixed(2));
      }
    }
  }

  const beforeDiscount = Number((netAmount + discountAmt).toFixed(2));
  const source: SaleDiscountSource =
    discountAmt <= 0
      ? 'none'
      : isVipNote
        ? 'vip'
        : isPointsNote
          ? 'points'
          : 'manual';

  return {
    netAmount,
    discountAmt,
    beforeDiscount,
    source,
  };
}

const DAY_OF_WEEK_ORDER = [
  { dayIndex: 1, label: 'จันทร์', shortLabel: 'จ.' },
  { dayIndex: 2, label: 'อังคาร', shortLabel: 'อ.' },
  { dayIndex: 3, label: 'พุธ', shortLabel: 'พ.' },
  { dayIndex: 4, label: 'พฤหัสบดี', shortLabel: 'พฤ.' },
  { dayIndex: 5, label: 'ศุกร์', shortLabel: 'ศ.' },
  { dayIndex: 6, label: 'เสาร์', shortLabel: 'ส.' },
  { dayIndex: 0, label: 'อาทิตย์', shortLabel: 'อา.' },
] as const;

const TIME_OF_DAY_SLOTS = [
  { key: 'morning', label: 'เช้า', rangeLabel: '05:00–11:59' },
  { key: 'afternoon', label: 'บ่าย', rangeLabel: '12:00–16:59' },
  { key: 'evening', label: 'เย็น', rangeLabel: '17:00–20:59' },
  { key: 'night', label: 'ดึก', rangeLabel: '21:00–04:59' },
] as const;

type TimeOfDayKey = (typeof TIME_OF_DAY_SLOTS)[number]['key'];

function getTimeOfDayKey(hour: number): TimeOfDayKey {
  if (hour >= 5 && hour <= 11) return 'morning';
  if (hour >= 12 && hour <= 16) return 'afternoon';
  if (hour >= 17 && hour <= 20) return 'evening';
  return 'night';
}

const TICKET_SIZE_TIERS = [
  {
    key: 'micro',
    label: '< ฿50 (บิลรายย่อย)',
    shortLabel: '< ฿50',
    desc: 'บิลรายย่อย',
    barClass: 'bg-slate-500',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    dotClass: 'bg-slate-500',
  },
  {
    key: 'regular',
    label: '฿50 – ฿199 (บิลทั่วไป)',
    shortLabel: '฿50 – ฿199',
    desc: 'บิลทั่วไป',
    barClass: 'bg-sky-500',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
    dotClass: 'bg-sky-500',
  },
  {
    key: 'family',
    label: '฿200 – ฿499 (บิลครอบครัว)',
    shortLabel: '฿200 – ฿499',
    desc: 'บิลครอบครัว',
    barClass: 'bg-emerald-500',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotClass: 'bg-emerald-500',
  },
  {
    key: 'bulk',
    label: '>= ฿500 (บิลใหญ่/ยกลัง)',
    shortLabel: '>= ฿500',
    desc: 'บิลใหญ่/ยกลัง',
    barClass: 'bg-violet-500',
    badgeClass: 'bg-violet-50 text-violet-700 border-violet-200',
    dotClass: 'bg-violet-500',
  },
] as const;

type TicketSizeTierKey = (typeof TICKET_SIZE_TIERS)[number]['key'];

function getTicketSizeTierKey(amount: number): TicketSizeTierKey {
  if (amount < 50) return 'micro';
  if (amount < 200) return 'regular';
  if (amount < 500) return 'family';
  return 'bulk';
}

function isCancelledSale(sale: Sale): boolean {
  const saleAny = sale as Sale & { status?: string; is_cancelled?: boolean };
  return (
    saleAny.status === 'cancelled' ||
    saleAny.status === 'void' ||
    saleAny.is_cancelled === true ||
    (sale.note ?? '').includes('ยกเลิก')
  );
}

const PAYMENT_BADGE: Record<PaymentMethod, { label: string; className: string }> = {
  cash: {
    label: 'เงินสด',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  qr: {
    label: 'PromptPay QR',
    className: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  credit: {
    label: 'เงินเชื่อ',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
};

export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), []);
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [loading, setLoading] = useState(true);
  const [showMoreDashboardTools, setShowMoreDashboardTools] = useState(false);
  const [copied, setCopied] = useState(false);
  const [topSortBy, setTopSortBy] = useState<'revenue' | 'profit'>('revenue');
  const [topLimit, setTopLimit] = useState<5 | 10>(5);
  const [topProductsCategoryFilter, setTopProductsCategoryFilter] = useState<string>('all');
  const [categorySortBy, setCategorySortBy] = useState<'revenue' | 'profit' | 'marginPct'>('revenue');
  const [supplierSortBy, setSupplierSortBy] = useState<'revenue' | 'profit' | 'marginPct' | 'qty'>('revenue');
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [targetStocks, setTargetStocks] = useState<Record<string, number>>({});
  const [expiryDates, setExpiryDates] = useState<Record<string, string>>({});
  const [customerDueDates, setCustomerDueDates] = useState<Record<string, string>>({});
  const [todayIso, setTodayIso] = useState<string>('');
  const [showAllUrgentStock, setShowAllUrgentStock] = useState(false);
  const [showAllUrgentExpiry, setShowAllUrgentExpiry] = useState(false);
  const [showAllNonMoving, setShowAllNonMoving] = useState(false);
  const [showAllShrinkage, setShowAllShrinkage] = useState(false);
  const [showAllVoidAudit, setShowAllVoidAudit] = useState(false);
  const [dailyGoal, setDailyGoal] = useState<number>(DEFAULT_DAILY_GOAL);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');

  // Recent bills filter & detail modal
  const [billPaymentFilter, setBillPaymentFilter] = useState<'all' | PaymentMethod | 'cancelled'>('all');
  const [billSearch, setBillSearch] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [printSeq, setPrintSeq] = useState(0);
  const [printedAt, setPrintedAt] = useState('');

  useEffect(() => {
    if (printSeq === 0) return;
    const timer = window.setTimeout(() => {
      window.print();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [printSeq]);

  const handlePrintReport = () => {
    setPrintedAt(new Date().toISOString());
    setPrintSeq((prev) => prev + 1);
  };

  useEffect(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;
    setCustomStart((prev) => prev || todayStr);
    setCustomEnd((prev) => prev || todayStr);

    try {
      const savedGoal = window.localStorage.getItem(DAILY_GOAL_STORAGE_KEY);
      if (savedGoal !== null) {
        const parsedGoal = Number(savedGoal);
        if (Number.isFinite(parsedGoal) && parsedGoal > 0) {
          setDailyGoal(parsedGoal);
        }
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);

  useEffect(() => {
    const loadSuppliers = () => {
      try {
        const raw = window.localStorage.getItem(SUPPLIERS_STORAGE_KEY);
        setSuppliers(parseSupplierMap(raw));
      } catch {
        // ignore localStorage errors
      }
    };
    const loadTargetStocks = () => {
      try {
        const raw = window.localStorage.getItem(INVENTORY_TARGET_STOCK_STORAGE_KEY);
        setTargetStocks(parseNumberMap(raw, { roundDecimals: 2 }));
      } catch {
        // ignore localStorage errors
      }
    };
    loadSuppliers();
    loadTargetStocks();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SUPPLIERS_STORAGE_KEY || e.key === null) {
        loadSuppliers();
      }
      if (e.key === INVENTORY_TARGET_STOCK_STORAGE_KEY || e.key === null) {
        loadTargetStocks();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const syncTodayIso = () => {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      setTodayIso(`${y}-${m}-${d}`);
    };
    const loadExpiryDates = () => {
      try {
        const raw = window.localStorage.getItem(EXPIRY_DATES_STORAGE_KEY);
        setExpiryDates(parseExpiryDatesMap(raw));
        const rawDue = window.localStorage.getItem(CUSTOMER_DUE_DATES_STORAGE_KEY);
        setCustomerDueDates(parseExpiryDatesMap(rawDue));
      } catch {
        // ignore localStorage errors
      }
    };
    syncTodayIso();
    loadExpiryDates();
    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === EXPIRY_DATES_STORAGE_KEY ||
        e.key === CUSTOMER_DUE_DATES_STORAGE_KEY ||
        e.key === null
      ) {
        syncTodayIso();
        loadExpiryDates();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const [heldBills, setHeldBills] = useState<MasterHeldBill[]>([]);
  const [promoLabels, setPromoLabels] = useState<Record<string, string>>({});
  const [customerTags, setCustomerTags] = useState<Record<string, string>>({});
  const [lastCostHistory, setLastCostHistory] = useState<
    Record<string, MasterCostHistoryEntry>
  >({});
  const [customerStoreCredits, setCustomerStoreCredits] = useState<Record<string, number>>({});
  const [customerLoyaltyPoints, setCustomerLoyaltyPoints] = useState<Record<string, number>>({});
  const [containerDeposits, setContainerDeposits] = useState<MasterContainerDeposit[]>([]);

  useEffect(() => {
    const loadHeldBills = () => {
      try {
        const raw = window.localStorage.getItem(POS_HELD_BILLS_STORAGE_KEY);
        setHeldBills(parseMasterHeldBills(raw));
      } catch {
        // ignore localStorage errors
      }
    };
    const loadLastCostHistory = () => {
      try {
        const raw = window.localStorage.getItem(INVENTORY_LAST_COST_HISTORY_STORAGE_KEY);
        setLastCostHistory(parseCostHistoryMap(raw));
      } catch {
        // ignore localStorage errors
      }
    };
    const loadCustomerStoreCredits = () => {
      try {
        const raw = window.localStorage.getItem(CUSTOMER_STORE_CREDIT_STORAGE_KEY);
        setCustomerStoreCredits(parseNumberMap(raw, { roundDecimals: 2 }));
      } catch {
        // ignore localStorage errors
      }
    };
    const loadCustomerLoyaltyPoints = () => {
      try {
        const raw = window.localStorage.getItem(CUSTOMER_LOYALTY_POINTS_STORAGE_KEY);
        setCustomerLoyaltyPoints(parseNumberMap(raw, { integer: true }));
      } catch {
        // ignore localStorage errors
      }
    };
    const loadContainerDeposits = () => {
      try {
        const raw = window.localStorage.getItem(POS_CONTAINER_DEPOSITS_STORAGE_KEY);
        setContainerDeposits(parseMasterContainerDeposits(raw));
      } catch {
        // ignore localStorage errors
      }
    };
    const loadPromoLabels = () => {
      try {
        const raw = window.localStorage.getItem(INVENTORY_PROMO_LABELS_STORAGE_KEY);
        setPromoLabels(parseTrimmedTextMap(raw));
      } catch {
        // ignore localStorage errors
      }
    };
    const loadCustomerTags = () => {
      try {
        const raw = window.localStorage.getItem(CUSTOMER_TAGS_STORAGE_KEY);
        setCustomerTags(parseTrimmedTextMap(raw));
      } catch {
        // ignore localStorage errors
      }
    };
    loadHeldBills();
    loadLastCostHistory();
    loadCustomerStoreCredits();
    loadCustomerLoyaltyPoints();
    loadContainerDeposits();
    loadPromoLabels();
    loadCustomerTags();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === POS_HELD_BILLS_STORAGE_KEY || e.key === null) {
        loadHeldBills();
      }
      if (e.key === INVENTORY_LAST_COST_HISTORY_STORAGE_KEY || e.key === null) {
        loadLastCostHistory();
      }
      if (e.key === CUSTOMER_STORE_CREDIT_STORAGE_KEY || e.key === null) {
        loadCustomerStoreCredits();
      }
      if (e.key === CUSTOMER_LOYALTY_POINTS_STORAGE_KEY || e.key === null) {
        loadCustomerLoyaltyPoints();
      }
      if (e.key === POS_CONTAINER_DEPOSITS_STORAGE_KEY || e.key === null) {
        loadContainerDeposits();
      }
      if (e.key === INVENTORY_PROMO_LABELS_STORAGE_KEY || e.key === null) {
        loadPromoLabels();
      }
      if (e.key === CUSTOMER_TAGS_STORAGE_KEY || e.key === null) {
        loadCustomerTags();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [debtPayments, setDebtPayments] = useState<DebtPayment[]>([]);
  const [stockAdjustments, setStockAdjustments] = useState<StockAdjustmentMovement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);
  const [dailySlots, setDailySlots] = useState<
    { dateKey: string; label: string; subLabel: string }[]
  >([]);
  const [prevPeriodTotals, setPrevPeriodTotals] = useState<{
    totalSales: number;
    grossProfit: number;
    netProfit: number;
    billCount: number;
  } | null>(null);

  // Expense Modal
  const [expOpen, setExpOpen] = useState(false);
  const [expType, setExpType] = useState<'expense' | 'income'>('expense');
  const [expCategory, setExpCategory] = useState('ซื้อของเข้าร้าน');
  const [expAmount, setExpAmount] = useState('');
  const [expNote, setExpNote] = useState('');

  // Settings Modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [promptpayId, setPromptpayId] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [storeAddress, setStoreAddress] = useState('');

  // Master All-in-One JSON Backup / Restore Modal
  const [masterBackupOpen, setMasterBackupOpen] = useState(false);
  const [masterSnapshot, setMasterSnapshot] = useState<MasterBackupSnapshot | null>(null);
  const [masterBackupJsonInput, setMasterBackupJsonInput] = useState('');
  const [masterBackupFileName, setMasterBackupFileName] = useState('');
  const [masterRestoreMode, setMasterRestoreMode] = useState<'replace' | 'merge'>('replace');
  const [masterBackupError, setMasterBackupError] = useState('');
  const [masterBackupSuccess, setMasterBackupSuccess] = useState('');
  const [masterJsonCopied, setMasterJsonCopied] = useState(false);

  useEffect(() => {
    const syncSnapshot = () => {
      setMasterSnapshot(readMasterBackupFromStorage());
      try {
        const savedGoal = window.localStorage.getItem(DAILY_GOAL_STORAGE_KEY);
        const parsedGoal = parseDailyGoalValue(savedGoal);
        if (parsedGoal !== null) {
          setDailyGoal(parsedGoal);
        }
      } catch {
        // ignore localStorage errors
      }
    };
    syncSnapshot();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === null || isMasterPrefixKey(e.key)) {
        syncSnapshot();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let startDate: string;
    let endDate: string | null = null;
    let prevStartDate: string | null = null;
    let prevEndDate: string | null = null;
    const nextDailySlots: { dateKey: string; label: string; subLabel: string }[] = [];

    const pushDaySlot = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      nextDailySlots.push({
        dateKey: `${y}-${m}-${day}`,
        label: new Intl.DateTimeFormat('th-TH', {
          day: 'numeric',
          month: 'short',
          year: '2-digit',
        }).format(d),
        subLabel: new Intl.DateTimeFormat('th-TH', {
          weekday: 'short',
        }).format(d),
      });
    };

    if (period === 'today') {
      startDate = todayStart.toISOString();
      const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      prevStartDate = yesterdayStart.toISOString();
      prevEndDate = todayStart.toISOString();
    } else if (period === 'yesterday') {
      const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const twoDaysAgoStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
      startDate = yesterdayStart.toISOString();
      endDate = todayStart.toISOString();
      prevStartDate = twoDaysAgoStart.toISOString();
      prevEndDate = yesterdayStart.toISOString();
    } else if (period === '7days') {
      const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      const fourteenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13);
      startDate = sevenDaysAgo.toISOString();
      prevStartDate = fourteenDaysAgo.toISOString();
      prevEndDate = sevenDaysAgo.toISOString();
      for (let i = 6; i >= 0; i--) {
        pushDaySlot(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
      }
    } else if (period === 'month') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      startDate = monthStart.toISOString();
      prevStartDate = prevMonthStart.toISOString();
      prevEndDate = monthStart.toISOString();
      const daysInMonthSoFar = now.getDate();
      for (let day = 1; day <= daysInMonthSoFar; day++) {
        pushDaySlot(new Date(now.getFullYear(), now.getMonth(), day));
      }
    } else {
      if (!customStart || !customEnd) {
        setDailySlots([]);
        setLoading(false);
        return;
      }
      const [sStr, eStr] = customStart <= customEnd ? [customStart, customEnd] : [customEnd, customStart];
      const [sy, sm, sd] = sStr.split('-').map(Number);
      const [ey, em, ed] = eStr.split('-').map(Number);
      const startD = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
      const endD = new Date(ey, em - 1, ed, 0, 0, 0, 0);
      const endNextD = new Date(ey, em - 1, ed + 1, 0, 0, 0, 0);
      const daySpan = Math.max(1, Math.round((endNextD.getTime() - startD.getTime()) / 86_400_000));
      const prevStartD = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate() - daySpan);
      startDate = startD.toISOString();
      endDate = endNextD.toISOString();
      prevStartDate = prevStartD.toISOString();
      prevEndDate = startD.toISOString();
      for (let i = 0; i < 62; i++) {
        const d = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate() + i);
        if (d > endD) break;
        pushDaySlot(d);
      }
    }
    setDailySlots(nextDailySlots);

    let salesQuery = supabase
      .from('sales')
      .select('*, customers(name), sale_items(*)')
      .gte('created_at', startDate)
      .order('created_at', { ascending: false });

    let saleItemsQuery = supabase
      .from('sale_items')
      .select('*, sales!inner(created_at)')
      .gte('sales.created_at', startDate);

    let expensesQuery = supabase
      .from('expenses')
      .select('*')
      .gte('created_at', startDate)
      .order('created_at', { ascending: false });

    let debtPaymentsQuery = supabase
      .from('debt_payments')
      .select('*')
      .gte('created_at', startDate)
      .order('created_at', { ascending: false });

    let stockAdjustmentsQuery = supabase
      .from('stock_movements')
      .select('id, product_id, type, qty_change, note, created_at, products(name, base_unit, cost_price)')
      .eq('type', 'adjust')
      .gte('created_at', startDate)
      .order('created_at', { ascending: false });

    if (endDate) {
      salesQuery = salesQuery.lt('created_at', endDate);
      saleItemsQuery = saleItemsQuery.lt('sales.created_at', endDate);
      expensesQuery = expensesQuery.lt('created_at', endDate);
      debtPaymentsQuery = debtPaymentsQuery.lt('created_at', endDate);
      stockAdjustmentsQuery = stockAdjustmentsQuery.lt('created_at', endDate);
    }

    const prevSalesQuery =
      prevStartDate && prevEndDate
        ? supabase
            .from('sales')
            .select('total_amount, total_cost')
            .gte('created_at', prevStartDate)
            .lt('created_at', prevEndDate)
        : Promise.resolve({ data: null });

    const prevExpensesQuery =
      prevStartDate && prevEndDate
        ? supabase
            .from('expenses')
            .select('type, amount')
            .gte('created_at', prevStartDate)
            .lt('created_at', prevEndDate)
        : Promise.resolve({ data: null });

    const [
      { data: st },
      { data: sData },
      { data: siData },
      { data: expData },
      { data: dpData },
      { data: adjData },
      { data: prodData },
      { data: catData },
      { data: custData },
      { data: prevData },
      { data: prevExpData },
    ] = await Promise.all([
      supabase.from('store_settings').select('*').limit(1).maybeSingle(),
      salesQuery,
      saleItemsQuery,
      expensesQuery,
      debtPaymentsQuery,
      stockAdjustmentsQuery,
      supabase.from('products').select('*'),
      supabase.from('categories').select('*').order('sort_order', { ascending: true }),
      supabase.from('customers').select('*').order('name', { ascending: true }),
      prevSalesQuery,
      prevExpensesQuery,
    ]);

    if (prevStartDate && prevEndDate && prevData) {
      let prevTotalSales = 0;
      let prevTotalCost = 0;
      const prevRows = prevData as { total_amount: number; total_cost: number }[];
      for (const row of prevRows) {
        prevTotalSales += Number(row.total_amount);
        prevTotalCost += Number(row.total_cost);
      }
      const prevGrossProfit = prevTotalSales - prevTotalCost;
      let prevOtherIncome = 0;
      let prevOtherExpense = 0;
      for (const e of (prevExpData as { type: string; amount: number }[] | null) ?? []) {
        if (e.type === 'income') prevOtherIncome += Number(e.amount);
        else prevOtherExpense += Number(e.amount);
      }
      setPrevPeriodTotals({
        totalSales: prevTotalSales,
        grossProfit: prevGrossProfit,
        netProfit: prevGrossProfit + prevOtherIncome - prevOtherExpense,
        billCount: prevRows.length,
      });
    } else {
      setPrevPeriodTotals(null);
    }

    const allProducts = (prodData as Product[]) ?? [];
    setSettings(st ?? null);
    setStoreName(st?.store_name ?? 'ร้านขายของชำ');
    setPromptpayId(st?.promptpay_id ?? '');
    setStorePhone(st?.phone ?? '');
    setStoreAddress(st?.address ?? '');
    setSales((sData as Sale[]) ?? []);
    setSaleItems((siData as SaleItem[]) ?? []);
    setExpenses((expData as Expense[]) ?? []);
    setDebtPayments((dpData as DebtPayment[]) ?? []);
    setStockAdjustments((adjData as StockAdjustmentMovement[]) ?? []);
    setProducts(allProducts);
    setCategories((catData as Category[]) ?? []);
    setCustomers((custData as Customer[]) ?? []);
    setLowStockProducts(
      allProducts.filter(
        (p) => p.is_active && !p.allow_custom_price && p.stock_qty <= p.low_stock_alert
      )
    );
    setLoading(false);
  }, [supabase, period, customStart, customEnd]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const periodDays = useMemo(() => {
    if (period === 'today' || period === 'yesterday') return 1;
    if (period === '7days') return 7;
    if (period === 'month') return Math.max(1, dailySlots.length);
    if (period === 'custom' && customStart && customEnd) {
      const [sStr, eStr] =
        customStart <= customEnd ? [customStart, customEnd] : [customEnd, customStart];
      const [sy, sm, sd] = sStr.split('-').map(Number);
      const [ey, em, ed] = eStr.split('-').map(Number);
      if (
        Number.isFinite(sy) &&
        Number.isFinite(sm) &&
        Number.isFinite(sd) &&
        Number.isFinite(ey) &&
        Number.isFinite(em) &&
        Number.isFinite(ed)
      ) {
        const startUtc = Date.UTC(sy, sm - 1, sd);
        const endUtc = Date.UTC(ey, em - 1, ed);
        return Math.max(1, Math.round((endUtc - startUtc) / 86400000) + 1);
      }
    }
    return Math.max(1, dailySlots.length);
  }, [period, dailySlots.length, customStart, customEnd]);

  const stats = useMemo(() => {
    let totalSales = 0;
    let totalCost = 0;
    let cashSales = 0;
    let qrSales = 0;
    let creditSales = 0;
    let cashCount = 0;
    let qrCount = 0;
    let creditCount = 0;
    let totalDiscountGiven = 0;
    let discountedBillsCount = 0;
    let vipDiscountTotal = 0;
    let vipDiscountCount = 0;
    let pointsDiscountTotal = 0;
    let pointsDiscountCount = 0;
    let manualDiscountTotal = 0;
    let manualDiscountCount = 0;

    for (const s of sales) {
      const amt = Number(s.total_amount);
      totalSales += amt;
      totalCost += Number(s.total_cost);
      if (s.payment_method === 'cash') {
        cashSales += amt;
        cashCount += 1;
      } else if (s.payment_method === 'qr') {
        qrSales += amt;
        qrCount += 1;
      } else if (s.payment_method === 'credit') {
        creditSales += amt;
        creditCount += 1;
      }

      const discInfo = getSaleDiscountInfo(s);
      if (discInfo.discountAmt > 0) {
        totalDiscountGiven += discInfo.discountAmt;
        discountedBillsCount += 1;
        if (discInfo.source === 'vip') {
          vipDiscountTotal += discInfo.discountAmt;
          vipDiscountCount += 1;
        } else if (discInfo.source === 'points') {
          pointsDiscountTotal += discInfo.discountAmt;
          pointsDiscountCount += 1;
        } else {
          manualDiscountTotal += discInfo.discountAmt;
          manualDiscountCount += 1;
        }
      }
    }

    totalDiscountGiven = Math.round(totalDiscountGiven * 100) / 100;
    const grossSalesBeforeDiscount = Math.round((totalSales + totalDiscountGiven) * 100) / 100;
    const discountRatePct =
      grossSalesBeforeDiscount > 0 ? (totalDiscountGiven / grossSalesBeforeDiscount) * 100 : 0;
    const discountedBillsPct =
      sales.length > 0 ? (discountedBillsCount / sales.length) * 100 : 0;
    const avgDiscountPerBill =
      discountedBillsCount > 0 ? totalDiscountGiven / discountedBillsCount : 0;

    const grossProfit = totalSales - totalCost;
    const grossMarginPct = totalSales > 0 ? (grossProfit / totalSales) * 100 : 0;
    const avgTicket = sales.length > 0 ? totalSales / sales.length : 0;
    const avgGrossProfitPerBill = sales.length > 0 ? grossProfit / sales.length : 0;

    let otherIncome = 0;
    let otherExpense = 0;
    for (const e of expenses) {
      if (e.type === 'income') otherIncome += Number(e.amount);
      else otherExpense += Number(e.amount);
    }

    let debtCollectedCash = 0;
    let debtCollectedQr = 0;
    let debtWaivedTotal = 0;
    let debtWaivedCount = 0;
    let debtPaymentCashCount = 0;
    let debtPaymentQrCount = 0;
    for (const dp of debtPayments) {
      const { actualCollected, waivedAmount } = parseDebtPaymentAmounts(dp.amount, dp.note);
      if (waivedAmount > 0) {
        debtWaivedTotal += waivedAmount;
        debtWaivedCount += 1;
      }
      if (dp.payment_method === 'cash') {
        debtCollectedCash += actualCollected;
        debtPaymentCashCount += 1;
      } else if (dp.payment_method === 'qr') {
        debtCollectedQr += actualCollected;
        debtPaymentQrCount += 1;
      }
    }
    debtCollectedCash = Math.round(debtCollectedCash * 100) / 100;
    debtCollectedQr = Math.round(debtCollectedQr * 100) / 100;
    debtWaivedTotal = Math.round(debtWaivedTotal * 100) / 100;
    const debtCollectedTotal = Math.round((debtCollectedCash + debtCollectedQr) * 100) / 100;
    const debtPaymentCount = debtPayments.length;
    const creditCollectionNet = Math.round((debtCollectedTotal - creditSales) * 100) / 100;
    const creditCollectionRatePct =
      creditSales > 0 ? (debtCollectedTotal / creditSales) * 100 : null;
    const debtCollectedCashPct =
      debtCollectedTotal > 0 ? (debtCollectedCash / debtCollectedTotal) * 100 : 0;
    const debtCollectedQrPct =
      debtCollectedTotal > 0 ? (debtCollectedQr / debtCollectedTotal) * 100 : 0;

    let totalOutstandingDebt = 0;
    let debtorCustomersCount = 0;
    for (const c of customers) {
      const debt = Number(c.total_debt ?? 0);
      if (debt > 0) {
        totalOutstandingDebt += debt;
        debtorCustomersCount += 1;
      }
    }
    totalOutstandingDebt = Math.round(totalOutstandingDebt * 100) / 100;

    const creditExposurePct = totalSales > 0 ? (creditSales / totalSales) * 100 : 0;
    const debtRecoveryVsOutstandingPct =
      totalOutstandingDebt > 0
        ? (debtCollectedTotal / totalOutstandingDebt) * 100
        : debtCollectedTotal > 0
          ? 100
          : 0;
    let creditLiquidityStatus:
      | 'สภาพคล่องดีเยี่ยม'
      | 'สมดุลปกติ'
      | 'ควรเร่งติดตามหนี้ค้าง' = 'สมดุลปกติ';
    if (totalOutstandingDebt === 0 && creditSales === 0) {
      creditLiquidityStatus = 'สภาพคล่องดีเยี่ยม';
    } else if (
      creditExposurePct > 30 ||
      (totalOutstandingDebt > 0 && creditCollectionNet < 0 && debtCollectedTotal === 0) ||
      (totalOutstandingDebt > 0 && creditCollectionNet < 0 && debtRecoveryVsOutstandingPct < 10)
    ) {
      creditLiquidityStatus = 'ควรเร่งติดตามหนี้ค้าง';
    } else if (
      creditCollectionNet > 0 ||
      (creditExposurePct <= 15 && (debtCollectedTotal > 0 || totalOutstandingDebt === 0))
    ) {
      creditLiquidityStatus = 'สภาพคล่องดีเยี่ยม';
    }

    const netCashFlow = cashSales + qrSales + otherIncome - otherExpense;
    const netProfit = grossProfit + otherIncome - otherExpense;
    const avgNetProfitPerBill = sales.length > 0 ? netProfit / sales.length : 0;
    const netMarginPct = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;
    const breakEvenSales = grossMarginPct > 0 ? (otherExpense / (grossMarginPct / 100)) : 0;
    const breakEvenDiff = totalSales - breakEvenSales;
    const breakEvenMultiple = breakEvenSales > 0 ? totalSales / breakEvenSales : null;

    // Build category & product lookups early so Top Products, Non-Moving Items, and Category Stats share them
    const categoryById = new Map<string, Category>();
    for (const c of categories) {
      categoryById.set(c.id, c);
    }
    const productById = new Map<string, Product>();
    const productByName = new Map<string, Product>();
    for (const p of products) {
      productById.set(p.id, p);
      productByName.set(p.name, p);
    }

    // Top 5 selling products (by revenue and by profit) & total items sold
    let totalItemsSold = 0;
    let customItemRevenue = 0;
    let customItemCost = 0;
    let customItemQty = 0;
    let customItemLineCount = 0;
    const customItemSaleIds = new Set<string>();
    const customItemMap = new Map<
      string,
      { name: string; qty: number; revenue: number; cost: number; profit: number }
    >();
    const productMap = new Map<
      string,
      { name: string; qty: number; revenue: number; cost: number; profit: number }
    >();
    for (const item of saleItems) {
      const baseQty = Number(item.qty || 0) * (Number(item.conversion_rate) || 1);
      totalItemsSold += baseQty;
      if (item.product_id === null) {
        const rev = Number(item.subtotal);
        const cst = baseQty * Number(item.unit_cost);
        customItemRevenue += rev;
        customItemCost += cst;
        customItemQty += baseQty;
        customItemLineCount += 1;
        if (item.sale_id) customItemSaleIds.add(item.sale_id);
        const customName = item.product_name || 'บริการเสริม/สินค้านอกรายการ';
        const cPrev = customItemMap.get(customName) ?? {
          name: customName,
          qty: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
        };
        cPrev.qty += baseQty;
        cPrev.revenue += rev;
        cPrev.cost += cst;
        cPrev.profit += rev - cst;
        customItemMap.set(customName, cPrev);
      }
      if (topProductsCategoryFilter !== 'all') {
        const prod =
          (item.product_id ? productById.get(item.product_id) : undefined) ??
          productByName.get(item.product_name);
        const cat = prod?.category_id ? categoryById.get(prod.category_id) : undefined;
        const itemCategoryKey = cat ? cat.id : '__uncategorized__';
        if (itemCategoryKey !== topProductsCategoryFilter) continue;
      }
      const prev = productMap.get(item.product_name) ?? {
        name: item.product_name,
        qty: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
      };
      const itemRevenue = Number(item.subtotal);
      const itemCost = baseQty * Number(item.unit_cost);
      const itemProfit = itemRevenue - itemCost;
      prev.qty += baseQty;
      prev.revenue += itemRevenue;
      prev.cost += itemCost;
      prev.profit += itemProfit;
      productMap.set(item.product_name, prev);
    }
    const avgItemsPerBill = sales.length > 0 ? totalItemsSold / sales.length : 0;
    customItemRevenue = Math.round(customItemRevenue * 100) / 100;
    customItemCost = Math.round(customItemCost * 100) / 100;
    const customItemProfit = Math.round((customItemRevenue - customItemCost) * 100) / 100;
    const customItemBillCount = customItemSaleIds.size;
    const customItemSharePct = totalSales > 0 ? (customItemRevenue / totalSales) * 100 : 0;
    const topCustomItems = [...customItemMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
    const allProductStats = [...productMap.values()];
    const topProductsByRevenue = [...allProductStats]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
    const topProductsByProfit = [...allProductStats]
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10);
    const topProducts = topProductsByRevenue.slice(0, 5);

    // Non-Moving / Slow Stock Items (active, non-custom, has stock, 0 sales in period)
    const soldProductIds = new Set<string>();
    const soldProductNames = new Set<string>();
    for (const item of saleItems) {
      if (item.product_id) soldProductIds.add(item.product_id);
      if (item.product_name) soldProductNames.add(item.product_name);
    }
    const zeroMovingProducts = products
      .filter(
        (p) =>
          p.is_active &&
          !p.allow_custom_price &&
          Number(p.stock_qty) > 0 &&
          !soldProductIds.has(p.id) &&
          !soldProductNames.has(p.name)
      )
      .map((p) => {
        const stockQty = Number(p.stock_qty);
        const costPrice = Number(p.cost_price);
        const cat = p.category_id ? categoryById.get(p.category_id) : undefined;
        return {
          id: p.id,
          name: p.name,
          categoryName: cat?.name ?? null,
          base_unit: p.base_unit,
          stock_qty: stockQty,
          cost_price: costPrice,
          tiedUpCost: stockQty * costPrice,
        };
      })
      .sort((a, b) => b.tiedUpCost - a.tiedUpCost || b.stock_qty - a.stock_qty);
    const totalZeroMovingCost = zeroMovingProducts.reduce((sum, p) => sum + p.tiedUpCost, 0);
    const totalZeroMovingUnits = zeroMovingProducts.reduce((sum, p) => sum + p.stock_qty, 0);
    const topZeroMovingProducts = zeroMovingProducts.slice(0, 10);
    const topZeroMovingCost = topZeroMovingProducts.reduce((sum, p) => sum + p.tiedUpCost, 0);

    // Inventory Capital Health Breakdown (active, non-custom products with stock > 0)
    let totalInventoryCapitalCost = 0;
    let totalInventoryCapitalUnits = 0;
    let totalInventoryCapitalCount = 0;
    let activeMovingCost = 0;
    let activeMovingUnits = 0;
    let activeMovingCount = 0;
    let expiredStockCost = 0;
    let expiredStockUnits = 0;
    let expiredStockCount = 0;
    let expiringSoonStockCost = 0;
    let expiringSoonStockUnits = 0;
    let expiringSoonStockCount = 0;

    for (const p of products) {
      if (!p.is_active || p.allow_custom_price) continue;
      const stockQty = Number(p.stock_qty);
      if (!Number.isFinite(stockQty) || stockQty <= 0) continue;
      const costPrice = Math.max(0, Number(p.cost_price) || 0);
      const capitalCost = stockQty * costPrice;

      totalInventoryCapitalCost += capitalCost;
      totalInventoryCapitalUnits += stockQty;
      totalInventoryCapitalCount += 1;

      if (soldProductIds.has(p.id) || soldProductNames.has(p.name)) {
        activeMovingCost += capitalCost;
        activeMovingUnits += stockQty;
        activeMovingCount += 1;
      }

      if (todayIso) {
        const expInfo = getProductExpiryInfo(expiryDates[p.id], todayIso);
        if (expInfo?.status === 'expired') {
          expiredStockCost += capitalCost;
          expiredStockUnits += stockQty;
          expiredStockCount += 1;
        } else if (expInfo?.status === 'expiring_soon') {
          expiringSoonStockCost += capitalCost;
          expiringSoonStockUnits += stockQty;
          expiringSoonStockCount += 1;
        }
      }
    }

    const activeMovingSharePct =
      totalInventoryCapitalCost > 0 ? (activeMovingCost / totalInventoryCapitalCost) * 100 : 0;
    const nonMovingSharePct =
      totalInventoryCapitalCost > 0 ? (totalZeroMovingCost / totalInventoryCapitalCost) * 100 : 0;
    const atRiskExpiryCost = expiredStockCost + expiringSoonStockCost;
    const atRiskExpiryUnits = expiredStockUnits + expiringSoonStockUnits;
    const atRiskExpiryCount = expiredStockCount + expiringSoonStockCount;
    const atRiskExpirySharePct =
      totalInventoryCapitalCost > 0 ? (atRiskExpiryCost / totalInventoryCapitalCost) * 100 : 0;

    // Restock Budget Forecast (Critical Low-Stock vs Full Shelf Target)
    let criticalRestockCount = 0;
    let criticalOutOfStockCount = 0;
    let criticalRestockUnits = 0;
    let criticalRestockBudget = 0;
    let belowTargetRestockCount = 0;
    let fullTargetRestockUnits = 0;
    let fullTargetRestockBudget = 0;
    let targetConfiguredCount = 0;
    const restockSupplierMap = new Map<
      string,
      {
        supplierName: string;
        isAssigned: boolean;
        criticalCount: number;
        criticalBudget: number;
        fullTargetCount: number;
        fullTargetBudget: number;
        totalUnits: number;
      }
    >();

    for (const p of products) {
      if (!p.is_active || p.allow_custom_price) continue;
      const rawStock = Number(p.stock_qty);
      const stockQty = Number.isFinite(rawStock) ? Math.max(0, rawStock) : 0;
      const lowAlertVal = Math.max(0, Number(p.low_stock_alert) || 0);
      const costPrice = Math.max(0, Number(p.cost_price) || 0);
      const targetVal = targetStocks[p.id];
      const hasConfiguredTarget =
        targetVal !== undefined && Number.isFinite(targetVal) && targetVal > 0;
      if (hasConfiguredTarget) {
        targetConfiguredCount += 1;
      }

      const isCriticalLow = stockQty <= lowAlertVal;
      const hasTargetBelow = hasConfiguredTarget && targetVal > stockQty;
      if (!isCriticalLow && !hasTargetBelow) continue;

      const criticalQty = isCriticalLow
        ? hasTargetBelow
          ? Math.max(1, targetVal - stockQty)
          : Math.max(1, lowAlertVal * 2 - stockQty)
        : 0;
      const criticalCost = Math.round(criticalQty * costPrice * 100) / 100;

      const fullQty = hasTargetBelow
        ? Math.max(1, targetVal - stockQty)
        : criticalQty;
      const fullCost = Math.round(fullQty * costPrice * 100) / 100;

      if (isCriticalLow) {
        criticalRestockCount += 1;
        if (stockQty <= 0) criticalOutOfStockCount += 1;
        criticalRestockUnits += criticalQty;
        criticalRestockBudget += criticalCost;
      }

      belowTargetRestockCount += 1;
      fullTargetRestockUnits += fullQty;
      fullTargetRestockBudget += fullCost;

      const rawSupplier = (suppliers[p.id] ?? '').trim();
      const supplierKey = rawSupplier || '__UNASSIGNED__';
      const supplierLabel = rawSupplier || 'ยังไม่ระบุร้านค้าส่ง';
      const existingSup = restockSupplierMap.get(supplierKey) ?? {
        supplierName: supplierLabel,
        isAssigned: Boolean(rawSupplier),
        criticalCount: 0,
        criticalBudget: 0,
        fullTargetCount: 0,
        fullTargetBudget: 0,
        totalUnits: 0,
      };
      if (isCriticalLow) {
        existingSup.criticalCount += 1;
        existingSup.criticalBudget =
          Math.round((existingSup.criticalBudget + criticalCost) * 100) / 100;
      }
      existingSup.fullTargetCount += 1;
      existingSup.fullTargetBudget =
        Math.round((existingSup.fullTargetBudget + fullCost) * 100) / 100;
      existingSup.totalUnits += fullQty;
      restockSupplierMap.set(supplierKey, existingSup);
    }

    criticalRestockBudget = Math.round(criticalRestockBudget * 100) / 100;
    fullTargetRestockBudget = Math.round(fullTargetRestockBudget * 100) / 100;
    const restockSupplierBreakdown = [...restockSupplierMap.values()].sort(
      (a, b) =>
        b.fullTargetBudget - a.fullTargetBudget ||
        b.criticalBudget - a.criticalBudget ||
        a.supplierName.localeCompare(b.supplierName, 'th')
    );

    // Sales & Profit by Product Category
    const categoryPalette = ['#10b981', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

    const categoryMap = new Map<
      string,
      {
        key: string;
        name: string;
        color: string;
        revenue: number;
        cost: number;
        profit: number;
        qty: number;
        itemCount: number;
      }
    >();

    for (const item of saleItems) {
      const prod =
        (item.product_id ? productById.get(item.product_id) : undefined) ??
        productByName.get(item.product_name);
      const cat = prod?.category_id ? categoryById.get(prod.category_id) : undefined;
      const key = cat ? cat.id : '__uncategorized__';
      const name = cat ? cat.name : 'ไม่ระบุหมวดหมู่';
      const rawColor = cat?.color?.trim() ?? '';
      const isHexOrRgb = rawColor.startsWith('#') || rawColor.startsWith('rgb') || rawColor.startsWith('hsl');
      const fallbackColor = cat
        ? categoryPalette[categoryMap.size % categoryPalette.length]
        : '#94a3b8';
      const color = isHexOrRgb ? rawColor : fallbackColor;

      const prev = categoryMap.get(key) ?? {
        key,
        name,
        color,
        revenue: 0,
        cost: 0,
        profit: 0,
        qty: 0,
        itemCount: 0,
      };
      const baseQty = Number(item.qty || 0) * (Number(item.conversion_rate) || 1);
      const itemRevenue = Number(item.subtotal || 0);
      const itemCost = baseQty * Number(item.unit_cost || 0);
      const itemProfit = itemRevenue - itemCost;
      prev.revenue += itemRevenue;
      prev.cost += itemCost;
      prev.profit += itemProfit;
      prev.qty += baseQty;
      prev.itemCount += 1;
      categoryMap.set(key, prev);
    }

    const totalCategoryRevenue = [...categoryMap.values()].reduce((s, c) => s + c.revenue, 0);
    const totalCategoryCost = [...categoryMap.values()].reduce((s, c) => s + c.cost, 0);
    const totalCategoryProfit = totalCategoryRevenue - totalCategoryCost;
    const totalCategoryItems = [...categoryMap.values()].reduce((s, c) => s + c.itemCount, 0);
    const categoryGrossMarginPct =
      totalCategoryRevenue > 0 ? (totalCategoryProfit / totalCategoryRevenue) * 100 : 0;
    const categoryStats = [...categoryMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .map((c) => ({
        ...c,
        pct: totalCategoryRevenue > 0 ? (c.revenue / totalCategoryRevenue) * 100 : 0,
        marginPct: c.revenue > 0 ? (c.profit / c.revenue) * 100 : 0,
      }));

    // Sales & Profit by Supplier / Wholesaler (inventory_suppliers_v1)
    const supplierPalette = ['#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6', '#f97316'];
    const supplierMap = new Map<
      string,
      {
        key: string;
        name: string;
        isAssigned: boolean;
        color: string;
        revenue: number;
        cost: number;
        profit: number;
        qty: number;
        itemCount: number;
        productKeys: Set<string>;
      }
    >();

    for (const item of saleItems) {
      const prod =
        (item.product_id ? productById.get(item.product_id) : undefined) ??
        productByName.get(item.product_name);
      const rawSupplier =
        (item.product_id ? suppliers[item.product_id] : undefined) ??
        (prod ? suppliers[prod.id] : undefined);
      const trimmedSupplier = rawSupplier?.trim() ?? '';
      const isAssigned = trimmedSupplier.length > 0;
      const key = isAssigned ? `sup:${trimmedSupplier}` : '__unassigned__';
      const name = isAssigned ? trimmedSupplier : 'ไม่ระบุซัพพลายเออร์';

      let entry = supplierMap.get(key);
      if (!entry) {
        const assignedIndex = [...supplierMap.values()].filter((s) => s.isAssigned).length;
        const color = isAssigned
          ? supplierPalette[assignedIndex % supplierPalette.length]
          : '#94a3b8';
        entry = {
          key,
          name,
          isAssigned,
          color,
          revenue: 0,
          cost: 0,
          profit: 0,
          qty: 0,
          itemCount: 0,
          productKeys: new Set<string>(),
        };
        supplierMap.set(key, entry);
      }

      const baseQty = Number(item.qty || 0) * (Number(item.conversion_rate) || 1);
      const itemRevenue = Number(item.subtotal || 0);
      const itemCost = baseQty * Number(item.unit_cost || 0);
      const itemProfit = itemRevenue - itemCost;
      entry.revenue += itemRevenue;
      entry.cost += itemCost;
      entry.profit += itemProfit;
      entry.qty += baseQty;
      entry.itemCount += 1;
      entry.productKeys.add(item.product_id ?? prod?.id ?? item.product_name);
    }

    const totalSupplierRevenue = [...supplierMap.values()].reduce((s, sup) => s + sup.revenue, 0);
    const totalSupplierCost = [...supplierMap.values()].reduce((s, sup) => s + sup.cost, 0);
    const totalSupplierProfit = totalSupplierRevenue - totalSupplierCost;
    const totalSupplierQty = [...supplierMap.values()].reduce((s, sup) => s + sup.qty, 0);
    const totalSupplierItems = [...supplierMap.values()].reduce((s, sup) => s + sup.itemCount, 0);
    const supplierGrossMarginPct =
      totalSupplierRevenue > 0 ? (totalSupplierProfit / totalSupplierRevenue) * 100 : 0;
    const supplierStats = [...supplierMap.values()]
      .sort(
        (a, b) =>
          b.revenue - a.revenue ||
          b.profit - a.profit ||
          a.name.localeCompare(b.name, 'th')
      )
      .map((sup) => ({
        key: sup.key,
        name: sup.name,
        isAssigned: sup.isAssigned,
        color: sup.color,
        revenue: sup.revenue,
        cost: sup.cost,
        profit: sup.profit,
        qty: sup.qty,
        itemCount: sup.itemCount,
        productCount: sup.productKeys.size,
        pct: totalSupplierRevenue > 0 ? (sup.revenue / totalSupplierRevenue) * 100 : 0,
        marginPct: sup.revenue > 0 ? (sup.profit / sup.revenue) * 100 : 0,
      }));
    const assignedSupplierCount = supplierStats.filter((s) => s.isAssigned).length;

    // Expense & Income Category Breakdown
    const expenseCategoryMap = new Map<
      string,
      { key: string; category: string; type: 'expense' | 'income'; amount: number; count: number }
    >();
    for (const e of expenses) {
      const catName = e.category?.trim() || 'ทั่วไป';
      const key = `${e.type}:${catName}`;
      const prev = expenseCategoryMap.get(key) ?? {
        key,
        category: catName,
        type: e.type,
        amount: 0,
        count: 0,
      };
      prev.amount += Number(e.amount);
      prev.count += 1;
      expenseCategoryMap.set(key, prev);
    }
    const expenseCategorySummary = [...expenseCategoryMap.values()].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'expense' ? -1 : 1;
      return b.amount - a.amount;
    });

    // Store Expense Category Breakdown (expenses only, grouped by category/note)
    const storeExpenseMap = new Map<
      string,
      { category: string; count: number; amount: number }
    >();
    let expenseTotalCount = 0;
    for (const e of expenses) {
      if (e.type === 'income') continue;
      const catName = e.category?.trim() || e.note?.trim() || 'ทั่วไป / อื่นๆ';
      const amt = Number(e.amount ?? 0);
      const prev = storeExpenseMap.get(catName) ?? {
        category: catName,
        count: 0,
        amount: 0,
      };
      prev.count += 1;
      prev.amount += amt;
      expenseTotalCount += 1;
      storeExpenseMap.set(catName, prev);
    }
    const roundedOtherExpense = Math.round(otherExpense * 100) / 100;
    const expenseBreakdown = [...storeExpenseMap.values()]
      .map((item) => {
        const roundedAmt = Math.round(item.amount * 100) / 100;
        const sharePct =
          roundedOtherExpense > 0 ? (roundedAmt / roundedOtherExpense) * 100 : 0;
        return {
          category: item.category,
          count: item.count,
          amount: roundedAmt,
          sharePct,
        };
      })
      .sort((a, b) => {
        if (b.amount !== a.amount) return b.amount - a.amount;
        if (b.count !== a.count) return b.count - a.count;
        return a.category.localeCompare(b.category, 'th');
      });
    const expenseToSalesPct =
      totalSales > 0 ? (roundedOtherExpense / totalSales) * 100 : 0;
    const topExpenseCategory = expenseBreakdown[0] ?? null;

    const cashPct = totalSales > 0 ? (cashSales / totalSales) * 100 : 0;
    const qrPct = totalSales > 0 ? (qrSales / totalSales) * 100 : 0;
    const creditPct = totalSales > 0 ? (creditSales / totalSales) * 100 : 0;

    // Sales Trend Buckets (Time of day for today/yesterday, Daily for 7days/month)
    const trendBuckets: {
      key: string;
      label: string;
      subLabel?: string;
      amount: number;
      profit: number;
      count: number;
    }[] = [];

    if (
      period === 'today' ||
      period === 'yesterday' ||
      (period === 'custom' && customStart && customStart === customEnd)
    ) {
      const slots = [
        { key: 'early', label: 'เช้าตรู่', subLabel: '00:00-08:59', minH: 0, maxH: 8 },
        { key: 'morning', label: 'สาย', subLabel: '09:00-11:59', minH: 9, maxH: 11 },
        { key: 'afternoon', label: 'บ่าย', subLabel: '12:00-14:59', minH: 12, maxH: 14 },
        { key: 'evening', label: 'เย็น', subLabel: '15:00-17:59', minH: 15, maxH: 17 },
        { key: 'night', label: 'ค่ำ', subLabel: '18:00-23:59', minH: 18, maxH: 23 },
      ];
      const bucketMap = new Map(
        slots.map((sl) => [
          sl.key,
          { key: sl.key, label: sl.label, subLabel: sl.subLabel, amount: 0, profit: 0, count: 0 },
        ])
      );
      for (const s of sales) {
        const dt = new Date(s.created_at);
        const h = dt.getHours();
        const slot = slots.find((sl) => h >= sl.minH && h <= sl.maxH) ?? slots[slots.length - 1];
        const b = bucketMap.get(slot.key)!;
        const amt = Number(s.total_amount);
        const cost = Number(s.total_cost);
        b.amount += amt;
        b.profit += amt - cost;
        b.count += 1;
      }
      trendBuckets.push(...bucketMap.values());
    } else if (period === 'custom') {
      if (customStart && customEnd) {
        const [sStr, eStr] = customStart <= customEnd ? [customStart, customEnd] : [customEnd, customStart];
        const [sy, sm, sd] = sStr.split('-').map(Number);
        const [ey, em, ed] = eStr.split('-').map(Number);
        const startD = new Date(sy, sm - 1, sd);
        const endD = new Date(ey, em - 1, ed);
        const dayMap = new Map<
          string,
          { key: string; label: string; subLabel?: string; amount: number; profit: number; count: number }
        >();

        for (let i = 0; i < 62; i++) {
          const d = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate() + i);
          if (d > endD) break;
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const dateKey = `${y}-${m}-${day}`;
          const label = new Intl.DateTimeFormat('th-TH', {
            day: 'numeric',
            month: 'short',
          }).format(d);
          const subLabel = new Intl.DateTimeFormat('th-TH', {
            weekday: 'short',
          }).format(d);
          dayMap.set(dateKey, { key: dateKey, label, subLabel, amount: 0, profit: 0, count: 0 });
        }

        for (const s of sales) {
          const dt = new Date(s.created_at);
          const y = dt.getFullYear();
          const m = String(dt.getMonth() + 1).padStart(2, '0');
          const day = String(dt.getDate()).padStart(2, '0');
          const dateKey = `${y}-${m}-${day}`;
          const entry = dayMap.get(dateKey);
          if (entry) {
            const amt = Number(s.total_amount);
            const cost = Number(s.total_cost);
            entry.amount += amt;
            entry.profit += amt - cost;
            entry.count += 1;
          }
        }

        trendBuckets.push(...dayMap.values());
      }
    } else {
      const dayMap = new Map<
        string,
        { key: string; label: string; subLabel?: string; amount: number; profit: number; count: number }
      >();

      for (const slot of dailySlots) {
        dayMap.set(slot.dateKey, {
          key: slot.dateKey,
          label: slot.label,
          subLabel: slot.subLabel,
          amount: 0,
          profit: 0,
          count: 0,
        });
      }

      for (const s of sales) {
        const dt = new Date(s.created_at);
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const day = String(dt.getDate()).padStart(2, '0');
        const dateKey = `${y}-${m}-${day}`;
        const entry = dayMap.get(dateKey);
        if (entry) {
          const amt = Number(s.total_amount);
          const cost = Number(s.total_cost);
          entry.amount += amt;
          entry.profit += amt - cost;
          entry.count += 1;
        }
      }

      trendBuckets.push(...dayMap.values());
    }

    const maxTrendAmount = trendBuckets.reduce((max, b) => Math.max(max, b.amount), 0);

    // Sales by Day of Week (Monday to Sunday)
    const dowMap = new Map<
      number,
      { dayIndex: number; label: string; shortLabel: string; amount: number; profit: number; count: number }
    >(
      DAY_OF_WEEK_ORDER.map((d) => [
        d.dayIndex,
        { ...d, amount: 0, profit: 0, count: 0 },
      ])
    );
    for (const s of sales) {
      const dayIdx = new Date(s.created_at).getDay();
      const entry = dowMap.get(dayIdx);
      if (entry) {
        const amt = Number(s.total_amount);
        const cost = Number(s.total_cost);
        entry.amount += amt;
        entry.profit += amt - cost;
        entry.count += 1;
      }
    }
    const dayOfWeekStats = DAY_OF_WEEK_ORDER.map((d) => dowMap.get(d.dayIndex)!);
    const maxDowAmount = dayOfWeekStats.reduce((max, d) => Math.max(max, d.amount), 0);
    const bestDayOfWeek =
      maxDowAmount > 0
        ? dayOfWeekStats.reduce((best, d) => (d.amount > best.amount ? d : best), dayOfWeekStats[0])
        : null;

    // Daily Trading Highlights (Best Sales Day, Best Profit Day, Active Trading Days & Avg)
    const dailySlotByKey = new Map(dailySlots.map((slot) => [slot.dateKey, slot]));
    const activeDayMap = new Map<
      string,
      {
        dateKey: string;
        label: string;
        subLabel: string;
        billCount: number;
        totalSales: number;
        totalCost: number;
      }
    >();
    for (const s of sales) {
      const dt = new Date(s.created_at);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      const dateKey = `${y}-${m}-${day}`;
      const existing = activeDayMap.get(dateKey);
      if (existing) {
        existing.billCount += 1;
        existing.totalSales += Number(s.total_amount);
        existing.totalCost += Number(s.total_cost);
      } else {
        const slot = dailySlotByKey.get(dateKey);
        activeDayMap.set(dateKey, {
          dateKey,
          label:
            slot?.label ??
            new Intl.DateTimeFormat('th-TH', {
              day: 'numeric',
              month: 'short',
              year: '2-digit',
            }).format(dt),
          subLabel:
            slot?.subLabel ??
            new Intl.DateTimeFormat('th-TH', {
              weekday: 'short',
            }).format(dt),
          billCount: 1,
          totalSales: Number(s.total_amount),
          totalCost: Number(s.total_cost),
        });
      }
    }
    const activeTradingDays = [...activeDayMap.values()].map((d) => {
      const dayGrossProfit = d.totalSales - d.totalCost;
      const dayMarginPct = d.totalSales > 0 ? (dayGrossProfit / d.totalSales) * 100 : 0;
      return {
        dateKey: d.dateKey,
        label: d.label,
        subLabel: d.subLabel,
        billCount: d.billCount,
        totalSales: d.totalSales,
        grossProfit: dayGrossProfit,
        marginPct: dayMarginPct,
      };
    });
    const activeTradingDaysCount = activeTradingDays.length;
    const avgSalesPerActiveDay =
      activeTradingDaysCount > 0 ? totalSales / activeTradingDaysCount : 0;
    const bestSalesDay =
      activeTradingDays.length > 0
        ? activeTradingDays.reduce(
            (best, d) =>
              d.totalSales > best.totalSales ||
              (d.totalSales === best.totalSales && d.grossProfit > best.grossProfit)
                ? d
                : best,
            activeTradingDays[0]
          )
        : null;
    const bestProfitDay =
      activeTradingDays.length > 0
        ? activeTradingDays.reduce(
            (best, d) =>
              d.grossProfit > best.grossProfit ||
              (d.grossProfit === best.grossProfit && d.totalSales > best.totalSales)
                ? d
                : best,
            activeTradingDays[0]
          )
        : null;

    // Sales by Time of Day (from sale.created_at)
    const timeOfDayMap = new Map<
      TimeOfDayKey,
      { key: TimeOfDayKey; label: string; rangeLabel: string; amount: number; count: number }
    >(
      TIME_OF_DAY_SLOTS.map((slot) => [
        slot.key,
        { ...slot, amount: 0, count: 0 },
      ])
    );
    for (const s of sales) {
      if (!s.created_at) continue;
      const d = new Date(s.created_at);
      if (Number.isNaN(d.getTime())) continue;
      const slotKey = getTimeOfDayKey(d.getHours());
      const entry = timeOfDayMap.get(slotKey);
      if (entry) {
        entry.amount += Number(s.total_amount);
        entry.count += 1;
      }
    }
    const timeOfDayStats = TIME_OF_DAY_SLOTS.map((slot) => {
      const entry = timeOfDayMap.get(slot.key)!;
      const pct = totalSales > 0 ? (entry.amount / totalSales) * 100 : 0;
      return { ...entry, pct };
    });
    const bestTimeOfDay =
      totalSales > 0
        ? timeOfDayStats.reduce((best, cur) => (cur.amount > best.amount ? cur : best), timeOfDayStats[0])
        : null;

    // Sales by Hour (00:00 - 23:00 from sale.created_at)
    const hourlyBuckets = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      rangeLabel: `${String(hour).padStart(2, '0')}:00–${String(hour).padStart(2, '0')}:59`,
      amount: 0,
      count: 0,
    }));
    for (const s of sales) {
      if (!s.created_at) continue;
      const d = new Date(s.created_at);
      if (Number.isNaN(d.getTime())) continue;
      const hr = d.getHours();
      const bucket = hourlyBuckets[hr];
      if (bucket) {
        bucket.amount += Number(s.total_amount);
        bucket.count += 1;
      }
    }
    const activeHourlyStats = hourlyBuckets
      .filter((b) => b.count > 0 || b.amount > 0)
      .map((b) => ({
        ...b,
        amount: Math.round(b.amount * 100) / 100,
        avgTicket: b.count > 0 ? Math.round((b.amount / b.count) * 100) / 100 : 0,
        pct: totalSales > 0 ? (b.amount / totalSales) * 100 : 0,
      }));
    const maxHourlyAmount = activeHourlyStats.reduce(
      (max, b) => Math.max(max, b.amount),
      0
    );
    const peakHourByRevenue =
      activeHourlyStats.length > 0
        ? activeHourlyStats.reduce(
            (best, cur) =>
              cur.amount > best.amount ||
              (cur.amount === best.amount && cur.count > best.count)
                ? cur
                : best,
            activeHourlyStats[0]
          )
        : null;
    const peakHourByBills =
      activeHourlyStats.length > 0
        ? activeHourlyStats.reduce(
            (best, cur) =>
              cur.count > best.count ||
              (cur.count === best.count && cur.amount > best.amount)
                ? cur
                : best,
            activeHourlyStats[0]
          )
        : null;

    // Top Customers by Spend
    const customerById = new Map<string, Customer>();
    for (const c of customers) {
      customerById.set(c.id, c);
    }
    const customerSpendMap = new Map<
      string,
      {
        id: string;
        name: string;
        phone: string;
        billCount: number;
        totalSpend: number;
        cashQrSpend: number;
        creditSpend: number;
        currentDebt: number;
      }
    >();
    for (const s of sales) {
      if (!s.customer_id && !s.customers?.name) continue;
      const cust = s.customer_id ? customerById.get(s.customer_id) : undefined;
      const key = s.customer_id ?? `name:${s.customers?.name ?? ''}`;
      const name = cust?.name ?? s.customers?.name ?? 'ลูกค้าไม่ระบุชื่อ';
      const prev = customerSpendMap.get(key) ?? {
        id: key,
        name,
        phone: cust?.phone ?? '',
        billCount: 0,
        totalSpend: 0,
        cashQrSpend: 0,
        creditSpend: 0,
        currentDebt: Number(cust?.total_debt ?? 0),
      };
      const amt = Number(s.total_amount ?? 0);
      prev.billCount += 1;
      prev.totalSpend += amt;
      if (s.payment_method === 'credit') {
        prev.creditSpend += amt;
      } else {
        prev.cashQrSpend += amt;
      }
      customerSpendMap.set(key, prev);
    }
    const allTopCustomers = [...customerSpendMap.values()].sort(
      (a, b) =>
        b.totalSpend - a.totalSpend ||
        b.billCount - a.billCount ||
        a.name.localeCompare(b.name, 'th')
    );
    const topCustomers = allTopCustomers.slice(0, 5);
    const regularCustomerSalesTotal = allTopCustomers.reduce((sum, c) => sum + c.totalSpend, 0);
    const regularCustomerCashQrTotal = allTopCustomers.reduce((sum, c) => sum + c.cashQrSpend, 0);
    const regularCustomerCreditTotal = allTopCustomers.reduce((sum, c) => sum + c.creditSpend, 0);
    const regularCustomerBillCount = allTopCustomers.reduce((sum, c) => sum + c.billCount, 0);
    const regularCustomerSharePct =
      totalSales > 0 ? (regularCustomerSalesTotal / totalSales) * 100 : 0;

    // Member (customer_id !== null) vs Walk-in (customer_id === null) on completed bills
    let memberBillsCount = 0;
    let memberSalesTotal = 0;
    let walkInBillsCount = 0;
    let walkInSalesTotal = 0;
    for (const s of sales) {
      if (isCancelledSale(s)) continue;
      const amt = Number(s.total_amount ?? 0);
      if (s.customer_id !== null) {
        memberBillsCount += 1;
        memberSalesTotal += amt;
      } else {
        walkInBillsCount += 1;
        walkInSalesTotal += amt;
      }
    }
    const memberWalkInTotalBills = memberBillsCount + walkInBillsCount;
    const memberWalkInTotalRevenue = memberSalesTotal + walkInSalesTotal;
    const memberVsWalkIn = {
      totalBills: memberWalkInTotalBills,
      totalRevenue: memberWalkInTotalRevenue,
      member: {
        billCount: memberBillsCount,
        salesTotal: memberSalesTotal,
        salesPct: memberWalkInTotalRevenue > 0 ? (memberSalesTotal / memberWalkInTotalRevenue) * 100 : 0,
        billsPct: memberWalkInTotalBills > 0 ? (memberBillsCount / memberWalkInTotalBills) * 100 : 0,
        aov: memberBillsCount > 0 ? memberSalesTotal / memberBillsCount : 0,
      },
      walkIn: {
        billCount: walkInBillsCount,
        salesTotal: walkInSalesTotal,
        salesPct: memberWalkInTotalRevenue > 0 ? (walkInSalesTotal / memberWalkInTotalRevenue) * 100 : 0,
        billsPct: memberWalkInTotalBills > 0 ? (walkInBillsCount / memberWalkInTotalBills) * 100 : 0,
        aov: walkInBillsCount > 0 ? walkInSalesTotal / walkInBillsCount : 0,
      },
    };

    // Order Value Distribution / Ticket Size Tiers (successful bills only)
    const ticketTierMap = new Map<
      TicketSizeTierKey,
      {
        key: TicketSizeTierKey;
        label: string;
        shortLabel: string;
        desc: string;
        barClass: string;
        badgeClass: string;
        dotClass: string;
        count: number;
        revenue: number;
      }
    >(
      TICKET_SIZE_TIERS.map((tier) => [
        tier.key,
        {
          key: tier.key,
          label: tier.label,
          shortLabel: tier.shortLabel,
          desc: tier.desc,
          barClass: tier.barClass,
          badgeClass: tier.badgeClass,
          dotClass: tier.dotClass,
          count: 0,
          revenue: 0,
        },
      ])
    );
    let completedBillsCount = 0;
    let completedBillsRevenue = 0;
    for (const s of sales) {
      if (isCancelledSale(s)) continue;
      const amt = Number(s.total_amount ?? 0);
      const tierKey = getTicketSizeTierKey(amt);
      const entry = ticketTierMap.get(tierKey);
      if (entry) {
        entry.count += 1;
        entry.revenue += amt;
      }
      completedBillsCount += 1;
      completedBillsRevenue += amt;
    }
    const ticketSizeDistribution = TICKET_SIZE_TIERS.map((tier) => {
      const entry = ticketTierMap.get(tier.key)!;
      const billPct = completedBillsCount > 0 ? (entry.count / completedBillsCount) * 100 : 0;
      const revenuePct =
        completedBillsRevenue > 0 ? (entry.revenue / completedBillsRevenue) * 100 : 0;
      return {
        ...entry,
        billPct,
        revenuePct,
      };
    });
    const topTicketTierByCount =
      completedBillsCount > 0
        ? ticketSizeDistribution.reduce(
            (best, cur) => (cur.count > best.count ? cur : best),
            ticketSizeDistribution[0]
          )
        : null;
    const topTicketTierByRevenue =
      completedBillsRevenue > 0
        ? ticketSizeDistribution.reduce(
            (best, cur) => (cur.revenue > best.revenue ? cur : best),
            ticketSizeDistribution[0]
          )
        : null;

    // Frequently Bought Together / Top 5 Market Basket Pairs (from bills with >= 2 distinct products)
    const cancelledSaleIds = new Set<string>();
    for (const s of sales) {
      if (isCancelledSale(s)) {
        cancelledSaleIds.add(s.id);
      }
    }

    // Single Unit (Retail) vs Multi-Pack Sales Mix (from completed bills' saleItems)
    let retailItemCount = 0;
    let retailQtyTotal = 0;
    let retailRevenue = 0;
    let retailCost = 0;
    let packItemCount = 0;
    let packQtyTotal = 0;
    let packRevenue = 0;
    let packCost = 0;

    for (const item of saleItems) {
      if (item.sale_id && cancelledSaleIds.has(item.sale_id)) continue;
      const convRate = Number(item.conversion_rate || 1);
      const qty = Number(item.qty || 0);
      const baseQty = qty * convRate;
      const itemRevenue = Number(item.subtotal || 0);
      const itemCost = baseQty * Number(item.unit_cost || 0);
      if (convRate > 1) {
        packItemCount += 1;
        packQtyTotal += qty;
        packRevenue += itemRevenue;
        packCost += itemCost;
      } else {
        retailItemCount += 1;
        retailQtyTotal += qty;
        retailRevenue += itemRevenue;
        retailCost += itemCost;
      }
    }

    const retailProfit = retailRevenue - retailCost;
    const packProfit = packRevenue - packCost;
    const mixTotalItems = retailItemCount + packItemCount;
    const mixTotalRevenue = retailRevenue + packRevenue;
    const mixTotalProfit = retailProfit + packProfit;

    const retailVsPackMix = {
      totalItems: mixTotalItems,
      totalRevenue: mixTotalRevenue,
      totalProfit: mixTotalProfit,
      retail: {
        itemCount: retailItemCount,
        qtyTotal: retailQtyTotal,
        revenue: retailRevenue,
        cost: retailCost,
        profit: retailProfit,
        marginPct: retailRevenue > 0 ? (retailProfit / retailRevenue) * 100 : 0,
        itemsPct: mixTotalItems > 0 ? (retailItemCount / mixTotalItems) * 100 : 0,
        salesPct: mixTotalRevenue > 0 ? (retailRevenue / mixTotalRevenue) * 100 : 0,
        profitPct: mixTotalProfit > 0 ? (retailProfit / mixTotalProfit) * 100 : 0,
      },
      pack: {
        itemCount: packItemCount,
        qtyTotal: packQtyTotal,
        revenue: packRevenue,
        cost: packCost,
        profit: packProfit,
        marginPct: packRevenue > 0 ? (packProfit / packRevenue) * 100 : 0,
        itemsPct: mixTotalItems > 0 ? (packItemCount / mixTotalItems) * 100 : 0,
        salesPct: mixTotalRevenue > 0 ? (packRevenue / mixTotalRevenue) * 100 : 0,
        profitPct: mixTotalProfit > 0 ? (packProfit / mixTotalProfit) * 100 : 0,
      },
    };

    const billProductsMap = new Map<string, Map<string, number>>();
    for (const item of saleItems) {
      if (!item.sale_id || cancelledSaleIds.has(item.sale_id)) continue;
      const prodName = (item.product_name ?? '').trim();
      if (!prodName) continue;
      let prodSubtotalMap = billProductsMap.get(item.sale_id);
      if (!prodSubtotalMap) {
        prodSubtotalMap = new Map<string, number>();
        billProductsMap.set(item.sale_id, prodSubtotalMap);
      }
      prodSubtotalMap.set(
        prodName,
        (prodSubtotalMap.get(prodName) ?? 0) + Number(item.subtotal || 0)
      );
    }

    const totalBasketBills =
      completedBillsCount > 0 ? completedBillsCount : billProductsMap.size;
    let multiItemBillsCount = 0;
    const basketPairMap = new Map<
      string,
      {
        key: string;
        productA: string;
        productB: string;
        billCount: number;
        combinedRevenue: number;
      }
    >();

    for (const prodSubtotalMap of billProductsMap.values()) {
      if (prodSubtotalMap.size < 2) continue;
      multiItemBillsCount += 1;
      const productNames = [...prodSubtotalMap.keys()].sort(
        (a, b) => a.localeCompare(b, 'th') || (a < b ? -1 : a > b ? 1 : 0)
      );
      for (let i = 0; i < productNames.length; i++) {
        const prodA = productNames[i];
        const revA = prodSubtotalMap.get(prodA) ?? 0;
        for (let j = i + 1; j < productNames.length; j++) {
          const prodB = productNames[j];
          const revB = prodSubtotalMap.get(prodB) ?? 0;
          const pairKey = JSON.stringify([prodA, prodB]);
          const prev = basketPairMap.get(pairKey) ?? {
            key: pairKey,
            productA: prodA,
            productB: prodB,
            billCount: 0,
            combinedRevenue: 0,
          };
          prev.billCount += 1;
          prev.combinedRevenue += revA + revB;
          basketPairMap.set(pairKey, prev);
        }
      }
    }

    const totalUniqueBasketPairs = basketPairMap.size;
    const multiItemBillsPct =
      totalBasketBills > 0 ? (multiItemBillsCount / totalBasketBills) * 100 : 0;
    const topBasketPairs = [...basketPairMap.values()]
      .sort(
        (a, b) =>
          b.billCount - a.billCount ||
          b.combinedRevenue - a.combinedRevenue ||
          a.productA.localeCompare(b.productA, 'th') ||
          a.productB.localeCompare(b.productB, 'th')
      )
      .slice(0, 5)
      .map((pair) => ({
        ...pair,
        pctOfAllBills:
          totalBasketBills > 0 ? (pair.billCount / totalBasketBills) * 100 : 0,
        pctOfMultiBills:
          multiItemBillsCount > 0 ? (pair.billCount / multiItemBillsCount) * 100 : 0,
      }));

    // Stock Shrinkage & Adjustments (stock_movements where type = 'adjust')
    let shrinkageCount = 0;
    let rawShrinkageUnitsTotal = 0;
    let rawShrinkageCostTotal = 0;
    let adjustmentAddCount = 0;
    let rawAdjustmentAddUnitsTotal = 0;
    let rawAdjustmentAddCostTotal = 0;
    const shrinkageItems: {
      id: string;
      productId: string;
      productName: string;
      categoryName: string | null;
      baseUnit: string;
      qtyChange: number;
      absQty: number;
      unitCost: number;
      costImpact: number;
      note: string;
      createdAt: string;
    }[] = [];

    const sortedStockAdjustments = [...stockAdjustments].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    for (const m of sortedStockAdjustments) {
      const qtyChange = Number(m.qty_change ?? 0);
      if (!Number.isFinite(qtyChange)) continue;
      const prod = m.product_id ? productById.get(m.product_id) : undefined;
      const joinedProd = Array.isArray(m.products) ? m.products[0] : m.products;
      const productName = prod?.name ?? joinedProd?.name ?? 'สินค้าไม่ระบุชื่อ';
      const baseUnit = prod?.base_unit ?? joinedProd?.base_unit ?? 'ชิ้น';
      const rawCost = Number(prod?.cost_price ?? joinedProd?.cost_price ?? 0);
      const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
      const cat = prod?.category_id ? categoryById.get(prod.category_id) : undefined;

      if (qtyChange < 0) {
        const absQty = Math.round(Math.abs(qtyChange) * 10000) / 10000;
        const costImpact = Math.round(absQty * unitCost * 100) / 100;
        shrinkageCount += 1;
        rawShrinkageUnitsTotal += absQty;
        rawShrinkageCostTotal += costImpact;
        shrinkageItems.push({
          id: m.id,
          productId: m.product_id,
          productName,
          categoryName: cat?.name ?? null,
          baseUnit,
          qtyChange,
          absQty,
          unitCost,
          costImpact,
          note: (m.note ?? '').trim() || 'ปรับลดสต็อก',
          createdAt: m.created_at,
        });
      } else if (qtyChange > 0) {
        adjustmentAddCount += 1;
        rawAdjustmentAddUnitsTotal += qtyChange;
        rawAdjustmentAddCostTotal += qtyChange * unitCost;
      }
    }

    const shrinkageUnitsTotal = Math.round(rawShrinkageUnitsTotal * 10000) / 10000;
    const shrinkageCostTotal = Math.round(rawShrinkageCostTotal * 100) / 100;
    const adjustmentAddUnitsTotal = Math.round(rawAdjustmentAddUnitsTotal * 10000) / 10000;
    const adjustmentAddCostTotal = Math.round(rawAdjustmentAddCostTotal * 100) / 100;
    const netAdjustmentCost =
      Math.round((adjustmentAddCostTotal - shrinkageCostTotal) * 100) / 100;
    const totalAdjustmentCount = sortedStockAdjustments.length;
    const shrinkagePctOfSales = totalSales > 0 ? (shrinkageCostTotal / totalSales) * 100 : 0;

    // Void & Partial Return Audit (from sales + sale.note)
    let cancelledSalesCount = 0;
    let rawCancelledSalesAmount = 0;
    let partialReturnBillsCount = 0;
    let rawPartialReturnRefundTotal = 0;
    const voidReturnAuditItems: {
      id: string;
      createdAt: string;
      type: 'cancelled' | 'partial_return';
      amount: number;
      billTotal: number;
      paymentMethod: PaymentMethod;
      note: string;
    }[] = [];

    for (const s of sales) {
      const billAmt = Number(s.total_amount);
      const noteText = (s.note ?? '').trim();
      if (isCancelledSale(s)) {
        cancelledSalesCount += 1;
        rawCancelledSalesAmount += billAmt;
        voidReturnAuditItems.push({
          id: s.id,
          createdAt: s.created_at,
          type: 'cancelled',
          amount: billAmt,
          billTotal: billAmt,
          paymentMethod: s.payment_method,
          note: noteText || 'ยกเลิกบิล',
        });
      } else if (noteText.includes('รับคืนสินค้า:')) {
        const refundMatches = [...noteText.matchAll(/\(คืนเงิน\s*฿([\d,]+(?:\.\d+)?)\)/g)];
        let refundAmt = 0;
        for (const m of refundMatches) {
          refundAmt += parseFormattedNumber(m[1]);
        }
        refundAmt = Math.round(refundAmt * 100) / 100;
        partialReturnBillsCount += 1;
        rawPartialReturnRefundTotal += refundAmt;
        voidReturnAuditItems.push({
          id: s.id,
          createdAt: s.created_at,
          type: 'partial_return',
          amount: refundAmt,
          billTotal: billAmt,
          paymentMethod: s.payment_method,
          note: noteText,
        });
      }
    }

    voidReturnAuditItems.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const cancelledSalesAmount = Math.round(rawCancelledSalesAmount * 100) / 100;
    const partialReturnRefundTotal = Math.round(rawPartialReturnRefundTotal * 100) / 100;
    const voidReturnTotalImpact =
      Math.round((cancelledSalesAmount + partialReturnRefundTotal) * 100) / 100;

    // Promotional Items Performance (inventory_promo_labels_v1)
    const labeledProductIds = Object.keys(promoLabels).filter(
      (id) => typeof promoLabels[id] === 'string' && promoLabels[id].trim().length > 0
    );
    const promoProductStatMap = new Map<
      string,
      {
        productId: string;
        name: string;
        promoLabel: string;
        baseUnit: string;
        qty: number;
        revenue: number;
        cost: number;
        profit: number;
        saleIds: Set<string>;
      }
    >();
    const promoSaleIds = new Set<string>();

    for (const item of saleItems) {
      const prod =
        (item.product_id ? productById.get(item.product_id) : undefined) ??
        productByName.get(item.product_name);
      const pid = prod?.id ?? item.product_id;
      if (!pid) continue;
      const promoLabel = promoLabels[pid]?.trim();
      if (!promoLabel) continue;

      const baseQty = Number(item.qty || 0) * (Number(item.conversion_rate) || 1);
      const itemRevenue = Number(item.subtotal);
      const itemCost = baseQty * Number(item.unit_cost);
      const itemProfit = itemRevenue - itemCost;

      if (item.sale_id) promoSaleIds.add(item.sale_id);

      const entry = promoProductStatMap.get(pid) ?? {
        productId: pid,
        name: prod?.name ?? item.product_name,
        promoLabel,
        baseUnit: prod?.base_unit ?? item.unit_name ?? 'ชิ้น',
        qty: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        saleIds: new Set<string>(),
      };
      entry.qty += baseQty;
      entry.revenue += itemRevenue;
      entry.cost += itemCost;
      entry.profit += itemProfit;
      if (item.sale_id) entry.saleIds.add(item.sale_id);
      promoProductStatMap.set(pid, entry);
    }

    const promoProductRows = [...promoProductStatMap.values()]
      .map((entry) => ({
        productId: entry.productId,
        name: entry.name,
        promoLabel: entry.promoLabel,
        baseUnit: entry.baseUnit,
        qty: Math.round(entry.qty * 100) / 100,
        revenue: Math.round(entry.revenue * 100) / 100,
        cost: Math.round(entry.cost * 100) / 100,
        profit: Math.round(entry.profit * 100) / 100,
        marginPct: entry.revenue > 0 ? (entry.profit / entry.revenue) * 100 : 0,
        billCount: entry.saleIds.size,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty);

    const promoLabelMap = new Map<
      string,
      {
        label: string;
        productIds: Set<string>;
        qty: number;
        revenue: number;
        profit: number;
      }
    >();
    for (const pid of labeledProductIds) {
      const lbl = promoLabels[pid].trim();
      const group = promoLabelMap.get(lbl) ?? {
        label: lbl,
        productIds: new Set<string>(),
        qty: 0,
        revenue: 0,
        profit: 0,
      };
      group.productIds.add(pid);
      promoLabelMap.set(lbl, group);
    }
    for (const row of promoProductRows) {
      const group = promoLabelMap.get(row.promoLabel);
      if (group) {
        group.qty += row.qty;
        group.revenue += row.revenue;
        group.profit += row.profit;
      }
    }
    const promoByLabel = [...promoLabelMap.values()]
      .map((g) => ({
        label: g.label,
        labeledCount: g.productIds.size,
        qty: Math.round(g.qty * 100) / 100,
        revenue: Math.round(g.revenue * 100) / 100,
        profit: Math.round(g.profit * 100) / 100,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.labeledCount - a.labeledCount);

    const promoTotalQty =
      Math.round(promoProductRows.reduce((s, r) => s + r.qty, 0) * 100) / 100;
    const promoTotalRevenue =
      Math.round(promoProductRows.reduce((s, r) => s + r.revenue, 0) * 100) / 100;
    const promoTotalCost =
      Math.round(promoProductRows.reduce((s, r) => s + r.cost, 0) * 100) / 100;
    const promoTotalProfit =
      Math.round((promoTotalRevenue - promoTotalCost) * 100) / 100;

    const promoProductsStats = {
      totalLabeledProducts: labeledProductIds.length,
      soldPromoProductsCount: promoProductRows.length,
      totalBillsCount: promoSaleIds.size,
      totalQty: promoTotalQty,
      totalRevenue: promoTotalRevenue,
      totalCost: promoTotalCost,
      totalProfit: promoTotalProfit,
      grossMarginPct: promoTotalRevenue > 0 ? (promoTotalProfit / promoTotalRevenue) * 100 : 0,
      revenueSharePct: totalSales > 0 ? (promoTotalRevenue / totalSales) * 100 : 0,
      profitSharePct: grossProfit > 0 ? (promoTotalProfit / grossProfit) * 100 : 0,
      items: promoProductRows,
      byLabel: promoByLabel,
    };

    // Customer Segment Analysis (customer_tags_v1)
    const UNTAGGED_SEGMENT_LABEL = 'ยังไม่จัดกลุ่ม';
    const segmentMap = new Map<
      string,
      {
        label: string;
        isUntagged: boolean;
        customerCount: number;
        debtorCount: number;
        totalDebt: number;
        billCount: number;
        totalSales: number;
        cashQrSales: number;
        creditSales: number;
      }
    >();
    const ensureSegment = (label: string, isUntagged: boolean) => {
      const existing = segmentMap.get(label);
      if (existing) return existing;
      const created = {
        label,
        isUntagged,
        customerCount: 0,
        debtorCount: 0,
        totalDebt: 0,
        billCount: 0,
        totalSales: 0,
        cashQrSales: 0,
        creditSales: 0,
      };
      segmentMap.set(label, created);
      return created;
    };

    let totalTaggedCustomers = 0;
    let totalCustomerDebtAll = 0;
    for (const c of customers) {
      const rawTag = customerTags[c.id]?.trim() || '';
      const isUntagged = rawTag.length === 0;
      const label = isUntagged ? UNTAGGED_SEGMENT_LABEL : rawTag;
      if (!isUntagged) totalTaggedCustomers += 1;
      const seg = ensureSegment(label, isUntagged);
      seg.customerCount += 1;
      const debt = Math.max(0, Number(c.total_debt ?? 0) || 0);
      seg.totalDebt += debt;
      totalCustomerDebtAll += debt;
      if (debt > 0) seg.debtorCount += 1;
    }

    for (const s of sales) {
      if (isCancelledSale(s)) continue;
      if (!s.customer_id) continue;
      const rawTag = customerTags[s.customer_id]?.trim() || '';
      const isUntagged = rawTag.length === 0;
      const label = isUntagged ? UNTAGGED_SEGMENT_LABEL : rawTag;
      const seg = ensureSegment(label, isUntagged);
      const amt = Number(s.total_amount ?? 0);
      seg.billCount += 1;
      seg.totalSales += amt;
      if (s.payment_method === 'credit') {
        seg.creditSales += amt;
      } else {
        seg.cashQrSales += amt;
      }
    }

    const segmentRows = [...segmentMap.values()]
      .map((seg) => ({
        ...seg,
        totalSales: Math.round(seg.totalSales * 100) / 100,
        cashQrSales: Math.round(seg.cashQrSales * 100) / 100,
        creditSales: Math.round(seg.creditSales * 100) / 100,
        totalDebt: Math.round(seg.totalDebt * 100) / 100,
        aov: seg.billCount > 0 ? seg.totalSales / seg.billCount : 0,
        salesSharePct: totalSales > 0 ? (seg.totalSales / totalSales) * 100 : 0,
        debtSharePct: totalCustomerDebtAll > 0 ? (seg.totalDebt / totalCustomerDebtAll) * 100 : 0,
      }))
      .sort((a, b) => {
        if (a.isUntagged !== b.isUntagged) return a.isUntagged ? 1 : -1;
        return (
          b.totalSales - a.totalSales ||
          b.totalDebt - a.totalDebt ||
          b.customerCount - a.customerCount ||
          a.label.localeCompare(b.label, 'th')
        );
      });

    const taggedSegmentsOnly = segmentRows.filter((seg) => !seg.isUntagged);
    const totalTaggedSales =
      Math.round(taggedSegmentsOnly.reduce((s, r) => s + r.totalSales, 0) * 100) / 100;
    const totalTaggedBills = taggedSegmentsOnly.reduce((s, r) => s + r.billCount, 0);
    const totalTaggedDebt =
      Math.round(taggedSegmentsOnly.reduce((s, r) => s + r.totalDebt, 0) * 100) / 100;

    const customerSegmentStats = {
      totalCustomersCount: customers.length,
      totalTaggedCustomers,
      totalSegmentsCount: taggedSegmentsOnly.length,
      totalTaggedSales,
      totalTaggedBills,
      totalTaggedDebt,
      totalCustomerDebt: Math.round(totalCustomerDebtAll * 100) / 100,
      taggedSalesSharePct: totalSales > 0 ? (totalTaggedSales / totalSales) * 100 : 0,
      segments: segmentRows,
    };

    // 5-Pillar Store Health Scorecard (20 pts each = 100 pts total)
    type HealthStatus = 'ดีเยี่ยม' | 'ปกติ' | 'ต้องดูแล';
    const toHealthStatus = (score: number): HealthStatus =>
      score >= 16 ? 'ดีเยี่ยม' : score >= 11 ? 'ปกติ' : 'ต้องดูแล';

    const periodGoal = Math.max(0, dailyGoal * periodDays);
    const goalRatioPct =
      periodGoal > 0 ? (totalSales / periodGoal) * 100 : totalSales > 0 ? 100 : 0;
    const salesGoalScore =
      periodGoal > 0
        ? Math.min(20, Math.max(0, Math.round((totalSales / periodGoal) * 20)))
        : totalSales > 0
          ? 20
          : 10;
    const salesGoalStatus = toHealthStatus(salesGoalScore);
    const salesGoalAdvice =
      salesGoalStatus === 'ดีเยี่ยม'
        ? 'ยอดขายเข้าเป้าตามแผน รักษาจังหวะสินค้าขายดีและจัดโปรโมชันต่อเนื่อง'
        : salesGoalStatus === 'ปกติ'
          ? 'ยอดขายใกล้เคียงเป้าหมาย แนะนำจัดชุดสินค้าขายพ่วงหรือกระตุ้นบิลช่วงชั่วโมงเงียบ'
          : 'ยอดขายต่ำกว่าเป้ามาก ควรเร่งโปรโมชันดึงลูกค้าหน้าร้านและตรวจสอบสินค้าขายดีที่ขาดสต็อก';

    const cannotCalcBreakEven = otherExpense > 0 && grossMarginPct <= 0;
    const isAboveBreakEven = !cannotCalcBreakEven && totalSales >= breakEvenSales;
    const breakEvenSubScore = cannotCalcBreakEven
      ? 0
      : otherExpense === 0 || isAboveBreakEven
        ? 10
        : breakEvenSales > 0
          ? Math.min(9, Math.max(0, Math.round((totalSales / breakEvenSales) * 9)))
          : 0;
    const netMarginSubScore =
      netMarginPct >= 15
        ? 10
        : netMarginPct >= 8
          ? Math.round(7 + ((netMarginPct - 8) / 7) * 2)
          : netMarginPct > 0
            ? Math.round(3 + (netMarginPct / 8) * 3)
            : 0;
    const profitScore = Math.min(20, Math.max(0, breakEvenSubScore + netMarginSubScore));
    const profitStatus = toHealthStatus(profitScore);
    const profitAdvice =
      profitStatus === 'ดีเยี่ยม'
        ? 'กำไรสุทธิและยอดขายเหนือจุดคุ้มทุนแข็งแกร่ง บริหารต้นทุนได้ดี'
        : profitStatus === 'ปกติ'
          ? 'ผ่านจุดคุ้มทุนหรือมีกำไรพอสมควร ควรทบทวนรายการค่าใช้จ่ายร้านและสินค้ามาร์จิ้นต่ำ'
          : 'กำไรสุทธิต่ำหรือยังไม่ถึงจุดคุ้มทุน ควรลดรายจ่ายที่ไม่จำเป็นและปรับสัดส่วนสินค้ากำไรสูง';

    const totalActiveCatalogCount = totalInventoryCapitalCount + criticalOutOfStockCount;
    const readyToSellCount = Math.max(0, totalInventoryCapitalCount - expiredStockCount);
    const inventoryReadinessPct =
      totalActiveCatalogCount > 0 ? (readyToSellCount / totalActiveCatalogCount) * 100 : 100;
    const inventoryScore = Math.min(
      20,
      Math.max(0, Math.round((inventoryReadinessPct / 100) * 20))
    );
    const inventoryStatus = toHealthStatus(inventoryScore);
    const inventoryAdvice =
      inventoryStatus === 'ดีเยี่ยม'
        ? 'สต็อกพร้อมขายสูง สินค้าหมดและสินค้าหมดอายุอยู่ในระดับต่ำมาก'
        : inventoryStatus === 'ปกติ'
          ? 'มีสินค้าบางส่วนใกล้หมดหรือหมดอายุ ควรเติมสต็อกรายการสำคัญและจัดป้ายลดราคาสินค้าใกล้หมดอายุ'
          : 'พบสินค้าหมดสต็อกหรือหมดอายุหลายรายการ ควรเร่งสั่งเติมสินค้าและเคลียร์สินค้าหมดอายุออกจากชั้นวางทันที';

    let overdueDebtAmount = 0;
    let overdueCustomerCount = 0;
    for (const c of customers) {
      const debt = Number(c.total_debt ?? 0);
      if (debt > 0 && todayIso) {
        const dueDate = customerDueDates[c.id];
        if (dueDate && dueDate < todayIso) {
          overdueDebtAmount += debt;
          overdueCustomerCount += 1;
        }
      }
    }
    overdueDebtAmount = Math.round(overdueDebtAmount * 100) / 100;
    const overdueDebtRatioPct =
      totalOutstandingDebt > 0 ? (overdueDebtAmount / totalOutstandingDebt) * 100 : 0;

    let creditScore = 20;
    if (totalOutstandingDebt > 0 || creditSales > 0) {
      if (overdueDebtRatioPct > 40) creditScore -= 8;
      else if (overdueDebtRatioPct > 20) creditScore -= 5;
      else if (overdueDebtRatioPct > 0) creditScore -= 2;

      if (creditExposurePct > 30) creditScore -= 6;
      else if (creditExposurePct > 15) creditScore -= 3;

      if (
        creditCollectionRatePct !== null &&
        creditCollectionRatePct < 50 &&
        totalOutstandingDebt > 0
      ) {
        creditScore -= 4;
      }
      if (creditLiquidityStatus === 'ควรเร่งติดตามหนี้ค้าง') {
        creditScore = Math.min(creditScore, 10);
      }
    }
    creditScore = Math.min(20, Math.max(0, creditScore));
    const creditStatus = toHealthStatus(creditScore);
    const creditAdvice =
      creditStatus === 'ดีเยี่ยม'
        ? 'สภาพคล่องเงินสดและวินัยสินเชื่อดีมาก อัตราเก็บหนี้คืนสมดุล'
        : creditStatus === 'ปกติ'
          ? 'มีการปล่อยเชื่อหรือหนี้ค้างบางส่วน ควรติดตามลูกหนี้ตามวันนัดชำระสม่ำเสมอ'
          : 'สัดส่วนขายเชื่อสูงหรือมีหนี้เกินกำหนดมาก ควรเร่งติดตามรับชำระหนี้และจำกัดวงเงินเชื่อชั่วคราว';

    const voidRatePct = sales.length > 0 ? (cancelledSalesCount / sales.length) * 100 : 0;
    let lossScore = 20;
    if (shrinkagePctOfSales >= 3) lossScore -= 10;
    else if (shrinkagePctOfSales >= 1.5) lossScore -= 6;
    else if (shrinkagePctOfSales >= 0.5) lossScore -= 3;
    else if (shrinkageCostTotal > 0) lossScore -= 1;

    if (voidRatePct >= 10) lossScore -= 10;
    else if (voidRatePct >= 5) lossScore -= 6;
    else if (voidRatePct >= 2) lossScore -= 3;
    else if (cancelledSalesCount > 0) lossScore -= 1;

    lossScore = Math.min(20, Math.max(0, lossScore));
    const lossStatus = toHealthStatus(lossScore);
    const lossAdvice =
      lossStatus === 'ดีเยี่ยม'
        ? 'ควบคุมการสูญเสียสต็อกและการยกเลิกบิลได้ดีเยี่ยม'
        : lossStatus === 'ปกติ'
          ? 'มีการปรับลดสต็อกหรือยกเลิกบิลเล็กน้อย ควรตรวจนับสต็อกเฉพาะจุดสม่ำเสมอ'
          : 'พบอัตราสูญเสียสต็อกหรือการยกเลิกบิลสูงผิดปกติ ควรตรวจสอบสาเหตุการปรับลดสต็อกและสิทธิ์การยกเลิกบิล';

    const scorecardPillars = [
      {
        id: 'sales_goal',
        title: '1. ยอดขายตามเป้าหมาย (Sales Goal)',
        score: salesGoalScore,
        maxScore: 20,
        status: salesGoalStatus,
        summary:
          periodGoal > 0
            ? `ทำได้ ${goalRatioPct.toFixed(1)}% (${formatBaht(totalSales)} / ${formatBaht(periodGoal)})`
            : `ยอดขายรวม ${formatBaht(totalSales)}`,
        advice: salesGoalAdvice,
      },
      {
        id: 'profitability',
        title: '2. กำไรสุทธิและจุดคุ้มทุน (Profit & Break-Even)',
        score: profitScore,
        maxScore: 20,
        status: profitStatus,
        summary: `Net Margin ${netMarginPct.toFixed(1)}% · ${
          cannotCalcBreakEven
            ? 'ยังไม่คุ้มทุน'
            : isAboveBreakEven
              ? 'เกินจุดคุ้มทุน'
              : 'ต่ำกว่าจุดคุ้มทุน'
        }`,
        advice: profitAdvice,
      },
      {
        id: 'inventory',
        title: '3. ความพร้อมของสต็อก (Inventory Readiness)',
        score: inventoryScore,
        maxScore: 20,
        status: inventoryStatus,
        summary: `พร้อมขาย ${inventoryReadinessPct.toFixed(1)}% (หมด ${formatNumber(criticalOutOfStockCount)} · หมดอายุ ${formatNumber(expiredStockCount)})`,
        advice: inventoryAdvice,
      },
      {
        id: 'credit',
        title: '4. สภาพคล่องและวินัยสินเชื่อ (Credit Liquidity)',
        score: creditScore,
        maxScore: 20,
        status: creditStatus,
        summary: `ค้างชำระ ${formatBaht(totalOutstandingDebt)} · เกินกำหนด ${overdueDebtRatioPct.toFixed(1)}% (${formatNumber(overdueCustomerCount)} ราย)`,
        advice: creditAdvice,
      },
      {
        id: 'loss',
        title: '5. ควบคุมการสูญเสียและยกเลิกบิล (Loss Control)',
        score: lossScore,
        maxScore: 20,
        status: lossStatus,
        summary: `สูญเสีย ${shrinkagePctOfSales.toFixed(2)}% ของยอดขาย · ยกเลิกบิล ${voidRatePct.toFixed(1)}%`,
        advice: lossAdvice,
      },
    ];

    const scorecardTotalScore = scorecardPillars.reduce((acc, p) => acc + p.score, 0);
    const scorecardGrade: 'A+' | 'A' | 'B' | 'C' =
      scorecardTotalScore >= 90
        ? 'A+'
        : scorecardTotalScore >= 80
          ? 'A'
          : scorecardTotalScore >= 65
            ? 'B'
            : 'C';
    const scorecardOverallStatus: HealthStatus =
      scorecardTotalScore >= 80 ? 'ดีเยี่ยม' : scorecardTotalScore >= 60 ? 'ปกติ' : 'ต้องดูแล';

    const urgentAdvices = scorecardPillars
      .filter((p) => p.status === 'ต้องดูแล')
      .map((p) => `${p.title}: ${p.advice}`);
    const watchAdvices = scorecardPillars
      .filter((p) => p.status === 'ปกติ')
      .map((p) => `${p.title}: ${p.advice}`);
    const scorecardRecommendations =
      urgentAdvices.length > 0 || watchAdvices.length > 0
        ? [...urgentAdvices, ...watchAdvices].slice(0, 3)
        : [
            'สุขภาพร้านค้าอยู่ในเกณฑ์ดีเยี่ยมทั้ง 5 มิติ รักษามาตรฐานสต็อก วินัยสินเชื่อ และการควบคุมต้นทุนต่อเนื่อง',
          ];

    const storeHealthScorecard = {
      totalScore: scorecardTotalScore,
      maxTotalScore: 100,
      grade: scorecardGrade,
      overallStatus: scorecardOverallStatus,
      pillars: scorecardPillars,
      recommendations: scorecardRecommendations,
    };

    return {
      totalSales,
      totalCost,
      grossProfit,
      grossMarginPct,
      avgTicket,
      avgGrossProfitPerBill,
      avgNetProfitPerBill,
      customItemRevenue,
      customItemCost,
      customItemProfit,
      customItemQty,
      customItemLineCount,
      customItemBillCount,
      customItemSharePct,
      topCustomItems,
      totalItemsSold,
      avgItemsPerBill,
      totalDiscountGiven,
      discountedBillsCount,
      grossSalesBeforeDiscount,
      discountRatePct,
      discountedBillsPct,
      avgDiscountPerBill,
      vipDiscountTotal,
      vipDiscountCount,
      pointsDiscountTotal,
      pointsDiscountCount,
      manualDiscountTotal,
      manualDiscountCount,
      cashSales,
      qrSales,
      creditSales,
      cashCount,
      qrCount,
      creditCount,
      cashPct,
      qrPct,
      creditPct,
      otherIncome,
      otherExpense,
      debtCollectedCash,
      debtCollectedQr,
      debtCollectedTotal,
      debtWaivedTotal,
      debtWaivedCount,
      debtPaymentCount,
      debtPaymentCashCount,
      debtPaymentQrCount,
      debtCollectedCashPct,
      debtCollectedQrPct,
      creditCollectionNet,
      creditCollectionRatePct,
      creditExposurePct,
      debtRecoveryVsOutstandingPct,
      creditLiquidityStatus,
      totalOutstandingDebt,
      debtorCustomersCount,
      netCashFlow,
      netProfit,
      netMarginPct,
      breakEvenSales,
      breakEvenDiff,
      breakEvenMultiple,
      topProducts,
      topProductsByRevenue,
      topProductsByProfit,
      allProductStats,
      zeroMovingProducts,
      topZeroMovingProducts,
      totalZeroMovingCost,
      totalZeroMovingUnits,
      topZeroMovingCost,
      categoryStats,
      totalCategoryRevenue,
      totalCategoryCost,
      totalCategoryProfit,
      totalCategoryItems,
      categoryGrossMarginPct,
      supplierStats,
      assignedSupplierCount,
      totalSupplierRevenue,
      totalSupplierCost,
      totalSupplierProfit,
      totalSupplierQty,
      totalSupplierItems,
      supplierGrossMarginPct,
      expenseCategorySummary,
      expenseBreakdown,
      expenseTotalCount,
      expenseToSalesPct,
      topExpenseCategory,
      trendBuckets,
      maxTrendAmount,
      dayOfWeekStats,
      maxDowAmount,
      bestDayOfWeek,
      bestSalesDay,
      bestProfitDay,
      activeTradingDaysCount,
      avgSalesPerActiveDay,
      timeOfDayStats,
      bestTimeOfDay,
      activeHourlyStats,
      maxHourlyAmount,
      peakHourByRevenue,
      peakHourByBills,
      topCustomers,
      uniqueCustomerCount: allTopCustomers.length,
      regularCustomerSalesTotal,
      regularCustomerCashQrTotal,
      regularCustomerCreditTotal,
      regularCustomerBillCount,
      regularCustomerSharePct,
      memberVsWalkIn,
      retailVsPackMix,
      ticketSizeDistribution,
      completedBillsCount,
      completedBillsRevenue,
      topTicketTierByCount,
      topTicketTierByRevenue,
      topBasketPairs,
      totalBasketBills,
      multiItemBillsCount,
      multiItemBillsPct,
      totalUniqueBasketPairs,
      shrinkageCount,
      shrinkageUnitsTotal,
      shrinkageCostTotal,
      adjustmentAddCount,
      adjustmentAddUnitsTotal,
      adjustmentAddCostTotal,
      netAdjustmentCost,
      totalAdjustmentCount,
      shrinkagePctOfSales,
      recentShrinkageItems: shrinkageItems,
      cancelledSalesCount,
      cancelledSalesAmount,
      partialReturnBillsCount,
      partialReturnRefundTotal,
      voidReturnTotalImpact,
      voidReturnAuditItems,
      totalInventoryCapitalCost,
      totalInventoryCapitalUnits,
      totalInventoryCapitalCount,
      activeMovingCost,
      activeMovingUnits,
      activeMovingCount,
      activeMovingSharePct,
      nonMovingSharePct,
      expiredStockCost,
      expiredStockUnits,
      expiredStockCount,
      expiringSoonStockCost,
      expiringSoonStockUnits,
      expiringSoonStockCount,
      atRiskExpiryCost,
      atRiskExpiryUnits,
      atRiskExpiryCount,
      atRiskExpirySharePct,
      criticalRestockCount,
      criticalOutOfStockCount,
      criticalRestockUnits,
      criticalRestockBudget,
      belowTargetRestockCount,
      fullTargetRestockUnits,
      fullTargetRestockBudget,
      targetConfiguredCount,
      restockSupplierBreakdown,
      promoProductsStats,
      customerSegmentStats,
      storeHealthScorecard,
    };
  }, [sales, saleItems, expenses, debtPayments, stockAdjustments, products, categories, customers, suppliers, targetStocks, period, customStart, customEnd, dailySlots, expiryDates, customerDueDates, todayIso, topProductsCategoryFilter, promoLabels, customerTags, dailyGoal, periodDays]);

  const heldBillsSummary = useMemo(() => {
    let totalValue = 0;
    let preOrderCount = 0;
    let preOrderValue = 0;
    let deliveryCount = 0;
    let pickupCount = 0;
    for (const bill of heldBills) {
      const val = Number.isFinite(Number(bill.total)) ? Number(bill.total) : 0;
      totalValue += val;
      if (bill.orderType === 'delivery') {
        deliveryCount += 1;
        preOrderCount += 1;
        preOrderValue += val;
      } else if (bill.orderType === 'pickup') {
        pickupCount += 1;
        preOrderCount += 1;
        preOrderValue += val;
      }
    }
    return {
      totalCount: heldBills.length,
      totalValue,
      preOrderCount,
      preOrderValue,
      deliveryCount,
      pickupCount,
    };
  }, [heldBills]);

  const customerBenefitsSummary = useMemo(() => {
    let storeCreditTotal = 0;
    let storeCreditCustomerCount = 0;
    for (const amount of Object.values(customerStoreCredits)) {
      if (Number.isFinite(amount) && amount > 0) {
        storeCreditTotal += amount;
        storeCreditCustomerCount += 1;
      }
    }
    storeCreditTotal = Math.round(storeCreditTotal * 100) / 100;

    let loyaltyPointsTotal = 0;
    let loyaltyCustomerCount = 0;
    for (const pts of Object.values(customerLoyaltyPoints)) {
      if (Number.isFinite(pts) && pts > 0) {
        loyaltyPointsTotal += Math.floor(pts);
        loyaltyCustomerCount += 1;
      }
    }
    const loyaltyDiscountValue = Math.round((loyaltyPointsTotal / 10) * 100) / 100;

    let containerDepositTotal = 0;
    let containerDepositQtyTotal = 0;
    for (const item of containerDeposits) {
      if (Number.isFinite(item.depositAmount) && item.depositAmount > 0) {
        containerDepositTotal += item.depositAmount;
      }
      if (Number.isFinite(item.qty) && item.qty > 0) {
        containerDepositQtyTotal += item.qty;
      }
    }
    containerDepositTotal = Math.round(containerDepositTotal * 100) / 100;
    containerDepositQtyTotal = Math.round(containerDepositQtyTotal * 100) / 100;

    return {
      storeCreditTotal,
      storeCreditCustomerCount,
      loyaltyPointsTotal,
      loyaltyCustomerCount,
      loyaltyDiscountValue,
      containerDepositTotal,
      containerDepositCount: containerDeposits.length,
      containerDepositQtyTotal,
      totalLiabilityValue:
        Math.round((storeCreditTotal + loyaltyDiscountValue + containerDepositTotal) * 100) / 100,
    };
  }, [customerStoreCredits, customerLoyaltyPoints, containerDeposits]);

  const costIncreaseSummary = useMemo(() => {
    const increasedItems: {
      product: Product;
      prevCost: number;
      newCost: number;
      diff: number;
    }[] = [];
    for (const p of products) {
      if (!p.is_active) continue;
      const entry = lastCostHistory[p.id];
      if (!entry) continue;
      const prevCost = Number(entry.prevCost);
      const newCost = Number(p.cost_price);
      if (Number.isFinite(prevCost) && Number.isFinite(newCost) && newCost > prevCost + 0.0001) {
        increasedItems.push({
          product: p,
          prevCost,
          newCost,
          diff: newCost - prevCost,
        });
      }
    }
    increasedItems.sort(
      (a, b) => b.diff - a.diff || a.product.name.localeCompare(b.product.name, 'th')
    );
    return {
      count: increasedItems.length,
      topItems: increasedItems.slice(0, 3),
    };
  }, [products, lastCostHistory]);

  const urgentAlerts = useMemo(() => {
    const activeProducts = products.filter((p) => p.is_active);
    const stockItems = activeProducts
      .filter(
        (p) =>
          !p.allow_custom_price &&
          Number(p.stock_qty) <= Number(p.low_stock_alert)
      )
      .map((p) => ({
        product: p,
        stockQty: Number(p.stock_qty),
        lowAlert: Number(p.low_stock_alert),
        isOutOfStock: Number(p.stock_qty) <= 0,
      }))
      .sort(
        (a, b) =>
          Number(b.isOutOfStock) - Number(a.isOutOfStock) ||
          a.stockQty - b.stockQty ||
          a.product.name.localeCompare(b.product.name, 'th')
      );

    const expiryItems: { product: Product; expiryInfo: ExpiryInfo }[] = [];
    if (todayIso) {
      for (const p of activeProducts) {
        const info = getProductExpiryInfo(expiryDates[p.id], todayIso);
        if (info && (info.status === 'expired' || info.status === 'expiring_soon')) {
          expiryItems.push({ product: p, expiryInfo: info });
        }
      }
      expiryItems.sort(
        (a, b) =>
          a.expiryInfo.daysRemaining - b.expiryInfo.daysRemaining ||
          a.product.name.localeCompare(b.product.name, 'th')
      );
    }

    const outOfStockCount = stockItems.filter((item) => item.isOutOfStock).length;
    const lowStockOnlyCount = stockItems.length - outOfStockCount;
    const expiredCount = expiryItems.filter(
      (item) => item.expiryInfo.status === 'expired'
    ).length;
    const expiringSoonCount = expiryItems.length - expiredCount;
    const totalUrgentCount = stockItems.length + expiryItems.length;

    return {
      stockItems,
      expiryItems,
      outOfStockCount,
      lowStockOnlyCount,
      expiredCount,
      expiringSoonCount,
      totalUrgentCount,
    };
  }, [products, expiryDates, todayIso]);

  const sortedCategoryStats = useMemo(() => {
    const list = [...stats.categoryStats];
    if (categorySortBy === 'profit') {
      list.sort((a, b) => b.profit - a.profit || b.revenue - a.revenue);
    } else if (categorySortBy === 'marginPct') {
      list.sort((a, b) => b.marginPct - a.marginPct || b.profit - a.profit);
    } else {
      list.sort((a, b) => b.revenue - a.revenue);
    }
    return list;
  }, [stats.categoryStats, categorySortBy]);

  const sortedSupplierStats = useMemo(() => {
    const list = [...stats.supplierStats];
    if (supplierSortBy === 'profit') {
      list.sort((a, b) => b.profit - a.profit || b.revenue - a.revenue);
    } else if (supplierSortBy === 'marginPct') {
      list.sort((a, b) => b.marginPct - a.marginPct || b.profit - a.profit);
    } else if (supplierSortBy === 'qty') {
      list.sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
    } else {
      list.sort((a, b) => b.revenue - a.revenue || b.profit - a.profit);
    }
    return list;
  }, [stats.supplierStats, supplierSortBy]);

  const dailyBreakdown = useMemo(() => {
    if (period !== '7days' && period !== 'month' && period !== 'custom') {
      return [];
    }
    const dayMap = new Map<
      string,
      {
        dateKey: string;
        label: string;
        subLabel: string;
        billCount: number;
        totalSales: number;
        totalCost: number;
        grossProfit: number;
        marginPct: number;
      }
    >();

    for (const slot of dailySlots) {
      dayMap.set(slot.dateKey, {
        dateKey: slot.dateKey,
        label: slot.label,
        subLabel: slot.subLabel,
        billCount: 0,
        totalSales: 0,
        totalCost: 0,
        grossProfit: 0,
        marginPct: 0,
      });
    }

    for (const s of sales) {
      const dt = new Date(s.created_at);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      const dateKey = `${y}-${m}-${day}`;
      const existing = dayMap.get(dateKey);
      if (existing) {
        existing.billCount += 1;
        existing.totalSales += Number(s.total_amount);
        existing.totalCost += Number(s.total_cost);
      } else {
        dayMap.set(dateKey, {
          dateKey,
          label: new Intl.DateTimeFormat('th-TH', {
            day: 'numeric',
            month: 'short',
            year: '2-digit',
          }).format(dt),
          subLabel: new Intl.DateTimeFormat('th-TH', {
            weekday: 'short',
          }).format(dt),
          billCount: 1,
          totalSales: Number(s.total_amount),
          totalCost: Number(s.total_cost),
          grossProfit: 0,
          marginPct: 0,
        });
      }
    }

    return [...dayMap.values()]
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
      .map((row) => {
        const grossProfit = row.totalSales - row.totalCost;
        const marginPct = row.totalSales > 0 ? (grossProfit / row.totalSales) * 100 : 0;
        return { ...row, grossProfit, marginPct };
      });
  }, [sales, dailySlots, period]);

  const filteredSales = useMemo(() => {
    const q = billSearch.trim().toLowerCase();
    return sales.filter((s) => {
      const saleAny = s as Sale & { status?: string; is_cancelled?: boolean };
      const isCancelled =
        saleAny.status === 'cancelled' ||
        saleAny.status === 'void' ||
        saleAny.is_cancelled === true ||
        (s.note ?? '').includes('ยกเลิก');

      if (billPaymentFilter === 'cancelled') {
        if (!isCancelled) return false;
      } else if (billPaymentFilter !== 'all') {
        if (isCancelled || s.payment_method !== billPaymentFilter) return false;
      }
      if (!q) return true;
      const customerName = (s.customers?.name ?? '').toLowerCase();
      const note = (s.note ?? '').toLowerCase();
      const itemsMatch = (s.sale_items ?? []).some((it) =>
        it.product_name.toLowerCase().includes(q)
      );
      const idMatch = s.id.toLowerCase().includes(q);
      return customerName.includes(q) || note.includes(q) || itemsMatch || idMatch;
    });
  }, [sales, billPaymentFilter, billSearch]);

  const periodDisplayLabel =
    period === 'custom' && customStart && customEnd
      ? `${customStart} ถึง ${customEnd}`
      : PERIOD_LABEL[period];

  const handleCopySummary = async () => {
    const periodLabel = periodDisplayLabel;
    const dateStr = new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'long',
    }).format(new Date());

    const lines = [
      `📊 สรุปยอดขาย${periodLabel} (${settings?.store_name || 'ร้านขายของชำ'})`,
      `📅 ข้อมูล ณ วันที่ ${dateStr}`,
      `-------------------------`,
      `🧾 จำนวนบิลขาย: ${sales.length} บิล`,
      `💰 ยอดขายรวม: ${formatBaht(stats.totalSales)}`,
      `📦 ต้นทุนสินค้า: ${formatBaht(stats.totalCost)}`,
      `✨ กำไรขั้นต้น: ${formatBaht(stats.grossProfit)}`,
      `-------------------------`,
      `💵 เงินสด: ${formatBaht(stats.cashSales)}`,
      `📲 PromptPay QR: ${formatBaht(stats.qrSales)}`,
      `📝 เงินเชื่อ (ค้างชำระ): ${formatBaht(stats.creditSales)}`,
      `💳 รับชำระหนี้เงินเชื่อ (${stats.debtPaymentCount} ครั้ง): ${formatBaht(stats.debtCollectedTotal)} (สด ${formatBaht(stats.debtCollectedCash)} · โอน ${formatBaht(stats.debtCollectedQr)})`,
      `-------------------------`,
      `➕ รายรับอื่นๆ: ${formatBaht(stats.otherIncome)}`,
      `➖ รายจ่ายร้าน: ${formatBaht(stats.otherExpense)}`,
      `💎 กำไรสุทธิหลังหักรายจ่าย: ${formatBaht(stats.netProfit)}`,
      `🏦 กระแสเงินสดสุทธิ: ${formatBaht(stats.netCashFlow)}`,
    ];

    if (stats.topProducts.length > 0) {
      lines.push(`-------------------------`);
      lines.push(`🏆 สินค้าขายดี:`);
      stats.topProducts.forEach((p, idx) => {
        lines.push(`${idx + 1}. ${p.name} (${formatNumber(p.qty)} หน่วย) = ${formatBaht(p.revenue)}`);
      });
    }

    if (stats.shrinkageCount > 0 || stats.adjustmentAddCount > 0) {
      lines.push(`-------------------------`);
      lines.push(
        `📉 ปรับลดสต็อก/ความสูญเสีย (${formatNumber(stats.shrinkageCount)} ครั้ง / ${formatNumber(stats.shrinkageUnitsTotal)} หน่วย): -${formatBaht(stats.shrinkageCostTotal)}`
      );
      if (stats.adjustmentAddCount > 0) {
        lines.push(
          `📈 ปรับเพิ่มสต็อก (${formatNumber(stats.adjustmentAddCount)} ครั้ง / ${formatNumber(stats.adjustmentAddUnitsTotal)} หน่วย): +${formatBaht(stats.adjustmentAddCostTotal)}`
        );
      }
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const handleExportCSV = () => {
    const escapeCsv = (val: string | number | null | undefined) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
      'เลขที่บิล',
      'วันที่-เวลา',
      'ช่องทางชำระเงิน',
      'ยอดก่อนลด',
      'ส่วนลด',
      'ยอดสุทธิ',
      'สถานะ',
    ];

    const rows = sales.map((s) => {
      const badge = PAYMENT_BADGE[s.payment_method] ?? PAYMENT_BADGE.cash;
      const saleAny = s as Sale & {
        status?: string;
        is_cancelled?: boolean;
      };
      const { netAmount, discountAmt, beforeDiscount } = getSaleDiscountInfo(s);
      const isCancelled =
        saleAny.status === 'cancelled' ||
        saleAny.status === 'void' ||
        saleAny.is_cancelled === true ||
        (s.note ?? '').includes('ยกเลิก');
      const statusLabel = isCancelled ? 'ยกเลิก' : 'สำเร็จ';

      return [
        escapeCsv(s.id.slice(0, 8)),
        escapeCsv(formatDateTime(s.created_at)),
        escapeCsv(badge.label),
        escapeCsv(beforeDiscount.toFixed(2)),
        escapeCsv(discountAmt.toFixed(2)),
        escapeCsv(netAmount.toFixed(2)),
        escapeCsv(statusLabel),
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `sales-report-${period}-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(expAmount);
    if (!amt || amt <= 0) return;

    await supabase.from('expenses').insert({
      type: expType,
      category: expCategory.trim() || 'ทั่วไป',
      amount: amt,
      note: expNote.trim(),
    });

    setExpAmount('');
    setExpNote('');
    setExpOpen(false);
    loadData();
  };

  const handleDeleteExpense = async (exp: Expense) => {
    const typeLabel = exp.type === 'income' ? 'รายรับ' : 'รายจ่าย';
    const ok = window.confirm(
      `ยืนยันการลบรายการ${typeLabel} "${exp.category}" จำนวน ${formatBaht(exp.amount)} หรือไม่?`
    );
    if (!ok) return;

    await supabase.from('expenses').delete().eq('id', exp.id);
    loadData();
  };

  const handleExportExpensesCSV = () => {
    const escapeCsv = (val: string | number | null | undefined) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = ['วันเวลา', 'ประเภท', 'หมวดหมู่', 'จำนวนเงิน (บาท)', 'หมายเหตุ'];

    const rows = expenses.map((e) => {
      const typeLabel = e.type === 'income' ? 'รายรับอื่นๆ' : 'รายจ่ายร้าน';
      return [
        escapeCsv(formatDateTime(e.created_at)),
        escapeCsv(typeLabel),
        escapeCsv(e.category),
        escapeCsv(Number(e.amount).toFixed(2)),
        escapeCsv(e.note || ''),
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `expenses-report-${period}-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportTopProductsCSV = () => {
    if (stats.allProductStats.length === 0) return;

    const escapeCsv = (val: string | number | null | undefined) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const sorted = [...stats.allProductStats].sort((a, b) =>
      topSortBy === 'revenue' ? b.revenue - a.revenue : b.profit - a.profit
    );

    const headers = [
      'อันดับ',
      'ชื่อสินค้า',
      'จำนวนที่ขาย (หน่วย)',
      'ยอดขาย (บาท)',
      'ต้นทุน (บาท)',
      'กำไร (บาท)',
      'อัตรากำไร (%)',
    ];

    const rows = sorted.map((item, idx) => {
      const marginPct = item.revenue > 0 ? (item.profit / item.revenue) * 100 : 0;
      return [
        escapeCsv(idx + 1),
        escapeCsv(item.name),
        escapeCsv(item.qty),
        escapeCsv(item.revenue.toFixed(2)),
        escapeCsv(item.cost.toFixed(2)),
        escapeCsv(item.profit.toFixed(2)),
        escapeCsv(marginPct.toFixed(1)),
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `top-products-${topSortBy}-${period}-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportDailyCSV = () => {
    if (dailyBreakdown.length === 0) return;

    const escapeCsv = (val: string | number | null | undefined) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = ['วันที่', 'จำนวนบิล', 'ยอดขาย', 'ต้นทุน', 'กำไรขั้นต้น', '% มาร์จิ้น'];

    const rows = dailyBreakdown.map((row) => [
      escapeCsv(`${row.label} (${row.subLabel})`),
      escapeCsv(row.billCount),
      escapeCsv(row.totalSales.toFixed(2)),
      escapeCsv(row.totalCost.toFixed(2)),
      escapeCsv(row.grossProfit.toFixed(2)),
      escapeCsv(`${row.marginPct.toFixed(1)}%`),
    ].join(','));

    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `daily-sales-${period}-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportCategoryCSV = () => {
    if (stats.categoryStats.length === 0) return;

    const escapeCsv = (val: string | number | null | undefined) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
      'หมวดหมู่',
      'จำนวนรายการ',
      'ยอดขาย (บาท)',
      'สัดส่วนยอดขาย (%)',
      'ต้นทุน (บาท)',
      'กำไร (บาท)',
      '% มาร์จิ้น',
    ];

    const rows = stats.categoryStats.map((cat) =>
      [
        escapeCsv(cat.name),
        escapeCsv(cat.itemCount),
        escapeCsv(cat.revenue.toFixed(2)),
        escapeCsv(`${cat.pct.toFixed(1)}%`),
        escapeCsv(cat.cost.toFixed(2)),
        escapeCsv(cat.profit.toFixed(2)),
        escapeCsv(`${cat.marginPct.toFixed(1)}%`),
      ].join(',')
    );

    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `category-sales-${period}-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportSupplierCSV = () => {
    if (sortedSupplierStats.length === 0) return;

    const escapeCsv = (val: string | number | null | undefined) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
      'ร้านค้าส่ง / ซัพพลายเออร์',
      'จำนวนชนิดสินค้า',
      'จำนวนชิ้นที่ขายได้',
      'ยอดขาย (บาท)',
      'สัดส่วนยอดขาย (%)',
      'ต้นทุน (บาท)',
      'กำไรขั้นต้น (บาท)',
      '% Margin',
    ];

    const rows = sortedSupplierStats.map((sup) =>
      [
        escapeCsv(sup.name),
        escapeCsv(sup.productCount),
        escapeCsv(sup.qty),
        escapeCsv(sup.revenue.toFixed(2)),
        escapeCsv(`${sup.pct.toFixed(1)}%`),
        escapeCsv(sup.cost.toFixed(2)),
        escapeCsv(sup.profit.toFixed(2)),
        escapeCsv(`${sup.marginPct.toFixed(1)}%`),
      ].join(',')
    );

    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `supplier-sales-${period}-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleStartEditGoal = () => {
    setGoalInput(String(dailyGoal));
    setEditingGoal(true);
  };

  const handleSaveGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(goalInput);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setDailyGoal(parsed);
    try {
      window.localStorage.setItem(DAILY_GOAL_STORAGE_KEY, String(parsed));
    } catch {
      // ignore localStorage errors
    }
    setMasterSnapshot(readMasterBackupFromStorage());
    setEditingGoal(false);
  };

  const buildMasterBackupPayload = () => {
    const snapshot = readMasterBackupFromStorage();
    return {
      version: 1,
      app: 'grocery-pos',
      ...snapshot.data,
      ...snapshot.extraKeys,
    };
  };

  const openMasterBackupModal = () => {
    setMasterSnapshot(readMasterBackupFromStorage());
    setMasterBackupJsonInput('');
    setMasterBackupFileName('');
    setMasterRestoreMode('replace');
    setMasterBackupError('');
    setMasterBackupSuccess('');
    setMasterJsonCopied(false);
    setMasterBackupOpen(true);
  };

  const handleDownloadMasterBackupJson = () => {
    setMasterBackupError('');
    const payload = buildMasterBackupPayload();
    const jsonText = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `grocery-pos-master-backup-${dateStamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setMasterBackupSuccess(`ดาวน์โหลดไฟล์สำรองข้อมูลทั้งร้าน (${link.download}) เรียบร้อยแล้ว`);
  };

  const handleCopyMasterBackupJson = async () => {
    setMasterBackupError('');
    const jsonText = JSON.stringify(buildMasterBackupPayload(), null, 2);
    try {
      await navigator.clipboard.writeText(jsonText);
      setMasterJsonCopied(true);
      setTimeout(() => setMasterJsonCopied(false), 2000);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = jsonText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setMasterJsonCopied(true);
        setTimeout(() => setMasterJsonCopied(false), 2000);
      } catch {
        setMasterBackupError('ไม่สามารถคัดลอก JSON ได้ กรุณาใช้ปุ่มดาวน์โหลดไฟล์ .json แทน');
      }
    }
  };

  const handleMasterBackupFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setMasterBackupError('');
    setMasterBackupSuccess('');
    setMasterBackupFileName(file.name);
    try {
      const rawText = await file.text();
      setMasterBackupJsonInput(rawText);
    } catch {
      setMasterBackupError('ไม่สามารถอ่านไฟล์ที่เลือกได้ กรุณาลองใหม่อีกครั้ง');
    }
  };

  const masterBackupPreview = useMemo(() => {
    if (!masterBackupJsonInput.trim()) return null;
    return parseMasterBackupJson(masterBackupJsonInput);
  }, [masterBackupJsonInput]);

  const masterAuditSummary = useMemo(() => {
    if (!masterSnapshot) return null;
    const populatedSet = new Set(masterSnapshot.populatedKeys);
    const categories = [
      {
        id: 'inventory',
        title: 'ข้อมูลเสริมคลังสินค้า',
        keys: MASTER_KNOWN_KEYS.filter((k) => k.startsWith('inventory_')),
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
      },
      {
        id: 'customer',
        title: 'ข้อมูลเสริมลูกหนี้/เครดิต',
        keys: MASTER_KNOWN_KEYS.filter((k) => k.startsWith('customer_')),
        badgeClass: 'bg-purple-50 text-purple-800 border-purple-200',
      },
      {
        id: 'pos',
        title: 'ข้อมูลตั้งค่า POS',
        keys: MASTER_KNOWN_KEYS.filter((k) => k.startsWith('pos_')),
        badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
      },
      {
        id: 'shift',
        title: 'ข้อมูลตั้งค่ากะการทำงาน',
        keys: MASTER_KNOWN_KEYS.filter((k) => k.startsWith('shift_')),
        badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      },
    ].map((cat) => {
      const populatedCount = cat.keys.filter((k) => populatedSet.has(k)).length;
      return {
        ...cat,
        totalCount: cat.keys.length,
        populatedCount,
      };
    });
    const totalPopulated = categories.reduce((sum, c) => sum + c.populatedCount, 0);
    const totalKeys = categories.reduce((sum, c) => sum + c.totalCount, 0);
    const extraCount = Object.keys(masterSnapshot.extraKeys).length;
    return { categories, totalPopulated, totalKeys, extraCount };
  }, [masterSnapshot]);

  const handleRestoreMasterBackupJson = () => {
    setMasterBackupError('');
    setMasterBackupSuccess('');

    const parsed = parseMasterBackupJson(masterBackupJsonInput);
    if (parsed.error || parsed.keysPresent.length === 0) {
      setMasterBackupError(parsed.error || 'ไม่สามารถอ่านข้อมูล JSON ได้');
      return;
    }

    const writeSafe = (key: string, rawStr: string) => {
      try {
        window.localStorage.setItem(key, rawStr);
      } catch {
        // Ignore storage write quota errors while still updating local state
      }
    };

    const readSafe = (key: string): string | null => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    };

    const mergeArrayById = <T extends { id: string }>(
      key: string,
      incoming: T[],
      parser: (raw: string | null) => T[]
    ) => {
      if (masterRestoreMode === 'replace') {
        writeSafe(key, JSON.stringify(incoming));
        return;
      }
      const map = new Map<string, T>();
      for (const existing of parser(readSafe(key))) map.set(existing.id, existing);
      for (const item of incoming) map.set(item.id, item);
      writeSafe(key, JSON.stringify(Array.from(map.values())));
    };

    const { data, extraKeys } = parsed;

    if (data[DAILY_GOAL_STORAGE_KEY] !== undefined) {
      const nextGoal = data[DAILY_GOAL_STORAGE_KEY];
      writeSafe(DAILY_GOAL_STORAGE_KEY, String(nextGoal));
      setDailyGoal(nextGoal);
    }
    if (data[SHIFT_SALES_TARGET_STORAGE_KEY] !== undefined) {
      writeSafe(
        SHIFT_SALES_TARGET_STORAGE_KEY,
        JSON.stringify(data[SHIFT_SALES_TARGET_STORAGE_KEY])
      );
    }
    if (data[POS_SOUND_ENABLED_STORAGE_KEY] !== undefined) {
      writeSafe(POS_SOUND_ENABLED_STORAGE_KEY, String(data[POS_SOUND_ENABLED_STORAGE_KEY]));
    }
    if (data[POS_GRID_DENSITY_STORAGE_KEY] !== undefined) {
      writeSafe(POS_GRID_DENSITY_STORAGE_KEY, data[POS_GRID_DENSITY_STORAGE_KEY]);
    }
    if (data[POS_RECEIPT_FOOTER_STORAGE_KEY] !== undefined) {
      writeSafe(POS_RECEIPT_FOOTER_STORAGE_KEY, data[POS_RECEIPT_FOOTER_STORAGE_KEY]);
    }
    if (data[POS_SHIFT_HANDOVER_MEMO_STORAGE_KEY] !== undefined) {
      const memoVal = data[POS_SHIFT_HANDOVER_MEMO_STORAGE_KEY];
      if (memoVal === null) {
        if (masterRestoreMode === 'replace') {
          try {
            window.localStorage.removeItem(POS_SHIFT_HANDOVER_MEMO_STORAGE_KEY);
          } catch {
            // ignore storage errors
          }
        }
      } else {
        writeSafe(POS_SHIFT_HANDOVER_MEMO_STORAGE_KEY, JSON.stringify(memoVal));
      }
    }
    for (const flexKey of [
      POS_MISC_PRESETS_STORAGE_KEY,
      INVENTORY_UNIT_BARCODES_STORAGE_KEY,
      CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY,
      CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY,
    ] as const) {
      const incoming = data[flexKey];
      if (incoming === undefined) continue;
      if (
        masterRestoreMode === 'merge' &&
        isPlainRecordObject(incoming)
      ) {
        const existing = parseFlexibleJsonContainer(readSafe(flexKey));
        const nextObj = isPlainRecordObject(existing)
          ? { ...existing, ...incoming }
          : incoming;
        writeSafe(flexKey, JSON.stringify(nextObj));
      } else {
        writeSafe(flexKey, JSON.stringify(incoming));
      }
    }
    if (data[POS_PINNED_STORAGE_KEY] !== undefined) {
      const nextPinned =
        masterRestoreMode === 'merge'
          ? Array.from(
              new Set([
                ...parsePinnedProductIds(readSafe(POS_PINNED_STORAGE_KEY)),
                ...data[POS_PINNED_STORAGE_KEY],
              ])
            )
          : data[POS_PINNED_STORAGE_KEY];
      writeSafe(POS_PINNED_STORAGE_KEY, JSON.stringify(nextPinned));
    }
    if (data[POS_BUNDLES_STORAGE_KEY] !== undefined) {
      mergeArrayById(POS_BUNDLES_STORAGE_KEY, data[POS_BUNDLES_STORAGE_KEY], parseMasterPosBundles);
    }
    if (data[POS_CONTAINER_DEPOSITS_STORAGE_KEY] !== undefined) {
      mergeArrayById(
        POS_CONTAINER_DEPOSITS_STORAGE_KEY,
        data[POS_CONTAINER_DEPOSITS_STORAGE_KEY],
        parseMasterContainerDeposits
      );
      setContainerDeposits(
        parseMasterContainerDeposits(readSafe(POS_CONTAINER_DEPOSITS_STORAGE_KEY))
      );
    }
    if (data[POS_HELD_BILLS_STORAGE_KEY] !== undefined) {
      mergeArrayById(
        POS_HELD_BILLS_STORAGE_KEY,
        data[POS_HELD_BILLS_STORAGE_KEY],
        parseMasterHeldBills
      );
      setHeldBills(parseMasterHeldBills(readSafe(POS_HELD_BILLS_STORAGE_KEY)));
    }

    for (const [key, parser] of Object.entries(MASTER_RECORD_PARSERS)) {
      const incoming = (data as Record<string, Record<string, unknown> | undefined>)[key];
      if (incoming === undefined) continue;
      const next =
        masterRestoreMode === 'merge'
          ? { ...parser(readSafe(key)), ...incoming }
          : incoming;
      writeSafe(key, JSON.stringify(next));
      if (key === SUPPLIERS_STORAGE_KEY) {
        setSuppliers(next as Record<string, string>);
      } else if (key === EXPIRY_DATES_STORAGE_KEY) {
        setExpiryDates(next as Record<string, string>);
      } else if (key === INVENTORY_LAST_COST_HISTORY_STORAGE_KEY) {
        setLastCostHistory(next as Record<string, MasterCostHistoryEntry>);
      } else if (key === CUSTOMER_STORE_CREDIT_STORAGE_KEY) {
        setCustomerStoreCredits(next as Record<string, number>);
      } else if (key === CUSTOMER_LOYALTY_POINTS_STORAGE_KEY) {
        setCustomerLoyaltyPoints(next as Record<string, number>);
      } else if (key === INVENTORY_PROMO_LABELS_STORAGE_KEY) {
        setPromoLabels(next as Record<string, string>);
      } else if (key === CUSTOMER_TAGS_STORAGE_KEY) {
        setCustomerTags(next as Record<string, string>);
      }
    }

    for (const [key, val] of Object.entries(extraKeys)) {
      writeSafe(key, typeof val === 'string' ? val : JSON.stringify(val));
    }

    setMasterSnapshot(readMasterBackupFromStorage());

    const categoryCounts = {
      pos: parsed.keysPresent.filter((k) => k.startsWith('pos_')).length,
      inventory: parsed.keysPresent.filter((k) => k.startsWith('inventory_')).length,
      customer: parsed.keysPresent.filter((k) => k.startsWith('customer_')).length,
      shift: parsed.keysPresent.filter((k) => k.startsWith('shift_')).length,
    };
    const catLabels: string[] = [];
    if (categoryCounts.pos > 0) catLabels.push(`POS ${categoryCounts.pos} คีย์`);
    if (categoryCounts.inventory > 0) catLabels.push(`คลัง ${categoryCounts.inventory} คีย์`);
    if (categoryCounts.customer > 0) catLabels.push(`ลูกค้า ${categoryCounts.customer} คีย์`);
    if (categoryCounts.shift > 0) catLabels.push(`กะ ${categoryCounts.shift} คีย์`);
    const modeLabel =
      masterRestoreMode === 'merge' ? 'ผสานข้อมูลทั้งร้าน' : 'กู้คืนทับข้อมูลทั้งร้าน';
    setMasterBackupSuccess(
      `${modeLabel}สำเร็จทั้งหมด ${formatNumber(parsed.keysPresent.length)} คีย์ (${catLabels.join(' · ')})`
    );
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase.from('store_settings').upsert(
      {
        store_name: storeName.trim() || 'ร้านขายของชำ',
        promptpay_id: promptpayId.trim(),
        phone: storePhone.trim(),
        address: storeAddress.trim(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    setSettingsOpen(false);
    loadData();
  };

  return (
    <>
      <div className="print:hidden">
        <AppShell storeName={settings?.store_name || 'ร้านขายของชำ POS'}>
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="space-y-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 leading-snug">
              สรุปยอดขาย &amp; บัญชีร้าน
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              ดูยอดขาย กำไรขั้นต้น สินค้าใกล้หมด และบันทึกรายรับ-รายจ่ายร้าน
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex flex-wrap rounded-xl bg-slate-200/70 p-1">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setPeriod(opt.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                    period === opt.key ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {period === 'custom' && (
              <div className="inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs">
                <Calendar className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <input
                  type="date"
                  aria-label="วันที่เริ่มต้น"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-800 focus:border-emerald-500 focus:outline-none"
                />
                <span className="text-slate-500 font-semibold">ถึง</span>
                <input
                  type="date"
                  aria-label="วันที่สิ้นสุด"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-800 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            )}
            <button
              type="button"
              onClick={handleCopySummary}
              className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors ${
                copied
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span>{copied ? 'คัดลอกสรุปแล้ว!' : 'คัดลอกสรุปยอดขาย'}</span>
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <Settings className="h-4 w-4" />
              <span>ตั้งค่าร้าน / QR</span>
            </button>
            <button
              type="button"
              onClick={() => setShowMoreDashboardTools((prev) => !prev)}
              aria-expanded={showMoreDashboardTools}
              className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors ${
                showMoreDashboardTools
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>{showMoreDashboardTools ? 'ซ่อนเครื่องมือเสริม' : 'เครื่องมือรายงานเสริม (⋯)'}</span>
            </button>
          </div>
        </div>

        {showMoreDashboardTools && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
            <button
              type="button"
              onClick={handlePrintReport}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Printer className="h-4 w-4" />
              <span>พิมพ์รายงาน (A4)</span>
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={sales.length === 0}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="h-4 w-4" />
              <span>ส่งออก CSV</span>
            </button>
            <button
              type="button"
              onClick={openMasterBackupModal}
              className="flex items-center gap-1.5 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800 hover:bg-sky-100 shadow-xs"
            >
              <Database className="h-4 w-4 text-sky-600 shrink-0" />
              <span>สำรอง/กู้คืนข้อมูลทั้งร้าน (Master JSON)</span>
            </button>
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">กำลังโหลด...</div>
        ) : (
          <>
            {/* Daily Sales Goal Progress Bar */}
            {(() => {
              const periodGoal = dailyGoal * periodDays;
              const goalPct = periodGoal > 0 ? (stats.totalSales / periodGoal) * 100 : 0;
              const barWidth = Math.min(100, Math.max(0, goalPct));
              const rawDiff = stats.totalSales - periodGoal;
              const achieved = stats.totalSales >= periodGoal;
              const remaining = Math.max(0, Math.round(-rawDiff * 100) / 100);
              const excess = Math.max(0, Math.round(rawDiff * 100) / 100);
              return (
                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Target className={`h-5 w-5 ${achieved ? 'text-emerald-600' : 'text-sky-600'}`} />
                      <h2 className="font-bold text-slate-900 text-sm sm:text-base">
                        {period === 'today'
                          ? 'เป้าหมายยอดขายวันนี้'
                          : `เป้าหมายยอดขาย (${periodDisplayLabel} · ${periodDays} วัน)`}
                      </h2>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                          achieved
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-sky-50 text-sky-700 border border-sky-200'
                        }`}
                      >
                        {goalPct.toFixed(1)}%
                      </span>
                    </div>

                    {editingGoal ? (
                      <form onSubmit={handleSaveGoal} className="flex flex-wrap items-center gap-1.5">
                        <label className="text-[11px] font-semibold text-slate-500">
                          เป้า/วัน (฿):
                        </label>
                        <input
                          type="number"
                          min="1"
                          step="any"
                          required
                          value={goalInput}
                          onChange={(e) => setGoalInput(e.target.value)}
                          aria-label="เป้าหมายยอดขายรายวัน (บาท)"
                          className="w-28 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-900 tabular-nums focus:border-emerald-500 focus:outline-none"
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
                          onClick={() => setEditingGoal(false)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50"
                        >
                          <X className="h-3.5 w-3.5" />
                          <span>ยกเลิก</span>
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm text-slate-600 tabular-nums">
                          <span className="font-extrabold text-slate-900">
                            {formatBaht(stats.totalSales)}
                          </span>{' '}
                          / {formatBaht(periodGoal)}
                        </span>
                        <button
                          type="button"
                          onClick={handleStartEditGoal}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100"
                        >
                          <Edit3 className="h-3 w-3" />
                          <span>แก้ไขเป้าหมาย</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        achieved ? 'bg-emerald-500' : 'bg-sky-500'
                      }`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      {achieved ? (
                        <span className="font-bold text-emerald-700">
                          ทะลุเป้าหมายแล้ว! +{formatBahtPrefix(excess)}
                        </span>
                      ) : (
                        <>
                          อีก{' '}
                          <span className="font-bold text-slate-800 tabular-nums">
                            {formatBahtPrefix(remaining)}
                          </span>{' '}
                          จะถึงเป้าหมาย
                        </>
                      )}
                    </span>
                    <span className="tabular-nums text-[11px] text-slate-500">
                      {periodDays > 1
                        ? `เป้าหมายรายวัน: ${formatBaht(dailyGoal)} × ${periodDays} วัน = ${formatBaht(periodGoal)}`
                        : `เป้าหมายปัจจุบัน: ${formatBaht(dailyGoal)} / วัน`}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* 5-Pillar Store Health Scorecard */}
            {(() => {
              const sc = stats.storeHealthScorecard;
              const gradeStyle =
                sc.grade === 'A+' || sc.grade === 'A'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : sc.grade === 'B'
                    ? 'bg-sky-50 text-sky-700 border-sky-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200';
              return (
                <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 border border-amber-200 text-lg">
                        🏆
                      </span>
                      <div>
                        <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
                          🏆 ดัชนีสุขภาพร้านค้าครบวงจร 5 มิติ (5-Pillar Store Health Scorecard)
                        </h2>
                        <p className="text-[11px] text-slate-500">
                          ประเมินสุขภาพร้านค้าจากยอดขาย กำไร/จุดคุ้มทุน สต็อกพร้อมขาย สินเชื่อ และควบคุมการสูญเสีย
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 tabular-nums">
                      <div className="text-right">
                        <p className="text-[11px] font-semibold text-slate-500">คะแนนรวม</p>
                        <p className="text-xl font-extrabold text-slate-900">
                          {sc.totalScore}
                          <span className="text-xs font-semibold text-slate-500">
                            /{sc.maxTotalScore}
                          </span>
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-extrabold ${gradeStyle}`}
                      >
                        <span>เกรด {sc.grade}</span>
                        <span className="text-xs font-bold">· {sc.overallStatus}</span>
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                    {sc.pillars.map((pillar) => {
                      const pct = Math.min(100, Math.max(0, (pillar.score / pillar.maxScore) * 100));
                      const badgeCls =
                        pillar.status === 'ดีเยี่ยม'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : pillar.status === 'ปกติ'
                            ? 'bg-sky-50 text-sky-700 border-sky-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200';
                      const barCls =
                        pillar.status === 'ดีเยี่ยม'
                          ? 'bg-emerald-500'
                          : pillar.status === 'ปกติ'
                            ? 'bg-sky-500'
                            : 'bg-rose-500';
                      return (
                        <div
                          key={pillar.id}
                          className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2 flex flex-col justify-between"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-start justify-between gap-1.5">
                              <p className="text-xs font-bold text-slate-800 leading-snug">
                                {pillar.title}
                              </p>
                              <span
                                className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] font-bold ${badgeCls}`}
                              >
                                {pillar.status}
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between tabular-nums">
                              <span className="text-base font-extrabold text-slate-900">
                                {pillar.score}
                                <span className="text-[11px] font-semibold text-slate-500">
                                  /{pillar.maxScore}
                                </span>
                              </span>
                              <span className="text-[11px] font-semibold text-slate-500">
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${barCls}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-600 leading-snug">
                            {pillar.summary}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3 space-y-1">
                    <p className="text-xs font-bold text-amber-900">
                      คำแนะนำการบริหารร้านอัตโนมัติ
                    </p>
                    <ul className="list-disc list-inside space-y-0.5 text-xs text-amber-900/90">
                      {sc.recommendations.map((rec, idx) => (
                        <li key={idx}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })()}

            {/* KPI Cards */}
            {(() => {
              const prevLabel = PREV_PERIOD_LABEL[period];
              const salesDiffPct =
                prevPeriodTotals !== null
                  ? calcPctChange(stats.totalSales, prevPeriodTotals.totalSales)
                  : null;
              const profitDiffPct =
                prevPeriodTotals !== null
                  ? calcPctChange(stats.grossProfit, prevPeriodTotals.grossProfit)
                  : null;
              const netProfitDiffPct =
                prevPeriodTotals !== null
                  ? calcPctChange(stats.netProfit, prevPeriodTotals.netProfit)
                  : null;
              const billCountDiffPct =
                prevPeriodTotals !== null
                  ? calcPctChange(sales.length, prevPeriodTotals.billCount)
                  : null;

              const renderDiffBadge = (pct: number | null) => {
                if (pct === null) return null;
                const rounded = Math.round(pct * 10) / 10;
                const isUp = rounded > 0;
                const isDown = rounded < 0;
                return (
                  <span
                    title={prevLabel ? `เทียบกับ${prevLabel}` : undefined}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                      isUp
                        ? 'bg-emerald-50 text-emerald-700'
                        : isDown
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {isUp
                      ? `▲ +${rounded.toFixed(1)}%`
                      : isDown
                        ? `▼ ${rounded.toFixed(1)}%`
                        : '0.0%'}
                  </span>
                );
              };

              return (
            <div className="space-y-3">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-500">ยอดขายรวม</span>
                    {renderDiffBadge(salesDiffPct)}
                  </div>
                  <p className="text-2xl font-extrabold text-slate-900 tabular-nums mt-1">
                    {formatBaht(stats.totalSales)}
                  </p>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p className="text-xs text-slate-500 tabular-nums">
                      {sales.length} บิล · เฉลี่ย/บิล{' '}
                      <span className="font-bold text-slate-700">{formatBaht(stats.avgTicket)}</span>
                    </p>
                    {renderDiffBadge(billCountDiffPct)}
                  </div>
                </div>
                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-500">กำไรขั้นต้น</span>
                    <div className="flex items-center gap-1.5">
                      {renderDiffBadge(profitDiffPct)}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                          stats.grossMarginPct >= 0
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {stats.grossMarginPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <p className="text-2xl font-extrabold text-emerald-600 tabular-nums mt-1">
                    {formatBaht(stats.grossProfit)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 tabular-nums">
                    ทุนขาย {formatBaht(stats.totalCost)} · มาร์จิ้น {stats.grossMarginPct.toFixed(1)}%
                  </p>
                  <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-1 text-xs tabular-nums">
                    <span className="text-slate-600 font-medium">กำไรสุทธิหลังหักรายจ่าย</span>
                    <div className="flex items-center gap-1.5">
                      {renderDiffBadge(netProfitDiffPct)}
                      <span
                        className={`font-extrabold ${
                          stats.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                        }`}
                      >
                        {formatBaht(stats.netProfit)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs">
                  <span className="text-xs font-medium text-slate-500">แยกช่องทางรับเงิน</span>
                  <div className="mt-1.5 space-y-0.5 text-xs tabular-nums">
                    <div className="flex justify-between">
                      <span className="text-slate-600">เงินสด:</span>
                      <span className="font-bold text-slate-900">{formatBaht(stats.cashSales)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sky-700">PromptPay:</span>
                      <span className="font-bold text-sky-700">{formatBaht(stats.qrSales)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-amber-700">เงินเชื่อ:</span>
                      <span className="font-bold text-amber-700">{formatBaht(stats.creditSales)}</span>
                    </div>
                    <div className="pt-1 mt-1 border-t border-slate-100 flex justify-between">
                      <span className="text-emerald-700">รับชำระหนี้เงินเชื่อ:</span>
                      <span className="font-bold text-emerald-700">{formatBaht(stats.debtCollectedTotal)}</span>
                    </div>
                    {stats.debtCollectedTotal > 0 && (
                      <div className="text-[11px] text-slate-500 text-right">
                        สด {formatBaht(stats.debtCollectedCash)} · QR {formatBaht(stats.debtCollectedQr)}
                      </div>
                    )}
                    {stats.debtWaivedTotal > 0 && (
                      <div className="text-[11px] text-amber-600 text-right font-medium">
                        ยกเว้น/ลดเศษหนี้ {formatBaht(stats.debtWaivedTotal)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-900 text-white p-4 shadow-xs">
                  <span className="text-xs text-slate-300">กระแสเงินสดสุทธิ</span>
                  <p className="text-2xl font-extrabold tabular-nums mt-1">
                    {formatBaht(stats.netCashFlow)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    รับสด+QR+อื่นๆ หักรายจ่าย
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-medium text-slate-500">จำนวนชิ้นที่ขายได้รวม</span>
                    <p className="text-2xl font-extrabold text-slate-900 tabular-nums mt-1">
                      {formatNumber(stats.totalItemsSold)}{' '}
                      <span className="text-sm font-bold text-slate-600">ชิ้น</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-1 tabular-nums">
                      จากทั้งหมด {formatNumber(sales.length)} บิล · {formatNumber(stats.allProductStats.length)} รายการสินค้า
                    </p>
                  </div>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                    <Package className="h-5 w-5" />
                  </span>
                </div>
                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-medium text-slate-500">
                      ขนาดตะกร้าเฉลี่ย (Basket Size)
                    </span>
                    <p className="text-2xl font-extrabold text-sky-700 tabular-nums mt-1">
                      {stats.avgItemsPerBill.toFixed(1)}{' '}
                      <span className="text-sm font-bold text-sky-600">ชิ้น/บิล</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-1 tabular-nums">
                      ยอดขายเฉลี่ย{' '}
                      <span className="font-bold text-slate-700">{formatBaht(stats.avgTicket)}</span>{' '}
                      ต่อบิล
                    </p>
                  </div>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 border border-sky-100">
                    <ShoppingBag className="h-5 w-5" />
                  </span>
                </div>
              </div>

              {/* Avg Profit Per Bill & Custom/Service Items Card */}
              <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                      <TrendingUp className="h-4 w-4" />
                    </span>
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        วิเคราะห์กำไรเฉลี่ยต่อบิล &amp; รายได้บริการเสริม/สินค้านอกรายการ
                      </h2>
                      <p className="text-[11px] text-slate-500">
                        คำนวณจากยอดขาย {formatNumber(sales.length)} บิล และรายการที่ไม่มีรหัสสินค้าในฐานข้อมูล
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 tabular-nums">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
                    <span className="text-xs font-medium text-slate-600 block">
                      กำไรขั้นต้นเฉลี่ยต่อบิล
                    </span>
                    <p className="text-xl font-extrabold text-emerald-700 mt-1">
                      {formatBaht(stats.avgGrossProfitPerBill)}
                      <span className="text-xs font-semibold text-slate-500 ml-1">/ บิล</span>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      มาร์จิ้นขั้นต้น {stats.grossMarginPct.toFixed(1)}% · ยอดเฉลี่ย{' '}
                      {formatBaht(stats.avgTicket)}/บิล
                    </p>
                  </div>
                  <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-3">
                    <span className="text-xs font-medium text-slate-600 block">
                      กำไรสุทธิเฉลี่ยต่อบิล
                    </span>
                    <p
                      className={`text-xl font-extrabold mt-1 ${
                        stats.avgNetProfitPerBill >= 0 ? 'text-sky-700' : 'text-rose-600'
                      }`}
                    >
                      {formatBaht(stats.avgNetProfitPerBill)}
                      <span className="text-xs font-semibold text-slate-500 ml-1">/ บิล</span>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      อัตรากำไรสุทธิ {stats.netMarginPct.toFixed(1)}% · หลังหักรายจ่ายร้าน
                    </p>
                  </div>
                  <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-3">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-medium text-slate-600">
                        บริการเสริม / สินค้านอกรายการ
                      </span>
                      <span className="rounded-full bg-violet-100 text-violet-700 px-2 py-0.5 text-[11px] font-bold">
                        {stats.customItemSharePct.toFixed(1)}% ของยอดขาย
                      </span>
                    </div>
                    <p className="text-xl font-extrabold text-violet-700 mt-1">
                      {formatBaht(stats.customItemRevenue)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      กำไร {formatBaht(stats.customItemProfit)} ·{' '}
                      {formatNumber(stats.customItemQty)} ชิ้น ·{' '}
                      {formatNumber(stats.customItemBillCount)} บิล
                    </p>
                  </div>
                </div>
                {stats.topCustomItems.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5 text-[11px] tabular-nums">
                    <span className="font-semibold text-slate-500 mr-1">
                      รายการนอกฐานข้อมูลยอดนิยม:
                    </span>
                    {stats.topCustomItems.map((ci) => (
                      <span
                        key={ci.name}
                        className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50/60 px-2 py-0.5 text-violet-800 font-medium"
                      >
                        <span>{ci.name}</span>
                        <span className="text-violet-600 font-bold">
                          {formatBaht(ci.revenue)} ({formatNumber(ci.qty)})
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Break-Even & Net Margin Analysis Card */}
              {(() => {
                const cannotCalcBreakEven = stats.otherExpense > 0 && stats.grossMarginPct <= 0;
                const isAboveBreakEven = !cannotCalcBreakEven && stats.breakEvenDiff >= 0;
                const progressPct =
                  stats.breakEvenSales > 0
                    ? Math.min(100, Math.max(0, (stats.totalSales / stats.breakEvenSales) * 100))
                    : stats.totalSales > 0 || stats.otherExpense === 0
                      ? 100
                      : 0;

                return (
                  <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
                          <Target className="h-4 w-4" />
                        </span>
                        <div>
                          <h2 className="text-sm font-bold text-slate-900">
                            วิเคราะห์จุดคุ้มทุนและอัตรากำไรสุทธิ (Break-Even &amp; Net Margin)
                          </h2>
                          <p className="text-[11px] text-slate-500">
                            เทียบมาร์จิ้นขั้นต้น มาร์จิ้นสุทธิหลังหักรายจ่าย และยอดขายจุดคุ้มทุนเพื่อครอบคลุมรายจ่ายร้าน
                          </p>
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums ${
                          cannotCalcBreakEven
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : isAboveBreakEven
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {cannotCalcBreakEven ? (
                          <>
                            <AlertTriangle className="h-3.5 w-3.5" />
                            <span>มาร์จิ้นขั้นต้น ≤ 0% (ยังไม่คุ้มทุน)</span>
                          </>
                        ) : stats.otherExpense === 0 ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>ไม่มีรายจ่ายร้าน · เกินจุดคุ้มทุน {formatBaht(stats.totalSales)}</span>
                          </>
                        ) : isAboveBreakEven ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>
                              สูงกว่าจุดคุ้มทุน +{formatBaht(stats.breakEvenDiff)}
                              {stats.breakEvenMultiple !== null
                                ? ` (${stats.breakEvenMultiple.toFixed(2)} เท่า)`
                                : ''}
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="h-3.5 w-3.5" />
                            <span>
                              ต่ำกว่าจุดคุ้มทุน -{formatBaht(Math.abs(stats.breakEvenDiff))}
                              {stats.breakEvenMultiple !== null
                                ? ` (${(stats.breakEvenMultiple * 100).toFixed(1)}% ของจุดคุ้มทุน)`
                                : ''}
                            </span>
                          </>
                        )}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 tabular-nums">
                      <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3">
                        <span className="text-[11px] font-semibold text-slate-500">
                          อัตรากำไรขั้นต้น (Gross Margin)
                        </span>
                        <p
                          className={`text-xl font-extrabold mt-0.5 ${
                            stats.grossMarginPct >= 0 ? 'text-emerald-700' : 'text-rose-600'
                          }`}
                        >
                          {stats.grossMarginPct.toFixed(1)}%
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          กำไรขั้นต้น {formatBaht(stats.grossProfit)}
                        </p>
                      </div>

                      <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3">
                        <span className="text-[11px] font-semibold text-slate-500">
                          อัตรากำไรสุทธิ (Net Margin)
                        </span>
                        <p
                          className={`text-xl font-extrabold mt-0.5 ${
                            stats.netMarginPct >= 0 ? 'text-indigo-700' : 'text-rose-600'
                          }`}
                        >
                          {stats.netMarginPct.toFixed(1)}%
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          กำไรสุทธิ {formatBaht(stats.netProfit)}
                        </p>
                      </div>

                      <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3">
                        <span className="text-[11px] font-semibold text-slate-500">
                          ยอดขายจุดคุ้มทุน (Break-Even)
                        </span>
                        <p className="text-xl font-extrabold text-slate-900 mt-0.5">
                          {cannotCalcBreakEven ? '—' : formatBaht(stats.breakEvenSales)}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          รายจ่ายร้าน {formatBaht(stats.otherExpense)}
                        </p>
                      </div>

                      <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3">
                        <span className="text-[11px] font-semibold text-slate-500">
                          เทียบยอดขายปัจจุบัน
                        </span>
                        <p
                          className={`text-xl font-extrabold mt-0.5 ${
                            cannotCalcBreakEven
                              ? 'text-rose-600'
                              : isAboveBreakEven
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {cannotCalcBreakEven
                            ? 'ขาดทุนขั้นต้น'
                            : isAboveBreakEven
                              ? `+${formatBaht(stats.breakEvenDiff)}`
                              : `-${formatBaht(Math.abs(stats.breakEvenDiff))}`}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {stats.breakEvenMultiple !== null
                            ? `ยอดขาย = ${stats.breakEvenMultiple.toFixed(2)}x จุดคุ้มทุน`
                            : `ยอดขายรวม ${formatBaht(stats.totalSales)}`}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                        <span>ความคืบหน้าสู่จุดคุ้มทุนรายจ่ายร้าน</span>
                        <span className="font-bold text-slate-700">
                          {cannotCalcBreakEven
                            ? '0.0%'
                            : stats.breakEvenMultiple !== null
                              ? `${(stats.breakEvenMultiple * 100).toFixed(1)}%`
                              : '100.0%'}
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          style={{ width: `${cannotCalcBreakEven ? 0 : progressPct}%` }}
                          className={`h-full rounded-full transition-all duration-300 ${
                            cannotCalcBreakEven
                              ? 'bg-rose-500'
                              : isAboveBreakEven
                                ? 'bg-emerald-500'
                                : 'bg-amber-500'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
              );
            })()}

            {/* Daily Urgent Alerts Card (Low Stock & Expiring/Expired) */}
            {(() => {
              const hasCritical =
                urgentAlerts.outOfStockCount > 0 || urgentAlerts.expiredCount > 0;
              const hasAnyUrgent = urgentAlerts.totalUrgentCount > 0;
              const visibleStockItems = showAllUrgentStock
                ? urgentAlerts.stockItems
                : urgentAlerts.stockItems.slice(0, 6);
              const visibleExpiryItems = showAllUrgentExpiry
                ? urgentAlerts.expiryItems
                : urgentAlerts.expiryItems.slice(0, 6);

              return (
                <div
                  className={`rounded-2xl bg-white border p-4 shadow-xs space-y-4 ${
                    hasCritical
                      ? 'border-rose-200'
                      : hasAnyUrgent
                        ? 'border-amber-200'
                        : 'border-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 font-bold text-slate-900">
                        <AlertTriangle
                          className={`h-5 w-5 shrink-0 ${
                            hasCritical
                              ? 'text-rose-600'
                              : hasAnyUrgent
                                ? 'text-amber-500'
                                : 'text-emerald-600'
                          }`}
                          aria-hidden="true"
                        />
                        <h2>ศูนย์แจ้งเตือนเร่งด่วน (สต็อกใกล้หมด &amp; วันหมดอายุ)</h2>
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-bold tabular-nums ${
                            hasCritical
                              ? 'bg-rose-50 border-rose-200 text-rose-700'
                              : hasAnyUrgent
                                ? 'bg-amber-50 border-amber-200 text-amber-800'
                                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          }`}
                        >
                          {hasAnyUrgent
                            ? `ต้องดูแล ${formatNumber(urgentAlerts.totalUrgentCount)} รายการ`
                            : 'ปกติ · ไม่มีรายการเร่งด่วน'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        สรุปสินค้าที่สต็อกหมด/ใกล้หมด และสินค้าที่หมดอายุแล้ว/ใกล้หมดอายุภายใน 7 วัน
                        {todayIso ? ` (ข้อมูลวันที่ ${formatExpiryDateTh(todayIso)})` : ''}
                      </p>
                    </div>
                    <Link
                      href="/inventory"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition-colors shrink-0"
                    >
                      <span>จัดการสต็อก &amp; วันหมดอายุ</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>

                  {/* Summary Strip */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 tabular-nums">
                    <div
                      className={`rounded-xl border p-3 ${
                        urgentAlerts.outOfStockCount > 0
                          ? 'bg-rose-50/70 border-rose-200'
                          : 'bg-slate-50 border-slate-200/80'
                      }`}
                    >
                      <span className="text-[11px] font-medium text-slate-600 block">
                        สินค้าหมดสต็อก (≤ 0)
                      </span>
                      <span
                        className={`text-lg font-extrabold mt-0.5 block ${
                          urgentAlerts.outOfStockCount > 0 ? 'text-rose-700' : 'text-slate-700'
                        }`}
                      >
                        {formatNumber(urgentAlerts.outOfStockCount)} รายการ
                      </span>
                    </div>

                    <div
                      className={`rounded-xl border p-3 ${
                        urgentAlerts.lowStockOnlyCount > 0
                          ? 'bg-amber-50/70 border-amber-200'
                          : 'bg-slate-50 border-slate-200/80'
                      }`}
                    >
                      <span className="text-[11px] font-medium text-slate-600 block">
                        สต็อกใกล้หมด (≤ จุดเตือน)
                      </span>
                      <span
                        className={`text-lg font-extrabold mt-0.5 block ${
                          urgentAlerts.lowStockOnlyCount > 0 ? 'text-amber-800' : 'text-slate-700'
                        }`}
                      >
                        {formatNumber(urgentAlerts.lowStockOnlyCount)} รายการ
                      </span>
                    </div>

                    <div
                      className={`rounded-xl border p-3 ${
                        urgentAlerts.expiredCount > 0
                          ? 'bg-rose-50/70 border-rose-200'
                          : 'bg-slate-50 border-slate-200/80'
                      }`}
                    >
                      <span className="text-[11px] font-medium text-slate-600 block">
                        สินค้าหมดอายุแล้ว
                      </span>
                      <span
                        className={`text-lg font-extrabold mt-0.5 block ${
                          urgentAlerts.expiredCount > 0 ? 'text-rose-700' : 'text-slate-700'
                        }`}
                      >
                        {formatNumber(urgentAlerts.expiredCount)} รายการ
                      </span>
                    </div>

                    <div
                      className={`rounded-xl border p-3 ${
                        urgentAlerts.expiringSoonCount > 0
                          ? 'bg-amber-50/70 border-amber-200'
                          : 'bg-slate-50 border-slate-200/80'
                      }`}
                    >
                      <span className="text-[11px] font-medium text-slate-600 block">
                        ใกล้หมดอายุ (ภายใน 7 วัน)
                      </span>
                      <span
                        className={`text-lg font-extrabold mt-0.5 block ${
                          urgentAlerts.expiringSoonCount > 0 ? 'text-amber-800' : 'text-slate-700'
                        }`}
                      >
                        {formatNumber(urgentAlerts.expiringSoonCount)} รายการ
                      </span>
                    </div>
                  </div>

                  {/* Two-column Urgent Lists */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Stock Alerts List */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                          <Package className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
                          <span>สต็อกหมด / ใกล้หมด</span>
                        </div>
                        <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700 tabular-nums">
                          {formatNumber(urgentAlerts.stockItems.length)} รายการ
                        </span>
                      </div>

                      {urgentAlerts.stockItems.length === 0 ? (
                        <div className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50/70 border border-emerald-200/80 py-5 px-3 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>สต็อกสินค้าทุกรายการยังเพียงพอ</span>
                        </div>
                      ) : (
                        <>
                          <div className="divide-y divide-slate-200/70 max-h-72 overflow-y-auto rounded-lg bg-white border border-slate-200/80 px-3">
                            {visibleStockItems.map((item) => (
                              <div
                                key={item.product.id}
                                className="py-2 flex items-center justify-between gap-2 text-xs sm:text-sm"
                              >
                                <div className="min-w-0">
                                  <p className="font-semibold text-slate-800 truncate">
                                    {item.product.name}
                                  </p>
                                  <p className="text-[11px] text-slate-500 tabular-nums">
                                    จุดเตือน ≤ {formatNumber(item.lowAlert)} {item.product.base_unit}
                                  </p>
                                </div>
                                <span
                                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold tabular-nums ${
                                    item.isOutOfStock
                                      ? 'bg-rose-50 border-rose-200 text-rose-700'
                                      : 'bg-amber-50 border-amber-200 text-amber-800'
                                  }`}
                                >
                                  {item.isOutOfStock
                                    ? `หมดสต็อก (${formatNumber(item.stockQty)} ${item.product.base_unit})`
                                    : `เหลือ ${formatNumber(item.stockQty)} ${item.product.base_unit}`}
                                </span>
                              </div>
                            ))}
                          </div>
                          {urgentAlerts.stockItems.length > 6 && (
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => setShowAllUrgentStock((prev) => !prev)}
                                className="text-xs font-bold text-emerald-700 hover:underline"
                              >
                                {showAllUrgentStock
                                  ? 'ย่อรายการ'
                                  : `ดูทั้งหมด (${formatNumber(urgentAlerts.stockItems.length)} รายการ)`}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Expiry Alerts List */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                          <Clock className="h-4 w-4 text-rose-600 shrink-0" aria-hidden="true" />
                          <span>หมดอายุแล้ว / ใกล้หมดอายุใน 7 วัน</span>
                        </div>
                        <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700 tabular-nums">
                          {formatNumber(urgentAlerts.expiryItems.length)} รายการ
                        </span>
                      </div>

                      {urgentAlerts.expiryItems.length === 0 ? (
                        <div className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50/70 border border-emerald-200/80 py-5 px-3 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>ไม่มีสินค้าหมดอายุหรือใกล้หมดอายุใน 7 วัน</span>
                        </div>
                      ) : (
                        <>
                          <div className="divide-y divide-slate-200/70 max-h-72 overflow-y-auto rounded-lg bg-white border border-slate-200/80 px-3">
                            {visibleExpiryItems.map(({ product, expiryInfo }) => {
                              const isExpired = expiryInfo.status === 'expired';
                              const statusText =
                                expiryInfo.daysRemaining < 0
                                  ? `หมดอายุแล้ว ${formatNumber(Math.abs(expiryInfo.daysRemaining))} วัน`
                                  : expiryInfo.daysRemaining === 0
                                    ? 'หมดอายุวันนี้'
                                    : `อีก ${formatNumber(expiryInfo.daysRemaining)} วัน`;
                              return (
                                <div
                                  key={product.id}
                                  className="py-2 flex items-center justify-between gap-2 text-xs sm:text-sm"
                                >
                                  <div className="min-w-0">
                                    <p className="font-semibold text-slate-800 truncate">
                                      {product.name}
                                    </p>
                                    <p className="text-[11px] text-slate-500 tabular-nums">
                                      วันหมดอายุ {expiryInfo.formattedDate} · คงเหลือ{' '}
                                      {formatNumber(product.stock_qty)} {product.base_unit}
                                    </p>
                                  </div>
                                  <span
                                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold tabular-nums ${
                                      isExpired
                                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                                        : 'bg-amber-50 border-amber-200 text-amber-800'
                                    }`}
                                  >
                                    {statusText}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          {urgentAlerts.expiryItems.length > 6 && (
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => setShowAllUrgentExpiry((prev) => !prev)}
                                className="text-xs font-bold text-emerald-700 hover:underline"
                              >
                                {showAllUrgentExpiry
                                  ? 'ย่อรายการ'
                                  : `ดูทั้งหมด (${formatNumber(urgentAlerts.expiryItems.length)} รายการ)`}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Held Bills / Pre-Orders & Cost Price Increase Alerts */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div
                      className={`rounded-xl border p-3.5 flex flex-col justify-between gap-2.5 ${
                        heldBillsSummary.totalCount > 0
                          ? 'bg-sky-50/70 border-sky-200'
                          : 'bg-slate-50/70 border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-slate-900">
                            <span>บิลที่พักไว้ / ออเดอร์สั่งล่วงหน้ารอส่งมอบ</span>
                          </div>
                          <div className="flex flex-wrap items-baseline gap-2 tabular-nums">
                            <span
                              className={`text-xl font-extrabold ${
                                heldBillsSummary.totalCount > 0 ? 'text-sky-700' : 'text-slate-700'
                              }`}
                            >
                              {formatNumber(heldBillsSummary.totalCount)} บิล
                            </span>
                            <span className="text-sm font-bold text-slate-700">
                              มูลค่ารวม {formatBaht(heldBillsSummary.totalValue)}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 tabular-nums">
                            {heldBillsSummary.totalCount === 0
                              ? 'ไม่มีบิลพักหรือออเดอร์รอส่งมอบค้างอยู่'
                              : heldBillsSummary.preOrderCount > 0
                                ? `ออเดอร์นัดรับ/จัดส่ง ${formatNumber(heldBillsSummary.preOrderCount)} บิล (${formatBaht(heldBillsSummary.preOrderValue)}) · พักหน้าร้าน ${formatNumber(heldBillsSummary.totalCount - heldBillsSummary.preOrderCount)} บิล`
                                : `พักบิลหน้าร้านทั้งหมด ${formatNumber(heldBillsSummary.totalCount)} บิล`}
                          </p>
                        </div>
                        <Link
                          href="/pos"
                          className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-white px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-50 transition-colors shrink-0"
                        >
                          <span>ไปหน้าขาย POS</span>
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </div>
                    </div>

                    <div
                      className={`rounded-xl border p-3.5 flex flex-col justify-between gap-2.5 ${
                        costIncreaseSummary.count > 0
                          ? 'bg-orange-50/70 border-orange-200'
                          : 'bg-slate-50/70 border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-slate-900">
                            <span>สินค้าที่ราคาทุนเพิ่งปรับขึ้น</span>
                          </div>
                          <div className="flex flex-wrap items-baseline gap-2 tabular-nums">
                            <span
                              className={`text-xl font-extrabold ${
                                costIncreaseSummary.count > 0
                                  ? 'text-orange-700'
                                  : 'text-slate-700'
                              }`}
                            >
                              {formatNumber(costIncreaseSummary.count)} รายการ
                            </span>
                          </div>
                          {costIncreaseSummary.count === 0 ? (
                            <p className="text-[11px] text-slate-600">
                              ยังไม่มีรายการที่ราคาทุนสูงขึ้นจากทุนครั้งก่อน
                            </p>
                          ) : (
                            <p className="text-[11px] text-orange-800 truncate tabular-nums">
                              ล่าสุด:{' '}
                              {costIncreaseSummary.topItems
                                .map(
                                  (item) =>
                                    `${item.product.name} (+${formatBaht(item.diff)})`
                                )
                                .join(' · ')}
                            </p>
                          )}
                        </div>
                        <Link
                          href="/inventory"
                          className="inline-flex items-center gap-1 rounded-xl border border-orange-200 bg-white px-3 py-1.5 text-xs font-bold text-orange-700 hover:bg-orange-50 transition-colors shrink-0"
                        >
                          <span>ดูในคลังสินค้า</span>
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Discount Impact Analysis Card */}
            {(() => {
              const netSharePct =
                stats.grossSalesBeforeDiscount > 0
                  ? Math.max(0, Math.min(100, 100 - stats.discountRatePct))
                  : 0;
              const discountBarPct =
                stats.grossSalesBeforeDiscount > 0
                  ? Math.max(
                      stats.totalDiscountGiven > 0 ? 1.5 : 0,
                      Math.min(100, stats.discountRatePct)
                    )
                  : 0;
              return (
                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <BadgePercent className="h-5 w-5 text-rose-600 shrink-0" aria-hidden="true" />
                      <h2>วิเคราะห์ผลกระทบส่วนลดท้ายบิล (Discount Impact Analysis)</h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-bold tabular-nums ${
                          stats.discountedBillsCount > 0
                            ? 'bg-rose-50 border-rose-200 text-rose-700'
                            : 'bg-slate-100 border-slate-200 text-slate-600'
                        }`}
                      >
                        {stats.discountedBillsCount > 0
                          ? `ให้ส่วนลด ${formatNumber(stats.discountedBillsCount)} / ${formatNumber(sales.length)} บิล`
                          : 'ไม่มีบิลที่มีส่วนลด'}
                      </span>
                      <span className="text-xs text-slate-500 font-medium">
                        {periodDisplayLabel}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
                    <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3">
                      <span className="text-[11px] font-medium text-slate-500 block">
                        ยอดขายก่อนหักส่วนลด
                      </span>
                      <span className="text-lg font-extrabold text-slate-900 mt-0.5 block">
                        {formatBaht(stats.grossSalesBeforeDiscount)}
                      </span>
                      <span className="text-[11px] text-slate-500 mt-0.5 block">
                        ยอดสุทธิหลังลด {formatBaht(stats.totalSales)}
                      </span>
                    </div>

                    <div className="rounded-xl bg-rose-50/70 border border-rose-200/80 p-3">
                      <span className="text-[11px] font-medium text-rose-700 block">
                        ยอดส่วนลดรวมที่ให้ลูกค้า
                      </span>
                      <span
                        className={`text-lg font-extrabold mt-0.5 block ${
                          stats.totalDiscountGiven > 0 ? 'text-rose-700' : 'text-slate-700'
                        }`}
                      >
                        {stats.totalDiscountGiven > 0
                          ? `-${formatBaht(stats.totalDiscountGiven)}`
                          : formatBaht(0)}
                      </span>
                      <span className="text-[11px] text-rose-600/90 mt-0.5 block">
                        {stats.discountedBillsCount > 0
                          ? `เฉลี่ย ${formatBaht(stats.avgDiscountPerBill)} / บิลที่ลด`
                          : 'ยังไม่มีส่วนลดในช่วงนี้'}
                      </span>
                    </div>

                    <div className="rounded-xl bg-amber-50/70 border border-amber-200/80 p-3">
                      <span className="text-[11px] font-medium text-amber-800 block">
                        จำนวนบิลที่มีการให้ส่วนลด
                      </span>
                      <span className="text-lg font-extrabold text-amber-900 mt-0.5 block">
                        {formatNumber(stats.discountedBillsCount)} บิล
                      </span>
                      <span className="text-[11px] text-amber-700 mt-0.5 block">
                        คิดเป็น {stats.discountedBillsPct.toFixed(1)}% จาก {formatNumber(sales.length)} บิล
                      </span>
                    </div>

                    <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3">
                      <span className="text-[11px] font-medium text-slate-500 block">
                        สัดส่วนส่วนลดเทียบยอดก่อนลด
                      </span>
                      <span
                        className={`text-lg font-extrabold mt-0.5 block ${
                          stats.discountRatePct > 0 ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {stats.discountRatePct.toFixed(1)}%
                      </span>
                      <span className="text-[11px] text-slate-500 mt-0.5 block">
                        {stats.grossSalesBeforeDiscount > 0
                          ? `รับจริง ${netSharePct.toFixed(1)}% ของยอดตั้งต้น`
                          : 'ยังไม่มีข้อมูลยอดขาย'}
                      </span>
                    </div>
                  </div>

                  {stats.grossSalesBeforeDiscount > 0 && (
                    <div className="space-y-2 pt-0.5">
                      <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden flex border border-slate-200/60">
                        <div
                          style={{ width: `${Math.max(0, 100 - discountBarPct)}%` }}
                          className="h-full bg-emerald-500 transition-all duration-300"
                          title={`ยอดขายสุทธิ ${formatBaht(stats.totalSales)} (${netSharePct.toFixed(1)}%)`}
                        />
                        {discountBarPct > 0 && (
                          <div
                            style={{ width: `${discountBarPct}%` }}
                            className="h-full bg-rose-500 transition-all duration-300"
                            title={`ส่วนลดที่ให้ ${formatBaht(stats.totalDiscountGiven)} (${stats.discountRatePct.toFixed(1)}%)`}
                          />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums">
                        <div className="flex flex-wrap items-center gap-3 text-slate-600">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                            <span>
                              ยอดขายสุทธิ: <strong className="text-slate-900">{formatBaht(stats.totalSales)}</strong> ({netSharePct.toFixed(1)}%)
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
                            <span>
                              ส่วนลดรวม:{' '}
                              <strong className="text-rose-700">
                                {stats.totalDiscountGiven > 0
                                  ? `-${formatBaht(stats.totalDiscountGiven)}`
                                  : formatBaht(0)}
                              </strong>{' '}
                              ({stats.discountRatePct.toFixed(1)}%)
                            </span>
                          </span>
                        </div>

                        {stats.totalDiscountGiven > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {stats.vipDiscountCount > 0 && (
                              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                                VIP ({stats.vipDiscountCount} บิล): -{formatBaht(stats.vipDiscountTotal)}
                              </span>
                            )}
                            {stats.pointsDiscountCount > 0 && (
                              <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold text-sky-800">
                                แลกแต้ม ({stats.pointsDiscountCount} บิล): -{formatBaht(stats.pointsDiscountTotal)}
                              </span>
                            )}
                            {stats.manualDiscountCount > 0 && (
                              <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 font-semibold text-rose-800">
                                ท้ายบิลทั่วไป ({stats.manualDiscountCount} บิล): -{formatBaht(stats.manualDiscountTotal)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Credit vs Debt Collection Health Card */}
            {(() => {
              const hasCreditActivity = stats.creditSales > 0 || stats.debtCollectedTotal > 0;
              const totalMovement = stats.creditSales + stats.debtCollectedTotal;
              const creditSharePct =
                totalMovement > 0 ? (stats.creditSales / totalMovement) * 100 : 0;
              const collectedSharePct =
                totalMovement > 0 ? (stats.debtCollectedTotal / totalMovement) * 100 : 0;

              let healthBadgeText = 'ไม่มีรายการปล่อยเชื่อ/รับชำระหนี้';
              let healthBadgeClass = 'bg-slate-100 border-slate-200 text-slate-600';
              if (hasCreditActivity) {
                if (stats.creditCollectionNet > 0) {
                  healthBadgeText = `เก็บหนี้ได้มากกว่าปล่อยเชื่อ (+${formatBahtPrefix(stats.creditCollectionNet)})`;
                  healthBadgeClass = 'bg-emerald-50 border-emerald-200 text-emerald-700';
                } else if (stats.creditCollectionNet === 0) {
                  healthBadgeText = 'สมดุล (ปล่อยเชื่อเท่ากับรับชำระหนี้)';
                  healthBadgeClass = 'bg-sky-50 border-sky-200 text-sky-700';
                } else if (stats.debtCollectedTotal === 0) {
                  healthBadgeText = 'เฝ้าระวัง · ยังไม่มียอดรับชำระหนี้';
                  healthBadgeClass = 'bg-rose-50 border-rose-200 text-rose-700';
                } else {
                  healthBadgeText = `ปล่อยเชื่อเพิ่มสุทธิ (-${formatBahtPrefix(Math.abs(stats.creditCollectionNet))})`;
                  healthBadgeClass = 'bg-amber-50 border-amber-200 text-amber-800';
                }
              }

              return (
                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <Wallet className="h-5 w-5 text-emerald-600 shrink-0" aria-hidden="true" />
                      <h2>วิเคราะห์การปล่อยเชื่อ vs การรับชำระหนี้ (Credit vs Debt Collection Health)</h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                          stats.creditLiquidityStatus === 'สภาพคล่องดีเยี่ยม'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : stats.creditLiquidityStatus === 'ควรเร่งติดตามหนี้ค้าง'
                              ? 'bg-rose-50 border-rose-200 text-rose-700'
                              : 'bg-sky-50 border-sky-200 text-sky-700'
                        }`}
                      >
                        {stats.creditLiquidityStatus}
                      </span>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-bold tabular-nums ${healthBadgeClass}`}
                      >
                        {healthBadgeText}
                      </span>
                      <span className="text-xs text-slate-500 font-medium">
                        {periodDisplayLabel}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 rounded-xl bg-slate-50/80 border border-slate-200/80 p-3 text-xs tabular-nums">
                    <div className="flex items-center justify-between sm:block">
                      <span className="text-slate-500 font-medium block">
                        สัดส่วนขายเชื่อต่อยอดขายรวม (Credit Exposure)
                      </span>
                      <span className="text-sm font-extrabold text-amber-800 sm:mt-0.5 block">
                        {stats.creditExposurePct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between sm:block">
                      <span className="text-slate-500 font-medium block">
                        อัตราเก็บหนี้เทียบหนี้คงค้างรวม (Debt Recovery)
                      </span>
                      <span className="text-sm font-extrabold text-emerald-700 sm:mt-0.5 block">
                        {stats.debtRecoveryVsOutstandingPct.toFixed(1)}%
                        {stats.totalOutstandingDebt === 0 && ' (ไม่มีหนี้คงค้าง)'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between sm:block">
                      <span className="text-slate-500 font-medium block">
                        ประเมินสภาพคล่องเงินเชื่อ
                      </span>
                      <span
                        className={`text-sm font-extrabold sm:mt-0.5 block ${
                          stats.creditLiquidityStatus === 'สภาพคล่องดีเยี่ยม'
                            ? 'text-emerald-700'
                            : stats.creditLiquidityStatus === 'ควรเร่งติดตามหนี้ค้าง'
                              ? 'text-rose-700'
                              : 'text-sky-700'
                        }`}
                      >
                        {stats.creditLiquidityStatus}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
                    <div className="rounded-xl bg-amber-50/70 border border-amber-200/80 p-3">
                      <span className="text-[11px] font-medium text-amber-800 block">
                        ยอดขายเชื่อใหม่ (ปล่อยเชื่อ)
                      </span>
                      <span className="text-lg font-extrabold text-amber-900 mt-0.5 block">
                        {formatBaht(stats.creditSales)}
                      </span>
                      <span className="text-[11px] text-amber-700 mt-0.5 block">
                        {formatNumber(stats.creditCount)} บิล · {stats.creditPct.toFixed(1)}% ของยอดขายรวม
                      </span>
                    </div>

                    <div className="rounded-xl bg-emerald-50/70 border border-emerald-200/80 p-3">
                      <span className="text-[11px] font-medium text-emerald-800 block">
                        ยอดรับชำระหนี้รวม (เก็บได้จริงสุทธิ)
                      </span>
                      <span className="text-lg font-extrabold text-emerald-800 mt-0.5 block">
                        {formatBaht(stats.debtCollectedTotal)}
                      </span>
                      <span className="text-[11px] text-emerald-700 mt-0.5 block">
                        รับชำระ {formatNumber(stats.debtPaymentCount)} ครั้งในช่วงเวลานี้
                      </span>
                      {stats.debtWaivedTotal > 0 && (
                        <span className="text-[11px] font-semibold text-amber-700 mt-1 block">
                          ยกเว้น/ลดเศษหนี้ {formatBaht(stats.debtWaivedTotal)} ({formatNumber(stats.debtWaivedCount)} ครั้ง)
                        </span>
                      )}
                    </div>

                    <div className="rounded-xl bg-sky-50/70 border border-sky-200/80 p-3 space-y-1">
                      <span className="text-[11px] font-medium text-sky-800 block">
                        ช่องทางรับชำระหนี้
                      </span>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-600">
                          เงินสด ({formatNumber(stats.debtPaymentCashCount)} ครั้ง):
                        </span>
                        <span className="font-extrabold text-emerald-700">
                          {formatBaht(stats.debtCollectedCash)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-600">
                          โอนเงิน / QR ({formatNumber(stats.debtPaymentQrCount)} ครั้ง):
                        </span>
                        <span className="font-extrabold text-sky-700">
                          {formatBaht(stats.debtCollectedQr)}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3">
                      <span className="text-[11px] font-medium text-slate-500 block">
                        ส่วนต่างสุทธิ (เก็บหนี้ - ปล่อยเชื่อ)
                      </span>
                      <span
                        className={`text-lg font-extrabold mt-0.5 block ${
                          stats.creditCollectionNet > 0
                            ? 'text-emerald-700'
                            : stats.creditCollectionNet < 0
                              ? 'text-rose-700'
                              : 'text-slate-700'
                        }`}
                      >
                        {stats.creditCollectionNet > 0
                          ? `+${formatBaht(stats.creditCollectionNet)}`
                          : stats.creditCollectionNet < 0
                            ? `-${formatBaht(Math.abs(stats.creditCollectionNet))}`
                            : formatBaht(0)}
                      </span>
                      <span className="text-[11px] text-slate-500 mt-0.5 block">
                        {stats.creditCollectionRatePct !== null
                          ? `อัตราเก็บหนี้เทียบปล่อยเชื่อใหม่ ${stats.creditCollectionRatePct.toFixed(1)}%`
                          : stats.debtCollectedTotal > 0
                            ? 'เก็บหนี้คืนล้วน (ไม่มีขายเชื่อใหม่)'
                            : `ลูกหนี้คงค้างรวม ${formatBaht(stats.totalOutstandingDebt)}`}
                      </span>
                    </div>
                  </div>

                  {hasCreditActivity ? (
                    <div className="space-y-2 pt-0.5">
                      <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden flex border border-slate-200/60">
                        {creditSharePct > 0 && (
                          <div
                            style={{ width: `${creditSharePct}%` }}
                            className="h-full bg-amber-500 transition-all duration-300"
                            title={`ปล่อยเชื่อใหม่ ${formatBaht(stats.creditSales)} (${creditSharePct.toFixed(1)}%)`}
                          />
                        )}
                        {collectedSharePct > 0 && (
                          <div
                            style={{ width: `${collectedSharePct}%` }}
                            className="h-full bg-emerald-500 transition-all duration-300"
                            title={`รับชำระหนี้จริง ${formatBaht(stats.debtCollectedTotal)} (${collectedSharePct.toFixed(1)}%)`}
                          />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums">
                        <div className="flex flex-wrap items-center gap-3 text-slate-600">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                            <span>
                              ปล่อยเชื่อใหม่:{' '}
                              <strong className="text-amber-800">{formatBaht(stats.creditSales)}</strong>{' '}
                              ({creditSharePct.toFixed(1)}%)
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                            <span>
                              เก็บหนี้ได้จริง:{' '}
                              <strong className="text-emerald-800">{formatBaht(stats.debtCollectedTotal)}</strong>{' '}
                              ({collectedSharePct.toFixed(1)}%)
                            </span>
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {stats.debtCollectedTotal > 0 && (
                            <>
                              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">
                                รับเงินสด {stats.debtCollectedCashPct.toFixed(1)}%
                              </span>
                              <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold text-sky-800">
                                รับโอน QR {stats.debtCollectedQrPct.toFixed(1)}%
                              </span>
                            </>
                          )}
                          {stats.debtWaivedTotal > 0 && (
                            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                              ยกเว้นเศษหนี้ {formatBaht(stats.debtWaivedTotal)} ({formatNumber(stats.debtWaivedCount)} ครั้ง)
                            </span>
                          )}
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-semibold text-slate-700">
                            ลูกหนี้คงค้างทั้งหมด: {formatBaht(stats.totalOutstandingDebt)} ({formatNumber(stats.debtorCustomersCount)} ราย)
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200/70 px-3 py-2 text-xs text-slate-500">
                      <span>ยังไม่มีรายการขายเชื่อหรือรับชำระหนี้ในช่วง{periodDisplayLabel}</span>
                      {stats.totalOutstandingDebt > 0 && (
                        <span className="font-semibold text-slate-700 tabular-nums">
                          ลูกหนี้คงค้างสะสมปัจจุบัน: {formatBaht(stats.totalOutstandingDebt)} ({formatNumber(stats.debtorCustomersCount)} ราย)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Visual Analytics: Payment Breakdown & Sales Trend Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* (ก) แถบสัดส่วนช่องทางการรับเงิน */}
              <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 p-4 shadow-xs flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <PieChart className="h-5 w-5 text-emerald-600" />
                      <h2>สัดส่วนช่องทางการรับเงิน</h2>
                    </div>
                    <span className="text-xs text-slate-500 font-medium">
                      {PERIOD_LABEL[period]}
                    </span>
                  </div>

                  {/* Stacked Percentage Progress Bar */}
                  <div className="h-4 w-full rounded-full bg-slate-100 overflow-hidden flex border border-slate-200/70">
                    {stats.totalSales > 0 ? (
                      <>
                        {stats.cashPct > 0 && (
                          <div
                            style={{ width: `${stats.cashPct}%` }}
                            className="bg-emerald-500 h-full transition-all duration-300"
                            title={`เงินสด: ${stats.cashPct.toFixed(1)}%`}
                          />
                        )}
                        {stats.qrPct > 0 && (
                          <div
                            style={{ width: `${stats.qrPct}%` }}
                            className="bg-sky-500 h-full transition-all duration-300"
                            title={`PromptPay QR: ${stats.qrPct.toFixed(1)}%`}
                          />
                        )}
                        {stats.creditPct > 0 && (
                          <div
                            style={{ width: `${stats.creditPct}%` }}
                            className="bg-amber-500 h-full transition-all duration-300"
                            title={`เงินเชื่อ: ${stats.creditPct.toFixed(1)}%`}
                          />
                        )}
                      </>
                    ) : (
                      <div className="w-full h-full bg-slate-100" />
                    )}
                  </div>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between rounded-xl bg-emerald-50/70 border border-emerald-100 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-emerald-500 shrink-0" />
                      <div>
                        <span className="font-bold text-slate-800">เงินสด</span>
                        <span className="text-slate-500 ml-1.5">({stats.cashCount} บิล)</span>
                      </div>
                    </div>
                    <div className="text-right tabular-nums">
                      <span className="font-extrabold text-emerald-800">
                        {formatBaht(stats.cashSales)}
                      </span>
                      <span className="ml-2 inline-block w-12 rounded-md bg-emerald-100 px-1.5 py-0.5 text-center font-bold text-emerald-700">
                        {stats.cashPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-xl bg-sky-50/70 border border-sky-100 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-sky-500 shrink-0" />
                      <div>
                        <span className="font-bold text-slate-800">PromptPay QR</span>
                        <span className="text-slate-500 ml-1.5">({stats.qrCount} บิล)</span>
                      </div>
                    </div>
                    <div className="text-right tabular-nums">
                      <span className="font-extrabold text-sky-800">
                        {formatBaht(stats.qrSales)}
                      </span>
                      <span className="ml-2 inline-block w-12 rounded-md bg-sky-100 px-1.5 py-0.5 text-center font-bold text-sky-700">
                        {stats.qrPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-xl bg-amber-50/70 border border-amber-100 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-amber-500 shrink-0" />
                      <div>
                        <span className="font-bold text-slate-800">เงินเชื่อ (ค้างชำระ)</span>
                        <span className="text-slate-500 ml-1.5">({stats.creditCount} บิล)</span>
                      </div>
                    </div>
                    <div className="text-right tabular-nums">
                      <span className="font-extrabold text-amber-800">
                        {formatBaht(stats.creditSales)}
                      </span>
                      <span className="ml-2 inline-block w-12 rounded-md bg-amber-100 px-1.5 py-0.5 text-center font-bold text-amber-700">
                        {stats.creditPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* (ข) กราฟแท่งแสดงแนวโน้มยอดขาย */}
              <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-4 shadow-xs flex flex-col justify-between">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <BarChart3 className="h-5 w-5 text-sky-600" />
                    <h2>
                      กราฟแนวโน้มยอดขาย (
                      {period === 'today' ||
                      period === 'yesterday' ||
                      (period === 'custom' && customStart && customStart === customEnd)
                        ? `แบ่งตามช่วงเวลา · ${periodDisplayLabel}`
                        : `รายวัน · ${periodDisplayLabel}`}
                      )
                    </h2>
                  </div>
                  <span className="text-xs text-slate-500">
                    รวม {formatBaht(stats.totalSales)} ({sales.length} บิล)
                  </span>
                </div>

                {stats.trendBuckets.length === 0 ? (
                  <p className="text-sm text-slate-500 py-10 text-center">
                    ยังไม่มีข้อมูลการขายในช่วงเวลานี้
                  </p>
                ) : (
                  <div className="overflow-x-auto pb-1">
                    <div
                      className="flex items-end gap-2 pt-6 pb-2 min-h-[190px]"
                      style={{
                        minWidth:
                          stats.trendBuckets.length > 10
                            ? `${stats.trendBuckets.length * 46}px`
                            : '100%',
                      }}
                    >
                      {stats.trendBuckets.map((b) => {
                        const heightPct =
                          stats.maxTrendAmount > 0
                            ? Math.max((b.amount / stats.maxTrendAmount) * 100, b.amount > 0 ? 8 : 0)
                            : 0;
                        return (
                          <div
                            key={b.key}
                            className="flex-1 flex flex-col items-center justify-end gap-1.5 group min-w-[38px]"
                          >
                            <div className="text-[11px] font-bold text-slate-700 tabular-nums text-center leading-tight">
                              {b.amount > 0 ? `${formatNumber(b.amount)}฿` : '-'}
                            </div>
                            <div className="w-full h-28 bg-slate-100/80 rounded-xl flex items-end p-1 border border-slate-200/60">
                              <div
                                style={{ height: `${heightPct}%` }}
                                className={`w-full rounded-lg transition-all duration-300 ${
                                  b.amount > 0
                                    ? 'bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-xs'
                                    : 'bg-transparent'
                                }`}
                                title={`${b.label}: ยอดขาย ${formatBaht(b.amount)} | กำไร ${formatBaht(b.profit)} (${b.count} บิล)`}
                              />
                            </div>
                            <div className="text-center leading-tight">
                              <span className="block text-[11px] font-bold text-slate-800 whitespace-nowrap">
                                {b.label}
                              </span>
                              {b.subLabel && (
                                <span className="block text-[11px] text-slate-500 whitespace-nowrap">
                                  {b.subLabel}
                                </span>
                              )}
                              <span className="block text-[11px] font-semibold text-emerald-700 mt-0.5">
                                {b.count} บิล
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Daily Breakdown Table (7days, month, custom) */}
            {(period === '7days' || period === 'month' || period === 'custom') && (
              <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <Calendar className="h-5 w-5 text-emerald-600" />
                    <h2>ตารางสรุปยอดขายรายวัน</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-medium">
                      {periodDisplayLabel} · {dailyBreakdown.length} วัน
                      {dailyBreakdown.length > 0 &&
                        ` · เฉลี่ย ${formatBaht(stats.totalSales / dailyBreakdown.length)}/วัน`}
                    </span>
                    <button
                      type="button"
                      onClick={handleExportDailyCSV}
                      disabled={dailyBreakdown.length === 0}
                      title="ส่งออกตารางสรุปยอดขายรายวันเป็น CSV"
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>ส่งออก CSV</span>
                    </button>
                  </div>
                </div>

                {dailyBreakdown.length === 0 ? (
                  <p className="text-sm text-slate-500 py-6 text-center">
                    ยังไม่มีข้อมูลรายวันในช่วงเวลาที่เลือก
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-bold text-slate-500 bg-slate-50/80">
                          <th className="py-2.5 px-3 text-left whitespace-nowrap rounded-tl-lg">
                            วันที่
                          </th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">
                            จำนวนบิล
                          </th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">
                            ยอดขาย
                          </th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">
                            ต้นทุน
                          </th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">
                            กำไรขั้นต้น
                          </th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap rounded-tr-lg">
                            % มาร์จิ้น
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {dailyBreakdown.map((row) => {
                          const hasSales = row.billCount > 0;
                          return (
                            <tr
                              key={row.dateKey}
                              className={`hover:bg-slate-50/70 transition-colors ${
                                hasSales ? 'text-slate-800' : 'text-slate-500'
                              }`}
                            >
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <span className="font-semibold">{row.label}</span>
                                <span className="ml-1.5 text-xs text-slate-500">
                                  ({row.subLabel})
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                {formatNumber(row.billCount)} บิล
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold whitespace-nowrap">
                                {formatBaht(row.totalSales)}
                              </td>
                              <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                {formatBaht(row.totalCost)}
                              </td>
                              <td
                                className={`py-2.5 px-3 text-right font-bold whitespace-nowrap ${
                                  !hasSales
                                    ? 'text-slate-500'
                                    : row.grossProfit >= 0
                                      ? 'text-emerald-600'
                                      : 'text-rose-600'
                                }`}
                              >
                                {row.grossProfit > 0
                                  ? `+${formatBaht(row.grossProfit)}`
                                  : formatBaht(row.grossProfit)}
                              </td>
                              <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                <span
                                  className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-bold ${
                                    !hasSales
                                      ? 'bg-slate-100 text-slate-500'
                                      : row.marginPct >= 0
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : 'bg-rose-50 text-rose-700'
                                  }`}
                                >
                                  {row.marginPct.toFixed(1)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-900 tabular-nums">
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            รวมทั้งหมด ({dailyBreakdown.length} วัน)
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {formatNumber(sales.length)} บิล
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {formatBaht(stats.totalSales)}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {formatBaht(stats.totalCost)}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right whitespace-nowrap ${
                              stats.grossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {stats.grossProfit > 0
                              ? `+${formatBaht(stats.grossProfit)}`
                              : formatBaht(stats.grossProfit)}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {stats.grossMarginPct.toFixed(1)}%
                          </td>
                        </tr>
                        {dailyBreakdown.length > 0 && (() => {
                          const avgDailySales = stats.totalSales / dailyBreakdown.length;
                          const avgDailyCost = stats.totalCost / dailyBreakdown.length;
                          const avgDailyProfit = stats.grossProfit / dailyBreakdown.length;
                          const avgDailyBills = sales.length / dailyBreakdown.length;
                          return (
                            <tr className="border-t border-slate-200 bg-emerald-50/50 text-xs font-bold text-slate-700 tabular-nums">
                              <td className="py-2 px-3 whitespace-nowrap rounded-bl-lg text-emerald-800">
                                เฉลี่ยต่อวัน
                              </td>
                              <td className="py-2 px-3 text-right whitespace-nowrap">
                                {avgDailyBills.toFixed(1)} บิล/วัน
                              </td>
                              <td className="py-2 px-3 text-right whitespace-nowrap text-emerald-800">
                                {formatBaht(avgDailySales)}
                              </td>
                              <td className="py-2 px-3 text-right whitespace-nowrap">
                                {formatBaht(avgDailyCost)}
                              </td>
                              <td
                                className={`py-2 px-3 text-right whitespace-nowrap ${
                                  avgDailyProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                                }`}
                              >
                                {avgDailyProfit > 0
                                  ? `+${formatBaht(avgDailyProfit)}`
                                  : formatBaht(avgDailyProfit)}
                              </td>
                              <td className="py-2 px-3 text-right whitespace-nowrap rounded-br-lg text-slate-500">
                                -
                              </td>
                            </tr>
                          );
                        })()}
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Daily Trading Highlights Card */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Award className="h-5 w-5 text-amber-500" />
                  <h2>ไฮไลต์ประสิทธิภาพรายวัน (Daily Trading Highlights)</h2>
                </div>
                <span className="text-xs text-slate-500 font-medium tabular-nums">
                  {periodDisplayLabel} · วันที่มีการขาย {formatNumber(stats.activeTradingDaysCount)} วัน
                </span>
              </div>
              {stats.activeTradingDaysCount === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">
                  ยังไม่มีข้อมูลการขายในช่วงเวลาที่เลือก
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 tabular-nums">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5">
                    <p className="text-xs font-semibold text-emerald-700">วันที่มียอดขายสูงสุด</p>
                    <p className="text-lg font-extrabold text-slate-900 mt-1">
                      {stats.bestSalesDay ? formatBaht(stats.bestSalesDay.totalSales) : formatBaht(0)}
                    </p>
                    {stats.bestSalesDay && (
                      <p className="text-xs text-slate-600 mt-1">
                        <span className="font-bold text-emerald-800">
                          {stats.bestSalesDay.label} ({stats.bestSalesDay.subLabel})
                        </span>{' '}
                        · {formatNumber(stats.bestSalesDay.billCount)} บิล · กำไร{' '}
                        {formatBaht(stats.bestSalesDay.grossProfit)}
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5">
                    <p className="text-xs font-semibold text-amber-700">วันที่ทำกำไรขั้นต้นสูงสุด</p>
                    <p className="text-lg font-extrabold text-slate-900 mt-1">
                      {stats.bestProfitDay ? formatBaht(stats.bestProfitDay.grossProfit) : formatBaht(0)}
                    </p>
                    {stats.bestProfitDay && (
                      <p className="text-xs text-slate-600 mt-1">
                        <span className="font-bold text-amber-800">
                          {stats.bestProfitDay.label} ({stats.bestProfitDay.subLabel})
                        </span>{' '}
                        · มาร์จิ้น {stats.bestProfitDay.marginPct.toFixed(1)}% · ยอดขาย{' '}
                        {formatBaht(stats.bestProfitDay.totalSales)}
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3.5">
                    <p className="text-xs font-semibold text-sky-700">ยอดขายเฉลี่ยต่อวันที่มีการขาย</p>
                    <p className="text-lg font-extrabold text-slate-900 mt-1">
                      {formatBaht(stats.avgSalesPerActiveDay)}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      จากวันที่มีบิลขายจริง{' '}
                      <span className="font-bold text-sky-800">
                        {formatNumber(stats.activeTradingDaysCount)} วัน
                      </span>{' '}
                      ({formatNumber(sales.length)} บิล)
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Sales by Day of Week Card */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Calendar className="h-5 w-5 text-emerald-600" />
                  <h2>วิเคราะห์ยอดขายตามวันในสัปดาห์ (จันทร์ - อาทิตย์)</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {stats.bestDayOfWeek && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-700 tabular-nums">
                      วันขายดีที่สุด: วัน{stats.bestDayOfWeek.label} ({formatBaht(stats.bestDayOfWeek.amount)})
                    </span>
                  )}
                  <span className="text-xs text-slate-500 font-medium">
                    {periodDisplayLabel}
                  </span>
                </div>
              </div>

              {sales.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">
                  ยังไม่มีข้อมูลการขายในช่วงเวลานี้
                </p>
              ) : (
                <div className="grid grid-cols-7 gap-2 pt-4 pb-1 items-end">
                  {stats.dayOfWeekStats.map((d) => {
                    const isBest = stats.bestDayOfWeek?.dayIndex === d.dayIndex;
                    const heightPct =
                      stats.maxDowAmount > 0
                        ? Math.max((d.amount / stats.maxDowAmount) * 100, d.amount > 0 ? 10 : 0)
                        : 0;
                    return (
                      <div
                        key={d.dayIndex}
                        className="flex flex-col items-center justify-end gap-1.5 min-w-0"
                      >
                        <div className="text-[11px] sm:text-[11px] font-bold text-slate-700 tabular-nums text-center leading-tight truncate w-full">
                          {d.amount > 0 ? `${formatNumber(d.amount)}฿` : '-'}
                        </div>
                        <div
                          className={`w-full h-28 rounded-xl flex items-end p-1 border ${
                            isBest
                              ? 'bg-emerald-50/80 border-emerald-200'
                              : 'bg-slate-100/80 border-slate-200/60'
                          }`}
                        >
                          <div
                            style={{ height: `${heightPct}%` }}
                            className={`w-full rounded-lg transition-all duration-300 ${
                              d.amount > 0
                                ? isBest
                                  ? 'bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-xs'
                                  : 'bg-gradient-to-t from-sky-600 to-sky-400 shadow-xs'
                                : 'bg-transparent'
                            }`}
                            title={`วัน${d.label}: ยอดขาย ${formatBaht(d.amount)} | กำไร ${formatBaht(d.profit)} (${d.count} บิล)`}
                          />
                        </div>
                        <div className="text-center leading-tight">
                          <span
                            className={`hidden sm:block text-xs font-bold whitespace-nowrap ${
                              isBest ? 'text-emerald-700' : 'text-slate-800'
                            }`}
                          >
                            {d.label}
                          </span>
                          <span
                            className={`block sm:hidden text-xs font-bold whitespace-nowrap ${
                              isBest ? 'text-emerald-700' : 'text-slate-800'
                            }`}
                          >
                            {d.shortLabel}
                          </span>
                          <span className="block text-[11px] font-semibold text-slate-500 mt-0.5 tabular-nums">
                            {d.count} บิล
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sales by Time of Day Card */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Clock className="h-5 w-5 text-emerald-600" />
                  <h2>ยอดขายตามช่วงเวลาของวัน</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {stats.bestTimeOfDay && stats.bestTimeOfDay.amount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-700 tabular-nums">
                      ช่วงขายดีที่สุด: {stats.bestTimeOfDay.label} ({stats.bestTimeOfDay.rangeLabel})
                    </span>
                  )}
                  <span className="text-xs text-slate-500 font-medium">
                    {periodDisplayLabel}
                  </span>
                </div>
              </div>

              {sales.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">
                  ยังไม่มีข้อมูลการขายในช่วงเวลานี้
                </p>
              ) : (
                <div className="space-y-3 pt-1">
                  {stats.timeOfDayStats.map((slot) => {
                    const isBest =
                      stats.bestTimeOfDay?.key === slot.key && slot.amount > 0;
                    const barWidthPct = Math.min(Math.max(slot.pct, slot.amount > 0 ? 3 : 0), 100);
                    return (
                      <div key={slot.key} className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-bold ${
                                isBest ? 'text-emerald-700' : 'text-slate-800'
                              }`}
                            >
                              {slot.label}
                            </span>
                            <span className="text-xs text-slate-500 tabular-nums">
                              ({slot.rangeLabel})
                            </span>
                            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 tabular-nums">
                              {formatNumber(slot.count)} บิล
                            </span>
                          </div>
                          <div className="flex items-center gap-2 tabular-nums">
                            <span className="font-bold text-slate-900">
                              {formatBaht(slot.amount)}
                            </span>
                            <span
                              className={`text-xs font-bold min-w-[3.2rem] text-right ${
                                isBest ? 'text-emerald-700' : 'text-slate-500'
                              }`}
                            >
                              {slot.pct.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            style={{ width: `${barWidthPct}%` }}
                            className={`h-full rounded-full transition-all duration-300 ${
                              slot.amount > 0
                                ? isBest
                                  ? 'bg-emerald-500'
                                  : 'bg-sky-500'
                                : 'bg-transparent'
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Peak Hours Breakdown Card */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Clock className="h-5 w-5 text-indigo-600 shrink-0" aria-hidden="true" />
                  <h2>วิเคราะห์ชั่วโมงขายดี (Peak Hours Breakdown)</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {stats.peakHourByRevenue && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-700 tabular-nums">
                      ทำเงินสูงสุด: {stats.peakHourByRevenue.rangeLabel} ({formatBaht(stats.peakHourByRevenue.amount)})
                    </span>
                  )}
                  {stats.peakHourByBills && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-700 tabular-nums">
                      บิลหนาแน่นสุด: {stats.peakHourByBills.rangeLabel} ({formatNumber(stats.peakHourByBills.count)} บิล)
                    </span>
                  )}
                  <span className="text-xs text-slate-500 font-medium tabular-nums">
                    {periodDisplayLabel} · {formatNumber(stats.activeHourlyStats.length)} ชั่วโมงที่ขายจริง
                  </span>
                </div>
              </div>

              {stats.activeHourlyStats.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">
                  ยังไม่มีข้อมูลการขายรายชั่วโมงในช่วงเวลานี้
                </p>
              ) : (
                <div className="space-y-2.5 pt-1">
                  {stats.activeHourlyStats.map((h) => {
                    const isPeakRevenue = stats.peakHourByRevenue?.hour === h.hour;
                    const isPeakBills = stats.peakHourByBills?.hour === h.hour;
                    const barWidthPct =
                      stats.maxHourlyAmount > 0
                        ? Math.min(Math.max((h.amount / stats.maxHourlyAmount) * 100, 3), 100)
                        : 0;
                    return (
                      <div key={h.hour} className="space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`font-bold tabular-nums ${
                                isPeakRevenue ? 'text-emerald-700' : 'text-slate-800'
                              }`}
                            >
                              {h.rangeLabel}
                            </span>
                            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 tabular-nums">
                              {formatNumber(h.count)} บิล
                            </span>
                            <span className="text-[11px] text-slate-500 tabular-nums">
                              เฉลี่ย {formatBaht(h.avgTicket)}/บิล
                            </span>
                            {isPeakRevenue && (
                              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                                ยอดสูงสุด
                              </span>
                            )}
                            {isPeakBills && (
                              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                                บิลสูงสุด
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 tabular-nums">
                            <span className="font-bold text-slate-900">
                              {formatBaht(h.amount)}
                            </span>
                            <span
                              className={`text-xs font-bold min-w-[3.2rem] text-right ${
                                isPeakRevenue ? 'text-emerald-700' : 'text-slate-500'
                              }`}
                            >
                              {h.pct.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            style={{ width: `${barWidthPct}%` }}
                            className={`h-full rounded-full transition-all duration-300 ${
                              isPeakRevenue
                                ? 'bg-emerald-500'
                                : isPeakBills
                                  ? 'bg-amber-500'
                                  : 'bg-indigo-500'
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Promotional Items Performance Card */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Tag className="h-5 w-5 text-rose-600 shrink-0" aria-hidden="true" />
                  <h2>วิเคราะห์ยอดขายสินค้าติดป้ายโปรโมชั่น (Promotional Items Performance)</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-0.5 text-xs font-bold text-rose-700 tabular-nums">
                    ติดป้าย {formatNumber(stats.promoProductsStats.totalLabeledProducts)} รายการ
                  </span>
                  {stats.promoProductsStats.totalRevenue > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-700 tabular-nums">
                      สัดส่วน {stats.promoProductsStats.revenueSharePct.toFixed(1)}% ของยอดขาย
                    </span>
                  )}
                </div>
              </div>

              {stats.promoProductsStats.totalLabeledProducts === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center space-y-2">
                  <p className="text-sm font-medium text-slate-600">
                    ยังไม่มีสินค้าที่ติดป้ายโปรโมชั่น / ป้ายเชียร์ขาย
                  </p>
                  <p className="text-xs text-slate-500">
                    สามารถติดป้ายโปรโมชั่นได้จากหน้า{' '}
                    <Link href="/inventory" className="font-bold text-rose-600 hover:underline">
                      คลังสินค้า
                    </Link>{' '}
                    เพื่อติดตามยอดขาย จำนวนชิ้น และกำไรขั้นต้นของสินค้าจัดโปร
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3">
                      <div className="text-[11px] font-semibold text-rose-700">ยอดขายสินค้าโปรฯ</div>
                      <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
                        {formatBaht(stats.promoProductsStats.totalRevenue)}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {stats.promoProductsStats.revenueSharePct.toFixed(1)}% ของยอดขายรวม ·{' '}
                        {formatNumber(stats.promoProductsStats.totalBillsCount)} บิล
                      </div>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                      <div className="text-[11px] font-semibold text-amber-700">จำนวนที่ขายได้</div>
                      <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
                        {formatNumber(stats.promoProductsStats.totalQty)} ชิ้น
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        ขายออก {formatNumber(stats.promoProductsStats.soldPromoProductsCount)} /{' '}
                        {formatNumber(stats.promoProductsStats.totalLabeledProducts)} รายการที่ติดป้าย
                      </div>
                    </div>
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                      <div className="text-[11px] font-semibold text-emerald-700">
                        กำไรขั้นต้นสินค้าโปรฯ
                      </div>
                      <div className="text-lg font-extrabold text-emerald-700 tabular-nums mt-0.5">
                        {formatBaht(stats.promoProductsStats.totalProfit)}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        GP {stats.promoProductsStats.grossMarginPct.toFixed(1)}% · คิดเป็น{' '}
                        {stats.promoProductsStats.profitSharePct.toFixed(1)}% ของกำไรรวม
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                      <div className="text-[11px] font-semibold text-slate-600">
                        ป้ายโปรฯ ที่ทำเงินสูงสุด
                      </div>
                      <div className="text-sm font-extrabold text-slate-900 truncate mt-1">
                        {stats.promoProductsStats.byLabel[0]?.revenue > 0
                          ? stats.promoProductsStats.byLabel[0].label
                          : 'ยังไม่มียอดขาย'}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {stats.promoProductsStats.byLabel[0]?.revenue > 0
                          ? `${formatBaht(stats.promoProductsStats.byLabel[0].revenue)} (${formatNumber(stats.promoProductsStats.byLabel[0].qty)} ชิ้น)`
                          : `${formatNumber(stats.promoProductsStats.byLabel.length)} รูปแบบป้าย`}
                      </div>
                    </div>
                  </div>

                  {stats.promoProductsStats.byLabel.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {stats.promoProductsStats.byLabel.map((grp) => (
                        <div
                          key={grp.label}
                          className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-1.5 text-xs"
                        >
                          <span className="font-bold text-rose-800">{grp.label}</span>
                          <span className="text-slate-500 tabular-nums">
                            ({formatNumber(grp.labeledCount)} สินค้า)
                          </span>
                          <span className="font-bold text-slate-900 tabular-nums">
                            {formatBaht(grp.revenue)}
                          </span>
                          <span className="text-emerald-700 font-semibold tabular-nums">
                            กำไร {formatBaht(grp.profit)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {stats.promoProductsStats.items.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">
                      ยังไม่มีบิลขายสินค้าที่ติดป้ายโปรโมชั่นในช่วงเวลานี้
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs sm:text-sm tabular-nums">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-2 pr-3 font-bold">สินค้า</th>
                            <th className="py-2 px-2 font-bold">ป้ายโปรโมชั่น</th>
                            <th className="py-2 px-2 text-right font-bold">จำนวนขาย</th>
                            <th className="py-2 px-2 text-right font-bold">ยอดขาย</th>
                            <th className="py-2 px-2 text-right font-bold">กำไรขั้นต้น</th>
                            <th className="py-2 pl-2 text-right font-bold">GP%</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {stats.promoProductsStats.items.slice(0, 10).map((row) => (
                            <tr key={row.productId} className="hover:bg-slate-50/70">
                              <td className="py-2 pr-3 font-semibold text-slate-900">
                                <div>{row.name}</div>
                                <div className="text-[11px] font-normal text-slate-500">
                                  {formatNumber(row.billCount)} บิล
                                </div>
                              </td>
                              <td className="py-2 px-2">
                                <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-bold text-orange-800 whitespace-nowrap">
                                  {row.promoLabel}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-right text-slate-700">
                                {formatNumber(row.qty)} {row.baseUnit}
                              </td>
                              <td className="py-2 px-2 text-right font-bold text-slate-900">
                                {formatBaht(row.revenue)}
                              </td>
                              <td
                                className={`py-2 px-2 text-right font-bold ${
                                  row.profit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                                }`}
                              >
                                {formatBaht(row.profit)}
                              </td>
                              <td className="py-2 pl-2 text-right text-slate-600">
                                {row.marginPct.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Customer Segment Analysis Card */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Users className="h-5 w-5 text-indigo-600 shrink-0" aria-hidden="true" />
                  <h2>วิเคราะห์ยอดขายและหนี้ค้างตามกลุ่มลูกค้า (Customer Segment Analysis)</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 text-xs font-bold text-indigo-700 tabular-nums">
                    จัดกลุ่มแล้ว {formatNumber(stats.customerSegmentStats.totalTaggedCustomers)} /{' '}
                    {formatNumber(stats.customerSegmentStats.totalCustomersCount)} ราย (
                    {formatNumber(stats.customerSegmentStats.totalSegmentsCount)} กลุ่ม)
                  </span>
                  {stats.customerSegmentStats.totalTaggedSales > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-700 tabular-nums">
                      สัดส่วน {stats.customerSegmentStats.taggedSalesSharePct.toFixed(1)}% ของยอดขาย
                    </span>
                  )}
                </div>
              </div>

              {stats.customerSegmentStats.totalCustomersCount === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center space-y-2">
                  <p className="text-sm font-medium text-slate-600">
                    ยังไม่มีข้อมูลลูกค้าสมาชิกในระบบ
                  </p>
                  <p className="text-xs text-slate-500">
                    สามารถเพิ่มรายชื่อและจัดกลุ่มประเภทลูกค้าได้ที่หน้า{' '}
                    <Link href="/customers" className="font-bold text-indigo-600 hover:underline">
                      ลูกค้า &amp; ลูกหนี้
                    </Link>
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
                      <div className="text-[11px] font-semibold text-indigo-700">
                        ยอดขายลูกค้าที่จัดกลุ่ม
                      </div>
                      <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
                        {formatBaht(stats.customerSegmentStats.totalTaggedSales)}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {stats.customerSegmentStats.taggedSalesSharePct.toFixed(1)}% ของยอดขายรวม ·{' '}
                        {formatNumber(stats.customerSegmentStats.totalTaggedBills)} บิล
                      </div>
                    </div>
                    <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-3">
                      <div className="text-[11px] font-semibold text-sky-700">
                        ลูกค้าที่ติดป้ายกลุ่ม
                      </div>
                      <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-0.5">
                        {formatNumber(stats.customerSegmentStats.totalTaggedCustomers)} ราย
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        จากทั้งหมด {formatNumber(stats.customerSegmentStats.totalCustomersCount)}{' '}
                        ราย ({formatNumber(stats.customerSegmentStats.totalSegmentsCount)} กลุ่ม)
                      </div>
                    </div>
                    <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3">
                      <div className="text-[11px] font-semibold text-rose-700">
                        หนี้ค้างชำระกลุ่มที่จัดป้าย
                      </div>
                      <div className="text-lg font-extrabold text-rose-700 tabular-nums mt-0.5">
                        {formatBaht(stats.customerSegmentStats.totalTaggedDebt)}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        หนี้รวมทุกลูกค้า {formatBaht(stats.customerSegmentStats.totalCustomerDebt)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                      <div className="text-[11px] font-semibold text-slate-600">
                        กลุ่มที่ทำยอดขายสูงสุด
                      </div>
                      <div className="text-sm font-extrabold text-slate-900 truncate mt-1">
                        {stats.customerSegmentStats.segments.find(
                          (s) => !s.isUntagged && s.totalSales > 0
                        )?.label ?? 'ยังไม่มียอดขายในกลุ่ม'}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {(() => {
                          const topSeg = stats.customerSegmentStats.segments.find(
                            (s) => !s.isUntagged && s.totalSales > 0
                          );
                          return topSeg
                            ? `${formatBaht(topSeg.totalSales)} (${formatNumber(topSeg.billCount)} บิล)`
                            : 'ติดป้ายกลุ่มลูกค้าได้ที่หน้าลูกค้า';
                        })()}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2 pr-3 font-bold">กลุ่มลูกค้า</th>
                          <th className="py-2 px-2 text-right font-bold">ลูกค้า</th>
                          <th className="py-2 px-2 text-right font-bold">จำนวนบิล</th>
                          <th className="py-2 px-2 text-right font-bold">ยอดขายรวม</th>
                          <th className="py-2 px-2 text-right font-bold">เฉลี่ย/บิล</th>
                          <th className="py-2 pl-2 text-right font-bold">หนี้ค้างชำระรวม</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {stats.customerSegmentStats.segments.map((seg) => (
                          <tr key={seg.label} className="hover:bg-slate-50/70">
                            <td className="py-2 pr-3 font-semibold text-slate-900">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${
                                    seg.isUntagged
                                      ? 'border-slate-200 bg-slate-100 text-slate-600'
                                      : 'border-indigo-200 bg-indigo-50 text-indigo-700'
                                  }`}
                                >
                                  {seg.label}
                                </span>
                                {seg.salesSharePct > 0 && (
                                  <span className="text-[11px] font-normal text-slate-500">
                                    {seg.salesSharePct.toFixed(1)}%
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-2 text-right text-slate-700">
                              <div>{formatNumber(seg.customerCount)} ราย</div>
                              {seg.debtorCount > 0 && (
                                <div className="text-[11px] text-rose-600">
                                  ค้าง {formatNumber(seg.debtorCount)} ราย
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-2 text-right text-slate-700">
                              {formatNumber(seg.billCount)} บิล
                            </td>
                            <td className="py-2 px-2 text-right font-bold text-slate-900">
                              <div>{formatBaht(seg.totalSales)}</div>
                              {seg.creditSales > 0 && (
                                <div className="text-[11px] font-normal text-amber-700">
                                  เชื่อ {formatBaht(seg.creditSales)}
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-2 text-right text-slate-600">
                              {seg.billCount > 0 ? formatBaht(seg.aov) : '-'}
                            </td>
                            <td
                              className={`py-2 pl-2 text-right font-bold ${
                                seg.totalDebt > 0 ? 'text-rose-600' : 'text-slate-500'
                              }`}
                            >
                              {formatBaht(seg.totalDebt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            {/* Order Value Distribution / Ticket Size Tiers Card */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Receipt className="h-5 w-5 text-emerald-600 shrink-0" aria-hidden="true" />
                  <h2>วิเคราะห์การกระจายตัวของขนาดบิล (Order Value Distribution)</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {stats.topTicketTierByCount && stats.topTicketTierByCount.count > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-700 tabular-nums">
                      พบบ่อยสุด: {stats.topTicketTierByCount.label} ({stats.topTicketTierByCount.billPct.toFixed(1)}%)
                    </span>
                  )}
                  {stats.topTicketTierByRevenue && stats.topTicketTierByRevenue.revenue > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 px-2.5 py-0.5 text-xs font-bold text-sky-700 tabular-nums">
                      ทำเงินสูงสุด: {stats.topTicketTierByRevenue.shortLabel} ({stats.topTicketTierByRevenue.revenuePct.toFixed(1)}%)
                    </span>
                  )}
                  <span className="text-xs text-slate-500 font-medium tabular-nums">
                    {periodDisplayLabel} · {formatNumber(stats.completedBillsCount)} บิลสำเร็จ
                  </span>
                </div>
              </div>

              {stats.completedBillsCount === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">
                  ยังไม่มีบิลที่ขายสำเร็จในช่วงเวลานี้
                </p>
              ) : (
                <>
                  {/* Stacked Bar by Bill Count Share */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                      <span className="font-semibold text-slate-700">สัดส่วนจำนวนบิลตามช่วงยอดซื้อ</span>
                      <span>
                        รวม {formatNumber(stats.completedBillsCount)} บิล · {formatBaht(stats.completedBillsRevenue)}
                      </span>
                    </div>
                    <div className="h-3.5 w-full rounded-full bg-slate-100 overflow-hidden flex border border-slate-200/70">
                      {stats.ticketSizeDistribution.map((tier) =>
                        tier.billPct > 0 ? (
                          <div
                            key={tier.key}
                            style={{ width: `${tier.billPct}%` }}
                            className={`${tier.barClass} h-full transition-all duration-300`}
                            title={`${tier.label}: ${formatNumber(tier.count)} บิล (${tier.billPct.toFixed(1)}%) · ยอดขาย ${formatBaht(tier.revenue)} (${tier.revenuePct.toFixed(1)}%)`}
                          />
                        ) : null
                      )}
                    </div>
                  </div>

                  {/* 4 Tier Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
                    {stats.ticketSizeDistribution.map((tier) => {
                      const isTopCount =
                        stats.topTicketTierByCount?.key === tier.key && tier.count > 0;
                      const barWidthPct = Math.min(
                        Math.max(tier.billPct, tier.count > 0 ? 4 : 0),
                        100
                      );
                      return (
                        <div
                          key={tier.key}
                          className={`rounded-xl border p-3 space-y-2 ${
                            isTopCount
                              ? 'border-emerald-200 bg-emerald-50/40'
                              : 'border-slate-200 bg-slate-50/50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800">
                              <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${tier.dotClass}`} />
                              <span>{tier.label}</span>
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-bold shrink-0 ${tier.badgeClass}`}
                            >
                              {tier.billPct.toFixed(1)}%
                            </span>
                          </div>

                          <div className="flex items-baseline justify-between gap-2">
                            <div>
                              <p className="text-lg font-extrabold text-slate-900 leading-tight">
                                {formatNumber(tier.count)}{' '}
                                <span className="text-xs font-semibold text-slate-500">บิล</span>
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-extrabold text-emerald-700 leading-tight">
                                {formatBaht(tier.revenue)}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {tier.revenuePct.toFixed(1)}% ของยอดขาย
                              </p>
                            </div>
                          </div>

                          <div className="h-1.5 w-full rounded-full bg-slate-200/80 overflow-hidden">
                            <div
                              style={{ width: `${barWidthPct}%` }}
                              className={`h-full rounded-full transition-all duration-300 ${tier.barClass}`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Sales by Category Card */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Layers className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                  <h2>สรุปยอดขาย กำไรขั้นต้น และ % Margin แยกตามหมวดหมู่สินค้า</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500 font-medium">
                    {periodDisplayLabel} · {stats.categoryStats.length} หมวดหมู่
                  </span>
                  <div className="inline-flex rounded-xl bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setCategorySortBy('revenue')}
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                        categorySortBy === 'revenue'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      ยอดขาย
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategorySortBy('profit')}
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                        categorySortBy === 'profit'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      กำไรขั้นต้น
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategorySortBy('marginPct')}
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                        categorySortBy === 'marginPct'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      % Margin
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportCategoryCSV}
                    disabled={stats.categoryStats.length === 0}
                    title="ส่งออกสรุปยอดขายแยกตามหมวดหมู่เป็น CSV"
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>CSV</span>
                  </button>
                </div>
              </div>

              {stats.categoryStats.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">
                  ยังไม่มีข้อมูลยอดขายแยกตามหมวดหมู่ในช่วงเวลานี้
                </p>
              ) : (
                <>
                  {/* Category Totals Summary Strip */}
                  <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs tabular-nums">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="text-slate-600">
                        ยอดขายรายหมวด:{' '}
                        <strong className="text-slate-900">{formatBaht(stats.totalCategoryRevenue)}</strong>
                      </span>
                      <span className="text-slate-600">
                        ต้นทุนรวม:{' '}
                        <strong className="text-slate-800">{formatBaht(stats.totalCategoryCost)}</strong>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span
                        className={`font-bold ${
                          stats.totalCategoryProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        กำไรขั้นต้นรวม:{' '}
                        {stats.totalCategoryProfit > 0
                          ? `+${formatBaht(stats.totalCategoryProfit)}`
                          : formatBaht(stats.totalCategoryProfit)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          stats.categoryGrossMarginPct >= 0
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        Margin เฉลี่ย {stats.categoryGrossMarginPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Stacked Category Proportion Bar */}
                  <div className="h-3.5 w-full rounded-full bg-slate-100 overflow-hidden flex border border-slate-200/70">
                    {stats.categoryStats.map((cat) =>
                      cat.pct > 0 ? (
                        <div
                          key={cat.key}
                          style={{ width: `${cat.pct}%`, backgroundColor: cat.color }}
                          className="h-full transition-all duration-300"
                          title={`${cat.name}: ${formatBaht(cat.revenue)} (${cat.pct.toFixed(1)}%) · กำไร ${formatBaht(cat.profit)} (${cat.marginPct.toFixed(1)}%)`}
                        />
                      ) : null
                    )}
                  </div>

                  {/* Category Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {sortedCategoryStats.map((cat) => (
                      <div
                        key={cat.key}
                        className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-3 w-3 rounded-full shrink-0"
                              style={{ backgroundColor: cat.color }}
                            />
                            <span className="font-bold text-sm text-slate-900 truncate">
                              {cat.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`rounded-md border px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                                cat.marginPct >= 0
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-rose-200 bg-rose-50 text-rose-700'
                              }`}
                            >
                              Margin {cat.marginPct.toFixed(1)}%
                            </span>
                            <span className="rounded-md bg-white border border-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-700 tabular-nums">
                              {cat.pct.toFixed(1)}%
                            </span>
                          </div>
                        </div>

                        <div className="h-1.5 w-full rounded-full bg-slate-200/70 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{ width: `${cat.pct}%`, backgroundColor: cat.color }}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-1.5 border-t border-slate-200/60 text-xs tabular-nums">
                          <div>
                            <span className="text-slate-500 block text-[11px]">
                              ยอดขาย ({cat.itemCount} รายการ)
                            </span>
                            <span className="font-extrabold text-slate-900 text-sm">
                              {formatBaht(cat.revenue)}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-slate-500 block text-[11px]">
                              ต้นทุนรวม
                            </span>
                            <span className="font-bold text-slate-700 text-sm">
                              {formatBaht(cat.cost)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[11px]">
                              กำไรขั้นต้น
                            </span>
                            <span
                              className={`font-extrabold text-sm ${
                                cat.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'
                              }`}
                            >
                              {cat.profit > 0 ? `+${formatBaht(cat.profit)}` : formatBaht(cat.profit)}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-slate-500 block text-[11px]">
                              อัตรากำไรขั้นต้น (% Margin)
                            </span>
                            <span
                              className={`font-extrabold text-sm ${
                                cat.marginPct >= 0 ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {cat.marginPct.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Sales & Profit by Supplier / Wholesaler Card */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Truck className="h-5 w-5 text-sky-600 shrink-0" aria-hidden="true" />
                  <h2>วิเคราะห์ยอดขายและกำไรตามร้านค้าส่ง / ซัพพลายเออร์</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500 font-medium">
                    {periodDisplayLabel} ·{' '}
                    {stats.assignedSupplierCount > 0
                      ? `${stats.assignedSupplierCount} ซัพพลายเออร์`
                      : 'ยังไม่ระบุซัพพลายเออร์'}
                  </span>
                  <div className="inline-flex rounded-xl bg-slate-100 p-1">
                    {(
                      [
                        { key: 'revenue', label: 'ยอดขาย' },
                        { key: 'profit', label: 'กำไรขั้นต้น' },
                        { key: 'marginPct', label: '% Margin' },
                        { key: 'qty', label: 'จำนวนชิ้น' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setSupplierSortBy(opt.key)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                          supplierSortBy === opt.key
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleExportSupplierCSV}
                    disabled={sortedSupplierStats.length === 0}
                    title="ส่งออกวิเคราะห์ยอดขายตามร้านค้าส่ง / ซัพพลายเออร์เป็น CSV"
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>CSV</span>
                  </button>
                </div>
              </div>

              {stats.supplierStats.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">
                  ยังไม่มีข้อมูลยอดขายแยกตามร้านค้าส่ง / ซัพพลายเออร์ในช่วงเวลานี้
                </p>
              ) : (
                <>
                  {stats.assignedSupplierCount === 0 && (
                    <div className="rounded-xl border border-sky-200 bg-sky-50/70 px-3.5 py-2 text-xs text-sky-900">
                      ยังไม่มีสินค้าที่ผูกชื่อซัพพลายเออร์ในรายการขายช่วงเวลานี้ — สามารถระบุชื่อร้านค้าส่ง / ซัพพลายเออร์ให้สินค้าได้ที่หน้าคลังสินค้าเพื่อดูการเปรียบเทียบแต่ละร้านค้าส่ง
                    </div>
                  )}

                  {/* Supplier Totals Summary Strip */}
                  <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs tabular-nums">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="text-slate-600">
                        ยอดขายรวม:{' '}
                        <strong className="text-slate-900">{formatBaht(stats.totalSupplierRevenue)}</strong>
                      </span>
                      <span className="text-slate-600">
                        ต้นทุนรวม:{' '}
                        <strong className="text-slate-800">{formatBaht(stats.totalSupplierCost)}</strong>
                      </span>
                      <span className="text-slate-600">
                        ขายได้รวม:{' '}
                        <strong className="text-slate-900">{formatNumber(stats.totalSupplierQty)} ชิ้น</strong>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span
                        className={`font-bold ${
                          stats.totalSupplierProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        กำไรขั้นต้นรวม:{' '}
                        {stats.totalSupplierProfit > 0
                          ? `+${formatBaht(stats.totalSupplierProfit)}`
                          : formatBaht(stats.totalSupplierProfit)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          stats.supplierGrossMarginPct >= 0
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        Margin เฉลี่ย {stats.supplierGrossMarginPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Stacked Supplier Proportion Bar */}
                  <div className="h-3.5 w-full rounded-full bg-slate-100 overflow-hidden flex border border-slate-200/70">
                    {stats.supplierStats.map((sup) =>
                      sup.pct > 0 ? (
                        <div
                          key={sup.key}
                          style={{ width: `${sup.pct}%`, backgroundColor: sup.color }}
                          className="h-full transition-all duration-300"
                          title={`${sup.name}: ${formatBaht(sup.revenue)} (${sup.pct.toFixed(1)}%) · ขายได้ ${formatNumber(sup.qty)} ชิ้น · กำไร ${formatBaht(sup.profit)} (${sup.marginPct.toFixed(1)}%)`}
                        />
                      ) : null
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-bold text-slate-500 bg-slate-50/80">
                          <th className="py-2.5 px-3 text-left whitespace-nowrap rounded-tl-lg w-10">
                            #
                          </th>
                          <th className="py-2.5 px-3 text-left whitespace-nowrap">
                            ร้านค้าส่ง / ซัพพลายเออร์
                          </th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">จำนวนชิ้นที่ขาย</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">ยอดขาย</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">ต้นทุน</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">กำไรขั้นต้น</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap rounded-tr-lg">
                            % Margin
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {sortedSupplierStats.map((sup, i) => (
                          <tr key={sup.key} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-2.5 px-3">
                              <span
                                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                                  i === 0 && sup.isAssigned
                                    ? 'bg-sky-100 text-sky-800'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {i + 1}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 min-w-[200px]">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="h-2.5 w-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: sup.color }}
                                  />
                                  <span
                                    className={`font-semibold truncate ${
                                      sup.isAssigned ? 'text-slate-900' : 'text-slate-500 italic'
                                    }`}
                                  >
                                    {sup.name}
                                  </span>
                                </div>
                                <span className="text-[11px] font-semibold text-slate-500 shrink-0">
                                  {sup.pct.toFixed(1)}%
                                </span>
                              </div>
                              <div className="mt-1 flex items-center gap-2">
                                <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                                  <div
                                    style={{ width: `${sup.pct}%`, backgroundColor: sup.color }}
                                    className="h-full rounded-full transition-all duration-300"
                                  />
                                </div>
                                <span className="text-[11px] text-slate-500 shrink-0">
                                  {formatNumber(sup.productCount)} สินค้า · {formatNumber(sup.itemCount)} รายการ
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap font-semibold text-slate-700">
                              {formatNumber(sup.qty)} ชิ้น
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap font-extrabold text-slate-900">
                              {formatBaht(sup.revenue)}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap font-semibold text-slate-700">
                              {formatBaht(sup.cost)}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right whitespace-nowrap font-extrabold ${
                                sup.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'
                              }`}
                            >
                              {sup.profit > 0 ? `+${formatBaht(sup.profit)}` : formatBaht(sup.profit)}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <span
                                className={`inline-block rounded-md border px-1.5 py-0.5 text-xs font-bold ${
                                  sup.marginPct >= 0
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-rose-200 bg-rose-50 text-rose-700'
                                }`}
                              >
                                {sup.marginPct.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-extrabold text-slate-900 tabular-nums">
                          <td className="py-2.5 px-3" colSpan={2}>
                            รวมทั้งหมด ({sortedSupplierStats.length} กลุ่ม)
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {formatNumber(stats.totalSupplierQty)} ชิ้น
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {formatBaht(stats.totalSupplierRevenue)}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap text-slate-700">
                            {formatBaht(stats.totalSupplierCost)}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right whitespace-nowrap ${
                              stats.totalSupplierProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {stats.totalSupplierProfit > 0
                              ? `+${formatBaht(stats.totalSupplierProfit)}`
                              : formatBaht(stats.totalSupplierProfit)}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {stats.supplierGrossMarginPct.toFixed(1)}%
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white border border-slate-200 px-4 py-3 shadow-xs">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <Layers className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>กรองอันดับสินค้าขายดี / กำไรสูงสุดตามหมวดหมู่:</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="กรองอันดับสินค้าตามหมวดหมู่"
                  value={topProductsCategoryFilter}
                  onChange={(e) => setTopProductsCategoryFilter(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                >
                  <option value="all">ทุกหมวดหมู่</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                  <option value="__uncategorized__">ไม่ระบุหมวดหมู่</option>
                </select>
                {topProductsCategoryFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setTopProductsCategoryFilter('all')}
                    className="rounded-xl border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 transition-colors"
                  >
                    แสดงทุกหมวดหมู่
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top Selling Products */}
              <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <Award className="h-5 w-5 text-emerald-600" />
                    <h2>
                      สินค้าขายดี {topLimit} อันดับ ({topSortBy === 'revenue' ? 'ยอดขายสูงสุด' : 'กำไรสูงสุด'})
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-xl bg-slate-100 p-1">
                      <button
                        type="button"
                        onClick={() => setTopLimit(5)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                          topLimit === 5
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        5 อันดับ
                      </button>
                      <button
                        type="button"
                        onClick={() => setTopLimit(10)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                          topLimit === 10
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        10 อันดับ
                      </button>
                    </div>
                    <div className="inline-flex rounded-xl bg-slate-100 p-1">
                      <button
                        type="button"
                        onClick={() => setTopSortBy('revenue')}
                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                          topSortBy === 'revenue'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        เรียงตามยอดขาย
                      </button>
                      <button
                        type="button"
                        onClick={() => setTopSortBy('profit')}
                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                          topSortBy === 'profit'
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        เรียงตามกำไร
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleExportTopProductsCSV}
                      disabled={stats.allProductStats.length === 0}
                      title="ส่งออกสินค้าขายดีและกำไรเป็น CSV"
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>CSV</span>
                    </button>
                  </div>
                </div>
                {(topSortBy === 'revenue' ? stats.topProductsByRevenue : stats.topProductsByProfit)
                  .length === 0 ? (
                  <p className="text-sm text-slate-500 py-6 text-center">ยังไม่มีข้อมูลการขาย</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {(topSortBy === 'revenue'
                      ? stats.topProductsByRevenue
                      : stats.topProductsByProfit
                    )
                      .slice(0, topLimit)
                      .map((item, i) => (
                      <div
                        key={item.name}
                        className="py-2.5 flex items-center justify-between gap-2 text-sm"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              topSortBy === 'profit'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-emerald-50 text-emerald-700'
                            }`}
                          >
                            {i + 1}
                          </span>
                          <div className="min-w-0">
                            <span className="font-semibold text-slate-800 block truncate">
                              {item.name}
                            </span>
                            <span className="text-xs text-slate-500">
                              ขายได้ {formatNumber(item.qty)} หน่วย
                            </span>
                          </div>
                        </div>
                        <div className="text-right tabular-nums shrink-0">
                          {topSortBy === 'revenue' ? (
                            <>
                              <span className="font-bold text-slate-900 block">
                                ยอดขาย {formatBaht(item.revenue)}
                              </span>
                              <span
                                className={`block text-xs font-semibold ${
                                  item.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'
                                }`}
                              >
                                กำไร {item.profit > 0 ? `+${formatBaht(item.profit)}` : formatBaht(item.profit)}
                              </span>
                            </>
                          ) : (
                            <>
                              <span
                                className={`font-extrabold block ${
                                  item.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'
                                }`}
                              >
                                กำไร {item.profit > 0 ? `+${formatBaht(item.profit)}` : formatBaht(item.profit)}
                              </span>
                              <span className="block text-xs text-slate-500">
                                ยอดขาย {formatBaht(item.revenue)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Top 5 Most Profitable Products */}
              <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <TrendingUp className="h-5 w-5 text-emerald-600" />
                    <h2>Top 5 สินค้าทำกำไรสูงสุด</h2>
                  </div>
                  <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                    กำไรสุทธิ (ขาย - ทุน)
                  </span>
                </div>
                {stats.topProductsByProfit.length === 0 ? (
                  <p className="text-sm text-slate-500 py-6 text-center">ยังไม่มีข้อมูลการขาย</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {stats.topProductsByProfit.slice(0, 5).map((item, i) => (
                      <div
                        key={item.name}
                        className="py-2.5 flex items-center justify-between gap-2 text-sm"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">
                            {i + 1}
                          </span>
                          <div className="min-w-0">
                            <span className="font-semibold text-slate-800 block truncate">
                              {item.name}
                            </span>
                            <span className="text-xs text-slate-500 tabular-nums">
                              ขายได้ {formatNumber(item.qty)} หน่วย · ยอดขาย{' '}
                              {formatBaht(item.revenue)}
                            </span>
                          </div>
                        </div>
                        <div className="text-right tabular-nums shrink-0">
                          <span
                            className={`font-extrabold block ${
                              item.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            {item.profit > 0
                              ? `+${formatBaht(item.profit)}`
                              : formatBaht(item.profit)}
                          </span>
                          <span className="block text-[11px] text-slate-500">กำไรสุทธิ</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Frequently Bought Together / Market Basket Pairs (Top 5) */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <ShoppingBag className="h-5 w-5 text-violet-600 shrink-0" aria-hidden="true" />
                    <h2>คู่สินค้ายอดฮิตที่ลูกค้ามักซื้อพร้อมกัน (Market Basket Pairs)</h2>
                  </div>
                  <p className="text-xs text-slate-500">
                    Top 5 คู่สินค้าจากบิลที่มีสินค้าตั้งแต่ 2 ชนิดขึ้นไป เพื่อช่วยจัดวางสินค้าคู่กันหรือนำไปตั้งชุดขายด่วนในหน้า POS
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {stats.multiItemBillsCount > 0 && (
                    <span className="rounded-full bg-violet-50 border border-violet-200 px-2.5 py-0.5 text-xs font-bold text-violet-700 tabular-nums">
                      {formatNumber(stats.multiItemBillsCount)} / {formatNumber(stats.totalBasketBills)} บิลที่มี ≥ 2 สินค้า ({stats.multiItemBillsPct.toFixed(1)}%)
                    </span>
                  )}
                  <Link
                    href="/pos"
                    className="inline-flex items-center gap-1 rounded-xl border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100 transition-colors shrink-0"
                  >
                    <span>ตั้งชุดขายด่วนใน POS</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </div>

              {stats.topBasketPairs.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">
                  {stats.totalBasketBills === 0
                    ? 'ยังไม่มีข้อมูลการขายในช่วงเวลานี้'
                    : `ยังไม่มีบิลที่มีสินค้าตั้งแต่ 2 ชนิดขึ้นไปในช่วงเวลานี้ (มีทั้งหมด ${formatNumber(stats.totalBasketBills)} บิล)`}
                </p>
              ) : (
                <>
                  <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs tabular-nums">
                    <span className="text-slate-600">
                      วิเคราะห์จากบิลที่มี ≥ 2 สินค้า:{' '}
                      <strong className="text-slate-900">
                        {formatNumber(stats.multiItemBillsCount)} บิล
                      </strong>{' '}
                      (จากทั้งหมด {formatNumber(stats.totalBasketBills)} บิล ·{' '}
                      {stats.multiItemBillsPct.toFixed(1)}%)
                    </span>
                    <span className="text-slate-600">
                      พบคู่สินค้าที่ซื้อร่วมกันทั้งหมด{' '}
                      <strong className="text-violet-700">
                        {formatNumber(stats.totalUniqueBasketPairs)} คู่
                      </strong>{' '}
                      (แสดง Top 5)
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {stats.topBasketPairs.map((pair, idx) => {
                      const maxPairCount = stats.topBasketPairs[0]?.billCount ?? 0;
                      const barPct =
                        maxPairCount > 0
                          ? Math.max((pair.billCount / maxPairCount) * 100, 8)
                          : 0;
                      return (
                        <div
                          key={pair.key}
                          className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-sm"
                        >
                          <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                                idx === 0
                                  ? 'bg-violet-100 text-violet-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {idx + 1}
                            </span>
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-bold text-slate-900 break-words">
                                  {pair.productA}
                                </span>
                                <span className="inline-flex items-center justify-center rounded-md bg-violet-50 border border-violet-200 px-1.5 py-0.5 text-[11px] font-extrabold text-violet-700">
                                  +
                                </span>
                                <span className="font-bold text-slate-900 break-words">
                                  {pair.productB}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 max-w-md">
                                <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                                  <div
                                    style={{ width: `${barPct}%` }}
                                    className={`h-full rounded-full transition-all duration-300 ${
                                      idx === 0 ? 'bg-violet-600' : 'bg-violet-400'
                                    }`}
                                  />
                                </div>
                                <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                                  {pair.pctOfMultiBills.toFixed(1)}% ของบิลหลายรายการ
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1 pl-8 sm:pl-0 shrink-0 tabular-nums">
                            <span className="font-extrabold text-slate-900">
                              ซื้อคู่กัน {formatNumber(pair.billCount)} บิล
                            </span>
                            <span className="rounded-full bg-violet-50 border border-violet-200 px-2 py-0.5 text-xs font-bold text-violet-700">
                              {pair.pctOfAllBills.toFixed(1)}% ของบิลทั้งหมด
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Member vs Walk-in Analysis */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Users className="h-5 w-5 text-indigo-600 shrink-0" />
                  <h2>เปรียบเทียบยอดขายลูกค้าประจำ vs ลูกค้าทั่วไป (Member vs Walk-in)</h2>
                </div>
                <span className="text-xs text-slate-500 font-medium tabular-nums">
                  {periodDisplayLabel} · บิลสำเร็จ {formatNumber(stats.memberVsWalkIn.totalBills)} บิล
                </span>
              </div>

              {stats.memberVsWalkIn.totalBills === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">
                  ยังไม่มีข้อมูลการขายที่สำเร็จในช่วงเวลานี้
                </p>
              ) : (
                <div className="space-y-3 tabular-nums">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-indigo-700">
                        ลูกค้าประจำ/สมาชิก {stats.memberVsWalkIn.member.salesPct.toFixed(1)}%
                      </span>
                      <span className="text-slate-600">
                        ลูกค้าทั่วไปหน้าร้าน {stats.memberVsWalkIn.walkIn.salesPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden flex">
                      <div
                        className="h-full bg-indigo-500 transition-all"
                        style={{ width: `${stats.memberVsWalkIn.member.salesPct}%` }}
                      />
                      <div
                        className="h-full bg-amber-400 transition-all"
                        style={{ width: `${stats.memberVsWalkIn.walkIn.salesPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-indigo-800">
                          ลูกค้าประจำ / สมาชิก (Member)
                        </span>
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                          {stats.memberVsWalkIn.member.salesPct.toFixed(1)}%
                        </span>
                      </div>
                      <p className="text-xl font-extrabold text-slate-900">
                        {formatBaht(stats.memberVsWalkIn.member.salesTotal)}
                      </p>
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-indigo-200/70 text-xs">
                        <div>
                          <p className="text-slate-500">จำนวนบิล</p>
                          <p className="font-bold text-slate-800">
                            {formatNumber(stats.memberVsWalkIn.member.billCount)} บิล{' '}
                            <span className="text-[11px] font-medium text-slate-500">
                              ({stats.memberVsWalkIn.member.billsPct.toFixed(1)}%)
                            </span>
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">ยอดเฉลี่ย/บิล (AOV)</p>
                          <p className="font-bold text-indigo-700">
                            {formatBaht(stats.memberVsWalkIn.member.aov)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-amber-800">
                          ลูกค้าทั่วไปหน้าร้าน (Walk-in)
                        </span>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                          {stats.memberVsWalkIn.walkIn.salesPct.toFixed(1)}%
                        </span>
                      </div>
                      <p className="text-xl font-extrabold text-slate-900">
                        {formatBaht(stats.memberVsWalkIn.walkIn.salesTotal)}
                      </p>
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-amber-200/70 text-xs">
                        <div>
                          <p className="text-slate-500">จำนวนบิล</p>
                          <p className="font-bold text-slate-800">
                            {formatNumber(stats.memberVsWalkIn.walkIn.billCount)} บิล{' '}
                            <span className="text-[11px] font-medium text-slate-500">
                              ({stats.memberVsWalkIn.walkIn.billsPct.toFixed(1)}%)
                            </span>
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">ยอดเฉลี่ย/บิล (AOV)</p>
                          <p className="font-bold text-amber-800">
                            {formatBaht(stats.memberVsWalkIn.walkIn.aov)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Customer Credits, Loyalty & Container Deposits Summary */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Wallet className="h-5 w-5 text-emerald-600 shrink-0" aria-hidden="true" />
                  <h2>สรุปบัญชีเงินฝากทอน แต้มสะสม และมัดจำภาชนะลูกค้า</h2>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600 tabular-nums">
                  ภาระสิทธิประโยชน์/มัดจำค้างคืนรวม {formatBaht(customerBenefitsSummary.totalLiabilityValue)}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 tabular-nums">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-emerald-800">
                      เงินฝากทอนสะสมลูกค้า (Store Credit)
                    </span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                      {formatNumber(customerBenefitsSummary.storeCreditCustomerCount)} ราย
                    </span>
                  </div>
                  <p className="text-xl font-extrabold text-slate-900">
                    {formatBaht(customerBenefitsSummary.storeCreditTotal)}
                  </p>
                  <p className="text-xs text-slate-500">
                    เครดิตเงินทอนคงเหลือที่ลูกค้าสามารถนำมาใช้ลดบิลหรือตัดหนี้ได้
                  </p>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-amber-800">
                      แต้มสะสมลูกค้า (Loyalty Points)
                    </span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                      {formatNumber(customerBenefitsSummary.loyaltyCustomerCount)} ราย
                    </span>
                  </div>
                  <p className="text-xl font-extrabold text-slate-900">
                    {formatNumber(customerBenefitsSummary.loyaltyPointsTotal)} แต้ม
                  </p>
                  <p className="text-xs text-amber-800 font-semibold">
                    มูลค่าส่วนลดเทียบเท่า {formatBaht(customerBenefitsSummary.loyaltyDiscountValue)}{' '}
                    <span className="font-normal text-slate-500">(10 แต้ม = ฿1)</span>
                  </p>
                </div>

                <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-sky-800">
                      มัดจำขวด/ถังค้างคืน (Container Deposits)
                    </span>
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800">
                      {formatNumber(customerBenefitsSummary.containerDepositCount)} รายการ
                    </span>
                  </div>
                  <p className="text-xl font-extrabold text-slate-900">
                    {formatBaht(customerBenefitsSummary.containerDepositTotal)}
                  </p>
                  <p className="text-xs text-slate-500">
                    ภาชนะค้างคืนทั้งหมด {formatNumber(customerBenefitsSummary.containerDepositQtyTotal)} ใบ/ถัง
                  </p>
                </div>
              </div>
            </div>

            {/* Single Unit (Retail) vs Multi-Pack Sales Mix */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Package className="h-5 w-5 text-emerald-600 shrink-0" />
                  <h2>เปรียบเทียบยอดขายปลีกชิ้นเดี่ยว vs ขายยกแพ็ค/ลัง (Retail vs Pack Mix)</h2>
                </div>
                <span className="text-xs text-slate-500 font-medium tabular-nums">
                  {periodDisplayLabel} · ทั้งหมด {formatNumber(stats.retailVsPackMix.totalItems)} รายการ
                </span>
              </div>

              {stats.retailVsPackMix.totalItems === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">
                  ยังไม่มีข้อมูลรายการสินค้าที่ขายสำเร็จในช่วงเวลานี้
                </p>
              ) : (
                <div className="space-y-3 tabular-nums">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-emerald-700">
                        ขายปลีกหน่วยย่อย {stats.retailVsPackMix.retail.salesPct.toFixed(1)}%
                      </span>
                      <span className="text-sky-700">
                        ขายยกแพ็ค/โหล/ลัง {stats.retailVsPackMix.pack.salesPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden flex">
                      <div
                        className="h-full bg-emerald-500 transition-all"
                        style={{ width: `${stats.retailVsPackMix.retail.salesPct}%` }}
                      />
                      <div
                        className="h-full bg-sky-500 transition-all"
                        style={{ width: `${stats.retailVsPackMix.pack.salesPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-emerald-800">
                          ขายปลีกหน่วยย่อย (ชิ้น/ขวด/ซอง)
                        </span>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                          {stats.retailVsPackMix.retail.salesPct.toFixed(1)}%
                        </span>
                      </div>
                      <p className="text-xl font-extrabold text-slate-900">
                        {formatBaht(stats.retailVsPackMix.retail.revenue)}
                      </p>
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-emerald-200/70 text-xs">
                        <div>
                          <p className="text-slate-500">จำนวนรายการ</p>
                          <p className="font-bold text-slate-800">
                            {formatNumber(stats.retailVsPackMix.retail.itemCount)} รายการ{' '}
                            <span className="text-[11px] font-medium text-slate-500">
                              ({stats.retailVsPackMix.retail.itemsPct.toFixed(1)}%)
                            </span>
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">กำไรขั้นต้น (Margin)</p>
                          <p className="font-bold text-emerald-700">
                            {formatBaht(stats.retailVsPackMix.retail.profit)}{' '}
                            <span className="text-[11px] font-medium text-slate-500">
                              ({stats.retailVsPackMix.retail.marginPct.toFixed(1)}%)
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-sky-800">
                          ขายยกแพ็ค / โหล / ลัง (Multi-Pack)
                        </span>
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800">
                          {stats.retailVsPackMix.pack.salesPct.toFixed(1)}%
                        </span>
                      </div>
                      <p className="text-xl font-extrabold text-slate-900">
                        {formatBaht(stats.retailVsPackMix.pack.revenue)}
                      </p>
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-sky-200/70 text-xs">
                        <div>
                          <p className="text-slate-500">จำนวนรายการ</p>
                          <p className="font-bold text-slate-800">
                            {formatNumber(stats.retailVsPackMix.pack.itemCount)} รายการ{' '}
                            <span className="text-[11px] font-medium text-slate-500">
                              ({stats.retailVsPackMix.pack.itemsPct.toFixed(1)}%)
                            </span>
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">กำไรขั้นต้น (Margin)</p>
                          <p className="font-bold text-sky-800">
                            {formatBaht(stats.retailVsPackMix.pack.profit)}{' '}
                            <span className="text-[11px] font-medium text-slate-500">
                              ({stats.retailVsPackMix.pack.marginPct.toFixed(1)}%)
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Top 5 Regular Customers by Spend */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Users className="h-5 w-5 text-emerald-600 shrink-0" />
                  <h2>Top 5 ลูกค้าประจำที่มียอดซื้อสูงสุด</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {stats.uniqueCustomerCount > 0 && (
                    <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-700 tabular-nums">
                      ลูกค้าประจำที่มีบิล {formatNumber(stats.uniqueCustomerCount)} ราย (
                      {stats.regularCustomerSharePct.toFixed(1)}% ของยอดขายรวม)
                    </span>
                  )}
                  <span className="text-xs text-slate-500 font-medium">
                    {periodDisplayLabel}
                  </span>
                </div>
              </div>

              {stats.topCustomers.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">
                  ยังไม่มีรายการขายที่ผูกชื่อลูกค้าประจำในช่วงเวลานี้
                </p>
              ) : (
                <>
                  <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs tabular-nums">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="text-slate-600">
                        ยอดซื้อจากลูกค้าประจำทั้งหมด:{' '}
                        <strong className="text-slate-900">
                          {formatBaht(stats.regularCustomerSalesTotal)}
                        </strong>{' '}
                        ({formatNumber(stats.regularCustomerBillCount)} บิล)
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-emerald-700 font-semibold">
                        สด/โอน: {formatBaht(stats.regularCustomerCashQrTotal)}
                      </span>
                      <span className="text-amber-700 font-semibold">
                        เงินเชื่อ: {formatBaht(stats.regularCustomerCreditTotal)}
                      </span>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-bold text-slate-500 bg-slate-50/80">
                          <th className="py-2.5 px-3 text-left whitespace-nowrap rounded-tl-lg w-12">
                            อันดับ
                          </th>
                          <th className="py-2.5 px-3 text-left whitespace-nowrap">ชื่อลูกค้า</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">จำนวนบิล</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">
                            ยอดซื้อสด/โอน
                          </th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">ยอดซื้อเชื่อ</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap rounded-tr-lg">
                            ยอดซื้อรวม
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {(() => {
                          const maxCustomerSpend = stats.topCustomers[0]?.totalSpend ?? 0;
                          return stats.topCustomers.map((cust, i) => {
                            const barPct =
                              maxCustomerSpend > 0
                                ? Math.max((cust.totalSpend / maxCustomerSpend) * 100, 6)
                                : 0;
                            const sharePct =
                              stats.totalSales > 0
                                ? (cust.totalSpend / stats.totalSales) * 100
                                : 0;
                            return (
                              <tr key={cust.id} className="hover:bg-slate-50/70 transition-colors">
                                <td className="py-2.5 px-3">
                                  <span
                                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                                      i === 0
                                        ? 'bg-amber-100 text-amber-800'
                                        : 'bg-emerald-50 text-emerald-700'
                                    }`}
                                  >
                                    {i + 1}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 min-w-[180px]">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-slate-800 truncate">
                                      {cust.name}
                                    </span>
                                    <span className="text-[11px] font-semibold text-slate-500 shrink-0">
                                      {sharePct.toFixed(1)}%
                                    </span>
                                  </div>
                                  <div className="mt-1 flex items-center gap-2">
                                    <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                                      <div
                                        style={{ width: `${barPct}%` }}
                                        className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                                      />
                                    </div>
                                    {cust.phone && (
                                      <span className="text-[11px] text-slate-500 shrink-0">
                                        {cust.phone}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-right whitespace-nowrap text-slate-700 font-semibold">
                                  {formatNumber(cust.billCount)} บิล
                                </td>
                                <td className="py-2.5 px-3 text-right whitespace-nowrap text-emerald-700 font-semibold">
                                  {formatBaht(cust.cashQrSpend)}
                                </td>
                                <td className="py-2.5 px-3 text-right whitespace-nowrap text-amber-700 font-semibold">
                                  {formatBaht(cust.creditSpend)}
                                </td>
                                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                  <span className="font-extrabold text-slate-900 block">
                                    {formatBaht(cust.totalSpend)}
                                  </span>
                                  <span className="text-[11px] text-slate-500 block">
                                    เฉลี่ย {formatBaht(cust.totalSpend / cust.billCount)}/บิล
                                  </span>
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Low Stock Alerts */}
              <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs">
                <div className="flex items-center gap-2 font-bold text-slate-900 mb-3">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  <h2>สินค้าใกล้หมดสต็อก ({lowStockProducts.length})</h2>
                </div>
                {lowStockProducts.length === 0 ? (
                  <p className="text-sm text-emerald-600 py-6 text-center font-medium">
                    สต็อกสินค้าทุกรายการยังเพียงพอ
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                    {lowStockProducts.map((p) => (
                      <div key={p.id} className="py-2.5 flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-800">{p.name}</span>
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 tabular-nums">
                          เหลือ {formatNumber(p.stock_qty)} {p.base_unit}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Non-Moving / Slow Stock Items */}
              <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <PackageX className="h-5 w-5 text-amber-600 shrink-0" />
                      <h2>สินค้าไม่มียอดขายในช่วงเวลานี้ (Non-Moving Items)</h2>
                    </div>
                    <p className="text-xs text-slate-500">
                      เรียงตามมูลค่าทุนจมมากไปน้อย (สูงสุด 10 อันดับแรก) เพื่อช่วยวางแผนระบายสต็อก · {periodDisplayLabel}
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-800 tabular-nums shrink-0">
                    {formatNumber(stats.zeroMovingProducts.length)} รายการ
                  </span>
                </div>

                {stats.zeroMovingProducts.length === 0 ? (
                  <p className="text-sm text-emerald-600 py-6 text-center font-medium">
                    ไม่มีสินค้าค้างสต็อก — สินค้าที่มีสต็อกทุกรายการมียอดขายในช่วงเวลาที่เลือก
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2.5 rounded-xl bg-slate-50 border border-slate-200/80 p-3 tabular-nums">
                      <div>
                        <span className="text-[11px] font-medium text-slate-500 block">
                          จำนวนสินค้าไม่เคลื่อนไหว
                        </span>
                        <span className="text-base font-extrabold text-slate-900">
                          {formatNumber(stats.zeroMovingProducts.length)} รายการ
                        </span>
                        <span className="block text-[11px] text-slate-500">
                          สต็อกค้างรวม {formatNumber(stats.totalZeroMovingUnits)} หน่วย
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[11px] font-medium text-slate-500 block">
                          มูลค่าทุนจมรวม (สต็อก × ทุน)
                        </span>
                        <span className="text-base font-extrabold text-rose-700">
                          {formatBaht(stats.totalZeroMovingCost)}
                        </span>
                        {stats.zeroMovingProducts.length > 10 && stats.totalZeroMovingCost > 0 && (
                          <span className="block text-[11px] text-slate-500">
                            10 อันดับแรกคิดเป็น{' '}
                            {((stats.topZeroMovingCost / stats.totalZeroMovingCost) * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto pr-1">
                      {(showAllNonMoving
                        ? stats.zeroMovingProducts
                        : stats.topZeroMovingProducts
                      ).map((p, idx) => {
                        const sharePct =
                          stats.totalZeroMovingCost > 0
                            ? (p.tiedUpCost / stats.totalZeroMovingCost) * 100
                            : 0;
                        return (
                          <div
                            key={p.id}
                            className="py-2.5 flex items-center justify-between gap-3 text-sm"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span
                                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                                  idx < 3
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {idx + 1}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="font-semibold text-slate-800 truncate">
                                    {p.name}
                                  </span>
                                  {p.categoryName && (
                                    <span className="hidden sm:inline-block shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                                      {p.categoryName}
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs text-slate-500 tabular-nums">
                                  คงเหลือ {formatNumber(p.stock_qty)} {p.base_unit} · ทุน/หน่วย{' '}
                                  {formatBaht(p.cost_price)}
                                </span>
                              </div>
                            </div>
                            <div className="text-right tabular-nums shrink-0">
                              <span className="font-bold text-slate-900 block">
                                {formatBaht(p.tiedUpCost)}
                              </span>
                              <span className="block text-[11px] text-slate-500">
                                ทุนจม ({sharePct.toFixed(1)}%)
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {stats.zeroMovingProducts.length > 10 && (
                      <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
                        <span className="text-slate-500 tabular-nums">
                          {showAllNonMoving
                            ? `แสดงทั้งหมด ${formatNumber(stats.zeroMovingProducts.length)} รายการ`
                            : `แสดง 10 อันดับแรก จากทั้งหมด ${formatNumber(stats.zeroMovingProducts.length)} รายการ`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowAllNonMoving((prev) => !prev)}
                          className="font-bold text-emerald-700 hover:underline"
                        >
                          {showAllNonMoving
                            ? 'ย่อเหลือ 10 อันดับแรก'
                            : `ดูทั้งหมด (${formatNumber(stats.zeroMovingProducts.length)})`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Inventory Capital Health Breakdown Card */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <Wallet className="h-5 w-5 text-emerald-600 shrink-0" aria-hidden="true" />
                    <h2>วิเคราะห์สุขภาพเงินทุนในสต็อก (Inventory Capital Health)</h2>
                  </div>
                  <p className="text-xs text-slate-500">
                    สัดส่วนเงินทุนจมในคลังสินค้า (คงเหลือ × ราคาทุน) เทียบระหว่างสินค้าเคลื่อนไหวมีขายกับสินค้าทุนจมและความเสี่ยงหมดอายุ · {periodDisplayLabel}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-xs font-bold text-slate-700 tabular-nums shrink-0">
                  {formatNumber(stats.totalInventoryCapitalCount)} รายการมีสต็อก
                </span>
              </div>

              {stats.totalInventoryCapitalCount === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">
                  ยังไม่มีสินค้าเปิดใช้งานที่มีสต็อกคงเหลือในคลัง
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 tabular-nums">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                      <span className="text-[11px] font-medium text-slate-500 block">
                        มูลค่าทุนสต็อกรวมทั้งร้าน
                      </span>
                      <span className="text-lg font-extrabold text-slate-900">
                        {formatBaht(stats.totalInventoryCapitalCost)}
                      </span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">
                        {formatNumber(stats.totalInventoryCapitalCount)} รายการ ·{' '}
                        {formatNumber(stats.totalInventoryCapitalUnits)} หน่วย
                      </span>
                    </div>

                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                      <span className="text-[11px] font-semibold text-emerald-800 block">
                        สินค้าเคลื่อนไหวมีขาย (Active Moving)
                      </span>
                      <span className="text-lg font-extrabold text-emerald-700">
                        {formatBaht(stats.activeMovingCost)}
                      </span>
                      <span className="block text-[11px] text-emerald-700/90 mt-0.5">
                        {stats.activeMovingSharePct.toFixed(1)}% ของทุน ·{' '}
                        {formatNumber(stats.activeMovingCount)} รายการ (
                        {formatNumber(stats.activeMovingUnits)} หน่วย)
                      </span>
                    </div>

                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                      <span className="text-[11px] font-semibold text-amber-800 block">
                        สินค้าไม่มียอดขาย / ทุนจม (Non-Moving)
                      </span>
                      <span className="text-lg font-extrabold text-amber-700">
                        {formatBaht(stats.totalZeroMovingCost)}
                      </span>
                      <span className="block text-[11px] text-amber-800/90 mt-0.5">
                        {stats.nonMovingSharePct.toFixed(1)}% ของทุน ·{' '}
                        {formatNumber(stats.zeroMovingProducts.length)} รายการ (
                        {formatNumber(stats.totalZeroMovingUnits)} หน่วย)
                      </span>
                    </div>

                    <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3">
                      <span className="text-[11px] font-semibold text-rose-800 block">
                        ทุนเสี่ยงใกล้หมดอายุ / หมดอายุแล้ว
                      </span>
                      <span className="text-lg font-extrabold text-rose-700">
                        {formatBaht(stats.atRiskExpiryCost)}
                      </span>
                      <span className="block text-[11px] text-rose-700/90 mt-0.5">
                        {stats.atRiskExpirySharePct.toFixed(1)}% ของทุน · หมดอายุ{' '}
                        {formatNumber(stats.expiredStockCount)} (
                        {formatBaht(stats.expiredStockCost)}) · ใกล้หมด{' '}
                        {formatNumber(stats.expiringSoonStockCount)} (
                        {formatBaht(stats.expiringSoonStockCost)})
                      </span>
                    </div>
                  </div>

                  {/* Stacked Capital Health Bar */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-600 tabular-nums">
                      <span className="font-semibold">
                        สัดส่วนเงินทุนหมุนเวียน vs ทุนจมในสต็อก
                      </span>
                      <span>
                        Active {stats.activeMovingSharePct.toFixed(1)}% · Non-Moving{' '}
                        {stats.nonMovingSharePct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden flex">
                      <div
                        className="h-full bg-emerald-500 transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, stats.activeMovingSharePct))}%` }}
                        title={`Active Moving: ${formatBaht(stats.activeMovingCost)}`}
                      />
                      <div
                        className="h-full bg-amber-400 transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, stats.nonMovingSharePct))}%` }}
                        title={`Non-Moving: ${formatBaht(stats.totalZeroMovingCost)}`}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Restock Budget Forecast Card (Critical vs Full Shelf Target) */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <Truck className="h-5 w-5 text-indigo-600 shrink-0" aria-hidden="true" />
                    <h2>ประมาณการงบสั่งซื้อเติมสต็อก (Restock Budget Forecast)</h2>
                  </div>
                  <p className="text-xs text-slate-500">
                    เปรียบเทียบงบสั่งซื้อเร่งด่วน (สินค้าหมด/ใกล้หมด) กับงบเติมเต็มเป้าชั้นวาง (จากราคาทุนปัจจุบัน)
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 text-xs font-bold text-indigo-700 tabular-nums">
                    ตั้งเป้าชั้นวางแล้ว {formatNumber(stats.targetConfiguredCount)} รายการ
                  </span>
                  <Link
                    href="/inventory"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <span>ไปคลังสินค้า</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </div>

              {stats.belowTargetRestockCount === 0 ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-center text-sm font-medium text-emerald-800">
                  สต็อกสินค้าทุกรายการอยู่ในเกณฑ์ปกติและครบตามเป้าชั้นวางแล้ว (งบสั่งซื้อ ฿0.00)
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 tabular-nums">
                    <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3">
                      <span className="text-[11px] font-semibold text-rose-800 block">
                        งบสั่งซื้อเร่งด่วน (ขั้นวิกฤต)
                      </span>
                      <span className="text-lg font-extrabold text-rose-700">
                        {formatBaht(stats.criticalRestockBudget)}
                      </span>
                      <span className="block text-[11px] text-rose-700/90 mt-0.5">
                        {formatNumber(stats.criticalRestockCount)} รายการ (หมดเกลี้ยง{' '}
                        {formatNumber(stats.criticalOutOfStockCount)}) ·{' '}
                        {formatNumber(stats.criticalRestockUnits)} หน่วย
                      </span>
                    </div>

                    <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3">
                      <span className="text-[11px] font-semibold text-indigo-800 block">
                        งบเติมเต็มเป้าชั้นวาง (รวมทั้งหมด)
                      </span>
                      <span className="text-lg font-extrabold text-indigo-700">
                        {formatBaht(stats.fullTargetRestockBudget)}
                      </span>
                      <span className="block text-[11px] text-indigo-700/90 mt-0.5">
                        {formatNumber(stats.belowTargetRestockCount)} รายการต่ำกว่าเป้า ·{' '}
                        {formatNumber(stats.fullTargetRestockUnits)} หน่วย
                      </span>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                      <span className="text-[11px] font-medium text-slate-600 block">
                        งบเพิ่มเติมเพื่อเติมเต็มชั้นวาง
                      </span>
                      <span className="text-lg font-extrabold text-slate-900">
                        {formatBaht(
                          Math.max(0, stats.fullTargetRestockBudget - stats.criticalRestockBudget)
                        )}
                      </span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">
                        ส่วนต่างจากงบขั้นวิกฤต ({formatNumber(Math.max(0, stats.belowTargetRestockCount - stats.criticalRestockCount))} รายการรอเติม)
                      </span>
                    </div>
                  </div>

                  {stats.restockSupplierBreakdown.length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-left text-xs tabular-nums">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                          <tr>
                            <th className="px-3 py-2 font-semibold">ร้านค้าส่ง / ซัพพลายเออร์</th>
                            <th className="px-3 py-2 text-right font-semibold">ขั้นวิกฤต (รายการ)</th>
                            <th className="px-3 py-2 text-right font-semibold">งบขั้นวิกฤต</th>
                            <th className="px-3 py-2 text-right font-semibold">ต่ำกว่าเป้า (รายการ)</th>
                            <th className="px-3 py-2 text-right font-semibold">จำนวนเติมรวม</th>
                            <th className="px-3 py-2 text-right font-semibold">งบเติมเต็มเป้า</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {stats.restockSupplierBreakdown.map((sup) => (
                            <tr key={sup.supplierName} className="hover:bg-slate-50/70">
                              <td className="px-3 py-2 font-semibold text-slate-800">
                                {sup.isAssigned ? (
                                  sup.supplierName
                                ) : (
                                  <span className="text-slate-500 font-normal">
                                    {sup.supplierName}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right text-rose-700 font-semibold">
                                {formatNumber(sup.criticalCount)}
                              </td>
                              <td className="px-3 py-2 text-right text-rose-700 font-bold">
                                {formatBaht(sup.criticalBudget)}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-700">
                                {formatNumber(sup.fullTargetCount)}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-600">
                                {formatNumber(sup.totalUnits)} หน่วย
                              </td>
                              <td className="px-3 py-2 text-right text-indigo-700 font-bold">
                                {formatBaht(sup.fullTargetBudget)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Stock Shrinkage & Adjustments Card */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <TrendingDown className="h-5 w-5 text-rose-600 shrink-0" aria-hidden="true" />
                    <h2>วิเคราะห์ความสูญเสียและการปรับสต็อก (Stock Shrinkage &amp; Adjustments)</h2>
                  </div>
                  <p className="text-xs text-slate-500">
                    สรุปยอดปรับลดสต็อก (ของเสีย/หมดอายุ/ตรวจนับขาด) และการปรับเพิ่มสต็อกตามมูลค่าต้นทุน · {periodDisplayLabel}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-bold tabular-nums ${
                      stats.shrinkageCount > 0
                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    ปรับลด {formatNumber(stats.shrinkageCount)} ครั้ง · ทั้งหมด {formatNumber(stats.totalAdjustmentCount)} รายการ
                  </span>
                  <Link
                    href="/inventory"
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
                  >
                    <span>ไปหน้าคลังสินค้า</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 tabular-nums">
                <div className="rounded-xl border border-rose-200/80 bg-rose-50/70 p-3">
                  <span className="text-[11px] font-semibold text-rose-700 block">
                    มูลค่าต้นทุนปรับลด / ความสูญเสีย (qty &lt; 0)
                  </span>
                  <p className="text-lg font-extrabold text-rose-700 mt-0.5">
                    {stats.shrinkageCostTotal > 0
                      ? `-${formatBaht(stats.shrinkageCostTotal)}`
                      : formatBaht(0)}
                  </p>
                  <p className="text-[11px] text-rose-700/80 mt-0.5">
                    {formatNumber(stats.shrinkageCount)} ครั้ง · ลดลง {formatNumber(stats.shrinkageUnitsTotal)} หน่วย
                    {stats.totalSales > 0 && stats.shrinkageCostTotal > 0
                      ? ` (${stats.shrinkagePctOfSales.toFixed(2)}% ของยอดขาย)`
                      : ''}
                  </p>
                </div>

                <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-3">
                  <span className="text-[11px] font-semibold text-emerald-700 block">
                    มูลค่าต้นทุนที่ปรับเพิ่ม (qty &gt; 0)
                  </span>
                  <p className="text-lg font-extrabold text-emerald-700 mt-0.5">
                    {stats.adjustmentAddCostTotal > 0
                      ? `+${formatBaht(stats.adjustmentAddCostTotal)}`
                      : formatBaht(0)}
                  </p>
                  <p className="text-[11px] text-emerald-700/80 mt-0.5">
                    {formatNumber(stats.adjustmentAddCount)} ครั้ง · เพิ่มขึ้น {formatNumber(stats.adjustmentAddUnitsTotal)} หน่วย
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <span className="text-[11px] font-semibold text-slate-500 block">
                    ผลต่างต้นทุนปรับสต็อกสุทธิ (Net Adjustment)
                  </span>
                  <p
                    className={`text-lg font-extrabold mt-0.5 ${
                      stats.netAdjustmentCost < 0
                        ? 'text-rose-700'
                        : stats.netAdjustmentCost > 0
                          ? 'text-emerald-700'
                          : 'text-slate-900'
                    }`}
                  >
                    {stats.netAdjustmentCost > 0
                      ? `+${formatBaht(stats.netAdjustmentCost)}`
                      : stats.netAdjustmentCost < 0
                        ? `-${formatBaht(Math.abs(stats.netAdjustmentCost))}`
                        : formatBaht(0)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    อ้างอิงจากต้นทุนสินค้าปัจจุบัน × จำนวนที่ปรับยอด
                  </p>
                </div>
              </div>

              <div className="pt-1">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-xs font-bold text-slate-700">
                    รายการปรับลดสต็อกล่าสุด ({formatNumber(stats.recentShrinkageItems.length)} รายการ)
                  </h3>
                  {stats.recentShrinkageItems.length > 0 && (
                    <span className="text-[11px] text-slate-500">
                      เรียงจากรายการล่าสุด
                    </span>
                  )}
                </div>

                {stats.recentShrinkageItems.length === 0 ? (
                  <p className="text-sm text-emerald-600 py-5 text-center font-medium bg-emerald-50/40 rounded-xl border border-emerald-100">
                    {stats.totalAdjustmentCount === 0
                      ? 'ไม่มีรายการปรับสต็อกในช่วงเวลาที่เลือก'
                      : `ไม่มีรายการปรับลดสต็อก (ความสูญเสีย) ในช่วงเวลานี้ (มีปรับเพิ่ม ${formatNumber(stats.adjustmentAddCount)} ครั้ง)`}
                  </p>
                ) : (
                  <>
                    <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto pr-1">
                      {(showAllShrinkage
                        ? stats.recentShrinkageItems
                        : stats.recentShrinkageItems.slice(0, 10)
                      ).map((item) => (
                        <div
                          key={item.id}
                          className="py-2.5 flex items-center justify-between gap-3 text-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-slate-800 truncate">
                                {item.productName}
                              </span>
                              {item.categoryName && (
                                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                                  {item.categoryName}
                                </span>
                              )}
                              <span className="rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[11px] font-bold text-rose-700 tabular-nums">
                                -{formatNumber(item.absQty)} {item.baseUnit}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5 break-words">
                              {formatDateTime(item.createdAt)} · สาเหตุ: {item.note}
                            </p>
                          </div>
                          <div className="text-right tabular-nums shrink-0">
                            <span className="font-bold text-rose-700 block">
                              -{formatBaht(item.costImpact)}
                            </span>
                            <span className="block text-[11px] text-slate-500">
                              ทุน {formatBaht(item.unitCost)}/{item.baseUnit}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {stats.recentShrinkageItems.length > 10 && (
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                        <span className="text-slate-500 tabular-nums">
                          {showAllShrinkage
                            ? `แสดงทั้งหมด ${formatNumber(stats.recentShrinkageItems.length)} รายการ`
                            : `แสดง 10 รายการล่าสุด จากทั้งหมด ${formatNumber(stats.recentShrinkageItems.length)} รายการ`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowAllShrinkage((prev) => !prev)}
                          className="font-bold text-rose-700 hover:underline"
                        >
                          {showAllShrinkage
                            ? 'ย่อเหลือ 10 รายการล่าสุด'
                            : `ดูทั้งหมด (${formatNumber(stats.recentShrinkageItems.length)})`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Void & Partial Return Audit Card */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <RotateCcw className="h-5 w-5 text-amber-600 shrink-0" aria-hidden="true" />
                    <h2>ตรวจสอบการยกเลิกบิลและการรับคืนสินค้า (Void &amp; Refund Audit)</h2>
                  </div>
                  <p className="text-xs text-slate-500">
                    สรุปบิลที่ถูกยกเลิกและบิลที่มีการรับคืนสินค้าบางรายการในช่วงเวลาที่เลือก · {periodDisplayLabel}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-bold tabular-nums ${
                    stats.cancelledSalesCount + stats.partialReturnBillsCount > 0
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  ยกเลิก {formatNumber(stats.cancelledSalesCount)} บิล · รับคืน {formatNumber(stats.partialReturnBillsCount)} บิล
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 tabular-nums">
                <div className="rounded-xl border border-rose-200/80 bg-rose-50/70 p-3">
                  <span className="text-[11px] font-semibold text-rose-700 block">
                    บิลที่ถูกยกเลิก (Void Bills)
                  </span>
                  <p className="text-lg font-extrabold text-rose-700 mt-0.5">
                    {formatBaht(stats.cancelledSalesAmount)}
                  </p>
                  <p className="text-[11px] text-rose-700/80 mt-0.5">
                    {formatNumber(stats.cancelledSalesCount)} บิล
                  </p>
                </div>

                <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 p-3">
                  <span className="text-[11px] font-semibold text-amber-800 block">
                    รับคืนสินค้าบางรายการ (Partial Returns)
                  </span>
                  <p className="text-lg font-extrabold text-amber-800 mt-0.5">
                    {formatBaht(stats.partialReturnRefundTotal)}
                  </p>
                  <p className="text-[11px] text-amber-800/80 mt-0.5">
                    {formatNumber(stats.partialReturnBillsCount)} บิลที่มีการคืนเงินบางส่วน
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <span className="text-[11px] font-semibold text-slate-500 block">
                    มูลค่ายกเลิกและคืนเงินรวม
                  </span>
                  <p className="text-lg font-extrabold text-slate-900 mt-0.5">
                    {formatBaht(stats.voidReturnTotalImpact)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    รวม {formatNumber(stats.cancelledSalesCount + stats.partialReturnBillsCount)} บิลที่ต้องตรวจสอบ
                  </p>
                </div>
              </div>

              <div className="pt-1">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-xs font-bold text-slate-700">
                    รายการบิลยกเลิก / รับคืนล่าสุด ({formatNumber(stats.voidReturnAuditItems.length)} รายการ)
                  </h3>
                  {stats.voidReturnAuditItems.length > 0 && (
                    <span className="text-[11px] text-slate-500">
                      เรียงจากรายการล่าสุด
                    </span>
                  )}
                </div>

                {stats.voidReturnAuditItems.length === 0 ? (
                  <p className="text-sm text-emerald-600 py-5 text-center font-medium bg-emerald-50/40 rounded-xl border border-emerald-100">
                    ไม่มีบิลยกเลิกหรือรับคืนสินค้าในช่วงเวลาที่เลือก
                  </p>
                ) : (
                  <>
                    <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto pr-1">
                      {(showAllVoidAudit
                        ? stats.voidReturnAuditItems
                        : stats.voidReturnAuditItems.slice(0, 10)
                      ).map((item) => {
                        const badge = PAYMENT_BADGE[item.paymentMethod];
                        return (
                          <div
                            key={item.id}
                            className="py-2.5 flex items-center justify-between gap-3 text-sm"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                                    item.type === 'cancelled'
                                      ? 'bg-rose-50 border-rose-200 text-rose-700'
                                      : 'bg-amber-50 border-amber-200 text-amber-800'
                                  }`}
                                >
                                  {item.type === 'cancelled' ? 'ยกเลิกบิล' : 'รับคืนบางรายการ'}
                                </span>
                                {badge && (
                                  <span
                                    className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${badge.className}`}
                                  >
                                    {badge.label}
                                  </span>
                                )}
                                <span className="text-xs text-slate-500">
                                  {formatDateTime(item.createdAt)}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 mt-1 break-words">
                                {item.note}
                              </p>
                            </div>
                            <div className="text-right tabular-nums shrink-0">
                              <span
                                className={`font-bold block ${
                                  item.type === 'cancelled' ? 'text-rose-700' : 'text-amber-800'
                                }`}
                              >
                                {formatBaht(item.amount)}
                              </span>
                              {item.type === 'partial_return' && (
                                <span className="block text-[11px] text-slate-500">
                                  ยอดบิล {formatBaht(item.billTotal)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {stats.voidReturnAuditItems.length > 10 && (
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                        <span className="text-slate-500 tabular-nums">
                          {showAllVoidAudit
                            ? `แสดงทั้งหมด ${formatNumber(stats.voidReturnAuditItems.length)} รายการ`
                            : `แสดง 10 รายการล่าสุด จากทั้งหมด ${formatNumber(stats.voidReturnAuditItems.length)} รายการ`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowAllVoidAudit((prev) => !prev)}
                          className="font-bold text-amber-700 hover:underline"
                        >
                          {showAllVoidAudit
                            ? 'ย่อเหลือ 10 รายการล่าสุด'
                            : `ดูทั้งหมด (${formatNumber(stats.voidReturnAuditItems.length)})`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Other Income / Expenses */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <TrendingUp className="h-5 w-5 text-sky-600" />
                  <h2>
                    รายรับ-รายจ่ายอื่นๆ ของร้าน ({expenses.length} รายการ)
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportExpensesCSV}
                    disabled={expenses.length === 0}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>ส่งออกรายรับ-รายจ่าย CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpOpen(true)}
                    className="flex items-center gap-1 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800"
                  >
                    <Plus className="h-4 w-4" />
                    <span>บันทึกรายรับ/รายจ่าย</span>
                  </button>
                </div>
              </div>

              {/* Category Summary Strip */}
              {stats.expenseCategorySummary.length > 0 && (
                <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-slate-700">
                      สรุปยอดรวมแยกตามหมวดหมู่ ({PERIOD_LABEL[period]})
                    </span>
                    <div className="flex items-center gap-3 tabular-nums">
                      <span className="text-emerald-700 font-bold">
                        รวมรายรับอื่นๆ: +{formatBaht(stats.otherIncome)}
                      </span>
                      <span className="text-rose-700 font-bold">
                        รวมรายจ่ายร้าน: -{formatBaht(stats.otherExpense)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {stats.expenseCategorySummary.map((cat) => (
                      <div
                        key={cat.key}
                        className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                          cat.type === 'income'
                            ? 'bg-emerald-50/80 border-emerald-200 text-emerald-800'
                            : 'bg-rose-50/80 border-rose-200 text-rose-800'
                        }`}
                      >
                        <span className="font-semibold">{cat.category}</span>
                        <span className="text-[11px] opacity-75">({cat.count})</span>
                        <span className="font-extrabold tabular-nums">
                          {cat.type === 'income' ? '+' : '-'}
                          {formatBaht(cat.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {expenses.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-6">
                  ยังไม่มีรายการรายรับ-รายจ่ายในช่วงเวลานี้
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {expenses.map((e) => (
                    <div key={e.id} className="py-2.5 flex items-center justify-between gap-2 text-sm">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {e.type === 'income' ? (
                          <ArrowDownCircle className="h-4 w-4 text-emerald-600 shrink-0" />
                        ) : (
                          <ArrowUpCircle className="h-4 w-4 text-rose-600 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 truncate">{e.category}</p>
                          <p className="text-xs text-slate-500">
                            {formatDateTime(e.created_at)}
                            {e.note ? ` · ${e.note}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        <span
                          className={`font-bold tabular-nums ${
                            e.type === 'income' ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {e.type === 'income' ? '+' : '-'}
                          {formatBaht(e.amount)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteExpense(e)}
                          title="ลบรายการนี้"
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Store Expense Category Breakdown Card */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <PieChart className="h-5 w-5 text-rose-600" />
                  <h2>วิเคราะห์โครงสร้างรายจ่ายร้านค้า (Store Expense Breakdown)</h2>
                </div>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {periodDisplayLabel}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3">
                  <p className="text-xs font-semibold text-rose-700">รายจ่ายร้านรวม</p>
                  <p className="mt-1 text-lg font-extrabold text-rose-900 tabular-nums">
                    {formatBaht(stats.otherExpense)}
                  </p>
                  <p className="text-[11px] text-rose-700/80 tabular-nums">
                    {formatNumber(stats.expenseTotalCount)} รายการ · {formatNumber(stats.expenseBreakdown.length)} หมวดหมู่
                  </p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                  <p className="text-xs font-semibold text-amber-800">สัดส่วนรายจ่ายต่อยอดขายสุทธิ</p>
                  <p className="mt-1 text-lg font-extrabold text-amber-950 tabular-nums">
                    {stats.expenseToSalesPct.toFixed(1)}%
                  </p>
                  <p className="text-[11px] text-amber-800/80 tabular-nums">
                    เทียบยอดขายสุทธิ {formatBaht(stats.totalSales)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                  <p className="text-xs font-semibold text-slate-600">หมวดรายจ่ายสูงสุด</p>
                  <p className="mt-1 text-base font-extrabold text-slate-900 truncate">
                    {stats.topExpenseCategory ? stats.topExpenseCategory.category : 'ไม่มีรายจ่าย'}
                  </p>
                  <p className="text-[11px] text-slate-500 tabular-nums">
                    {stats.topExpenseCategory
                      ? `${formatBaht(stats.topExpenseCategory.amount)} (${stats.topExpenseCategory.sharePct.toFixed(1)}%)`
                      : '—'}
                  </p>
                </div>
              </div>

              {stats.expenseBreakdown.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">
                  ยังไม่มีรายการรายจ่ายร้านค้าในช่วงเวลานี้
                </p>
              ) : (
                <div className="space-y-3">
                  {stats.expenseBreakdown.map((cat, idx) => (
                    <div key={cat.category} className="space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-[11px] font-bold text-rose-700">
                            {idx + 1}
                          </span>
                          <span className="font-semibold text-slate-800 truncate">{cat.category}</span>
                          <span className="text-xs text-slate-500 tabular-nums">
                            ({formatNumber(cat.count)} ครั้ง)
                          </span>
                        </div>
                        <div className="flex items-center gap-3 tabular-nums">
                          <span className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-0.5">
                            {cat.sharePct.toFixed(1)}%
                          </span>
                          <span className="font-extrabold text-slate-900 min-w-[90px] text-right">
                            {formatBaht(cat.amount)}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-rose-500 transition-all"
                          style={{ width: `${Math.min(100, Math.max(2, cat.sharePct))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs font-bold text-slate-700 tabular-nums">
                    <span>รวมรายจ่ายทั้งหมด ({formatNumber(stats.expenseTotalCount)} ครั้ง)</span>
                    <span>
                      {formatBaht(stats.otherExpense)} (100.0% · {stats.expenseToSalesPct.toFixed(1)}% ของยอดขายสุทธิ)
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Recent Sales Bills Table */}
            <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-xs">
              <div className="px-4 py-3 border-b border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <Receipt className="h-5 w-5 text-emerald-600" />
                    <h2>
                      รายการบิลขายล่าสุด ({periodDisplayLabel} ·{' '}
                      {filteredSales.length !== sales.length
                        ? `${filteredSales.length} / ${sales.length}`
                        : sales.length}{' '}
                      บิล)
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportCSV}
                    disabled={sales.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>ดาวน์โหลด CSV</span>
                  </button>
                </div>

                {/* Filter & Search Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
                    {(
                      [
                        { key: 'all', label: 'ทั้งหมด' },
                        { key: 'cash', label: 'เงินสด' },
                        { key: 'qr', label: 'โอน/QR' },
                        { key: 'credit', label: 'ขายเชื่อ' },
                        { key: 'cancelled', label: 'ยกเลิกแล้ว' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setBillPaymentFilter(opt.key)}
                        className={`rounded-lg px-3 py-1 text-xs font-bold transition-colors ${
                          billPaymentFilter === opt.key
                            ? opt.key === 'cancelled'
                              ? 'bg-rose-600 text-white shadow-xs'
                              : 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative flex-1 min-w-[220px] max-w-sm">
                    <Search className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={billSearch}
                      onChange={(e) => setBillSearch(e.target.value)}
                      placeholder="ค้นหาชื่อสินค้า, ลูกค้า, หมายเหตุ..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-9 pr-8 py-1.5 text-xs text-slate-800 placeholder:text-slate-500 focus:border-emerald-500 focus:bg-white focus:outline-none"
                    />
                    {billSearch && (
                      <button
                        type="button"
                        onClick={() => setBillSearch('')}
                        aria-label="ล้างคำค้นหา"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {sales.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">
                  ยังไม่มีรายการบิลขายในช่วงเวลานี้
                </p>
              ) : filteredSales.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <p className="text-sm text-slate-500">ไม่พบบิลขายที่ตรงกับเงื่อนไขการค้นหา</p>
                  <button
                    type="button"
                    onClick={() => {
                      setBillPaymentFilter('all');
                      setBillSearch('');
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    ล้างตัวกรอง
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600 sticky top-0">
                      <tr>
                        <th className="px-4 py-3">เวลา</th>
                        <th className="px-4 py-3">รายการสินค้า / ลูกค้า</th>
                        <th className="px-4 py-3">วิธีชำระเงิน</th>
                        <th className="px-4 py-3 text-right">ยอดขาย</th>
                        <th className="px-4 py-3 text-right">ต้นทุน</th>
                        <th className="px-4 py-3 text-right">กำไรต่อบิล</th>
                        <th className="px-4 py-3 text-right">ดูบิล</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredSales.map((s) => {
                        const badge = PAYMENT_BADGE[s.payment_method] ?? PAYMENT_BADGE.cash;
                        const saleAmt = Number(s.total_amount);
                        const costAmt = Number(s.total_cost);
                        const profitAmt = saleAmt - costAmt;
                        const itemsText =
                          s.sale_items && s.sale_items.length > 0
                            ? s.sale_items
                                .map((it) => `${it.product_name} x${it.qty}`)
                                .join(', ')
                            : 'บิลขายหน้าร้าน';
                        return (
                          <tr
                            key={s.id}
                            onClick={() => setSelectedSale(s)}
                            className="hover:bg-emerald-50/40 cursor-pointer transition-colors"
                          >
                            <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                              {formatDateTime(s.created_at)}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-700 max-w-xs truncate">
                              <span title={itemsText}>{itemsText}</span>
                              {s.customers?.name && (
                                <span className="ml-1.5 text-amber-700 font-semibold">
                                  ({s.customers.name})
                                </span>
                              )}
                              {s.note && (
                                <span className="ml-1.5 text-slate-500 italic">· {s.note}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-slate-900 tabular-nums whitespace-nowrap">
                              {formatBaht(saleAmt)}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-500 tabular-nums whitespace-nowrap">
                              {formatBaht(costAmt)}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-bold tabular-nums whitespace-nowrap ${
                                profitAmt >= 0 ? 'text-emerald-600' : 'text-rose-600'
                              }`}
                            >
                              {profitAmt > 0 ? `+${formatBaht(profitAmt)}` : formatBaht(profitAmt)}
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedSale(s);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                              >
                                <Eye className="h-3 w-3" />
                                <span>ดู</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Master Backup & LocalStorage Metadata Integrity Summary Card */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-sky-600 shrink-0" />
                  <div>
                    <h2 className="font-bold text-slate-900">
                      สถานะข้อมูลเสริมในเครื่อง (Metadata Audit) &amp; Master Backup
                    </h2>
                    <p className="text-xs text-slate-500">
                      ตรวจสอบความครบถ้วนของข้อมูลตั้งค่าและข้อมูลเสริมในเบราว์เซอร์ครบทั้ง 4 หมวดก่อนสำรองข้อมูล
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {masterAuditSummary && (
                    <span className="rounded-full bg-sky-50 border border-sky-200 px-2.5 py-1 text-xs font-bold text-sky-800 tabular-nums">
                      มีข้อมูลจริง {formatNumber(masterAuditSummary.totalPopulated)} /{' '}
                      {formatNumber(masterAuditSummary.totalKeys)} คีย์
                      {masterAuditSummary.extraCount > 0
                        ? ` (+${formatNumber(masterAuditSummary.extraCount)} เพิ่มเติม)`
                        : ''}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={openMasterBackupModal}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-sky-700 shadow-xs"
                  >
                    <Database className="h-3.5 w-3.5" />
                    <span>สำรอง/กู้คืน Master JSON</span>
                  </button>
                </div>
              </div>
              {masterAuditSummary ? (
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {masterAuditSummary.categories.map((cat) => (
                    <div
                      key={cat.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800">{cat.title}</span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums ${cat.badgeClass}`}
                        >
                          {formatNumber(cat.populatedCount)} / {formatNumber(cat.totalCount)} คีย์
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        {cat.populatedCount > 0
                          ? `พบข้อมูลที่บันทึกไว้ ${formatNumber(cat.populatedCount)} คีย์จากทั้งหมด ${formatNumber(cat.totalCount)} คีย์`
                          : `ยังไม่มีข้อมูลเสริมในหมวดนี้ (0 / ${formatNumber(cat.totalCount)} คีย์)`}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-xs text-slate-500">กำลังตรวจสอบข้อมูลเสริมในเครื่อง...</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Add Expense / Income Modal */}
      <Modal
        open={expOpen}
        onClose={() => setExpOpen(false)}
        title="บันทึกรายรับ-รายจ่ายร้าน"
        maxWidthClass="max-w-sm"
      >
        <form onSubmit={handleAddExpense} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setExpType('expense');
                setExpCategory('ซื้อของเข้าร้าน');
              }}
              className={`rounded-xl border py-2.5 text-xs font-bold ${
                expType === 'expense'
                  ? 'border-rose-600 bg-rose-50 text-rose-700'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              รายจ่ายร้าน
            </button>
            <button
              type="button"
              onClick={() => {
                setExpType('income');
                setExpCategory('รายรับอื่นๆ');
              }}
              className={`rounded-xl border py-2.5 text-xs font-bold ${
                expType === 'income'
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              รายรับอื่นๆ
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">หมวดหมู่</label>
            <input
              type="text"
              required
              value={expCategory}
              onChange={(e) => setExpCategory(e.target.value)}
              placeholder="เช่น ซื้อของเข้าร้าน, ค่าไฟ, ค่าถุง"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              จำนวนเงิน (บาท)
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">หมายเหตุ</label>
            <input
              type="text"
              value={expNote}
              onChange={(e) => setExpNote(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800"
          >
            บันทึกรายการ
          </button>
        </form>
      </Modal>

      {/* Store Settings Modal */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="ตั้งค่าร้าน & PromptPay QR"
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleSaveSettings} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">ชื่อร้าน</label>
            <input
              type="text"
              required
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              เบอร์มือถือ หรือ เลขบัตรประชาชน PromptPay
            </label>
            <input
              type="text"
              value={promptpayId}
              onChange={(e) => setPromptpayId(e.target.value)}
              placeholder="เช่น 0812345678"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              ใช้สำหรับสร้าง QR Code พร้อมยอดเงินอัตโนมัติในหน้าคิดเงิน
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              เบอร์โทรศัพท์ร้าน (แสดงบนใบเสร็จ)
            </label>
            <input
              type="text"
              value={storePhone}
              onChange={(e) => setStorePhone(e.target.value)}
              placeholder="เช่น 081-234-5678"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              ที่อยู่ร้าน / ข้อความท้ายใบเสร็จ
            </label>
            <textarea
              rows={2}
              value={storeAddress}
              onChange={(e) => setStoreAddress(e.target.value)}
              placeholder="เช่น 99 หมู่ 1 ต.ในเมือง · ขอบคุณที่อุดหนุนครับ"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700"
          >
            บันทึกการตั้งค่า
          </button>
        </form>
      </Modal>

      {/* Sale Bill Detail Modal */}
      <Modal
        open={Boolean(selectedSale)}
        onClose={() => setSelectedSale(null)}
        title={selectedSale ? `รายละเอียดบิล #${selectedSale.id.slice(0, 8)}` : 'รายละเอียดบิล'}
        maxWidthClass="max-w-lg"
      >
        {selectedSale && (() => {
          const badge = PAYMENT_BADGE[selectedSale.payment_method] ?? PAYMENT_BADGE.cash;
          const totalAmt = Number(selectedSale.total_amount);
          const costAmt = Number(selectedSale.total_cost);
          const profitAmt = totalAmt - costAmt;
          const items = selectedSale.sale_items ?? [];
          return (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-500">
                    เวลา: <strong className="text-slate-800">{formatDateTime(selectedSale.created_at)}</strong>
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </div>
                {selectedSale.customers?.name && (
                  <div className="text-slate-600">
                    ลูกค้า: <strong className="text-amber-700">{selectedSale.customers.name}</strong>
                  </div>
                )}
                {selectedSale.note && (
                  <div className="text-slate-600">
                    หมายเหตุ: <span className="text-slate-800">{selectedSale.note}</span>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-bold text-slate-700 mb-2">
                  รายการสินค้าในบิล ({items.length} รายการ)
                </h3>
                {items.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4 rounded-xl border border-slate-200">
                    ไม่มีรายละเอียดรายการสินค้าในบิลนี้
                  </p>
                ) : (
                  <div className="rounded-xl border border-slate-200 overflow-hidden max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                        <tr>
                          <th className="px-3 py-2">สินค้า</th>
                          <th className="px-3 py-2 text-right">จำนวน</th>
                          <th className="px-3 py-2 text-right">ราคา/หน่วย</th>
                          <th className="px-3 py-2 text-right">รวม</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map((it) => (
                          <tr key={it.id}>
                            <td className="px-3 py-2 font-medium text-slate-800">
                              {it.product_name}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-600 whitespace-nowrap">
                              {formatNumber(it.qty)} {it.unit_name}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-600 whitespace-nowrap">
                              {formatBaht(it.unit_price)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-900 whitespace-nowrap">
                              {formatBaht(it.subtotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-xl bg-slate-900 text-white p-3.5 text-xs space-y-1.5 tabular-nums">
                <div className="flex justify-between text-sm font-extrabold">
                  <span>ยอดรวมสุทธิ</span>
                  <span>{formatBaht(totalAmt)}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>ต้นทุนรวม</span>
                  <span>{formatBaht(costAmt)}</span>
                </div>
                <div className="flex justify-between font-bold text-emerald-400">
                  <span>กำไรต่อบิล</span>
                  <span>{profitAmt > 0 ? `+${formatBaht(profitAmt)}` : formatBaht(profitAmt)}</span>
                </div>
                {selectedSale.payment_method === 'cash' && (
                  <div className="pt-1.5 mt-1.5 border-t border-slate-700 flex justify-between text-slate-300">
                    <span>รับเงินสด {formatBaht(selectedSale.cash_received)}</span>
                    <span>เงินทอน {formatBaht(selectedSale.change_amount)}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Master All-in-One JSON Backup / Restore Modal */}
      <Modal
        open={masterBackupOpen}
        onClose={() => setMasterBackupOpen(false)}
        title="สำรอง/กู้คืนข้อมูลทั้งร้าน (Master JSON)"
        maxWidthClass="max-w-3xl"
      >
        <div className="space-y-4">
          {/* Export Section */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  1. สำรองข้อมูลตั้งค่าเสริมทั้งร้านทุกหมวด (Export Master JSON)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  รวมข้อมูลเบราว์เซอร์ครบทั้ง 4 หมวด (pos_daily_sales_goal_v1, pos_*, inventory_*, customer_*, shift_*) ในไฟล์เดียว
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyMasterBackupJson}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  {masterJsonCopied ? (
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
                  onClick={handleDownloadMasterBackupJson}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>ดาวน์โหลดไฟล์ (.json)</span>
                </button>
              </div>
            </div>

            {masterSnapshot && (() => {
              const d = masterSnapshot.data;
              const extraCount = Object.keys(masterSnapshot.extraKeys).length;
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-1">
                    <div className="font-bold text-slate-800">
                      หน้าขาย POS &amp; เป้าหมาย ({formatNumber(10)} คีย์)
                    </div>
                    <div className="text-slate-600 tabular-nums leading-relaxed">
                      เป้า/วัน {formatBaht(d[DAILY_GOAL_STORAGE_KEY])} · ปักหมุด{' '}
                      {formatNumber(d[POS_PINNED_STORAGE_KEY].length)} · ชุดขาย{' '}
                      {formatNumber(d[POS_BUNDLES_STORAGE_KEY].length)} · มัดจำ{' '}
                      {formatNumber(d[POS_CONTAINER_DEPOSITS_STORAGE_KEY].length)} · บิลพัก{' '}
                      {formatNumber(d[POS_HELD_BILLS_STORAGE_KEY].length)} · ปุ่มลัดสินค้ารวม{' '}
                      {formatNumber(
                        Array.isArray(d[POS_MISC_PRESETS_STORAGE_KEY])
                          ? d[POS_MISC_PRESETS_STORAGE_KEY].length
                          : Object.keys(d[POS_MISC_PRESETS_STORAGE_KEY]).length
                      )}{' '}
                      · เสียง {d[POS_SOUND_ENABLED_STORAGE_KEY] ? 'เปิด' : 'ปิด'} · ปุ่ม{' '}
                      {d[POS_GRID_DENSITY_STORAGE_KEY] === 'compact' ? 'กะทัดรัด' : 'ใหญ่'} ·
                      โน้ตส่งกะ {d[POS_SHIFT_HANDOVER_MEMO_STORAGE_KEY] ? 'มี' : 'ไม่มี'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-1">
                    <div className="font-bold text-slate-800">
                      คลังสินค้า ({formatNumber(10)} คีย์)
                    </div>
                    <div className="text-slate-600 tabular-nums leading-relaxed">
                      วันหมดอายุ {formatNumber(Object.keys(d[EXPIRY_DATES_STORAGE_KEY]).length)} ·
                      ซัพพลายเออร์ {formatNumber(Object.keys(d[SUPPLIERS_STORAGE_KEY]).length)} ·
                      ชั้นวาง{' '}
                      {formatNumber(Object.keys(d[INVENTORY_SHELF_LOCATIONS_STORAGE_KEY]).length)}{' '}
                      · แพ็คสั่ง{' '}
                      {formatNumber(Object.keys(d[INVENTORY_ORDER_PACK_INFO_STORAGE_KEY]).length)}{' '}
                      · ราคาส่ง{' '}
                      {formatNumber(Object.keys(d[INVENTORY_WHOLESALE_TIERS_STORAGE_KEY]).length)}{' '}
                      · ทดแทน{' '}
                      {formatNumber(Object.keys(d[INVENTORY_SUBSTITUTE_NOTES_STORAGE_KEY]).length)}{' '}
                      · บาร์โค้ดหน่วย{' '}
                      {formatNumber(
                        Array.isArray(d[INVENTORY_UNIT_BARCODES_STORAGE_KEY])
                          ? d[INVENTORY_UNIT_BARCODES_STORAGE_KEY].length
                          : Object.keys(d[INVENTORY_UNIT_BARCODES_STORAGE_KEY]).length
                      )}{' '}
                      · ประวัติทุน{' '}
                      {formatNumber(
                        Object.keys(d[INVENTORY_LAST_COST_HISTORY_STORAGE_KEY]).length
                      )}{' '}
                      · เป้าสต็อก{' '}
                      {formatNumber(Object.keys(d[INVENTORY_TARGET_STOCK_STORAGE_KEY]).length)}{' '}
                      · ป้ายโปรโมชั่น{' '}
                      {formatNumber(Object.keys(d[INVENTORY_PROMO_LABELS_STORAGE_KEY]).length)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-1">
                    <div className="font-bold text-slate-800">
                      ลูกค้า &amp; ลูกหนี้ ({formatNumber(10)} คีย์)
                    </div>
                    <div className="text-slate-600 tabular-nums leading-relaxed">
                      กลุ่มลูกค้า {formatNumber(Object.keys(d[CUSTOMER_TAGS_STORAGE_KEY]).length)}{' '}
                      · วงเงิน {formatNumber(Object.keys(d[CUSTOMER_CREDIT_LIMITS_STORAGE_KEY]).length)}{' '}
                      · เงินฝากทอน{' '}
                      {formatNumber(Object.keys(d[CUSTOMER_STORE_CREDIT_STORAGE_KEY]).length)}{' '}
                      · แต้ม {formatNumber(Object.keys(d[CUSTOMER_LOYALTY_POINTS_STORAGE_KEY]).length)}{' '}
                      · VIP{' '}
                      {formatNumber(
                        Object.keys(d[CUSTOMER_DEFAULT_DISCOUNT_PCT_STORAGE_KEY]).length
                      )}{' '}
                      · นัดชำระ {formatNumber(Object.keys(d[CUSTOMER_DUE_DATES_STORAGE_KEY]).length)}{' '}
                      · แจ้งยอด{' '}
                      {formatNumber(Object.keys(d[CUSTOMER_LAST_REMINDED_STORAGE_KEY]).length)} ·
                      ที่อยู่/ติดต่อ{' '}
                      {formatNumber(Object.keys(d[CUSTOMER_CONTACT_NOTES_STORAGE_KEY]).length)} ·
                      ติดตามทวง{' '}
                      {formatNumber(
                        Array.isArray(d[CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY])
                          ? d[CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY].length
                          : Object.keys(d[CUSTOMER_FOLLOWUP_LOGS_STORAGE_KEY]).length
                      )}{' '}
                      · รอบเงินเดือน{' '}
                      {formatNumber(
                        Array.isArray(d[CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY])
                          ? d[CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY].length
                          : Object.keys(d[CUSTOMER_PAYDAY_CYCLES_STORAGE_KEY]).length
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-1">
                    <div className="font-bold text-slate-800">
                      กะการขาย ({formatNumber(4)} คีย์
                      {extraCount > 0 ? ` + เพิ่มเติม ${formatNumber(extraCount)}` : ''})
                    </div>
                    <div className="text-slate-600 tabular-nums leading-relaxed">
                      ผู้ดูแลกะ {formatNumber(Object.keys(d[SHIFT_CASHIER_NAMES_STORAGE_KEY]).length)}{' '}
                      กะ · เงินทอนยกยอด{' '}
                      {formatNumber(Object.keys(d[SHIFT_NEXT_FLOATS_STORAGE_KEY]).length)} กะ ·
                      สาเหตุส่วนต่าง{' '}
                      {formatNumber(Object.keys(d[SHIFT_VARIANCE_REASONS_STORAGE_KEY]).length)} กะ ·
                      เป้ายอดขาย/กะ {formatBaht(d[SHIFT_SALES_TARGET_STORAGE_KEY])}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Import / Restore Section */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                2. กู้คืนข้อมูลทั้งร้านจากไฟล์หรือวาง JSON (Import / Restore)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                รองรับทั้งไฟล์ Master JSON ทั้งร้าน และไฟล์สำรองเฉพาะหน้า (/pos, /inventory, /customers, /shifts) เพื่อกู้คืนข้อมูลทุกหน้าในคลิกเดียว
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/70 px-3.5 py-2 text-xs font-bold text-sky-800 hover:bg-sky-50 transition">
                <Upload className="h-4 w-4" />
                <span>
                  {masterBackupFileName
                    ? `เลือกไฟล์ใหม่ (${masterBackupFileName})`
                    : 'อัปโหลดไฟล์ .json จากเครื่อง'}
                </span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleMasterBackupFileChange}
                  className="hidden"
                />
              </label>

              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500 font-medium">รูปแบบกู้คืน:</span>
                <button
                  type="button"
                  onClick={() => setMasterRestoreMode('replace')}
                  className={`rounded-lg border px-2.5 py-1 font-semibold transition ${
                    masterRestoreMode === 'replace'
                      ? 'border-sky-600 bg-sky-600 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  เขียนทับข้อมูลเดิม
                </button>
                <button
                  type="button"
                  onClick={() => setMasterRestoreMode('merge')}
                  className={`rounded-lg border px-2.5 py-1 font-semibold transition ${
                    masterRestoreMode === 'merge'
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
                htmlFor="master-backup-json-textarea"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                วางข้อมูล JSON ที่นี่
              </label>
              <textarea
                id="master-backup-json-textarea"
                rows={7}
                value={masterBackupJsonInput}
                onChange={(e) => {
                  setMasterBackupJsonInput(e.target.value);
                  setMasterBackupError('');
                  setMasterBackupSuccess('');
                }}
                placeholder='{"pos_daily_sales_goal_v1": 5000, "pos_pinned_product_ids_v1": [...], "inventory_suppliers_v1": {...}, "customer_credit_limits_v1": {...}, "shift_cashier_names_v1": {...}, ...}'
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-800 focus:border-sky-500 focus:bg-white focus:outline-none"
              />
            </div>

            {masterBackupPreview && !masterBackupPreview.error && (() => {
              const keys = masterBackupPreview.keysPresent;
              const posCount = keys.filter((k) => k.startsWith('pos_')).length;
              const invCount = keys.filter((k) => k.startsWith('inventory_')).length;
              const custCount = keys.filter((k) => k.startsWith('customer_')).length;
              const shiftCount = keys.filter((k) => k.startsWith('shift_')).length;
              return (
                <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 flex flex-wrap items-center gap-2">
                  <span className="font-bold">
                    ตรวจพบข้อมูลพร้อมกู้คืน ({formatNumber(keys.length)} คีย์):
                  </span>
                  {posCount > 0 && (
                    <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                      หน้าขาย POS ({formatNumber(posCount)} คีย์)
                    </span>
                  )}
                  {invCount > 0 && (
                    <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                      คลังสินค้า ({formatNumber(invCount)} คีย์)
                    </span>
                  )}
                  {custCount > 0 && (
                    <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                      ลูกค้า/ลูกหนี้ ({formatNumber(custCount)} คีย์)
                    </span>
                  )}
                  {shiftCount > 0 && (
                    <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                      กะการขาย ({formatNumber(shiftCount)} คีย์)
                    </span>
                  )}
                </div>
              );
            })()}

            {masterBackupPreview?.error && !masterBackupError && (
              <div
                role="alert"
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
              >
                {masterBackupPreview.error}
              </div>
            )}

            {masterBackupError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
              >
                {masterBackupError}
              </div>
            )}

            {masterBackupSuccess && (
              <div
                role="status"
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 flex items-center gap-1.5"
              >
                <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{masterBackupSuccess}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setMasterBackupOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ปิด
            </button>
            <button
              type="button"
              disabled={!masterBackupJsonInput.trim() || Boolean(masterBackupPreview?.error)}
              onClick={handleRestoreMasterBackupJson}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              <span>กู้คืนข้อมูลทั้งร้านเข้าสู่ระบบ</span>
            </button>
          </div>
        </div>
      </Modal>
        </AppShell>
      </div>

      {/* Printable A4 Sales Report */}
      <div className="hidden print:block max-w-4xl mx-auto p-6 bg-white text-slate-900 text-xs leading-relaxed">
        <div className="border-b-2 border-slate-800 pb-4 mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">
              {settings?.store_name || 'ร้านขายของชำ POS'}
            </h1>
            {settings?.address && (
              <p className="text-xs text-slate-600 mt-0.5">{settings.address}</p>
            )}
            {settings?.phone && (
              <p className="text-xs text-slate-600">โทร: {settings.phone}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-base font-extrabold text-slate-900">รายงานสรุปยอดขายและกำไร</p>
            <p className="text-xs text-slate-700 mt-0.5">
              ช่วงเวลา: <span className="font-bold">{periodDisplayLabel}</span> ({formatNumber(sales.length)} บิล)
            </p>
            {printedAt && (
              <p className="text-[11px] text-slate-500 mt-0.5">
                พิมพ์เมื่อ: {formatDateTime(printedAt)}
              </p>
            )}
          </div>
        </div>

        {/* Printable 5-Pillar Store Health Scorecard */}
        <div className="rounded-lg border border-slate-300 p-3 mb-5 space-y-2.5 break-inside-avoid">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <div>
              <p className="text-xs font-extrabold text-slate-900">
                🏆 ดัชนีสุขภาพร้านค้าครบวงจร 5 มิติ (5-Pillar Store Health Scorecard)
              </p>
              <p className="text-[11px] text-slate-500">
                สรุปคะแนนประเมินประสิทธิภาพการบริหารร้านค้า 5 มิติหลัก
              </p>
            </div>
            <div className="text-right tabular-nums">
              <span className="text-sm font-extrabold text-slate-900">
                {stats.storeHealthScorecard.totalScore}/{stats.storeHealthScorecard.maxTotalScore} คะแนน
              </span>
              <span className="ml-2 rounded border border-slate-400 px-2 py-0.5 text-[11px] font-extrabold text-slate-900">
                เกรด {stats.storeHealthScorecard.grade} ({stats.storeHealthScorecard.overallStatus})
              </span>
            </div>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {stats.storeHealthScorecard.pillars.map((pillar) => {
              const pct = Math.min(100, Math.max(0, (pillar.score / pillar.maxScore) * 100));
              return (
                <div key={pillar.id} className="rounded border border-slate-200 p-2 space-y-1">
                  <p className="text-[11px] font-bold text-slate-800 leading-tight">{pillar.title}</p>
                  <p className="text-xs font-extrabold text-slate-900 tabular-nums">
                    {pillar.score}/{pillar.maxScore}{' '}
                    <span className="text-[11px] font-semibold text-slate-600">
                      ({pillar.status})
                    </span>
                  </p>
                  <div className="h-1.5 w-full rounded bg-slate-200 overflow-hidden">
                    <div className="h-full bg-slate-800" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[9px] text-slate-600 leading-tight">{pillar.summary}</p>
                </div>
              );
            })}
          </div>
          <div className="text-[11px] text-slate-700 bg-slate-50 rounded p-2 border border-slate-200">
            <span className="font-bold">คำแนะนำอัตโนมัติ: </span>
            {stats.storeHealthScorecard.recommendations.join(' · ')}
          </div>
        </div>

        {/* KPI Summary */}
        <div className="grid grid-cols-4 gap-3 mb-3 tabular-nums">
          <div className="rounded-lg border border-slate-300 p-3">
            <p className="text-[11px] font-semibold text-slate-500">ยอดขายรวม</p>
            <p className="text-base font-extrabold text-slate-900 mt-1">
              {formatBaht(stats.totalSales)}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              เฉลี่ย {formatBaht(stats.avgTicket)}/บิล
            </p>
          </div>
          <div className="rounded-lg border border-slate-300 p-3">
            <p className="text-[11px] font-semibold text-slate-500">ต้นทุนสินค้า</p>
            <p className="text-base font-extrabold text-slate-900 mt-1">
              {formatBaht(stats.totalCost)}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              จากยอดขาย {formatNumber(sales.length)} บิล
            </p>
          </div>
          <div className="rounded-lg border border-slate-300 p-3">
            <p className="text-[11px] font-semibold text-slate-500">กำไรขั้นต้น</p>
            <p className="text-base font-extrabold text-slate-900 mt-1">
              {formatBaht(stats.grossProfit)}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              มาร์จิ้น {stats.grossMarginPct.toFixed(1)}%
            </p>
          </div>
          <div className="rounded-lg border border-slate-300 p-3">
            <p className="text-[11px] font-semibold text-slate-500">กำไรสุทธิ</p>
            <p className="text-base font-extrabold text-slate-900 mt-1">
              {formatBaht(stats.netProfit)}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              รับอื่น +{formatBaht(stats.otherIncome)} / จ่าย -{formatBaht(stats.otherExpense)}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-5 tabular-nums">
          <div className="rounded-lg border border-slate-300 p-3">
            <p className="text-[11px] font-semibold text-slate-500">จำนวนชิ้นที่ขายได้รวม</p>
            <p className="text-base font-extrabold text-slate-900 mt-1">
              {formatNumber(stats.totalItemsSold)} ชิ้น
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              จากทั้งหมด {formatNumber(sales.length)} บิล ({formatNumber(stats.allProductStats.length)} รายการสินค้า)
            </p>
          </div>
          <div className="rounded-lg border border-slate-300 p-3">
            <p className="text-[11px] font-semibold text-slate-500">ขนาดตะกร้าเฉลี่ย (Basket Size)</p>
            <p className="text-base font-extrabold text-slate-900 mt-1">
              {stats.avgItemsPerBill.toFixed(1)} ชิ้น/บิล
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              ยอดขายเฉลี่ย {formatBaht(stats.avgTicket)} ต่อบิล
            </p>
          </div>
        </div>

        {/* Avg Profit Per Bill & Custom/Service Items (A4 Print) */}
        <div className="mb-5 tabular-nums">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
            วิเคราะห์กำไรเฉลี่ยต่อบิล และรายได้บริการเสริม/สินค้านอกรายการ
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">กำไรขั้นต้นเฉลี่ยต่อบิล</p>
              <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                {formatBaht(stats.avgGrossProfitPerBill)} / บิล
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                มาร์จิ้นขั้นต้น {stats.grossMarginPct.toFixed(1)}% (จาก {formatNumber(sales.length)} บิล)
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">กำไรสุทธิเฉลี่ยต่อบิล</p>
              <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                {formatBaht(stats.avgNetProfitPerBill)} / บิล
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                อัตรากำไรสุทธิ {stats.netMarginPct.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">
                บริการเสริม / สินค้านอกรายการ
              </p>
              <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                {formatBaht(stats.customItemRevenue)} ({stats.customItemSharePct.toFixed(1)}%)
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                กำไร {formatBaht(stats.customItemProfit)} · {formatNumber(stats.customItemQty)} ชิ้น ·{' '}
                {formatNumber(stats.customItemBillCount)} บิล
              </p>
            </div>
          </div>
        </div>

        {/* Break-Even & Net Margin Analysis (A4 Print) */}
        <div className="mb-5 tabular-nums">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
            วิเคราะห์จุดคุ้มทุนและอัตรากำไรสุทธิ (Break-Even &amp; Net Margin)
          </h2>
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">อัตรากำไรขั้นต้น</p>
              <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                {stats.grossMarginPct.toFixed(1)}%
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                กำไรขั้นต้น {formatBaht(stats.grossProfit)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">อัตรากำไรสุทธิ</p>
              <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                {stats.netMarginPct.toFixed(1)}%
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                กำไรสุทธิ {formatBaht(stats.netProfit)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">ยอดขายจุดคุ้มทุน</p>
              <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                {stats.otherExpense > 0 && stats.grossMarginPct <= 0
                  ? '—'
                  : formatBaht(stats.breakEvenSales)}
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                รายจ่ายร้าน {formatBaht(stats.otherExpense)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">สถานะเทียบจุดคุ้มทุน</p>
              <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                {stats.otherExpense > 0 && stats.grossMarginPct <= 0
                  ? 'มาร์จิ้น ≤ 0%'
                  : stats.breakEvenDiff >= 0
                    ? `เกิน +${formatBaht(stats.breakEvenDiff)}`
                    : `ขาด -${formatBaht(Math.abs(stats.breakEvenDiff))}`}
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                {stats.otherExpense === 0
                  ? 'ไม่มีรายจ่ายร้าน'
                  : stats.breakEvenMultiple !== null
                    ? `${stats.breakEvenMultiple.toFixed(2)} เท่าของจุดคุ้มทุน`
                    : `ยอดขาย ${formatBaht(stats.totalSales)}`}
              </p>
            </div>
          </div>
        </div>

        {/* Daily Trading Highlights (A4 Print) */}
        <div className="mb-5 tabular-nums">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
            ไฮไลต์ประสิทธิภาพรายวัน (Daily Trading Highlights)
          </h2>
          {stats.activeTradingDaysCount === 0 ? (
            <p className="text-xs text-slate-500">ไม่มีข้อมูลการขายในช่วงเวลาที่เลือก</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-300 p-2.5">
                <p className="text-[11px] font-semibold text-slate-500">วันที่มียอดขายสูงสุด</p>
                <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                  {stats.bestSalesDay ? formatBaht(stats.bestSalesDay.totalSales) : formatBaht(0)}
                </p>
                {stats.bestSalesDay && (
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    {stats.bestSalesDay.label} ({stats.bestSalesDay.subLabel}) ·{' '}
                    {formatNumber(stats.bestSalesDay.billCount)} บิล · กำไร{' '}
                    {formatBaht(stats.bestSalesDay.grossProfit)}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-slate-300 p-2.5">
                <p className="text-[11px] font-semibold text-slate-500">วันที่ทำกำไรขั้นต้นสูงสุด</p>
                <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                  {stats.bestProfitDay ? formatBaht(stats.bestProfitDay.grossProfit) : formatBaht(0)}
                </p>
                {stats.bestProfitDay && (
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    {stats.bestProfitDay.label} ({stats.bestProfitDay.subLabel}) · มาร์จิ้น{' '}
                    {stats.bestProfitDay.marginPct.toFixed(1)}% · ยอดขาย{' '}
                    {formatBaht(stats.bestProfitDay.totalSales)}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-slate-300 p-2.5">
                <p className="text-[11px] font-semibold text-slate-500">ยอดขายเฉลี่ยต่อวันที่มีการขาย</p>
                <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                  {formatBaht(stats.avgSalesPerActiveDay)}
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  วันที่มีบิลขายจริง {formatNumber(stats.activeTradingDaysCount)} วัน (
                  {formatNumber(sales.length)} บิล)
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Discount Impact Summary */}
        <div className="mb-5 tabular-nums">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
            สรุปผลกระทบส่วนลดท้ายบิล (Discount Impact Analysis)
          </h2>
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">ยอดขายก่อนหักส่วนลด</p>
              <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                {formatBaht(stats.grossSalesBeforeDiscount)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                ยอดสุทธิ {formatBaht(stats.totalSales)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">ส่วนลดรวมที่ให้ลูกค้า</p>
              <p className="text-sm font-extrabold text-rose-700 mt-0.5">
                {stats.totalDiscountGiven > 0
                  ? `-${formatBaht(stats.totalDiscountGiven)}`
                  : formatBaht(0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {stats.discountedBillsCount > 0
                  ? `เฉลี่ย ${formatBaht(stats.avgDiscountPerBill)}/บิล`
                  : 'ไม่มีการให้ส่วนลด'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">บิลที่มีการให้ส่วนลด</p>
              <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                {formatNumber(stats.discountedBillsCount)} บิล
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {stats.discountedBillsPct.toFixed(1)}% ของ {formatNumber(sales.length)} บิล
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">สัดส่วนส่วนลดเทียบยอดก่อนลด</p>
              <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                {stats.discountRatePct.toFixed(1)}%
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {stats.grossSalesBeforeDiscount > 0
                  ? `รับจริง ${(100 - stats.discountRatePct).toFixed(1)}%`
                  : '-'}
              </p>
            </div>
          </div>
        </div>

        {/* Credit vs Debt Collection Health Summary (A4 Print) */}
        <div className="mb-5 tabular-nums">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1.5 mb-2">
            <h2 className="text-sm font-bold text-slate-900">
              วิเคราะห์การปล่อยเชื่อ vs การรับชำระหนี้ (Credit vs Debt Collection Health)
            </h2>
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                stats.creditLiquidityStatus === 'สภาพคล่องดีเยี่ยม'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : stats.creditLiquidityStatus === 'ควรเร่งติดตามหนี้ค้าง'
                    ? 'border-rose-300 bg-rose-50 text-rose-800'
                    : 'border-sky-300 bg-sky-50 text-sky-800'
              }`}
            >
              สถานะ: {stats.creditLiquidityStatus}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">ยอดขายเชื่อใหม่</p>
              <p className="text-sm font-extrabold text-amber-800 mt-0.5">
                {formatBaht(stats.creditSales)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {formatNumber(stats.creditCount)} บิล ({stats.creditPct.toFixed(1)}% ของยอดขาย)
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">ยอดรับชำระหนี้รวม (สุทธิ)</p>
              <p className="text-sm font-extrabold text-emerald-700 mt-0.5">
                {formatBaht(stats.debtCollectedTotal)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                รับชำระ {formatNumber(stats.debtPaymentCount)} ครั้ง
              </p>
              {stats.debtWaivedTotal > 0 && (
                <p className="text-[11px] font-semibold text-amber-700 mt-0.5">
                  ยกเว้นเศษหนี้ {formatBaht(stats.debtWaivedTotal)}
                </p>
              )}
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">รับชำระหนี้ (เงินสด / โอนเงิน)</p>
              <p className="text-xs font-bold text-slate-900 mt-0.5">
                สด: {formatBaht(stats.debtCollectedCash)} ({formatNumber(stats.debtPaymentCashCount)})
              </p>
              <p className="text-xs font-bold text-slate-700 mt-0.5">
                โอน: {formatBaht(stats.debtCollectedQr)} ({formatNumber(stats.debtPaymentQrCount)})
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">ส่วนต่าง (เก็บหนี้ - ปล่อยเชื่อ)</p>
              <p
                className={`text-sm font-extrabold mt-0.5 ${
                  stats.creditCollectionNet > 0
                    ? 'text-emerald-700'
                    : stats.creditCollectionNet < 0
                      ? 'text-rose-700'
                      : 'text-slate-900'
                }`}
              >
                {stats.creditCollectionNet > 0
                  ? `+${formatBaht(stats.creditCollectionNet)}`
                  : stats.creditCollectionNet < 0
                    ? `-${formatBaht(Math.abs(stats.creditCollectionNet))}`
                    : formatBaht(0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {stats.creditCollectionRatePct !== null
                  ? `อัตราเก็บหนี้ ${stats.creditCollectionRatePct.toFixed(1)}%`
                  : stats.debtCollectedTotal > 0
                    ? 'รับคืนล้วน (ไม่ปล่อยเชื่อ)'
                    : `ค้างรวม ${formatBaht(stats.totalOutstandingDebt)}`}
              </p>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-3 rounded-lg border border-slate-300 bg-slate-50 p-2 text-[11px]">
            <div>
              <span className="text-slate-500">สัดส่วนขายเชื่อต่อยอดขายรวม: </span>
              <span className="font-bold text-amber-800">
                {stats.creditExposurePct.toFixed(1)}%
              </span>
            </div>
            <div>
              <span className="text-slate-500">อัตราเก็บหนี้เทียบหนี้คงค้างรวม: </span>
              <span className="font-bold text-emerald-700">
                {stats.debtRecoveryVsOutstandingPct.toFixed(1)}%
              </span>
            </div>
            <div>
              <span className="text-slate-500">สภาพคล่องเงินเชื่อ: </span>
              <span className="font-bold text-slate-900">{stats.creditLiquidityStatus}</span>
            </div>
          </div>
        </div>

        {/* Payment Method Breakdown */}
        <div className="mb-5">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
            สัดส่วนช่องทางรับเงิน
          </h2>
          <table className="w-full border-collapse text-xs tabular-nums">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                <th className="py-1.5 px-2 font-bold">ช่องทางชำระเงิน</th>
                <th className="py-1.5 px-2 text-right font-bold">จำนวนบิล</th>
                <th className="py-1.5 px-2 text-right font-bold">สัดส่วน</th>
                <th className="py-1.5 px-2 text-right font-bold">ยอดรวม</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              <tr>
                <td className="py-1.5 px-2 font-semibold">เงินสด</td>
                <td className="py-1.5 px-2 text-right">{formatNumber(stats.cashCount)} บิล</td>
                <td className="py-1.5 px-2 text-right">{stats.cashPct.toFixed(1)}%</td>
                <td className="py-1.5 px-2 text-right font-bold">{formatBaht(stats.cashSales)}</td>
              </tr>
              <tr>
                <td className="py-1.5 px-2 font-semibold">PromptPay QR</td>
                <td className="py-1.5 px-2 text-right">{formatNumber(stats.qrCount)} บิล</td>
                <td className="py-1.5 px-2 text-right">{stats.qrPct.toFixed(1)}%</td>
                <td className="py-1.5 px-2 text-right font-bold">{formatBaht(stats.qrSales)}</td>
              </tr>
              <tr>
                <td className="py-1.5 px-2 font-semibold">เงินเชื่อ (ค้างชำระ)</td>
                <td className="py-1.5 px-2 text-right">{formatNumber(stats.creditCount)} บิล</td>
                <td className="py-1.5 px-2 text-right">{stats.creditPct.toFixed(1)}%</td>
                <td className="py-1.5 px-2 text-right font-bold">{formatBaht(stats.creditSales)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Ticket Size Distribution (A4 Print) */}
        <div className="mb-5">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1.5 mb-2">
            <h2 className="text-sm font-bold text-slate-900">
              การกระจายตัวของขนาดบิล (Order Value Distribution)
            </h2>
            <span className="text-[11px] text-slate-600 tabular-nums">
              เฉพาะบิลขายสำเร็จ ({formatNumber(stats.completedBillsCount)} บิล)
            </span>
          </div>
          {stats.completedBillsCount === 0 ? (
            <p className="text-xs text-slate-500 py-2">ไม่มีข้อมูลบิลขายสำเร็จในช่วงเวลานี้</p>
          ) : (
            <table className="w-full border-collapse text-xs tabular-nums">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                  <th scope="col" className="py-1.5 px-2 font-bold">ช่วงยอดซื้อ</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">จำนวนบิล</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">สัดส่วนบิล (%)</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">ยอดขายรวม</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">สัดส่วนยอดขาย (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stats.ticketSizeDistribution.map((tier) => (
                  <tr key={tier.key}>
                    <td className="py-1.5 px-2 font-semibold text-slate-900">{tier.label}</td>
                    <td className="py-1.5 px-2 text-right">{formatNumber(tier.count)} บิล</td>
                    <td className="py-1.5 px-2 text-right font-semibold">{tier.billPct.toFixed(1)}%</td>
                    <td className="py-1.5 px-2 text-right font-bold">{formatBaht(tier.revenue)}</td>
                    <td className="py-1.5 px-2 text-right font-semibold">{tier.revenuePct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-extrabold text-slate-900">
                  <td className="py-1.5 px-2">รวมทั้งหมด</td>
                  <td className="py-1.5 px-2 text-right">{formatNumber(stats.completedBillsCount)} บิล</td>
                  <td className="py-1.5 px-2 text-right">100.0%</td>
                  <td className="py-1.5 px-2 text-right">{formatBaht(stats.completedBillsRevenue)}</td>
                  <td className="py-1.5 px-2 text-right">100.0%</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Top 5 Products */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <h2 className="text-sm font-bold text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
              Top 5 สินค้าขายดี (ตามยอดขาย)
            </h2>
            {stats.topProducts.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">ไม่มีข้อมูลการขายสินค้าในช่วงเวลานี้</p>
            ) : (
              <table className="w-full border-collapse text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                    <th className="py-1.5 px-2 font-bold w-8">#</th>
                    <th className="py-1.5 px-2 font-bold">สินค้า</th>
                    <th className="py-1.5 px-2 text-right font-bold">จำนวน</th>
                    <th className="py-1.5 px-2 text-right font-bold">ยอดขาย</th>
                    <th className="py-1.5 px-2 text-right font-bold">กำไร</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {stats.topProducts.map((item, idx) => (
                    <tr key={item.name}>
                      <td className="py-1.5 px-2 font-bold text-slate-500">{idx + 1}</td>
                      <td className="py-1.5 px-2 font-semibold text-slate-900">{item.name}</td>
                      <td className="py-1.5 px-2 text-right">{formatNumber(item.qty)}</td>
                      <td className="py-1.5 px-2 text-right font-bold">{formatBaht(item.revenue)}</td>
                      <td className="py-1.5 px-2 text-right font-bold">{formatBaht(item.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h2 className="text-sm font-bold text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
              Top 5 สินค้าทำกำไรสูงสุด
            </h2>
            {stats.topProductsByProfit.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">ไม่มีข้อมูลการขายสินค้าในช่วงเวลานี้</p>
            ) : (
              <table className="w-full border-collapse text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                    <th className="py-1.5 px-2 font-bold w-8">#</th>
                    <th className="py-1.5 px-2 font-bold">สินค้า</th>
                    <th className="py-1.5 px-2 text-right font-bold">จำนวน</th>
                    <th className="py-1.5 px-2 text-right font-bold">ยอดขาย</th>
                    <th className="py-1.5 px-2 text-right font-bold">กำไรสุทธิ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {stats.topProductsByProfit.slice(0, 5).map((item, idx) => (
                    <tr key={item.name}>
                      <td className="py-1.5 px-2 font-bold text-slate-500">{idx + 1}</td>
                      <td className="py-1.5 px-2 font-semibold text-slate-900">{item.name}</td>
                      <td className="py-1.5 px-2 text-right">{formatNumber(item.qty)}</td>
                      <td className="py-1.5 px-2 text-right font-bold">{formatBaht(item.revenue)}</td>
                      <td className="py-1.5 px-2 text-right font-bold">{formatBaht(item.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Frequently Bought Together / Market Basket Pairs (A4 Print) */}
        <div className="mb-5">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1.5 mb-2">
            <h2 className="text-sm font-bold text-slate-900">
              คู่สินค้ายอดฮิตที่ลูกค้ามักซื้อพร้อมกัน (Market Basket Pairs)
            </h2>
            <span className="text-[11px] text-slate-600 tabular-nums">
              วิเคราะห์จากบิลที่มี ≥ 2 สินค้า {formatNumber(stats.multiItemBillsCount)} /{' '}
              {formatNumber(stats.totalBasketBills)} บิลทั้งหมด ({stats.multiItemBillsPct.toFixed(1)}%)
            </span>
          </div>
          {stats.topBasketPairs.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              ไม่มีข้อมูลคู่สินค้าที่ซื้อร่วมกันในช่วงเวลานี้
            </p>
          ) : (
            <>
              <table className="w-full border-collapse text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                    <th scope="col" className="py-1.5 px-2 font-bold w-8">#</th>
                    <th scope="col" className="py-1.5 px-2 font-bold">คู่สินค้าที่ซื้อพร้อมกัน</th>
                    <th scope="col" className="py-1.5 px-2 text-right font-bold">จำนวนบิลที่ซื้อคู่กัน</th>
                    <th scope="col" className="py-1.5 px-2 text-right font-bold">สัดส่วนของบิลทั้งหมด (%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {stats.topBasketPairs.map((pair, idx) => (
                    <tr key={pair.key}>
                      <td className="py-1.5 px-2 font-bold text-slate-500">{idx + 1}</td>
                      <td className="py-1.5 px-2 font-semibold text-slate-900">
                        {pair.productA} <span className="text-slate-500 font-bold">+</span>{' '}
                        {pair.productB}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold">
                        {formatNumber(pair.billCount)} บิล
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold">
                        {pair.pctOfAllBills.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-slate-500 mt-1.5">
                คำแนะนำ: ใช้จัดวางคู่สินค้าไว้ใกล้กันบนชั้นวาง หรือนำไปสร้างชุดสินค้าขายด่วนในหน้า POS
              </p>
            </>
          )}
        </div>

        {/* Member vs Walk-in Analysis (A4 Print) */}
        <div className="mb-5 tabular-nums">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1.5 mb-2">
            <h2 className="text-sm font-bold text-slate-900">
              เปรียบเทียบยอดขายลูกค้าประจำ vs ลูกค้าทั่วไป (Member vs Walk-in)
            </h2>
            <span className="text-[11px] text-slate-600">
              บิลสำเร็จทั้งหมด {formatNumber(stats.memberVsWalkIn.totalBills)} บิล
            </span>
          </div>
          {stats.memberVsWalkIn.totalBills === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              ไม่มีข้อมูลการขายที่สำเร็จในช่วงเวลานี้
            </p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                  <th scope="col" className="py-1.5 px-2 font-bold">กลุ่มลูกค้า</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">จำนวนบิล</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">สัดส่วนบิล</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">ยอดขายรวม</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">สัดส่วนยอดขาย</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">ยอดเฉลี่ย/บิล (AOV)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <td className="py-1.5 px-2 font-semibold text-slate-900">
                    ลูกค้าประจำ / สมาชิก (Member)
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    {formatNumber(stats.memberVsWalkIn.member.billCount)} บิล
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    {stats.memberVsWalkIn.member.billsPct.toFixed(1)}%
                  </td>
                  <td className="py-1.5 px-2 text-right font-bold text-slate-900">
                    {formatBaht(stats.memberVsWalkIn.member.salesTotal)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-semibold">
                    {stats.memberVsWalkIn.member.salesPct.toFixed(1)}%
                  </td>
                  <td className="py-1.5 px-2 text-right font-semibold">
                    {formatBaht(stats.memberVsWalkIn.member.aov)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 px-2 font-semibold text-slate-900">
                    ลูกค้าทั่วไปหน้าร้าน (Walk-in)
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    {formatNumber(stats.memberVsWalkIn.walkIn.billCount)} บิล
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    {stats.memberVsWalkIn.walkIn.billsPct.toFixed(1)}%
                  </td>
                  <td className="py-1.5 px-2 text-right font-bold text-slate-900">
                    {formatBaht(stats.memberVsWalkIn.walkIn.salesTotal)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-semibold">
                    {stats.memberVsWalkIn.walkIn.salesPct.toFixed(1)}%
                  </td>
                  <td className="py-1.5 px-2 text-right font-semibold">
                    {formatBaht(stats.memberVsWalkIn.walkIn.aov)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {/* Customer Credits, Loyalty & Container Deposits Summary (A4 Print) */}
        <div className="mb-5 tabular-nums">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1.5 mb-2">
            <h2 className="text-sm font-bold text-slate-900">
              สรุปบัญชีเงินฝากทอน แต้มสะสม และมัดจำภาชนะลูกค้า
            </h2>
            <span className="text-[11px] text-slate-600">
              ภาระคงค้างรวม {formatBaht(customerBenefitsSummary.totalLiabilityValue)}
            </span>
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                <th scope="col" className="py-1.5 px-2 font-bold">รายการ</th>
                <th scope="col" className="py-1.5 px-2 text-right font-bold">จำนวนลูกค้า / รายการ</th>
                <th scope="col" className="py-1.5 px-2 text-right font-bold">ยอดสะสม / คงค้าง</th>
                <th scope="col" className="py-1.5 px-2 text-right font-bold">มูลค่าเทียบเท่า (บาท)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              <tr>
                <td className="py-1.5 px-2 font-semibold text-slate-900">
                  เงินฝากทอนสะสมลูกค้า (Store Credit)
                </td>
                <td className="py-1.5 px-2 text-right">
                  {formatNumber(customerBenefitsSummary.storeCreditCustomerCount)} ราย
                </td>
                <td className="py-1.5 px-2 text-right font-semibold">
                  {formatBaht(customerBenefitsSummary.storeCreditTotal)}
                </td>
                <td className="py-1.5 px-2 text-right font-bold text-slate-900">
                  {formatBaht(customerBenefitsSummary.storeCreditTotal)}
                </td>
              </tr>
              <tr>
                <td className="py-1.5 px-2 font-semibold text-slate-900">
                  แต้มสะสมลูกค้า (10 แต้ม = ฿1)
                </td>
                <td className="py-1.5 px-2 text-right">
                  {formatNumber(customerBenefitsSummary.loyaltyCustomerCount)} ราย
                </td>
                <td className="py-1.5 px-2 text-right font-semibold">
                  {formatNumber(customerBenefitsSummary.loyaltyPointsTotal)} แต้ม
                </td>
                <td className="py-1.5 px-2 text-right font-bold text-slate-900">
                  {formatBaht(customerBenefitsSummary.loyaltyDiscountValue)}
                </td>
              </tr>
              <tr>
                <td className="py-1.5 px-2 font-semibold text-slate-900">
                  มัดจำขวด/ถังค้างคืน (Container Deposits)
                </td>
                <td className="py-1.5 px-2 text-right">
                  {formatNumber(customerBenefitsSummary.containerDepositCount)} รายการ (
                  {formatNumber(customerBenefitsSummary.containerDepositQtyTotal)} ใบ/ถัง)
                </td>
                <td className="py-1.5 px-2 text-right font-semibold">
                  {formatBaht(customerBenefitsSummary.containerDepositTotal)}
                </td>
                <td className="py-1.5 px-2 text-right font-bold text-slate-900">
                  {formatBaht(customerBenefitsSummary.containerDepositTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Single Unit (Retail) vs Multi-Pack Sales Mix (A4 Print) */}
        <div className="mb-5 tabular-nums">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1.5 mb-2">
            <h2 className="text-sm font-bold text-slate-900">
              เปรียบเทียบยอดขายปลีกชิ้นเดี่ยว vs ขายยกแพ็ค/ลัง (Retail vs Pack Mix)
            </h2>
            <span className="text-[11px] text-slate-600">
              รายการขายสำเร็จทั้งหมด {formatNumber(stats.retailVsPackMix.totalItems)} รายการ
            </span>
          </div>
          {stats.retailVsPackMix.totalItems === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              ไม่มีข้อมูลรายการสินค้าที่ขายสำเร็จในช่วงเวลานี้
            </p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                  <th scope="col" className="py-1.5 px-2 font-bold">รูปแบบการขาย</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">จำนวนรายการ</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">สัดส่วนรายการ</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">ยอดขายรวม</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">สัดส่วนยอดขาย</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">กำไรขั้นต้น (Margin)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <td className="py-1.5 px-2 font-semibold text-slate-900">
                    ขายปลีกหน่วยย่อย (ชิ้น/ขวด/ซอง)
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    {formatNumber(stats.retailVsPackMix.retail.itemCount)} รายการ
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    {stats.retailVsPackMix.retail.itemsPct.toFixed(1)}%
                  </td>
                  <td className="py-1.5 px-2 text-right font-bold text-slate-900">
                    {formatBaht(stats.retailVsPackMix.retail.revenue)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-semibold">
                    {stats.retailVsPackMix.retail.salesPct.toFixed(1)}%
                  </td>
                  <td className="py-1.5 px-2 text-right font-semibold">
                    {formatBaht(stats.retailVsPackMix.retail.profit)} ({stats.retailVsPackMix.retail.marginPct.toFixed(1)}%)
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 px-2 font-semibold text-slate-900">
                    ขายยกแพ็ค / โหล / ลัง (Multi-Pack)
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    {formatNumber(stats.retailVsPackMix.pack.itemCount)} รายการ
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    {stats.retailVsPackMix.pack.itemsPct.toFixed(1)}%
                  </td>
                  <td className="py-1.5 px-2 text-right font-bold text-slate-900">
                    {formatBaht(stats.retailVsPackMix.pack.revenue)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-semibold">
                    {stats.retailVsPackMix.pack.salesPct.toFixed(1)}%
                  </td>
                  <td className="py-1.5 px-2 text-right font-semibold">
                    {formatBaht(stats.retailVsPackMix.pack.profit)} ({stats.retailVsPackMix.pack.marginPct.toFixed(1)}%)
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {/* Top 5 Customers */}
        <div className="mb-5">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1.5 mb-2">
            <h2 className="text-sm font-bold text-slate-900">
              Top 5 ลูกค้าประจำที่มียอดซื้อสูงสุด
            </h2>
            {stats.uniqueCustomerCount > 0 && (
              <span className="text-[11px] text-slate-600 tabular-nums">
                ลูกค้าประจำทั้งหมด {formatNumber(stats.uniqueCustomerCount)} ราย · ยอดซื้อรวม{' '}
                {formatBaht(stats.regularCustomerSalesTotal)} (
                {stats.regularCustomerSharePct.toFixed(1)}% ของยอดขายรวม)
              </span>
            )}
          </div>
          {stats.topCustomers.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              ไม่มีข้อมูลการซื้อของลูกค้าประจำในช่วงเวลานี้
            </p>
          ) : (
            <table className="w-full border-collapse text-xs tabular-nums">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                  <th scope="col" className="py-1.5 px-2 font-bold w-8">#</th>
                  <th scope="col" className="py-1.5 px-2 font-bold">ชื่อลูกค้า</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">จำนวนบิล</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">ยอดซื้อสด/โอน</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">ยอดซื้อเชื่อ</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">ยอดซื้อรวม</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stats.topCustomers.map((cust, idx) => (
                  <tr key={cust.id}>
                    <td className="py-1.5 px-2 font-bold text-slate-500">{idx + 1}</td>
                    <td className="py-1.5 px-2 font-semibold text-slate-900">
                      {cust.name}
                      {cust.phone ? (
                        <span className="ml-1.5 text-[11px] font-normal text-slate-500">
                          ({cust.phone})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 px-2 text-right">{formatNumber(cust.billCount)} บิล</td>
                    <td className="py-1.5 px-2 text-right">{formatBaht(cust.cashQrSpend)}</td>
                    <td className="py-1.5 px-2 text-right">{formatBaht(cust.creditSpend)}</td>
                    <td className="py-1.5 px-2 text-right font-bold">{formatBaht(cust.totalSpend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Category Summary */}
        <div className="mb-6">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
            สรุปยอดขาย กำไรขั้นต้น และ % Margin รายหมวดหมู่ ({stats.categoryStats.length} หมวดหมู่)
          </h2>
          {stats.categoryStats.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">ไม่มีข้อมูลยอดขายรายหมวดหมู่ในช่วงเวลานี้</p>
          ) : (
            <table className="w-full border-collapse text-xs tabular-nums">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                  <th scope="col" className="py-1.5 px-2 font-bold">หมวดหมู่</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">รายการ</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">สัดส่วน</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">ยอดขาย</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">ต้นทุน</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">กำไรขั้นต้น</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">% Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stats.categoryStats.map((cat) => (
                  <tr key={cat.key}>
                    <td className="py-1.5 px-2 font-semibold text-slate-900">{cat.name}</td>
                    <td className="py-1.5 px-2 text-right">{formatNumber(cat.itemCount)}</td>
                    <td className="py-1.5 px-2 text-right">{cat.pct.toFixed(1)}%</td>
                    <td className="py-1.5 px-2 text-right font-bold">{formatBaht(cat.revenue)}</td>
                    <td className="py-1.5 px-2 text-right">{formatBaht(cat.cost)}</td>
                    <td className="py-1.5 px-2 text-right font-bold">
                      {cat.profit > 0 ? `+${formatBaht(cat.profit)}` : formatBaht(cat.profit)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-bold">{cat.marginPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-extrabold text-slate-900">
                  <td className="py-1.5 px-2">รวมทั้งหมด</td>
                  <td className="py-1.5 px-2 text-right">{formatNumber(stats.totalCategoryItems)}</td>
                  <td className="py-1.5 px-2 text-right">100.0%</td>
                  <td className="py-1.5 px-2 text-right">{formatBaht(stats.totalCategoryRevenue)}</td>
                  <td className="py-1.5 px-2 text-right">{formatBaht(stats.totalCategoryCost)}</td>
                  <td className="py-1.5 px-2 text-right">
                    {stats.totalCategoryProfit > 0
                      ? `+${formatBaht(stats.totalCategoryProfit)}`
                      : formatBaht(stats.totalCategoryProfit)}
                  </td>
                  <td className="py-1.5 px-2 text-right">{stats.categoryGrossMarginPct.toFixed(1)}%</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Supplier / Wholesaler Summary */}
        <div className="mb-6">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-300 pb-1.5 mb-2">
            วิเคราะห์ยอดขายและกำไรตามร้านค้าส่ง / ซัพพลายเออร์ ({stats.assignedSupplierCount} ซัพพลายเออร์)
          </h2>
          {stats.supplierStats.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              ไม่มีข้อมูลยอดขายแยกตามซัพพลายเออร์ในช่วงเวลานี้
            </p>
          ) : (
            <table className="w-full border-collapse text-xs tabular-nums">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                  <th scope="col" className="py-1.5 px-2 font-bold">ร้านค้าส่ง / ซัพพลายเออร์</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">จำนวนชิ้น</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">สัดส่วน</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">ยอดขาย</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">ต้นทุน</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">กำไรขั้นต้น</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">% Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stats.supplierStats.map((sup) => (
                  <tr key={sup.key}>
                    <td className="py-1.5 px-2 font-semibold text-slate-900">
                      {sup.name}
                      <span className="ml-1.5 text-[11px] font-normal text-slate-500">
                        ({formatNumber(sup.productCount)} สินค้า)
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right">{formatNumber(sup.qty)} ชิ้น</td>
                    <td className="py-1.5 px-2 text-right">{sup.pct.toFixed(1)}%</td>
                    <td className="py-1.5 px-2 text-right font-bold">{formatBaht(sup.revenue)}</td>
                    <td className="py-1.5 px-2 text-right">{formatBaht(sup.cost)}</td>
                    <td className="py-1.5 px-2 text-right font-bold">
                      {sup.profit > 0 ? `+${formatBaht(sup.profit)}` : formatBaht(sup.profit)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-bold">{sup.marginPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-extrabold text-slate-900">
                  <td className="py-1.5 px-2">รวมทั้งหมด</td>
                  <td className="py-1.5 px-2 text-right">{formatNumber(stats.totalSupplierQty)} ชิ้น</td>
                  <td className="py-1.5 px-2 text-right">100.0%</td>
                  <td className="py-1.5 px-2 text-right">{formatBaht(stats.totalSupplierRevenue)}</td>
                  <td className="py-1.5 px-2 text-right">{formatBaht(stats.totalSupplierCost)}</td>
                  <td className="py-1.5 px-2 text-right">
                    {stats.totalSupplierProfit > 0
                      ? `+${formatBaht(stats.totalSupplierProfit)}`
                      : formatBaht(stats.totalSupplierProfit)}
                  </td>
                  <td className="py-1.5 px-2 text-right">{stats.supplierGrossMarginPct.toFixed(1)}%</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Inventory Capital Health (A4 Print) */}
        <div className="mb-6 tabular-nums">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1.5 mb-2">
            <h2 className="text-sm font-bold text-slate-900">
              วิเคราะห์สุขภาพเงินทุนในสต็อก (Inventory Capital Health)
            </h2>
            <span className="text-[11px] text-slate-600">
              {formatNumber(stats.totalInventoryCapitalCount)} รายการที่มีสต็อก ({formatNumber(stats.totalInventoryCapitalUnits)} หน่วย)
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div className="rounded border border-slate-300 bg-slate-50 p-2">
              <span className="text-[11px] text-slate-500 block">มูลค่าทุนสต็อกรวม</span>
              <span className="font-extrabold text-slate-900 text-sm">
                {formatBaht(stats.totalInventoryCapitalCost)}
              </span>
              <span className="block text-[11px] text-slate-600">
                {formatNumber(stats.totalInventoryCapitalCount)} รายการ
              </span>
            </div>
            <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
              <span className="text-[11px] text-emerald-700 block">Active Moving (มีขาย)</span>
              <span className="font-extrabold text-emerald-800 text-sm">
                {formatBaht(stats.activeMovingCost)}
              </span>
              <span className="block text-[11px] text-emerald-700">
                {stats.activeMovingSharePct.toFixed(1)}% · {formatNumber(stats.activeMovingCount)} รายการ
              </span>
            </div>
            <div className="rounded border border-amber-200 bg-amber-50 p-2">
              <span className="text-[11px] text-amber-800 block">Non-Moving (ทุนจม)</span>
              <span className="font-extrabold text-amber-800 text-sm">
                {formatBaht(stats.totalZeroMovingCost)}
              </span>
              <span className="block text-[11px] text-amber-800">
                {stats.nonMovingSharePct.toFixed(1)}% · {formatNumber(stats.zeroMovingProducts.length)} รายการ
              </span>
            </div>
            <div className="rounded border border-rose-200 bg-rose-50 p-2">
              <span className="text-[11px] text-rose-700 block">ทุนเสี่ยงหมดอายุ/หมดอายุแล้ว</span>
              <span className="font-extrabold text-rose-700 text-sm">
                {formatBaht(stats.atRiskExpiryCost)}
              </span>
              <span className="block text-[11px] text-rose-700">
                {stats.atRiskExpirySharePct.toFixed(1)}% · หมดอายุ {formatNumber(stats.expiredStockCount)} / ใกล้หมด {formatNumber(stats.expiringSoonStockCount)}
              </span>
            </div>
          </div>
        </div>

        {/* Restock Budget Forecast (A4 Print) */}
        <div className="mb-6 tabular-nums">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1.5 mb-2">
            <h2 className="text-sm font-bold text-slate-900">
              ประมาณการงบสั่งซื้อเติมสต็อก (Restock Budget Forecast)
            </h2>
            <span className="text-[11px] text-slate-600">
              ตั้งเป้าชั้นวาง {formatNumber(stats.targetConfiguredCount)} รายการ · ต่ำกว่าเป้า {formatNumber(stats.belowTargetRestockCount)} รายการ
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs mb-2">
            <div className="rounded border border-rose-200 bg-rose-50 p-2">
              <span className="text-[11px] text-rose-700 block">งบสั่งซื้อเร่งด่วน (ขั้นวิกฤต)</span>
              <span className="font-extrabold text-rose-700 text-sm">
                {formatBaht(stats.criticalRestockBudget)}
              </span>
              <span className="block text-[11px] text-rose-700">
                {formatNumber(stats.criticalRestockCount)} รายการ (หมด {formatNumber(stats.criticalOutOfStockCount)}) · {formatNumber(stats.criticalRestockUnits)} หน่วย
              </span>
            </div>
            <div className="rounded border border-indigo-200 bg-indigo-50 p-2">
              <span className="text-[11px] text-indigo-700 block">งบเติมเต็มเป้าชั้นวาง (รวมทั้งหมด)</span>
              <span className="font-extrabold text-indigo-700 text-sm">
                {formatBaht(stats.fullTargetRestockBudget)}
              </span>
              <span className="block text-[11px] text-indigo-700">
                {formatNumber(stats.belowTargetRestockCount)} รายการ · {formatNumber(stats.fullTargetRestockUnits)} หน่วย
              </span>
            </div>
            <div className="rounded border border-slate-300 bg-slate-50 p-2">
              <span className="text-[11px] text-slate-600 block">งบเพิ่มเติมจากขั้นวิกฤต</span>
              <span className="font-extrabold text-slate-900 text-sm">
                {formatBaht(
                  Math.max(0, stats.fullTargetRestockBudget - stats.criticalRestockBudget)
                )}
              </span>
              <span className="block text-[11px] text-slate-600">
                {formatNumber(Math.max(0, stats.belowTargetRestockCount - stats.criticalRestockCount))} รายการรอเติมเต็มชั้นวาง
              </span>
            </div>
          </div>
          {stats.restockSupplierBreakdown.length > 0 && (
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-100 text-left">
                  <th className="py-1 px-2">ร้านค้าส่ง / ซัพพลายเออร์</th>
                  <th className="py-1 px-2 text-right">ขั้นวิกฤต</th>
                  <th className="py-1 px-2 text-right">งบขั้นวิกฤต</th>
                  <th className="py-1 px-2 text-right">ต่ำกว่าเป้า</th>
                  <th className="py-1 px-2 text-right">จำนวนเติม</th>
                  <th className="py-1 px-2 text-right">งบเติมเต็มเป้า</th>
                </tr>
              </thead>
              <tbody>
                {stats.restockSupplierBreakdown.map((sup) => (
                  <tr key={sup.supplierName} className="border-b border-slate-200">
                    <td className="py-1 px-2 font-medium">{sup.supplierName}</td>
                    <td className="py-1 px-2 text-right text-rose-700">
                      {formatNumber(sup.criticalCount)} รายการ
                    </td>
                    <td className="py-1 px-2 text-right font-semibold text-rose-700">
                      {formatBaht(sup.criticalBudget)}
                    </td>
                    <td className="py-1 px-2 text-right">
                      {formatNumber(sup.fullTargetCount)} รายการ
                    </td>
                    <td className="py-1 px-2 text-right">
                      {formatNumber(sup.totalUnits)} หน่วย
                    </td>
                    <td className="py-1 px-2 text-right font-bold text-indigo-700">
                      {formatBaht(sup.fullTargetBudget)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Stock Shrinkage & Adjustments (A4 Print) */}
        <div className="mb-6 tabular-nums">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1.5 mb-2">
            <h2 className="text-sm font-bold text-slate-900">
              วิเคราะห์ความสูญเสียและการปรับสต็อก (Stock Shrinkage &amp; Adjustments)
            </h2>
            <span className="text-[11px] text-slate-600">
              ปรับลด {formatNumber(stats.shrinkageCount)} ครั้ง · ปรับเพิ่ม {formatNumber(stats.adjustmentAddCount)} ครั้ง
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-2.5">
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">มูลค่าต้นทุนปรับลด / ความสูญเสีย</p>
              <p className="text-sm font-extrabold text-rose-700 mt-0.5">
                {stats.shrinkageCostTotal > 0 ? `-${formatBaht(stats.shrinkageCostTotal)}` : formatBaht(0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {formatNumber(stats.shrinkageCount)} ครั้ง · {formatNumber(stats.shrinkageUnitsTotal)} หน่วย
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">มูลค่าต้นทุนที่ปรับเพิ่ม</p>
              <p className="text-sm font-extrabold text-emerald-700 mt-0.5">
                {stats.adjustmentAddCostTotal > 0
                  ? `+${formatBaht(stats.adjustmentAddCostTotal)}`
                  : formatBaht(0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {formatNumber(stats.adjustmentAddCount)} ครั้ง · {formatNumber(stats.adjustmentAddUnitsTotal)} หน่วย
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">ผลต่างต้นทุนปรับสต็อกสุทธิ</p>
              <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                {stats.netAdjustmentCost > 0
                  ? `+${formatBaht(stats.netAdjustmentCost)}`
                  : stats.netAdjustmentCost < 0
                    ? `-${formatBaht(Math.abs(stats.netAdjustmentCost))}`
                    : formatBaht(0)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                รวมปรับยอดทั้งหมด {formatNumber(stats.totalAdjustmentCount)} รายการ
              </p>
            </div>
          </div>

          {stats.recentShrinkageItems.length === 0 ? (
            <p className="text-xs text-slate-500 py-1.5">
              ไม่มีรายการปรับลดสต็อกในช่วงเวลานี้
            </p>
          ) : (
            <>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                    <th scope="col" className="py-1.5 px-2 font-bold">วัน-เวลา</th>
                    <th scope="col" className="py-1.5 px-2 font-bold">สินค้า</th>
                    <th scope="col" className="py-1.5 px-2 font-bold">สาเหตุ / หมายเหตุ</th>
                    <th scope="col" className="py-1.5 px-2 text-right font-bold">จำนวนปรับลด</th>
                    <th scope="col" className="py-1.5 px-2 text-right font-bold">มูลค่าต้นทุน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {stats.recentShrinkageItems.slice(0, 15).map((item) => (
                    <tr key={item.id}>
                      <td className="py-1.5 px-2 text-slate-600 whitespace-nowrap">
                        {formatDateTime(item.createdAt)}
                      </td>
                      <td className="py-1.5 px-2 font-semibold text-slate-900">
                        {item.productName}
                      </td>
                      <td className="py-1.5 px-2 text-slate-600">{item.note}</td>
                      <td className="py-1.5 px-2 text-right font-bold text-rose-700 whitespace-nowrap">
                        -{formatNumber(item.absQty)} {item.baseUnit}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold text-rose-700 whitespace-nowrap">
                        -{formatBaht(item.costImpact)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stats.recentShrinkageItems.length > 15 && (
                <p className="text-[11px] text-slate-500 mt-1">
                  แสดง 15 รายการล่าสุด จากทั้งหมด {formatNumber(stats.recentShrinkageItems.length)} รายการปรับลดสต็อก
                </p>
              )}
            </>
          )}
        </div>

        {/* Void & Partial Return Audit (A4 Print) */}
        <div className="mb-6 tabular-nums">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1.5 mb-2">
            <h2 className="text-sm font-bold text-slate-900">
              ตรวจสอบการยกเลิกบิลและการรับคืนสินค้า (Void &amp; Refund Audit)
            </h2>
            <span className="text-[11px] text-slate-600">
              ยกเลิก {formatNumber(stats.cancelledSalesCount)} บิล · รับคืนบางรายการ {formatNumber(stats.partialReturnBillsCount)} บิล
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-2.5">
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">บิลที่ถูกยกเลิก (Void Bills)</p>
              <p className="text-sm font-extrabold text-rose-700 mt-0.5">
                {formatBaht(stats.cancelledSalesAmount)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {formatNumber(stats.cancelledSalesCount)} บิล
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">รับคืนสินค้าบางรายการ (Partial Returns)</p>
              <p className="text-sm font-extrabold text-amber-800 mt-0.5">
                {formatBaht(stats.partialReturnRefundTotal)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {formatNumber(stats.partialReturnBillsCount)} บิลที่มีการคืนเงิน
              </p>
            </div>
            <div className="rounded-lg border border-slate-300 p-2.5">
              <p className="text-[11px] font-semibold text-slate-500">มูลค่ายกเลิกและคืนเงินรวม</p>
              <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                {formatBaht(stats.voidReturnTotalImpact)}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                รวม {formatNumber(stats.cancelledSalesCount + stats.partialReturnBillsCount)} รายการ
              </p>
            </div>
          </div>

          {stats.voidReturnAuditItems.length === 0 ? (
            <p className="text-xs text-slate-500 py-1.5">
              ไม่มีบิลยกเลิกหรือรับคืนสินค้าในช่วงเวลานี้
            </p>
          ) : (
            <>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                    <th scope="col" className="py-1.5 px-2 font-bold">วัน-เวลา</th>
                    <th scope="col" className="py-1.5 px-2 font-bold">ประเภท</th>
                    <th scope="col" className="py-1.5 px-2 font-bold">ช่องทางชำระ</th>
                    <th scope="col" className="py-1.5 px-2 font-bold">รายละเอียด / หมายเหตุ</th>
                    <th scope="col" className="py-1.5 px-2 text-right font-bold">มูลค่า</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {stats.voidReturnAuditItems.slice(0, 15).map((item) => (
                    <tr key={item.id}>
                      <td className="py-1.5 px-2 text-slate-600 whitespace-nowrap">
                        {formatDateTime(item.createdAt)}
                      </td>
                      <td className="py-1.5 px-2 font-semibold whitespace-nowrap">
                        <span className={item.type === 'cancelled' ? 'text-rose-700' : 'text-amber-800'}>
                          {item.type === 'cancelled' ? 'ยกเลิกบิล' : 'รับคืนบางรายการ'}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-slate-600 whitespace-nowrap">
                        {PAYMENT_BADGE[item.paymentMethod]?.label ?? item.paymentMethod}
                      </td>
                      <td className="py-1.5 px-2 text-slate-600">{item.note}</td>
                      <td className="py-1.5 px-2 text-right font-bold whitespace-nowrap">
                        <span className={item.type === 'cancelled' ? 'text-rose-700' : 'text-amber-800'}>
                          {formatBaht(item.amount)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stats.voidReturnAuditItems.length > 15 && (
                <p className="text-[11px] text-slate-500 mt-1">
                  แสดง 15 รายการล่าสุด จากทั้งหมด {formatNumber(stats.voidReturnAuditItems.length)} รายการยกเลิก/รับคืน
                </p>
              )}
            </>
          )}
        </div>

        {/* Store Expense Category Breakdown (A4 Print) */}
        <div className="space-y-2 break-inside-avoid">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1">
            <h2 className="text-sm font-bold text-slate-900">
              วิเคราะห์โครงสร้างรายจ่ายร้านค้า (Store Expense Breakdown)
            </h2>
            <span className="text-xs text-slate-600 tabular-nums">
              รวม {formatNumber(stats.expenseTotalCount)} ครั้ง · {formatBaht(stats.otherExpense)} (
              {stats.expenseToSalesPct.toFixed(1)}% ของยอดขายสุทธิ)
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded border border-slate-200 p-2 bg-rose-50/40">
              <div className="text-[11px] text-slate-500">รายจ่ายร้านรวม</div>
              <div className="font-bold text-rose-700 text-sm tabular-nums">
                {formatBaht(stats.otherExpense)}
              </div>
              <div className="text-[11px] text-slate-500 tabular-nums">
                {formatNumber(stats.expenseTotalCount)} รายการ · {formatNumber(stats.expenseBreakdown.length)} หมวดหมู่
              </div>
            </div>
            <div className="rounded border border-slate-200 p-2 bg-amber-50/40">
              <div className="text-[11px] text-slate-500">สัดส่วนต่อยอดขายสุทธิ</div>
              <div className="font-bold text-amber-800 text-sm tabular-nums">
                {stats.expenseToSalesPct.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-500 tabular-nums">
                เทียบยอดขายสุทธิ {formatBaht(stats.totalSales)}
              </div>
            </div>
            <div className="rounded border border-slate-200 p-2 bg-slate-50">
              <div className="text-[11px] text-slate-500">หมวดรายจ่ายสูงสุด</div>
              <div className="font-bold text-slate-900 text-sm truncate">
                {stats.topExpenseCategory ? stats.topExpenseCategory.category : 'ไม่มีรายจ่าย'}
              </div>
              <div className="text-[11px] text-slate-500 tabular-nums">
                {stats.topExpenseCategory
                  ? `${formatBaht(stats.topExpenseCategory.amount)} (${stats.topExpenseCategory.sharePct.toFixed(1)}%)`
                  : '—'}
              </div>
            </div>
          </div>

          {stats.expenseBreakdown.length === 0 ? (
            <p className="text-xs text-slate-500 py-1.5">
              ไม่มีรายการรายจ่ายร้านค้าในช่วงเวลานี้
            </p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                  <th scope="col" className="py-1.5 px-2 font-bold">หมวดหมู่ / หมายเหตุ</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">จำนวนครั้ง</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">ยอดรวม</th>
                  <th scope="col" className="py-1.5 px-2 text-right font-bold">สัดส่วน %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stats.expenseBreakdown.map((cat) => (
                  <tr key={cat.category}>
                    <td className="py-1.5 px-2 font-semibold text-slate-800">{cat.category}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">
                      {formatNumber(cat.count)} ครั้ง
                    </td>
                    <td className="py-1.5 px-2 text-right font-bold tabular-nums text-rose-700">
                      {formatBaht(cat.amount)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-semibold tabular-nums text-slate-700">
                      {cat.sharePct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-900">
                  <td className="py-1.5 px-2">รวมรายจ่ายทั้งหมด</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {formatNumber(stats.expenseTotalCount)} ครั้ง
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-rose-700">
                    {formatBaht(stats.otherExpense)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">100.0%</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Peak Hours Breakdown (A4 Print) */}
        <div className="mb-6 space-y-2 break-inside-avoid">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1">
            <h2 className="text-sm font-bold text-slate-900">
              วิเคราะห์ชั่วโมงขายดีรายชั่วโมง (Peak Hours Breakdown)
            </h2>
            <span className="text-xs text-slate-600 tabular-nums">
              {stats.activeHourlyStats.length} ชั่วโมงที่ขายจริง
            </span>
          </div>

          {stats.activeHourlyStats.length === 0 ? (
            <p className="text-xs text-slate-500 py-1.5">
              ไม่มีข้อมูลการขายรายชั่วโมงในช่วงเวลานี้
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border border-emerald-200 bg-emerald-50/40 p-2">
                  <div className="text-[11px] text-slate-500">ชั่วโมงทำเงินสูงสุด (Peak by Revenue)</div>
                  <div className="font-bold text-emerald-800 text-sm tabular-nums">
                    {stats.peakHourByRevenue
                      ? `${stats.peakHourByRevenue.rangeLabel} · ${formatBaht(stats.peakHourByRevenue.amount)}`
                      : '—'}
                  </div>
                  {stats.peakHourByRevenue && (
                    <div className="text-[11px] text-slate-600 tabular-nums">
                      {formatNumber(stats.peakHourByRevenue.count)} บิล ({stats.peakHourByRevenue.pct.toFixed(1)}% ของยอดขาย)
                    </div>
                  )}
                </div>
                <div className="rounded border border-amber-200 bg-amber-50/40 p-2">
                  <div className="text-[11px] text-slate-500">ชั่วโมงบิลหนาแน่นสุด (Peak by Bills)</div>
                  <div className="font-bold text-amber-800 text-sm tabular-nums">
                    {stats.peakHourByBills
                      ? `${stats.peakHourByBills.rangeLabel} · ${formatNumber(stats.peakHourByBills.count)} บิล`
                      : '—'}
                  </div>
                  {stats.peakHourByBills && (
                    <div className="text-[11px] text-slate-600 tabular-nums">
                      ยอดขาย {formatBaht(stats.peakHourByBills.amount)} · เฉลี่ย {formatBaht(stats.peakHourByBills.avgTicket)}/บิล
                    </div>
                  )}
                </div>
              </div>

              <table className="w-full border-collapse text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                    <th scope="col" className="py-1.5 px-2 font-bold">ช่วงเวลา</th>
                    <th scope="col" className="py-1.5 px-2 text-right font-bold">จำนวนบิล</th>
                    <th scope="col" className="py-1.5 px-2 text-right font-bold">เฉลี่ย/บิล</th>
                    <th scope="col" className="py-1.5 px-2 text-right font-bold">ยอดขาย</th>
                    <th scope="col" className="py-1.5 px-2 text-right font-bold">สัดส่วน %</th>
                    <th scope="col" className="py-1.5 px-2 font-bold w-28">กราฟเทียบชั่วโมง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {stats.activeHourlyStats.map((h) => {
                    const isPeakRev = stats.peakHourByRevenue?.hour === h.hour;
                    const isPeakBill = stats.peakHourByBills?.hour === h.hour;
                    const barWidthPct =
                      stats.maxHourlyAmount > 0
                        ? Math.min(Math.max((h.amount / stats.maxHourlyAmount) * 100, 4), 100)
                        : 0;
                    return (
                      <tr key={h.hour} className={isPeakRev ? 'bg-emerald-50/40' : ''}>
                        <td className="py-1.5 px-2 font-semibold text-slate-900">
                          {h.rangeLabel}
                          {isPeakRev && (
                            <span className="ml-1.5 text-[11px] font-bold text-emerald-700">
                              [ยอดสูงสุด]
                            </span>
                          )}
                          {isPeakBill && (
                            <span className="ml-1.5 text-[11px] font-bold text-amber-700">
                              [บิลสูงสุด]
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right">{formatNumber(h.count)} บิล</td>
                        <td className="py-1.5 px-2 text-right">{formatBaht(h.avgTicket)}</td>
                        <td className="py-1.5 px-2 text-right font-bold">{formatBaht(h.amount)}</td>
                        <td className="py-1.5 px-2 text-right">{h.pct.toFixed(1)}%</td>
                        <td className="py-1.5 px-2">
                          <div className="h-2 w-full rounded bg-slate-100 overflow-hidden">
                            <div
                              style={{ width: `${barWidthPct}%` }}
                              className={`h-full rounded ${
                                isPeakRev ? 'bg-emerald-600' : 'bg-slate-600'
                              }`}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>

        {/* Promotional Items Performance (A4 Print) */}
        <div className="mb-6 space-y-2 break-inside-avoid">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1">
            <h2 className="text-sm font-bold text-slate-900">
              วิเคราะห์ยอดขายสินค้าติดป้ายโปรโมชั่น (Promotional Items Performance)
            </h2>
            <span className="text-xs text-slate-600 tabular-nums">
              ติดป้าย {formatNumber(stats.promoProductsStats.totalLabeledProducts)} รายการ · ขายออก{' '}
              {formatNumber(stats.promoProductsStats.soldPromoProductsCount)} รายการ
            </span>
          </div>

          {stats.promoProductsStats.totalLabeledProducts === 0 ? (
            <p className="text-xs text-slate-500 py-1.5">
              ยังไม่มีสินค้าที่ติดป้ายโปรโมชั่นในระบบ
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded border border-rose-200 bg-rose-50/40 p-2">
                  <div className="text-[11px] text-slate-500">ยอดขายสินค้าโปรโมชั่น</div>
                  <div className="font-bold text-rose-800 text-sm tabular-nums">
                    {formatBaht(stats.promoProductsStats.totalRevenue)}
                  </div>
                  <div className="text-[11px] text-slate-600 tabular-nums">
                    {stats.promoProductsStats.revenueSharePct.toFixed(1)}% ของยอดขายรวม (
                    {formatNumber(stats.promoProductsStats.totalBillsCount)} บิล)
                  </div>
                </div>
                <div className="rounded border border-amber-200 bg-amber-50/40 p-2">
                  <div className="text-[11px] text-slate-500">จำนวนชิ้นที่ขายได้</div>
                  <div className="font-bold text-amber-800 text-sm tabular-nums">
                    {formatNumber(stats.promoProductsStats.totalQty)} ชิ้น
                  </div>
                  <div className="text-[11px] text-slate-600 tabular-nums">
                    {formatNumber(stats.promoProductsStats.soldPromoProductsCount)} /{' '}
                    {formatNumber(stats.promoProductsStats.totalLabeledProducts)} รายการที่ติดป้าย
                  </div>
                </div>
                <div className="rounded border border-emerald-200 bg-emerald-50/40 p-2">
                  <div className="text-[11px] text-slate-500">กำไรขั้นต้นสินค้าโปรโมชั่น</div>
                  <div className="font-bold text-emerald-800 text-sm tabular-nums">
                    {formatBaht(stats.promoProductsStats.totalProfit)}
                  </div>
                  <div className="text-[11px] text-slate-600 tabular-nums">
                    GP {stats.promoProductsStats.grossMarginPct.toFixed(1)}% (
                    {stats.promoProductsStats.profitSharePct.toFixed(1)}% ของกำไรรวม)
                  </div>
                </div>
              </div>

              {stats.promoProductsStats.items.length === 0 ? (
                <p className="text-xs text-slate-500 py-1.5">
                  ไม่มียอดขายสินค้าที่ติดป้ายโปรโมชั่นในช่วงเวลานี้
                </p>
              ) : (
                <table className="w-full border-collapse text-xs tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                      <th scope="col" className="py-1.5 px-2 font-bold">สินค้า</th>
                      <th scope="col" className="py-1.5 px-2 font-bold">ป้ายโปรโมชั่น</th>
                      <th scope="col" className="py-1.5 px-2 text-right font-bold">จำนวน</th>
                      <th scope="col" className="py-1.5 px-2 text-right font-bold">ยอดขาย</th>
                      <th scope="col" className="py-1.5 px-2 text-right font-bold">กำไรขั้นต้น</th>
                      <th scope="col" className="py-1.5 px-2 text-right font-bold">GP%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {stats.promoProductsStats.items.slice(0, 15).map((row) => (
                      <tr key={row.productId}>
                        <td className="py-1.5 px-2 font-semibold text-slate-900">{row.name}</td>
                        <td className="py-1.5 px-2 text-rose-700 font-semibold">
                          {row.promoLabel}
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          {formatNumber(row.qty)} {row.baseUnit}
                        </td>
                        <td className="py-1.5 px-2 text-right font-bold">
                          {formatBaht(row.revenue)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-bold text-emerald-700">
                          {formatBaht(row.profit)}
                        </td>
                        <td className="py-1.5 px-2 text-right">{row.marginPct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        {/* Customer Segment Analysis (A4 Print) */}
        <div className="mb-6 space-y-2 break-inside-avoid">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1">
            <h2 className="text-sm font-bold text-slate-900">
              วิเคราะห์ยอดขายและหนี้ค้างตามกลุ่มลูกค้า (Customer Segment Analysis)
            </h2>
            <span className="text-xs text-slate-600 tabular-nums">
              จัดกลุ่ม {formatNumber(stats.customerSegmentStats.totalTaggedCustomers)} /{' '}
              {formatNumber(stats.customerSegmentStats.totalCustomersCount)} ราย (
              {formatNumber(stats.customerSegmentStats.totalSegmentsCount)} กลุ่ม)
            </span>
          </div>

          {stats.customerSegmentStats.totalCustomersCount === 0 ? (
            <p className="text-xs text-slate-500 py-1.5">ยังไม่มีข้อมูลลูกค้าสมาชิกในระบบ</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded border border-indigo-200 bg-indigo-50/40 p-2">
                  <div className="text-[11px] text-slate-500">ยอดขายลูกค้าที่จัดกลุ่ม</div>
                  <div className="font-bold text-indigo-800 text-sm tabular-nums">
                    {formatBaht(stats.customerSegmentStats.totalTaggedSales)}
                  </div>
                  <div className="text-[11px] text-slate-600 tabular-nums">
                    {stats.customerSegmentStats.taggedSalesSharePct.toFixed(1)}% ของยอดขายรวม (
                    {formatNumber(stats.customerSegmentStats.totalTaggedBills)} บิล)
                  </div>
                </div>
                <div className="rounded border border-sky-200 bg-sky-50/40 p-2">
                  <div className="text-[11px] text-slate-500">จำนวนลูกค้าที่จัดกลุ่ม</div>
                  <div className="font-bold text-sky-800 text-sm tabular-nums">
                    {formatNumber(stats.customerSegmentStats.totalTaggedCustomers)} ราย
                  </div>
                  <div className="text-[11px] text-slate-600 tabular-nums">
                    จากทั้งหมด {formatNumber(stats.customerSegmentStats.totalCustomersCount)} ราย
                  </div>
                </div>
                <div className="rounded border border-rose-200 bg-rose-50/40 p-2">
                  <div className="text-[11px] text-slate-500">หนี้ค้างชำระรวมทุกลูกค้า</div>
                  <div className="font-bold text-rose-700 text-sm tabular-nums">
                    {formatBaht(stats.customerSegmentStats.totalCustomerDebt)}
                  </div>
                  <div className="text-[11px] text-slate-600 tabular-nums">
                    กลุ่มที่จัดป้าย {formatBaht(stats.customerSegmentStats.totalTaggedDebt)}
                  </div>
                </div>
              </div>

              <table className="w-full border-collapse text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-50 text-left text-slate-600">
                    <th scope="col" className="py-1.5 px-2 font-bold">กลุ่มลูกค้า</th>
                    <th scope="col" className="py-1.5 px-2 text-right font-bold">ลูกค้า (ค้างชำระ)</th>
                    <th scope="col" className="py-1.5 px-2 text-right font-bold">จำนวนบิล</th>
                    <th scope="col" className="py-1.5 px-2 text-right font-bold">ยอดขายรวม</th>
                    <th scope="col" className="py-1.5 px-2 text-right font-bold">เฉลี่ย/บิล</th>
                    <th scope="col" className="py-1.5 px-2 text-right font-bold">หนี้ค้างชำระรวม</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {stats.customerSegmentStats.segments.map((seg) => (
                    <tr key={seg.label}>
                      <td className="py-1.5 px-2 font-semibold text-slate-900">{seg.label}</td>
                      <td className="py-1.5 px-2 text-right">
                        {formatNumber(seg.customerCount)} ราย
                        {seg.debtorCount > 0 ? ` (ค้าง ${formatNumber(seg.debtorCount)})` : ''}
                      </td>
                      <td className="py-1.5 px-2 text-right">{formatNumber(seg.billCount)} บิล</td>
                      <td className="py-1.5 px-2 text-right font-bold">
                        {formatBaht(seg.totalSales)}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        {seg.billCount > 0 ? formatBaht(seg.aov) : '-'}
                      </td>
                      <td
                        className={`py-1.5 px-2 text-right font-bold ${
                          seg.totalDebt > 0 ? 'text-rose-700' : 'text-slate-500'
                        }`}
                      >
                        {formatBaht(seg.totalDebt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        {/* Signature Footer */}
        <div className="pt-8 grid grid-cols-2 gap-12 text-center text-[11px] text-slate-600">
          <div>
            <div className="border-b border-slate-400 h-6 mb-1" />
            <span>ผู้จัดทำรายงาน</span>
          </div>
          <div>
            <div className="border-b border-slate-400 h-6 mb-1" />
            <span>ผู้ตรวจสอบ / เจ้าของร้าน</span>
          </div>
        </div>
      </div>
    </>
  );
}
