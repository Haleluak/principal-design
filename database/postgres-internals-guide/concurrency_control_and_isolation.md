# Khóa (Locks), MVCC và Tính Cô Lập (Isolation) trong PostgreSQL

Để làm chủ hệ thống High-Concurrency (Truy cập đồng thời cao) trên PostgreSQL, một Principal Engineer phải hiểu rõ 3 mảnh ghép: Cơ chế Khóa cổ điển sinh ra vấn đề gì -> MVCC giải quyết nó ra sao -> và hệ quả của MVCC tạo ra các mức độ Isolation như thế nào. Cuối cùng, khi MVCC "chào thua", ta phải dùng lại Khóa (Row-lock/Advisory Lock) như thế nào.

---

## PHẦN 1: TỪ CLASSIC LOCKS ĐẾN MVCC

### 1.1 Tính Toàn Vẹn Dữ Liệu và Cơ chế Khóa Cổ Điển
Ngày xưa, các Database sử dụng 2 loại khóa cơ bản để bảo vệ dữ liệu:
- **Shared Lock (Khóa Chia Sẻ - Cho Phép Đọc)**: Khi Gấu đọc tài khoản, Gấu xin Shared Lock. Gấu ngầm tuyên bố: "Ai muốn đọc chung thì vào, nhưng cấm ai được sửa dữ liệu này cho đến khi tôi đọc xong".
- **Exclusive Lock (Khóa Độc Quyền - Cho Phép Ghi)**: Khi Rùa muốn chuyển tiền cho Thỏ (sửa dữ liệu), Rùa phải xin Exclusive Lock. Luật là: Đã khóa độc quyền thì cấm tất cả mọi người (kể cả người đọc) xen vào.

**Nút thắt cổ chai:**
Trường hợp Rùa muốn sửa dữ liệu của Thỏ, nhưng Thỏ đang cầm `Shared Lock` để kiểm tra số dư. Rùa xin `Exclusive Lock` thất bại và phải đứng chờ (Wait) cho đến khi Thỏ đọc xong.
`=> Hậu quả: Read blocks Write (Đang đọc thì cấm ghi) và Write blocks Read (Đang ghi thì cấm đọc). Performance cực kỳ tệ.`

### 1.2 Giải Pháp: MVCC (Multi-Version Concurrency Control)
Để giải quyết việc Read và Write chặn nhau, tư duy đột phá ra đời: "Vì sao không tạo ra 2 bản ghi? Bản A cho người đọc, Bản B cho người ghi?". Mọi người không ai cản ai.

**Cách các ông lớn thực thi MVCC:**
1. **Oracle/MySQL**: Chỉ giữ bản mới nhất trong Bảng chính. Các bản cũ bị tống vào kho lưu trữ phụ gọi là **Undo Log**. Khi cần đọc dữ liệu cũ, hệ thống phải tốn CPU "tua ngược" các lệnh để dựng lại bản cũ cho bạn xem.
2. **PostgreSQL**: Cả bản cũ và bản mới đều nằm chung trong cùng 1 Bảng chính. Postgres thêm 2 cột ẩn vào mọi dòng dữ liệu:
   - `xmin`: ID Giao dịch (TxID) đã TẠO RA dòng này.
   - `xmax`: ID Giao dịch (TxID) đã XÓA/UPDATE dòng này (mặc định = 0).

Nhờ vậy, khi lệnh `UPDATE` chạy, Postgres không sửa đè lên dòng cũ, nó chỉ đánh dấu `xmax` của dòng cũ, và tạo ra một dòng mới toanh với `xmin` mới. Lịch sử được lưu trữ hoàn hảo.
*Nhược điểm của Postgres*: Cần một người thợ dọn rác đi hốt các phiên bản cũ đã "chết". Đó là lý do **Autovacuum** ra đời.

---

## PHẦN 2: MVP QUYẾT ĐỊNH TRANSACTION ISOLATION

