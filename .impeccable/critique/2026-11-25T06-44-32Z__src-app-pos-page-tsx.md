---
target: src/app/pos/page.tsx
total_score: 35
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:E:\\ระบบร้านขายของชำ POS\\src\\app\\pos\\page.tsx"
target_fingerprint: "sha256:b1a8ecf333d65a9f96191b92564d87cf5ec32a15e4c4025a48cfe180f9500d02"
target_path: "E:\\ระบบร้านขายของชำ POS\\src\\app\\pos\\page.tsx"
timestamp: 2026-11-25T06-44-32Z
slug: src-app-pos-page-tsx
---
Method: dual-agent (A: 5b9d7e04-adce-4df8-8f49-39131d60e4fc · B: 7e8894c6-d4d3-42e6-9f9c-c67cd17cfac7)

### Design Health Score (Round 2)

| # | Heuristic | Score | Key Strengths & Remaining Issues |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 / 4 | ป้ายกะเปิดอยู่, ป้ายเตือนตัวคูณ `กำลังคูณ ×N (รีเซ็ต ×1)`, ยอดสุทธิบนปุ่ม `ชำระเงิน`, และ `role="status"` Toast ชัดเจน (เหลือเพียง Toast มุมขวาบนที่อาจบังไอคอน Logout บนมือถือชั่วคราว) |
| 2 | Match System / Real World | 4 / 4 | ภาษาและเวิร์กโฟลว์ตรงกับร้านขายของชำไทยแท้ (แยกธนบัตร/เหรียญทอน, ตักตามงบ, เงินฝากทอน, เซ็นไว้ก่อน, มัดจำขวด/ถัง, PromptPay QR) |
| 3 | User Control and Freedom | 3 / 4 | มีระบบยืนยัน 2 จังหวะ `ยืนยันล้างตะกร้า?` + ปุ่ม `กู้คืนตะกร้าล่าสุด` (Undo), `<dialog>` ปิดด้วย `Esc`, และรีเซ็ตตัวคูณในคลิกเดียว |
| 4 | Consistency and Standards | 3 / 4 | ทั้ง 4 หน้าหลังบ้านใช้ `max-w-6xl` + ส่วนหัว 2 บรรทัด + แผง `⋯` เหมือนกันหมด (เหลือหน้า Dashboard แถว 2 ที่ยังไม่ได้รวบปุ่มรองเข้า `⋯`) |
| 5 | Error Prevention | 4 / 4 | แยก `Ctrl+Enter` ออกจาก `F10`, ยืนยันก่อนล้างตะกร้า, เตือนสต็อกไม่พอ/หนี้เกินวงเงิน, และตรวจเงินทอนขาดก่อนจบบิล |
| 6 | Recognition Rather Than Recall | 4 / 4 | คู่มือ `F1`, ป้ายคีย์ลัด `<kbd>`, ช่องค้นหาลูกค้าใน Checkout Modal, และโหมดการ์ดกระชับแสดงเฉพาะป้ายสำคัญ |
| 7 | Flexibility and Efficiency | 4 / 4 | คีย์ลัดครบ (`F1`–`F10`, `Ctrl+Enter`), ตัวคูณ `×1/×2/×5/×10`, `+5`, ชุดขายด่วน, และ `โหมดตารางจัดการลูกหนี้เร็ว` |
| 8 | Aesthetic and Minimalist Design | 3 / 4 | แผง `⋯` ช่วยลดความแออัดของแถบเครื่องมือบนทุกหน้าได้ชัดเจน (เหลือหัวตะกร้าที่มี 4 ปุ่มเมื่อมีสินค้า >= 2 รายการ) |
| 9 | Error Recovery | 4 / 4 | มี `role="alert"` ชัดเจน, คำนวณยอดขาด/เกินทันที, กู้คืนตะกร้าที่ล้างไปแล้วได้, และแสดงตัวอย่างก่อนกู้คืน JSON |
| 10 | Help and Documentation | 3 / 4 | มีหน้าต่าง `F1` คู่มือคีย์ลัด, tooltips อธิบายปุ่ม, และข้อความแนะนำเมื่อยังไม่มีข้อมูล |
| **Total** | | **35 / 40** | **Good** (ขยับจาก **24/40 → 35/40**, +11 คะแนน; ปิด P0 ครบ 100%) |

---

### Design Specificity Verdict

**LLM Assessment:**
ระบบมีเอกลักษณ์ของ **ร้านขายของชำไทย (Thai Grocery POS)** ชัดเจนทั้งด้านฟังก์ชันและระบบภาพ (Emerald/Slate System, `Noto Sans Thai` + `Plus Jakarta Sans` พร้อม `tabular-nums`, Semantic Tokens, `prefers-reduced-motion`, และ `content-visibility: auto`) โครงสร้างทั้ง 4 หน้าหลังบ้าน (`inventory`, `customers`, `shifts`, `dashboard`) ใช้ `max-w-6xl` และส่วนหัว 2 บรรทัดสอดคล้องกันดีมาก เหลือเพียงรายละเอียดเล็กน้อยด้านขนาดเป้าหมายสัมผัสบนแท็บเล็ตและการจัดระเบียบเครื่องมือรองใน Dashboard/CartPanel

