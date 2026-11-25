export type PaymentMethod = 'cash' | 'qr' | 'credit';

export interface StoreSettings {
  id: string;
  user_id: string;
  store_name: string;
  promptpay_id: string;
  phone: string;
  address: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface ProductUnit {
  id: string;
  product_id: string;
  unit_name: string;
  conversion_rate: number;
  selling_price: number;
  is_default: boolean;
}

export interface Product {
  id: string;
  category_id: string | null;
  name: string;
  barcode: string;
  base_unit: string;
  cost_price: number;
  stock_qty: number;
  low_stock_alert: number;
  is_quick_item: boolean;
  allow_custom_price: boolean;
  is_active: boolean;
  product_units?: ProductUnit[];
  categories?: Category | null;
}

export interface CartItem {
  key: string;
  product_id: string | null;
  product_name: string;
  unit_name: string;
  conversion_rate: number;
  unit_price: number;
  unit_cost: number;
  qty: number;
  available_units?: ProductUnit[];
}

export interface Shift {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  expected_cash: number;
  actual_cash: number | null;
  diff_cash: number | null;
  status: 'open' | 'closed';
  note: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  note: string;
  total_debt: number;
  created_at: string;
}

export interface Sale {
  id: string;
  shift_id: string | null;
  customer_id: string | null;
  total_amount: number;
  total_cost: number;
  payment_method: PaymentMethod;
  cash_received: number;
  change_amount: number;
  note: string;
  created_at: string;
  customers?: { name: string } | null;
  sale_items?: SaleItem[];
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name: string;
  unit_name: string;
  qty: number;
  conversion_rate: number;
  unit_price: number;
  unit_cost: number;
  subtotal: number;
}

export interface DebtPayment {
  id: string;
  customer_id: string;
  shift_id: string | null;
  amount: number;
  payment_method: 'cash' | 'qr';
  note: string;
  created_at: string;
}

export interface Expense {
  id: string;
  shift_id: string | null;
  type: 'income' | 'expense';
  category: string;
  amount: number;
  note: string;
  created_at: string;
}
