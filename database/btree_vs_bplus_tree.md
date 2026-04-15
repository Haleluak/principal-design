# B-Tree vs B+ Tree — Deep Dive cho Principal Engineer & SA

---

## 1. Tại sao cần Index?

Đọc dữ liệu từ Disk chậm hơn RAM khoảng **100.000 lần**. Index sinh ra để giảm số lần "chạm" vào Disk khi tìm kiếm.

> **Ẩn dụ:** Tìm từ trong từ điển — nếu không có mục lục, phải lật từng trang (Full Table Scan). Có mục lục (Index), nhảy thẳng đến trang cần tìm.

---

## 2. B-Tree là gì?

Cây tìm kiếm tự cân bằng, trong đó **dữ liệu thực tế (Data Pointer) được lưu ở MỌI tầng** — gốc, trung gian, lẫn lá.

## 3. B+ Tree là gì?

Phiên bản cải tiến: **dữ liệu thực tế CHỈ nằm ở tầng lá (Leaf Nodes)**. Các tầng trung gian chỉ chứa key để điều hướng, không có Data Pointer.

## 4. Data Pointer là gì?

`Data Pointer` là một con trỏ (8–12 bytes) trỏ đến vị trí vật lý của record thực tế trên đĩa — ví dụ "dòng id=42 nằm ở file X, offset Y".

- **B-Tree:** Mọi node (kể cả node trung gian) đều chứa Data Pointer → có thể lấy data từ bất kỳ tầng nào.
- **B+ Tree Internal Node:** Không có Data Pointer → chỉ điều hướng, không trả về data.
- **B+ Tree Leaf Node:** Có Data Pointer → đây là nơi DUY NHẤT lấy data trong B+ Tree.

---

## 5. So sánh cấu trúc bên trong node

| Thành phần | B-Tree (mọi node) | B+ Tree — Node trung gian | B+ Tree — Node lá |
|---|---|---|---|
| Key | Có | Có (bản sao để điều hướng) | Có (dữ liệu thật) |
| Data Pointer | **Có** | **Không** | **Có** |
| Child Pointer | Có | Có | Không |
| Con trỏ Next/Prev sang node kề | Không | Không | **Có — điểm mấu chốt!** |

### Tại sao con trỏ Next/Prev quan trọng?

Khi truy vấn `WHERE date BETWEEN '2024-01-01' AND '2024-12-31'`:

- **B+ Tree:** Tìm ngày đầu tiên **một lần**, rồi "chạy bộ" sang phải theo hành lang liên thông ở tầng lá.
- **B-Tree:** Phải leo lên leo xuống các tầng liên tục (In-order traversal) — tốn kém hơn rất nhiều.

---

## 6. Fan-out và tại sao B+ Tree "lùn" hơn

**Fan-out** là số lượng node con mà một node trung gian có thể trỏ tới. Fan-out càng lớn, cây càng ít tầng, càng ít đọc Disk.

> **Ẩn dụ chiếc xe bus:** Node trung gian B-Tree như xe bus chở hành khách có vali nặng (Data Pointer) → ít người ngồi vừa. Node trung gian B+ Tree như xe bus chở người chỉ đường, không mang hành lý → chở được gấp đôi.

### Phép tính với Page 8KB (Key=8B, Child Ptr=8B, Data Ptr=12B):

| Cây | Kích thước 1 entry | Fan-out (8KB page) |
|---|---|---|
| B-Tree | 8 + 8 + 12 = **28 bytes** | 8192 / 28 ≈ **292** |
| B+ Tree | 8 + 8 = **16 bytes** | 8192 / 16 = **512** |

### Sức mạnh của hàm mũ (N = M^height):

| Chiều cao | B-Tree (M=292) | B+ Tree (M=512) |
|---|---|---|
| 3 tầng | ≈ 24,8 triệu records | ≈ **134,2 triệu records** |
| Để chứa 134M records | Cần **4–5 tầng** | Chỉ cần **3 tầng** |

> **Tại sao 1–2 tầng lại quan trọng?** 1 lần đọc Disk ≈ 1 triệu lệnh CPU. Với hệ thống 100.000 query/giây, giảm 1 tầng = tiết kiệm hàng trăm giây CPU mỗi phút.

---

## 7. Giải thích "B+ Tree nặng hơn 5–15% về dung lượng đĩa"

**Đây là về tổng kích thước file Index trên đĩa, KHÔNG phải về 1 page đơn lẻ.**

- **B-Tree:** Key "42" xuất hiện **1 lần duy nhất** ở bất kỳ đâu trong cây.
- **B+ Tree:** Key "42" xuất hiện **2 lần** — 1 bản ở node trung gian (để điều hướng) + 1 bản ở node lá (dữ liệu thật).

→ Tổng file Index B+ Tree lớn hơn ~5–15% do lưu bản sao key.

**Điều này không mâu thuẫn với fan-out**, vì fan-out tính riêng trên từng node trung gian — và ở đó B+ Tree luôn gầy hơn do không có Data Pointer. Hy sinh 10% dung lượng đĩa tổng thể để đổi lấy fan-out tăng gần gấp đôi (292 → 512) là trade-off rất có lợi.

