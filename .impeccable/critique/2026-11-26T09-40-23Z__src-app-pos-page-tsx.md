---
target: src/app/pos/page.tsx
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:E:\\ระบบร้านขายของชำ POS\\src\\app\\pos\\page.tsx"
target_fingerprint: "sha256:043eb1b26462fd64a4ca96b7942221159335b92f7b79816f802a9a12e1a6edd6"
target_path: "E:\\ระบบร้านขายของชำ POS\\src\\app\\pos\\page.tsx"
timestamp: 2026-11-26T09-40-23Z
slug: src-app-pos-page-tsx
---
Method: dual-agent (A: 8996408b-1b4f-42d8-957f-84936effb17d · B: d43dc608-8690-4d64-b1d0-d0965f6754c4)

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 / 4 | จุดเขียวสถานะกะเปิด (`8333–8338`) ซ่อนอยู่ในปุ่ม `ตัวเลือกเสริม (⋯)` โดยไม่มีข้อความกำกับ และไม่มีสถานะแสดงการเชื่อมต่อ/ออฟไลน์ |
| 2 | Match System / Real World | 3 / 4 | ภาษาโชห่วยไทยธรรมชาติมาก แต่พบข้อผิดพลาดทางหน่วยชั่งใน `ชั่งกิโล / ตักตามงบ` (`9203`: `0.25 (1 ขีดครึ่ง/1ส่วน4)` — ที่ถูกต้องคือ **2 ขีดครึ่ง**) |
| 3 | User Control and Freedom | 3 / 4 | มี 2-step confirm + Undo `กู้คืนตะกร้าล่าสุด`, ยืนยัน 2 ขั้น `สดพอดี`, และ `<dialog>` คืน focus แล้ว แต่ `Ctrl+Enter` หน้าหลัก (`5437–5440`) ตัดขายทันทีโดยข้ามยืนยัน |
| 4 | Consistency and Standards | 2 / 4 | สี Amber ถูกใช้ซ้อน 6 ความหมายใน Checkout, Checkout Modal (`9517`) เป็น `<div>` ไม่ใช่ `<form>` จึงกด `Enter` ในช่องรับเงินสดไม่ได้, และปุ่มรองบางตัวยังเล็กกว่า `min-h-10` |
| 5 | Error Prevention | 3 / 4 | บล็อกเงินสดไม่พอ, เตือนหมดอายุ 2 ขั้น, เตือนเลยกำหนด/เกินวงเงิน แต่ `F1` (`5397–5399`) เปิดทับ Checkout Modal ได้ และ `Ctrl+Enter` หน้าหลักไม่มี guard |
| 6 | Recognition Rather Than Recall | 3 / 4 | `<kbd>` ชัด, แบนเนอร์บิลล่าสุดมีปุ่มดึงซ้ำ, แต่แถบหมวดหมู่มีฟิลเตอร์ระบบ 5 ตัวก่อนหมวดหมู่สินค้าจริง (`8496–8558`) ดันหมวดหมู่จริงหลุดขอบจอกลาง |
| 7 | Flexibility and Efficiency | 3 / 4 | ยิงบาร์โค้ดหน่วย, คีย์ลัด `F2–F10`, ตัวคูณ, และชุดขายด่วนครบ แต่พิมพ์เงินใน `#checkout-cash-received` (`10313–10322`) แล้วกด `Enter` บน Numpad ไม่ยืนยันบิล |
| 8 | Aesthetic and Minimalist Design | 3 / 4 | Progressive disclosure ดีขึ้นมากใน Top Bar, Product Card และ Checkout (ยุบหนี้เดิม/เงินเชื่อแล้ว) แต่แถวตะกร้ามี 7–8 ปุ่มควบคุมต่อแถว (`7538–7951`) และบิลพักมี 8–11 ปุ่มต่อการ์ด |
| 9 | Error Recovery | 3 / 4 | `checkoutError` มี `ลองใหม่`, ลิงก์ตั้งค่า PromptPay, และปุ่ม `คิดราคาด่วน` เมื่อค้นไม่เจอ แต่ Modal ที่ใช้ `required` (`9119, 14667`) ยังพึ่ง native browser tooltip |
| 10 | Help and Documentation | 3 / 4 | คู่มือ `F1` (`12946–12986`) ครบถ้วน แต่ปุ่มเปิดคู่มือซ่อนใน `ตัวเลือกเสริม (⋯)` (`8466–8474`) และยังไม่มีคำอธิบายสั้นๆ เรื่อง `เงินฝากทอน` |
| **Total** | | **29 / 40** | **Good** (`1 P0`, `2 P1`, `2 P2`) |

