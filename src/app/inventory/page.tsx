'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  Plus,
  PackagePlus,
  Edit3,
  AlertTriangle,
  FolderPlus,
  Trash2,
  History,
  Boxes,
  Coins,
  ArrowUpDown,
  ClipboardList,
  Copy,
  Check,
  RotateCcw,
  EyeOff,
  Download,
  Upload,
  TrendingUp,
  X,
  ClipboardCheck,
  Printer,
  Tag,
  CalendarClock,
  Truck,
  MapPin,
  Database,
  PackageMinus,
  Barcode,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Modal } from '@/components/Modal';
import { createClient } from '@/lib/supabase/client';
import { formatBaht, formatDateTime, formatNumber } from '@/lib/format';
import type { Category, Product, StoreSettings } from '@/types/pos';

interface StockMovement {
  id: string;
  product_id: string;
  type: 'sale' | 'restock' | 'adjust';
  qty_change: number;
  note: string | null;
  created_at: string;
}

interface GlobalStockMovement extends StockMovement {
  products?: { name: string; base_unit: string } | null;
}

interface UnitDraft {
  id?: string;
  unit_name: string;
  conversion_rate: string;
  selling_price: string;
  is_default: boolean;
  barcode?: string;
}

interface CsvImportRow {
  rowNumber: number;
  name: string;
  categoryName: string;
  baseUnit: string;
  costPrice: number;
  sellingPrice: number;
  stockQty: number;
  lowAlert: number;
  barcode: string;
  error?: string;
}

const EXPIRY_DATES_STORAGE_KEY = 'inventory_expiry_dates_v1';
const SUPPLIERS_STORAGE_KEY = 'inventory_suppliers_v1';
const SHELF_LOCATIONS_STORAGE_KEY = 'inventory_shelf_locations_v1';
const ORDER_PACK_INFO_STORAGE_KEY = 'inventory_order_pack_info_v1';
const WHOLESALE_TIERS_STORAGE_KEY = 'inventory_wholesale_tiers_v1';
const SUBSTITUTE_NOTES_STORAGE_KEY = 'inventory_substitute_notes_v1';
const UNIT_BARCODES_STORAGE_KEY = 'inventory_unit_barcodes_v1';
const LAST_COST_HISTORY_STORAGE_KEY = 'inventory_last_cost_history_v1';
const TARGET_STOCK_STORAGE_KEY = 'inventory_target_stock_v1';
const PROMO_LABELS_STORAGE_KEY = 'inventory_promo_labels_v1';

const PROMO_LABEL_PRESETS = [
  '🔥 ขายดีประจำร้าน',
  '🎁 ซื้อ 2 แถม 1',
  '💥 ลดล้างสต็อก',
  '✨ สินค้ามาใหม่',
  '🧊 แช่เย็นพร้อมดื่ม',
] as const;

const parseTargetStockMap = (raw: string | null): Record<string, number> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, number> = {};
    for (const [productId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const num = Number(value);
      if (Number.isFinite(num) && num > 0) {
        clean[productId] = Math.round(num * 100) / 100;
      }
    }
    return clean;
  } catch {
    return {};
  }
};

interface LastCostHistoryEntry {
  prevCost: number;
  updatedAt: string;
}

const parseLastCostHistoryMap = (raw: string | null): Record<string, LastCostHistoryEntry> => {
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
};

const parseUnitBarcodesMap = (raw: string | null): Record<string, Record<string, string>> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, Record<string, string>> = {};
    for (const [productId, unitMap] of Object.entries(parsed as Record<string, unknown>)) {
      if (!unitMap || typeof unitMap !== 'object' || Array.isArray(unitMap)) continue;
      const cleanUnits: Record<string, string> = {};
      for (const [unitName, barcodeVal] of Object.entries(unitMap as Record<string, unknown>)) {
        const trimmedUnit = unitName.trim();
        if (trimmedUnit && typeof barcodeVal === 'string') {
          const trimmedBc = barcodeVal.trim();
          if (trimmedBc) {
            cleanUnits[trimmedUnit] = trimmedBc;
          }
        }
      }
      if (Object.keys(cleanUnits).length > 0) {
        clean[productId] = cleanUnits;
      }
    }
    return clean;
  } catch {
    return {};
  }
};

interface WholesaleTier {
  minQty: number;
  unitPrice: number;
}

const parseWholesaleTiersMap = (raw: string | null): Record<string, WholesaleTier> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, WholesaleTier> = {};
    for (const [productId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const entry = value as Record<string, unknown>;
        const minQty = Math.floor(Number(entry.minQty));
        const unitPrice = Number(entry.unitPrice);
        if (
          Number.isFinite(minQty) &&
          minQty >= 2 &&
          Number.isFinite(unitPrice) &&
          unitPrice > 0
        ) {
          clean[productId] = { minQty, unitPrice };
        }
      }
    }
    return clean;
  } catch {
    return {};
  }
};
const DEFAULT_SHELF_LOCATION_PRESETS = [
  'ชั้นวางหน้าร้าน',
  'ตู้แช่เย็น',
  'หลังเคาน์เตอร์',
  'สต็อกหลังร้าน',
] as const;
const DEFAULT_ORDER_PACK_PRESETS = [
  'แพ็ค 6 ชิ้น',
  'แพ็คโหล (12)',
  'ยกลัง (24)',
  'ยกลัง (48)',
  'กระสอบ/ถุงใหญ่',
] as const;

const parseProductTextMap = (raw: string | null): Record<string, string> => {
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
};

type ExpiryStatus = 'expired' | 'expiring_soon' | 'normal';

const WRITE_OFF_REASONS = [
  'สินค้าหมดอายุ',
  'ชำรุด/แตกหัก',
  'เบิกใช้ในร้าน',
  'สูญหาย',
] as const;
type WriteOffReason = (typeof WRITE_OFF_REASONS)[number];

interface ExpiryInfo {
  expiryIso: string;
  formattedDate: string;
  daysRemaining: number;
  status: ExpiryStatus;
}

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

const parseExpiryDatesMap = (raw: string | null): Record<string, string> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, string> = {};
    for (const [productId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (parseIsoDateUtcMs(trimmed) !== null) {
          clean[productId] = trimmed;
        }
      }
    }
    return clean;
  } catch {
    return {};
  }
};

interface InventoryMetaBackupParsed {
  keysPresent: Array<
    | typeof EXPIRY_DATES_STORAGE_KEY
    | typeof SUPPLIERS_STORAGE_KEY
    | typeof SHELF_LOCATIONS_STORAGE_KEY
    | typeof ORDER_PACK_INFO_STORAGE_KEY
    | typeof WHOLESALE_TIERS_STORAGE_KEY
    | typeof SUBSTITUTE_NOTES_STORAGE_KEY
    | typeof UNIT_BARCODES_STORAGE_KEY
    | typeof LAST_COST_HISTORY_STORAGE_KEY
    | typeof TARGET_STOCK_STORAGE_KEY
    | typeof PROMO_LABELS_STORAGE_KEY
  >;
  expiryDates?: Record<string, string>;
  suppliers?: Record<string, string>;
  shelfLocations?: Record<string, string>;
  orderPackInfos?: Record<string, string>;
  wholesaleTiers?: Record<string, WholesaleTier>;
  substituteNotes?: Record<string, string>;
  unitBarcodes?: Record<string, Record<string, string>>;
  lastCostHistory?: Record<string, LastCostHistoryEntry>;
  targetStocks?: Record<string, number>;
  promoLabels?: Record<string, string>;
  error?: string;
}

const isPlainRecordObject = (val: unknown): val is Record<string, unknown> =>
  Boolean(val) && typeof val === 'object' && !Array.isArray(val);

const parseInventoryMetaBackupJson = (rawText: string): InventoryMetaBackupParsed => {
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
    EXPIRY_DATES_STORAGE_KEY,
    SUPPLIERS_STORAGE_KEY,
    SHELF_LOCATIONS_STORAGE_KEY,
    ORDER_PACK_INFO_STORAGE_KEY,
    WHOLESALE_TIERS_STORAGE_KEY,
    SUBSTITUTE_NOTES_STORAGE_KEY,
    UNIT_BARCODES_STORAGE_KEY,
    LAST_COST_HISTORY_STORAGE_KEY,
    TARGET_STOCK_STORAGE_KEY,
    PROMO_LABELS_STORAGE_KEY,
  ] as const;

  const hasRootKey = allKeys.some((k) => Object.prototype.hasOwnProperty.call(parsed, k));
  const source: Record<string, unknown> =
    !hasRootKey && isPlainRecordObject(parsed.data) ? parsed.data : parsed;

  const keysPresent: InventoryMetaBackupParsed['keysPresent'] = [];
  const result: InventoryMetaBackupParsed = { keysPresent };

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
    if (key === EXPIRY_DATES_STORAGE_KEY) {
      result.expiryDates = parseExpiryDatesMap(serialized);
    } else if (key === SUPPLIERS_STORAGE_KEY) {
      result.suppliers = parseProductTextMap(serialized);
    } else if (key === SHELF_LOCATIONS_STORAGE_KEY) {
      result.shelfLocations = parseProductTextMap(serialized);
    } else if (key === ORDER_PACK_INFO_STORAGE_KEY) {
      result.orderPackInfos = parseProductTextMap(serialized);
    } else if (key === WHOLESALE_TIERS_STORAGE_KEY) {
      result.wholesaleTiers = parseWholesaleTiersMap(serialized);
    } else if (key === SUBSTITUTE_NOTES_STORAGE_KEY) {
      result.substituteNotes = parseProductTextMap(serialized);
    } else if (key === UNIT_BARCODES_STORAGE_KEY) {
      result.unitBarcodes = parseUnitBarcodesMap(serialized);
    } else if (key === LAST_COST_HISTORY_STORAGE_KEY) {
      result.lastCostHistory = parseLastCostHistoryMap(serialized);
    } else if (key === TARGET_STOCK_STORAGE_KEY) {
      result.targetStocks = parseTargetStockMap(serialized);
    } else if (key === PROMO_LABELS_STORAGE_KEY) {
      result.promoLabels = parseProductTextMap(serialized);
    }
  }

  if (keysPresent.length === 0) {
    return {
      keysPresent: [],
      error:
        'ไม่พบคีย์ตั้งค่าคลังสินค้าที่รองรับ (inventory_expiry_dates_v1, inventory_suppliers_v1, inventory_shelf_locations_v1, inventory_order_pack_info_v1, inventory_wholesale_tiers_v1, inventory_substitute_notes_v1, inventory_unit_barcodes_v1, inventory_last_cost_history_v1, inventory_target_stock_v1, inventory_promo_labels_v1)',
    };
  }

  return result;
};

const formatExpiryDateTh = (iso: string): string => {
  const utcMs = parseIsoDateUtcMs(iso);
  if (utcMs === null) return iso;
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(utcMs));
};

const getProductExpiryInfo = (
  expiryIso: string | undefined,
  todayIso: string
): ExpiryInfo | null => {
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
};

interface StockRunwayInfo {
  avgDailySold: number;
  daysRemaining: number;
  isUrgent: boolean;
  isCritical: boolean;
}

const getStockRunwayInfo = (
  stockQty: number,
  avgDailySold: number | undefined
): StockRunwayInfo | null => {
  if (!avgDailySold || avgDailySold <= 0 || stockQty <= 0) return null;
  const rawDays = stockQty / avgDailySold;
  if (!Number.isFinite(rawDays) || rawDays <= 0) return null;
  const daysRemaining =
    rawDays < 1 ? Math.max(0.1, Math.round(rawDays * 10) / 10) : Math.round(rawDays);
  return {
    avgDailySold,
    daysRemaining,
    isUrgent: daysRemaining <= 3,
    isCritical: daysRemaining <= 1,
  };
};

