# Deep Dive: Quá Trình Đánh Chỉ Mục (B-Tree Indexing) Trong PostgreSQL

Tài liệu này giải đáp 3 câu hỏi cốt lõi: Khi bạn chạy `CREATE INDEX`, hệ thống làm gì bên dưới? Dữ liệu chui vào cây B-Tree ra sao? Và cái Index đó được cất giấu ở đâu trên ổ cứng?

---

## 1. Khi lệnh `CREATE INDEX` chạy, Index được lưu ở đâu?

Khác với MySQL (nơi Index và bảng thường gộp chung trong 1 file `.ibd`), kiến trúc của PostgreSQL tách biệt hoàn toàn ranh giới giữa **Bảng (Heap Data)** và **Chỉ Mục (Index)**.

### Vị trí vật lý trên đĩa cứng:
Khi bạn chạy `CREATE INDEX idx_users_age ON users(age);`
1. **File độc lập**: PostgreSQL tạo ra một file vật lý **hoàn toàn mới** trên đĩa cứng. 
2. **Đường dẫn**: Bạn có thể tìm thấy file này tại thư mục OID của database: `$PGDATA/base/<Database_OID>/<Index_Relfilenode>`.
3. Khác biệt với Heap: Bảng `users` cũng nằm ở một file riêng `Relfilenode` của nó.
`=> Tóm lại: Bảng là 1 file. Mỗi lần tạo thêm 1 Index là bạn đẻ thêm 1 file riêng biệt nằm cạnh file Bảng.`

### Vị trí Logic (pg_class):
Postgres coi Index cũng là một dạng "Table" (gọi chung là Relation). Metadata của Index này được lưu vào bảng hệ thống `pg_class` (bạn có thể `SELECT * FROM pg_class WHERE relname='idx_users_age'`).

---

## 2. Cách PostgreSQL thiết kế cây B-Tree (Khác biệt với Sách giáo khoa)

Postgres sử dụng biến thể **Lehman-Yao** của cây B-Tree. Cấu trúc của cây này được thiết kế để xử lý Concurrency (Nhiều người đọc/ghi cùng lúc) cực kỳ tốt.

Mỗi node của cây chính là một **Index Page (Mặc định 8KB)**.

### a. Cấu tạo của các Page trong File Index:
- **Page 0 (Meta Page)**: Luôn là trang đầu tiên của file Index. Nó chứa "Tọa độ" của trang Root (Ví dụ: `root=Page 3`).
- **Data Pages (Từ Page 1 trở đi)**: Gồm Root Node, Internal Nodes (Trung gian) và Leaf Nodes (Lá).

### b. Index Tuple (Dữ liệu bên trong Nút Lá)
Nếu bạn đánh Index cột `age`. Tại tầng Lá của cây B-Tree, mỗi phần tử (gọi là Index Tuple) trông như thế nào?
Nó lưu y xì 2 thứ: `[Key] + [TID (ItemPointer)]`.
- `Key`: Số 25 (Giá trị của tuổi).
- `TID`: `(Block 70, Offset 33)` - Tọa độ vật lý trỏ thẳng về dòng chứa tuổi 25 nằm trong cái file Heap của Bảng `users`.

---

## 3. Cách dữ liệu "chui" vào cây B-Tree khi INSERT

Giả sử bạn chạy lệnh: `INSERT INTO users (id, name, age) VALUES (1, 'Duc', 25);`

Dưới đây là chuỗi hành động ngậm (Execution Pipeline):

**Bước 1: Lưu dữ liệu thật vào "Đống" (Heap File)**
- Hệ thống tìm 1 Page trống trong file của bảng `users` (Ví dụ: Page 70).
- Nó ném dữ liệu `(1, 'Duc', 25)` vào đó. Page 70 trả về một con trỏ gọi là TID: `(70, 33)`.

**Bước 2: Nạp vào File Index (B-Tree)**
Bây giờ, Postgres phát hiện bảng này có 1 Index trên cột `age`. Nó phải chèn bộ đôi `(Key=25, TID=(70, 33))` vào cây B-Tree của file Index `idx_users_age`.

1. **Tìm kiếm (Traversing)**: Bắt đầu từ Meta Page (Page 0) -> Biết Root đang ở Page 3 -> Nhảy tới Page 3. 
2. So sánh và đi xuống các cảnh nhánh cho đến khi chạm được đúng cái **Leaf Page** chứa khoảng giá trị quanh vùng tuổi 25.
3. **Chèn (Insertion)**: Chèn cặp `(25, (70, 33))` vào Leaf Page đó. 
   - *Lưu ý:* Các tuple trong Index Leaf Page luôn được **sắp xếp theo thứ tự (Sorted)**. Nên Postgres phải tìm chỗ trống giữa tuổi 24 và tuổi 26 để nhét số 25 vào.

**Bước 3: Sự kiện Chẻ Đôi (Page Split)**
- Nếu cây B-Tree phát hiện Leaf Page đó đã đầy 8KB (Không còn chỗ chèn số 25):
  - Nó xin hệ điều hành cấp phát một **Page mới** ở cuối file Index (Ví dụ: Page 100).
  - Nó dời 50% dữ liệu từ Page cũ sang Page 100.
  - Sau đó báo cáo lên Parent Node (Sếp của nó): "Ê sếp, tôi vừa sinh nhánh mới (Page 100), những ai tuổi > 25 thì điều hướng sang Page 100 nhé!". Parent Node cập nhật con trỏ.
  - Đây chính là cách cây phình to và cao lên.

---

## 4. Tại sao lại là Lehman-Yao B-Tree? (Góc nhìn Chuyên gia)

Khi Page Split xảy ra (như Bước 3), cấu trúc cây bị biến động. Nếu một user khác đang `SELECT` chạy ngang qua chỗ Split thì sao?

Trong các B-Tree cổ điển, hệ thống phải **Lock Exclusive (Khóa chết)** toàn bộ nhánh cây đó, khiến người đọc phải đứng chờ (Write blocks Read).

Nhưng Postgres với **Lehman-Yao B-Tree** có 1 tuyệt kỹ: **Right-Link (Liên kết phải)**.
- Khi Page A bị chẻ làm đôi sinh ra Page B. Page A thay vì bị khóa, nó được thêm 1 con trỏ mũi tên trỏ sang Page B (Right-Link).
- Nếu User đang `SELECT` trên Page A mà tìm không thấy dữ liệu (Vì dữ liệu vừa bị dạt sang Page B do Split), bộ máy sẽ âm thầm đi theo cái Right-Link đó lùa sang Page B để tìm tiếp.
- `=> Kết luận: Quá trình Chẻ đôi cây B-Tree trong Postgres KHÔNG HỀ chặn quá trình Đọc (Read concurrent without locking).`

---

## Tóm lại (High-Level Summary for Principal):
1. **Lưu ở đâu?** Mỗi Index là một File vật lý riêng lẻ (Relation), độc lập với file Bảng (Heap). Lưu tại thư mục của Database.
2. **Cấu tạo B-Tree?** Page 0 lưu Meta (chứa Root ID). Các Leaf Pages lưu cặp `(Key, TID)`. Nơi TID là mỏ neo trỏ về file Heap.
3. **Chèn thế nào?** Ghi dữ liệu vào Heap trước -> Lấy TID -> Duyệt từ Root xuống Leaf của B-Tree -> Nhét cặp `(Key, TID)` vào Leaf theo đúng thứ tự lớn nhỏ -> Thiếu chỗ thì chẻ đôi Page (Split) qua cơ chế Lehman-Yao không gây nghẽn Lock.