---

## 8. B+ Tree và phần cứng

| Đặc điểm | Tại sao B+ Tree hưởng lợi |
|---|---|
| **Sequential Read** | Leaf nodes nối thành linked list → Range Scan là đọc tuần tự. OS tự tải sẵn trang tiếp theo (Prefetching). |
| **CPU Cache** | Node trung gian rất nhỏ gọn → toàn bộ các tầng trên có thể nằm trong L3 Cache. Tìm key xảy ra trong nano-giây. |
| **Branch Prediction** | Đường đi luôn kết thúc ở tầng lá (độ dài cố định) → CPU dự đoán luồng xử lý hiệu quả hơn. |

---

## 9. Tự cân bằng: Split và Merge

Cả hai loại cây đều tự duy trì cân bằng qua 2 thao tác:

**Split (Chẻ đôi)** — xảy ra khi chèn vào node đã đầy:
- Node bị cắt làm đôi, key ở giữa (median) đẩy lên node cha.
- Đây là cách duy nhất khiến cây tăng thêm một tầng mới.

**Merge / Borrow (Gộp / Mượn)** — xảy ra khi xóa dữ liệu:
- Nếu node anh em còn dư key → mượn 1 key từ đó.
- Nếu anh em cũng nghèo → hai node gộp lại, cây có thể giảm tầng.

### Tại sao B+ Tree xử lý concurrency tốt hơn?

- **B-Tree:** Cập nhật dữ liệu có thể thay đổi node trung gian → tranh chấp lock ở vùng "nóng" mà mọi query đều đi qua.
- **B+ Tree:** Mọi thay đổi dữ liệu **luôn bắt đầu từ tầng lá** → ít tranh chấp hơn ở các tầng trên. Biến thể **B-link Tree (Lehman & Yao)** còn cho phép đọc và ghi song song không cần chờ nhau.

---

## 10. Fill Factor: Cân bằng đọc và ghi

**Fill Factor** là tỷ lệ % dung lượng của một Page được sử dụng.

| Hệ thống | Fill Factor gợi ý | Lý do |
|---|---|---|
| Read-heavy | 90–100% | Nén dữ liệu chặt, ít trang hơn, đọc nhanh hơn |
| Write-heavy | 70–80% | Để trống chỗ cho dữ liệu mới, trì hoãn Page Split tốn kém |

---

## 11. Index nằm ở đâu trên ổ cứng?

### MySQL InnoDB — Clustered Index
- Data và Primary Index nằm **chung một file** `.ibd`.
- Node lá chứa toàn bộ dữ liệu dòng đó (Full Row Data).
- Tìm theo Primary Key → lấy data ngay, không cần bước nhảy đĩa thêm.

### PostgreSQL — Heap tách biệt
- Table (Heap file) và Index là **hai file riêng biệt**.
- Node lá Index chỉ chứa Key + TID (địa chỉ vật lý).
- Sau khi tìm key, thường phải nhảy thêm sang Heap file để lấy data đầy đủ (trừ trường hợp Index Only Scan).

---

## 12. Index trong RAM — Buffer Pool

DB luôn cố nạp Index vào RAM để đạt tốc độ micro-giây.

- **Buffer Pool (MySQL) / Shared Buffers (PostgreSQL):** Mọi Page đọc từ đĩa đều vào đây.
- **Hot-spot luôn trong RAM:** Node Root và các tầng trên gần như không bao giờ bị đẩy ra khỏi RAM.
- **Quy tắc 80/20:** 20% dữ liệu (thường là Index) chiếm 80% tần suất truy cập. Đảm bảo 20% này nằm trong RAM là ưu tiên hàng đầu.
- **Cold Cache sau restart:** Sau khi khởi động lại DB, hệ thống chạy chậm. Cần thời gian "warm-up" để nạp lại Index quan trọng.

---

## 13. B+ Tree vs LSM Tree — Khi nào dùng cái nào?

| Tiêu chí | B+ Tree (RDBMS) | LSM Tree (NoSQL) |
|---|---|---|
| Tối ưu cho | Đọc / Truy vấn ngẫu nhiên | Ghi liên tục, tốc độ cao |
| Latency đọc | Thấp và ổn định O(log n) | Có thể cao (phải check nhiều SSTables) |
| Write Amplification | Cao (cập nhật Index ngay lập tức) | Thấp (ghi vào MemTable, merge sau) |
| Ví dụ | PostgreSQL, MySQL, Oracle | Cassandra, RocksDB, ScyllaDB |
| Phù hợp nhất | Giao dịch tài chính, ACID, truy vấn phức tạp | Logging, tracking, ingest dữ liệu cực lớn |

---

## 14. Lời khuyên thực tế

**Chọn kiểu dữ liệu cho Primary Key:**
- Dùng **BigInt tự tăng** hoặc **Sequential UUID** thay vì UUID v4 ngẫu nhiên.
- UUID v4 ngẫu nhiên khiến Page Split xảy ra liên tục ở vị trí bất kỳ trên cây → cây cao lên, hiệu năng giảm.
- Key tuần tự luôn được ghi vào cuối cây → ít Split nhất, fan-out cao nhất.

