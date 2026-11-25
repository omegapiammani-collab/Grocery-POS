---
target: src/app/pos/page.tsx
total_score: 33
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:E:\\ระบบร้านขายของชำ POS\\src\\app\\pos\\page.tsx"
target_fingerprint: "sha256:664f3333deb57316a8f9d8f6397ae16aac33b49097760798b327d5f0b0bd9c52"
target_path: "E:\\ระบบร้านขายของชำ POS\\src\\app\\pos\\page.tsx"
timestamp: 2026-11-25T06-55-22Z
slug: src-app-pos-page-tsx
---
Method: dual-agent (A: d9683edb-5094-4752-99eb-c5ad3ca72f17 · B: aa526586-5122-4956-bf51-3139f01f28d5)

### Design Health Score (Round 3)

| # | Heuristic | Score | Strengths & Remaining Gaps |
|---|---|---:|---|
| 1 | Visibility of System Status | 4 / 4 | ป้ายกะเปิดอยู่ + เวลาเปิดกะ, ป้าย `กำลังคูณ ×N`, ความคืบหน้าราคาส่ง, ป้ายสต็อกติดลบ/ใกล้หมดอายุ, และ Toast ตำแหน่ง `top-14 md:top-4 right-4` ไม่ทับ Header มือถือ |
| 2 | Match System / Real World | 4 / 4 | ขายหลายหน่วย (`ชิ้น/แพ็ค/ลัง`), `ชั่งกิโล / ตักตามงบ`, `มัดจำขวด/ถัง`, `เงินเชื่อ (เซ็นไว้ก่อน)`, แนะนำหยิบธนบัตร/เหรียญทอนไทย, และข้อความส่ง LINE |
| 3 | User Control and Freedom | 3 / 4 | ยืนยัน 2 จังหวะ `ยืนยันล้างตะกร้า?` + `กู้คืนตะกร้าล่าสุด` (Undo) และ Modal ปิดด้วย `Esc`/backdrop (ลบชุดขายด่วนยังไม่มี Undo) |
| 4 | Consistency and Standards | 3 / 4 | `AppShell`, `Modal`, Emerald/Slate tokens และปุ่ม `⋯` สอดคล้องกันทั้ง 4 หน้า (เหลือ `promoLabel` ใช้ `bg-rose-600` ชนสี Error และปุ่มปักหมุด `36px` vs ตะกร้า `40px`) |
| 5 | Error Prevention | 3 / 4 | ยืนยันล้างตะกร้า, ตรวจสต็อก, ตรวจเงินทอนขาด และแยก `Ctrl+Enter` ออกจาก `F10` (ขายสต็อกติดลบยังเป็นป้ายเตือน passive) |
| 6 | Recognition Rather Than Recall | 3 / 4 | คีย์ลัด `<kbd>`, ช่องค้นหา `customerSearchQuery` ทั้งใน `CartPanel` และ Checkout Modal (แผง `⋯` ใน POS ยังเรียง 10 ปุ่มแบบไม่แบ่งกลุ่ม) |
| 7 | Flexibility and Efficiency | 4 / 4 | สแกน Enter-to-add, `×1/×2/×5/×10`, `+5`, `Ctrl+Enter` สดพอดี, `F9` ชำระเงิน, โหมดการ์ดใหญ่/กระชับ, และ `โหมดตารางจัดการลูกหนี้เร็ว` |
| 8 | Aesthetic and Minimalist Design | 3 / 4 | `showMoreCartTools` และ `showMoreDashboardTools` ช่วยลดความแออัดของหัวตะกร้าและ Dashboard ได้มาก (ท้ายตะกร้ายังมี 5 ส่วนซ้อนกันบนจอ 768px) |
| 9 | Error Recovery | 3 / 4 | `role="status"` Toast, `role="alert"` ฝากส่งต่อกะ, กู้คืนตะกร้าได้ (ถ้าพิมพ์ค้นหาลูกค้าไม่เจอ ยังไม่แสดงข้อความ "ไม่พบลูกค้า") |
| 10 | Help and Documentation | 3 / 4 | คู่มือคีย์ลัด `F1`, tooltips อธิบายปุ่ม และ Empty state แนะนำขั้นตอนแรกชัดเจน |
| **Total** | | **33 / 40** | **Good** (`0 P0`, `0 P1`, `0 Detector Findings`) |