---

### Design Specificity Verdict

**LLM Assessment:**
หน้าขาย `/pos` มีเอกลักษณ์เฉพาะสำหรับ **ร้านขายของชำไทย (โชห่วย)** ในโหมด Operate สูงมาก ทั้งเงินเชื่อตามรอบเงินเดือน (`computeNextPaydayDueDateIso`), **เงินฝากทอน** (`storeCredit`), **ชั่งกิโล / ตักตามงบ**, **มัดจำขวด/ลัง**, **แยกจ่าย Cash + PromptPay QR**, **คัดลอกบิลส่ง LINE**, **ตัวช่วยหยิบธนบัตร/เหรียญทอนตามสีแบงก์ไทยจริง**, และ `AppShell` ที่ยุบ Sidebar เป็น Rail 64px (`md:w-16`) เฉพาะ `/pos` จากการแก้ไขรอบก่อนช่วยลด Cognitive Load จาก 5/8 ข้อเหลือ **3/8 ข้อ** และยกระดับ Aesthetic/Minimalist Design เป็น `3/4` แต่การตรวจรอบใหม่นี้พบข้อผิดพลาดสำคัญเรื่องป้ายหน่วยชั่ง (`0.25 = 1 ขีดครึ่ง` แทนที่จะเป็น `2 ขีดครึ่ง`) และช่องโหว่ Combobox ARIA / Numpad `Enter` ใน Checkout

**Deterministic Scan (`impeccable detect --json`):**
- **คำสั่งและผลลัพธ์:** `impeccable detect --json src`, `impeccable detect --json src/app/pos/page.tsx` และ `--no-config` ออกด้วย **Exit Code `0`** (`[]` / **`0 findings`** จาก 17 ไฟล์)
- **ข้อจำกัดการครอบคลุม (Coverage Caveat):** เป็นการสแกนแบบ regex-only static pass บน `.tsx/.ts/.css` เท่านั้น กฎที่ต้องอาศัย DOM/computed styles (`tiny-text`, `low-contrast`, element rules) ไม่ได้ทำงาน ดังนั้น `[]` จึงเป็น undercount ไม่ใช่ใบรับรองความสะอาดเต็มรูปแบบ

**Visual Overlays:**
ข้ามขั้นตอน Browser Visualization / Overlay เนื่องจาก `Get-NetTCPConnection -LocalPort 3000 -State Listen` คืนค่า `NO_LISTENER_PORT_3000` (ไม่มี dev server ทำงานอยู่)

---

### Overall Impression
โครงสร้างการลดความรกและ Progressive Disclosure ในรอบล่าสุดช่วยให้หน้าขายและ Checkout สงบขึ้นอย่างชัดเจน (`Cognitive Load` ผ่านเพิ่มเป็น 5/8 ข้อ) จุดที่ต้องรีบแก้ในรอบถัดไปคือ **คำอธิบายหน่วยชั่ง `0.25 กก.` ที่ผิดพลาดทางคณิตศาสตร์** (`P0`), การรองรับ Numpad `Enter` ในช่องรับเงินสดหน้า Checkout, และ `role="listbox"`/`role="option"` บน Product Grid สำหรับ Screen Reader

---