Bởi vì Postgres lưu mọi phiên bản lịch sử (MVCC), hệ thống đối mặt với câu hỏi: "Khi tôi `SELECT`, tôi được phép NHÌN THẤY những phiên bản nào?". Điều này quyết định mức độ **Isolation Level**.

### Cơ Chế Lõi: CLOG và Visibility (Sự Hiển Thị)
Postgres có một cuốn sổ tay nhỏ trên RAM gọi là `CLOG` (Commit Log), chỉ chứa 2 trạng thái của các lệnh: `IN_PROGRESS` (Đang chạy) và `COMMITTED` (Đã chốt). Bất cứ dòng dữ liệu nào có `xmin` (Kẻ tạo ra nó) đang `IN_PROGRESS` trong sổ CLOG sẽ bị Engine của Postgres (Hàm `t_qual.c`) coi là TÀNG HÌNH.

### 2.1 Read Uncommitted (Cú lừa của Postgres)
- **Chuẩn SQL**: Cho phép Dirty Read (Đọc dữ liệu của người khác dẫu họ chưa COMMIT).
- **Postgres**: KHÔNG BAO GIỜ CHO PHÉP. Nếu bạn set level này, Postgres tự ép nó thành `Read Committed`. 
- **Lý do nội tại**: Engine của Postgres được thiết kế cứng để gạt bỏ mọi dòng `IN_PROGRESS` (bóng ma). Nó không có hàm code C nào để bypass qua luật này, vì làm vậy sẽ phá nát kiến trúc Snapshot vật lý.

### 2.2 Read Committed (Default Level)
- **Đặc điểm**: Mỗi câu lệnh `SELECT` của bạn sẽ lấy một **Snapshot Mới** về trạng thái của Database.
- ** Pros (Ưu điểm)**: Cực kỳ nhanh, hầu như không bị block, hiếm khi văng lỗi đòi phải Retry giao dịch. Không chiếm memory dọn rác quá lâu.
- ** Cons (Nhược điểm)**: Bị **Non-repeatable Read**. Giao dịch A đọc số dư buổi sáng ra 100$. Buổi chiều nó đọc lại ra 200$ (do Giao dịch B vừa Update xong xen vào giữa). Dữ liệu nhảy nhót giữa các bước.
- ** Use Case Thực tế**: 
  - **90% ứng dụng Web CRUD**: Lấy danh sách sản phẩm, cập nhật Profile user, thêm vào giỏ hàng. Tại các hệ thống này, sự chính xác tuyệt đối trên cùng 1 transaction trong vài giây là không cần thiết, người ta cần Speed (Tốc độ). 

### 2.3 Repeatable Read (Nhất Quán Thống Kê)
- **Đặc điểm**: Bắt đầu Giao dịch, Postgres "đóng băng" thời gian. Dùng **Duy Nhất Một Snapshot** cho mọi lệnh `SELECT` ở dưới.
- ** Pros (Ưu điểm)**: 
  - Đảm bảo dữ liệu Đọc tĩnh 100%. Bảo vệ được Non-repeatable Read và cả **Phantom Read** (Tính năng ăn tiền của MVCC Postgres so với MySQL).
- ** Cons (Nhược điểm)**: 
  - Khi có tranh chấp Ghi (2 người cùng Update), 1 người sẽ ăn lỗi `Serialization Failure` và App bị chết Transaction, buộc Developer phải viết vòng lặp `Try/Catch Retry`.
  - Vacuum không thể dọn dẹp các Dead Tuples sinh ra trong lúc transaction này đang chạy -> Tốn ổ cứng (Bloat) nếu transaction kéo dài quá lâu ngâm bảng.
- ** Use Case Thực tế**: 
  - **Cronjob Báo Cáo Kế Toán Cuối Tháng**: Cần đọc 10 triệu User để tính tổng tiền. Nếu đang chạy mà có ai chuyển khoản thì bỏ qua, chỉ tính tiền dựa trên tệp chốt lúc 12h đêm.
  - **Logical Backup (pg_dump)**: Để đảm bảo file backup nhất quán không bị thủng chỗ nọ hụt chỗ kia do thay đổi từ bên ngoài.