---

### Design Specificity Verdict

**LLM Assessment:**
ระบบมีเอกลักษณ์เฉพาะตัวสำหรับ **ร้านขายของชำไทย (โชห่วย)** อย่างครบถ้วน ทั้งโทนสี Emerald/Slate (`#059669` / `#0f172a` / `#f8fafc`), ฟอนต์ `Noto Sans Thai` + `Plus Jakarta Sans` พร้อม `tabular-nums`, Touch targets `h-10` (40px) ในตะกร้าและปุ่มเลือกหน่วย, การพับเครื่องมือรองด้วย `⋯` ในทุกหน้า (`pos`, `inventory`, `customers`, `dashboard`), และ `CartPanel` ที่มีช่องค้นหาลูกค้าโดยตรง เหลือเพียงรายละเอียดเล็กน้อยด้านการจัดกลุ่มในแผง `⋯` ของ POS และสีป้ายโปรโมชั่นที่ซ้ำกับสี Error

**Deterministic Scan (`impeccable detect --json src`):**
- **Exit Code:** `0` (สแกนครบ 18 ไฟล์ใน `src/`)
- **Findings:** **`0 findings` (`[]`)** — ไม่พบปัญหาใดๆ ในการสแกนเชิงกลไก

**Visual Overlays:**
ไม่มี live dev server หรือ browser automation tool เชื่อมต่อในขั้นตอนนี้ จึงใช้ผลจาก CLI deterministic scan (`Exit Code 0`) ร่วมกับการตรวจโค้ด static markup แทน

---

### Overall Impression
ระบบอยู่ในเกณฑ์ **พร้อมใช้งานจริง (Production-Ready)** โดยไม่มีข้อบกพร่องร้ายแรง (`0 P0`, `0 P1`) และผ่านตัวตรวจจับโค้ด `impeccable detect` **0 findings** การปรับปรุงขั้นต่อไปเป็นเพียงการเก็บรายละเอียดด้านความสะอาดตาของเมนูเครื่องมือเสริมใน POS และแยกสีป้ายโปรโมชั่นออกจากสีแจ้งเตือนผิดพลาด

---

### What's Working
1. **Touch Ergonomics & Progressive Disclosure (`pos/page.tsx`, `dashboard/page.tsx`):** ปุ่ม `-`/`+`/`+5` และปุ่มหน่วยสินค้าขนาด `40px` (`h-10`/`min-h-10`), `showMoreCartTools`, และ `showMoreDashboardTools` ลดความแออัดได้จริง
2. **Mobile-Safe Toast & Customer Search (`pos/page.tsx`):** Toast ที่ `top-14 md:top-4 right-4` ไม่บัง Header มือถือ และ `customerSearchQuery` ช่วยกรองลูกค้าประจำได้ทั้งในตะกร้าและหน้าชำระเงิน
3. **Thai Grocery Domain Craft:** แนะนำหยิบธนบัตร/เหรียญทอนตามสีจริง, ตักตามงบ, มัดจำขวด/ลัง, และระบบลูกหนี้เงินเชื่อครบวงจร

---

### Remaining Priority Issues

1. **[P2] แผง `เครื่องมือเสริม (⋯)` ในหน้า POS ยังเรียง 10 ปุ่มแบนๆ ไม่มีหมวดหมู่ (`src/app/pos/page.tsx:8111-8248`)**
   - **What:** เมื่อกดเปิด `เครื่องมือเสริม (⋯)` แถวปุ่ม 10 ปุ่มจะห่อหลายบรรทัดและดันตารางสินค้าลงล่าง
   - **Why it matters:** ทำให้ตารางสินค้าขยับตำแหน่งและกวาดสายตาหาเครื่องมือช้า
   - **Fix:** แบ่งปุ่มในแผง `เครื่องมือเสริม (⋯)` เป็น 2–3 กลุ่มย่อยที่ชัดเจน (*งานขาย & มัดจำ* / *หน้าจอ & เสียง* / *ตั้งค่า & ล็อกจอ*)
   - **Suggested command:** `/impeccable layout`

