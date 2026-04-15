# Cẩm nang Chuyên sâu PostgreSQL cho Principal Engineer

Tài liệu này tổng hợp lại các kiến trúc cốt lõi của PostgreSQL từ các tài liệu rải rác trước đây, tập trung mạnh vào góc nhìn của Postgres (Heap files, MVCC, Indexing, Vacuuming).

*Lưu ý: PostgreSQL khác biệt rất nhiều so với kiến trúc Clustered Index của MySQL (InnoDB) hay SQL Server.*

---

## 1. Kiến trúc Lưu trữ: "Heap" và "Bản đồ" (Storage Architecture)

Trong Postgres, dữ liệu bảng không được sắp xếp theo thẻ (không có Clustered Index thực sự). Kiến trúc này được gọi là "Heap".

### 1.1 Khái niệm CTID (Item Pointer)
Mọi dòng dữ liệu (Tuple) trong Postgres đều được định vị bằng **CTID**. 
- **CTID Format**: `(BlockNumber, OffsetNumber)`
- **BlockNumber**: Số thứ tự của Page (còn gọi là Block, mặc định 8KB) trong file dữ liệu vật lý (Heap file). Page số 0, 1, 2...
- **OffsetNumber**: Chỉ mục bên trong *Line Pointer Array* của cái Page đó (xem mục 1.2). Nó cho biết dòng dữ liệu thực tế bắt đầu từ byte nào trong Page bằng cách đọc con trỏ tại vị trí `Offset`.

*Ví dụ: `(70, 33)` nghĩa là dòng dữ liệu nằm ở Page thứ 70 của file, và vị trí của nó được chỉ điểm bởi cái Item Pointer (Line pointer) số 33 trong Page đó.*

**Tại sao CTID quan trọng?** 
Tất cả các loại Index (B-Tree, GiST, GIN, BRIN) trong Postgres đều không lưu trực tiếp dữ liệu. Ở tầng lá (Leaf Node) của Index, nó lưu giá trị Key + CTID. Khi truy vấn tìm thấy Key gán, nó lấy CTID đi nhảy sang file Heap để bốc dữ liệu lên.

### 1.2 Cấu trúc vật lý của 1 Page (Heap Page Layout)
Page trong Postgres mặc định là **8KB** (8192 bytes). Cấu trúc của nó "ghi từ hai đầu" để tận dụng không gian:

1.  **PageHeaderData (24 bytes)**: Lưu số liệu của page (LSN - Log Sequence Number để phục hồi, số lượng Line Pointers hiện có, khoảng trống...).
2.  **ItemIdData Array (Line Pointers)**: Mảng các con trỏ (mỗi cái 4 bytes). Ghi từ *trên xuống dưới*, nối tiếp ngay sau Header. Nó lưu một khoảng bù (offset) tính từ đầu Page trỏ tới vị trí của cái Tuple thực sự.
3.  **Free Space (Unallocated Space)**: Khoảng trống nằm giữa Line Pointers và Tuples.
4.  **Items (Tuples/Dữ liệu thực)**: Ghi từ *dưới lên trên*. 

```text
    +-------------------------------------------------------------+
    | PageHeaderData (24 bytes)                                   |
    +-------------------------------------------------------------+
    | LinePointer 1 | LinePointer 2 | LinePointer 3 | ...         | (Ghi xuôi)
    +-------------------------------------------------------------+
    |                        FREE SPACE                           |
    |                                                             |
    +-------------------------------------------------------------+
    | ... | Tuple 3                      | Tuple 2                | (Ghi ngược)
    +-------------------------------------------------------------+
    | Tuple 1                                                     |
    +-------------------------------------------------------------+
```

### 1.3 Quy trình chèn dữ liệu (INSERT)
- Hệ thống tìm một Page có đủ `Free Space` (sử dụng *Free Space Map - FSM* để tìm nhanh).
- Dữ liệu thô của Tuple được ghi vào khoảng trống ở *phần cuối* (từ chiều bottom-up).
- Một `LinePointer` mới được tạo ở mảng đầu (từ chiều top-down), trỏ tới byte bắt đầu của cái Tuple vừa ghi.
- CTID `(Block, Offset)` được trả về để sau đó ghi vào các file Index.

---

## 2. Kiến trúc Index trong PostgreSQL (B-Tree Indexing)

Postgres sử dụng biến thể của thuật toán Lehman-Yao cao cấp, hỗ trợ High Concurrency.

### 2.1 Cấu trúc Page của B-Tree Index (Meta Page & Root)
Khác với MySQL có thể Root mặc định ở Page 3, cấu trúc Index file của Postgres:

1.  **Page 0 (Meta Page)**: Bắt buộc và luôn nằm đầu tiên. Chứa Magic Number (nhận diện B-Tree) và **Page ID của Root hiện tại**.
2.  **Page 1 (Thường là Root ban đầu)**: Khi Root bị split và cây cao lên, một Page mới (VD: Page 100) sẽ trở thành Root. Meta Page sẽ lập tức cập nhật `Root: Page 100`.
3.  **Movable Root (Căn bản khác biệt)**: Postgres cho phép Root thay đổi Page ID liên tục để khóa/mở khóa hiệu quả thao tác (Lock management) mà không làm tắc nghẽn toàn bộ thao tác read/write. Điều này giải quyết bài toán Concurrent access cực tốt trong môi trường lock-free.