### 2.4 Edge Cases: Khi MVCC "Trật Bánh" (Phân tích cho Principal)
**A. Lỗi Serialize Failure (Concurrent Update)**
Nếu bạn dùng `Repeatable Read` và cả 2 Giao dịch cùng `UPDATE` một dòng:
- A Update trước (Đứng yên chờ B).
- B Update sau.
Khi A Commit, B sẽ văng lỗi cái rầm: `ERROR: could not serialize access due to concurrent update`.
=> **Bài học**: Dùng Read Committed + Lock (Bên dưới) sẽ tốt hơn, hoặc bắt buộc phải viết code **Retry Logic (Thử lại)** ở Backend.

**B. Lỗi Write Skew (Bác sĩ trực đêm)**
Bệnh viện có 2 bác sĩ trực. Luật: Luôn phải có ít nhất 1 người trực. Bác sĩ A và B cùng lúc xin nghỉ.
Ở mức `Repeatable Read`, cả A và B đều đếm thấy "Đang có 2 người trực" -> Cả hai thỏa mãn điều kiện xin nghỉ -> Cùng `UPDATE` trạng thái của bản thân thành nghỉ -> **COMMIT**. Kết quả: Bệnh viện không còn ai trực!
=> **Bài học**: Repeatable Read không đủ độ cô lập cho bài toán có quan hệ chéo. Phải dùng `SERIALIZABLE` để Postgres kiểm tra dependency và chém chết 1 giao dịch.

---

## PHẦN 3: KHI MVCC KHÔNG ĐỦ, TA QUAY LẠI VỚI LOCK

Dù siêu phàm, Snapshot Isolation không thể khóa một dòng để đảm bảo không ai đụng vào nó cho đến khi ta tính toán xong. Lúc này, hệ thống Lock tinh vi của Postgres phải ra tay, nhưng thông minh hơn nhiều thời Cổ điển.

### 3.1 Table-Level Locks (Khóa bảng - Ý Định)
Dù bạn mượn khóa cấp dòng, Postgres vẫn phải giữ một khóa "Ý định" cấp bảng để cấm các câu lệnh thay đổi cấu trúc bảng.
- **Lưu ý tử huyệt**: Lệnh `ALTER TABLE` (Thêm cột, Xóa cột) sẽ xin một `ACCESS EXCLUSIVE LOCK`. Nó chém đứt mọi câu `SELECT`, `UPDATE` trên bảng đó. **Tuyệt đối không chạy ALTER TABLE giờ cao điểm!**

### 3.2 Row-Level Locks (Khóa Cấp Dòng)
Thay vì chém văng lỗi như `Repeatable Read` khi xung đột xảy ra, Khóa cấp dòng là công cụ **Pessimistic Locking (Khóa bi quan)** bắt kẻ đến sau phải đứng chờ kẻ đến trước.

**A. SELECT ... FOR UPDATE (Khóa Độc Quyền)**
- ** Pros**: Chống 100% lỗi **Lost Update** (2 người cùng trừ tiền). Cực kỳ an toàn cho mạch logic. Rất nhẹ cho ổ cứng Postgres vì cờ khóa được nhét thẳng vào cột `xmax` của row.
- ** Cons**: Kẻ đến sau bị `BLOCK` (treo code). Nếu không cẩn thận sẽ sập Connection Pool vì các request thi nhau đứng đợi nhả khóa.
- ** Use Case Thực tế (Bài toán Trừ Tiền ví/Tồn Kho)**: 
  - **Case**: User thanh toán đơn hàng. Cần ktra số dư và trừ tiền.
  - Khóa: `SELECT balance FROM wallet WHERE id = 1 FOR UPDATE;`
  - Nếu A đang tính tiền, B bấm thanh toán đồng thời thì B sẽ bắt buộc bị treo (Spinner loading) trên App cho đến khi A tính xong mới được cấp khóa để xử lý.