### What's Working
1. **ตัวช่วยหยิบเงินทอนตามธนบัตรไทย (`src/app/pos/page.tsx:270–387, 10461, 12166`):** แตกยอดทอนเป็นธนบัตรและเหรียญจริงพร้อมสีตามแบงก์ไทย ช่วยลดความผิดพลาดหน้าเคาน์เตอร์ได้จริง
2. **Operate-Mode Shell & Quiet Product Cards (`src/components/AppShell.tsx:48, 88–142` & `src/app/pos/page.tsx:8964–9055`):** ยุบ Navigation เป็น Slim Rail 64px เฉพาะหน้าขาย และจำกัดการ์ดสินค้าให้โชว์สถานะวิกฤตสูงสุด 1 badge ที่สถานะพัก
3. **กลไกกันพลาดและกู้คืน (`src/app/pos/page.tsx:7280–7391, 10964–11008`):** ล้างตะกร้ามี Undo Snapshot, สินค้าหมดอายุยืนยัน 2 ขั้น, และ `checkoutError` มีปุ่ม `ลองใหม่` ในตัว

---

### Cognitive Load Assessment
ไม่ผ่าน **3 จาก 8 เกณฑ์** (ดีขึ้นจาก 5/8):
- **Single focus:** ผ่าน
- **Chunking ≤4:** ผ่านเป็นส่วนใหญ่ (`showMorePosTools` จัดกลุ่ม 3×3 และ Checkout ล็อกวิธีจ่าย 3 ปุ่ม)
- **Grouping:** ผ่าน
- **Visual hierarchy:** ผ่านเป็นส่วนใหญ่ (เหลือสี Amber ใน Checkout ที่ซ้อนกันหลายกล่อง)
- **One thing at a time:** ผ่าน
- **Minimal choices ≤4:** ไม่ผ่าน — แถบหมวดหมู่มีฟิลเตอร์ระบบ 5 ตัวก่อนหมวดหมู่จริง (`8496–8573`), แถวตะกร้ามี 7–8 ปุ่มควบคุม (`7538–7951`), รับเงินสดด่วน 6 ปุ่ม (`10324–10352`), ส่วนลดเมื่อกาง 10+ ปุ่ม (`9915–10039`), และการ์ดบิลพัก 8–11 ปุ่ม (`11611–11725`)
- **Working memory:** ไม่ผ่านบางส่วน (ต้องจำว่า Checkout ใช้ `Ctrl+Enter` แทน `Enter` และป้าย `0.25 (1 ขีดครึ่ง)` ขัดความจริง)
- **Progressive disclosure:** ไม่ผ่านบางส่วน (ปุ่มเสริมในแถวตะกร้าและป้ายด่วนในการ์ดบิลพักยังไม่ถูกพับ)

---

### Emotional Journey
- **Peak-End:** หน้าสรุปบิลใบเสร็จ (`11868–12254`) แสดงเงินทอนสีเขียวใหญ่ + แถบธนบัตร/เหรียญทอนแยกสี และปุ่ม `เริ่มบิลถัดไป` (`autoFocus`) ที่คืนโฟกัสกลับช่องค้นหาทันที
- **Emotional Valleys:** พิมพ์เงินรับมาใน Checkout แล้วกด `Enter` บน Numpad ไม่ทำงาน (`10313–10322`), เห็นป้าย `0.25 (1 ขีดครึ่ง)` ตอนชั่งของสด (`9203`), และหัวข้อ `ตะกร้าสินค้า` ซ้ำ 2 ชั้นบนมือถือ (`9091–9097`)
- **High-Stakes Reassurance:** ยอดค้างเชื่อ + คำเตือนแบบไม่บล็อกดุลยพินิจเจ้าของร้าน, ล้างตะกร้ามี Undo, และ Lock Screen ยืนยันจำนวนรายการในตะกร้า/บิลพักชัดเจน

---

### Priority Issues

1. **[P0] ข้อผิดพลาดทางหน่วยชั่งใน Modal `ชั่งกิโล / ตักตามงบ`**
   - **What:** ปุ่มเลือกน้ำหนักด่วนที่ `src/app/pos/page.tsx:9203` แสดงข้อความ `0.25 (1 ขีดครึ่ง/1ส่วน4)`
   - **Why it matters:** 0.25 กก. = **2 ขีดครึ่ง (250 กรัม)** ไม่ใช่ 1 ขีดครึ่ง (150 กรัม) พนักงานอาจคิดเงินเกิน 66% หรือชั่งของผิดน้ำหนักทันที
   - **Fix:** แก้ข้อความเป็น `0.25 (2 ขีดครึ่ง / ¼ กก.)` (และพิจารณาเพิ่มปุ่ม `0.1` = 1 ขีด)
   - **Suggested command:** `/impeccable clarify`