export default function InventoryPage() {
  const supabase = useMemo(() => createClient(), []);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [avgDailySoldMap, setAvgDailySoldMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showMoreInventoryTools, setShowMoreInventoryTools] = useState(false);

  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<
    | 'all'
    | 'low'
    | 'below_target'
    | 'runway_low'
    | 'out'
    | 'expiring'
    | 'inactive'
    | 'multi_unit'
    | 'no_barcode'
    | 'low_margin'
    | 'wholesale'
    | 'cost_up'
    | 'has_promo'
  >('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSupplier, setSelectedSupplier] = useState<string>('all');
  const [selectedShelfLocation, setSelectedShelfLocation] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name_asc' | 'stock_asc' | 'cost_desc'>('name_asc');
  const [expiryDates, setExpiryDates] = useState<Record<string, string>>({});
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [shelfLocations, setShelfLocations] = useState<Record<string, string>>({});
  const [orderPackInfos, setOrderPackInfos] = useState<Record<string, string>>({});
  const [wholesaleTiers, setWholesaleTiers] = useState<Record<string, WholesaleTier>>({});
  const [substituteNotes, setSubstituteNotes] = useState<Record<string, string>>({});
  const [unitBarcodes, setUnitBarcodes] = useState<Record<string, Record<string, string>>>({});
  const [lastCostHistory, setLastCostHistory] = useState<Record<string, LastCostHistoryEntry>>({});
  const [targetStocks, setTargetStocks] = useState<Record<string, number>>({});
  const [promoLabels, setPromoLabels] = useState<Record<string, string>>({});
  const [todayIso, setTodayIso] = useState('');

  // Restock Shopping List Modal
  const [shoppingListOpen, setShoppingListOpen] = useState(false);
  const [copiedShoppingList, setCopiedShoppingList] = useState(false);
  const [shoppingListDate, setShoppingListDate] = useState('');
  const [restockSupplierFilter, setRestockSupplierFilter] = useState<string>('all');

  // Printable Price Tags Modal
  const [priceTagsOpen, setPriceTagsOpen] = useState(false);
  const [selectedTagProductIds, setSelectedTagProductIds] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [showPackWholesaleOnTags, setShowPackWholesaleOnTags] = useState(true);
  const [showShelfAndTargetOnTag, setShowShelfAndTargetOnTag] = useState(true);

  // Deactivate / Hide & Restore Product State
  const [confirmDeactivateProduct, setConfirmDeactivateProduct] = useState<Product | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [copiedBarcodeId, setCopiedBarcodeId] = useState<string | null>(null);

  // Product Form Modal
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [baseUnit, setBaseUnit] = useState('ชิ้น');
  const [costPrice, setCostPrice] = useState('0');
  const [packCostHelperOpen, setPackCostHelperOpen] = useState(false);
  const [packCostInput, setPackCostInput] = useState('');
  const [packQtyInput, setPackQtyInput] = useState('12');
  const [stockQty, setStockQty] = useState('0');
  const [lowAlert, setLowAlert] = useState('5');
  const [targetStockInput, setTargetStockInput] = useState('');
  const [isQuickItem, setIsQuickItem] = useState(true);
  const [allowCustomPrice, setAllowCustomPrice] = useState(false);
  const [expiryDate, setExpiryDate] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [shelfLocation, setShelfLocation] = useState('');
  const [orderPackInfo, setOrderPackInfo] = useState('');
  const [substituteNote, setSubstituteNote] = useState('');
  const [promoLabel, setPromoLabel] = useState('');
  const [wholesaleMinQty, setWholesaleMinQty] = useState('');
  const [wholesaleUnitPrice, setWholesaleUnitPrice] = useState('');
  const [wholesaleError, setWholesaleError] = useState('');
  const [units, setUnits] = useState<UnitDraft[]>([
    { unit_name: 'ชิ้น', conversion_rate: '1', selling_price: '10', is_default: true },
  ]);
  const [saving, setSaving] = useState(false);

  // Restock Modal
  const [restockProduct, setRestockProduct] = useState<Product | null>(null);
  const [restockUnitConv, setRestockUnitConv] = useState('1');
  const [restockQty, setRestockQty] = useState('1');
  const [restockCost, setRestockCost] = useState('');

  // Batch Restock Modal (Bulk Stock Receive)
  const [batchRestockOpen, setBatchRestockOpen] = useState(false);
  const [batchSearch, setBatchSearch] = useState('');
  const [batchFilterMode, setBatchFilterMode] = useState<'all' | 'filled' | 'low'>('all');
  const [batchNote, setBatchNote] = useState('');
  const [batchDrafts, setBatchDrafts] = useState<
    Record<
      string,
      {
        unitConv: string;
        unitName: string;
        qty: string;
        cost: string;
      }
    >
  >({});
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [batchResultMsg, setBatchResultMsg] = useState('');
  const [batchPackCalcPrice, setBatchPackCalcPrice] = useState('');
  const [batchPackCalcQty, setBatchPackCalcQty] = useState('12');
  const [batchPackTargetId, setBatchPackTargetId] = useState('');

  // Category Modal (Manage Categories: Add / Edit / Delete)
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [catSaving, setCatSaving] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [confirmDeleteCatId, setConfirmDeleteCatId] = useState<string | null>(null);
  const [catActionLoadingId, setCatActionLoadingId] = useState<string | null>(null);

  // Quick Stock Audit Mode
  const [quickAuditMode, setQuickAuditMode] = useState(false);
  const [quickAuditInputs, setQuickAuditInputs] = useState<Record<string, string>>({});
  const [quickAuditSavingId, setQuickAuditSavingId] = useState<string | null>(null);
  const [quickAuditSavedId, setQuickAuditSavedId] = useState<string | null>(null);

  // Stock Audit Modal (Compare actual counted stock vs system stock)
  const [stockAuditOpen, setStockAuditOpen] = useState(false);
  const [stockAuditSearch, setStockAuditSearch] = useState('');
  const [stockAuditInputs, setStockAuditInputs] = useState<Record<string, string>>({});
  const [stockAuditSaving, setStockAuditSaving] = useState(false);
  const [stockAuditError, setStockAuditError] = useState('');
  const [stockAuditResultMsg, setStockAuditResultMsg] = useState('');
  const [printMode, setPrintMode] = useState<'price_tags' | 'audit_sheet' | 'purchase_order'>('price_tags');
  const [auditPrintDateText, setAuditPrintDateText] = useState('');
  const [poPrintDateText, setPoPrintDateText] = useState('');
  const [printSeq, setPrintSeq] = useState(0);

  // Stock Adjust & History Modal
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [actualStockQty, setActualStockQty] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);

  // Stock Write-Off Modal (ตัดของเสีย / หมดอายุ / เบิกใช้ในร้าน)
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [writeOffProductId, setWriteOffProductId] = useState('');
  const [writeOffSearch, setWriteOffSearch] = useState('');
  const [writeOffUnitConv, setWriteOffUnitConv] = useState('1');
  const [writeOffQty, setWriteOffQty] = useState('1');
  const [writeOffReason, setWriteOffReason] = useState<WriteOffReason>('ชำรุด/แตกหัก');
  const [writeOffNote, setWriteOffNote] = useState('');
  const [writeOffSaving, setWriteOffSaving] = useState(false);
  const [writeOffError, setWriteOffError] = useState('');
  const [writeOffResultMsg, setWriteOffResultMsg] = useState('');

  // Global Stock Movements Modal (Store-wide, latest 50)
  const [globalMovementsOpen, setGlobalMovementsOpen] = useState(false);
  const [globalMovements, setGlobalMovements] = useState<GlobalStockMovement[]>([]);
  const [globalMovementsLoading, setGlobalMovementsLoading] = useState(false);
  const [globalMovementFilter, setGlobalMovementFilter] = useState<
    'all' | 'sale' | 'restock' | 'adjust'
  >('all');

  // Import Products CSV Modal
  const [importCsvOpen, setImportCsvOpen] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importRows, setImportRows] = useState<CsvImportRow[]>([]);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');

  // Bulk Price Update Modal
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  const [bulkPriceSearch, setBulkPriceSearch] = useState('');
  const [bulkPriceOnlyCostUp, setBulkPriceOnlyCostUp] = useState(false);
  const [bulkPriceDrafts, setBulkPriceDrafts] = useState<
    Record<
      string,
      {
        costPrice: string;
        sellingPrice: string;
        lowStockAlert: string;
        targetStock: string;
        promoLabel: string;
      }
    >
  >({});
  const [bulkPriceSaving, setBulkPriceSaving] = useState(false);
  const [bulkPriceError, setBulkPriceError] = useState('');

  // Bulk Auto-Generate Store Barcodes Modal
  const [bulkBarcodeOpen, setBulkBarcodeOpen] = useState(false);
  const [bulkBarcodeDrafts, setBulkBarcodeDrafts] = useState<
    Array<{ product: Product; barcode: string }>
  >([]);
  const [bulkBarcodeSaving, setBulkBarcodeSaving] = useState(false);
  const [bulkBarcodeError, setBulkBarcodeError] = useState('');
  const [bulkBarcodeSavedIds, setBulkBarcodeSavedIds] = useState<string[]>([]);

  // Inventory Metadata Backup / Restore JSON Modal
  const [metaBackupOpen, setMetaBackupOpen] = useState(false);
  const [metaBackupJsonInput, setMetaBackupJsonInput] = useState('');
  const [metaBackupFileName, setMetaBackupFileName] = useState('');
  const [metaRestoreMode, setMetaRestoreMode] = useState<'replace' | 'merge'>('replace');
  const [metaBackupError, setMetaBackupError] = useState('');
  const [metaBackupSuccess, setMetaBackupSuccess] = useState('');
  const [metaCopied, setMetaCopied] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const sevenDaysAgoIso = new Date(new Date().getTime() - 7 * 86_400_000).toISOString();

    const [{ data: st }, { data: cats }, { data: prods }, { data: recentSalesMovements }] =
      await Promise.all([
        supabase.from('store_settings').select('*').limit(1).maybeSingle(),
        supabase.from('categories').select('*').order('sort_order', { ascending: true }),
        supabase
          .from('products')
          .select('*, product_units(*), categories(*)')
          .order('name', { ascending: true }),
        supabase
          .from('stock_movements')
          .select('product_id, qty_change')
          .eq('type', 'sale')
          .gte('created_at', sevenDaysAgoIso),
      ]);

    const sold7dByProduct: Record<string, number> = {};
    for (const m of (recentSalesMovements as Array<{
      product_id: string;
      qty_change: number;
    }> | null) ?? []) {
      if (!m.product_id) continue;
      const soldQty = Math.abs(Number(m.qty_change) || 0);
      if (soldQty > 0) {
        sold7dByProduct[m.product_id] = (sold7dByProduct[m.product_id] ?? 0) + soldQty;
      }
    }

    const nextAvgDailySold: Record<string, number> = {};
    for (const [productId, totalSold7d] of Object.entries(sold7dByProduct)) {
      const avgDailySold = totalSold7d / 7;
      if (avgDailySold > 0) {
        nextAvgDailySold[productId] = avgDailySold;
      }
    }

    setSettings(st ?? null);
    setCategories(cats ?? []);
    setProducts((prods as Product[]) ?? []);
    setAvgDailySoldMap(nextAvgDailySold);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    setTodayIso(`${yyyy}-${mm}-${dd}`);
    setShoppingListDate(
      now.toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    );
    try {
      const raw = window.localStorage.getItem(EXPIRY_DATES_STORAGE_KEY);
      setExpiryDates(parseExpiryDatesMap(raw));
    } catch {
      // Ignore malformed or restricted localStorage
    }
    try {
      const rawSuppliers = window.localStorage.getItem(SUPPLIERS_STORAGE_KEY);
      setSuppliers(parseProductTextMap(rawSuppliers));
    } catch {
      // Ignore malformed or restricted localStorage
    }
    try {
      const rawShelfLocations = window.localStorage.getItem(SHELF_LOCATIONS_STORAGE_KEY);
      setShelfLocations(parseProductTextMap(rawShelfLocations));
    } catch {
      // Ignore malformed or restricted localStorage
    }
    try {
      const rawOrderPackInfos = window.localStorage.getItem(ORDER_PACK_INFO_STORAGE_KEY);
      setOrderPackInfos(parseProductTextMap(rawOrderPackInfos));
    } catch {
      // Ignore malformed or restricted localStorage
    }
    try {
      const rawWholesaleTiers = window.localStorage.getItem(WHOLESALE_TIERS_STORAGE_KEY);
      setWholesaleTiers(parseWholesaleTiersMap(rawWholesaleTiers));
    } catch {
      // Ignore malformed or restricted localStorage
    }
    try {
      const rawSubstituteNotes = window.localStorage.getItem(SUBSTITUTE_NOTES_STORAGE_KEY);
      setSubstituteNotes(parseProductTextMap(rawSubstituteNotes));
    } catch {
      // Ignore malformed or restricted localStorage
    }
    try {
      const rawUnitBarcodes = window.localStorage.getItem(UNIT_BARCODES_STORAGE_KEY);
      setUnitBarcodes(parseUnitBarcodesMap(rawUnitBarcodes));
    } catch {
      // Ignore malformed or restricted localStorage
    }
    try {
      const rawLastCostHistory = window.localStorage.getItem(LAST_COST_HISTORY_STORAGE_KEY);
      setLastCostHistory(parseLastCostHistoryMap(rawLastCostHistory));
    } catch {
      // Ignore malformed or restricted localStorage
    }
    try {
      const rawTargetStocks = window.localStorage.getItem(TARGET_STOCK_STORAGE_KEY);
      setTargetStocks(parseTargetStockMap(rawTargetStocks));
    } catch {
      // Ignore malformed or restricted localStorage
    }
    try {
      const rawPromoLabels = window.localStorage.getItem(PROMO_LABELS_STORAGE_KEY);
      setPromoLabels(parseProductTextMap(rawPromoLabels));
    } catch {
      // Ignore malformed or restricted localStorage
    }
    loadData();
  }, [loadData]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === EXPIRY_DATES_STORAGE_KEY || e.key === null) {
        try {
          const raw = window.localStorage.getItem(EXPIRY_DATES_STORAGE_KEY);
          setExpiryDates(parseExpiryDatesMap(raw));
        } catch {
          // Ignore malformed or restricted localStorage
        }
      }
      if (e.key === SUPPLIERS_STORAGE_KEY || e.key === null) {
        try {
          const rawSuppliers = window.localStorage.getItem(SUPPLIERS_STORAGE_KEY);
          setSuppliers(parseProductTextMap(rawSuppliers));
        } catch {
          // Ignore malformed or restricted localStorage
        }
      }
      if (e.key === SHELF_LOCATIONS_STORAGE_KEY || e.key === null) {
        try {
          const rawShelfLocations = window.localStorage.getItem(SHELF_LOCATIONS_STORAGE_KEY);
          setShelfLocations(parseProductTextMap(rawShelfLocations));
        } catch {
          // Ignore malformed or restricted localStorage
        }
      }
      if (e.key === ORDER_PACK_INFO_STORAGE_KEY || e.key === null) {
        try {
          const rawOrderPackInfos = window.localStorage.getItem(ORDER_PACK_INFO_STORAGE_KEY);
          setOrderPackInfos(parseProductTextMap(rawOrderPackInfos));
        } catch {
          // Ignore malformed or restricted localStorage
        }
      }
      if (e.key === WHOLESALE_TIERS_STORAGE_KEY || e.key === null) {
        try {
          const rawWholesaleTiers = window.localStorage.getItem(WHOLESALE_TIERS_STORAGE_KEY);
          setWholesaleTiers(parseWholesaleTiersMap(rawWholesaleTiers));
        } catch {
          // Ignore malformed or restricted localStorage
        }
      }
      if (e.key === SUBSTITUTE_NOTES_STORAGE_KEY || e.key === null) {
        try {
          const rawSubstituteNotes = window.localStorage.getItem(SUBSTITUTE_NOTES_STORAGE_KEY);
          setSubstituteNotes(parseProductTextMap(rawSubstituteNotes));
        } catch {
          // Ignore malformed or restricted localStorage
        }
      }
      if (e.key === UNIT_BARCODES_STORAGE_KEY || e.key === null) {
        try {
          const rawUnitBarcodes = window.localStorage.getItem(UNIT_BARCODES_STORAGE_KEY);
          setUnitBarcodes(parseUnitBarcodesMap(rawUnitBarcodes));
        } catch {
          // Ignore malformed or restricted localStorage
        }
      }
      if (e.key === LAST_COST_HISTORY_STORAGE_KEY || e.key === null) {
        try {
          const rawLastCostHistory = window.localStorage.getItem(LAST_COST_HISTORY_STORAGE_KEY);
          setLastCostHistory(parseLastCostHistoryMap(rawLastCostHistory));
        } catch {
          // Ignore malformed or restricted localStorage
        }
      }
      if (e.key === TARGET_STOCK_STORAGE_KEY || e.key === null) {
        try {
          const rawTargetStocks = window.localStorage.getItem(TARGET_STOCK_STORAGE_KEY);
          setTargetStocks(parseTargetStockMap(rawTargetStocks));
        } catch {
          // Ignore malformed or restricted localStorage
        }
      }
      if (e.key === PROMO_LABELS_STORAGE_KEY || e.key === null) {
        try {
          const rawPromoLabels = window.localStorage.getItem(PROMO_LABELS_STORAGE_KEY);
          setPromoLabels(parseProductTextMap(rawPromoLabels));
        } catch {
          // Ignore malformed or restricted localStorage
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const saveLastCostHistoryEntries = (
    entries: Array<{ productId: string; prevCost: number; updatedAt: string }>
  ) => {
    if (entries.length === 0) return;
    let base: Record<string, LastCostHistoryEntry> = lastCostHistory;
    try {
      const latestRaw = window.localStorage.getItem(LAST_COST_HISTORY_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseLastCostHistoryMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    for (const entry of entries) {
      if (!entry.productId || !Number.isFinite(entry.prevCost) || entry.prevCost < 0) continue;
      next[entry.productId] = {
        prevCost: entry.prevCost,
        updatedAt: entry.updatedAt,
      };
    }
    try {
      window.localStorage.setItem(LAST_COST_HISTORY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors while still updating in-memory state
    }
    setLastCostHistory(next);
  };

  const clearLastCostHistoryEntries = (productIds: string[]) => {
    if (productIds.length === 0) return;
    let base: Record<string, LastCostHistoryEntry> = lastCostHistory;
    try {
      const latestRaw = window.localStorage.getItem(LAST_COST_HISTORY_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseLastCostHistoryMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    let changed = false;
    for (const id of productIds) {
      if (id in next) {
        delete next[id];
        changed = true;
      }
    }
    if (!changed) return;
    try {
      window.localStorage.setItem(LAST_COST_HISTORY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors while still updating in-memory state
    }
    setLastCostHistory(next);
  };

  const saveProductExpiryDate = (productId: string, rawDate: string) => {
    const trimmed = rawDate.trim();
    const isValidIso = parseIsoDateUtcMs(trimmed) !== null;
    let base: Record<string, string> = expiryDates;
    try {
      const latestRaw = window.localStorage.getItem(EXPIRY_DATES_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseExpiryDatesMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    if (isValidIso) {
      next[productId] = trimmed;
    } else {
      delete next[productId];
    }
    try {
      window.localStorage.setItem(EXPIRY_DATES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setExpiryDates(next);
  };

  const saveProductUnitBarcodes = (
    productId: string,
    unitDrafts: UnitDraft[],
    fallbackBaseUnit: string
  ) => {
    const unitMap: Record<string, string> = {};
    for (const u of unitDrafts) {
      const unitName = u.unit_name.trim() || fallbackBaseUnit || 'ชิ้น';
      const bc = (u.barcode ?? '').trim();
      if (bc) {
        unitMap[unitName] = bc;
      }
    }

    let base: Record<string, Record<string, string>> = unitBarcodes;
    try {
      const latestRaw = window.localStorage.getItem(UNIT_BARCODES_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseUnitBarcodesMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    if (Object.keys(unitMap).length > 0) {
      next[productId] = unitMap;
    } else {
      delete next[productId];
    }
    try {
      window.localStorage.setItem(UNIT_BARCODES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setUnitBarcodes(next);
  };

  const saveProductTextMeta = (
    storageKey: string,
    currentMap: Record<string, string>,
    setMap: (next: Record<string, string>) => void,
    productId: string,
    rawValue: string
  ) => {
    const trimmed = rawValue.trim();
    let base: Record<string, string> = currentMap;
    try {
      const latestRaw = window.localStorage.getItem(storageKey);
      if (latestRaw !== null) {
        base = parseProductTextMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    if (trimmed) {
      next[productId] = trimmed;
    } else {
      delete next[productId];
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setMap(next);
  };

  const saveProductSupplier = (productId: string, rawSupplier: string) => {
    saveProductTextMeta(SUPPLIERS_STORAGE_KEY, suppliers, setSuppliers, productId, rawSupplier);
  };

  const saveProductShelfLocation = (productId: string, rawLocation: string) => {
    saveProductTextMeta(
      SHELF_LOCATIONS_STORAGE_KEY,
      shelfLocations,
      setShelfLocations,
      productId,
      rawLocation
    );
  };

  const saveProductOrderPackInfo = (productId: string, rawPackInfo: string) => {
    saveProductTextMeta(
      ORDER_PACK_INFO_STORAGE_KEY,
      orderPackInfos,
      setOrderPackInfos,
      productId,
      rawPackInfo
    );
  };

  const saveProductSubstituteNote = (productId: string, rawSubstituteNote: string) => {
    saveProductTextMeta(
      SUBSTITUTE_NOTES_STORAGE_KEY,
      substituteNotes,
      setSubstituteNotes,
      productId,
      rawSubstituteNote
    );
  };

  const saveProductPromoLabel = (productId: string, rawPromoLabel: string) => {
    saveProductTextMeta(
      PROMO_LABELS_STORAGE_KEY,
      promoLabels,
      setPromoLabels,
      productId,
      rawPromoLabel
    );
  };

  const saveProductTargetStock = (productId: string, rawTargetStock: string) => {
    const trimmed = rawTargetStock.trim();
    const parsed = Number(trimmed);
    const isValid = trimmed !== '' && Number.isFinite(parsed) && parsed > 0;
    let base: Record<string, number> = targetStocks;
    try {
      const latestRaw = window.localStorage.getItem(TARGET_STOCK_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseTargetStockMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }
    const next = { ...base };
    if (isValid) {
      next[productId] = Math.round(parsed * 100) / 100;
    } else {
      delete next[productId];
    }
    try {
      window.localStorage.setItem(TARGET_STOCK_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setTargetStocks(next);
  };

  const saveProductWholesaleTier = (
    productId: string,
    rawMinQty: string,
    rawUnitPrice: string
  ) => {
    const minTrimmed = rawMinQty.trim();
    const priceTrimmed = rawUnitPrice.trim();
    const parsedMin = Math.floor(Number(minTrimmed));
    const parsedPrice = Number(priceTrimmed);
    const isValid =
      minTrimmed !== '' &&
      priceTrimmed !== '' &&
      Number.isFinite(parsedMin) &&
      parsedMin >= 2 &&
      Number.isFinite(parsedPrice) &&
      parsedPrice > 0;

    let base: Record<string, WholesaleTier> = wholesaleTiers;
    try {
      const latestRaw = window.localStorage.getItem(WHOLESALE_TIERS_STORAGE_KEY);
      if (latestRaw !== null) {
        base = parseWholesaleTiersMap(latestRaw);
      }
    } catch {
      // Fallback to in-memory state
    }

    const next = { ...base };
    if (isValid) {
      next[productId] = { minQty: parsedMin, unitPrice: parsedPrice };
    } else {
      delete next[productId];
    }

    try {
      window.localStorage.setItem(WHOLESALE_TIERS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    setWholesaleTiers(next);
  };

  const savedSupplierOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const val of Object.values(suppliers)) {
      const trimmed = val.trim();
      if (trimmed) unique.add(trimmed);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b, 'th'));
  }, [suppliers]);

  const savedCustomShelfOptions = useMemo(() => {
    const presetSet = new Set<string>(DEFAULT_SHELF_LOCATION_PRESETS);
    const unique = new Set<string>();
    for (const val of Object.values(shelfLocations)) {
      const trimmed = val.trim();
      if (trimmed && !presetSet.has(trimmed)) unique.add(trimmed);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b, 'th'));
  }, [shelfLocations]);

  const savedCustomOrderPackOptions = useMemo(() => {
    const presetSet = new Set<string>(DEFAULT_ORDER_PACK_PRESETS);
    const unique = new Set<string>();
    for (const val of Object.values(orderPackInfos)) {
      const trimmed = val.trim();
      if (trimmed && !presetSet.has(trimmed)) unique.add(trimmed);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b, 'th'));
  }, [orderPackInfos]);

  const activeProducts = useMemo(
    () => products.filter((p) => p.is_active !== false),
    [products]
  );

  const inactiveProducts = useMemo(
    () => products.filter((p) => p.is_active === false),
    [products]
  );

  const lowStockProducts = useMemo(
    () =>
      activeProducts
        .filter((p) => !p.allow_custom_price && p.stock_qty <= p.low_stock_alert)
        .sort((a, b) => (Number(a.stock_qty) || 0) - (Number(b.stock_qty) || 0)),
    [activeProducts]
  );

  const outOfStockProducts = useMemo(
    () =>
      activeProducts.filter(
        (p) => !p.allow_custom_price && (Number(p.stock_qty) || 0) <= 0
      ),
    [activeProducts]
  );

  const multiUnitProducts = useMemo(
    () => activeProducts.filter((p) => (p.product_units?.length ?? 0) > 1),
    [activeProducts]
  );

  const noBarcodeProducts = useMemo(
    () => activeProducts.filter((p) => !p.barcode || p.barcode.trim() === ''),
    [activeProducts]
  );

  const getProductMarginStatus = useCallback((p: Product) => {
    if (p.is_active === false || p.allow_custom_price) {
      return { isLowMargin: false, isLoss: false };
    }
    const unitsList = p.product_units ?? [];
    if (unitsList.length === 0) {
      return { isLowMargin: false, isLoss: false };
    }
    let isLoss = false;
    let isLowMargin = false;
    for (const u of unitsList) {
      const unitCost = (Number(p.cost_price) || 0) * (Number(u.conversion_rate) || 1);
      const sellingPrice = Number(u.selling_price) || 0;
      if (sellingPrice < unitCost) {
        isLoss = true;
        isLowMargin = true;
      } else if (
        sellingPrice <= unitCost ||
        (sellingPrice > 0 && ((sellingPrice - unitCost) / sellingPrice) * 100 < 10)
      ) {
        isLowMargin = true;
      }
    }
    return { isLowMargin, isLoss };
  }, []);

  const lowMarginProducts = useMemo(
    () => activeProducts.filter((p) => getProductMarginStatus(p).isLowMargin),
    [activeProducts, getProductMarginStatus]
  );

  const expiringOrExpiredProducts = useMemo(
    () =>
      activeProducts.filter((p) => {
        const info = getProductExpiryInfo(expiryDates[p.id], todayIso);
        return (
          info !== null &&
          (info.status === 'expired' || info.status === 'expiring_soon')
        );
      }),
    [activeProducts, expiryDates, todayIso]
  );

  const wholesaleProducts = useMemo(
    () => activeProducts.filter((p) => Boolean(wholesaleTiers[p.id])),
    [activeProducts, wholesaleTiers]
  );

  const promoProducts = useMemo(
    () => activeProducts.filter((p) => Boolean(promoLabels[p.id]?.trim())),
    [activeProducts, promoLabels]
  );

  const costUpProducts = useMemo(
    () =>
      activeProducts.filter((p) => {
        const entry = lastCostHistory[p.id];
        if (!entry) return false;
        return (Number(p.cost_price) || 0) > entry.prevCost;
      }),
    [activeProducts, lastCostHistory]
  );

  const runwayLowProducts = useMemo(
    () =>
      activeProducts.filter((p) => {
        const info = getStockRunwayInfo(Number(p.stock_qty) || 0, avgDailySoldMap[p.id]);
        return info !== null && info.daysRemaining <= 3;
      }),
    [activeProducts, avgDailySoldMap]
  );

  const belowTargetProducts = useMemo(
    () =>
      activeProducts.filter((p) => {
        const targetStock = targetStocks[p.id] ?? 0;
        return targetStock > 0 && (Number(p.stock_qty) || 0) < targetStock;
      }),
    [activeProducts, targetStocks]
  );

  const findDuplicateBarcodeMatch = useCallback(
    (rawCode: string): { product: Product; unitName: string | null } | null => {
      const trimmed = rawCode.trim();
      if (!trimmed) return null;
      const normalized = trimmed.toLowerCase();
      for (const p of products) {
        if (p.id === editingProduct?.id) continue;
        if ((p.barcode ?? '').trim().toLowerCase() === normalized) {
          return { product: p, unitName: null };
        }
        const unitMap = unitBarcodes[p.id] ?? {};
        for (const [uName, uBarcode] of Object.entries(unitMap)) {
          if ((uBarcode ?? '').trim().toLowerCase() === normalized) {
            return { product: p, unitName: uName };
          }
        }
      }
      return null;
    },
    [products, editingProduct, unitBarcodes]
  );

  const generateUniqueStoreEan13 = (extraReserved?: Set<string>): string => {
    const existingBarcodes = new Set<string>(extraReserved);
    for (const p of products) {
      const mainBc = (p.barcode ?? '').trim();
      if (mainBc) existingBarcodes.add(mainBc);
      const uMap = unitBarcodes[p.id] ?? {};
      for (const uBc of Object.values(uMap)) {
        const trimmed = (uBc ?? '').trim();
        if (trimmed) existingBarcodes.add(trimmed);
      }
    }
    const currentMain = barcode.trim();
    if (currentMain) existingBarcodes.add(currentMain);
    for (const u of units) {
      const uBc = (u.barcode ?? '').trim();
      if (uBc) existingBarcodes.add(uBc);
    }

    const buildEan13 = (body9: string): string => {
      const base12 = `200${body9}`;
      let sum = 0;
      for (let i = 0; i < 12; i += 1) {
        sum += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
      }
      const checkDigit = (10 - (sum % 10)) % 10;
      return `${base12}${checkDigit}`;
    };

    for (let attempt = 0; attempt < 50; attempt += 1) {
      let body = '';
      for (let i = 0; i < 9; i += 1) {
        body += String(Math.floor(Math.random() * 10));
      }
      const candidate = buildEan13(body);
      if (!existingBarcodes.has(candidate)) {
        return candidate;
      }
    }

    let fallbackCounter = 0;
    while (fallbackCounter < 1000) {
      const fallbackBody = String((Date.now() + fallbackCounter) % 1000000000).padStart(9, '0');
      const candidate = buildEan13(fallbackBody);
      if (!existingBarcodes.has(candidate)) {
        return candidate;
      }
      fallbackCounter += 1;
    }
    return buildEan13(String(Date.now()).slice(-9).padStart(9, '0'));
  };

  const duplicateBarcodeMatch = useMemo(
    () => findDuplicateBarcodeMatch(barcode),
    [barcode, findDuplicateBarcodeMatch]
  );
  const duplicateBarcodeProduct = duplicateBarcodeMatch?.product ?? null;

  const inventorySummary = useMemo(() => {
    const totalCount = activeProducts.length;
    const lowStockCount = lowStockProducts.length;
    const totalCostValue = activeProducts.reduce((sum, p) => {
      const qty = Number(p.stock_qty) || 0;
      if (qty <= 0) return sum;
      return sum + qty * (Number(p.cost_price) || 0);
    }, 0);
    const totalSellingValue = activeProducts.reduce((sum, p) => {
      const qty = Number(p.stock_qty) || 0;
      if (qty <= 0) return sum;
      const unitsList = p.product_units ?? [];
      const baseSellingUnit =
        unitsList.find((u) => Number(u.conversion_rate) === 1) ??
        unitsList.find((u) => u.is_default) ??
        unitsList[0];
      const convRate = Number(baseSellingUnit?.conversion_rate) || 1;
      const unitSellingPerBase = baseSellingUnit
        ? (Number(baseSellingUnit.selling_price) || 0) / convRate
        : 0;
      return sum + qty * unitSellingPerBase;
    }, 0);
    const estimatedProfit = totalSellingValue - totalCostValue;
    return {
      totalCount,
      lowStockCount,
      totalCostValue,
      totalSellingValue,
      estimatedProfit,
    };
  }, [activeProducts, lowStockProducts]);

  const restockListItems = useMemo(
    () =>
      lowStockProducts.map((p) => {
        const stockQty = Number(p.stock_qty) || 0;
        const lowAlertVal = Number(p.low_stock_alert) || 0;
        const targetStock = targetStocks[p.id];
        const hasTargetStock = targetStock !== undefined && targetStock > stockQty;
        const recommendedQty = hasTargetStock
          ? Math.max(1, targetStock - stockQty)
          : Math.max(1, lowAlertVal * 2 - stockQty);
        const unitCost = Number(p.cost_price) || 0;
        const estimatedCost = recommendedQty * unitCost;
        const largestUnit = [...(p.product_units ?? [])].sort(
          (a, b) => Number(b.conversion_rate) - Number(a.conversion_rate)
        )[0];
        return {
          product: p,
          stockQty,
          lowAlertVal,
          targetStock,
          recommendedQty,
          unitCost,
          estimatedCost,
          largestUnit,
          supplier: suppliers[p.id] ?? '',
          orderPackInfo: orderPackInfos[p.id] ?? '',
        };
      }),
    [lowStockProducts, suppliers, orderPackInfos, targetStocks]
  );

  const restockSupplierOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let unassignedCount = 0;
    for (const item of restockListItems) {
      if (item.supplier) {
        counts.set(item.supplier, (counts.get(item.supplier) ?? 0) + 1);
      } else {
        unassignedCount += 1;
      }
    }
    const list = Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'th'))
      .map(([name, count]) => ({ name, count }));
    return { list, unassignedCount };
  }, [restockListItems]);

  const filteredRestockItems = useMemo(() => {
    if (restockSupplierFilter === 'all') return restockListItems;
    if (restockSupplierFilter === '__none__') {
      return restockListItems.filter((item) => !item.supplier);
    }
    return restockListItems.filter((item) => item.supplier === restockSupplierFilter);
  }, [restockListItems, restockSupplierFilter]);

  const restockTotalEstimatedCost = useMemo(
    () => filteredRestockItems.reduce((sum, item) => sum + item.estimatedCost, 0),
    [filteredRestockItems]
  );

  const shoppingListText = useMemo(() => {
    const storeTitle = settings?.store_name || 'ร้านขายของชำ POS';
    const dateStr = shoppingListDate || '-';
    if (filteredRestockItems.length === 0) {
      return `🛒 สรุปรายการสั่งของเข้าร้าน (${storeTitle})\nวันที่: ${dateStr}\n- ไม่มีสินค้าใกล้หมดสต็อก -`;
    }
    const lines = filteredRestockItems.map(
      (
        {
          product: p,
          stockQty,
          lowAlertVal,
          recommendedQty,
          estimatedCost,
          largestUnit,
          supplier,
          orderPackInfo: packInfo,
        },
        idx
      ) => {
        const packHint =
          largestUnit && Number(largestUnit.conversion_rate) > 1
            ? ` [หน่วยซื้อ: ${largestUnit.unit_name} = ${formatNumber(largestUnit.conversion_rate)} ${p.base_unit}]`
            : '';
        const supplierHint = supplier ? ` [ร้านค้าส่ง: ${supplier}]` : '';
        const orderPackHint = packInfo ? ` [แพ็คสั่งซื้อ: ${packInfo}]` : '';
        return `${idx + 1}. ${p.name}${supplierHint}${orderPackHint} — คงเหลือ ${formatNumber(stockQty)}/${formatNumber(lowAlertVal)} ${p.base_unit} | แนะนำสั่ง ${formatNumber(recommendedQty)} ${p.base_unit}${packHint} (ประมาณ ${formatBaht(estimatedCost)})`;
      }
    );
    const filterHeader =
      restockSupplierFilter === 'all'
        ? ''
        : restockSupplierFilter === '__none__'
          ? '\n🏪 ร้านค้าส่ง: ยังไม่ระบุ'
          : `\n🏪 ร้านค้าส่ง: ${restockSupplierFilter}`;
    return [
      `🛒 สรุปรายการสั่งของ - ${storeTitle}${filterHeader}`,
      `📅 วันที่: ${dateStr} (รวม ${filteredRestockItems.length} รายการ)`,
      `------------------------`,
      ...lines,
      `------------------------`,
      `💰 ต้นทุนประมาณการรวม: ${formatBaht(restockTotalEstimatedCost)}`,
    ].join('\n');
  }, [
    filteredRestockItems,
    restockSupplierFilter,
    restockTotalEstimatedCost,
    settings,
    shoppingListDate,
  ]);

  const handleCopyShoppingList = async () => {
    try {
      await navigator.clipboard.writeText(shoppingListText);
      setCopiedShoppingList(true);
      setTimeout(() => setCopiedShoppingList(false), 2500);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = shoppingListText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedShoppingList(true);
      setTimeout(() => setCopiedShoppingList(false), 2500);
    }
  };

  const handleExportRestockCsv = () => {
    const escapeCsv = (val: unknown) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
      'ลำดับ',
      'ชื่อสินค้า',
      'หมวดหมู่',
      'ซัพพลายเออร์ / ร้านค้าส่ง',
      'ขนาดแพ็ค / เงื่อนไขสั่งซื้อ',
      'บาร์โค้ด',
      'หน่วยย่อย',
      'คงเหลือ',
      'จุดแจ้งเตือน',
      'จำนวนแนะนำให้สั่ง',
      'ราคาทุนต่อหน่วย (บาท)',
      'ต้นทุนประมาณการ (บาท)',
    ];

    const rows = filteredRestockItems.map(
      (
        {
          product: p,
          stockQty,
          lowAlertVal,
          recommendedQty,
          unitCost,
          estimatedCost,
          supplier,
          orderPackInfo: packInfo,
        },
        idx
      ) =>
        [
          idx + 1,
          p.name,
          p.categories?.name ?? 'ไม่มีหมวดหมู่',
          supplier || '-',
          packInfo || '-',
          p.barcode || '-',
          p.base_unit,
          stockQty,
          lowAlertVal,
          recommendedQty,
          unitCost.toFixed(2),
          estimatedCost.toFixed(2),
        ]
          .map(escapeCsv)
          .join(',')
    );

    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `restock-list-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const supplierFilterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const sup = (suppliers[p.id] ?? '').trim();
      if (sup) set.add(sup);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'));
  }, [products, suppliers]);

  const shelfLocationFilterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const loc = (shelfLocations[p.id] ?? '').trim();
      if (loc) set.add(loc);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'));
  }, [products, shelfLocations]);

  const hasActiveFilters =
    search.trim() !== '' ||
    selectedCategory !== 'all' ||
    selectedSupplier !== 'all' ||
    selectedShelfLocation !== 'all' ||
    filterMode !== 'all';

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = products.filter((p) => {
      if (filterMode === 'inactive') {
        if (p.is_active !== false) return false;
      } else {
        if (p.is_active === false) return false;
        if (filterMode === 'low' && (p.allow_custom_price || p.stock_qty > p.low_stock_alert)) {
          return false;
        }
        if (filterMode === 'below_target') {
          const targetStock = targetStocks[p.id] ?? 0;
          if (!(targetStock > 0 && (Number(p.stock_qty) || 0) < targetStock)) {
            return false;
          }
        }
        if (filterMode === 'runway_low') {
          const runway = getStockRunwayInfo(Number(p.stock_qty) || 0, avgDailySoldMap[p.id]);
          if (!runway || runway.daysRemaining > 3) {
            return false;
          }
        }
        if (filterMode === 'out' && (p.allow_custom_price || (Number(p.stock_qty) || 0) > 0)) {
          return false;
        }
        if (filterMode === 'multi_unit' && (p.product_units?.length ?? 0) <= 1) {
          return false;
        }
        if (filterMode === 'no_barcode' && p.barcode && p.barcode.trim() !== '') {
          return false;
        }
        if (filterMode === 'low_margin' && !getProductMarginStatus(p).isLowMargin) {
          return false;
        }
        if (filterMode === 'wholesale' && !wholesaleTiers[p.id]) {
          return false;
        }
        if (filterMode === 'has_promo' && !promoLabels[p.id]?.trim()) {
          return false;
        }
        if (filterMode === 'cost_up') {
          const entry = lastCostHistory[p.id];
          if (!entry || (Number(p.cost_price) || 0) <= entry.prevCost) {
            return false;
          }
        }
        if (filterMode === 'expiring') {
          const info = getProductExpiryInfo(expiryDates[p.id], todayIso);
          if (
            !info ||
            (info.status !== 'expired' && info.status !== 'expiring_soon')
          ) {
            return false;
          }
        }
      }
      if (selectedCategory !== 'all') {
        if (selectedCategory === 'uncategorized') {
          if (p.category_id) return false;
        } else if (p.category_id !== selectedCategory) {
          return false;
        }
      }
      if (selectedSupplier !== 'all') {
        const sup = (suppliers[p.id] ?? '').trim();
        if (selectedSupplier === '__none__') {
          if (sup) return false;
        } else if (sup !== selectedSupplier) {
          return false;
        }
      }
      if (selectedShelfLocation !== 'all') {
        const loc = (shelfLocations[p.id] ?? '').trim();
        if (selectedShelfLocation === '__none__') {
          if (loc) return false;
        } else if (loc !== selectedShelfLocation) {
          return false;
        }
      }
      if (!q) return true;
      const hasMatchingUnitBarcode = Object.values(unitBarcodes[p.id] ?? {}).some((bc) =>
        bc.toLowerCase().includes(q)
      );
      return (
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        hasMatchingUnitBarcode ||
        (suppliers[p.id] && suppliers[p.id].toLowerCase().includes(q)) ||
        (shelfLocations[p.id] && shelfLocations[p.id].toLowerCase().includes(q)) ||
        (orderPackInfos[p.id] && orderPackInfos[p.id].toLowerCase().includes(q)) ||
        (substituteNotes[p.id] && substituteNotes[p.id].toLowerCase().includes(q)) ||
        (promoLabels[p.id] && promoLabels[p.id].toLowerCase().includes(q))
      );
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'stock_asc') {
        return (Number(a.stock_qty) || 0) - (Number(b.stock_qty) || 0);
      }
      if (sortBy === 'cost_desc') {
        return (Number(b.cost_price) || 0) - (Number(a.cost_price) || 0);
      }
      return a.name.localeCompare(b.name, 'th');
    });
  }, [
    products,
    search,
    filterMode,
    selectedCategory,
    selectedSupplier,
    selectedShelfLocation,
    sortBy,
    getProductMarginStatus,
    expiryDates,
    suppliers,
    shelfLocations,
    orderPackInfos,
    substituteNotes,
    promoLabels,
    unitBarcodes,
    wholesaleTiers,
    lastCostHistory,
    avgDailySoldMap,
    targetStocks,
    todayIso,
  ]);

  const getPriceTagInfo = useCallback(
    (product: Product) => {
      const unitsList = product.product_units ?? [];
      const defaultUnit = unitsList.find((u) => u.is_default) ?? unitsList[0];
      const extraUnits = unitsList
        .filter((u) => u !== defaultUnit && Number(u.selling_price) > 0)
        .sort((a, b) => Number(a.conversion_rate) - Number(b.conversion_rate));
      const wholesaleTier = wholesaleTiers[product.id] ?? null;
      return {
        unitName: defaultUnit?.unit_name || product.base_unit || 'ชิ้น',
        sellingPrice: Number(defaultUnit?.selling_price ?? 0),
        extraUnits,
        wholesaleTier,
      };
    },
    [wholesaleTiers]
  );

  const tagModalProducts = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    if (!q) return filteredProducts;
    return filteredProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)),
    );
  }, [filteredProducts, tagSearch]);

  const selectedTagProducts = useMemo(() => {
    const idSet = new Set(selectedTagProductIds);
    return products.filter((p) => idSet.has(p.id));
  }, [products, selectedTagProductIds]);

  const openPriceTagsModal = () => {
    setTagSearch('');
    setPrintMode('price_tags');
    setPriceTagsOpen(true);
  };

  useEffect(() => {
    if (printSeq === 0) return;
    const timer = window.setTimeout(() => {
      window.print();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [printSeq]);

  const toggleTagProduct = (productId: string) => {
    setSelectedTagProductIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId],
    );
  };

  const handleSelectAllFilteredTags = () => {
    setSelectedTagProductIds(filteredProducts.map((p) => p.id));
  };

  const handleClearTagSelection = () => {
    setSelectedTagProductIds([]);
  };

  const buildBulkBarcodeDrafts = () => {
    const reserved = new Set<string>();
    return noBarcodeProducts.map((product) => {
      const code = generateUniqueStoreEan13(reserved);
      reserved.add(code);
      return { product, barcode: code };
    });
  };

  const openBulkBarcodeModal = () => {
    if (noBarcodeProducts.length === 0) return;
    setBulkBarcodeDrafts(buildBulkBarcodeDrafts());
    setBulkBarcodeError('');
    setBulkBarcodeSavedIds([]);
    setBulkBarcodeOpen(true);
  };

  const handleRegenerateBulkBarcodes = () => {
    if (bulkBarcodeSaving || bulkBarcodeSavedIds.length > 0) return;
    setBulkBarcodeDrafts(buildBulkBarcodeDrafts());
    setBulkBarcodeError('');
  };

  const handleSaveBulkBarcodes = async () => {
    if (bulkBarcodeSaving || bulkBarcodeDrafts.length === 0) return;
    setBulkBarcodeSaving(true);
    setBulkBarcodeError('');
    try {
      for (const item of bulkBarcodeDrafts) {
        const { error } = await supabase
          .from('products')
          .update({ barcode: item.barcode })
          .eq('id', item.product.id);
        if (error) throw error;
      }
      await loadData();
      setBulkBarcodeSavedIds(bulkBarcodeDrafts.map((d) => d.product.id));
    } catch (err) {
      setBulkBarcodeError(
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกบาร์โค้ด'
      );
    } finally {
      setBulkBarcodeSaving(false);
    }
  };

  const handleOpenPriceTagsForGenerated = () => {
    if (bulkBarcodeSavedIds.length === 0) return;
    if (filterMode === 'no_barcode') {
      setFilterMode('all');
    }
    setSelectedTagProductIds(bulkBarcodeSavedIds);
    setBulkBarcodeOpen(false);
    openPriceTagsModal();
  };

  const getDefaultUnit = useCallback((product: Product) => {
    const unitsList = product.product_units ?? [];
    return unitsList.find((u) => u.is_default) ?? unitsList[0];
  }, []);

  const openBulkPriceModal = (onlyCostUp?: boolean | React.MouseEvent) => {
    const filterCostUp = onlyCostUp === true;
    const drafts: Record<
      string,
      {
        costPrice: string;
        sellingPrice: string;
        lowStockAlert: string;
        targetStock: string;
        promoLabel: string;
      }
    > = {};
    for (const p of activeProducts) {
      const defaultUnit = getDefaultUnit(p);
      drafts[p.id] = {
        costPrice: String(Number(p.cost_price ?? 0)),
        sellingPrice: String(Number(defaultUnit?.selling_price ?? 0)),
        lowStockAlert: String(Number(p.low_stock_alert ?? 0)),
        targetStock: targetStocks[p.id] !== undefined ? String(targetStocks[p.id]) : '',
        promoLabel: promoLabels[p.id] ?? '',
      };
    }
    setBulkPriceDrafts(drafts);
    setBulkPriceSearch('');
    setBulkPriceOnlyCostUp(filterCostUp);
    setBulkPriceError('');
    setBulkPriceOpen(true);
  };

  const updateBulkPriceDraft = (
    productId: string,
    field: 'costPrice' | 'sellingPrice' | 'lowStockAlert' | 'targetStock' | 'promoLabel',
    value: string
  ) => {
    setBulkPriceError('');
    setBulkPriceDrafts((prev) => ({
      ...prev,
      [productId]: {
        costPrice: prev[productId]?.costPrice ?? '0',
        sellingPrice: prev[productId]?.sellingPrice ?? '0',
        lowStockAlert: prev[productId]?.lowStockAlert ?? '0',
        targetStock:
          prev[productId]?.targetStock ??
          (targetStocks[productId] !== undefined ? String(targetStocks[productId]) : ''),
        promoLabel: prev[productId]?.promoLabel ?? (promoLabels[productId] ?? ''),
        [field]: value,
      },
    }));
  };

  const applyBulkTargetStockAction = (mode: 'alert_x3' | 'sales_14d') => {
    if (bulkPriceFilteredProducts.length === 0) return;
    setBulkPriceError('');
    setBulkPriceDrafts((prev) => {
      const next = { ...prev };
      for (const p of bulkPriceFilteredProducts) {
        const defaultUnit = getDefaultUnit(p);
        const origCost = Number(p.cost_price ?? 0);
        const origSelling = Number(defaultUnit?.selling_price ?? 0);
        const origLowAlert = Number(p.low_stock_alert ?? 0);
        const existing = next[p.id] ?? {
          costPrice: String(origCost),
          sellingPrice: String(origSelling),
          lowStockAlert: String(origLowAlert),
          targetStock: targetStocks[p.id] !== undefined ? String(targetStocks[p.id]) : '',
          promoLabel: promoLabels[p.id] ?? '',
        };
        let nextTarget = existing.targetStock;
        if (mode === 'alert_x3') {
          const draftLowAlert = Number(existing.lowStockAlert);
          const lowAlert =
            existing.lowStockAlert.trim() !== '' &&
            Number.isFinite(draftLowAlert) &&
            draftLowAlert >= 0
              ? draftLowAlert
              : origLowAlert;
          const stockQty = Number(p.stock_qty ?? 0);
          const computed = Math.max(lowAlert * 3, stockQty);
          nextTarget = computed > 0 ? String(Math.round(computed * 100) / 100) : '';
        } else if (mode === 'sales_14d') {
          const avgDaily = avgDailySoldMap[p.id] || 0;
          if (avgDaily > 0) {
            nextTarget = String(Math.ceil(avgDaily * 14));
          }
        }
        next[p.id] = {
          ...existing,
          targetStock: nextTarget,
        };
      }
      return next;
    });
  };

  const applyBulkPromoLabelAction = (label: string) => {
    if (bulkPriceFilteredProducts.length === 0) return;
    setBulkPriceError('');
    setBulkPriceDrafts((prev) => {
      const next = { ...prev };
      for (const p of bulkPriceFilteredProducts) {
        const defaultUnit = getDefaultUnit(p);
        const origCost = Number(p.cost_price ?? 0);
        const origSelling = Number(defaultUnit?.selling_price ?? 0);
        const origLowAlert = Number(p.low_stock_alert ?? 0);
        const existing = next[p.id] ?? {
          costPrice: String(origCost),
          sellingPrice: String(origSelling),
          lowStockAlert: String(origLowAlert),
          targetStock: targetStocks[p.id] !== undefined ? String(targetStocks[p.id]) : '',
          promoLabel: promoLabels[p.id] ?? '',
        };
        next[p.id] = {
          ...existing,
          promoLabel: label,
        };
      }
      return next;
    });
  };

  const applyBulkSellingPriceAction = (
    mode: 'add_1' | 'add_5' | 'cost_plus_20' | 'cost_plus_30' | 'reset'
  ) => {
    if (bulkPriceFilteredProducts.length === 0) return;
    setBulkPriceError('');
    setBulkPriceDrafts((prev) => {
      const next = { ...prev };
      for (const p of bulkPriceFilteredProducts) {
        const defaultUnit = getDefaultUnit(p);
        const origCost = Number(p.cost_price ?? 0);
        const origSelling = Number(defaultUnit?.selling_price ?? 0);
        const origLowAlert = Number(p.low_stock_alert ?? 0);
        const existing = next[p.id] ?? {
          costPrice: String(origCost),
          sellingPrice: String(origSelling),
          lowStockAlert: String(origLowAlert),
          targetStock: targetStocks[p.id] !== undefined ? String(targetStocks[p.id]) : '',
          promoLabel: promoLabels[p.id] ?? '',
        };
        let updatedSelling = origSelling;
        if (mode === 'add_1' || mode === 'add_5') {
          const currentSelling = Number(existing.sellingPrice);
          const base = Number.isFinite(currentSelling) ? currentSelling : origSelling;
          const delta = mode === 'add_1' ? 1 : 5;
          updatedSelling = Math.max(0, Math.round((base + delta) * 100) / 100);
        } else if (mode === 'cost_plus_20' || mode === 'cost_plus_30') {
          const draftCost = Number(existing.costPrice);
          const baseUnitCost =
            Number.isFinite(draftCost) && draftCost >= 0 ? draftCost : origCost;
          const convRate = Number(defaultUnit?.conversion_rate ?? 1) || 1;
          const unitCost = baseUnitCost * convRate;
          const multiplier = mode === 'cost_plus_20' ? 1.2 : 1.3;
          updatedSelling = Math.max(0, Math.round(unitCost * multiplier * 100) / 100);
        } else if (mode === 'reset') {
          updatedSelling = origSelling;
        }
        next[p.id] = {
          ...existing,
          sellingPrice: String(updatedSelling),
        };
      }
      return next;
    });
  };

  const bulkPriceFilteredProducts = useMemo(() => {
    const baseList = bulkPriceOnlyCostUp ? costUpProducts : activeProducts;
    const q = bulkPriceSearch.trim().toLowerCase();
    if (!q) return baseList;
    return baseList.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
    );
  }, [activeProducts, bulkPriceOnlyCostUp, bulkPriceSearch, costUpProducts]);

  const bulkPriceChangedItems = useMemo(() => {
    return activeProducts
      .map((p) => {
        const draft = bulkPriceDrafts[p.id];
        if (!draft) return null;
        const defaultUnit = getDefaultUnit(p);
        const origCost = Number(p.cost_price ?? 0);
        const origSelling = Number(defaultUnit?.selling_price ?? 0);
        const origLowAlert = Number(p.low_stock_alert ?? 0);
        const origTargetStock = targetStocks[p.id] ?? 0;
        const origPromo = (promoLabels[p.id] ?? '').trim();
        const newCost = Number(draft.costPrice);
        const newSelling = Number(draft.sellingPrice);
        const newLowAlert = Number(draft.lowStockAlert);
        const trimmedTarget = (draft.targetStock ?? '').trim();
        const rawTarget = trimmedTarget === '' ? 0 : Number(trimmedTarget);
        const newTargetStock =
          trimmedTarget === ''
            ? 0
            : Number.isNaN(rawTarget)
              ? Number.NaN
              : rawTarget > 0
                ? Math.round(rawTarget * 100) / 100
                : rawTarget;
        const newPromo = (draft.promoLabel ?? '').trim();
        const costChanged =
          draft.costPrice.trim() === '' || Number.isNaN(newCost) || newCost !== origCost;
        const sellingChanged =
          draft.sellingPrice.trim() === '' ||
          Number.isNaN(newSelling) ||
          newSelling !== origSelling;
        const lowAlertChanged =
          draft.lowStockAlert.trim() === '' ||
          Number.isNaN(newLowAlert) ||
          newLowAlert !== origLowAlert;
        const targetStockChanged =
          (trimmedTarget !== '' && Number.isNaN(newTargetStock)) ||
          newTargetStock !== origTargetStock;
        const promoChanged = newPromo !== origPromo;
        if (
          !costChanged &&
          !sellingChanged &&
          !lowAlertChanged &&
          !targetStockChanged &&
          !promoChanged
        )
          return null;
        return {
          product: p,
          defaultUnit,
          draft,
          newCost,
          newSelling,
          newLowAlert,
          newTargetStock,
          newPromo,
          costChanged,
          sellingChanged,
          lowAlertChanged,
          targetStockChanged,
          promoChanged,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [activeProducts, bulkPriceDrafts, getDefaultUnit, promoLabels, targetStocks]);

  const handleSaveBulkPrices = async () => {
    if (bulkPriceChangedItems.length === 0) return;

    for (const item of bulkPriceChangedItems) {
      if (
        item.draft.costPrice.trim() === '' ||
        Number.isNaN(item.newCost) ||
        item.newCost < 0 ||
        item.draft.sellingPrice.trim() === '' ||
        Number.isNaN(item.newSelling) ||
        item.newSelling < 0 ||
        item.draft.lowStockAlert.trim() === '' ||
        Number.isNaN(item.newLowAlert) ||
        item.newLowAlert < 0
      ) {
        setBulkPriceError(
          `กรุณากรอกราคาทุน ราคาขาย และจุดแจ้งเตือนใกล้หมดที่ถูกต้อง (>= 0) สำหรับ "${item.product.name}"`
        );
        return;
      }
      if (
        item.targetStockChanged &&
        (item.draft.targetStock ?? '').trim() !== '' &&
        (Number.isNaN(item.newTargetStock) || item.newTargetStock < 0)
      ) {
        setBulkPriceError(
          `กรุณากรอกเป้าเต็มชั้น (Max Stock) ที่ถูกต้อง (>= 0) สำหรับ "${item.product.name}"`
        );
        return;
      }
    }

    setBulkPriceSaving(true);
    setBulkPriceError('');
    const nowIso = new Date().toISOString();
    const costHistoryEntries: Array<{ productId: string; prevCost: number; updatedAt: string }> = [];
    const sellingPriceClearedIds: string[] = [];
    const hasDbChanges = bulkPriceChangedItems.some(
      (item) => item.costChanged || item.sellingChanged || item.lowAlertChanged
    );
    const targetStockChangedItems = bulkPriceChangedItems.filter((item) => item.targetStockChanged);
    const promoChangedItems = bulkPriceChangedItems.filter((item) => item.promoChanged);

    try {
      for (const item of bulkPriceChangedItems) {
        if (item.costChanged || item.lowAlertChanged) {
          const productUpdates: { cost_price?: number; low_stock_alert?: number } = {};
          if (item.costChanged) productUpdates.cost_price = item.newCost;
          if (item.lowAlertChanged) productUpdates.low_stock_alert = item.newLowAlert;
          const { error: prodErr } = await supabase
            .from('products')
            .update(productUpdates)
            .eq('id', item.product.id);
          if (prodErr) throw prodErr;
          if (item.costChanged) {
            costHistoryEntries.push({
              productId: item.product.id,
              prevCost: Number(item.product.cost_price) || 0,
              updatedAt: nowIso,
            });
          }
        }
        if (item.sellingChanged) {
          if (item.defaultUnit) {
            const { error: unitErr } = await supabase
              .from('product_units')
              .update({ selling_price: item.newSelling })
              .eq('id', item.defaultUnit.id);
            if (unitErr) throw unitErr;
          } else {
            const { error: insertErr } = await supabase.from('product_units').insert({
              product_id: item.product.id,
              unit_name: item.product.base_unit || 'ชิ้น',
              conversion_rate: 1,
              selling_price: item.newSelling,
              is_default: true,
            });
            if (insertErr) throw insertErr;
          }
          if (!item.costChanged) {
            sellingPriceClearedIds.push(item.product.id);
          }
        }
      }

      if (targetStockChangedItems.length > 0) {
        let baseTargetStocks: Record<string, number> = targetStocks;
        try {
          const latestRaw = window.localStorage.getItem(TARGET_STOCK_STORAGE_KEY);
          if (latestRaw !== null) {
            baseTargetStocks = parseTargetStockMap(latestRaw);
          }
        } catch {
          // Fallback to in-memory state
        }
        const nextTargetStocks = { ...baseTargetStocks };
        for (const item of targetStockChangedItems) {
          if (item.newTargetStock > 0) {
            nextTargetStocks[item.product.id] = item.newTargetStock;
          } else {
            delete nextTargetStocks[item.product.id];
          }
        }
        try {
          window.localStorage.setItem(
            TARGET_STOCK_STORAGE_KEY,
            JSON.stringify(nextTargetStocks)
          );
        } catch {
          // Ignore storage errors
        }
        setTargetStocks(nextTargetStocks);
      }

      if (promoChangedItems.length > 0) {
        let basePromoLabels: Record<string, string> = promoLabels;
        try {
          const latestRaw = window.localStorage.getItem(PROMO_LABELS_STORAGE_KEY);
          if (latestRaw !== null) {
            basePromoLabels = parseProductTextMap(latestRaw);
          }
        } catch {
          // Fallback to in-memory state
        }
        const nextPromoLabels = { ...basePromoLabels };
        for (const item of promoChangedItems) {
          if (item.newPromo) {
            nextPromoLabels[item.product.id] = item.newPromo;
          } else {
            delete nextPromoLabels[item.product.id];
          }
        }
        try {
          window.localStorage.setItem(
            PROMO_LABELS_STORAGE_KEY,
            JSON.stringify(nextPromoLabels)
          );
        } catch {
          // Ignore storage errors
        }
        setPromoLabels(nextPromoLabels);
      }

      if (hasDbChanges) {
        await loadData();
      }
      setBulkPriceOpen(false);
    } catch (err) {
      setBulkPriceError(
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกราคา'
      );
    } finally {
      if (sellingPriceClearedIds.length > 0) {
        clearLastCostHistoryEntries(sellingPriceClearedIds);
      }
      if (costHistoryEntries.length > 0) {
        saveLastCostHistoryEntries(costHistoryEntries);
      }
      setBulkPriceSaving(false);
    }
  };

  const openNewProduct = () => {
    setEditingProduct(null);
    setName('');
    setCategoryId(categories[0]?.id ?? '');
    setBarcode('');
    setBaseUnit('ชิ้น');
    setCostPrice('0');
    setPackCostHelperOpen(false);
    setPackCostInput('');
    setPackQtyInput('12');
    setStockQty('0');
    setLowAlert('5');
    setTargetStockInput('');
    setIsQuickItem(true);
    setAllowCustomPrice(false);
    setExpiryDate('');
    setSupplierName('');
    setShelfLocation('');
    setOrderPackInfo('');
    setSubstituteNote('');
    setPromoLabel('');
    setWholesaleMinQty('');
    setWholesaleUnitPrice('');
    setWholesaleError('');
    setUnits([
      { unit_name: 'ชิ้น', conversion_rate: '1', selling_price: '10', is_default: true, barcode: '' },
    ]);
    setProductModalOpen(true);
  };

  const openEditProduct = (p: Product) => {
    setEditingProduct(p);
    setName(p.name);
    setCategoryId(p.category_id ?? '');
    setBarcode(p.barcode ?? '');
    setBaseUnit(p.base_unit);
    setCostPrice(String(p.cost_price));
    setPackCostHelperOpen(false);
    setPackCostInput('');
    setPackQtyInput('12');
    setStockQty(String(p.stock_qty));
    setLowAlert(String(p.low_stock_alert));
    setTargetStockInput(targetStocks[p.id] !== undefined ? String(targetStocks[p.id]) : '');
    setIsQuickItem(p.is_quick_item);
    setAllowCustomPrice(p.allow_custom_price);
    setExpiryDate(expiryDates[p.id] ?? '');
    setSupplierName(suppliers[p.id] ?? '');
    setShelfLocation(shelfLocations[p.id] ?? '');
    setOrderPackInfo(orderPackInfos[p.id] ?? '');
    setSubstituteNote(substituteNotes[p.id] ?? '');
    setPromoLabel(promoLabels[p.id] ?? '');
    const tier = wholesaleTiers[p.id];
    setWholesaleMinQty(tier ? String(tier.minQty) : '');
    setWholesaleUnitPrice(tier ? String(tier.unitPrice) : '');
    setWholesaleError('');
    const existingUnits = (p.product_units ?? []).map((u) => ({
      id: u.id,
      unit_name: u.unit_name,
      conversion_rate: String(u.conversion_rate),
      selling_price: String(u.selling_price),
      is_default: u.is_default,
      barcode: unitBarcodes[p.id]?.[u.unit_name] ?? '',
    }));
    setUnits(
      existingUnits.length > 0
        ? existingUnits
        : [
            {
              unit_name: p.base_unit,
              conversion_rate: '1',
              selling_price: '0',
              is_default: true,
              barcode: unitBarcodes[p.id]?.[p.base_unit] ?? '',
            },
          ]
    );
    setProductModalOpen(true);
  };

  const openDuplicateProduct = (p: Product) => {
    setEditingProduct(null);
    setName(`${p.name} (สำเนา)`);
    setCategoryId(p.category_id ?? '');
    setBarcode('');
    setBaseUnit(p.base_unit);
    setCostPrice(String(p.cost_price));
    setPackCostHelperOpen(false);
    setPackCostInput('');
    setPackQtyInput('12');
    setStockQty('0');
    setLowAlert(String(p.low_stock_alert));
    setTargetStockInput(targetStocks[p.id] !== undefined ? String(targetStocks[p.id]) : '');
    setIsQuickItem(p.is_quick_item);
    setAllowCustomPrice(p.allow_custom_price);
    setExpiryDate('');
    setSupplierName(suppliers[p.id] ?? '');
    setShelfLocation(shelfLocations[p.id] ?? '');
    setOrderPackInfo(orderPackInfos[p.id] ?? '');
    setSubstituteNote(substituteNotes[p.id] ?? '');
    setPromoLabel(promoLabels[p.id] ?? '');
    const tier = wholesaleTiers[p.id];
    setWholesaleMinQty(tier ? String(tier.minQty) : '');
    setWholesaleUnitPrice(tier ? String(tier.unitPrice) : '');
    setWholesaleError('');
    const copiedUnits = (p.product_units ?? []).map((u) => ({
      unit_name: u.unit_name,
      conversion_rate: String(u.conversion_rate),
      selling_price: String(u.selling_price),
      is_default: u.is_default,
      barcode: '',
    }));
    setUnits(
      copiedUnits.length > 0
        ? copiedUnits
        : [
            {
              unit_name: p.base_unit,
              conversion_rate: '1',
              selling_price: '0',
              is_default: true,
              barcode: '',
            },
          ]
    );
    setProductModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const rawMinQty = wholesaleMinQty.trim();
    const rawWholesalePrice = wholesaleUnitPrice.trim();
    if ((rawMinQty && !rawWholesalePrice) || (!rawMinQty && rawWholesalePrice)) {
      setWholesaleError(
        'กรุณากรอกทั้ง "จำนวนขั้นต่ำ (ชิ้น)" และ "ราคาขายต่อชิ้นเมื่อครบจำนวน (บาท)" หรือกดล้างค่า'
      );
      return;
    }
    if (rawMinQty && rawWholesalePrice) {
      const parsedMin = Number(rawMinQty);
      const parsedPrice = Number(rawWholesalePrice);
      if (!Number.isFinite(parsedMin) || !Number.isInteger(parsedMin) || parsedMin < 2) {
        setWholesaleError('จำนวนขั้นต่ำ (ชิ้น) ต้องเป็นจำนวนเต็มตั้งแต่ 2 ขึ้นไป');
        return;
      }
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        setWholesaleError('ราคาขายต่อชิ้นเมื่อครบจำนวน (บาท) ต้องมากกว่า 0');
        return;
      }
    }
    setWholesaleError('');
    setSaving(true);

    const payload = {
      name: name.trim(),
      category_id: categoryId || null,
      barcode: barcode.trim(),
      base_unit: baseUnit.trim() || 'ชิ้น',
      cost_price: Number(costPrice) || 0,
      stock_qty: Number(stockQty) || 0,
      low_stock_alert: Number(lowAlert) || 0,
      is_quick_item: isQuickItem,
      allow_custom_price: allowCustomPrice,
      updated_at: new Date().toISOString(),
    };

    let productId = editingProduct?.id;

    if (editingProduct) {
      await supabase.from('products').update(payload).eq('id', editingProduct.id);
      await supabase.from('product_units').delete().eq('product_id', editingProduct.id);
      const prevCost = Number(editingProduct.cost_price) || 0;
      if (prevCost !== payload.cost_price) {
        saveLastCostHistoryEntries([
          {
            productId: editingProduct.id,
            prevCost,
            updatedAt: payload.updated_at,
          },
        ]);
      }
    } else {
      const { data: created } = await supabase
        .from('products')
        .insert(payload)
        .select()
        .single();
      productId = created?.id;
    }

    if (productId) {
      saveProductExpiryDate(productId, expiryDate);
      saveProductSupplier(productId, supplierName);
      saveProductShelfLocation(productId, shelfLocation);
      saveProductOrderPackInfo(productId, orderPackInfo);
      saveProductSubstituteNote(productId, substituteNote);
      saveProductPromoLabel(productId, promoLabel);
      saveProductTargetStock(productId, targetStockInput);
      saveProductWholesaleTier(productId, wholesaleMinQty, wholesaleUnitPrice);
      saveProductUnitBarcodes(productId, units, baseUnit.trim() || 'ชิ้น');
    }

    if (productId && units.length > 0) {
      const hasDefault = units.some((u) => u.is_default);
      await supabase.from('product_units').insert(
        units.map((u, idx) => ({
          product_id: productId,
          unit_name: u.unit_name.trim() || baseUnit.trim() || 'ชิ้น',
          conversion_rate: Math.max(0.01, Number(u.conversion_rate) || 1),
          selling_price: Math.max(0, Number(u.selling_price) || 0),
          is_default: hasDefault ? u.is_default : idx === 0,
        }))
      );
    }

    setSaving(false);
    setProductModalOpen(false);
    loadData();
  };

  const openRestock = (p: Product) => {
    setRestockProduct(p);
    const largestUnit = [...(p.product_units ?? [])].sort(
      (a, b) => Number(b.conversion_rate) - Number(a.conversion_rate)
    )[0];
    setRestockUnitConv(String(largestUnit?.conversion_rate ?? 1));
    setRestockQty('1');
    setRestockCost(String(p.cost_price));
  };

  const handleRestock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockProduct) return;
    const qtyBase = (Number(restockQty) || 0) * (Number(restockUnitConv) || 1);
    if (qtyBase <= 0) return;

    await supabase.rpc('restock_product', {
      p_product_id: restockProduct.id,
      p_qty_base: qtyBase,
      p_new_cost_price: restockCost !== '' ? Number(restockCost) : null,
      p_note: `รับเข้า ${restockQty} x ${restockUnitConv} ${restockProduct.base_unit}`,
    });

    setRestockProduct(null);
    loadData();
  };

  const buildInitialBatchDrafts = useCallback(
    (prefillByProductId?: Map<string, number>) => {
      const drafts: Record<
        string,
        { unitConv: string; unitName: string; qty: string; cost: string }
      > = {};
      for (const p of activeProducts) {
        const prefillQty = prefillByProductId?.get(p.id);
        drafts[p.id] = {
          unitConv: '1',
          unitName: p.base_unit || 'ชิ้น',
          qty: prefillQty && prefillQty > 0 ? String(prefillQty) : '',
          cost: String(Number(p.cost_price ?? 0)),
        };
      }
      return drafts;
    },
    [activeProducts]
  );

  const openBatchRestock = () => {
    setBatchDrafts(buildInitialBatchDrafts());
    setBatchSearch('');
    setBatchFilterMode('all');
    setBatchNote('');
    setBatchError('');
    setBatchPackCalcPrice('');
    setBatchPackCalcQty('12');
    setBatchPackTargetId('');
    setBatchRestockOpen(true);
  };

  const openBatchRestockFromShoppingList = () => {
    const prefillMap = new Map<string, number>();
    for (const item of filteredRestockItems) {
      if (item.recommendedQty > 0) {
        prefillMap.set(item.product.id, item.recommendedQty);
      }
    }
    setBatchDrafts(buildInitialBatchDrafts(prefillMap));
    setBatchSearch('');
    setBatchFilterMode(prefillMap.size > 0 ? 'filled' : 'all');
    setBatchNote(
      restockSupplierFilter !== 'all' && restockSupplierFilter !== '__none__'
        ? `ร้านค้าส่ง: ${restockSupplierFilter}`
        : ''
    );
    setBatchError('');
    setBatchPackCalcPrice('');
    setBatchPackCalcQty('12');
    setBatchPackTargetId('');
    setShoppingListOpen(false);
    setBatchRestockOpen(true);
  };

  const updateBatchDraft = (
    productId: string,
    patch: Partial<{ unitConv: string; unitName: string; qty: string; cost: string }>
  ) => {
    setBatchError('');
    setBatchDrafts((prev) => {
      const currentProduct = activeProducts.find((p) => p.id === productId);
      const existing = prev[productId] ?? {
        unitConv: '1',
        unitName: currentProduct?.base_unit || 'ชิ้น',
        qty: '',
        cost: String(Number(currentProduct?.cost_price ?? 0)),
      };
      return {
        ...prev,
        [productId]: { ...existing, ...patch },
      };
    });
  };

  const fillLowStockBatchQuantities = () => {
    setBatchError('');
    const recommendedById = new Map<string, number>();
    for (const item of restockListItems) {
      recommendedById.set(item.product.id, item.recommendedQty);
    }
    setBatchDrafts((prev) => {
      const next = { ...prev };
      for (const p of activeProducts) {
        const recQty = recommendedById.get(p.id);
        if (!recQty || recQty <= 0) continue;
        const current = next[p.id] ?? {
          unitConv: '1',
          unitName: p.base_unit || 'ชิ้น',
          qty: '',
          cost: String(Number(p.cost_price ?? 0)),
        };
        const currentNum = Number(current.qty);
        if (current.qty.trim() === '' || currentNum === 0) {
          next[p.id] = {
            ...current,
            unitConv: '1',
            unitName: p.base_unit || 'ชิ้น',
            qty: String(recQty),
          };
        }
      }
      return next;
    });
  };

  const clearBatchQuantities = () => {
    setBatchError('');
    setBatchDrafts((prev) => {
      const next: typeof prev = {};
      for (const [id, draft] of Object.entries(prev)) {
        next[id] = { ...draft, qty: '' };
      }
      return next;
    });
    if (batchFilterMode === 'filled') {
      setBatchFilterMode('all');
    }
  };

  const batchAllRows = useMemo(() => {
    return activeProducts.map((p) => {
      const draft = batchDrafts[p.id] ?? {
        unitConv: '1',
        unitName: p.base_unit || 'ชิ้น',
        qty: '',
        cost: String(Number(p.cost_price ?? 0)),
      };
      const rawQty = draft.qty.trim();
      const parsedQty = rawQty === '' ? 0 : Number(rawQty);
      const convRate = Number(draft.unitConv) || 1;
      const isQtyInvalid =
        rawQty !== '' && (!Number.isFinite(parsedQty) || parsedQty < 0);
      const qtyBase =
        !isQtyInvalid && parsedQty > 0
          ? Number((parsedQty * convRate).toFixed(4))
          : 0;

      const origCost = Number(p.cost_price ?? 0);
      const rawCost = draft.cost.trim();
      const parsedCost = rawCost === '' ? NaN : Number(rawCost);
      const isCostInvalid =
        qtyBase > 0 &&
        (rawCost === '' || !Number.isFinite(parsedCost) || parsedCost < 0);
      const unitCost =
        rawCost !== '' && Number.isFinite(parsedCost) && parsedCost >= 0
          ? parsedCost
          : origCost;
      const costChanged =
        qtyBase > 0 && !isCostInvalid && Math.abs(unitCost - origCost) > 0.0001;
      const lineTotalCost =
        qtyBase > 0 && !isQtyInvalid && !isCostInvalid
          ? Number((qtyBase * unitCost).toFixed(2))
          : 0;
      const isLowStock =
        !p.allow_custom_price &&
        (Number(p.stock_qty) || 0) <= (Number(p.low_stock_alert) || 0);

      return {
        product: p,
        draft,
        rawQty,
        parsedQty,
        convRate,
        qtyBase,
        origCost,
        unitCost,
        costChanged,
        lineTotalCost,
        isQtyInvalid,
        isCostInvalid,
        isInvalid: isQtyInvalid || isCostInvalid,
        isLowStock,
      };
    });
  }, [activeProducts, batchDrafts]);

  const batchVisibleRows = useMemo(() => {
    const q = batchSearch.trim().toLowerCase();
    return batchAllRows.filter((row) => {
      if (batchFilterMode === 'filled' && row.qtyBase <= 0 && !row.isInvalid) {
        return false;
      }
      if (batchFilterMode === 'low' && !row.isLowStock) {
        return false;
      }
      if (!q) return true;
      const p = row.product;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (suppliers[p.id] && suppliers[p.id].toLowerCase().includes(q)) ||
        (shelfLocations[p.id] && shelfLocations[p.id].toLowerCase().includes(q))
      );
    });
  }, [batchAllRows, batchFilterMode, batchSearch, suppliers, shelfLocations]);

  const batchPackUnitCost = useMemo(() => {
    const price = Number(batchPackCalcPrice);
    const qty = Number(batchPackCalcQty);
    if (
      batchPackCalcPrice.trim() === '' ||
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isFinite(qty) ||
      qty <= 0
    ) {
      return null;
    }
    return Math.round((price / qty) * 100) / 100;
  }, [batchPackCalcPrice, batchPackCalcQty]);

  const resolvedBatchPackTargetId = useMemo(() => {
    if (batchVisibleRows.some((row) => row.product.id === batchPackTargetId)) {
      return batchPackTargetId;
    }
    return batchVisibleRows[0]?.product.id ?? '';
  }, [batchVisibleRows, batchPackTargetId]);

  const batchSummary = useMemo(() => {
    let filledCount = 0;
    let totalBaseQty = 0;
    let totalCost = 0;
    let costChangedCount = 0;
    let invalidCount = 0;

    for (const row of batchAllRows) {
      if (row.isInvalid) {
        invalidCount += 1;
        continue;
      }
      if (row.qtyBase > 0) {
        filledCount += 1;
        totalBaseQty += row.qtyBase;
        totalCost += row.lineTotalCost;
        if (row.costChanged) {
          costChangedCount += 1;
        }
      }
    }

    return {
      filledCount,
      totalBaseQty: Number(totalBaseQty.toFixed(4)),
      totalCost: Number(totalCost.toFixed(2)),
      costChangedCount,
      invalidCount,
    };
  }, [batchAllRows]);

  const handleBatchRestock = async (e: React.FormEvent) => {
    e.preventDefault();

    const invalidRow = batchAllRows.find((r) => r.isInvalid);
    if (invalidRow) {
      setBatchError(
        `กรุณากรอกจำนวนรับเข้าและราคาทุนต่อหน่วย (>= 0) ที่ถูกต้องสำหรับ "${invalidRow.product.name}"`
      );
      return;
    }

    const rowsToReceive = batchAllRows.filter((r) => r.qtyBase > 0);
    if (rowsToReceive.length === 0) {
      setBatchError('กรุณากรอกจำนวนที่รับเข้า (> 0) อย่างน้อย 1 รายการ');
      return;
    }

    setBatchSaving(true);
    setBatchError('');

    const nowIso = new Date().toISOString();
    const lotNoteTrimmed = batchNote.trim();
    let receivedCount = 0;
    let receivedTotalCost = 0;
    const costHistoryEntries: Array<{ productId: string; prevCost: number; updatedAt: string }> = [];

    try {
      for (const row of rowsToReceive) {
        const p = row.product;
        const { data: latestProd } = await supabase
          .from('products')
          .select('stock_qty')
          .eq('id', p.id)
          .maybeSingle();

        const currentStock = Number(latestProd?.stock_qty ?? p.stock_qty ?? 0);
        const updatedStock = Number((currentStock + row.qtyBase).toFixed(4));

        const updatePayload: {
          stock_qty: number;
          updated_at: string;
          cost_price?: number;
        } = {
          stock_qty: updatedStock,
          updated_at: nowIso,
        };
        if (row.costChanged) {
          updatePayload.cost_price = row.unitCost;
        }

        const { error: updateErr } = await supabase
          .from('products')
          .update(updatePayload)
          .eq('id', p.id);

        if (updateErr) {
          throw new Error(
            `อัปเดตสต็อก "${p.name}" ไม่สำเร็จ: ${updateErr.message}`
          );
        }

        if (row.costChanged) {
          costHistoryEntries.push({
            productId: p.id,
            prevCost: Number(p.cost_price) || 0,
            updatedAt: nowIso,
          });
        }

        const unitDisplay =
          row.convRate !== 1
            ? `${row.rawQty} ${row.draft.unitName} (+${formatNumber(row.qtyBase)} ${p.base_unit})`
            : `+${formatNumber(row.qtyBase)} ${p.base_unit}`;
        const costChangeDetail = row.costChanged
          ? ` · ทุน ${formatNumber(row.origCost)}→${formatNumber(row.unitCost)} ฿`
          : '';
        const lotDetail = lotNoteTrimmed ? ` · ${lotNoteTrimmed}` : '';

        const { error: moveErr } = await supabase.from('stock_movements').insert({
          product_id: p.id,
          type: 'restock',
          qty_change: row.qtyBase,
          note: `รับของเข้าหลายรายการ: ${unitDisplay}${costChangeDetail}${lotDetail}`,
        });

        if (moveErr) {
          throw new Error(
            `บันทึกประวัติรับเข้า "${p.name}" ไม่สำเร็จ: ${moveErr.message}`
          );
        }

        receivedCount += 1;
        receivedTotalCost += row.lineTotalCost;
      }

      await loadData();
      setBatchRestockOpen(false);
      setBatchDrafts({});
      setBatchNote('');
      setBatchResultMsg(
        `รับของเข้าสต็อกเรียบร้อยแล้ว ${receivedCount} รายการ (รวมต้นทุน ${formatBaht(receivedTotalCost)}${lotNoteTrimmed ? ` · ${lotNoteTrimmed}` : ''})`
      );
    } catch (err) {
      await loadData();
      setBatchError(
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดระหว่างรับของเข้าสต็อก กรุณาลองใหม่อีกครั้ง'
      );
    } finally {
      if (costHistoryEntries.length > 0) {
        saveLastCostHistoryEntries(costHistoryEntries);
      }
      setBatchSaving(false);
    }
  };

  const TARGET_MARGIN_PERCENTS = [15, 20, 30, 50] as const;

  const calcTargetMarginPrice = (unitCost: number, pct: number) =>
    Math.ceil(Number((unitCost * (1 + pct / 100)).toFixed(6)));

  const calcUnitProfit = (
    baseCost: number | string,
    conversionRate: number | string,
    sellingPrice: number | string
  ) => {
    const unitCost = (Number(baseCost) || 0) * (Number(conversionRate) || 1);
    const price = Number(sellingPrice) || 0;
    const profit = price - unitCost;
    const marginPct = unitCost > 0 ? (profit / unitCost) * 100 : null;
    return { unitCost, price, profit, marginPct };
  };

  const getWholesaleMarginInfo = (unitPrice: number, costPriceValue: number) => {
    const cost = Number(costPriceValue) || 0;
    const price = Number(unitPrice) || 0;
    const profit = price - cost;
    const marginPct = price > 0 ? (profit / price) * 100 : null;
    const isLossOrBreakEven = cost > 0 && price <= cost;
    const isLowMargin =
      cost > 0 && !isLossOrBreakEven && marginPct !== null && marginPct < 5;
    return {
      cost,
      price,
      profit,
      marginPct,
      isLossOrBreakEven,
      isLowMargin,
    };
  };

  const getProductStockValuation = (p: Product) => {
    const stockQty = Number(p.stock_qty) || 0;
    if (stockQty <= 0) return null;
    const costPrice = Number(p.cost_price) || 0;
    const round2 = (val: number) => {
      const r = Math.round(val * 100) / 100;
      return Object.is(r, -0) ? 0 : r;
    };
    const totalCostValue = round2(stockQty * costPrice);
    if (p.allow_custom_price) {
      return { stockQty, totalCostValue, expectedProfit: null as number | null };
    }
    const unitsList = p.product_units ?? [];
    const baseSellingUnit =
      unitsList.find((u) => Number(u.conversion_rate) === 1) ??
      unitsList.find((u) => u.is_default) ??
      unitsList[0];
    if (!baseSellingUnit) {
      return { stockQty, totalCostValue, expectedProfit: null as number | null };
    }
    const convRate = Number(baseSellingUnit.conversion_rate) || 1;
    const sellingPrice = (Number(baseSellingUnit.selling_price) || 0) / convRate;
    const expectedProfit = round2(stockQty * (sellingPrice - costPrice));
    return { stockQty, totalCostValue, expectedProfit };
  };

  const handleCopyBarcode = async (productId: string, code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedBarcodeId(productId);
      setTimeout(() => {
        setCopiedBarcodeId((prev) => (prev === productId ? null : prev));
      }, 2000);
    } catch {
      // ignore clipboard errors on restricted contexts
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setCatSaving(true);
    await supabase
      .from('categories')
      .insert({ name: newCatName.trim(), sort_order: categories.length + 1 });
    setNewCatName('');
    setCatSaving(false);
    await loadData();
  };

  const handleUpdateCategory = async (catId: string) => {
    const trimmed = editingCatName.trim();
    if (!trimmed) return;
    setCatActionLoadingId(catId);
    await supabase.from('categories').update({ name: trimmed }).eq('id', catId);
    setEditingCatId(null);
    setEditingCatName('');
    setCatActionLoadingId(null);
    await loadData();
  };

  const handleDeleteCategory = async (cat: Category) => {
    setCatActionLoadingId(cat.id);
    // Unassign products in this category first so foreign keys won't block deletion
    await supabase
      .from('products')
      .update({ category_id: null })
      .eq('category_id', cat.id);
    await supabase.from('categories').delete().eq('id', cat.id);
    if (selectedCategory === cat.id) {
      setSelectedCategory('all');
    }
    if (categoryId === cat.id) {
      setCategoryId('');
    }
    setConfirmDeleteCatId(null);
    setCatActionLoadingId(null);
    await loadData();
  };

  const handleExportInventoryCsv = () => {
    const escapeCsv = (val: unknown) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
      'ลำดับ',
      'ชื่อสินค้า',
      'หมวดหมู่',
      'ตำแหน่งชั้นวาง',
      'ซัพพลายเออร์ / ร้านค้าส่ง',
      'บาร์โค้ด',
      'หน่วยย่อย',
      'ราคาทุนต่อหน่วยย่อย (บาท)',
      'สต็อกคงเหลือ',
      'จุดแจ้งเตือนใกล้หมด',
      'มูลค่าต้นทุนคงเหลือ (บาท)',
      'หน่วยขายและราคา',
      'โปรราคาส่งเมื่อซื้อครบจำนวน',
      'กำไรและ % กำไรต่อหน่วย',
      'สถานะ',
    ];

    const rows = filteredProducts.map((p, idx) => {
      const stock = Number(p.stock_qty) || 0;
      const cost = Number(p.cost_price) || 0;
      const totalCost = stock * cost;
      const unitsSummary = p.allow_custom_price
        ? 'กรอกราคาหน้างาน (ชั่ง/ตวง)'
        : (p.product_units ?? [])
            .map(
              (u) =>
                `${u.unit_name}: ${Number(u.selling_price || 0).toFixed(2)} บาท (${u.conversion_rate} ${p.base_unit})`
            )
            .join(' | ');
      const tier = wholesaleTiers[p.id];
      const wholesaleSummary = tier
        ? `ส่ง ≥${formatNumber(tier.minQty)} ชิ้น: ${tier.unitPrice.toFixed(2)} บาท/ชิ้น`
        : '-';
      const profitSummary = p.allow_custom_price
        ? '-'
        : (p.product_units ?? [])
            .map((u) => {
              const { profit, marginPct } = calcUnitProfit(
                p.cost_price,
                u.conversion_rate,
                u.selling_price
              );
              const pctText =
                marginPct !== null
                  ? `${profit >= 0 ? '+' : ''}${marginPct.toFixed(1)}%`
                  : 'ไม่ระบุทุน';
              return `${u.unit_name}: กำไร ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} บาท (${pctText})`;
            })
            .join(' | ');
      const statusText =
        p.is_active === false
          ? 'ซ่อนไว้/ยกเลิกขาย'
          : !p.allow_custom_price && stock <= (Number(p.low_stock_alert) || 0)
            ? 'ใกล้หมดสต็อก'
            : 'ปกติ';

      return [
        idx + 1,
        p.name,
        p.categories?.name ?? 'ไม่มีหมวดหมู่',
        shelfLocations[p.id] || '-',
        suppliers[p.id] || '-',
        p.barcode || '-',
        p.base_unit,
        cost.toFixed(2),
        stock,
        Number(p.low_stock_alert) || 0,
        totalCost.toFixed(2),
        unitsSummary,
        wholesaleSummary,
        profitSummary,
        statusText,
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
    link.download = `inventory-stock-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const buildInventoryMetaBackupPayload = () => {
    let nextExpiry = expiryDates;
    let nextSuppliers = suppliers;
    let nextShelfLocations = shelfLocations;
    let nextOrderPackInfos = orderPackInfos;
    let nextWholesaleTiers = wholesaleTiers;
    let nextSubstituteNotes = substituteNotes;
    let nextUnitBarcodes = unitBarcodes;
    let nextLastCostHistory = lastCostHistory;
    let nextTargetStocks = targetStocks;
    let nextPromoLabels = promoLabels;

    try {
      const rawExpiry = window.localStorage.getItem(EXPIRY_DATES_STORAGE_KEY);
      if (rawExpiry !== null) nextExpiry = parseExpiryDatesMap(rawExpiry);
      const rawSuppliers = window.localStorage.getItem(SUPPLIERS_STORAGE_KEY);
      if (rawSuppliers !== null) nextSuppliers = parseProductTextMap(rawSuppliers);
      const rawShelves = window.localStorage.getItem(SHELF_LOCATIONS_STORAGE_KEY);
      if (rawShelves !== null) nextShelfLocations = parseProductTextMap(rawShelves);
      const rawPacks = window.localStorage.getItem(ORDER_PACK_INFO_STORAGE_KEY);
      if (rawPacks !== null) nextOrderPackInfos = parseProductTextMap(rawPacks);
      const rawTiers = window.localStorage.getItem(WHOLESALE_TIERS_STORAGE_KEY);
      if (rawTiers !== null) nextWholesaleTiers = parseWholesaleTiersMap(rawTiers);
      const rawSubs = window.localStorage.getItem(SUBSTITUTE_NOTES_STORAGE_KEY);
      if (rawSubs !== null) nextSubstituteNotes = parseProductTextMap(rawSubs);
      const rawUnitBc = window.localStorage.getItem(UNIT_BARCODES_STORAGE_KEY);
      if (rawUnitBc !== null) nextUnitBarcodes = parseUnitBarcodesMap(rawUnitBc);
      const rawLastCost = window.localStorage.getItem(LAST_COST_HISTORY_STORAGE_KEY);
      if (rawLastCost !== null) nextLastCostHistory = parseLastCostHistoryMap(rawLastCost);
      const rawTargets = window.localStorage.getItem(TARGET_STOCK_STORAGE_KEY);
      if (rawTargets !== null) nextTargetStocks = parseTargetStockMap(rawTargets);
      const rawPromos = window.localStorage.getItem(PROMO_LABELS_STORAGE_KEY);
      if (rawPromos !== null) nextPromoLabels = parseProductTextMap(rawPromos);
    } catch {
      // Fallback to current in-memory state
    }

    return {
      version: 1,
      [EXPIRY_DATES_STORAGE_KEY]: nextExpiry,
      [SUPPLIERS_STORAGE_KEY]: nextSuppliers,
      [SHELF_LOCATIONS_STORAGE_KEY]: nextShelfLocations,
      [ORDER_PACK_INFO_STORAGE_KEY]: nextOrderPackInfos,
      [WHOLESALE_TIERS_STORAGE_KEY]: nextWholesaleTiers,
      [SUBSTITUTE_NOTES_STORAGE_KEY]: nextSubstituteNotes,
      [UNIT_BARCODES_STORAGE_KEY]: nextUnitBarcodes,
      [LAST_COST_HISTORY_STORAGE_KEY]: nextLastCostHistory,
      [TARGET_STOCK_STORAGE_KEY]: nextTargetStocks,
      [PROMO_LABELS_STORAGE_KEY]: nextPromoLabels,
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

  const handleExportInventoryMetaJson = () => {
    setMetaBackupError('');
    const payload = buildInventoryMetaBackupPayload();
    const jsonText = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `inventory-metadata-backup-${dateStamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setMetaBackupSuccess(`ดาวน์โหลดไฟล์สำรองข้อมูล (${link.download}) เรียบร้อยแล้ว`);
  };

  const handleCopyInventoryMetaJson = async () => {
    try {
      const payload = buildInventoryMetaBackupPayload();
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
    return parseInventoryMetaBackupJson(metaBackupJsonInput);
  }, [metaBackupJsonInput]);

  const handleRestoreInventoryMetaJson = () => {
    setMetaBackupError('');
    setMetaBackupSuccess('');

    const parsed = parseInventoryMetaBackupJson(metaBackupJsonInput);
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

    if (parsed.expiryDates !== undefined) {
      const count = writeAndSyncMap(
        EXPIRY_DATES_STORAGE_KEY,
        parsed.expiryDates,
        expiryDates,
        parseExpiryDatesMap,
        setExpiryDates
      );
      restoredSummary.push(`วันหมดอายุ ${formatNumber(count)} รายการ`);
    }
    if (parsed.suppliers !== undefined) {
      const count = writeAndSyncMap(
        SUPPLIERS_STORAGE_KEY,
        parsed.suppliers,
        suppliers,
        parseProductTextMap,
        setSuppliers
      );
      restoredSummary.push(`ร้านค้าส่ง ${formatNumber(count)} รายการ`);
    }
    if (parsed.shelfLocations !== undefined) {
      const count = writeAndSyncMap(
        SHELF_LOCATIONS_STORAGE_KEY,
        parsed.shelfLocations,
        shelfLocations,
        parseProductTextMap,
        setShelfLocations
      );
      restoredSummary.push(`ตำแหน่งชั้นวาง ${formatNumber(count)} รายการ`);
    }
    if (parsed.orderPackInfos !== undefined) {
      const count = writeAndSyncMap(
        ORDER_PACK_INFO_STORAGE_KEY,
        parsed.orderPackInfos,
        orderPackInfos,
        parseProductTextMap,
        setOrderPackInfos
      );
      restoredSummary.push(`แพ็กสั่งของ ${formatNumber(count)} รายการ`);
    }
    if (parsed.wholesaleTiers !== undefined) {
      const count = writeAndSyncMap(
        WHOLESALE_TIERS_STORAGE_KEY,
        parsed.wholesaleTiers,
        wholesaleTiers,
        parseWholesaleTiersMap,
        setWholesaleTiers
      );
      restoredSummary.push(`เรทราคาส่ง ${formatNumber(count)} รายการ`);
    }
    if (parsed.substituteNotes !== undefined) {
      const count = writeAndSyncMap(
        SUBSTITUTE_NOTES_STORAGE_KEY,
        parsed.substituteNotes,
        substituteNotes,
        parseProductTextMap,
        setSubstituteNotes
      );
      restoredSummary.push(`สินค้าทดแทน ${formatNumber(count)} รายการ`);
    }
    if (parsed.unitBarcodes !== undefined) {
      const count = writeAndSyncMap(
        UNIT_BARCODES_STORAGE_KEY,
        parsed.unitBarcodes,
        unitBarcodes,
        parseUnitBarcodesMap,
        setUnitBarcodes
      );
      restoredSummary.push(`บาร์โค้ดหน่วยแพ็ค/ลัง ${formatNumber(count)} รายการ`);
    }
    if (parsed.lastCostHistory !== undefined) {
      const count = writeAndSyncMap(
        LAST_COST_HISTORY_STORAGE_KEY,
        parsed.lastCostHistory,
        lastCostHistory,
        parseLastCostHistoryMap,
        setLastCostHistory
      );
      restoredSummary.push(`ประวัติราคาทุนก่อนหน้า ${formatNumber(count)} รายการ`);
    }
    if (parsed.targetStocks !== undefined) {
      const count = writeAndSyncMap(
        TARGET_STOCK_STORAGE_KEY,
        parsed.targetStocks,
        targetStocks,
        parseTargetStockMap,
        setTargetStocks
      );
      restoredSummary.push(`เป้าหมายสต็อกเต็มชั้น ${formatNumber(count)} รายการ`);
    }
    if (parsed.promoLabels !== undefined) {
      const count = writeAndSyncMap(
        PROMO_LABELS_STORAGE_KEY,
        parsed.promoLabels,
        promoLabels,
        parseProductTextMap,
        setPromoLabels
      );
      restoredSummary.push(`ป้ายโปรโมชั่น ${formatNumber(count)} รายการ`);
    }

    const modeLabel =
      metaRestoreMode === 'merge' ? 'ผสานข้อมูลเพิ่ม' : 'กู้คืนทับข้อมูลเดิม';
    setMetaBackupSuccess(
      `${modeLabel}สำเร็จ (${restoredSummary.join(', ')})`
    );
  };

  const parseCsvLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const openImportCsvModal = () => {
    setImportFileName('');
    setImportRows([]);
    setImportError('');
    setImportResult('');
    setImportCsvOpen(true);
  };

  const handleDownloadSampleCsv = () => {
    const headers = [
      'ชื่อสินค้า',
      'หมวดหมู่',
      'หน่วยย่อย',
      'ราคาทุน',
      'ราคาขาย',
      'สต็อกเริ่มต้น',
      'จุดแจ้งเตือน',
      'บาร์โค้ด',
    ];
    const sampleRows = [
      ['น้ำดื่ม 600 มล.', 'เครื่องดื่ม', 'ขวด', '4.50', '7.00', '48', '12', '8850000000001'],
      ['มาม่าต้มยำกุ้ง', 'บะหมี่กึ่งสำเร็จรูป', 'ซอง', '5.50', '7.00', '30', '10', '8850000000002'],
    ];
    const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;
    const csvContent =
      '\uFEFF' +
      [headers.map(escapeCsv).join(','), ...sampleRows.map((r) => r.map(escapeCsv).join(','))].join(
        '\r\n'
      );
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sample-products-import.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportCsvFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImportError('');
    setImportResult('');
    setImportFileName(file.name);

    try {
      const rawText = await file.text();
      const cleaned = rawText.replace(/^\uFEFF/, '');
      const lines = cleaned
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (lines.length === 0) {
        setImportRows([]);
        setImportError('ไฟล์ CSV ว่างเปล่า กรุณาตรวจสอบข้อมูล');
        return;
      }

      const firstCols = parseCsvLine(lines[0]);
      const isHeader =
        firstCols[0]?.replace(/\s+/g, '') === 'ชื่อสินค้า' ||
        firstCols[0]?.toLowerCase() === 'name';
      const dataLines = isHeader ? lines.slice(1) : lines;

      if (dataLines.length === 0) {
        setImportRows([]);
        setImportError('ไม่พบแถวข้อมูลสินค้าในไฟล์ CSV');
        return;
      }

      const parsed: CsvImportRow[] = dataLines.map((line, idx) => {
        const cols = parseCsvLine(line);
        const rowNumber = isHeader ? idx + 2 : idx + 1;
        const prodName = (cols[0] ?? '').trim();
        const catName = (cols[1] ?? '').trim();
        const unit = (cols[2] ?? '').trim() || 'ชิ้น';
        const costRaw = (cols[3] ?? '').trim();
        const priceRaw = (cols[4] ?? '').trim();
        const stockRaw = (cols[5] ?? '').trim();
        const alertRaw = (cols[6] ?? '').trim();
        const prodBarcode = (cols[7] ?? '').trim();

        const costNum = costRaw === '' ? 0 : Number(costRaw);
        const priceNum = priceRaw === '' ? 0 : Number(priceRaw);
        const stockNum = stockRaw === '' ? 0 : Number(stockRaw);
        const alertNum = alertRaw === '' ? 5 : Number(alertRaw);

        let error: string | undefined;
        if (!prodName) {
          error = 'ต้องระบุชื่อสินค้า';
        } else if (Number.isNaN(costNum) || costNum < 0) {
          error = 'ราคาทุนไม่ถูกต้อง';
        } else if (Number.isNaN(priceNum) || priceNum < 0) {
          error = 'ราคาขายไม่ถูกต้อง';
        } else if (Number.isNaN(stockNum) || stockNum < 0) {
          error = 'สต็อกเริ่มต้นไม่ถูกต้อง';
        } else if (Number.isNaN(alertNum) || alertNum < 0) {
          error = 'จุดแจ้งเตือนไม่ถูกต้อง';
        }

        return {
          rowNumber,
          name: prodName,
          categoryName: catName,
          baseUnit: unit,
          costPrice: Number.isNaN(costNum) ? 0 : costNum,
          sellingPrice: Number.isNaN(priceNum) ? 0 : priceNum,
          stockQty: Number.isNaN(stockNum) ? 0 : stockNum,
          lowAlert: Number.isNaN(alertNum) ? 5 : alertNum,
          barcode: prodBarcode,
          error,
        };
      });

      setImportRows(parsed);
    } catch {
      setImportRows([]);
      setImportError('ไม่สามารถอ่านไฟล์ CSV ได้ กรุณาตรวจสอบรูปแบบไฟล์ UTF-8');
    }
  };

  const handleConfirmImportCsv = async () => {
    const validRows = importRows.filter((r) => !r.error);
    if (validRows.length === 0) {
      setImportError('ไม่มีรายการที่ถูกต้องสำหรับนำเข้า');
      return;
    }

    setImporting(true);
    setImportError('');
    setImportResult('');

    try {
      // Map existing categories case-insensitively
      const catMap = new Map<string, string>();
      for (const c of categories) {
        catMap.set(c.name.trim().toLowerCase(), c.id);
      }

      let nextSortOrder =
        categories.reduce((max, c) => Math.max(max, Number(c.sort_order) || 0), 0) + 1;

      const nowIso = new Date().toISOString();
      let importedCount = 0;
      let createdCatCount = 0;

      for (const row of validRows) {
        let resolvedCategoryId: string | null = null;
        if (row.categoryName) {
          const key = row.categoryName.trim().toLowerCase();
          if (catMap.has(key)) {
            resolvedCategoryId = catMap.get(key) ?? null;
          } else {
            const { data: createdCat } = await supabase
              .from('categories')
              .insert({ name: row.categoryName.trim(), sort_order: nextSortOrder })
              .select('id')
              .single();
            if (createdCat?.id) {
              nextSortOrder += 1;
              createdCatCount += 1;
              catMap.set(key, createdCat.id);
              resolvedCategoryId = createdCat.id;
            }
          }
        }

        const { data: createdProduct, error: prodErr } = await supabase
          .from('products')
          .insert({
            name: row.name,
            category_id: resolvedCategoryId,
            barcode: row.barcode,
            base_unit: row.baseUnit,
            cost_price: row.costPrice,
            stock_qty: row.stockQty,
            low_stock_alert: row.lowAlert,
            is_quick_item: true,
            allow_custom_price: false,
            updated_at: nowIso,
          })
          .select('id')
          .single();

        if (!prodErr && createdProduct?.id) {
          await supabase.from('product_units').insert({
            product_id: createdProduct.id,
            unit_name: row.baseUnit,
            conversion_rate: 1,
            selling_price: row.sellingPrice,
            is_default: true,
          });
          importedCount += 1;
        }
      }

      await loadData();
      setImportResult(
        `นำเข้าสินค้าสำเร็จ ${importedCount} รายการ` +
          (createdCatCount > 0 ? ` (สร้างหมวดหมู่ใหม่ ${createdCatCount} หมวดหมู่)` : '')
      );
      setImportRows([]);
    } catch {
      setImportError('เกิดข้อผิดพลาดระหว่างบันทึกข้อมูลสินค้า กรุณาลองใหม่อีกครั้ง');
    } finally {
      setImporting(false);
    }
  };

  const fetchMovements = async (productId: string) => {
    setMovementsLoading(true);
    const { data } = await supabase
      .from('stock_movements')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(15);
    setMovements((data as StockMovement[]) ?? []);
    setMovementsLoading(false);
  };

  const openGlobalMovements = async () => {
    setGlobalMovementsOpen(true);
    setGlobalMovementFilter('all');
    setGlobalMovementsLoading(true);
    const { data } = await supabase
      .from('stock_movements')
      .select('*, products(name, base_unit)')
      .order('created_at', { ascending: false })
      .limit(50);
    setGlobalMovements((data as GlobalStockMovement[]) ?? []);
    setGlobalMovementsLoading(false);
  };

  const filteredGlobalMovements = useMemo(() => {
    if (globalMovementFilter === 'all') return globalMovements;
    return globalMovements.filter((m) => m.type === globalMovementFilter);
  }, [globalMovements, globalMovementFilter]);

  const globalMovementCounts = useMemo(() => {
    return {
      all: globalMovements.length,
      sale: globalMovements.filter((m) => m.type === 'sale').length,
      restock: globalMovements.filter((m) => m.type === 'restock').length,
      adjust: globalMovements.filter((m) => m.type === 'adjust').length,
    };
  }, [globalMovements]);

  const handleExportGlobalMovementsCsv = () => {
    if (filteredGlobalMovements.length === 0) return;

    const escapeCsv = (val: unknown) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = ['วันที่', 'ชื่อสินค้า', 'ประเภท', 'เปลี่ยนแปลง', 'หมายเหตุ'];

    const rows = filteredGlobalMovements.map((m) => {
      const qty = Number(m.qty_change) || 0;
      const unitLabel = m.products?.base_unit || 'ชิ้น';
      const typeLabel =
        m.type === 'restock' ? 'รับเข้า' : m.type === 'adjust' ? 'ปรับยอด' : 'ขาย';
      const changeText = `${qty > 0 ? `+${qty}` : qty} ${unitLabel}`;
      return [
        formatDateTime(m.created_at),
        m.products?.name ?? 'ไม่ระบุสินค้า',
        typeLabel,
        changeText,
        m.note || '-',
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
    link.download = `stock-movements-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const openAdjustHistory = async (p: Product) => {
    setAdjustProduct(p);
    setActualStockQty(String(p.stock_qty));
    setAdjustNote('');
    await fetchMovements(p.id);
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustProduct) return;
    const newQty = Number(actualStockQty);
    if (Number.isNaN(newQty) || newQty < 0) return;

    const currentQty = Number(adjustProduct.stock_qty) || 0;
    const diff = newQty - currentQty;
    if (diff === 0 && !adjustNote.trim()) return;

    setAdjustSaving(true);
    await supabase
      .from('products')
      .update({
        stock_qty: newQty,
        updated_at: new Date().toISOString(),
      })
      .eq('id', adjustProduct.id);

    await supabase.from('stock_movements').insert({
      product_id: adjustProduct.id,
      type: 'adjust',
      qty_change: diff,
      note:
        adjustNote.trim() ||
        `ปรับยอดสต็อกจริง (${formatNumber(currentQty)} → ${formatNumber(newQty)} ${adjustProduct.base_unit})`,
    });

    setAdjustProduct({ ...adjustProduct, stock_qty: newQty });
    setAdjustNote('');
    setAdjustSaving(false);
    await Promise.all([loadData(), fetchMovements(adjustProduct.id)]);
  };

  const writeOffProduct = useMemo(
    () => activeProducts.find((p) => p.id === writeOffProductId) ?? null,
    [activeProducts, writeOffProductId]
  );

  const writeOffExpiredCandidates = useMemo(
    () =>
      activeProducts.filter((p) => {
        const info = getProductExpiryInfo(expiryDates[p.id], todayIso);
        return info?.status === 'expired' && (Number(p.stock_qty) || 0) > 0;
      }),
    [activeProducts, expiryDates, todayIso]
  );

  const writeOffFilteredProducts = useMemo(() => {
    const q = writeOffSearch.trim().toLowerCase();
    if (!q) return activeProducts;
    return activeProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (shelfLocations[p.id] && shelfLocations[p.id].toLowerCase().includes(q))
    );
  }, [activeProducts, writeOffSearch, shelfLocations]);

  const writeOffUnitOptions = useMemo(() => {
    if (!writeOffProduct) return [];
    const options: Array<{ key: string; unitName: string; conversionRate: number }> = [];
    const seenConv = new Set<string>();
    const sortedUnits = [...(writeOffProduct.product_units ?? [])].sort(
      (a, b) => (Number(a.conversion_rate) || 1) - (Number(b.conversion_rate) || 1)
    );
    const hasBaseUnit = sortedUnits.some(
      (u) => Math.abs((Number(u.conversion_rate) || 1) - 1) < 0.0001
    );
    if (!hasBaseUnit) {
      options.push({
        key: 'base',
        unitName: writeOffProduct.base_unit || 'ชิ้น',
        conversionRate: 1,
      });
      seenConv.add('1');
    }
    for (const u of sortedUnits) {
      const rate = Math.max(0.01, Number(u.conversion_rate) || 1);
      const rateKey = String(rate);
      if (seenConv.has(rateKey)) continue;
      seenConv.add(rateKey);
      options.push({
        key: u.id || rateKey,
        unitName: u.unit_name || writeOffProduct.base_unit || 'ชิ้น',
        conversionRate: rate,
      });
    }
    return options;
  }, [writeOffProduct]);

  const writeOffCalc = useMemo(() => {
    const parsedQty = Number(writeOffQty);
    const isValidQty =
      writeOffQty.trim() !== '' && Number.isFinite(parsedQty) && parsedQty > 0;
    const unitConv = Math.max(0.01, Number(writeOffUnitConv) || 1);
    const baseQty = isValidQty
      ? Math.round(parsedQty * unitConv * 10000) / 10000
      : 0;
    const currentStock = writeOffProduct ? Number(writeOffProduct.stock_qty) || 0 : 0;
    const unitCost = writeOffProduct ? Number(writeOffProduct.cost_price) || 0 : 0;
    const costValue = Math.round(baseQty * unitCost * 100) / 100;
    const nextStock = Math.max(0, Math.round((currentStock - baseQty) * 10000) / 10000);
    return {
      parsedQty: isValidQty ? parsedQty : 0,
      isValidQty,
      unitConv,
      baseQty,
      currentStock,
      unitCost,
      costValue,
      nextStock,
      exceedsStock: isValidQty && baseQty > currentStock,
    };
  }, [writeOffProduct, writeOffQty, writeOffUnitConv]);

  const handleSelectWriteOffProduct = (
    productId: string,
    presetReason?: WriteOffReason
  ) => {
    setWriteOffProductId(productId);
    setWriteOffUnitConv('1');
    setWriteOffError('');
    const target = activeProducts.find((p) => p.id === productId);
    if (target) {
      const currentStock = Number(target.stock_qty) || 0;
      const expiryInfo = getProductExpiryInfo(expiryDates[target.id], todayIso);
      const nextReason =
        presetReason ??
        (expiryInfo?.status === 'expired' ? 'สินค้าหมดอายุ' : writeOffReason);
      if (presetReason || expiryInfo?.status === 'expired') {
        setWriteOffReason(nextReason);
      }
      if (nextReason === 'สินค้าหมดอายุ' && currentStock > 0) {
        setWriteOffQty(String(currentStock));
      } else if (currentStock > 0 && currentStock < 1) {
        setWriteOffQty(String(currentStock));
      } else {
        setWriteOffQty('1');
      }
    }
  };

  const openWriteOffModal = (product?: Product, presetReason?: WriteOffReason) => {
    setWriteOffError('');
    setWriteOffSearch('');
    setWriteOffNote('');
    if (product) {
      setWriteOffProductId(product.id);
      setWriteOffUnitConv('1');
      const currentStock = Number(product.stock_qty) || 0;
      const reason = presetReason ?? 'ชำรุด/แตกหัก';
      setWriteOffReason(reason);
      if (reason === 'สินค้าหมดอายุ' && currentStock > 0) {
        setWriteOffQty(String(currentStock));
      } else if (currentStock > 0 && currentStock < 1) {
        setWriteOffQty(String(currentStock));
      } else {
        setWriteOffQty('1');
      }
    } else {
      const firstCandidate =
        writeOffExpiredCandidates[0] ??
        activeProducts.find((p) => (Number(p.stock_qty) || 0) > 0) ??
        activeProducts[0] ??
        null;
      setWriteOffProductId(firstCandidate?.id ?? '');
      setWriteOffUnitConv('1');
      if (firstCandidate) {
        const info = getProductExpiryInfo(expiryDates[firstCandidate.id], todayIso);
        const reason =
          presetReason ?? (info?.status === 'expired' ? 'สินค้าหมดอายุ' : 'ชำรุด/แตกหัก');
        setWriteOffReason(reason);
        const currentStock = Number(firstCandidate.stock_qty) || 0;
        if (reason === 'สินค้าหมดอายุ' && currentStock > 0) {
          setWriteOffQty(String(currentStock));
        } else if (currentStock > 0 && currentStock < 1) {
          setWriteOffQty(String(currentStock));
        } else {
          setWriteOffQty('1');
        }
      } else {
        setWriteOffReason(presetReason ?? 'ชำรุด/แตกหัก');
        setWriteOffQty('1');
      }
    }
    setWriteOffOpen(true);
  };

  const handleConfirmWriteOff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writeOffProduct) {
      setWriteOffError('กรุณาเลือกสินค้าที่ต้องการตัดจำหน่าย');
      return;
    }
    if (!writeOffCalc.isValidQty || writeOffCalc.baseQty <= 0) {
      setWriteOffError('กรุณาระบุจำนวนที่ต้องการตัดจำหน่ายมากกว่า 0');
      return;
    }

    const writeOffBaseQty = writeOffCalc.baseQty;
    const nextStockQty = writeOffCalc.nextStock;
    const selectedUnitOption =
      writeOffUnitOptions.find((u) => String(u.conversionRate) === writeOffUnitConv) ??
      writeOffUnitOptions[0];
    const selectedUnitName =
      selectedUnitOption?.unitName || writeOffProduct.base_unit || 'ชิ้น';

    const noteParts: string[] = [];
    if (writeOffCalc.unitConv !== 1) {
      noteParts.push(
        `${formatNumber(writeOffCalc.parsedQty)} ${selectedUnitName} (${formatNumber(writeOffBaseQty)} ${writeOffProduct.base_unit})`
      );
    } else {
      noteParts.push(`${formatNumber(writeOffBaseQty)} ${writeOffProduct.base_unit}`);
    }
    if (writeOffCalc.costValue > 0) {
      noteParts.push(`ทุน ${formatBaht(writeOffCalc.costValue)}`);
    }
    if (writeOffNote.trim()) {
      noteParts.push(writeOffNote.trim());
    }
    const movementNote = `[ตัดจำหน่าย: ${writeOffReason}] ${noteParts.join(' · ')}`;

    setWriteOffSaving(true);
    setWriteOffError('');

    const { error: updateErr } = await supabase
      .from('products')
      .update({
        stock_qty: nextStockQty,
        updated_at: new Date().toISOString(),
      })
      .eq('id', writeOffProduct.id);

    if (updateErr) {
      setWriteOffError(`อัปเดตสต็อกไม่สำเร็จ: ${updateErr.message}`);
      setWriteOffSaving(false);
      return;
    }

    const { error: moveErr } = await supabase.from('stock_movements').insert({
      product_id: writeOffProduct.id,
      type: 'adjust',
      qty_change: -writeOffBaseQty,
      note: movementNote,
    });

    if (moveErr) {
      setWriteOffError(`ลดสต็อกแล้ว แต่บันทึกประวัติสต็อกไม่สำเร็จ: ${moveErr.message}`);
      setWriteOffSaving(false);
      await loadData();
      return;
    }

    setWriteOffSaving(false);
    setWriteOffOpen(false);
    setWriteOffResultMsg(
      `ตัดจำหน่าย "${writeOffProduct.name}" จำนวน ${formatNumber(writeOffBaseQty)} ${writeOffProduct.base_unit} (${writeOffReason} · มูลค่าทุน ${formatBaht(writeOffCalc.costValue)}) เรียบร้อยแล้ว`
    );
    await loadData();
  };

  const handleToggleQuickAuditMode = () => {
    setQuickAuditMode((prev) => {
      const next = !prev;
      if (!next) {
        setQuickAuditInputs({});
        setQuickAuditSavedId(null);
      }
      return next;
    });
  };

  const handleQuickAuditStep = (p: Product, delta: number) => {
    setQuickAuditInputs((prev) => {
      const raw = prev[p.id] ?? String(p.stock_qty);
      const current = Number(raw);
      const base = raw.trim() === '' || Number.isNaN(current) ? Number(p.stock_qty) || 0 : current;
      const next = Math.max(0, Math.round((base + delta) * 1000) / 1000);
      return { ...prev, [p.id]: String(next) };
    });
  };

  const handleQuickAuditSave = async (p: Product) => {
    const raw = quickAuditInputs[p.id] ?? String(p.stock_qty);
    const newQty = Number(raw);
    if (raw.trim() === '' || Number.isNaN(newQty) || newQty < 0) return;

    const currentQty = Number(p.stock_qty) || 0;
    const diff = newQty - currentQty;

    setQuickAuditSavingId(p.id);
    const { error: updateError } = await supabase
      .from('products')
      .update({
        stock_qty: newQty,
        updated_at: new Date().toISOString(),
      })
      .eq('id', p.id);

    if (!updateError) {
      await supabase.from('stock_movements').insert({
        product_id: p.id,
        type: 'adjust',
        qty_change: diff,
        note: 'ตรวจนับสต็อกเร็ว',
      });

      setProducts((prev) =>
        prev.map((item) => (item.id === p.id ? { ...item, stock_qty: newQty } : item))
      );
      setQuickAuditInputs((prev) => ({
        ...prev,
        [p.id]: String(newQty),
      }));
      setQuickAuditSavedId(p.id);
      setTimeout(() => {
        setQuickAuditSavedId((curr) => (curr === p.id ? null : curr));
      }, 2000);
    }
    setQuickAuditSavingId(null);
  };

  const openStockAuditModal = () => {
    setStockAuditSearch('');
    setStockAuditInputs({});
    setStockAuditError('');
    setStockAuditOpen(true);
  };

  const stockAuditRows = useMemo(() => {
    return filteredProducts.map((p) => {
      const raw = stockAuditInputs[p.id];
      const trimmed = raw !== undefined ? raw.trim() : '';
      const systemQty = Number(p.stock_qty) || 0;
      const unitCost = Number(p.cost_price) || 0;

      if (trimmed === '') {
        return {
          product: p,
          raw: raw ?? '',
          systemQty,
          unitCost,
          actualQty: null as number | null,
          diff: null as number | null,
          costDiff: null as number | null,
          isInvalid: false,
          hasDiff: false,
        };
      }

      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return {
          product: p,
          raw: raw ?? '',
          systemQty,
          unitCost,
          actualQty: null as number | null,
          diff: null as number | null,
          costDiff: null as number | null,
          isInvalid: true,
          hasDiff: false,
        };
      }

      const diff = Number((parsed - systemQty).toFixed(4));
      const costDiff = Number((diff * unitCost).toFixed(2));
      return {
        product: p,
        raw: raw ?? '',
        systemQty,
        unitCost,
        actualQty: parsed,
        diff,
        costDiff,
        isInvalid: false,
        hasDiff: diff !== 0,
      };
    });
  }, [filteredProducts, stockAuditInputs]);

  const stockAuditVisibleRows = useMemo(() => {
    const q = stockAuditSearch.trim().toLowerCase();
    if (!q) return stockAuditRows;
    return stockAuditRows.filter(
      ({ product: p }) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (shelfLocations[p.id] && shelfLocations[p.id].toLowerCase().includes(q))
    );
  }, [stockAuditRows, stockAuditSearch, shelfLocations]);

  const stockAuditSummary = useMemo(() => {
    let enteredCount = 0;
    let matchedCount = 0;
    let changedCount = 0;
    let surplusCount = 0;
    let shortageCount = 0;
    let invalidCount = 0;
    let totalCostDiff = 0;

    for (const row of stockAuditRows) {
      if (row.isInvalid) {
        invalidCount += 1;
        continue;
      }
      if (row.actualQty === null || row.diff === null || row.costDiff === null) {
        continue;
      }
      enteredCount += 1;
      if (!row.hasDiff) {
        matchedCount += 1;
        continue;
      }
      changedCount += 1;
      totalCostDiff += row.costDiff;
      if (row.diff > 0) {
        surplusCount += 1;
      } else {
        shortageCount += 1;
      }
    }

    return {
      totalRows: stockAuditRows.length,
      enteredCount,
      matchedCount,
      changedCount,
      surplusCount,
      shortageCount,
      invalidCount,
      totalCostDiff: Number(totalCostDiff.toFixed(2)),
    };
  }, [stockAuditRows]);

  const handleConfirmStockAudit = async () => {
    if (stockAuditSummary.invalidCount > 0) {
      setStockAuditError('กรุณากรอกจำนวน "นับได้จริง" เป็นตัวเลขที่ไม่ติดลบ (>= 0)');
      return;
    }

    const changedRows = stockAuditRows.filter(
      (r) => !r.isInvalid && r.actualQty !== null && r.diff !== null && r.hasDiff
    );
    if (changedRows.length === 0) {
      setStockAuditError(
        'ยังไม่มีรายการที่กรอกยอด "นับได้จริง" และมีส่วนต่างจากยอดในระบบ'
      );
      return;
    }

    setStockAuditSaving(true);
    setStockAuditError('');

    const nowIso = new Date().toISOString();
    let updatedCount = 0;

    try {
      for (const row of changedRows) {
        const { error: updateErr } = await supabase
          .from('products')
          .update({
            stock_qty: row.actualQty!,
            updated_at: nowIso,
          })
          .eq('id', row.product.id);

        if (updateErr) {
          throw new Error(
            `อัปเดตสต็อก "${row.product.name}" ไม่สำเร็จ: ${updateErr.message}`
          );
        }

        const { error: moveErr } = await supabase.from('stock_movements').insert({
          product_id: row.product.id,
          type: 'adjust',
          qty_change: row.diff!,
          note: 'ตรวจนับสต็อกจริง',
        });

        if (moveErr) {
          throw new Error(
            `บันทึกประวัติสต็อก "${row.product.name}" ไม่สำเร็จ: ${moveErr.message}`
          );
        }

        updatedCount += 1;
      }

      await loadData();
      setStockAuditOpen(false);
      setStockAuditInputs({});
      setStockAuditResultMsg(
        `ปรับสต็อกตามที่นับจริงเรียบร้อยแล้ว ${updatedCount} รายการ`
      );
    } catch (err) {
      await loadData();
      setStockAuditError(
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดระหว่างปรับสต็อก กรุณาลองใหม่อีกครั้ง'
      );
    } finally {
      setStockAuditSaving(false);
    }
  };

  const handleDeactivateProduct = async () => {
    if (!confirmDeactivateProduct) return;
    setDeactivating(true);
    await supabase
      .from('products')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', confirmDeactivateProduct.id);
    setDeactivating(false);
    setConfirmDeactivateProduct(null);
    setProductModalOpen(false);
    setEditingProduct(null);
    loadData();
  };

  const handleRestoreProduct = async (product: Product) => {
    setRestoringId(product.id);
    await supabase
      .from('products')
      .update({
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', product.id);
    setRestoringId(null);
    if (editingProduct?.id === product.id) {
      setProductModalOpen(false);
      setEditingProduct(null);
    }
    loadData();
  };

  return (
    <>
      <div className="print:hidden">
        <AppShell storeName={settings?.store_name || 'ร้านขายของชำ POS'}>
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">สินค้า &amp; สต็อก</h1>
            <p className="text-sm text-slate-500">
              จัดการสินค้า หลายหน่วยนับ (ชิ้น/แพ็ค/ลัง) และรับของเข้าสต็อก
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openStockAuditModal}
              className="flex items-center gap-1.5 rounded-xl border border-teal-300 bg-teal-50 px-3.5 py-2.5 text-sm font-semibold text-teal-800 hover:bg-teal-100"
            >
              <ClipboardCheck className="h-4 w-4" />
              <span>ตรวจนับสต็อก</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setCopiedShoppingList(false);
                setRestockSupplierFilter('all');
                setShoppingListOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100"
            >
              <ClipboardList className="h-4 w-4" />
              <span>สรุปรายการสั่งของ ({inventorySummary.lowStockCount})</span>
            </button>
            <button
              type="button"
              onClick={openBatchRestock}
              className="flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 shadow-sm"
            >
              <PackagePlus className="h-4 w-4" />
              <span>รับของเข้าหลายรายการ</span>
            </button>
            <button
              type="button"
              onClick={openNewProduct}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 shadow-sm"
            >
              <Plus className="h-4 w-4" />
              <span>เพิ่มสินค้าใหม่</span>
            </button>
            <button
              type="button"
              onClick={() => setShowMoreInventoryTools((prev) => !prev)}
              aria-expanded={showMoreInventoryTools}
              className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition-colors ${
                showMoreInventoryTools
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>{showMoreInventoryTools ? 'ซ่อนเครื่องมือเสริม' : 'เครื่องมือคลังเสริม (⋯)'}</span>
            </button>
          </div>
        </div>

        {showMoreInventoryTools && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
            <button
              type="button"
              onClick={handleToggleQuickAuditMode}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                quickAuditMode
                  ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm hover:bg-indigo-700'
                  : 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
              }`}
            >
              <ClipboardCheck className="h-4 w-4" />
              <span>
                {quickAuditMode ? 'ปิดโหมดตรวจนับสต็อกเร็ว' : 'โหมดตรวจนับสต็อกเร็ว'}
              </span>
            </button>
            <button
              type="button"
              onClick={openGlobalMovements}
              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <History className="h-4 w-4" />
              <span>ประวัติสต็อกล่าสุด</span>
            </button>
            <button
              type="button"
              onClick={openImportCsvModal}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              <Upload className="h-4 w-4" />
              <span>นำเข้า CSV</span>
            </button>
            <button
              type="button"
              disabled={filteredProducts.length === 0}
              onClick={handleExportInventoryCsv}
              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              <span>ส่งออก CSV ({filteredProducts.length})</span>
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
              onClick={openPriceTagsModal}
              className="flex items-center gap-1.5 rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-100"
            >
              <Tag className="h-4 w-4" />
              <span>พิมพ์ป้ายราคา</span>
            </button>
            {noBarcodeProducts.length > 0 && (
              <button
                type="button"
                onClick={openBulkBarcodeModal}
                className="flex items-center gap-1.5 rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-800 hover:bg-orange-100"
              >
                <Barcode className="h-4 w-4" />
                <span>สร้างบาร์โค้ดร้านให้สินค้าไร้บาร์โค้ด ({noBarcodeProducts.length})</span>
              </button>
            )}
            <button
              type="button"
              disabled={activeProducts.length === 0}
              onClick={openBulkPriceModal}
              className="flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
            >
              <Coins className="h-4 w-4" />
              <span>ปรับราคาหลายรายการ</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingCatId(null);
                setConfirmDeleteCatId(null);
                setCatModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FolderPlus className="h-4 w-4" />
              <span>จัดการหมวดหมู่ ({categories.length})</span>
            </button>
            <button
              type="button"
              disabled={activeProducts.length === 0}
              onClick={() => openWriteOffModal()}
              className="flex items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
            >
              <PackageMinus className="h-4 w-4" />
              <span>ตัดของเสีย / ใช้ในร้าน</span>
            </button>
          </div>
        )}

        {/* Stock Audit Result Banner */}
        {stockAuditResultMsg && (
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-800">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-teal-600 shrink-0" />
              <span>{stockAuditResultMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setStockAuditResultMsg('')}
              aria-label="ปิดข้อความแจ้งเตือน"
              className="rounded-lg p-1 text-teal-600 hover:bg-teal-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Write-Off Result Banner */}
        {writeOffResultMsg && (
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
            <div className="flex items-center gap-2">
              <PackageMinus className="h-4 w-4 text-rose-600 shrink-0" />
              <span>{writeOffResultMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setWriteOffResultMsg('')}
              aria-label="ปิดข้อความแจ้งเตือน"
              className="rounded-lg p-1 text-rose-600 hover:bg-rose-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Batch Restock Result Banner */}
        {batchResultMsg && (
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900">
            <div className="flex items-center gap-2">
              <PackagePlus className="h-4 w-4 text-sky-600 shrink-0" />
              <span>{batchResultMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setBatchResultMsg('')}
              aria-label="ปิดข้อความแจ้งเตือน"
              className="rounded-lg p-1 text-sky-600 hover:bg-sky-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Inventory Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl bg-white border border-slate-200 p-4 flex items-center justify-between shadow-xs">
            <div>
              <p className="text-xs font-semibold text-slate-500">จำนวนสินค้าทั้งหมด</p>
              <p className="text-2xl font-extrabold text-slate-900 tabular-nums mt-0.5">
                {formatNumber(inventorySummary.totalCount)}{' '}
                <span className="text-xs font-semibold text-slate-500">รายการ</span>
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
              <Boxes className="h-5 w-5" />
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-amber-200 p-4 flex items-center justify-between shadow-xs">
            <div>
              <p className="text-xs font-semibold text-amber-800">สินค้าใกล้หมดสต็อก</p>
              <p className="text-2xl font-extrabold text-amber-600 tabular-nums mt-0.5">
                {formatNumber(inventorySummary.lowStockCount)}{' '}
                <span className="text-xs font-semibold text-amber-700">รายการ</span>
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-emerald-200 p-4 flex flex-col justify-between shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-800">
                  มูลค่าสต็อกคงเหลือ (ตามราคาทุน / ราคาขาย)
                </p>
                <p className="text-2xl font-extrabold text-emerald-700 tabular-nums mt-0.5">
                  {formatBaht(inventorySummary.totalCostValue)}
                  <span className="ml-1.5 text-xs font-semibold text-emerald-600">
                    (ราคาทุน)
                  </span>
                </p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Coins className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-2.5 pt-2.5 border-t border-emerald-100 grid grid-cols-2 gap-2">
              <div>
                <p className="text-[11px] font-medium text-slate-500">
                  ตามราคาขาย (ประมาณการ)
                </p>
                <p className="text-sm font-bold text-slate-800 tabular-nums">
                  {formatBaht(inventorySummary.totalSellingValue)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-medium text-slate-500">กำไรคาดการณ์ในสต็อก</p>
                <p
                  className={`text-sm font-bold tabular-nums ${
                    inventorySummary.estimatedProfit >= 0
                      ? 'text-emerald-600'
                      : 'text-rose-600'
                  }`}
                >
                  {formatBaht(inventorySummary.estimatedProfit)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Filter & Search */}
        <div className="flex flex-wrap items-center gap-3 bg-white p-3.5 rounded-2xl border border-slate-200">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อสินค้า บาร์โค้ด ซัพพลายเออร์ หรือตำแหน่งชั้นวาง..."
              className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              aria-label="กรองตามหมวดหมู่"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">ทุกหมวดหมู่</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="uncategorized">ไม่มีหมวดหมู่</option>
            </select>

            <div className="relative inline-flex items-center">
              <Truck className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
              <select
                value={selectedSupplier}
                onChange={(e) => setSelectedSupplier(e.target.value)}
                aria-label="กรองตามร้านค้าส่ง / ซัพพลายเออร์"
                className="rounded-xl border border-slate-300 bg-white pl-8 pr-3 py-2 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:outline-none"
              >
                <option value="all">ทุกร้านค้าส่ง / ซัพพลายเออร์</option>
                {supplierFilterOptions.map((sup) => (
                  <option key={sup} value={sup}>
                    {sup}
                  </option>
                ))}
                <option value="__none__">ยังไม่ระบุซัพพลายเออร์</option>
              </select>
            </div>

            <div className="relative inline-flex items-center">
              <MapPin className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
              <select
                value={selectedShelfLocation}
                onChange={(e) => setSelectedShelfLocation(e.target.value)}
                aria-label="กรองตามตำแหน่งชั้นวาง"
                className="rounded-xl border border-slate-300 bg-white pl-8 pr-3 py-2 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:outline-none"
              >
                <option value="all">ทุกตำแหน่งชั้นวาง</option>
                {shelfLocationFilterOptions.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
                <option value="__none__">ยังไม่ระบุตำแหน่งชั้นวาง</option>
              </select>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setSelectedCategory('all');
                  setSelectedSupplier('all');
                  setSelectedShelfLocation('all');
                  setFilterMode('all');
                }}
                className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                <X className="h-3.5 w-3.5" />
                <span>ล้างตัวกรอง</span>
              </button>
            )}

            <div className="relative inline-flex items-center">
              <ArrowUpDown className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
              <select
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value as 'name_asc' | 'stock_asc' | 'cost_desc')
                }
                aria-label="เรียงลำดับสินค้า"
                className="rounded-xl border border-slate-300 bg-white pl-8 pr-3 py-2 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:outline-none"
              >
                <option value="name_asc">เรียง: ชื่อ ก-ฮ</option>
                <option value="stock_asc">เรียง: สต็อกคงเหลือน้อยไปมาก</option>
                <option value="cost_desc">เรียง: ราคาทุนสูงไปต่ำ</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              ทั้งหมด ({inventorySummary.totalCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('low')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'low'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>ใกล้หมด ({inventorySummary.lowStockCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('below_target')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'below_target'
                  ? 'bg-teal-600 text-white'
                  : 'bg-teal-50 text-teal-800 hover:bg-teal-100'
              }`}
            >
              <Boxes className="h-3.5 w-3.5" />
              <span>ต่ำกว่าเป้าเต็มชั้น ({belowTargetProducts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('runway_low')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'runway_low'
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>เสี่ยงของขาด ≤3 วัน ({runwayLowProducts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('out')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'out'
                  ? 'bg-red-600 text-white'
                  : 'bg-red-50 text-red-700 hover:bg-red-100'
              }`}
            >
              <X className="h-3.5 w-3.5" />
              <span>หมดสต็อก ({outOfStockProducts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('multi_unit')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'multi_unit'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
              }`}
            >
              <Boxes className="h-3.5 w-3.5" />
              <span>หลายหน่วยขาย ({multiUnitProducts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('no_barcode')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'no_barcode'
                  ? 'bg-orange-600 text-white'
                  : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
              }`}
            >
              <Tag className="h-3.5 w-3.5" />
              <span>ไม่มีบาร์โค้ด ({noBarcodeProducts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('low_margin')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'low_margin'
                  ? 'bg-pink-600 text-white'
                  : 'bg-pink-50 text-pink-700 hover:bg-pink-100'
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>กำไรต่ำ / ขาดทุน ({lowMarginProducts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('expiring')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'expiring'
                  ? 'bg-orange-600 text-white'
                  : 'bg-orange-50 text-orange-800 hover:bg-orange-100'
              }`}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              <span>ใกล้หมดอายุ / หมดอายุ ({expiringOrExpiredProducts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('wholesale')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'wholesale'
                  ? 'bg-violet-600 text-white'
                  : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
              }`}
            >
              <Tag className="h-3.5 w-3.5" />
              <span>มีโปรราคาส่ง ({wholesaleProducts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('cost_up')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'cost_up'
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              <span>ทุนเพิ่งปรับขึ้น ({costUpProducts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('has_promo')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'has_promo'
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
              }`}
            >
              <Tag className="h-3.5 w-3.5" />
              <span>มีป้ายโปรโมชั่น ({promoProducts.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('inactive')}
              className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                filterMode === 'inactive'
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
              }`}
            >
              <EyeOff className="h-3.5 w-3.5" />
              <span>ปิดใช้งาน / ซ่อนไว้ ({inactiveProducts.length})</span>
            </button>
          </div>
        </div>

        {filterMode === 'cost_up' && costUpProducts.length > 0 && (
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
            <div className="text-xs sm:text-sm font-semibold text-rose-800">
              พบสินค้าทุนเพิ่งปรับขึ้น {formatNumber(costUpProducts.length)} รายการ — ปรับราคาขายให้ทันทุนหรือกดรับทราบเพื่อล้างป้ายเตือน
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => openBulkPriceModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 shadow-xs"
              >
                <TrendingUp className="h-3.5 w-3.5" />
                <span>ปรับราคาขายสินค้าที่ทุนขึ้น</span>
              </button>
              <button
                type="button"
                onClick={() => clearLastCostHistoryEntries(costUpProducts.map((p) => p.id))}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 bg-white px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                <Check className="h-3.5 w-3.5" />
                <span>รับทราบ/ล้างเตือนทุน</span>
              </button>
            </div>
          </div>
        )}

        {/* Product Table / Cards */}
        {loading ? (
          <div className="p-8 text-center text-slate-500 text-sm">กำลังโหลดข้อมูล...</div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-3">สินค้า</th>
                    <th className="px-4 py-3">หน่วยขาย / ราคา &amp; กำไร</th>
                    <th className="px-4 py-3 text-right">ทุน/{' '}หน่วยย่อย</th>
                    <th className="px-4 py-3 text-right">คงเหลือ</th>
                    <th className="px-4 py-3 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                        {filterMode === 'inactive'
                          ? 'ไม่มีรายการสินค้าที่ปิดใช้งาน / ซ่อนไว้'
                          : filterMode === 'below_target'
                            ? 'ไม่มีสินค้าที่คงเหลือต่ำกว่าเป้าเต็มชั้น'
                            : filterMode === 'runway_low'
                            ? 'ไม่มีสินค้าที่เสี่ยงของขาดภายใน 3 วัน'
                            : filterMode === 'out'
                            ? 'ไม่มีสินค้าที่หมดสต็อก'
                            : filterMode === 'multi_unit'
                              ? 'ไม่มีสินค้าที่ตั้งค่าหลายหน่วยขาย'
                              : filterMode === 'no_barcode'
                                ? 'ไม่มีสินค้าที่ไม่มีบาร์โค้ด'
                                : filterMode === 'low_margin'
                                  ? 'ไม่มีสินค้าที่กำไรต่ำกว่า 10% หรือขาดทุน'
                                  : filterMode === 'expiring'
                                    ? 'ไม่มีสินค้าที่ใกล้หมดอายุ (ภายใน 7 วัน) หรือหมดอายุแล้ว'
                                    : filterMode === 'wholesale'
                                      ? 'ไม่มีสินค้าที่ตั้งค่าโปรราคาส่ง'
                                      : filterMode === 'cost_up'
                                        ? 'ไม่มีสินค้าที่ทุนเพิ่งปรับขึ้น'
                                        : filterMode === 'has_promo'
                                          ? 'ไม่มีสินค้าที่ติดป้ายโปรโมชั่น'
                                          : 'ไม่พบรายการสินค้าตามเงื่อนไขที่ค้นหา'}
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((p) => {
                      const isLow =
                        !p.allow_custom_price && p.stock_qty <= p.low_stock_alert;
                      const isInactive = p.is_active === false;
                      const { isLowMargin, isLoss } = getProductMarginStatus(p);
                      const wholesaleTier = wholesaleTiers[p.id];
                      const wholesaleMarginInfo = wholesaleTier
                        ? getWholesaleMarginInfo(wholesaleTier.unitPrice, Number(p.cost_price) || 0)
                        : null;
                      const expiryInfo = getProductExpiryInfo(expiryDates[p.id], todayIso);
                      const stockValuation = getProductStockValuation(p);
                      const runwayInfo = !isInactive
                        ? getStockRunwayInfo(Number(p.stock_qty) || 0, avgDailySoldMap[p.id])
                        : null;
                      return (
                        <tr
                          key={p.id}
                          className={
                            isInactive
                              ? 'bg-slate-50/60 hover:bg-slate-100/70'
                              : 'hover:bg-slate-50/70'
                          }
                        >
                          <td className="px-4 py-3">
                            <div
                              className={`font-semibold ${
                                isInactive ? 'text-slate-500 line-through' : 'text-slate-900'
                              }`}
                            >
                              {p.name}
                            </div>
                            <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
                              <span>{p.categories?.name ?? 'ไม่มีหมวดหมู่'}</span>
                              {p.barcode && p.barcode.trim() !== '' && (
                                <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                                  <span>{p.barcode}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopyBarcode(p.id, p.barcode!)}
                                    title="คัดลอกบาร์โค้ด"
                                    aria-label={`คัดลอกบาร์โค้ด ${p.barcode}`}
                                    className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-sans font-semibold transition ${
                                      copiedBarcodeId === p.id
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'
                                    }`}
                                  >
                                    {copiedBarcodeId === p.id ? (
                                      <>
                                        <Check className="h-3 w-3" />
                                        <span>คัดลอกแล้ว</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="h-3 w-3" />
                                        <span>คัดลอก</span>
                                      </>
                                    )}
                                  </button>
                                </span>
                              )}
                              {p.is_quick_item && !isInactive && (
                                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                  ★ ปุ่มด่วน
                                </span>
                              )}
                              {suppliers[p.id] && (
                                <span
                                  className="inline-flex items-center gap-1 rounded bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800"
                                  title={`ร้านค้าส่ง / ซัพพลายเออร์: ${suppliers[p.id]}`}
                                >
                                  <Truck className="h-3 w-3 shrink-0" />
                                  <span>{suppliers[p.id]}</span>
                                </span>
                              )}
                              {orderPackInfos[p.id] && (
                                <span
                                  className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                                  title={`ขนาดแพ็ค / เงื่อนไขสั่งซื้อ: ${orderPackInfos[p.id]}`}
                                >
                                  <Boxes className="h-3 w-3 shrink-0" />
                                  <span>{orderPackInfos[p.id]}</span>
                                </span>
                              )}
                              {shelfLocations[p.id] && (
                                <span
                                  className="inline-flex items-center gap-1 rounded bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-800"
                                  title={`ตำแหน่งชั้นวาง / โซนจัดเก็บ: ${shelfLocations[p.id]}`}
                                >
                                  <MapPin className="h-3 w-3 shrink-0" />
                                  <span>{shelfLocations[p.id]}</span>
                                </span>
                              )}
                              {wholesaleTier && (
                                <span
                                  className="inline-flex flex-wrap items-center gap-1 rounded bg-violet-50 border border-violet-200 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800 tabular-nums"
                                  title={`โปรราคาส่งเมื่อซื้อครบ ${formatNumber(wholesaleTier.minQty)} ชิ้นขึ้นไป: ฿${wholesaleTier.unitPrice % 1 === 0 ? formatNumber(wholesaleTier.unitPrice) : wholesaleTier.unitPrice.toFixed(2)}/ชิ้น`}
                                >
                                  <Tag className="h-3 w-3 shrink-0" />
                                  <span>
                                    ส่ง ≥{formatNumber(wholesaleTier.minQty)} ชิ้น ฿
                                    {wholesaleTier.unitPrice % 1 === 0
                                      ? formatNumber(wholesaleTier.unitPrice)
                                      : wholesaleTier.unitPrice.toFixed(2)}
                                  </span>
                                  {wholesaleMarginInfo &&
                                    wholesaleMarginInfo.cost > 0 &&
                                    wholesaleMarginInfo.marginPct !== null && (
                                      <span
                                        className={`rounded px-1 py-0.5 text-[10px] font-bold ${
                                          wholesaleMarginInfo.isLossOrBreakEven
                                            ? 'bg-rose-100 text-rose-700'
                                            : wholesaleMarginInfo.isLowMargin
                                              ? 'bg-amber-100 text-amber-800'
                                              : 'bg-emerald-100 text-emerald-800'
                                        }`}
                                      >
                                        กำไร {wholesaleMarginInfo.profit >= 0 ? '+' : ''}
                                        {formatBaht(wholesaleMarginInfo.profit)} (
                                        {wholesaleMarginInfo.marginPct.toFixed(1)}%)
                                      </span>
                                    )}
                                </span>
                              )}
                              {wholesaleMarginInfo &&
                                !isInactive &&
                                wholesaleMarginInfo.isLossOrBreakEven && (
                                  <span className="inline-flex items-center gap-1 rounded bg-rose-100 border border-rose-200 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                                    ⚠️ ราคาส่งขาดทุน
                                  </span>
                                )}
                              {wholesaleMarginInfo &&
                                !isInactive &&
                                wholesaleMarginInfo.isLowMargin && (
                                  <span className="inline-flex items-center gap-1 rounded bg-orange-100 border border-orange-200 px-1.5 py-0.5 text-[10px] font-bold text-orange-800">
                                    ⚠️ กำไรส่งต่ำ
                                  </span>
                                )}
                              {promoLabels[p.id] && (
                                <span
                                  className="inline-flex items-center gap-1 rounded bg-rose-50 border border-rose-200 px-1.5 py-0.5 text-[10px] font-bold text-rose-700"
                                  title={`ป้ายโปรโมชั่น / ป้ายเชียร์ขาย: ${promoLabels[p.id]}`}
                                >
                                  <Tag className="h-3 w-3 shrink-0" />
                                  <span>{promoLabels[p.id]}</span>
                                </span>
                              )}
                              {substituteNotes[p.id] && (
                                <span
                                  className="inline-flex items-center gap-1 rounded bg-teal-50 border border-teal-200 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800"
                                  title={`สินค้าทดแทน / คำแนะนำเมื่อของหมด: ${substituteNotes[p.id]}`}
                                >
                                  <RotateCcw className="h-3 w-3 shrink-0" />
                                  <span>ทดแทน: {substituteNotes[p.id]}</span>
                                </span>
                              )}
                              {isLowMargin && !isInactive && (
                                <span
                                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                    isLoss
                                      ? 'bg-rose-100 text-rose-700 border border-rose-200'
                                      : 'bg-amber-100 text-amber-800 border border-amber-200'
                                  }`}
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  {isLoss ? 'ขาดทุน' : 'กำไรต่ำ (<10%)'}
                                </span>
                              )}
                              {expiryInfo && !isInactive && (
                                <span
                                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                    expiryInfo.status === 'expired'
                                      ? 'bg-red-100 text-red-700 border border-red-200'
                                      : expiryInfo.status === 'expiring_soon'
                                        ? 'bg-orange-100 text-orange-800 border border-orange-200'
                                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                                  }`}
                                  title={`วันหมดอายุล็อตใกล้สุด: ${expiryInfo.formattedDate}`}
                                >
                                  <CalendarClock className="h-3 w-3" />
                                  {expiryInfo.status === 'expired'
                                    ? `หมดอายุแล้ว (${expiryInfo.formattedDate})`
                                    : expiryInfo.status === 'expiring_soon'
                                      ? `ใกล้หมดอายุ (${
                                          expiryInfo.daysRemaining === 0
                                            ? 'วันนี้'
                                            : `อีก ${expiryInfo.daysRemaining} วัน`
                                        } · ${expiryInfo.formattedDate})`
                                      : `หมดอายุ ${expiryInfo.formattedDate}`}
                                </span>
                              )}
                              {expiryInfo?.status === 'expired' && !isInactive && (
                                <button
                                  type="button"
                                  onClick={() => openWriteOffModal(p, 'สินค้าหมดอายุ')}
                                  title="ตัดจำหน่ายสินค้าหมดอายุออกจากสต็อก"
                                  className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-100"
                                >
                                  <PackageMinus className="h-3 w-3 shrink-0" />
                                  <span>ตัดจำหน่าย</span>
                                </button>
                              )}
                              {isInactive && (
                                <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                                  ซ่อนไว้ / ยกเลิกขาย
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {p.allow_custom_price ? (
                              <span className="inline-flex items-center rounded-lg bg-sky-50 border border-sky-200 px-2.5 py-1 text-xs font-semibold text-sky-700">
                                กรอกราคาขายหน้างาน (ชั่ง/ตวง)
                              </span>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {(p.product_units ?? []).map((u) => {
                                  const { price, profit } = calcUnitProfit(
                                    p.cost_price,
                                    u.conversion_rate,
                                    u.selling_price
                                  );
                                  const isLoss = profit < 0;
                                  const isZero = profit === 0;
                                  const salesMarginPct = price > 0 ? (profit / price) * 100 : null;
                                  const unitBarcode = unitBarcodes[p.id]?.[u.unit_name];
                                  return (
                                    <div
                                      key={u.id}
                                      className="inline-flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-100 border border-slate-200 px-2.5 py-1 text-xs tabular-nums"
                                    >
                                      <span className="font-semibold text-slate-800">
                                        {u.unit_name}: {formatBaht(u.selling_price)}
                                      </span>
                                      {unitBarcode && (
                                        <span
                                          className="rounded bg-white border border-slate-300 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600"
                                          title={`บาร์โค้ดหน่วย ${u.unit_name}: ${unitBarcode}`}
                                        >
                                          #{unitBarcode}
                                        </span>
                                      )}
                                      {price > 0 && salesMarginPct !== null && (
                                        <span
                                          className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                                            isLoss
                                              ? 'bg-rose-100 text-rose-700'
                                              : isZero
                                                ? 'bg-slate-200 text-slate-600'
                                                : 'bg-emerald-100 text-emerald-800'
                                          }`}
                                          title={`ทุนหน่วยนี้: ${formatBaht(
                                            (Number(p.cost_price) || 0) *
                                              (Number(u.conversion_rate) || 1)
                                          )} (${formatNumber(u.conversion_rate)} ${p.base_unit})`}
                                        >
                                          <span>
                                            กำไร {profit >= 0 ? '+' : ''}
                                            {formatBaht(profit)}
                                          </span>
                                          <span>
                                            (margin {salesMarginPct.toFixed(1)}%)
                                          </span>
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                            <div>
                              {formatBaht(p.cost_price)}/{p.base_unit}
                            </div>
                            {(() => {
                              const costEntry = lastCostHistory[p.id];
                              if (!costEntry) return null;
                              const currentCost = Number(p.cost_price) || 0;
                              const diff = Number((currentCost - costEntry.prevCost).toFixed(4));
                              if (diff === 0) return null;
                              const isUp = diff > 0;
                              return (
                                <div className="mt-1 flex flex-col items-end gap-1">
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums whitespace-nowrap ${
                                      isUp
                                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                                        : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                    }`}
                                    title={`ทุนเดิม ${formatBaht(costEntry.prevCost)} → ปัจจุบัน ${formatBaht(currentCost)}`}
                                  >
                                    {isUp
                                      ? `🔺 ทุนขึ้น +${formatBaht(diff)}`
                                      : `🔻 ทุนลด -${formatBaht(Math.abs(diff))}`}
                                  </span>
                                  {isUp && (
                                    <button
                                      type="button"
                                      onClick={() => clearLastCostHistoryEntries([p.id])}
                                      title="รับทราบและลบประวัติเตือนทุนขึ้นของสินค้านี้"
                                      className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 whitespace-nowrap"
                                    >
                                      รับทราบ/ล้างเตือนทุน
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {quickAuditMode && !isInactive && !p.allow_custom_price ? (
                              <div className="inline-flex flex-col items-end gap-1">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleQuickAuditStep(p, -1)}
                                    aria-label={`ลดยอดนับ ${p.name} 1 ${p.base_unit}`}
                                    className="h-8 min-w-8 rounded-lg border border-slate-300 bg-slate-50 px-2 text-xs font-bold text-slate-700 hover:bg-slate-100 active:bg-slate-200 touch-manipulation"
                                  >
                                    -1
                                  </button>
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    aria-label={`ยอดนับจริงของ ${p.name}`}
                                    value={quickAuditInputs[p.id] ?? String(p.stock_qty)}
                                    onChange={(e) =>
                                      setQuickAuditInputs((prev) => ({
                                        ...prev,
                                        [p.id]: e.target.value,
                                      }))
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleQuickAuditSave(p);
                                      }
                                    }}
                                    className="w-20 rounded-lg border border-indigo-300 bg-white px-2 py-1 text-right text-sm font-bold text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleQuickAuditStep(p, 1)}
                                    aria-label={`เพิ่มยอดนับ ${p.name} 1 ${p.base_unit}`}
                                    className="h-8 min-w-8 rounded-lg border border-slate-300 bg-slate-50 px-2 text-xs font-bold text-slate-700 hover:bg-slate-100 active:bg-slate-200 touch-manipulation"
                                  >
                                    +1
                                  </button>
                                  <span className="text-xs text-slate-500">{p.base_unit}</span>
                                  <button
                                    type="button"
                                    disabled={quickAuditSavingId === p.id}
                                    onClick={() => handleQuickAuditSave(p)}
                                    className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                                  >
                                    {quickAuditSavingId === p.id ? '...' : 'บันทึก'}
                                  </button>
                                </div>
                                {quickAuditSavedId === p.id ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                                    <Check className="h-3 w-3" />
                                    บันทึกแล้ว
                                  </span>
                                ) : (
                                  (() => {
                                    const raw = quickAuditInputs[p.id];
                                    if (raw === undefined || raw.trim() === '') return null;
                                    const parsed = Number(raw);
                                    if (Number.isNaN(parsed)) return null;
                                    const diff = parsed - (Number(p.stock_qty) || 0);
                                    if (diff === 0) return null;
                                    return (
                                      <span
                                        className={`text-[11px] font-semibold ${
                                          diff > 0 ? 'text-emerald-600' : 'text-rose-600'
                                        }`}
                                      >
                                        ส่วนต่าง {diff > 0 ? '+' : ''}
                                        {formatNumber(diff)} {p.base_unit}
                                      </span>
                                    );
                                  })()
                                )}
                              </div>
                            ) : (
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                  isInactive
                                    ? 'bg-slate-200 text-slate-700'
                                    : isLow
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-emerald-50 text-emerald-700'
                                }`}
                              >
                                {formatNumber(p.stock_qty)} {p.base_unit}
                              </span>
                            )}
                            {(() => {
                              const targetStock = targetStocks[p.id];
                              if (!targetStock || targetStock <= 0) return null;
                              const currentQty = Number(p.stock_qty) || 0;
                              const needToOrder = targetStock > currentQty;
                              const orderQty = needToOrder
                                ? Math.max(1, targetStock - currentQty)
                                : 0;
                              return (
                                <div className="mt-1 flex flex-wrap justify-end gap-1">
                                  <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 tabular-nums whitespace-nowrap">
                                    เป้าเต็มชั้น {formatNumber(targetStock)}
                                  </span>
                                  {needToOrder && !p.allow_custom_price && (
                                    <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 tabular-nums whitespace-nowrap">
                                      แนะนำสั่ง {formatNumber(orderQty)} {p.base_unit}
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                            {runwayInfo && (
                              <div className="mt-1 flex justify-end">
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums whitespace-nowrap ${
                                    runwayInfo.isCritical
                                      ? 'bg-red-100 border-red-300 text-red-700'
                                      : runwayInfo.isUrgent
                                        ? 'bg-orange-100 border-orange-300 text-orange-800'
                                        : 'bg-sky-50 border-sky-200 text-sky-700'
                                  }`}
                                  title={`ขายเฉลี่ย ${formatNumber(runwayInfo.avgDailySold)} ${p.base_unit}/วัน (7 วันล่าสุด)`}
                                >
                                  {runwayInfo.isUrgent ? (
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                  ) : (
                                    <TrendingUp className="h-3 w-3 shrink-0" />
                                  )}
                                  <span>
                                    พอขาย ~{formatNumber(runwayInfo.daysRemaining)} วัน
                                  </span>
                                </span>
                              </div>
                            )}
                            {stockValuation && (
                              <div className="mt-1.5 flex flex-col items-end gap-0.5 text-[11px] leading-tight tabular-nums">
                                <span className="whitespace-nowrap text-slate-500">
                                  ทุนรวม:{' '}
                                  <span className="font-semibold text-slate-700">
                                    {formatBaht(stockValuation.totalCostValue)}
                                  </span>
                                </span>
                                {stockValuation.expectedProfit !== null && (
                                  <span
                                    className={`whitespace-nowrap font-semibold ${
                                      stockValuation.expectedProfit > 0
                                        ? 'text-emerald-700'
                                        : stockValuation.expectedProfit < 0
                                          ? 'text-rose-600'
                                          : 'text-slate-500'
                                    }`}
                                  >
                                    กำไรคาดหวัง:{' '}
                                    {stockValuation.expectedProfit > 0 ? '+' : ''}
                                    {formatBaht(stockValuation.expectedProfit)}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              {isInactive ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={restoringId === p.id}
                                    onClick={() => handleRestoreProduct(p)}
                                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    <span>
                                      {restoringId === p.id
                                        ? 'กำลังกู้คืน...'
                                        : 'นำกลับมาขายใหม่'}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openDuplicateProduct(p)}
                                    title="คัดลอกสินค้าเพื่อสร้างตัวใหม่"
                                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    <span>คัดลอก</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openEditProduct(p)}
                                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                    <span>แก้ไข</span>
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openRestock(p)}
                                    className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                                  >
                                    <PackagePlus className="h-3.5 w-3.5" />
                                    <span>รับเข้า</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openAdjustHistory(p)}
                                    className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                                  >
                                    <History className="h-3.5 w-3.5" />
                                    <span>ปรับสต็อก / ประวัติ</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openDuplicateProduct(p)}
                                    title="คัดลอกสินค้าเพื่อสร้างตัวใหม่"
                                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    <span>คัดลอก</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openEditProduct(p)}
                                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                    <span>แก้ไข</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeactivateProduct(p)}
                                    title="ซ่อน / ยกเลิกการขายสินค้า"
                                    className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    <span>ลบ/ซ่อน</span>
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit Product Modal */}
      <Modal
        open={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        title={editingProduct ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleSaveProduct} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ชื่อสินค้า *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                หมวดหมู่
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">-- ไม่ระบุ --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                หน่วยย่อยที่สุด (สำหรับตัดสต็อก)
              </label>
              <input
                type="text"
                required
                value={baseUnit}
                onChange={(e) => setBaseUnit(e.target.value)}
                placeholder="เช่น ชิ้น, ขวด, ซอง, ฟอง"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ราคาทุนต่อหน่วยย่อย (บาท)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
              <button
                type="button"
                onClick={() => setPackCostHelperOpen((prev) => !prev)}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900"
              >
                <span>🧮 คำนวณทุนต่อชิ้นจากราคายกลัง/แพ็ค</span>
                <span>{packCostHelperOpen ? '▲' : '▼'}</span>
              </button>
              {packCostHelperOpen && (() => {
                const parsedPackCost = Number(packCostInput);
                const parsedPackQty = Number(packQtyInput);
                const isValidPackCalc =
                  packCostInput.trim() !== '' &&
                  Number.isFinite(parsedPackCost) &&
                  parsedPackCost >= 0 &&
                  Number.isFinite(parsedPackQty) &&
                  parsedPackQty > 0;
                const computedUnitCost = isValidPackCalc
                  ? Number((parsedPackCost / parsedPackQty).toFixed(2))
                  : null;
                return (
                  <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/70 p-2.5 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label
                          htmlFor="pack-cost-helper-total"
                          className="block text-[11px] font-semibold text-indigo-950 mb-1"
                        >
                          ราคารวมยกลัง/แพ็ค (บาท)
                        </label>
                        <input
                          id="pack-cost-helper-total"
                          type="number"
                          step="0.01"
                          min="0"
                          value={packCostInput}
                          onChange={(e) => setPackCostInput(e.target.value)}
                          placeholder="เช่น 240"
                          className="w-full rounded-lg border border-indigo-300 bg-white px-2.5 py-1.5 text-xs tabular-nums"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="pack-cost-helper-qty"
                          className="block text-[11px] font-semibold text-indigo-950 mb-1"
                        >
                          จำนวนชิ้นในลัง/แพ็ค
                        </label>
                        <input
                          id="pack-cost-helper-qty"
                          type="number"
                          step="1"
                          min="1"
                          value={packQtyInput}
                          onChange={(e) => setPackQtyInput(e.target.value)}
                          placeholder="เช่น 12"
                          className="w-full rounded-lg border border-indigo-300 bg-white px-2.5 py-1.5 text-xs tabular-nums"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[
                        { label: '÷6', qty: '6' },
                        { label: '÷12 (โหล)', qty: '12' },
                        { label: '÷24', qty: '24' },
                        { label: '÷30', qty: '30' },
                        { label: '÷48', qty: '48' },
                      ].map((preset) => {
                        const active = packQtyInput.trim() === preset.qty;
                        return (
                          <button
                            key={preset.qty}
                            type="button"
                            onClick={() => setPackQtyInput(preset.qty)}
                            className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                              active
                                ? 'border-indigo-600 bg-indigo-600 text-white'
                                : 'border-indigo-200 bg-white text-indigo-800 hover:bg-indigo-100'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span className="text-[11px] font-semibold text-indigo-900 tabular-nums">
                        {computedUnitCost !== null
                          ? `ทุนต่อชิ้น: ${formatBaht(computedUnitCost)}`
                          : 'กรอกราคาและจำนวนชิ้น > 0'}
                      </span>
                      <button
                        type="button"
                        disabled={computedUnitCost === null}
                        onClick={() => {
                          if (computedUnitCost === null) return;
                          setCostPrice(String(computedUnitCost));
                          setPackCostHelperOpen(false);
                        }}
                        className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
                      >
                        ใช้ทุนนี้
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                สต็อกคงเหลือ (หน่วยย่อย)
              </label>
              <input
                type="number"
                step="1"
                value={stockQty}
                onChange={(e) => setStockQty(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                แจ้งเตือนเมื่อต่ำกว่า
              </label>
              <input
                type="number"
                min="0"
                value={lowAlert}
                onChange={(e) => setLowAlert(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="product-target-stock"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                เป้าหมายสต็อกเต็มชั้น / Max Stock (ไม่บังคับ)
              </label>
              <input
                id="product-target-stock"
                type="number"
                min="0"
                step="any"
                value={targetStockInput}
                onChange={(e) => setTargetStockInput(e.target.value)}
                placeholder="เช่น 24 (เว้นว่างถ้าไม่กำหนด)"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                บาร์โค้ด (ถ้ามี)
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="สแกนหรือกรอกบาร์โค้ด"
                  className={`flex-1 min-w-0 rounded-xl border px-3 py-2 text-sm ${
                    duplicateBarcodeProduct
                      ? 'border-orange-400 bg-orange-50/40 focus:border-red-500 focus:outline-none'
                      : 'border-slate-300'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setBarcode(generateUniqueStoreEan13())}
                  className="shrink-0 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  title="สร้างรหัสบาร์โค้ดร้าน EAN-13 (ขึ้นต้น 200) อัตโนมัติ"
                >
                  สร้างบาร์โค้ดร้าน
                </button>
              </div>
              {duplicateBarcodeProduct && (
                <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs text-orange-800">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-orange-600 mt-0.5" />
                  <span>
                    บาร์โค้ดนี้ซ้ำกับสินค้า:{' '}
                    <strong className="font-semibold text-red-700">
                      {duplicateBarcodeProduct.name}
                    </strong>
                    {duplicateBarcodeMatch?.unitName
                      ? ` (บาร์โค้ดหน่วย: ${duplicateBarcodeMatch.unitName})`
                      : ''}
                    {duplicateBarcodeProduct.is_active === false ? ' (ปิดใช้งานอยู่)' : ''}
                  </span>
                </div>
              )}
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="product-expiry-date"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                วันหมดอายุล็อตใกล้สุด (ไม่บังคับ)
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="product-expiry-date"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="flex-1 min-w-[180px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums"
                />
                <button
                  type="button"
                  disabled={!expiryDate}
                  onClick={() => setExpiryDate('')}
                  className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>ล้างค่า</span>
                </button>
              </div>
              {(() => {
                const previewInfo = getProductExpiryInfo(expiryDate, todayIso);
                if (!previewInfo) return null;
                if (previewInfo.status === 'expired') {
                  return (
                    <p className="mt-1 text-xs font-semibold text-red-600">
                      สถานะ: หมดอายุแล้ว (ผ่านมาแล้ว {Math.abs(previewInfo.daysRemaining)} วัน)
                    </p>
                  );
                }
                if (previewInfo.status === 'expiring_soon') {
                  return (
                    <p className="mt-1 text-xs font-semibold text-orange-600">
                      สถานะ: ใกล้หมดอายุ (
                      {previewInfo.daysRemaining === 0
                        ? 'หมดอายุวันนี้'
                        : `เหลืออีก ${previewInfo.daysRemaining} วัน`}
                      )
                    </p>
                  );
                }
                return (
                  <p className="mt-1 text-xs text-slate-500">
                    เหลืออีก {previewInfo.daysRemaining} วัน ({previewInfo.formattedDate})
                  </p>
                );
              })()}
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="product-supplier-name"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                ร้านค้าส่ง / ซัพพลายเออร์ (ไม่บังคับ)
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Truck className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    id="product-supplier-name"
                    type="text"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="เช่น แม็คโคร, ร้านค้าส่งเจ๊พร, บจก. ..."
                    className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={!supplierName.trim()}
                  onClick={() => setSupplierName('')}
                  className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>ล้างค่า</span>
                </button>
              </div>
              {savedSupplierOptions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-slate-500">
                    ซัพพลายเออร์ที่เคยบันทึก:
                  </span>
                  {savedSupplierOptions.map((sup) => {
                    const isSelected = supplierName.trim() === sup;
                    return (
                      <button
                        key={sup}
                        type="button"
                        onClick={() => setSupplierName(sup)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition ${
                          isSelected
                            ? 'border-sky-600 bg-sky-50 text-sky-800'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-sky-300 hover:bg-sky-50/70 hover:text-sky-800'
                        }`}
                      >
                        <Truck className="h-3 w-3 shrink-0" />
                        <span>{sup}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="product-order-pack-info"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                ขนาดแพ็ค / เงื่อนไขสั่งซื้อ (ไม่บังคับ)
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Boxes className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    id="product-order-pack-info"
                    type="text"
                    value={orderPackInfo}
                    onChange={(e) => setOrderPackInfo(e.target.value)}
                    placeholder="เช่น แพ็คโหล (12), ยกลัง (24), สั่งขั้นต่ำ 2 ลัง..."
                    className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={!orderPackInfo.trim()}
                  onClick={() => setOrderPackInfo('')}
                  className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>ล้างค่า</span>
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-500">
                  ตัวเลือกด่วน:
                </span>
                {DEFAULT_ORDER_PACK_PRESETS.map((preset) => {
                  const isSelected = orderPackInfo.trim() === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setOrderPackInfo(preset)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition ${
                        isSelected
                          ? 'border-amber-600 bg-amber-50 text-amber-800'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-amber-300 hover:bg-amber-50/70 hover:text-amber-800'
                      }`}
                    >
                      <Boxes className="h-3 w-3 shrink-0" />
                      <span>{preset}</span>
                    </button>
                  );
                })}
              </div>
              {savedCustomOrderPackOptions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-slate-500">
                    เงื่อนไขที่เคยบันทึก:
                  </span>
                  {savedCustomOrderPackOptions.map((pack) => {
                    const isSelected = orderPackInfo.trim() === pack;
                    return (
                      <button
                        key={pack}
                        type="button"
                        onClick={() => setOrderPackInfo(pack)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition ${
                          isSelected
                            ? 'border-amber-600 bg-amber-50 text-amber-800'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-amber-300 hover:bg-amber-50/70 hover:text-amber-800'
                        }`}
                      >
                        <Boxes className="h-3 w-3 shrink-0" />
                        <span>{pack}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="product-shelf-location"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                ตำแหน่งชั้นวาง / โซนจัดเก็บ (ไม่บังคับ)
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    id="product-shelf-location"
                    type="text"
                    value={shelfLocation}
                    onChange={(e) => setShelfLocation(e.target.value)}
                    placeholder="เช่น ชั้นวางหน้าร้าน, ตู้แช่เย็น, ล็อค A2..."
                    className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={!shelfLocation.trim()}
                  onClick={() => setShelfLocation('')}
                  className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>ล้างค่า</span>
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-500">
                  ตัวเลือกด่วน:
                </span>
                {DEFAULT_SHELF_LOCATION_PRESETS.map((zone) => {
                  const isSelected = shelfLocation.trim() === zone;
                  return (
                    <button
                      key={zone}
                      type="button"
                      onClick={() => setShelfLocation(zone)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/70 hover:text-indigo-800'
                      }`}
                    >
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span>{zone}</span>
                    </button>
                  );
                })}
              </div>
              {savedCustomShelfOptions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-slate-500">
                    โซนที่เคยบันทึก:
                  </span>
                  {savedCustomShelfOptions.map((zone) => {
                    const isSelected = shelfLocation.trim() === zone;
                    return (
                      <button
                        key={zone}
                        type="button"
                        onClick={() => setShelfLocation(zone)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/70 hover:text-indigo-800'
                        }`}
                      >
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span>{zone}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="product-substitute-note"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                สินค้าทดแทน / คำแนะนำเมื่อของหมด (ไม่บังคับ)
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <RotateCcw className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    id="product-substitute-note"
                    type="text"
                    value={substituteNote}
                    onChange={(e) => setSubstituteNote(e.target.value)}
                    placeholder="เช่น แนะนำน้ำดื่มคริสตัลแทน, สั่งเพิ่มทุกวันพุธ..."
                    className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={!substituteNote.trim()}
                  onClick={() => setSubstituteNote('')}
                  className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>ล้างค่า</span>
                </button>
              </div>
              {activeProducts.filter((item) => item.id !== editingProduct?.id).length > 0 && (
                <div className="mt-1.5 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-500">
                      เลือกจากสินค้าในร้าน:
                    </span>
                    <select
                      aria-label="เลือกสินค้าทดแทนจากรายชื่อสินค้าในร้าน"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          setSubstituteNote(e.target.value);
                        }
                      }}
                      className="flex-1 min-w-[180px] rounded-lg border border-teal-200 bg-teal-50/50 px-2.5 py-1 text-xs font-medium text-teal-900 focus:border-teal-500 focus:outline-none"
                    >
                      <option value="">-- เลือกสินค้าแนะนำเมื่อของหมด --</option>
                      {activeProducts
                        .filter((item) => item.id !== editingProduct?.id)
                        .map((item) => (
                          <option key={item.id} value={`ใช้ ${item.name} แทน`}>
                            {item.name} (คงเหลือ {formatNumber(item.stock_qty)} {item.base_unit})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="product-promo-label"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                ป้ายโปรโมชั่น / ป้ายเชียร์ขาย (ไม่บังคับ)
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Tag className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-rose-400" />
                  <input
                    id="product-promo-label"
                    type="text"
                    value={promoLabel}
                    onChange={(e) => setPromoLabel(e.target.value)}
                    placeholder="เช่น 🔥 ขายดีประจำร้าน, 🎁 ซื้อ 2 แถม 1..."
                    className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={!promoLabel.trim()}
                  onClick={() => setPromoLabel('')}
                  className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>ล้างค่า</span>
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {PROMO_LABEL_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setPromoLabel(preset)}
                    className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                      promoLabel === preset
                        ? 'border-rose-500 bg-rose-600 text-white'
                        : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isQuickItem}
                onChange={(e) => setIsQuickItem(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600"
              />
              <span>ปักหมุดใน &quot;★ ปุ่มด่วน&quot;</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={allowCustomPrice}
                onChange={(e) => setAllowCustomPrice(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600"
              />
              <span>กรอกราคาขายหน้างาน (เช่น ผัก/ของชั่ง)</span>
            </label>
          </div>

          {/* Multi-unit section */}
          {!allowCustomPrice && (
            <div className="border-t border-slate-200 pt-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">
                  หน่วยขาย &amp; ราคาขาย (เพิ่มได้หลายหน่วย เช่น แพ็ค / ลัง)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setUnits((prev) => [
                      ...prev,
                      {
                        unit_name: 'แพ็ค',
                        conversion_rate: '6',
                        selling_price: '0',
                        is_default: false,
                        barcode: '',
                      },
                    ])
                  }
                  className="text-xs font-semibold text-emerald-600 hover:underline"
                >
                  + เพิ่มหน่วยขาย
                </button>
              </div>

              <div className="grid grid-cols-12 gap-2 px-2 text-[11px] font-semibold text-slate-500">
                <div className="col-span-4">ชื่อหน่วยขาย</div>
                <div className="col-span-3">จำนวน ({baseUnit || 'หน่วยย่อย'})</div>
                <div className="col-span-3">ราคาขาย (บาท)</div>
                <div className="col-span-2 text-right">หน่วยหลัก</div>
              </div>

              <div className="space-y-2">
                {units.map((u, idx) => {
                  const { unitCost, profit, marginPct } = calcUnitProfit(
                    costPrice,
                    u.conversion_rate,
                    u.selling_price
                  );
                  const isLoss = profit < 0;
                  const isZero = profit === 0;
                  return (
                    <div
                      key={idx}
                      className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 space-y-2"
                    >
                      <div className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-4">
                          <input
                            type="text"
                            placeholder="ชื่อหน่วย"
                            value={u.unit_name}
                            onChange={(e) =>
                              setUnits((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, unit_name: e.target.value } : item
                                )
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white"
                          />
                        </div>
                        <div className="col-span-3">
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            placeholder="กี่หน่วยย่อย"
                            title="1 หน่วยนี้เท่ากับกี่หน่วยย่อย"
                            value={u.conversion_rate}
                            onChange={(e) =>
                              setUnits((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, conversion_rate: e.target.value } : item
                                )
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white tabular-nums"
                          />
                        </div>
                        <div className="col-span-3">
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            placeholder="ราคาขาย"
                            value={u.selling_price}
                            onChange={(e) =>
                              setUnits((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, selling_price: e.target.value } : item
                                )
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white tabular-nums"
                          />
                        </div>
                        <div className="col-span-2 flex items-center justify-end gap-1">
                          <input
                            type="radio"
                            name="default_unit"
                            title="ตั้งเป็นหน่วยหลัก"
                            checked={u.is_default}
                            onChange={() =>
                              setUnits((prev) =>
                                prev.map((item, i) => ({ ...item, is_default: i === idx }))
                              )
                            }
                          />
                          {units.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setUnits((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="p-1 text-rose-500 hover:bg-rose-50 rounded"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {(() => {
                        const unitDupMatch = findDuplicateBarcodeMatch(u.barcode ?? '');
                        return (
                          <div className="space-y-1 px-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="text-[11px] font-medium text-slate-500 shrink-0">
                                บาร์โค้ดหน่วยแพ็ค/ลัง (ไม่บังคับ)
                              </label>
                              <input
                                type="text"
                                placeholder="สแกนหรือกรอกบาร์โค้ดประจำหน่วยนี้"
                                value={u.barcode ?? ''}
                                onChange={(e) =>
                                  setUnits((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, barcode: e.target.value } : item
                                    )
                                  )
                                }
                                className={`flex-1 min-w-[160px] rounded-lg border px-2 py-1 text-xs font-mono ${
                                  unitDupMatch
                                    ? 'border-orange-400 bg-orange-50/40 focus:border-red-500 focus:outline-none'
                                    : 'border-slate-300 bg-white'
                                }`}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const nextBarcode = generateUniqueStoreEan13();
                                  setUnits((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, barcode: nextBarcode } : item
                                    )
                                  );
                                }}
                                className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                                title="สร้างรหัสบาร์โค้ดร้าน EAN-13 (ขึ้นต้น 200) อัตโนมัติ"
                              >
                                สร้างบาร์โค้ดร้าน
                              </button>
                            </div>
                            {unitDupMatch && (
                              <div className="flex items-start gap-1 text-[11px] text-orange-800">
                                <AlertTriangle className="h-3 w-3 shrink-0 text-orange-600 mt-0.5" />
                                <span>
                                  บาร์โค้ดหน่วยนี้ซ้ำกับสินค้า:{' '}
                                  <strong className="font-semibold text-red-700">
                                    {unitDupMatch.product.name}
                                  </strong>
                                  {unitDupMatch.unitName
                                    ? ` (หน่วย ${unitDupMatch.unitName})`
                                    : ''}
                                  {unitDupMatch.product.is_active === false
                                    ? ' (ปิดใช้งานอยู่)'
                                    : ''}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      <div className="flex flex-wrap items-center justify-between gap-1.5 px-0.5">
                        <span className="text-[11px] font-medium text-slate-500">
                          {Number.isFinite(unitCost) && unitCost > 0
                            ? 'ตั้งราคาตามกำไรเป้าหมาย:'
                            : 'ระบุราคาทุน > 0 เพื่อใช้ปุ่มคำนวณราคาขาย:'}
                        </span>
                        <div className="flex flex-wrap items-center gap-1">
                          {TARGET_MARGIN_PERCENTS.map((pct) => {
                            const hasPositiveCost = Number.isFinite(unitCost) && unitCost > 0;
                            const targetPrice = hasPositiveCost
                              ? calcTargetMarginPrice(unitCost, pct)
                              : null;
                            const isSelected =
                              targetPrice !== null &&
                              u.selling_price.trim() !== '' &&
                              Number(u.selling_price) === targetPrice;
                            return (
                              <button
                                key={pct}
                                type="button"
                                disabled={!hasPositiveCost}
                                onClick={() => {
                                  if (targetPrice === null) return;
                                  setUnits((prev) =>
                                    prev.map((item, i) =>
                                      i === idx
                                        ? { ...item, selling_price: String(targetPrice) }
                                        : item
                                    )
                                  );
                                }}
                                title={
                                  targetPrice !== null
                                    ? `ตั้งราคาขาย ${formatBaht(targetPrice)} (กำไรเป้าหมาย +${pct}% จากทุน ${formatBaht(unitCost)})`
                                    : 'กรุณาระบุราคาทุนต่อหน่วยย่อย > 0 ก่อน'
                                }
                                className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold tabular-nums transition ${
                                  !hasPositiveCost
                                    ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                                    : isSelected
                                      ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                                      : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/70 hover:text-emerald-700'
                                }`}
                              >
                                +{pct}%
                                {targetPrice !== null ? ` (${formatBaht(targetPrice)})` : ''}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white border border-slate-200/80 px-2.5 py-1.5 text-[11px] tabular-nums">
                        <span className="text-slate-500">
                          ทุนหน่วยนี้:{' '}
                          <strong className="text-slate-700">{formatBaht(unitCost)}</strong> (
                          {formatNumber(Number(u.conversion_rate) || 1)} {baseUnit || 'ชิ้น'} ×{' '}
                          {formatBaht(Number(costPrice) || 0)})
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 font-bold ${
                            isLoss
                              ? 'text-rose-600'
                              : isZero
                                ? 'text-slate-600'
                                : 'text-emerald-700'
                          }`}
                        >
                          <TrendingUp className="h-3 w-3" />
                          <span>
                            กำไร/หน่วย: {profit >= 0 ? '+' : ''}
                            {formatBaht(profit)}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] ${
                              isLoss
                                ? 'bg-rose-50 text-rose-700'
                                : isZero
                                  ? 'bg-slate-100 text-slate-600'
                                  : 'bg-emerald-50 text-emerald-800'
                            }`}
                          >
                            {marginPct !== null
                              ? `${profit >= 0 ? '+' : ''}${marginPct.toFixed(1)}%`
                              : 'ทุน 0 บาท'}
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Wholesale Tier Promotion (optional) */}
          <div className="border-t border-slate-200 pt-3">
            <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Tag className="h-4 w-4 text-violet-600 shrink-0" />
                  <span className="text-xs font-bold text-violet-900">
                    โปรราคาส่งเมื่อซื้อครบจำนวน (ไม่บังคับ)
                  </span>
                </div>
                <button
                  type="button"
                  disabled={!wholesaleMinQty.trim() && !wholesaleUnitPrice.trim()}
                  onClick={() => {
                    setWholesaleMinQty('');
                    setWholesaleUnitPrice('');
                    setWholesaleError('');
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <X className="h-3 w-3" />
                  <span>ล้างค่า</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label
                    htmlFor="product-wholesale-min-qty"
                    className="block text-[11px] font-semibold text-slate-700 mb-1"
                  >
                    จำนวนขั้นต่ำ (ชิ้น)
                  </label>
                  <input
                    id="product-wholesale-min-qty"
                    type="number"
                    min="2"
                    step="1"
                    value={wholesaleMinQty}
                    onChange={(e) => {
                      setWholesaleMinQty(e.target.value);
                      setWholesaleError('');
                    }}
                    placeholder="เช่น 6 หรือ 12 (ขั้นต่ำ 2)"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label
                    htmlFor="product-wholesale-unit-price"
                    className="block text-[11px] font-semibold text-slate-700 mb-1"
                  >
                    ราคาขายต่อชิ้นเมื่อครบจำนวน (บาท)
                  </label>
                  <input
                    id="product-wholesale-unit-price"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={wholesaleUnitPrice}
                    onChange={(e) => {
                      setWholesaleUnitPrice(e.target.value);
                      setWholesaleError('');
                    }}
                    placeholder="เช่น 8.50"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>

              {wholesaleError && (
                <p className="text-xs font-semibold text-rose-600">{wholesaleError}</p>
              )}

              {(() => {
                const parsedMin = Number(wholesaleMinQty.trim());
                const parsedPrice = Number(wholesaleUnitPrice.trim());
                if (
                  !wholesaleMinQty.trim() ||
                  !wholesaleUnitPrice.trim() ||
                  !Number.isFinite(parsedMin) ||
                  !Number.isInteger(parsedMin) ||
                  parsedMin < 2 ||
                  !Number.isFinite(parsedPrice) ||
                  parsedPrice <= 0
                ) {
                  return null;
                }
                const wholesaleMarginInfo = getWholesaleMarginInfo(
                  parsedPrice,
                  Number(costPrice) || 0
                );
                const priceDisplay =
                  parsedPrice % 1 === 0 ? formatNumber(parsedPrice) : parsedPrice.toFixed(2);
                return (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white border border-violet-200 px-2.5 py-1.5 text-[11px] tabular-nums">
                      <span className="font-semibold text-violet-800">
                        ป้ายแสดงผล: ส่ง ≥{formatNumber(parsedMin)} ชิ้น ฿{priceDisplay}
                      </span>
                      {wholesaleMarginInfo.cost > 0 && wholesaleMarginInfo.marginPct !== null && (
                        <span
                          className={`font-bold ${
                            wholesaleMarginInfo.isLossOrBreakEven
                              ? 'text-rose-600'
                              : wholesaleMarginInfo.isLowMargin
                                ? 'text-orange-700'
                                : 'text-emerald-700'
                          }`}
                        >
                          กำไรราคาส่ง: {wholesaleMarginInfo.profit >= 0 ? '+' : ''}
                          {formatBaht(wholesaleMarginInfo.profit)}/ชิ้น (margin{' '}
                          {wholesaleMarginInfo.marginPct.toFixed(1)}%)
                        </span>
                      )}
                    </div>
                    {wholesaleMarginInfo.isLossOrBreakEven && (
                      <div className="inline-flex items-center gap-1.5 rounded-lg bg-rose-100 border border-rose-200 px-2.5 py-1 text-xs font-bold text-rose-700">
                        <span>⚠️ ราคาส่งขาดทุน</span>
                        <span className="font-normal">
                          (ราคาส่งต่ำกว่าหรือเท่ากับราคาทุน {formatBaht(wholesaleMarginInfo.cost)})
                        </span>
                      </div>
                    )}
                    {wholesaleMarginInfo.isLowMargin && (
                      <div className="inline-flex items-center gap-1.5 rounded-lg bg-orange-100 border border-orange-200 px-2.5 py-1 text-xs font-bold text-orange-800">
                        <span>⚠️ กำไรส่งต่ำ</span>
                        <span className="font-normal">
                          (กำไรราคาส่งน้อยกว่า 5% ของราคาขายส่ง)
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            {editingProduct && (
              editingProduct.is_active === false ? (
                <button
                  type="button"
                  disabled={restoringId === editingProduct.id}
                  onClick={() => handleRestoreProduct(editingProduct)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>นำกลับมาขายใหม่</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeactivateProduct(editingProduct)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>ซ่อน / ยกเลิกขาย</span>
                </button>
              )
            )}
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึกสินค้า'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Restock Modal */}
      <Modal
        open={!!restockProduct}
        onClose={() => setRestockProduct(null)}
        title={`รับของเข้า: ${restockProduct?.name ?? ''}`}
        maxWidthClass="max-w-sm"
      >
        {restockProduct && (
          <form onSubmit={handleRestock} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                หน่วยที่รับเข้า
              </label>
              <select
                value={restockUnitConv}
                onChange={(e) => setRestockUnitConv(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white"
              >
                {(restockProduct.product_units ?? []).map((u) => (
                  <option key={u.id} value={u.conversion_rate}>
                    {u.unit_name} (เท่ากับ {u.conversion_rate} {restockProduct.base_unit})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                จำนวนที่รับเข้า
              </label>
              <input
                type="number"
                min="1"
                step="1"
                required
                autoFocus
                value={restockQty}
                onChange={(e) => setRestockQty(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-lg font-bold tabular-nums"
              />
              <p className="text-xs text-emerald-700 mt-1">
                จะเพิ่มเข้าสต็อก:{' '}
                {formatNumber((Number(restockQty) || 0) * (Number(restockUnitConv) || 1))}{' '}
                {restockProduct.base_unit}
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                อัปเดตทุนต่อ {restockProduct.base_unit} (บาท)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={restockCost}
                onChange={(e) => setRestockCost(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-sky-600 py-3 text-sm font-bold text-white hover:bg-sky-700"
            >
              ยืนยันรับเข้าสต็อก
            </button>
          </form>
        )}
      </Modal>

      {/* Manage Categories Modal (Add / Edit / Delete) */}
      <Modal
        open={catModalOpen}
        onClose={() => {
          setEditingCatId(null);
          setConfirmDeleteCatId(null);
          setCatModalOpen(false);
        }}
        title={`จัดการหมวดหมู่สินค้า (${categories.length})`}
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          {/* Add New Category Form */}
          <form onSubmit={handleAddCategory} className="flex items-center gap-2">
            <input
              type="text"
              required
              placeholder="เพิ่มชื่อหมวดหมู่ใหม่ เช่น ขนมขบเคี้ยว, เครื่องดื่ม..."
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={catSaving || !newCatName.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50 shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span>{catSaving ? 'กำลังเพิ่ม...' : 'เพิ่ม'}</span>
            </button>
          </form>

          {/* Existing Categories List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-600 px-1">
              <span>รายการหมวดหมู่ทั้งหมด</span>
              <span>จำนวนสินค้า</span>
            </div>

            {categories.length === 0 ? (
              <div className="rounded-xl border border-slate-200 py-8 text-center text-xs text-slate-500">
                ยังไม่มีหมวดหมู่สินค้าในระบบ
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {categories.map((cat) => {
                  const usedCount = products.filter((p) => p.category_id === cat.id).length;
                  const isEditing = editingCatId === cat.id;
                  const isConfirmDelete = confirmDeleteCatId === cat.id;
                  const isLoading = catActionLoadingId === cat.id;

                  return (
                    <div key={cat.id} className="p-3 space-y-2 hover:bg-slate-50/70">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            autoFocus
                            value={editingCatName}
                            onChange={(e) => setEditingCatName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleUpdateCategory(cat.id);
                              } else if (e.key === 'Escape') {
                                setEditingCatId(null);
                              }
                            }}
                            className="flex-1 rounded-lg border border-emerald-400 px-2.5 py-1.5 text-sm focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={isLoading || !editingCatName.trim()}
                            onClick={() => handleUpdateCategory(cat.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>บันทึก</span>
                          </button>
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => setEditingCatId(null)}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-semibold text-sm text-slate-900">
                              {cat.name}
                            </span>
                            <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 tabular-nums">
                              {usedCount} สินค้า
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={isLoading}
                              onClick={() => {
                                setConfirmDeleteCatId(null);
                                setEditingCatId(cat.id);
                                setEditingCatName(cat.name);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              <span>แก้ไข</span>
                            </button>
                            <button
                              type="button"
                              disabled={isLoading}
                              onClick={() => {
                                setEditingCatId(null);
                                setConfirmDeleteCatId(isConfirmDelete ? null : cat.id);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>ลบ</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {isConfirmDelete && (
                        <div className="rounded-xl bg-rose-50 border border-rose-200 p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-rose-800 font-medium">
                            {usedCount > 0
                              ? `มีสินค้า ${usedCount} รายการในหมวดนี้ (หากลบ สินค้าจะถูกตั้งเป็น "ไม่มีหมวดหมู่")`
                              : `ยืนยันการลบหมวดหมู่ "${cat.name}"?`}
                          </span>
                          <div className="flex items-center gap-1.5 ml-auto">
                            <button
                              type="button"
                              disabled={isLoading}
                              onClick={() => setConfirmDeleteCatId(null)}
                              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              ยกเลิก
                            </button>
                            <button
                              type="button"
                              disabled={isLoading}
                              onClick={() => handleDeleteCategory(cat)}
                              className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                              {isLoading ? 'กำลังลบ...' : 'ยืนยันลบ'}
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
        </div>
      </Modal>

      {/* Stock Adjust & Movement History Modal */}
      <Modal
        open={!!adjustProduct}
        onClose={() => setAdjustProduct(null)}
        title={`ปรับสต็อก / ประวัติ: ${adjustProduct?.name ?? ''}`}
        maxWidthClass="max-w-lg"
      >
        {adjustProduct && (
          <div className="space-y-5">
            {/* Adjust Form */}
            <form
              onSubmit={handleAdjustStock}
              className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">
                  ปรับยอดสต็อกจริง (Adjust) - กรณีของชำรุด / นับสต็อกใหม่
                </span>
                <span className="text-xs font-semibold text-slate-600 tabular-nums">
                  ในระบบปัจจุบัน: {formatNumber(adjustProduct.stock_qty)} {adjustProduct.base_unit}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ยอดสต็อกจริงที่นับได้ ({adjustProduct.base_unit}) *
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    required
                    value={actualStockQty}
                    onChange={(e) => setActualStockQty(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold tabular-nums"
                  />
                  {(() => {
                    const diff =
                      (Number(actualStockQty) || 0) - (Number(adjustProduct.stock_qty) || 0);
                    if (diff === 0) {
                      return (
                        <p className="text-[11px] text-slate-500 mt-1">ยอดเท่าเดิม (ส่วนต่าง 0)</p>
                      );
                    }
                    return (
                      <p
                        className={`text-[11px] font-semibold mt-1 tabular-nums ${
                          diff > 0 ? 'text-emerald-700' : 'text-rose-600'
                        }`}
                      >
                        ส่วนต่าง: {diff > 0 ? `+${formatNumber(diff)}` : formatNumber(diff)}{' '}
                        {adjustProduct.base_unit}
                      </p>
                    );
                  })()}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    สาเหตุ / หมายเหตุ
                  </label>
                  <input
                    type="text"
                    value={adjustNote}
                    onChange={(e) => setAdjustNote(e.target.value)}
                    placeholder="เช่น นับสต็อกใหม่, ของชำรุด, หมดอายุ"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={
                  adjustSaving ||
                  ((Number(actualStockQty) || 0) === (Number(adjustProduct.stock_qty) || 0) &&
                    !adjustNote.trim())
                }
                className="w-full rounded-xl bg-amber-600 py-2.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {adjustSaving ? 'กำลังบันทึก...' : 'บันทึกการปรับสต็อกจริง'}
              </button>
            </form>

            {/* Stock Movements History */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-700">
                  ประวัติความเคลื่อนไหวสต็อก (15 รายการล่าสุด)
                </h4>
                <span className="text-[11px] text-slate-400">หน่วย: {adjustProduct.base_unit}</span>
              </div>

              {movementsLoading ? (
                <div className="py-6 text-center text-xs text-slate-500">กำลังโหลดประวัติ...</div>
              ) : movements.length === 0 ? (
                <div className="rounded-xl border border-slate-200 py-6 text-center text-xs text-slate-500">
                  ยังไม่มีประวัติความเคลื่อนไหวของสินค้านี้
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                  {movements.map((m) => {
                    const qty = Number(m.qty_change) || 0;
                    const typeBadge =
                      m.type === 'restock'
                        ? { label: 'รับเข้า', cls: 'bg-sky-50 text-sky-700' }
                        : m.type === 'adjust'
                          ? { label: 'ปรับสต็อก', cls: 'bg-amber-50 text-amber-800' }
                          : { label: 'ขายออก', cls: 'bg-rose-50 text-rose-700' };

                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${typeBadge.cls}`}
                            >
                              {typeBadge.label}
                            </span>
                            <span className="text-slate-500">{formatDateTime(m.created_at)}</span>
                          </div>
                          {m.note && <p className="text-slate-600 truncate">{m.note}</p>}
                        </div>
                        <div
                          className={`font-bold tabular-nums shrink-0 ${
                            qty > 0
                              ? 'text-emerald-600'
                              : qty < 0
                                ? 'text-rose-600'
                                : 'text-slate-600'
                          }`}
                        >
                          {qty > 0 ? `+${formatNumber(qty)}` : formatNumber(qty)}{' '}
                          {adjustProduct.base_unit}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm Deactivate / Hide Product Modal */}
      <Modal
        open={!!confirmDeactivateProduct}
        onClose={() => !deactivating && setConfirmDeactivateProduct(null)}
        title="ยืนยันการซ่อน / ยกเลิกการขายสินค้า"
        maxWidthClass="max-w-sm"
      >
        {confirmDeactivateProduct && (
          <div className="space-y-4">
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 text-xs text-rose-800 space-y-1">
              <p className="font-bold text-sm text-rose-900">
                ต้องการยกเลิกการขาย &quot;{confirmDeactivateProduct.name}&quot; หรือไม่?
              </p>
              <p>
                ระบบจะซ่อนสินค้านี้จากหน้าขาย POS และคลังสินค้า (ตั้งค่า{' '}
                <code className="font-mono">is_active: false</code>) โดยไม่กระทบประวัติบิลเก่า
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={deactivating}
                onClick={() => setConfirmDeactivateProduct(null)}
                className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={deactivating}
                onClick={handleDeactivateProduct}
                className="flex-1 rounded-xl bg-rose-600 py-2.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {deactivating ? 'กำลังดำเนินการ...' : 'ยืนยันซ่อนสินค้า'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Restock Shopping List Modal */}
      <Modal
        open={shoppingListOpen}
        onClose={() => setShoppingListOpen(false)}
        title={`สรุปรายการสั่งของ (${restockListItems.length} รายการ)`}
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-amber-900">
              <p className="font-bold">รายการสินค้าที่สต็อกคงเหลือ &le; จุดแจ้งเตือน (รวมสินค้าหมดสต็อก)</p>
              <p className="text-amber-700 mt-0.5">
                ต้นทุนประมาณการรวม:{' '}
                <span className="font-extrabold text-amber-950">
                  {formatBaht(restockTotalEstimatedCost)}
                </span>{' '}
                (คำนวณจากจำนวนแนะนำสั่ง &times; ราคาทุน
                {restockSupplierFilter !== 'all'
                  ? ` · กรอง ${filteredRestockItems.length} รายการ`
                  : ''}
                )
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={filteredRestockItems.length === 0}
                onClick={openBatchRestockFromShoppingList}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-sky-700 disabled:opacity-50"
              >
                <PackagePlus className="h-4 w-4" />
                <span>ส่งเข้าโหมดรับของ ({filteredRestockItems.length})</span>
              </button>
              <button
                type="button"
                disabled={filteredRestockItems.length === 0}
                onClick={() => {
                  setPrintMode('purchase_order');
                  setPoPrintDateText(
                    new Date().toLocaleString('th-TH', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  );
                  setPrintSeq((prev) => prev + 1);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                <span>พิมพ์ใบสั่งซื้อ (A4)</span>
              </button>
              <button
                type="button"
                disabled={filteredRestockItems.length === 0}
                onClick={handleExportRestockCsv}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3.5 py-2.5 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                <span>ส่งออก CSV</span>
              </button>
              <button
                type="button"
                disabled={filteredRestockItems.length === 0}
                onClick={handleCopyShoppingList}
                className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold shadow-xs transition disabled:opacity-50 ${
                  copiedShoppingList
                    ? 'bg-emerald-600 text-white'
                    : 'bg-amber-600 text-white hover:bg-amber-700'
                }`}
              >
                {copiedShoppingList ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>คัดลอกลง Clipboard แล้ว!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>คัดลอกรายการสั่งซื้อ</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {restockListItems.length > 0 && restockSupplierOptions.list.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 mr-1">
                กรองตามร้านค้าส่ง:
              </span>
              <button
                type="button"
                onClick={() => setRestockSupplierFilter('all')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  restockSupplierFilter === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                ทั้งหมด ({restockListItems.length})
              </button>
              {restockSupplierOptions.list.map((sup) => (
                <button
                  key={sup.name}
                  type="button"
                  onClick={() => setRestockSupplierFilter(sup.name)}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    restockSupplierFilter === sup.name
                      ? 'bg-sky-600 text-white'
                      : 'bg-sky-50 text-sky-800 border border-sky-200 hover:bg-sky-100'
                  }`}
                >
                  <Truck className="h-3 w-3 shrink-0" />
                  <span>
                    {sup.name} ({sup.count})
                  </span>
                </button>
              ))}
              {restockSupplierOptions.unassignedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setRestockSupplierFilter('__none__')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    restockSupplierFilter === '__none__'
                      ? 'bg-slate-700 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  ยังไม่ระบุ ({restockSupplierOptions.unassignedCount})
                </button>
              )}
            </div>
          )}

          {restockListItems.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 py-10 text-center text-sm text-slate-500">
              สต็อกสินค้าทุกรายการยังมีเพียงพอ ไม่มีสินค้าใกล้หมดในขณะนี้
            </div>
          ) : filteredRestockItems.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 py-10 text-center text-sm text-slate-500">
              ไม่มีรายการสั่งซื้อในกลุ่มซัพพลายเออร์ที่เลือก
            </div>
          ) : (
            <>
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                {filteredRestockItems.map(
                  (
                    {
                      product: p,
                      stockQty,
                      lowAlertVal,
                      targetStock,
                      recommendedQty,
                      estimatedCost,
                      largestUnit,
                      supplier,
                      orderPackInfo: packInfo,
                    },
                    idx
                  ) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 text-sm">
                          {idx + 1}. {p.name}
                        </div>
                        <div className="text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
                          {supplier ? (
                            <span className="inline-flex items-center gap-1 rounded bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800">
                              <Truck className="h-3 w-3 shrink-0" />
                              <span>ร้านค้าส่ง: {supplier}</span>
                            </span>
                          ) : (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                              ยังไม่ระบุร้านค้าส่ง
                            </span>
                          )}
                          {packInfo && (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                              <Boxes className="h-3 w-3 shrink-0" />
                              <span>แพ็คสั่งซื้อ: {packInfo}</span>
                            </span>
                          )}
                          <span>•</span>
                          <span>หมวด: {p.categories?.name ?? 'ไม่ระบุ'}</span>
                          <span>•</span>
                          <span>
                            ทุน: {formatBaht(p.cost_price)}/{p.base_unit}
                          </span>
                          <span>•</span>
                          <span className="font-semibold text-slate-700">
                            จุดแจ้งเตือน: {formatNumber(lowAlertVal)} {p.base_unit}
                          </span>
                          {targetStock !== undefined && targetStock > 0 && (
                            <span className="rounded bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 tabular-nums">
                              เป้าเต็มชั้น {formatNumber(targetStock)} {p.base_unit}
                            </span>
                          )}
                          {largestUnit && Number(largestUnit.conversion_rate) > 1 && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                              หน่วยใหญ่: {largestUnit.unit_name} ({formatNumber(largestUnit.conversion_rate)}{' '}
                              {p.base_unit})
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <div className="text-right">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-extrabold tabular-nums ${
                              stockQty <= 0
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            คงเหลือ {formatNumber(stockQty)} {p.base_unit}
                          </span>
                          <span className="block text-[11px] font-bold text-sky-700 mt-0.5 tabular-nums">
                            แนะนำสั่ง {formatNumber(recommendedQty)} {p.base_unit} ({formatBaht(estimatedCost)})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setShoppingListOpen(false);
                            openRestock(p);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                        >
                          <PackagePlus className="h-3.5 w-3.5" />
                          <span>รับเข้า</span>
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-600">
                  ตัวอย่างข้อความที่จะคัดลอกส่ง LINE:
                </label>
                <pre className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 whitespace-pre-wrap font-sans max-h-40 overflow-y-auto">
                  {shoppingListText}
                </pre>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Batch Restock Modal (Bulk Stock Receive) */}
      <Modal
        open={batchRestockOpen}
        onClose={() => {
          if (!batchSaving) setBatchRestockOpen(false);
        }}
        title={`รับของเข้าสต็อกหลายรายการ (${activeProducts.length} รายการ)`}
        maxWidthClass="max-w-4xl"
      >
        <form onSubmit={handleBatchRestock} className="space-y-4">
          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold text-slate-500">
                รายการที่จะรับเข้า
              </p>
              <p className="mt-0.5 text-lg font-extrabold text-slate-900 tabular-nums">
                {formatNumber(batchSummary.filledCount)}{' '}
                <span className="text-xs font-semibold text-slate-500">
                  / {formatNumber(activeProducts.length)} รายการ
                </span>
              </p>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
              <p className="text-[11px] font-semibold text-emerald-800">
                จำนวนรับเข้ารวม (หน่วยย่อย)
              </p>
              <p className="mt-0.5 text-lg font-extrabold text-emerald-700 tabular-nums">
                +{formatNumber(batchSummary.totalBaseQty)}
              </p>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <p className="text-[11px] font-semibold text-amber-800">
                รายการที่ราคาทุนเปลี่ยน
              </p>
              <p className="mt-0.5 text-lg font-extrabold text-amber-700 tabular-nums">
                {formatNumber(batchSummary.costChangedCount)}{' '}
                <span className="text-xs font-semibold text-amber-700">รายการ</span>
              </p>
            </div>

            <div className="rounded-xl border border-sky-300 bg-sky-50 p-3">
              <p className="text-[11px] font-semibold text-sky-900">
                ยอดรวมต้นทุนบิลรับของเข้าทั้งหมด
              </p>
              <p className="mt-0.5 text-lg font-extrabold text-sky-700 tabular-nums">
                {formatBaht(batchSummary.totalCost)}
              </p>
            </div>
          </div>

          {/* Lot / Supplier Note */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="batch-lot-note"
                className="block text-xs font-semibold text-slate-700"
              >
                หมายเหตุล็อต / ร้านค้าส่ง (ไม่บังคับ)
              </label>
              {batchNote && (
                <button
                  type="button"
                  disabled={batchSaving}
                  onClick={() => setBatchNote('')}
                  className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 disabled:opacity-50"
                >
                  ล้างหมายเหตุ
                </button>
              )}
            </div>
            <input
              id="batch-lot-note"
              type="text"
              disabled={batchSaving}
              value={batchNote}
              onChange={(e) => setBatchNote(e.target.value)}
              placeholder="เช่น บิลแม็คโคร ล็อต พ.ย. 69, เลขที่ใบส่งของ..."
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
            />
            {savedSupplierOptions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-500">
                  เลือกร้านค้าส่งด่วน:
                </span>
                {savedSupplierOptions.map((sup) => {
                  const preset = `ร้านค้าส่ง: ${sup}`;
                  const isActive = batchNote.trim() === preset;
                  return (
                    <button
                      key={sup}
                      type="button"
                      disabled={batchSaving}
                      onClick={() => setBatchNote(isActive ? '' : preset)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition ${
                        isActive
                          ? 'border-sky-600 bg-sky-600 text-white'
                          : 'border-sky-200 bg-white text-sky-800 hover:bg-sky-100'
                      }`}
                    >
                      <Truck className="h-3 w-3 shrink-0" />
                      <span>{sup}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Search, Filter Tabs & Quick Fill */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={batchSearch}
                onChange={(e) => setBatchSearch(e.target.value)}
                placeholder="ค้นหาชื่อสินค้า บาร์โค้ด ซัพพลายเออร์..."
                className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { key: 'all', label: `ทั้งหมด (${activeProducts.length})` },
                  { key: 'filled', label: `กรอกรับเข้าแล้ว (${batchSummary.filledCount})` },
                  { key: 'low', label: `สินค้าใกล้หมด (${lowStockProducts.length})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setBatchFilterMode(tab.key)}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    batchFilterMode === tab.key
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {restockListItems.length > 0 && (
              <button
                type="button"
                disabled={batchSaving}
                onClick={fillLowStockBatchQuantities}
                className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>เติมแนะนำสินค้าใกล้หมด ({restockListItems.length})</span>
              </button>
            )}

            {batchSummary.filledCount > 0 && (
              <button
                type="button"
                disabled={batchSaving}
                onClick={clearBatchQuantities}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>ล้างจำนวน</span>
              </button>
            )}
          </div>

          {/* Crate/Pack Unit Cost Calculator Helper */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900">
                <Coins className="h-3.5 w-3.5 text-indigo-600" />
                <span>ตัวช่วยหารราคาทุนต่อชิ้นจากราคายกลัง / แพ็ค</span>
              </div>
              {batchPackUnitCost !== null && (
                <span className="rounded-lg bg-white border border-indigo-200 px-2.5 py-1 text-xs font-extrabold text-indigo-700 tabular-nums">
                  ทุนต่อชิ้น = {formatBaht(batchPackUnitCost)}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-indigo-900 mb-1">
                  ราคารวมทั้งลัง (บาท)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  disabled={batchSaving}
                  value={batchPackCalcPrice}
                  onChange={(e) => setBatchPackCalcPrice(e.target.value)}
                  placeholder="เช่น 240"
                  className="w-full rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 tabular-nums focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-4">
                <label className="block text-[11px] font-semibold text-indigo-900 mb-1">
                  จำนวนชิ้นในลัง
                </label>
                <div className="flex flex-wrap items-center gap-1">
                  <input
                    type="number"
                    min="1"
                    step="any"
                    disabled={batchSaving}
                    value={batchPackCalcQty}
                    onChange={(e) => setBatchPackCalcQty(e.target.value)}
                    placeholder="12"
                    className="w-16 rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-900 tabular-nums focus:border-indigo-500 focus:outline-none"
                  />
                  {[
                    { qty: '6', label: '÷6' },
                    { qty: '12', label: '÷12 (โหล)' },
                    { qty: '24', label: '÷24' },
                    { qty: '30', label: '÷30' },
                    { qty: '48', label: '÷48' },
                  ].map((preset) => (
                    <button
                      key={preset.qty}
                      type="button"
                      disabled={batchSaving}
                      onClick={() => setBatchPackCalcQty(preset.qty)}
                      className={`rounded-lg border px-2 py-1 text-[11px] font-bold transition ${
                        batchPackCalcQty.trim() === preset.qty
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-indigo-200 bg-white text-indigo-800 hover:bg-indigo-100'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sm:col-span-5 flex items-center gap-1.5">
                <select
                  aria-label="เลือกสินค้าที่จะเติมราคาทุนจากตัวช่วยหารยกลัง"
                  disabled={batchSaving || batchVisibleRows.length === 0}
                  value={resolvedBatchPackTargetId}
                  onChange={(e) => setBatchPackTargetId(e.target.value)}
                  className="flex-1 min-w-0 rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none"
                >
                  {batchVisibleRows.length === 0 ? (
                    <option value="">ไม่มีสินค้าในรายการ</option>
                  ) : (
                    batchVisibleRows.map((row) => (
                      <option key={row.product.id} value={row.product.id}>
                        {row.product.name} ({row.product.base_unit})
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  disabled={
                    batchSaving ||
                    batchPackUnitCost === null ||
                    !resolvedBatchPackTargetId
                  }
                  onClick={() => {
                    if (batchPackUnitCost === null || !resolvedBatchPackTargetId) return;
                    updateBatchDraft(resolvedBatchPackTargetId, {
                      cost: batchPackUnitCost.toFixed(2),
                    });
                  }}
                  className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  เติมราคาทุน
                </button>
              </div>
            </div>
          </div>

          {batchError && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-semibold text-rose-700">
              {batchError}
            </div>
          )}

          {/* Bulk Receive Table */}
          <div className="max-h-[46vh] overflow-y-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm text-left">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 z-10">
                <tr>
                  <th className="px-3 py-2.5">สินค้า</th>
                  <th className="px-3 py-2.5 w-36">หน่วยรับเข้า</th>
                  <th className="px-3 py-2.5 w-36 text-right">จำนวนที่รับเข้า (+)</th>
                  <th className="px-3 py-2.5 w-40 text-right">ราคาทุนต่อหน่วย (บาท)</th>
                  <th className="px-3 py-2.5 w-32 text-right">รวมต้นทุน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {batchVisibleRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-sm text-slate-500"
                    >
                      {batchFilterMode === 'filled'
                        ? 'ยังไม่มีรายการที่กรอกจำนวนรับเข้า (> 0)'
                        : 'ไม่พบสินค้าที่ตรงกับเงื่อนไข'}
                    </td>
                  </tr>
                ) : (
                  batchVisibleRows.map((row) => {
                    const p = row.product;
                    const rawUnits = p.product_units ?? [];
                    const hasBaseUnitOption = rawUnits.some(
                      (u) => Number(u.conversion_rate) === 1
                    );
                    const unitOptions = hasBaseUnitOption
                      ? rawUnits
                      : [
                          {
                            id: '__base__',
                            unit_name: p.base_unit || 'ชิ้น',
                            conversion_rate: 1,
                          },
                          ...rawUnits,
                        ];

                    return (
                      <tr
                        key={p.id}
                        className={
                          row.isInvalid
                            ? 'bg-rose-50/70'
                            : row.qtyBase > 0
                              ? 'bg-sky-50/50'
                              : 'hover:bg-slate-50/70'
                        }
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-slate-900">
                              {p.name}
                            </span>
                            {row.isLowStock && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                ใกล้หมด
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5 mt-0.5 tabular-nums">
                            <span>
                              คงเหลือ {formatNumber(p.stock_qty)} {p.base_unit}
                            </span>
                            {row.qtyBase > 0 && (
                              <span className="font-bold text-emerald-700">
                                → {formatNumber(Number(p.stock_qty) + row.qtyBase)}{' '}
                                {p.base_unit}
                              </span>
                            )}
                            {suppliers[p.id] && (
                              <>
                                <span>•</span>
                                <span className="text-sky-700 font-medium">
                                  {suppliers[p.id]}
                                </span>
                              </>
                            )}
                            {orderPackInfos[p.id] && (
                              <>
                                <span>•</span>
                                <span className="text-amber-700 font-medium">
                                  {orderPackInfos[p.id]}
                                </span>
                              </>
                            )}
                          </div>
                        </td>

                        <td className="px-3 py-2.5">
                          <select
                            value={row.draft.unitConv}
                            disabled={batchSaving}
                            aria-label={`หน่วยรับเข้าของ ${p.name}`}
                            onChange={(e) => {
                              const conv = e.target.value;
                              const matched = unitOptions.find(
                                (u) => String(u.conversion_rate) === conv
                              );
                              updateBatchDraft(p.id, {
                                unitConv: conv,
                                unitName: matched?.unit_name ?? (p.base_unit || 'ชิ้น'),
                              });
                            }}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-800"
                          >
                            {unitOptions.map((u) => (
                              <option key={u.id} value={String(u.conversion_rate)}>
                                {u.unit_name}
                                {Number(u.conversion_rate) !== 1
                                  ? ` (${formatNumber(u.conversion_rate)} ${p.base_unit})`
                                  : ''}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="px-3 py-2.5 text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              disabled={batchSaving}
                              aria-label={`จำนวนที่รับเข้า (+) ของ ${p.name}`}
                              placeholder="0"
                              value={row.draft.qty}
                              onChange={(e) =>
                                updateBatchDraft(p.id, { qty: e.target.value })
                              }
                              className={`w-28 rounded-lg border px-2.5 py-1.5 text-right text-sm font-bold tabular-nums focus:outline-none ${
                                row.isQtyInvalid
                                  ? 'border-rose-400 bg-white text-rose-700 ring-1 ring-rose-300'
                                  : row.qtyBase > 0
                                    ? 'border-sky-500 bg-white text-sky-900 ring-1 ring-sky-300'
                                    : 'border-slate-300 bg-white text-slate-900 focus:border-sky-500'
                              }`}
                            />
                            {row.qtyBase > 0 && row.convRate !== 1 && (
                              <span className="text-[11px] font-semibold text-sky-700 tabular-nums">
                                +{formatNumber(row.qtyBase)} {p.base_unit}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-3 py-2.5 text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              disabled={batchSaving}
                              aria-label={`ราคาทุนต่อหน่วย (บาท) ของ ${p.name}`}
                              value={row.draft.cost}
                              onChange={(e) =>
                                updateBatchDraft(p.id, { cost: e.target.value })
                              }
                              className={`w-28 rounded-lg border px-2.5 py-1.5 text-right text-sm font-semibold tabular-nums focus:outline-none ${
                                row.isCostInvalid
                                  ? 'border-rose-400 bg-white text-rose-700 ring-1 ring-rose-300'
                                  : row.costChanged
                                    ? 'border-amber-400 bg-white text-amber-800 ring-1 ring-amber-300'
                                    : 'border-slate-300 bg-white text-slate-900 focus:border-sky-500'
                              }`}
                            />
                            <span className="text-[11px] text-slate-500 tabular-nums">
                              {row.costChanged
                                ? `เดิม ${formatBaht(row.origCost)}/${p.base_unit}`
                                : `ต่อ ${p.base_unit}`}
                            </span>
                          </div>
                        </td>

                        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                          {row.isInvalid ? (
                            <span className="text-xs font-bold text-rose-600">
                              ค่าไม่ถูกต้อง
                            </span>
                          ) : row.qtyBase > 0 ? (
                            <span className="font-bold text-slate-900">
                              {formatBaht(row.lineTotalCost)}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              บันทึกเฉพาะแถวที่กรอกจำนวนรับเข้า &gt; 0 (รวมต้นทุน{' '}
              <span className="font-bold text-sky-700 tabular-nums">
                {formatBaht(batchSummary.totalCost)}
              </span>
              )
            </p>
            <div className="flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                disabled={batchSaving}
                onClick={() => setBatchRestockOpen(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={
                  batchSaving ||
                  batchSummary.filledCount === 0 ||
                  batchSummary.invalidCount > 0
                }
                className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {batchSaving
                  ? 'กำลังบันทึก...'
                  : `ยืนยันรับของเข้า (${batchSummary.filledCount} รายการ · ${formatBaht(batchSummary.totalCost)})`}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Global Stock Movements Modal (Store-wide, latest 50) */}
      <Modal
        open={globalMovementsOpen}
        onClose={() => setGlobalMovementsOpen(false)}
        title="ประวัติความเคลื่อนไหวสต็อกทั้งร้าน (50 รายการล่าสุด)"
        maxWidthClass="max-w-xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { key: 'all', label: 'ทั้งหมด', count: globalMovementCounts.all },
                  { key: 'sale', label: 'ขาย', count: globalMovementCounts.sale },
                  { key: 'restock', label: 'รับเข้า', count: globalMovementCounts.restock },
                  { key: 'adjust', label: 'ปรับยอด', count: globalMovementCounts.adjust },
                ] as const
              ).map((tab) => {
                const active = globalMovementFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setGlobalMovementFilter(tab.key)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {tab.label} ({tab.count})
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={globalMovementsLoading || filteredGlobalMovements.length === 0}
              onClick={handleExportGlobalMovementsCsv}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>ส่งออก CSV</span>
            </button>
          </div>

          {globalMovementsLoading ? (
            <div className="py-10 text-center text-sm text-slate-500">
              กำลังโหลดประวัติความเคลื่อนไหวสต็อก...
            </div>
          ) : filteredGlobalMovements.length === 0 ? (
            <div className="rounded-xl border border-slate-200 py-10 text-center text-sm text-slate-500">
              ไม่พบรายการความเคลื่อนไหวสต็อกในหมวดนี้
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {filteredGlobalMovements.map((m) => {
                const qty = Number(m.qty_change) || 0;
                const unitLabel = m.products?.base_unit || 'ชิ้น';
                const typeBadge =
                  m.type === 'restock'
                    ? { label: 'รับเข้า', cls: 'bg-sky-50 text-sky-700' }
                    : m.type === 'adjust'
                      ? { label: 'ปรับยอด', cls: 'bg-amber-50 text-amber-800' }
                      : { label: 'ขาย', cls: 'bg-rose-50 text-rose-700' };

                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${typeBadge.cls}`}
                        >
                          {typeBadge.label}
                        </span>
                        <span className="font-bold text-slate-900 truncate">
                          {m.products?.name ?? 'ไม่ระบุสินค้า'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">{formatDateTime(m.created_at)}</p>
                      {m.note && <p className="text-[11px] text-slate-600 truncate">{m.note}</p>}
                    </div>
                    <div
                      className={`font-bold tabular-nums shrink-0 text-sm ${
                        qty > 0
                          ? 'text-emerald-600'
                          : qty < 0
                            ? 'text-rose-600'
                            : 'text-slate-600'
                      }`}
                    >
                      {qty > 0 ? `+${formatNumber(qty)}` : formatNumber(qty)} {unitLabel}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      {/* Import Products CSV Modal */}
      <Modal
        open={importCsvOpen}
        onClose={() => !importing && setImportCsvOpen(false)}
        title="นำเข้าสินค้าจากไฟล์ CSV"
        maxWidthClass="max-w-4xl"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-xs text-slate-600 space-y-1">
              <p className="font-semibold text-slate-800">
                คอลัมน์ที่รองรับ: ชื่อสินค้า, หมวดหมู่, หน่วยย่อย, ราคาทุน, ราคาขาย, สต็อกเริ่มต้น, จุดแจ้งเตือน, บาร์โค้ด
              </p>
              <p>
                หากชื่อหมวดหมู่ยังไม่มีในระบบ ระบบจะสร้างหมวดหมู่ให้อัตโนมัติ (บันทึกเป็นไฟล์ CSV UTF-8)
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadSampleCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              <span>ดาวน์โหลดไฟล์ตัวอย่าง CSV</span>
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/60 px-4 py-3 text-sm font-bold text-emerald-800 hover:bg-emerald-50 transition">
              <Upload className="h-4 w-4" />
              <span>{importFileName ? `เลือกไฟล์ใหม่ (${importFileName})` : 'เลือกไฟล์ .csv จากเครื่อง'}</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleImportCsvFileChange}
                disabled={importing}
                className="hidden"
              />
            </label>
            {importRows.length > 0 && (
              <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-slate-100 px-2 py-1 font-semibold">
                  ทั้งหมด {importRows.length} แถว
                </span>
                <span className="rounded-md bg-emerald-50 text-emerald-700 px-2 py-1 font-bold">
                  พร้อมนำเข้า {importRows.filter((r) => !r.error).length} แถว
                </span>
                {importRows.some((r) => r.error) && (
                  <span className="rounded-md bg-rose-50 text-rose-700 px-2 py-1 font-bold">
                    พบข้อผิดพลาด {importRows.filter((r) => r.error).length} แถว (จะถูกข้าม)
                  </span>
                )}
              </div>
            )}
          </div>

          {importError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700">
              {importError}
            </div>
          )}

          {importResult && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-bold text-emerald-800">
              {importResult}
            </div>
          )}

          {importRows.length > 0 && (
            <div className="max-h-[48vh] overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="px-2.5 py-2">แถว</th>
                    <th className="px-2.5 py-2">ชื่อสินค้า</th>
                    <th className="px-2.5 py-2">หมวดหมู่</th>
                    <th className="px-2.5 py-2">หน่วย</th>
                    <th className="px-2.5 py-2 text-right">ทุน</th>
                    <th className="px-2.5 py-2 text-right">ขาย</th>
                    <th className="px-2.5 py-2 text-right">สต็อก</th>
                    <th className="px-2.5 py-2 text-right">เตือน</th>
                    <th className="px-2.5 py-2">บาร์โค้ด</th>
                    <th className="px-2.5 py-2">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {importRows.map((row) => {
                    const isExistingCat =
                      row.categoryName &&
                      categories.some(
                        (c) => c.name.trim().toLowerCase() === row.categoryName.trim().toLowerCase()
                      );
                    return (
                      <tr key={row.rowNumber} className={row.error ? 'bg-rose-50/50' : ''}>
                        <td className="px-2.5 py-2 text-slate-400 tabular-nums">{row.rowNumber}</td>
                        <td className="px-2.5 py-2 font-semibold text-slate-900">
                          {row.name || <span className="text-rose-500">-</span>}
                        </td>
                        <td className="px-2.5 py-2 text-slate-700">
                          {row.categoryName ? (
                            <span className="inline-flex items-center gap-1">
                              <span>{row.categoryName}</span>
                              {!isExistingCat && (
                                <span className="rounded bg-sky-50 px-1 py-0.5 text-[10px] font-bold text-sky-700">
                                  ใหม่
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-2.5 py-2 text-slate-700">{row.baseUnit}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatNumber(row.costPrice)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums font-semibold text-emerald-700">
                          {formatNumber(row.sellingPrice)}
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatNumber(row.stockQty)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{formatNumber(row.lowAlert)}</td>
                        <td className="px-2.5 py-2 text-slate-500 font-mono">{row.barcode || '-'}</td>
                        <td className="px-2.5 py-2">
                          {row.error ? (
                            <span className="text-rose-600 font-semibold">{row.error}</span>
                          ) : (
                            <span className="text-emerald-600 font-semibold">พร้อมนำเข้า</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={importing}
              onClick={() => setImportCsvOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              ปิด
            </button>
            <button
              type="button"
              disabled={importing || importRows.filter((r) => !r.error).length === 0}
              onClick={handleConfirmImportCsv}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {importing
                ? 'กำลังนำเข้าสินค้า...'
                : `ยืนยันนำเข้า (${importRows.filter((r) => !r.error).length} รายการ)`}
            </button>
          </div>
        </div>
      </Modal>

      {/* Printable Price Tags Modal */}
      <Modal
        open={priceTagsOpen}
        onClose={() => setPriceTagsOpen(false)}
        title="พิมพ์ป้ายราคาติดชั้นวาง"
        maxWidthClass="max-w-4xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200 p-3">
            <div className="text-xs sm:text-sm text-slate-600">
              เลือกแล้ว{' '}
              <span className="font-bold text-violet-700 tabular-nums">
                {selectedTagProducts.length}
              </span>{' '}
              รายการ (จากที่กรองอยู่ {filteredProducts.length} รายการ)
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={filteredProducts.length === 0}
                onClick={handleSelectAllFilteredTags}
                className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
              >
                เลือกทั้งหมดที่กรองอยู่ ({filteredProducts.length})
              </button>
              <button
                type="button"
                disabled={selectedTagProductIds.length === 0}
                onClick={handleClearTagSelection}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                ล้างการเลือก
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2 text-xs sm:text-sm font-medium text-slate-800 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showPackWholesaleOnTags}
                onChange={(e) => setShowPackWholesaleOnTags(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              <span>แสดงราคาหน่วยแพ็ค/ลัง และโปรราคาส่งบนป้ายราคา</span>
            </label>
            <label className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs sm:text-sm font-medium text-slate-800 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showShelfAndTargetOnTag}
                onChange={(e) => setShowShelfAndTargetOnTag(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>แสดงตำแหน่งชั้นวางและเป้าเต็มชั้นบนป้ายราคา</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: Product selection list */}
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  placeholder="ค้นหาในรายการที่กรองอยู่..."
                  className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
                />
              </div>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                {tagModalProducts.length === 0 ? (
                  <p className="p-6 text-center text-sm text-slate-400">
                    ไม่พบสินค้าที่ตรงกับเงื่อนไข
                  </p>
                ) : (
                  tagModalProducts.map((p) => {
                    const checked = selectedTagProductIds.includes(p.id);
                    const { unitName, sellingPrice } = getPriceTagInfo(p);
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer transition ${
                          checked ? 'bg-violet-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTagProduct(p.id)}
                            className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                          />
                          <span className="truncate text-sm font-medium text-slate-800">
                            {p.name}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-slate-600 tabular-nums">
                          {formatBaht(sellingPrice)} / {unitName}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right: Compact Price Tag Preview */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-slate-600">
                ตัวอย่างป้ายราคาขนาดกะทัดรัด ({selectedTagProducts.length} ป้าย)
              </p>
              <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
                {selectedTagProducts.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-400">
                    กรุณาเลือกสินค้าทางด้านซ้าย เพื่อดูตัวอย่างป้ายราคา
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {selectedTagProducts.map((p) => {
                      const { unitName, sellingPrice, extraUnits, wholesaleTier } =
                        getPriceTagInfo(p);
                      const promoText = promoLabels[p.id];
                      const shelfText = shelfLocations[p.id];
                      const targetStockQty = targetStocks[p.id] ?? 0;
                      return (
                        <div
                          key={p.id}
                          className="rounded-lg border border-dashed border-slate-400 bg-white p-2.5 flex flex-col justify-between min-h-[88px] shadow-xs"
                        >
                          <div>
                            {promoText && (
                              <span className="inline-block mb-1 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white leading-none">
                                {promoText}
                              </span>
                            )}
                            <p className="text-xs font-bold text-slate-900 leading-snug line-clamp-2">
                              {p.name}
                            </p>
                            <p className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
                              {p.barcode ? `บาร์โค้ด: ${p.barcode}` : `รหัส: ${p.id.slice(0, 8)}`}
                            </p>
                          </div>
                          <div className="mt-2 pt-1 border-t border-slate-100">
                            <div className="flex items-baseline justify-between gap-1">
                              <span className="text-[11px] font-medium text-slate-500 truncate">
                                /{unitName}
                              </span>
                              <span className="text-lg font-black text-slate-900 tabular-nums">
                                {formatBaht(sellingPrice)}
                              </span>
                            </div>
                            {showPackWholesaleOnTags &&
                              (extraUnits.length > 0 || wholesaleTier) && (
                                <div className="mt-1 pt-1 border-t border-dashed border-slate-200 space-y-0.5 text-[10px] leading-tight">
                                  {extraUnits.length > 0 && (
                                    <p className="text-slate-700 font-medium truncate">
                                      {extraUnits
                                        .map(
                                          (u) =>
                                            `${u.unit_name} ${formatBaht(Number(u.selling_price))}`
                                        )
                                        .join(' · ')}
                                    </p>
                                  )}
                                  {wholesaleTier && (
                                    <p className="text-violet-700 font-semibold truncate">
                                      ส่ง ≥{formatNumber(wholesaleTier.minQty)}{' '}
                                      {p.base_unit || 'ชิ้น'}{' '}
                                      {formatBaht(wholesaleTier.unitPrice)}/
                                      {p.base_unit || 'ชิ้น'}
                                    </p>
                                  )}
                                </div>
                              )}
                            {showShelfAndTargetOnTag && (shelfText || targetStockQty > 0) && (
                              <div className="mt-1 pt-1 border-t border-dashed border-slate-200 flex items-center justify-between gap-2 text-[10px] font-medium text-slate-600">
                                <span className="truncate">
                                  {shelfText ? `ชั้น: ${shelfText}` : ''}
                                </span>
                                <span className="shrink-0 tabular-nums">
                                  {targetStockQty > 0
                                    ? `เต็มชั้น: ${formatNumber(targetStockQty)}`
                                    : ''}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setPriceTagsOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ปิด
            </button>
            <button
              type="button"
              disabled={selectedTagProducts.length === 0}
              onClick={() => {
                setPrintMode('price_tags');
                setPrintSeq((prev) => prev + 1);
              }}
              className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              <span>พิมพ์ป้ายราคา ({selectedTagProducts.length})</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Bulk Auto-Generate Store Barcodes Modal */}
      <Modal
        open={bulkBarcodeOpen}
        onClose={() => {
          if (!bulkBarcodeSaving) setBulkBarcodeOpen(false);
        }}
        title="สร้างบาร์โค้ดร้าน (EAN-13) ให้สินค้าไร้บาร์โค้ด"
        maxWidthClass="max-w-3xl"
      >
        <div className="space-y-4">
          {bulkBarcodeSavedIds.length > 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <Check className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-emerald-900">
                    บันทึกบาร์โค้ดร้านสำเร็จ {bulkBarcodeSavedIds.length} รายการ
                  </p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    รหัสบาร์โค้ด EAN-13 (ขึ้นต้น 200) ถูกอัปเดตลงสินค้าเรียบร้อยแล้ว สามารถส่งรายการนี้ไปพิมพ์ป้ายราคาติดชั้นวางได้ทันที
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setBulkBarcodeOpen(false)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  ปิดหน้าต่าง
                </button>
                <button
                  type="button"
                  onClick={handleOpenPriceTagsForGenerated}
                  className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700"
                >
                  <Tag className="h-4 w-4" />
                  <span>พิมพ์ป้ายราคา ({bulkBarcodeSavedIds.length} รายการ)</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3.5 py-2.5">
                <div className="text-xs sm:text-sm text-orange-900">
                  พบสินค้าที่ยังไม่มีบาร์โค้ด{' '}
                  <span className="font-extrabold tabular-nums">
                    {bulkBarcodeDrafts.length}
                  </span>{' '}
                  รายการ — ระบบสุ่มรหัสบาร์โค้ดร้าน EAN-13 (ขึ้นต้น <span className="font-mono font-bold">200</span>) ที่ไม่ซ้ำกันให้แล้ว
                </div>
                <button
                  type="button"
                  disabled={bulkBarcodeSaving}
                  onClick={handleRegenerateBulkBarcodes}
                  className="inline-flex items-center gap-1 rounded-lg border border-orange-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-orange-800 hover:bg-orange-100 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>สุ่มรหัสใหม่</span>
                </button>
              </div>

              {bulkBarcodeError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-rose-700">
                  {bulkBarcodeError}
                </div>
              )}

              <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                {bulkBarcodeDrafts.map((item, idx) => {
                  const { unitName, sellingPrice } = getPriceTagInfo(item.product);
                  return (
                    <div
                      key={item.product.id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm bg-white hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">
                          {idx + 1}. {item.product.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          ราคาขาย: {formatBaht(sellingPrice)} / {unitName}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 font-mono text-xs sm:text-sm font-bold text-orange-800 tabular-nums">
                        {item.barcode}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={bulkBarcodeSaving}
                  onClick={() => setBulkBarcodeOpen(false)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  disabled={bulkBarcodeSaving || bulkBarcodeDrafts.length === 0}
                  onClick={handleSaveBulkBarcodes}
                  className="flex items-center gap-1.5 rounded-xl bg-orange-600 px-4 py-2 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  <Barcode className="h-4 w-4" />
                  <span>
                    {bulkBarcodeSaving
                      ? 'กำลังบันทึก...'
                      : `ยืนยันสร้างบาร์โค้ดทั้งหมด (${bulkBarcodeDrafts.length})`}
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Bulk Price Update Modal */}
      <Modal
        open={bulkPriceOpen}
        onClose={() => {
          if (!bulkPriceSaving) setBulkPriceOpen(false);
        }}
        title="ปรับราคาและจุดแจ้งเตือนหลายรายการ"
        maxWidthClass="max-w-6xl"
      >
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={bulkPriceSearch}
                onChange={(e) => setBulkPriceSearch(e.target.value)}
                placeholder="ค้นหาชื่อสินค้า หรือบาร์โค้ด..."
                className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            {(costUpProducts.length > 0 || bulkPriceOnlyCostUp) && (
              <button
                type="button"
                onClick={() => setBulkPriceOnlyCostUp((prev) => !prev)}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold shrink-0 transition-colors ${
                  bulkPriceOnlyCostUp
                    ? 'border-rose-600 bg-rose-600 text-white'
                    : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                }`}
              >
                🔺 เฉพาะทุนขึ้น ({costUpProducts.length})
              </button>
            )}
            <div className="text-xs font-semibold text-slate-600 bg-slate-100 rounded-xl px-3 py-2 shrink-0">
              แก้ไขแล้ว{' '}
              <span className="text-indigo-700 font-bold tabular-nums">
                {bulkPriceChangedItems.length}
              </span>{' '}
              รายการ
            </div>
          </div>

          {/* Bulk Price Quick Adjust Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-xs font-semibold text-slate-600 mr-1">
              ปรับราคาด่วน ({bulkPriceFilteredProducts.length} รายการ):
            </span>
            <button
              type="button"
              disabled={bulkPriceSaving || bulkPriceFilteredProducts.length === 0}
              onClick={() => applyBulkSellingPriceAction('add_1')}
              className="rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              ราคาขาย +฿1 ทุกตัว
            </button>
            <button
              type="button"
              disabled={bulkPriceSaving || bulkPriceFilteredProducts.length === 0}
              onClick={() => applyBulkSellingPriceAction('add_5')}
              className="rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              ราคาขาย +฿5 ทุกตัว
            </button>
            <button
              type="button"
              disabled={bulkPriceSaving || bulkPriceFilteredProducts.length === 0}
              onClick={() => applyBulkSellingPriceAction('cost_plus_20')}
              className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              ตั้งราคาขาย = ทุน +20%
            </button>
            <button
              type="button"
              disabled={bulkPriceSaving || bulkPriceFilteredProducts.length === 0}
              onClick={() => applyBulkSellingPriceAction('cost_plus_30')}
              className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              ตั้งราคาขาย = ทุน +30%
            </button>
            <button
              type="button"
              disabled={bulkPriceSaving || bulkPriceFilteredProducts.length === 0}
              onClick={() => applyBulkSellingPriceAction('reset')}
              className="ml-auto rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              คืนค่าตามราคาเดิม
            </button>
          </div>

          {/* Bulk Target Stock Quick Assign Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50/70 px-3 py-2">
            <span className="text-xs font-semibold text-teal-800 mr-1">
              เป้าเต็มชั้นด่วน ({bulkPriceFilteredProducts.length} รายการ):
            </span>
            <button
              type="button"
              disabled={bulkPriceSaving || bulkPriceFilteredProducts.length === 0}
              onClick={() => applyBulkTargetStockAction('alert_x3')}
              className="rounded-lg border border-teal-200 bg-white px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50"
            >
              ตั้งเป้าเต็มชั้น = จุดเตือน × 3
            </button>
            <button
              type="button"
              disabled={bulkPriceSaving || bulkPriceFilteredProducts.length === 0}
              onClick={() => applyBulkTargetStockAction('sales_14d')}
              className="rounded-lg border border-sky-200 bg-white px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
            >
              ตั้งเป้าเต็มชั้นตามยอดขาย 14 วัน
            </button>
          </div>

          {/* Bulk Promo Label Quick Assign Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2">
            <span className="text-xs font-semibold text-rose-800 mr-1">
              ป้ายโปรโมชั่นด่วน ({bulkPriceFilteredProducts.length} รายการ):
            </span>
            <button
              type="button"
              disabled={bulkPriceSaving || bulkPriceFilteredProducts.length === 0}
              onClick={() => applyBulkPromoLabelAction('🔥 ขายดี')}
              className="rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
            >
              ติดป้าย 🔥 ขายดี
            </button>
            <button
              type="button"
              disabled={bulkPriceSaving || bulkPriceFilteredProducts.length === 0}
              onClick={() => applyBulkPromoLabelAction('💥 ลดล้างสต็อก')}
              className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              ติดป้าย 💥 ลดล้างสต็อก
            </button>
            <button
              type="button"
              disabled={bulkPriceSaving || bulkPriceFilteredProducts.length === 0}
              onClick={() => applyBulkPromoLabelAction('')}
              className="ml-auto rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              ล้างป้ายโปรในกลุ่มนี้
            </button>
          </div>

          {bulkPriceError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700">
              {bulkPriceError}
            </div>
          )}

          <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm text-left">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">สินค้า</th>
                  <th className="px-3 py-2.5 w-36 text-right">ราคาทุนต่อหน่วยย่อย</th>
                  <th className="px-3 py-2.5 w-40 text-right">ราคาขายหน่วยหลัก</th>
                  <th className="px-3 py-2.5 w-32 text-right">จุดเตือนใกล้หมด</th>
                  <th className="px-3 py-2.5 w-36 text-right">เป้าเต็มชั้น (Max Stock)</th>
                  <th className="px-3 py-2.5 w-44">ป้ายโปรโมชั่น</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bulkPriceFilteredProducts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      ไม่พบสินค้าที่เปิดขายที่ตรงกับคำค้นหา
                    </td>
                  </tr>
                ) : (
                  bulkPriceFilteredProducts.map((p) => {
                    const defaultUnit = getDefaultUnit(p);
                    const draft = bulkPriceDrafts[p.id] ?? {
                      costPrice: String(Number(p.cost_price ?? 0)),
                      sellingPrice: String(Number(defaultUnit?.selling_price ?? 0)),
                      lowStockAlert: String(Number(p.low_stock_alert ?? 0)),
                      targetStock:
                        targetStocks[p.id] !== undefined ? String(targetStocks[p.id]) : '',
                      promoLabel: promoLabels[p.id] ?? '',
                    };
                    const origCost = Number(p.cost_price ?? 0);
                    const origSelling = Number(defaultUnit?.selling_price ?? 0);
                    const origLowAlert = Number(p.low_stock_alert ?? 0);
                    const origTargetStock = targetStocks[p.id] ?? 0;
                    const origPromo = (promoLabels[p.id] ?? '').trim();
                    const trimmedDraftTarget = (draft.targetStock ?? '').trim();
                    const parsedDraftTarget =
                      trimmedDraftTarget === '' ? 0 : Number(trimmedDraftTarget);
                    const normalizedDraftTarget =
                      trimmedDraftTarget === ''
                        ? 0
                        : Number.isNaN(parsedDraftTarget)
                          ? Number.NaN
                          : parsedDraftTarget > 0
                            ? Math.round(parsedDraftTarget * 100) / 100
                            : parsedDraftTarget;
                    const costChanged = Number(draft.costPrice) !== origCost;
                    const sellingChanged = Number(draft.sellingPrice) !== origSelling;
                    const lowAlertChanged = Number(draft.lowStockAlert) !== origLowAlert;
                    const targetStockChanged =
                      (trimmedDraftTarget !== '' && Number.isNaN(normalizedDraftTarget)) ||
                      normalizedDraftTarget !== origTargetStock;
                    const promoChanged = (draft.promoLabel ?? '').trim() !== origPromo;
                    const rowChanged =
                      costChanged ||
                      sellingChanged ||
                      lowAlertChanged ||
                      targetStockChanged ||
                      promoChanged;

                    return (
                      <tr
                        key={p.id}
                        className={rowChanged ? 'bg-indigo-50/60' : 'hover:bg-slate-50/70'}
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-slate-900">{p.name}</div>
                          <div className="text-xs text-slate-500">
                            หน่วยย่อย: {p.base_unit || 'ชิ้น'}
                            {defaultUnit?.unit_name &&
                            defaultUnit.unit_name !== p.base_unit
                              ? ` • หน่วยหลัก: ${defaultUnit.unit_name} (x${defaultUnit.conversion_rate})`
                              : ''}
                            {p.barcode ? ` • ${p.barcode}` : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col items-end gap-0.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={draft.costPrice}
                              onChange={(e) =>
                                updateBulkPriceDraft(p.id, 'costPrice', e.target.value)
                              }
                              className={`w-28 rounded-lg border px-2.5 py-1.5 text-right text-sm font-semibold tabular-nums focus:outline-none ${
                                costChanged
                                  ? 'border-indigo-400 bg-white text-indigo-800 ring-1 ring-indigo-300'
                                  : 'border-slate-300 bg-white text-slate-900'
                              }`}
                            />
                            {costChanged && (
                              <span className="text-[11px] text-slate-500 tabular-nums">
                                เดิม {formatBaht(origCost)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col items-end gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={draft.sellingPrice}
                                onChange={(e) =>
                                  updateBulkPriceDraft(
                                    p.id,
                                    'sellingPrice',
                                    e.target.value
                                  )
                                }
                                className={`w-28 rounded-lg border px-2.5 py-1.5 text-right text-sm font-semibold tabular-nums focus:outline-none ${
                                  sellingChanged
                                    ? 'border-indigo-400 bg-white text-indigo-800 ring-1 ring-indigo-300'
                                    : 'border-slate-300 bg-white text-slate-900'
                                }`}
                              />
                            </div>
                            <span className="text-[11px] text-slate-500 tabular-nums">
                              {sellingChanged
                                ? `เดิม ${formatBaht(origSelling)} / ${defaultUnit?.unit_name || p.base_unit || 'ชิ้น'}`
                                : `ต่อ ${defaultUnit?.unit_name || p.base_unit || 'ชิ้น'}`}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col items-end gap-0.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={draft.lowStockAlert}
                              onChange={(e) =>
                                updateBulkPriceDraft(
                                  p.id,
                                  'lowStockAlert',
                                  e.target.value
                                )
                              }
                              className={`w-24 rounded-lg border px-2.5 py-1.5 text-right text-sm font-semibold tabular-nums focus:outline-none ${
                                lowAlertChanged
                                  ? 'border-indigo-400 bg-white text-indigo-800 ring-1 ring-indigo-300'
                                  : 'border-slate-300 bg-white text-slate-900'
                              }`}
                            />
                            <span className="text-[11px] text-slate-500 tabular-nums">
                              {lowAlertChanged
                                ? `เดิม ${formatNumber(origLowAlert)} ${p.base_unit || 'ชิ้น'}`
                                : p.base_unit || 'ชิ้น'}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col items-end gap-0.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={draft.targetStock ?? ''}
                              onChange={(e) =>
                                updateBulkPriceDraft(
                                  p.id,
                                  'targetStock',
                                  e.target.value
                                )
                              }
                              placeholder="ไม่ระบุ"
                              className={`w-24 rounded-lg border px-2.5 py-1.5 text-right text-sm font-semibold tabular-nums focus:outline-none ${
                                targetStockChanged
                                  ? 'border-indigo-400 bg-white text-indigo-800 ring-1 ring-indigo-300'
                                  : 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400'
                              }`}
                            />
                            <span className="text-[11px] text-slate-500 tabular-nums">
                              {targetStockChanged
                                ? origTargetStock > 0
                                  ? `เดิม ${formatNumber(origTargetStock)} ${p.base_unit || 'ชิ้น'}`
                                  : 'เดิม: ไม่ระบุ'
                                : (avgDailySoldMap[p.id] || 0) > 0
                                  ? `ขาย ~${(avgDailySoldMap[p.id] || 0).toFixed(1)}/วัน`
                                  : p.base_unit || 'ชิ้น'}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <input
                              type="text"
                              value={draft.promoLabel}
                              onChange={(e) =>
                                updateBulkPriceDraft(p.id, 'promoLabel', e.target.value)
                              }
                              placeholder="เช่น 🔥 ขายดี"
                              className={`w-full rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus:outline-none ${
                                promoChanged
                                  ? 'border-indigo-400 bg-white text-indigo-800 ring-1 ring-indigo-300'
                                  : 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400'
                              }`}
                            />
                            {promoChanged && (
                              <span className="text-[11px] text-slate-500 truncate">
                                เดิม: {origPromo || 'ไม่มี'}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={bulkPriceSaving}
              onClick={() => setBulkPriceOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={bulkPriceSaving || bulkPriceChangedItems.length === 0}
              onClick={handleSaveBulkPrices}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              <span>
                {bulkPriceSaving
                  ? 'กำลังบันทึก...'
                  : `บันทึกที่เปลี่ยนแปลง (${bulkPriceChangedItems.length})`}
              </span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Quick Stock Audit Modal (Compare Actual vs System) */}
      <Modal
        open={stockAuditOpen}
        onClose={() => {
          if (!stockAuditSaving) setStockAuditOpen(false);
        }}
        title={`ตรวจนับสต็อกจริงเทียบระบบ (${stockAuditSummary.totalRows} รายการ)`}
        maxWidthClass="max-w-4xl"
      >
        <div className="space-y-4">
          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold text-slate-500">
                กรอกยอดนับแล้ว
              </p>
              <p className="mt-0.5 text-lg font-extrabold text-slate-900 tabular-nums">
                {formatNumber(stockAuditSummary.enteredCount)}{' '}
                <span className="text-xs font-semibold text-slate-500">
                  / {formatNumber(stockAuditSummary.totalRows)} รายการ
                </span>
              </p>
            </div>

            <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-3">
              <p className="text-[11px] font-semibold text-teal-800">
                มีส่วนต่างต้องปรับ
              </p>
              <p className="mt-0.5 text-lg font-extrabold text-teal-700 tabular-nums">
                {formatNumber(stockAuditSummary.changedCount)}{' '}
                <span className="text-xs font-semibold text-teal-700">รายการ</span>
              </p>
              {(stockAuditSummary.surplusCount > 0 ||
                stockAuditSummary.shortageCount > 0) && (
                <p className="text-[10px] font-medium text-teal-800 mt-0.5 tabular-nums">
                  เกิน {stockAuditSummary.surplusCount} · ขาด{' '}
                  {stockAuditSummary.shortageCount}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
              <p className="text-[11px] font-semibold text-emerald-800">
                ตรงกับระบบ
              </p>
              <p className="mt-0.5 text-lg font-extrabold text-emerald-700 tabular-nums">
                {formatNumber(stockAuditSummary.matchedCount)}{' '}
                <span className="text-xs font-semibold text-emerald-700">รายการ</span>
              </p>
            </div>

            <div
              className={`rounded-xl border p-3 ${
                stockAuditSummary.totalCostDiff > 0
                  ? 'border-emerald-200 bg-emerald-50'
                  : stockAuditSummary.totalCostDiff < 0
                    ? 'border-rose-200 bg-rose-50'
                    : 'border-slate-200 bg-slate-50'
              }`}
            >
              <p className="text-[11px] font-semibold text-slate-600">
                มูลค่าทุนส่วนต่างรวม
              </p>
              <p
                className={`mt-0.5 text-lg font-extrabold tabular-nums ${
                  stockAuditSummary.totalCostDiff > 0
                    ? 'text-emerald-700'
                    : stockAuditSummary.totalCostDiff < 0
                      ? 'text-rose-700'
                      : 'text-slate-800'
                }`}
              >
                {stockAuditSummary.totalCostDiff > 0
                  ? `+${formatBaht(stockAuditSummary.totalCostDiff)}`
                  : stockAuditSummary.totalCostDiff < 0
                    ? `-${formatBaht(Math.abs(stockAuditSummary.totalCostDiff))}`
                    : formatBaht(0)}
              </p>
            </div>
          </div>

          {/* Search & Quick Clear */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={stockAuditSearch}
                onChange={(e) => setStockAuditSearch(e.target.value)}
                placeholder="ค้นหาชื่อสินค้า บาร์โค้ด หรือตำแหน่งชั้นวาง..."
                className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
              />
            </div>
            {Object.keys(stockAuditInputs).length > 0 && (
              <button
                type="button"
                disabled={stockAuditSaving}
                onClick={() => {
                  setStockAuditInputs({});
                  setStockAuditError('');
                }}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>ล้างค่าที่กรอก</span>
              </button>
            )}
          </div>

          {stockAuditError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700">
              {stockAuditError}
            </div>
          )}

          {/* Audit Table */}
          <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm text-left">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 z-10">
                <tr>
                  <th className="px-3 py-2.5">สินค้า</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">ยอดในระบบ</th>
                  <th className="px-3 py-2.5 w-44 text-right whitespace-nowrap">
                    นับได้จริง
                  </th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">ส่วนต่าง</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">
                    มูลค่าทุนส่วนต่าง
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {stockAuditVisibleRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-sm text-slate-500"
                    >
                      {stockAuditRows.length === 0
                        ? 'ไม่พบสินค้าในรายการที่กรองอยู่'
                        : 'ไม่พบสินค้าที่ตรงกับคำค้นหา'}
                    </td>
                  </tr>
                ) : (
                  stockAuditVisibleRows.map((row) => {
                    const p = row.product;
                    return (
                      <tr
                        key={p.id}
                        className={
                          row.isInvalid
                            ? 'bg-rose-50/70'
                            : row.hasDiff
                              ? 'bg-teal-50/50'
                              : row.actualQty !== null
                                ? 'bg-emerald-50/30'
                                : 'hover:bg-slate-50/70'
                        }
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-slate-900">{p.name}</div>
                          <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5 mt-0.5">
                            <span>{p.categories?.name ?? 'ไม่มีหมวดหมู่'}</span>
                            <span>•</span>
                            <span className="tabular-nums">
                              ทุน {formatBaht(row.unitCost)}/{p.base_unit}
                            </span>
                            {shelfLocations[p.id] && (
                              <>
                                <span>•</span>
                                <span className="text-indigo-700 font-medium">
                                  {shelfLocations[p.id]}
                                </span>
                              </>
                            )}
                            {p.is_active === false && (
                              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                                ซ่อนไว้
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-slate-700 tabular-nums whitespace-nowrap">
                          {formatNumber(row.systemQty)} {p.base_unit}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              disabled={stockAuditSaving}
                              aria-label={`นับได้จริงของ ${p.name}`}
                              placeholder={String(row.systemQty)}
                              value={row.raw}
                              onChange={(e) => {
                                setStockAuditError('');
                                setStockAuditInputs((prev) => ({
                                  ...prev,
                                  [p.id]: e.target.value,
                                }));
                              }}
                              className={`w-24 rounded-lg border px-2.5 py-1.5 text-right text-sm font-bold tabular-nums focus:outline-none ${
                                row.isInvalid
                                  ? 'border-rose-400 bg-white text-rose-700 ring-1 ring-rose-300'
                                  : row.hasDiff
                                    ? 'border-teal-500 bg-white text-teal-800 ring-1 ring-teal-300'
                                    : 'border-slate-300 bg-white text-slate-900 focus:border-teal-500'
                              }`}
                            />
                            <span className="text-xs text-slate-500 shrink-0">
                              {p.base_unit}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                          {row.isInvalid ? (
                            <span className="text-xs font-bold text-rose-600">
                              ค่าไม่ถูกต้อง
                            </span>
                          ) : row.diff === null ? (
                            <span className="text-xs text-slate-400">-</span>
                          ) : row.diff === 0 ? (
                            <span className="inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                              0 (ตรงระบบ)
                            </span>
                          ) : (
                            <span
                              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-extrabold ${
                                row.diff > 0
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-700'
                              }`}
                            >
                              {row.diff > 0 ? `+${formatNumber(row.diff)}` : formatNumber(row.diff)}{' '}
                              {p.base_unit}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-bold">
                          {row.isInvalid || row.costDiff === null ? (
                            <span className="text-xs font-normal text-slate-400">-</span>
                          ) : row.costDiff === 0 ? (
                            <span className="text-xs font-semibold text-slate-500">
                              {formatBaht(0)}
                            </span>
                          ) : row.costDiff > 0 ? (
                            <span className="text-emerald-700">
                              +{formatBaht(row.costDiff)}
                            </span>
                          ) : (
                            <span className="text-rose-700">
                              -{formatBaht(Math.abs(row.costDiff))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              บันทึกเฉพาะรายการที่มีการกรอกยอด &quot;นับได้จริง&quot; และมีส่วนต่างจากยอดเดิม
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                disabled={stockAuditSaving || stockAuditVisibleRows.length === 0}
                onClick={() => {
                  setPrintMode('audit_sheet');
                  setAuditPrintDateText(
                    new Date().toLocaleString('th-TH', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  );
                  setPrintSeq((prev) => prev + 1);
                }}
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                <span>พิมพ์ใบตรวจนับสต็อก (A4)</span>
              </button>
              <button
                type="button"
                disabled={stockAuditSaving}
                onClick={() => setStockAuditOpen(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={
                  stockAuditSaving ||
                  stockAuditSummary.changedCount === 0 ||
                  stockAuditSummary.invalidCount > 0
                }
                onClick={handleConfirmStockAudit}
                className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                <ClipboardCheck className="h-4 w-4" />
                <span>
                  {stockAuditSaving
                    ? 'กำลังบันทึก...'
                    : 'ยืนยันปรับสต็อกตามที่นับจริง'}
                </span>
                {!stockAuditSaving && stockAuditSummary.changedCount > 0 && (
                  <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-xs tabular-nums">
                    {stockAuditSummary.changedCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Inventory Metadata Backup / Restore JSON Modal */}
      <Modal
        open={metaBackupOpen}
        onClose={() => setMetaBackupOpen(false)}
        title="สำรอง / กู้คืนตั้งค่าเสริมคลังสินค้า (JSON)"
        maxWidthClass="max-w-3xl"
      >
        <div className="space-y-4">
          {/* Export Section */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  1. สำรองข้อมูลตั้งค่าเสริม (Export JSON)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  รวมข้อมูลวันหมดอายุ, ร้านค้าส่ง, ตำแหน่งชั้นวาง, แพ็กสั่งของ, เรทราคาส่ง และสินค้าทดแทนที่บันทึกไว้ในเครื่องนี้
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyInventoryMetaJson}
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
                  onClick={handleExportInventoryMetaJson}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>ดาวน์โหลดไฟล์ (.json)</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                วันหมดอายุ: {formatNumber(Object.keys(expiryDates).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                ร้านค้าส่ง: {formatNumber(Object.keys(suppliers).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                ตำแหน่งชั้นวาง: {formatNumber(Object.keys(shelfLocations).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                แพ็กสั่งของ: {formatNumber(Object.keys(orderPackInfos).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                เรทราคาส่ง: {formatNumber(Object.keys(wholesaleTiers).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                สินค้าทดแทน: {formatNumber(Object.keys(substituteNotes).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                ประวัติทุนเดิม: {formatNumber(Object.keys(lastCostHistory).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                เป้าเต็มชั้น: {formatNumber(Object.keys(targetStocks).length)}
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 tabular-nums">
                ป้ายโปรโมชั่น: {formatNumber(Object.keys(promoLabels).length)}
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
                htmlFor="inventory-meta-json-textarea"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                วางข้อมูล JSON ที่นี่
              </label>
              <textarea
                id="inventory-meta-json-textarea"
                rows={7}
                value={metaBackupJsonInput}
                onChange={(e) => {
                  setMetaBackupJsonInput(e.target.value);
                  setMetaBackupError('');
                  setMetaBackupSuccess('');
                }}
                placeholder='{"inventory_expiry_dates_v1": {...}, "inventory_suppliers_v1": {...}, ...}'
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-800 focus:border-sky-500 focus:bg-white focus:outline-none"
              />
            </div>

            {metaBackupPreview && !metaBackupPreview.error && (
              <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 flex flex-wrap items-center gap-2">
                <span className="font-bold">ตรวจพบข้อมูลพร้อมกู้คืน:</span>
                {metaBackupPreview.expiryDates !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    วันหมดอายุ {formatNumber(Object.keys(metaBackupPreview.expiryDates).length)}
                  </span>
                )}
                {metaBackupPreview.suppliers !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    ร้านค้าส่ง {formatNumber(Object.keys(metaBackupPreview.suppliers).length)}
                  </span>
                )}
                {metaBackupPreview.shelfLocations !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    ชั้นวาง {formatNumber(Object.keys(metaBackupPreview.shelfLocations).length)}
                  </span>
                )}
                {metaBackupPreview.orderPackInfos !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    แพ็กสั่งของ {formatNumber(Object.keys(metaBackupPreview.orderPackInfos).length)}
                  </span>
                )}
                {metaBackupPreview.wholesaleTiers !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    เรทราคาส่ง {formatNumber(Object.keys(metaBackupPreview.wholesaleTiers).length)}
                  </span>
                )}
                {metaBackupPreview.substituteNotes !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    สินค้าทดแทน {formatNumber(Object.keys(metaBackupPreview.substituteNotes).length)}
                  </span>
                )}
                {metaBackupPreview.unitBarcodes !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    บาร์โค้ดหน่วยแพ็ค/ลัง {formatNumber(Object.keys(metaBackupPreview.unitBarcodes).length)}
                  </span>
                )}
                {metaBackupPreview.lastCostHistory !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    ประวัติราคาทุน {formatNumber(Object.keys(metaBackupPreview.lastCostHistory).length)}
                  </span>
                )}
                {metaBackupPreview.targetStocks !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    เป้าเต็มชั้น {formatNumber(Object.keys(metaBackupPreview.targetStocks).length)}
                  </span>
                )}
                {metaBackupPreview.promoLabels !== undefined && (
                  <span className="rounded-md bg-white border border-sky-200 px-2 py-0.5 font-semibold tabular-nums">
                    ป้ายโปรโมชั่น {formatNumber(Object.keys(metaBackupPreview.promoLabels).length)}
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
              onClick={handleRestoreInventoryMetaJson}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              <span>กู้คืนข้อมูลเข้าสู่ระบบ</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Stock Write-Off Modal (ตัดของเสีย / หมดอายุ / เบิกใช้ในร้าน) */}
      <Modal
        open={writeOffOpen}
        onClose={() => !writeOffSaving && setWriteOffOpen(false)}
        title="ตัดจำหน่ายของเสีย / หมดอายุ / เบิกใช้ในร้าน"
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleConfirmWriteOff} className="space-y-4">
          <div className="rounded-xl border border-rose-200 bg-rose-50/70 px-3.5 py-2.5 text-xs text-rose-900">
            บันทึกการลดสต็อกที่ไม่ได้เกิดจากการขาย (เช่น ของหมดอายุ, แตกหักเสียหาย, เบิกใช้ในร้าน หรือสูญหาย) พร้อมบันทึกต้นทุนความสูญเสียเข้าประวัติความเคลื่อนไหวสต็อก
          </div>

          {writeOffExpiredCandidates.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold text-red-700">
                สินค้าที่หมดอายุแล้วและยังมีสต็อก ({writeOffExpiredCandidates.length} รายการ):
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {writeOffExpiredCandidates.map((ep) => {
                  const isSelected = ep.id === writeOffProductId;
                  return (
                    <button
                      key={ep.id}
                      type="button"
                      disabled={writeOffSaving}
                      onClick={() => handleSelectWriteOffProduct(ep.id, 'สินค้าหมดอายุ')}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                        isSelected
                          ? 'border-rose-600 bg-rose-600 text-white'
                          : 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100'
                      }`}
                    >
                      <span>{ep.name}</span>
                      <span className="tabular-nums opacity-90">
                        ({formatNumber(ep.stock_qty)} {ep.base_unit})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Product Selector */}
          <div className="space-y-2">
            <label
              htmlFor="writeoff-product-search"
              className="block text-xs font-semibold text-slate-700"
            >
              เลือกสินค้าที่ต้องการตัดจำหน่าย *
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                id="writeoff-product-search"
                type="search"
                disabled={writeOffSaving}
                value={writeOffSearch}
                onChange={(e) => setWriteOffSearch(e.target.value)}
                placeholder="ค้นหาชื่อสินค้า บาร์โค้ด หรือชั้นวาง..."
                className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-3 py-2 text-xs focus:border-rose-500 focus:outline-none"
              />
            </div>
            <select
              aria-label="สินค้าที่ต้องการตัดจำหน่าย"
              disabled={writeOffSaving}
              value={writeOffProductId}
              onChange={(e) => handleSelectWriteOffProduct(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-rose-500 focus:outline-none"
            >
              {writeOffFilteredProducts.length === 0 ? (
                <option value="">ไม่พบสินค้าตามคำค้นหา</option>
              ) : (
                <>
                  {writeOffProduct &&
                    !writeOffFilteredProducts.some((p) => p.id === writeOffProduct.id) && (
                      <option value={writeOffProduct.id}>
                        {writeOffProduct.name} (คงเหลือ {formatNumber(writeOffProduct.stock_qty)}{' '}
                        {writeOffProduct.base_unit})
                      </option>
                    )}
                  {writeOffFilteredProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (คงเหลือ {formatNumber(p.stock_qty)} {p.base_unit} · ทุน{' '}
                      {formatBaht(p.cost_price)}/{p.base_unit})
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>

          {writeOffProduct && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div>
                <p className="font-bold text-slate-900">{writeOffProduct.name}</p>
                <p className="text-slate-500 mt-0.5 tabular-nums">
                  ราคาทุน: <span className="font-semibold text-slate-700">{formatBaht(writeOffProduct.cost_price)}/{writeOffProduct.base_unit}</span>
                </p>
              </div>
              <div className="text-right tabular-nums">
                <span className="text-[11px] text-slate-500 block">คงเหลือในระบบ</span>
                <span
                  className={`text-sm font-extrabold ${
                    writeOffCalc.currentStock <= 0 ? 'text-rose-600' : 'text-slate-900'
                  }`}
                >
                  {formatNumber(writeOffCalc.currentStock)} {writeOffProduct.base_unit}
                </span>
              </div>
            </div>
          )}

          {/* Reason Selector */}
          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-slate-700">
              สาเหตุการตัดจำหน่าย *
            </span>
            <div className="grid grid-cols-2 gap-2">
              {WRITE_OFF_REASONS.map((reason) => {
                const active = writeOffReason === reason;
                return (
                  <button
                    key={reason}
                    type="button"
                    disabled={writeOffSaving}
                    onClick={() => setWriteOffReason(reason)}
                    className={`rounded-xl border px-3 py-2 text-xs font-bold text-left transition ${
                      active
                        ? 'border-rose-600 bg-rose-600 text-white shadow-xs'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {reason}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Unit & Quantity */}
          {writeOffProduct && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="writeoff-unit-select"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  หน่วยที่ตัดจำหน่าย
                </label>
                <select
                  id="writeoff-unit-select"
                  disabled={writeOffSaving}
                  value={writeOffUnitConv}
                  onChange={(e) => {
                    setWriteOffUnitConv(e.target.value);
                    setWriteOffError('');
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
                >
                  {writeOffUnitOptions.map((opt) => (
                    <option key={opt.key} value={String(opt.conversionRate)}>
                      {opt.unitName}
                      {opt.conversionRate !== 1
                        ? ` (${formatNumber(opt.conversionRate)} ${writeOffProduct.base_unit})`
                        : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label
                    htmlFor="writeoff-qty-input"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    จำนวนที่ตัดจำหน่าย *
                  </label>
                  {writeOffCalc.currentStock > 0 && (
                    <button
                      type="button"
                      disabled={writeOffSaving}
                      onClick={() => {
                        setWriteOffUnitConv('1');
                        setWriteOffQty(String(writeOffCalc.currentStock));
                        setWriteOffError('');
                      }}
                      className="text-[11px] font-semibold text-rose-700 hover:text-rose-800 hover:underline"
                    >
                      ตัดทั้งหมด ({formatNumber(writeOffCalc.currentStock)})
                    </button>
                  )}
                </div>
                <input
                  id="writeoff-qty-input"
                  type="number"
                  min="0.01"
                  step="any"
                  required
                  disabled={writeOffSaving}
                  value={writeOffQty}
                  onChange={(e) => {
                    setWriteOffQty(e.target.value);
                    setWriteOffError('');
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base font-bold tabular-nums focus:border-rose-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Cost & Stock After Calculation Summary */}
          {writeOffProduct && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-2 text-xs tabular-nums">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-700">จำนวนตัดออกจากสต็อก (หน่วยย่อย):</span>
                <span className="font-bold text-slate-900">
                  -{formatNumber(writeOffCalc.baseQty)} {writeOffProduct.base_unit}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-700">
                  มูลค่าต้นทุนที่ตัดจำหน่าย ({formatNumber(writeOffCalc.baseQty)} ×{' '}
                  {formatBaht(writeOffCalc.unitCost)}):
                </span>
                <span className="text-sm font-extrabold text-rose-700">
                  {formatBaht(writeOffCalc.costValue)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-amber-200/80 pt-1.5">
                <span className="font-semibold text-slate-700">สต็อกคงเหลือหลังตัดจำหน่าย:</span>
                <span className="font-bold text-slate-900">
                  {formatNumber(writeOffCalc.nextStock)} {writeOffProduct.base_unit}
                </span>
              </div>
              {writeOffCalc.exceedsStock && (
                <p className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">
                  จำนวนที่ระบุมากกว่าสต็อกคงเหลือในระบบ ({formatNumber(writeOffCalc.currentStock)}{' '}
                  {writeOffProduct.base_unit}) ระบบจะปรับสต็อกคงเหลือเป็น 0 {writeOffProduct.base_unit}
                </p>
              )}
            </div>
          )}

          {/* Optional Note */}
          <div>
            <label
              htmlFor="writeoff-note-input"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              รายละเอียดเพิ่มเติม (ไม่บังคับ)
            </label>
            <input
              id="writeoff-note-input"
              type="text"
              disabled={writeOffSaving}
              value={writeOffNote}
              onChange={(e) => setWriteOffNote(e.target.value)}
              placeholder="เช่น ล็อตหมดอายุ, ขวดตกแตก, เบิกน้ำดื่มให้พนักงาน"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:outline-none"
            />
            {writeOffProduct && (
              <p className="mt-1 text-[11px] text-slate-500 truncate">
                บันทึกประวัติ: [ตัดจำหน่าย: {writeOffReason}] {formatNumber(writeOffCalc.baseQty)}{' '}
                {writeOffProduct.base_unit}
                {writeOffNote.trim() ? ` · ${writeOffNote.trim()}` : ''}
              </p>
            )}
          </div>

          {writeOffError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
            >
              {writeOffError}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
            <button
              type="button"
              disabled={writeOffSaving}
              onClick={() => setWriteOffOpen(false)}
              className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={
                writeOffSaving ||
                !writeOffProduct ||
                !writeOffCalc.isValidQty ||
                writeOffCalc.baseQty <= 0
              }
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              <PackageMinus className="h-4 w-4" />
              <span>{writeOffSaving ? 'กำลังบันทึก...' : 'ยืนยันตัดจำหน่าย'}</span>
            </button>
          </div>
        </form>
      </Modal>
        </AppShell>
      </div>

      {/* Printable Shelf Price Tags & Physical Stock Count Sheet */}
      <div className="hidden print:block bg-white text-slate-900 p-4">
        {printMode === 'price_tags' && (
          <div className="grid grid-cols-3 gap-2">
            {selectedTagProducts.map((p) => {
              const { unitName, sellingPrice, extraUnits, wholesaleTier } =
                getPriceTagInfo(p);
              const promoText = promoLabels[p.id];
              const shelfText = shelfLocations[p.id];
              const targetStockQty = targetStocks[p.id] ?? 0;
              return (
                <div
                  key={p.id}
                  className="break-inside-avoid rounded-lg border-2 border-dashed border-slate-400 p-3 flex flex-col justify-between min-h-[110px]"
                >
                  <div>
                    {promoText && (
                      <div className="mb-1">
                        <span className="inline-block rounded bg-slate-900 px-2 py-0.5 text-[10px] font-extrabold text-white">
                          {promoText}
                        </span>
                      </div>
                    )}
                    {settings?.store_name && (
                      <p className="text-[10px] font-medium text-slate-500 truncate">
                        {settings.store_name}
                      </p>
                    )}
                    <p className="text-sm font-bold text-slate-900 leading-snug line-clamp-2">
                      {p.name}
                    </p>
                    <p className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
                      {p.barcode ? `บาร์โค้ด: ${p.barcode}` : `รหัส: ${p.id.slice(0, 8)}`}
                    </p>
                  </div>
                  <div className="mt-2 pt-1.5 border-t border-slate-200">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-600">
                        ต่อ {unitName}
                      </span>
                      <span className="text-2xl font-black text-slate-900 tabular-nums">
                        {formatBaht(sellingPrice)}
                      </span>
                    </div>
                    {showPackWholesaleOnTags &&
                      (extraUnits.length > 0 || wholesaleTier) && (
                        <div className="mt-1.5 pt-1 border-t border-dashed border-slate-300 space-y-0.5 text-[10px] leading-tight">
                          {extraUnits.length > 0 && (
                            <p className="text-slate-700 font-semibold">
                              {extraUnits
                                .map(
                                  (u) =>
                                    `${u.unit_name} ${formatBaht(Number(u.selling_price))}`
                                )
                                .join(' · ')}
                            </p>
                          )}
                          {wholesaleTier && (
                            <p className="text-slate-900 font-bold">
                              โปรส่ง ≥{formatNumber(wholesaleTier.minQty)}{' '}
                              {p.base_unit || 'ชิ้น'}{' '}
                              {formatBaht(wholesaleTier.unitPrice)}/{p.base_unit || 'ชิ้น'}
                            </p>
                          )}
                        </div>
                      )}
                    {showShelfAndTargetOnTag && (shelfText || targetStockQty > 0) && (
                      <div className="mt-1.5 pt-1 border-t border-dashed border-slate-300 flex items-center justify-between gap-2 text-[10px] font-medium text-slate-700">
                        <span className="truncate">
                          {shelfText ? `ชั้น: ${shelfText}` : ''}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {targetStockQty > 0
                            ? `เต็มชั้น: ${formatNumber(targetStockQty)}`
                            : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {printMode === 'audit_sheet' && (
          <div className="max-w-4xl mx-auto text-xs text-slate-900">
            <div className="flex items-start justify-between border-b-2 border-slate-800 pb-3 mb-4">
              <div>
                <h1 className="text-lg font-bold text-slate-900">
                  {settings?.store_name || 'ร้านขายของชำ POS'}
                </h1>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">
                  แบบฟอร์มใบตรวจนับสต็อกสินค้า (Physical Stock Count Sheet)
                </p>
                {stockAuditSearch.trim() && (
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    คำค้นหาที่กรอง: &ldquo;{stockAuditSearch.trim()}&rdquo;
                  </p>
                )}
              </div>
              <div className="text-right text-[11px] text-slate-600 space-y-0.5">
                <p>วันที่พิมพ์: {auditPrintDateText || '-'}</p>
                <p className="font-semibold text-slate-800">
                  จำนวนรายการ: {formatNumber(stockAuditVisibleRows.length)} รายการ
                </p>
              </div>
            </div>

            <table className="w-full border-collapse border border-slate-400 text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-800">
                  <th className="border border-slate-400 px-2 py-1.5 text-center w-10">ลำดับ</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-left w-28">ตำแหน่งชั้นวาง</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-left">ชื่อสินค้า</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-left w-28">บาร์โค้ด</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-center w-16">หน่วย</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-right w-20">ยอดในระบบ</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-center w-24">นับได้จริง</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-left w-32">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {stockAuditVisibleRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="border border-slate-400 px-3 py-6 text-center text-slate-500"
                    >
                      ไม่พบรายการสินค้าสำหรับพิมพ์ใบตรวจนับสต็อก
                    </td>
                  </tr>
                ) : (
                  stockAuditVisibleRows.map((row, idx) => {
                    const p = row.product;
                    return (
                      <tr key={p.id} className="break-inside-avoid">
                        <td className="border border-slate-400 px-2 py-2 text-center tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="border border-slate-400 px-2 py-2 text-slate-700">
                          {shelfLocations[p.id] || '-'}
                        </td>
                        <td className="border border-slate-400 px-2 py-2 font-medium text-slate-900">
                          {p.name}
                        </td>
                        <td className="border border-slate-400 px-2 py-2 font-mono text-[11px] text-slate-700">
                          {p.barcode || '-'}
                        </td>
                        <td className="border border-slate-400 px-2 py-2 text-center">
                          {p.base_unit}
                        </td>
                        <td className="border border-slate-400 px-2 py-2 text-right font-semibold tabular-nums">
                          {formatNumber(row.systemQty)}
                        </td>
                        <td className="border border-slate-400 px-2 py-2 text-center">
                          &nbsp;
                        </td>
                        <td className="border border-slate-400 px-2 py-2">
                          &nbsp;
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            <div className="mt-8 grid grid-cols-3 gap-6 pt-4 break-inside-avoid text-xs text-slate-700">
              <div className="text-center space-y-6">
                <p className="border-b border-dotted border-slate-500 pb-6" />
                <p>ลงชื่อผู้ตรวจนับ (............................................)</p>
              </div>
              <div className="text-center space-y-6">
                <p className="border-b border-dotted border-slate-500 pb-6" />
                <p>ลงชื่อผู้ตรวจสอบ (............................................)</p>
              </div>
              <div className="text-center space-y-6">
                <p className="border-b border-dotted border-slate-500 pb-6" />
                <p>วันที่ตรวจนับ (......../......../............)</p>
              </div>
            </div>
          </div>
        )}

        {printMode === 'purchase_order' && (
          <div className="max-w-4xl mx-auto text-xs text-slate-900">
            <div className="flex items-start justify-between border-b-2 border-slate-800 pb-3 mb-4">
              <div>
                <h1 className="text-lg font-bold text-slate-900">
                  {settings?.store_name || 'ร้านขายของชำ POS'}
                </h1>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">
                  ใบสั่งซื้อสินค้า (Purchase Order)
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  ร้านค้าส่งที่กรอง:{' '}
                  {restockSupplierFilter === 'all'
                    ? 'ทุกร้านค้าส่ง'
                    : restockSupplierFilter === '__none__'
                      ? 'ยังไม่ระบุร้านค้าส่ง'
                      : restockSupplierFilter}
                </p>
              </div>
              <div className="text-right text-[11px] text-slate-600 space-y-0.5">
                <p>วันที่พิมพ์: {poPrintDateText || '-'}</p>
                <p className="font-semibold text-slate-800">
                  จำนวนรายการ: {formatNumber(filteredRestockItems.length)} รายการ
                </p>
                <p className="font-bold text-slate-900">
                  ต้นทุนประมาณการรวม: {formatBaht(restockTotalEstimatedCost)}
                </p>
              </div>
            </div>

            <table className="w-full border-collapse border border-slate-400 text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-800">
                  <th className="border border-slate-400 px-2 py-1.5 text-center w-10">ลำดับ</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-left">ชื่อสินค้า</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-left w-24">ร้านค้าส่ง</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-left w-28">ขนาดแพ็ค/เงื่อนไข</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-right w-24">คงเหลือ/เป้าเต็มชั้น</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-right w-20">จำนวนที่สั่ง</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-right w-24">ต้นทุนประมาณการ</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-center w-14">ตรวจรับ</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-center w-24">ราคาซื้อจริง</th>
                </tr>
              </thead>
              <tbody>
                {filteredRestockItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="border border-slate-400 px-3 py-6 text-center text-slate-500"
                    >
                      ไม่มีรายการสินค้าสำหรับพิมพ์ใบสั่งซื้อ
                    </td>
                  </tr>
                ) : (
                  filteredRestockItems.map(
                    (
                      {
                        product: p,
                        stockQty,
                        targetStock,
                        recommendedQty,
                        estimatedCost,
                        largestUnit,
                        supplier,
                        orderPackInfo: packInfo,
                      },
                      idx
                    ) => {
                      const packSummary = [
                        packInfo || '',
                        largestUnit && Number(largestUnit.conversion_rate) > 1
                          ? `${largestUnit.unit_name} (${formatNumber(largestUnit.conversion_rate)} ${p.base_unit})`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ');

                      return (
                        <tr key={p.id} className="break-inside-avoid">
                          <td className="border border-slate-400 px-2 py-2 text-center tabular-nums">
                            {idx + 1}
                          </td>
                          <td className="border border-slate-400 px-2 py-2 font-medium text-slate-900">
                            {p.name}
                          </td>
                          <td className="border border-slate-400 px-2 py-2 text-slate-700">
                            {supplier || '-'}
                          </td>
                          <td className="border border-slate-400 px-2 py-2 text-slate-700">
                            {packSummary || '-'}
                          </td>
                          <td className="border border-slate-400 px-2 py-2 text-right tabular-nums">
                            {formatNumber(stockQty)} /{' '}
                            {targetStock !== undefined && targetStock > 0
                              ? formatNumber(targetStock)
                              : '-'}{' '}
                            {p.base_unit}
                          </td>
                          <td className="border border-slate-400 px-2 py-2 text-right font-semibold tabular-nums">
                            {formatNumber(recommendedQty)} {p.base_unit}
                          </td>
                          <td className="border border-slate-400 px-2 py-2 text-right tabular-nums">
                            {formatBaht(estimatedCost)}
                          </td>
                          <td className="border border-slate-400 px-2 py-2 text-center text-slate-400">
                            ☐
                          </td>
                          <td className="border border-slate-400 px-2 py-2">
                            &nbsp;
                          </td>
                        </tr>
                      );
                    }
                  )
                )}
              </tbody>
              {filteredRestockItems.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50 font-bold text-slate-900">
                    <td colSpan={6} className="border border-slate-400 px-2 py-2 text-right">
                      รวมประมาณการ ({formatNumber(filteredRestockItems.length)} รายการ)
                    </td>
                    <td className="border border-slate-400 px-2 py-2 text-right tabular-nums">
                      {formatBaht(restockTotalEstimatedCost)}
                    </td>
                    <td colSpan={2} className="border border-slate-400 px-2 py-2 text-center text-[11px] font-normal text-slate-600">
                      รวมจ่ายจริง: ......................
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>

            <div className="mt-8 grid grid-cols-3 gap-6 pt-4 break-inside-avoid text-xs text-slate-700">
              <div className="text-center space-y-6">
                <p className="border-b border-dotted border-slate-500 pb-6" />
                <p>ลงชื่อผู้สั่งซื้อ (............................................)</p>
              </div>
              <div className="text-center space-y-6">
                <p className="border-b border-dotted border-slate-500 pb-6" />
                <p>ลงชื่อผู้อนุมัติ (............................................)</p>
              </div>
              <div className="text-center space-y-6">
                <p className="border-b border-dotted border-slate-500 pb-6" />
                <p>ลงชื่อผู้ตรวจรับของ (............................................)</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