**B. SELECT ... FOR SHARE (Khóa Chia Sẻ)**
- ** Pros**: Cho phép hàng nghìn hệ thống khác cùng đọc đồng thời mà không nghẽn. Rất tốt cho kiểm tra tham chiếu (Foreign Key checks).
- ** Cons**: Cấm tiệt mọi hoạt động `UPDATE/DELETE` từ các nguồn khác lên dòng đó. Rất dễ dính Deadlock nếu nâng cấp khóa (`FOR SHARE` xong lại đòi `UPDATE`).
- ** Use Case Thực tế**: 
  - **Case Tín Dung:** Nhân viên A xem hồ sơ User để duyệt vay mượn (`FOR SHARE`). Bất kỳ chi nhánh nào khác cũng có thể vô xem chung. TUY NHIÊN, khóa này cấm triệt để User tự nhấn nút Xoá Profile hoặc Chỉnh sửa Thông tin lương của mình qua App lúc đó. Chừng nào nhân viên đóng hồ sơ, User mới được sửa.

### 3.3 Bài Toán Ác Mộng: Deadlock (Khóa Chéo)
- **Kịch bản**: Ông A khóa Row 1, xin khóa Row 2. Ông B khóa Row 2, xin khóa Row 1. Hai ông chờ nhau đến vô tận. Postgres có Radar quét mỗi giây và sẽ hủy diệt 1 ông.
- **Nghệ thuật giải quyết**: Lập trình viên phải có kỷ luật **Global Lock Ordering**. Ví dụ: Lấy mảng ID người dùng, Sắp xếp (Sort Order) tăng dần `1, 2, 5, 8` rồi mới chạy vòng lặp bắn lệnh `FOR UPDATE`. Lỗi Deadlock sẽ vĩnh viễn không bao giờ xuất hiện.

### 3.4 Vũ Khí Tối Thượng: Advisory Locks (Khóa Ứng Dụng)
Khóa logic nằm hoàn toàn trên RAM (Shared Memory) của Postgres. Nó KHÔNG khóa Table, KHÔNG khóa Row. Nó khóa **Một con số Integer (ID ID ID)** do bạn bịa ra.

- ** Pros**: Siêu lẹ, siêu nhẹ. Bypass hoàn toàn cái lề mề của Object Locks trên HDD. Nó tự động giải phóng khóa ngay khi mất Session kết nối (Đứt mạng) -> Không bao giờ lo bị kẹt khóa vĩnh viễn. Đỡ tốn tiền dựng Server Redis.
- ** Cons**: Khóa vô tri. Data của bạn vẫn hoàn toàn có thể bị `UPDATE` bằng lệnh SQL bình thường (vì DB đâu có biết bạn đang khóa logic bằng code Backend). Chỉ dùng cho việc đồng bộ tiến trình (Process Syncing).
- ** Use Case Thực tế (Rate Limiting hoặc Job Leader Election)**: 
  - **Case Cronjob**: Bạn chạy 5 Container Backend giống hệt nhau. Cứ đến 12h đêm nổ function "Gửi SMS đòi nợ". Nếu cả 5 nổ cùng lúc -> Khách nhận 5 tin nhắn chửi.
  - **Cách làm**:
  ```sql
  -- Truyền mã logic 12345 (ví dụ ID của lệnh SMS)
  SELECT pg_try_advisory_lock(12345);
  ```
  - **Kết quả**: Container số 1 gọi lệnh này cực nhanh sẽ nhận `TRUE`. Nó vui vẻ đi gửi tin nhắn. Thằng số 2 vác request tới sau 1 micro-second, nó gọi lệnh thì nhận `FALSE`. Nó hiểu là "thằng khác đang làm rồi, mình bỏ chạy return luôn". Hoàn hảo!