2. **[P1] Combobox ARIA ในช่องค้นหาไม่สมบูรณ์ + Keyboard Tab Trap ใน Product Grid**
   - **What:** ช่องค้นหา (`src/app/pos/page.tsx:8243–8255`) มี `role="combobox"` และ `aria-activedescendant` แต่ `#pos-product-grid` (`8797`) ขาด `role="listbox"` และการ์ดลูก (`8846`) ขาด `role="option"` / `aria-selected` อีกทั้งไม่มี skip link ไปตะกร้า
   - **Why it matters:** Screen reader ไม่อ่านรายการที่ไฮไลต์ด้วย `↑/↓` และผู้ใช้คีย์บอร์ดล้วน (Sam) ต้อง `Tab` ผ่านการ์ดสินค้า 60–150+ ครั้งกว่าจะถึงตะกร้า
   - **Fix:** เพิ่ม `role="listbox"` บน `#pos-product-grid` และ `role="option"` + `aria-selected={isKeyboardHighlighted}` บนการ์ดลูก พร้อมเพิ่ม `<aside aria-label="ตะกร้าสินค้า">` และคีย์ลัด/skip link กระโดดไปตะกร้าใน 1 ขั้น
   - **Suggested command:** `/impeccable harden`

3. **[P1] กด `Enter` ในช่องรับเงินสดหน้า Checkout ไม่ยืนยันบิล + `F1` เปิดทับ Modal อื่นได้**
   - **What:** ช่อง `#checkout-cash-received` (`src/app/pos/page.tsx:10313–10322`) ไม่มี `onKeyDown` รองรับ `Enter` และ `F1` (`5397–5399`) ไม่เช็ก `hasOpenModal` ทำให้เปิด Shortcuts Modal ทับ Checkout Modal ได้
   - **Why it matters:** แคชเชียร์ที่ใช้ Numpad พิมพ์ `500` แล้วตบ `Enter` จะสะดุดทุกบิล และการกด `F1` ซ้อน Modal ทำให้ focus ซ้อนกัน
   - **Fix:** เพิ่ม `onKeyDown` บน `#checkout-cash-received` ให้ `Enter` เรียก `handleCompleteSale()` เมื่อ `!submitting && !isCashPaymentBlocked` และจำกัด `F1` ให้ทำงานเฉพาะเมื่อ `shortcutsOpen || !hasOpenModal`
   - **Suggested command:** `/impeccable harden`

4. **[P2] แถวรายการใน CartPanel หนาแน่น (7–8 ปุ่ม/แถว) + หัวข้อซ้ำซ้อนบน Mobile Cart Modal**
   - **What:** แต่ละแถวใน `CartPanel` (`7538–7951`) แสดงปุ่มเสริม (`+ โน้ตสินค้า`, `⚖️ ชั่งกิโล`) ทุกรายการ และเมื่อเปิดบนมือถือใน `<Modal title="ตะกร้าสินค้า">` (`9091–9097`) หัวข้อ `ตะกร้าสินค้า` ภายใน `CartPanel` (`7251–7254`) แสดงซ้ำซ้อน
   - **Why it matters:** เห็นสินค้าในตะกร้าได้น้อยลงบนเดสก์ท็อปและเสียพื้นที่แนวตั้ง ~56px บนมือถือ
   - **Fix:** แสดง `⚖️ ชั่งกิโล` เฉพาะสินค้าหน่วยน้ำหนัก/ราคาอิสระ หรือพับปุ่มเสริมเข้าเมนู `⋯` ต่อแถว และซ่อนหัวข้อ `ตะกร้าสินค้า` ภายใน `CartPanel` เมื่ออยู่ใน `mobileCartOpen`
   - **Suggested command:** `/impeccable distill`