2. **[P2] ป้ายโปรโมชั่น `promoLabel` (`bg-rose-600`) ใช้สีแดงเดียวกับ Error / ล้างตะกร้า (`src/app/pos/page.tsx:7458, 8647`)**
   - **What:** ป้ายโปรโมชั่นใช้ `bg-rose-600 text-white` ซึ่งเป็นสีเดียวกับ Toast ผิดพลาด, ปุ่มยืนยันล้างตะกร้า, และป้ายหนี้เลยกำหนด
   - **Why it matters:** แคชเชียร์มือใหม่อาจเข้าใจผิดว่าเป็นป้ายเตือนความผิดพลาดแทนที่จะเป็นป้ายโปรโมชั่น
   - **Fix:** เปลี่ยนสี `promoLabel` เป็น `bg-orange-600 text-white` เพื่อแยกสีโปรโมชั่นออกจากสี Error (`rose-600`) อย่างเด็ดขาด
   - **Suggested command:** `/impeccable polish`

3. **[P3] เก็บงาน Touch Target ปุ่มปักหมุด/เพิ่มลูกค้า (`36px`) และข้อความเมื่อค้นหาลูกค้าไม่พบ (`src/app/pos/page.tsx:7724-7772, 8551`)**
   - **What:** ปุ่มปักหมุด (`min-h-9 min-w-9`) และปุ่มเพิ่มลูกค้าด่วน (`h-9 w-9`) ยังเล็กกว่ามาตรฐาน `h-10` ในตะกร้าเล็กน้อย และเมื่อพิมพ์ค้นหาใน `customerSearchQuery` แล้วไม่ตรงกับใคร ยังไม่แสดงข้อความแจ้งว่า "ไม่พบลูกค้า"
   - **Why it matters:** ลดโอกาสกดพลาดบนจอสัมผัสและช่วยให้รู้ทันทีเมื่อสะกดชื่อลูกค้าผิด
   - **Fix:** ปรับปุ่มเพิ่มลูกค้าด่วนเป็น `h-10 w-10` และแสดงข้อความสั้นๆ เมื่อผลกรองลูกค้าเป็น 0 ราย
   - **Suggested command:** `/impeccable polish`

---

### Persona Red Flags
- **Alex (แคชเชียร์ความเร็วสูง):** พอใจกับ `F2`/`F9`/`Ctrl+Enter` และ `+5` แล้ว เหลือเพียง `customerSearchQuery` ที่ต้องเลื่อนไปเลือก `<select>` ต่อ
- **Sam (เจ้าของร้าน / แท็บเล็ต):** ปุ่มดาวปักหมุด `36px` บนการ์ดแบบกระชับอยู่ชิดมุมขวาบน อาจกดโดนโดยไม่ตั้งใจเวลาแตะเร็วๆ
- **Casey (พนักงานใหม่):** แผงเครื่องมือ 10 ปุ่มและป้ายโปรโมชั่นสีแดง `rose-600` อาจทำให้สับสนชั่วครู่กับป้ายเตือน Error

---

### Minor Observations & Questions to Consider
**Minor Observations:**
- บนโน้ตบุ๊กความสูง 768px ส่วนท้ายของ `CartPanel` มีความสูงมาก ทำให้พื้นที่เลื่อนรายการสินค้าเหลือจำกัดเมื่อมีสินค้า 4+ รายการ
- ไฟล์แต่ละหน้ายังมีขนาดใหญ่ (7k–14.6k บรรทัด) ควรพิจารณาแยก Component ในอนาคตหากเพิ่มฟีเจอร์ใหญ่

**Questions to Consider:**
1. *ควรเปลี่ยนสีป้ายโปรโมชั่นจาก `bg-rose-600` เป็น `bg-orange-600` เพื่อแยกจากสี Error (`rose-600`) เลยหรือไม่?*
2. *ควรจัดกลุ่มปุ่มใน `เครื่องมือเสริม (⋯)` ของหน้า POS เป็นหมวดย่อย (*งานขาย* / *หน้าจอ* / *ระบบ*) เพื่อให้หาง่ายขึ้นไหม?*
3. *ต้องการให้เก็บงาน P2–P3 ทั้ง 3 ข้อนี้เลยหรือพอใจกับสถานะ Production ปัจจุบันแล้ว?*