### 2.2 Các thao tác Insert Index
Khi thực thi `CREATE INDEX` hoặc chèn record mới:
1. Giá trị của cột index (Key) + CTID của dòng đó bên table được ghép lại thành bộ chỉ mục `(Key, CTID)`.
2. Postgres sẽ thực hiện duyệt từ Meta Page -> Root Page -> Các Level trung gian -> Leaf Page để tìm vị trí thích hợp chèn `(Key, CTID)`.
3. **Index Page Split**: Khi một Leaf node của index bị đầy, Postgres sẽ *split* (chẻ) node đó, di chuyển 50% index sang page mới mới và đẩy phân vùng ranh giới (boundary key) lên parent node.

---

## 3. Quản lý Đồng thời bằng MVCC & Vai trò của Vacuum

Kiến trúc Heap (lưu lẫn lộn, thay vì sắp xếp đè lên nhau như Clustered index) chính là mảnh đất màu mỡ cho tính năng cực mạnh của Postgres: **MVCC (Multi-Version Concurrency Control)**.

### 3.1 Vấn đề của MVCC
Mục đích: **"Reader never blocks Writer, Writer never blocks Reader"**.
Mỗi khi Postgres có một lệnh `UPDATE`, nó *khuyên không bao giờ* sửa đè lên dòng hiện tại (để những transaction đang đọc bản hiện tại không bị ảnh hưởng).

Thay vì ghi đè, `UPDATE` trong Postgres thực chất là sự kết hợp của `DELETE` (đánh dấu dòng cũ chết) và `INSERT` (tạo một dòng mới toanh ở vị trí / page khác).

### 3.2 Xmin và Xmax (Đánh dấu lịch sử)
Mỗi dòng (Tuple Header) trong Postgres có 2 hidden columns (Cột ẩn): `xmin` (Transaction Id của người tạo) và `xmax` (Transaction Id của người update/xóa).

- **Khi INSERT**: Dòng được ghi, `xmin` = TxID (VD: 100), `xmax` = 0.
- **Khi UPDATE**: 
  - Đánh dấu phiên bản cũ: Sửa `xmax` của dòng cũ = TxID mới (VD: 101) => Nó biến thành **Dead Tuple**.
  - Rải phiên bản mới: Insert dòng mới, `xmin` = 101, `xmax` = 0.

### 3.3 Hậu quả: Hội chứng Phình to (Bloat) & Sự cần thiết của VACUUM
Vì các `UPDATE`/`DELETE` liên tục sinh ra **Dead Tuples** còn nằm chình ình trong database, ổ cứng (Heap file) và các thẻ Index file sẽ phình to khủng khiếp.

Và đây là lí do **VACUUM** được sinh ra (Và tiến trình Autovacuum thầm lặng chạy ngầm):
- **Nghiệm vụ**: Quét toàn bộ hệ thống, tìm các dòng có `xmax` mà transaction đó đã kết thúc từ lâu.
- **Thu dọn**: Dọn sạch phần `Tuple` và giải phóng vùng không gian đó cho cờ tướng `Free Space Map` để các lệnh INSERT sau có thể sử dụng lại vùng nhớ đó. `Line Pointer` của Dead Tuple sẽ được đánh dấu bằng trạng thái `LP_DEAD` và sau đó được tái sử dụng.
- **VACUUM FULL**: rebuild lại toàn bộ table thành một file mới, chỉ chứa live tuples, xếp chặt lại từ đầu. File mới nhỏ hơn, space thật sự trả về OS. Nhưng đổi lại nó phải lock table suốt quá trình — không ai đọc/ghi được.
- **VACUUM thường**: VACUUM thường chỉ đánh dấu slot của dead tuple là "free space" — tức là xóa nội dung bên trong tuple đó, nhưng không thu nhỏ file. Page vẫn giữ nguyên kích thước 8KB, OS vẫn thấy file to như cũ. Space trống đó được tái sử dụng cho INSERT/UPDATE tiếp theo.

### 3.4 Giới hạn TxID (Transaction ID Wraparound)
Cột `xmin/xmax` dùng số nguyên 32-bit (chịu được ~4 tỉ Transaction ID). Khi đạt con số đó, `TxID` sẽ cuộn (Wrap) vòng về 0. Khiến các phiên bản từ 4 tỉ năm trước bỗng dưng... "sinh ra ngày hôm qua" (ở tương lai).
-> Autovacuum ngăn chặn bằng thao tác `Freeze` (Đóng băng): Nó đổi các TxID thành 1 giá trị đặc biệt "Cổ xưa nhất luôn luôn đúng" (FrozenXID = 2) khi Tuple đó đã tồn tại qua một thời gian dài nhằm chống cuộn ID.

---
## Tóm Lược Tư Duy Cho Principal PostgreSQL: 
1. **Kiến Trúc Tách Rời**: "Data là đống tạp nham, Index mới là trật tự". Đừng mong ID của Data chèn vào có thứ tự giống MySQL.
2. **Cảnh Gíác Bloat**: Thường xuyên theo dõi Dead Tuples nếu bảng chạy `UPDATE/DELETE` quá nặng. Phải cấu hình Tuning biến số của AutoVacuum (`autovacuum_vacuum_scale_factor`, v.v..) không để database phình to không phục hồi được.
3. **Ưu điểm Cập nhật Index**: Hệ cơ chế cực nhẹ (HOT: Heap Only Tuple) của Postgres sẽ giúp quá trình `UPDATE` những cột KHÔNG thuộc INDEX trở nên siêu nhanh, vì nó nhảy nhót phiên bản MVCC trong cùng 1 Page 8KB mà *không làm phiền một chút nào đến Index File kia*.
