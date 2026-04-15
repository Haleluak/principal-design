# PostgreSQL Internals: Replication, CDC & Transaction Conflicts

Khi hệ thống phình to từ 1 Node duy nhất sang mô hình Master-Replica (Cụm Read/Write), một Principal Engineer phải đối mặt với bài toán "Xung độtSnapshot trên máy phụ".

---

## 1. Mặc định: Read Committed & Sự thông thoáng
PostgreSQL mặc định sử dụng `Read Committed`. 
- Trong nội tại một Node đơn lẻ: Reader (Đọc) không bao giờ lock Writer (Ghi) nhờ Snapshot MVCC.
- **Tuy nhiên**, khi Streaming Replication (truyền file WAL) diễn ra, khái niệm Snapshot bắt đầu bị thử thách.

---

## 2. Replication Conflicts: Cuộc chiến giữa Recovery và Query

Khi bạn có một bản Replica (Read-only standby) để chạy báo cáo:

### Kịch bản xung đột (Snapshot Conflict):
1. **Tại Master**: Một bản ghi bị `DELETE` và sau đó `VACUUM` dọn dẹp sạch sẽ vì không còn transaction nào dùng nó. Master ghi lệnh "Dọn dẹp vật lý" này vào WAL (Write Ahead Log).
2. **Tại Master**: Gửi cái WAL này sang Replica.
3. **Tại Replica**: Đang có một User chạy báo cáo `REPEATABLE READ` lấy Snapshot từ 10 phút trước. User này **vẫn cần** bản ghi vừa bị dọn dẹp kia.
4. **Xung đột**: 
   - Quy tắc Master: "Phải dọn ngay để tiết kiệm đĩa".
   - Quy tắc Replica: "Phải giữ lại cho User đọc báo cáo".

### Kết quả:
Nếu Replica không thể giải quyết thỏa hiệp, nó sẽ trả về lỗi kinh điển:
`ERROR: canceling statement due to conflict with recovery`
(Tức là Postgres đã "chém chết" câu Query của User để ưu tiên việc đồng bộ dữ liệu từ Master sang).

---

## 3. Tối ưu hóa (Principal Tuning)

Để xử lý bài toán trên, bạn có 2 vũ khí chính:

### a. `max_standby_streaming_delay`
- **Ý nghĩa**: "Này máy phụ, nếu có xung đột, hãy đứng chờ tối đa 30s (ví dụ) cho User đọc xong rồi hẵng chém!".
- **Hệ quả**: Nếu set quá cao, Replica sẽ bị **Lag** (Dữ liệu trên máy phụ bị cũ so với máy chính).

### b. `hot_standby_feedback` (Tuyệt đỉnh võ công)
- **Cơ chế**: Máy Replica sẽ gửi một tín hiệu ngược về Master: "Đừng Vacuum dòng này, tôi đang có người đọc báo cáo!".
- **Ưu điểm**: Khắc phục triệt để lỗi `cancel statement`.
- **Nhược điểm (Principal phải biết)**: Nếu User trên Replica treo một query 1 tiếng đồng hồ, Master sẽ **không thể Vacuum** dòng đó trên file chính. Table trên Master sẽ bị **BLÓAT (Phình to)** khủng khiếp.

---

## 4. CDC (Change Data Capture) & Logical Replication

CDC (như Debezium dùng cho Microservices) hoạt động ở tầng **Logical**.

- **Level áp dụng**: CDC đọc từ WAL. Vì WAL chỉ ghi những transaction **đã COMMIT**, nên CDC mặc định hoạt động ở mức độ tin cậy tuyệt đối (Read Committed của những dữ liệu đã chốt hạ).
- **Slot Replication**: Postgres tạo ra các "Slot" để giữ chân file WAL. Nếu CDC của bạn bị sập, Postgres sẽ **giữ lại file WAL đó mãi mãi** (không xóa) cho đến khi CDC quay lại đọc. 
- **Rủi ro**: Nếu CDC sập quá lâu, ổ cứng chứa WAL của Master sẽ bị **Full disk** và làm sập toàn bộ hệ thống Database chính. 

---

## Tóm lược cho Principal:
1. **CDC** luôn dựa trên dữ liệu đã Commit (Logical).
2. **Replica** vật lý sẽ bị xung đột Snapshot nếu Master tích cực dọn rác (Vacuum).
3. Luôn cân nhắc `hot_standby_feedback` giữa việc "Dữ liệu máy phụ nhất quán" vs "Ổ cứng máy chính bị đầy (Bloat)".
