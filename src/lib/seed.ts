import { SupabaseClient } from '@supabase/supabase-js';

export async function seedSampleGroceryData(supabase: SupabaseClient) {
  // Check if categories already exist
  const { data: existing } = await supabase.from('categories').select('id').limit(1);
  if (existing && existing.length > 0) return;

  // Ensure store_settings exists
  await supabase.from('store_settings').upsert(
    { store_name: 'ร้านขายของชำสุขใจ', promptpay_id: '0812345678' },
    { onConflict: 'user_id' }
  );

  // Create categories
  const { data: cats, error: catErr } = await supabase
    .from('categories')
    .insert([
      { name: 'เครื่องดื่ม', color: 'sky', sort_order: 1 },
      { name: 'ของแห้ง / มาม่า', color: 'amber', sort_order: 2 },
      { name: 'ของสด / ชั่งแบ่ง', color: 'emerald', sort_order: 3 },
      { name: 'ของใช้ในบ้าน', color: 'violet', sort_order: 4 },
    ])
    .select();

  if (catErr || !cats) return;

  const catMap = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  const sampleProducts = [
    {
      category_id: catMap['เครื่องดื่ม'],
      name: 'น้ำดื่ม 600 มล.',
      base_unit: 'ขวด',
      cost_price: 4.5,
      stock_qty: 72,
      low_stock_alert: 12,
      is_quick_item: true,
      allow_custom_price: false,
      units: [
        { unit_name: 'ขวด', conversion_rate: 1, selling_price: 7, is_default: true },
        { unit_name: 'แพ็ค 12 ขวด', conversion_rate: 12, selling_price: 65, is_default: false },
      ],
    },
    {
      category_id: catMap['เครื่องดื่ม'],
      name: 'กาแฟกระป๋อง',
      base_unit: 'กระป๋อง',
      cost_price: 12,
      stock_qty: 48,
      low_stock_alert: 10,
      is_quick_item: true,
      allow_custom_price: false,
      units: [
        { unit_name: 'กระป๋อง', conversion_rate: 1, selling_price: 15, is_default: true },
        { unit_name: 'แพ็ค 6', conversion_rate: 6, selling_price: 85, is_default: false },
      ],
    },
    {
      category_id: catMap['ของแห้ง / มาม่า'],
      name: 'บะหมี่กึ่งสำเร็จรูป รสต้มยำ',
      base_unit: 'ซอง',
      cost_price: 5.2,
      stock_qty: 60,
      low_stock_alert: 10,
      is_quick_item: true,
      allow_custom_price: false,
      units: [
        { unit_name: 'ซอง', conversion_rate: 1, selling_price: 7, is_default: true },
        { unit_name: 'แพ็ค 10 ซอง', conversion_rate: 10, selling_price: 65, is_default: false },
        { unit_name: 'ลัง 30 ซอง', conversion_rate: 30, selling_price: 185, is_default: false },
      ],
    },
    {
      category_id: catMap['ของสด / ชั่งแบ่ง'],
      name: 'ไข่ไก่ เบอร์ 2',
      base_unit: 'ฟอง',
      cost_price: 3.6,
      stock_qty: 120,
      low_stock_alert: 30,
      is_quick_item: true,
      allow_custom_price: false,
      units: [
        { unit_name: 'ฟอง', conversion_rate: 1, selling_price: 4.5, is_default: true },
        { unit_name: 'แผง (30 ฟอง)', conversion_rate: 30, selling_price: 125, is_default: false },
      ],
    },
    {
      category_id: catMap['ของสด / ชั่งแบ่ง'],
      name: 'น้ำแข็งตักใส่ถุง',
      base_unit: 'ถุง',
      cost_price: 3,
      stock_qty: 100,
      low_stock_alert: 10,
      is_quick_item: true,
      allow_custom_price: false,
      units: [
        { unit_name: 'ถุงเล็ก', conversion_rate: 1, selling_price: 5, is_default: true },
        { unit_name: 'ถุงใหญ่', conversion_rate: 2, selling_price: 10, is_default: false },
      ],
    },
    {
      category_id: catMap['ของสด / ชั่งแบ่ง'],
      name: 'ผักสด / ของชั่งแบ่งขาย',
      base_unit: 'รายการ',
      cost_price: 0,
      stock_qty: 999,
      low_stock_alert: 0,
      is_quick_item: true,
      allow_custom_price: true,
      units: [
        { unit_name: 'รายการ', conversion_rate: 1, selling_price: 10, is_default: true },
      ],
    },
    {
      category_id: catMap['ของใช้ในบ้าน'],
      name: 'ผงซักฟอก 400 กรัม',
      base_unit: 'ถุง',
      cost_price: 26,
      stock_qty: 18,
      low_stock_alert: 5,
      is_quick_item: false,
      allow_custom_price: false,
      units: [
        { unit_name: 'ถุง', conversion_rate: 1, selling_price: 35, is_default: true },
      ],
    },
  ];

  for (const p of sampleProducts) {
    const { units, ...productData } = p;
    const { data: inserted } = await supabase
      .from('products')
      .insert(productData)
      .select()
      .single();

    if (inserted) {
      await supabase.from('product_units').insert(
        units.map((u) => ({
          ...u,
          product_id: inserted.id,
        }))
      );
    }
  }
}