**Deterministic Scan (`impeccable detect --json src`):**
- **Exit Code:** `0` (สแกนครบ 18 ไฟล์ใน `src/`)
- **Findings:** **`0 findings` (`[]`)** — ไม่พบ Anti-pattern หรือ Slop ใดๆ ในโค้ด

**Visual Overlays:**
ไม่มี live dev server หรือ browser automation tool เชื่อมต่อในขั้นตอนนี้ จึงใช้ผลจาก CLI deterministic scan (`Exit Code 0`) ร่วมกับการตรวจโค้ด static markup แทน

---

### Overall Impression
การปรับปรุงรอบที่ผ่านมาแก้ปัญหาคอขวดหลักได้ตรงจุดทั้งหมด (คะแนนเพิ่มจาก **24/40 เป็น 35/40**, **P0 เหลือ 0 รายการ**, และ **Detector เหลือ 0 findings**) ระบบพร้อมใช้งานจริงหน้าร้านได้อย่างมั่นใจ จุดที่เหลือเป็นเพียงการเก็บงานระดับ P1–P3 เพื่อดันคะแนนเข้าสู่ระดับ **Excellent (36–40)**

---

### What's Working
1. **ความปลอดภัยและคีย์ลัดหน้าร้าน (`src/app/pos/page.tsx`):** `F8/F9/F10` สม่ำเสมอ, `Ctrl+Enter` จ่ายเงินสดพอดี, ยืนยัน 2 จังหวะก่อนล้างตะกร้า + ปุ่มกู้คืนตะกร้าล่าสุด, และป้ายรีเซ็ตตัวคูณ `×N`
2. **Progressive Disclosure & Consistency (`pos`, `inventory`, `customers`):** แผง `⋯` ลดความแออัดของแถบเครื่องมือบนทุกหน้า และหน้า `ลูกค้าเงินเชื่อ` กับ `สินค้า & สต็อก` มีหน้าตาและโหมดตารางเร็วที่สอดคล้องกัน
3. **Performance & Accessibility Foundation (`Modal.tsx`, `globals.css`, `layout.tsx`, `client.ts`):** Modal unmount เมื่อปิด (`0 DOM nodes`), `useDeferredValue`, `content-visibility: auto`, `display: "swap"`, `prefers-reduced-motion`, และ Contrast `>= 4.5:1`

---

### Remaining Priority Issues

1. **[P1] เป้าหมายสัมผัส (Touch Targets) บนการ์ดสินค้าและปุ่มในตะกร้ายังต่ำกว่า 44px**
   - **What:** ปุ่มปักหมุดดาวและปุ่มเลือกหน่วยขายบนการ์ดสินค้า (`min-h-8` = 32px) รวมถึงปุ่ม `-` / `+` / `+5` ในตะกร้า (`h-9` = 36px) ยังเล็กกว่ามาตรฐาน 44px บนจอสัมผัส
   - **Why it matters:** พนักงานที่ใช้งานบนแท็บเล็ตหรือจอทัชสกรีนช่วงเร่งรีบอาจกดพลาดหน่วยสินค้าได้
   - **Fix:** ขยายปุ่มเลือกหน่วยขายเป็น `min-h-10` และปุ่ม `-` / `+` ในตะกร้าเป็น `h-10 w-10` (40–44px) พร้อมเพิ่ม `gap-2`
   - **Suggested command:** `/impeccable polish`

2. **[P2] หัวตะกร้า (`CartPanel`) มีปุ่มซ้อนกัน 4 ปุ่มเมื่อมีสินค้า 2 รายการขึ้นไป**
   - **What:** เมื่อ `cart.length >= 2` แถบหัวตะกร้าแสดงปุ่ม 4 ปุ่มพร้อมกัน (`คัดลอกบิลส่ง LINE`, `แยกรายการไปพักบิล`, `บันทึกเป็นชุดขายด่วน`, `ล้างตะกร้า`)
   - **Why it matters:** บนแถบตะกร้ากว้าง 384px ปุ่มทั้ง 4 จะห่อบรรทัดและเบียดพื้นที่รายการสินค้า
   - **Fix:** รวบ `คัดลอกบิลส่ง LINE` และ `บันทึกเป็นชุดขายด่วน` ไว้ในปุ่ม `⋯` ของหัวตะกร้า
   - **Suggested command:** `/impeccable distill`