5. **[P2] ปุ่มรองหลายจุดต่ำกว่า 44px และสี Amber ถูกใช้ซ้อนกันเกินไป**
   - **What:** ปุ่ม `เครื่องมือ (⋯)` (`7272`), `จอลูกค้า` (`8075`), `ข้อมูลเพิ่ม` (`9019`) และปุ่มย่อยใน Checkout (`9543, 9818`) ยังต่ำกว่า 40–44px ส่วนสี Amber ถูกใช้ซ้ำหลายความหมายใน Checkout รวมถึงปุ่ม `คิดเงินทันที` ในหน้าบิลพัก (`11720`)
   - **Why it matters:** กดพลาดบนแท็บเล็ตจอสัมผัสได้ง่ายและแยกความหมายกล่องใน Checkout ช้าลง
   - **Fix:** เพิ่ม `min-h-10 touch-target` ให้ปุ่มรองที่กดบ่อย, เปลี่ยนสีปุ่ม `คิดเงินทันที` ในหน้าบิลพักเป็น `bg-emerald-600`, และลดการใช้พื้นหลัง Amber ใน Checkout ให้เหลือเฉพาะจุดเตือน/เงินเชื่อ
   - **Suggested command:** `/impeccable polish`

---

### Persona Red Flags
- **Alex (แคชเชียร์มือไว):** พิมพ์ `500` ใน `#checkout-cash-received` (`10313`) แล้วกด `Enter` บน Numpad ไม่ทำงาน; กด `Ctrl+Enter` หน้าหลัก (`5437–5440`) ตัดขายทันทีไม่เหมือนปุ่ม `สดพอดี` 2-tap; ปุ่ม `คิดเงินทันที` ในหน้าบิลพักเป็นสี Amber (`11720`) ไม่ใช่ Emerald
- **Jordan (พนักงานใหม่):** เห็น `0.25 (1 ขีดครึ่ง/1ส่วน4)` (`9203`) เสี่ยงชั่งผิด 66%; ไม่เห็นปุ่มคู่มือ `F1` เพราะซ่อนใน `⋯` (`8466`); เจอกล่องสี Amber ซ้อนกันใน Checkout เมื่อมีแต้ม+ส่วนลด+หนี้เดิม
- **Sam (คีย์บอร์ดล้วน / Screen Reader):** `#pos-product-grid` ขาด `role="listbox"`/`role="option"` ทำให้ Screen reader ไม่อ่านรายการไฮไลต์; ต้อง `Tab` ผ่านการ์ดสินค้า 60–150+ ครั้งเพื่อไปตะกร้า; จุดเขียว `activeShift` (`8333`) ไม่มีข้อความกำกับ

---

### Minor Observations & Questions to Consider
**Minor Observations:**
- `src/app/pos/page.tsx` มี 15,338 บรรทัด / 22 Modals การแยก Modal หลักออกเป็น component ย่อยจะช่วยคุมความสม่ำเสมอได้ง่ายขึ้น
- `AppShell.tsx:165–180` ปุ่ม `ออกจากระบบ` บน Mobile Top Header ทำงานในคลิกเดียวโดยไม่มี confirmation เสี่ยงเผลอกดโดนขณะขายของ

**Questions to Consider:**
1. หากแสดง `⚖️ ชั่งกิโล` เฉพาะสินค้าหน่วยน้ำหนัก/ราคาอิสระ และพับปุ่มเสริมในแถวตะกร้าเข้า `⋯` เพื่อให้เห็นสินค้า 6–7 รายการพร้อมกัน จะช่วยให้คิดเงินเร็วขึ้นแค่ไหน?
2. ในช่องรับเงินสดหน้า Checkout ควรให้กด `Enter` ยืนยันบิลได้ทันที (คู่กับ `Ctrl+Enter`) เพื่อให้แคชเชียร์ใช้ Numpad มือเดียวจบทั้งบิลหรือไม่?
3. ควรแยกฟิลเตอร์พิเศษ 5 ตัวแรก (`ขายด่วน`, `ปักหมุด`, `โปรโมชั่น`, `มีราคาส่ง`) ออกจากแถบหมวดหมู่สินค้าจริงหรือไม่?