**Tóm tắt cốt lõi:**
- Bước 1 — Không có Data Pointer → node gầy hơn:
    -   B-Tree internal node: Key (8B) + Child Ptr (8B) + Data Ptr (12B) = 28 bytes mỗi entry.
B+ Tree internal node: Key (8B) + Child Ptr (8B) = 16 bytes mỗi entry.
    -   Data Pointer bị bỏ ra vì node trung gian không cần trả về record — nó chỉ điều hướng. 12 bytes tiết kiệm được trên mỗi entry nghe nhỏ, nhưng nhân với hàng trăm entry trong một page thì rất lớn.
-   Bước 2 — Node gầy hơn → nhét được nhiều entry hơn trong 1 page 8KB
    -   Page 8KB ÷ 28 bytes = 292 entry (B-Tree)
    -   Page 8KB ÷ 16 bytes = 512 entry (B+ Tree)
    -   Fan-out chính là số entry này — tức là từ 1 node trung gian có thể trỏ tới bao nhiêu node con.
-   Bước 3 — Fan-out cao hơn → mỗi tầng "phủ" được nhiều records hơn
    -   Đây là chỗ quan trọng nhất. Số records tối đa cây có thể chứa = fan-out ^ số tầng:
        -   B-Tree 3 tầng: 292³ ≈ 24 triệu records
        -   B+ Tree 3 tầng: 512³ ≈ 134 triệu records
    -   Muốn chứa 134 triệu records: B+ Tree cần 3 tầng, B-Tree cần 4–5 tầng.
-   Bước 4 — Ít tầng hơn → ít lần đọc Disk hơn mỗi query
Mỗi tầng = 1 lần đọc Disk (vì mỗi node là 1 page riêng trên đĩa). Tìm 1 record trong 134 triệu records: B+ Tree đọc Disk 3 lần, B-Tree đọc 4–5 lần. Mỗi lần đọc Disk ≈ 1ms → tiết kiệm 1–2ms mỗi query.

### B+ Tree nặng hơn B-Tree ở đâu?
Nặng hơn: Tổng số page trên đĩa (~5–15%): 
-   B+ Tree buộc 100% records xuống tầng lá — không có record nào được dừng ở tầng trung gian. B-Tree cho phép ~30% records dừng ở tầng giữa, nên tầng lá cần ít page hơn. Tổng cộng B+ Tree cần nhiều page hơn để chứa cùng lượng data.
-   100% records → tầng lá => nhiều leaf page hơn => tổng page trên đĩa lớn hơn.

### B+ Tree nhẹ hơn B-Tree ở đâu?
Nhẹ hơn: Số lần đọc Disk mỗi query (point lookup): 
-   Node trung gian không có Data Pointer → entry nhỏ hơn (16B vs 28B) → nhét được nhiều entry hơn trong 1 page 8KB → fan-out cao hơn (512 vs 292) → cùng lượng data, cây ít tầng hơn → mỗi query ít lần đọc Disk hơn.
-   bỏ Data Ptr => 16B/entry vs 28B => fan-out 512 vs 292 => cây lùn hơn 1–2 tầng => ít đọc Disk hơn.

Nhẹ hơn: I/O khi quét dải (range scan):
-   Tầng lá có linked list nối các page theo thứ tự. Tìm record đầu tiên 1 lần, sau đó đọc thẳng sang phải — sequential read. OS tự prefetch trang kế tiếp. B-Tree không có linked list, phải leo cây liên tục — mỗi bước leo là 1 lần đọc Disk random.
-   linked list ở tầng lá => sequential read => OS prefetch => không leo cây.

Nhẹ hơn: CPU — tầng trên nằm trong cache: 
-   Node trung gian B+ Tree rất nhỏ gọn → toàn bộ tầng 1 và tầng 2 của cây chứa hàng trăm triệu records nằm gọn trong vài MB RAM hoặc L3 Cache. Traversal từ root xuống gần tầng lá xảy ra hoàn toàn trong cache — nano-giây. Chỉ bước đọc leaf page cuối mới có nguy cơ xuống Disk.
-   node trung gian nhỏ => vừa L3 Cache => traversal = nano-giây => chỉ leaf mới xuống Disk.

Chuỗi logic ngắn nhất để nhớ:
-   Nặng hơn 1 thứ → tổng page trên đĩa, vì 100% records phải xuống lá.
-   Nhẹ hơn 3 thứ → số lần đọc Disk (cây lùn), I/O range scan (linked list), CPU traversal (tầng trên trong cache).
Trade-off rất rõ: hy sinh thêm ~10% dung lượng đĩa — thứ rẻ nhất trong hệ thống — để đổi lấy ít I/O và CPU hơn — thứ đắt nhất và quyết định latency thực tế.

*Tham khảo thêm:*
- *Modern B-Tree Techniques — Goetz Graefe*
- *PostgreSQL Internals: nbtree implementation*
- *The Lehman and Yao Algorithm for Concurrent Access*![alt text](image.png)