3. **[P2] ช่องเลือกลูกค้าใน `CartPanel` ยังไม่มีช่องพิมพ์ค้นหาเหมือนหน้า Checkout Modal**
   - **What:** หน้า Checkout Modal มี `customerSearchQuery` แล้ว แต่ `<select>` ใน `CartPanel` ยังเป็นรายการเลื่อนยาว
   - **Why it matters:** หากร้านมีลูกค้าประจำ 50+ ราย การเลือกลูกค้าก่อนเปิดหน้าชำระเงินจะช้า
   - **Fix:** เพิ่มช่องค้นหาชื่อ/เบอร์โทรลูกค้าแบบเดียวกับ Checkout Modal ใน `CartPanel`
   - **Suggested command:** `/impeccable adapt`

4. **[P2] แถวเครื่องมือบนหน้า Dashboard (`dashboard/page.tsx`) ยังไม่รวบปุ่มรองเข้า `⋯`**
   - **What:** `src/app/dashboard/page.tsx` แถวที่ 2 แสดงปุ่มช่วงเวลา 5 ปุ่ม + ปุ่มเครื่องมือ 5 ปุ่มพร้อมกัน (10 ปุ่ม)
   - **Why it matters:** ดูแน่นกว่าหน้า `inventory` และ `customers` ที่รวบปุ่มรองไว้ใน `⋯` แล้ว
   - **Fix:** คงปุ่มช่วงเวลาและปุ่มหลัก 2 ปุ่มไว้ แล้วรวม `พิมพ์รายงาน`, `ส่งออก CSV`, และ `Master JSON` ไว้ใน `เครื่องมือเพิ่มเติม (⋯)`
   - **Suggested command:** `/impeccable distill`

5. **[P3] ความสูงของ Checkout Modal บนหน้าจอแล็ปท็อปความสูง 768px**
   - **What:** เมื่อเลือกลูกหนี้ที่มีป้ายเตือนหลายป้ายและกล่องตัดหนี้เดิม ปุ่ม `ยืนยันชำระเงิน` อาจเลื่อนลงไปใต้ขอบจอต้องไถลลง
   - **Why it matters:** ลดความเร็วในการกดยืนยันบนโน้ตบุ๊กขนาด 1366×768
   - **Fix:** จัด Checkout Modal (`max-w-2xl`) เป็น 2 คอลัมน์บนหน้าจอ `md:` ขึ้นไป (ซ้าย: ลูกค้า/ตัดหนี้/ส่วนลด, ขวา: วิธีชำระเงินและปุ่มยืนยัน)
   - **Suggested command:** `/impeccable layout`

---

### Persona Red Flags
- **Alex (แคชเชียร์มือโปร):** ดีขึ้นมากแล้ว เหลือเพียงบนจอแล็ปท็อป 768px ที่ Checkout Modal อาจต้องเลื่อนลงเมื่อเลือกลูกหนี้มีหนี้ค้างหลายรายการ
- **Sam (เจ้าของร้าน / หลังบ้าน):** แถวปุ่มหน้า `dashboard` ยังแสดง 10 ปุ่มพร้อมกัน และไฟล์แต่ละหน้ายังมีขนาดใหญ่ (7k–14.5k บรรทัด)
- **Casey (ผู้ใช้แท็บเล็ต / จอสัมผัส):** ปุ่มปักหมุด/หน่วยขาย (`32px`) และปุ่ม `-`/`+` (`36px`) ยังแน่นมือบนจอสัมผัส

---

### Minor Observations & Questions to Consider
**Minor Observations:**
- ป้าย `promoLabel` ในตะกร้ายังใช้ `bg-gradient-to-r from-rose-500 to-orange-500` ขณะที่บนการ์ดสินค้าเปลี่ยนเป็น `bg-rose-600` แล้ว ควรใช้ `bg-rose-600` เหมือนกัน
- `shifts/page.tsx` แสดงแถบแจ้งเตือนคัดลอกสำเร็จแบบ inline ในหัวหน้า ส่วน `pos/page.tsx` ใช้ Toast มุมขวาบน

**Questions to Consider:**
1. *ควรขยายปุ่มสัมผัสบนหน้า POS เป็น 40–44px เพื่อดันคะแนนจาก 35/40 เข้าสู่ระดับ Excellent (36+/40) เลยหรือไม่?*
2. *บนหน้า Dashboard ควรซ่อนปุ่ม `พิมพ์รายงาน`, `ส่งออก CSV`, และ `Master JSON` เข้า `เครื่องมือเพิ่มเติม (⋯)` เหมือนหน้าอื่นไหม?*
3. *ใน Checkout Modal ควรแบ่งเป็น 2 คอลัมน์บนเดสก์ท็อปเพื่อให้ปุ่ม `ยืนยันชำระเงิน` อยู่บนหน้าจอเดียวโดยไม่ต้องเลื่อนหรือไม่?*
