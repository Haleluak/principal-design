# Banking Transaction Challenges: Principal Interview Edition (PostgreSQL)

Tài liệu này tổng hợp các kịch bản thực tế khó nhất về giao dịch tài chính, dùng để đánh giá khả năng kiểm soát dữ liệu của một Principal Engineer.

---

## 1. Challenge: The "Lost Update" (Rút tiền đồng thời)
**Kịch bản:** Khách hàng có 100$ trong tài khoản. Họ thực hiện 2 lệnh rút tiền 80$ trên 2 ứng dụng khác nhau cùng một thời điểm.

### ❌ Vấn đề (Read Committed - Mặc định):
- **Tx 1**: `SELECT balance FROM acc WHERE id=1;` (Lấy được 100).
- **Tx 2**: `SELECT balance FROM acc WHERE id=1;` (Cũng lấy được 100 - vì Tx1 chưa commit).
- Cả 2 Tx đều thấy `100 > 80` nên cho phép rút.
- **Tx 1**: `UPDATE acc SET balance = 20 WHERE id=1; COMMIT;`
- **Tx 2**: `UPDATE acc SET balance = 20 WHERE id=1; COMMIT;` (Ghi đè kết quả của Tx1).
**Kết quả:** Khách hàng rút được 160$ nhưng tài khoản vẫn còn 20$. Hệ thống lỗ 80$.

### ✅ Giải pháp của Principal:
**Cách 1 (Atomic Update - Khuyên dùng):**
```sql
UPDATE accounts 
SET balance = balance - 80 
WHERE id = 1 AND balance >= 80;
```
Sau đó kiểm tra `Rows Affected`. Nếu trả về 0, báo lỗi không đủ tiền. Đây là cách hiệu quả nhất vì nó dựa vào Lock ngầm của lệnh UPDATE mà không cần nâng Isolation level.

**Cách 2 (Pessimistic Locking):**
```sql
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
-- Thực hiện logic kiểm tra bằng code Backend
UPDATE accounts SET balance = balance - 80 WHERE id = 1;
COMMIT;
```
`FOR UPDATE` sẽ áp đặt một **Exclusive Lock** lên dòng đó, buộc Tx 2 phải đứng chờ cho đến khi Tx 1 hoàn tất.

---

## 2. Challenge: The "Inconsistent Total" (Báo cáo lệch)
**Kịch bản:** Hệ thống kế toán đang cộng tổng số dư của 10 triệu tài khoản khách hàng để kiểm toán (mất 10 phút). Trong lúc đó, một khách hàng lớn chuyển 10 tỷ từ TK A sang TK B.

### ❌ Vấn đề:
- Job tính tổng đã cộng xong TK A (10 tỷ).
- Khách hàng chuyển tiền: A trừ 10 tỷ, B cộng 10 tỷ.
- Job tính tổng đi tới TK B và lại cộng thêm 10 tỷ vừa nhận được.
**Kết quả:** Tổng tiền hệ thống bị thừa ra 10 tỷ đồng trong báo cáo.

### ✅ Giải pháp của Principal:
- Sử dụng `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;`.
- **Giải thích Internals:** Postgres sẽ chụp một **Snapshot** duy nhất. Toàn bộ quá trình cộng 10 triệu tài khoản sẽ "nhìn" thấy thế giới đứng yên tại giây thứ nhất. Mọi giao dịch chuyển tiền xảy ra sau đó (dù đã commit) đều không lọt vào mắt của Job báo cáo này.
- **Lưu ý:** Điều này gây áp lực lên `VACUUM` vì nó phải giữ lại các phiên bản cũ (Dead Tuples) cho đến khi Job báo cáo kết thúc.

---

## 3. Challenge: Atomic Multi-Stage (Giao dịch liên ngân hàng)
**Kịch bản:** Bạn phải trừ tiền khách hàng trong Postgres, sau đó gọi sang dịch vụ của Ngân hàng khác (qua API) để cộng tiền cho họ.

### ❌ Vấn đề (The Transaction Trap):
Bạn không thể nhét API vào trong DB Transaction. 
- Nếu Commit xong mới gọi API -> DB trừ tiền rồi nhưng API lỗi -> Khách mất tiền.
- Nếu gọi API thành công rồi mới Commit DB -> API cộng tiền rồi nhưng DB bị lỗi Rollback -> Khách không bị trừ tiền.

### ✅ Giải pháp của Principal (Distributed Systems):
**Transactional Outbox Pattern:**
1. Trong cùng một DB Transaction: Trừ tiền khách hàng + Insert một "Nhiệm vụ gọi API" vào bảng `Outbox`.
2. DB Transaction Commit thành công (Đảm bảo tính Atomic nội bộ).
3. Một Worker (Relay Service) quét bảng `Outbox`, thực hiện gọi API ra bên ngoài.
4. Nếu API lỗi, Worker sẽ Retry theo cơ chế **Exponential Backoff**.
5. Đảm bảo tính nhất quán cuối cùng (**Eventual Consistency**).

---

## 4. Câu hỏi "Xoáy" khi phỏng vấn:
**Hỏi:** "Tại sao Postgres không dùng Shared Lock khi SELECT mặc định như các Database cổ điển khác?"
**Đáp:** Để đạt được hiệu năng cao nhất. Postgres dùng **MVCC**. Reader chỉ đọc phiên bản snapshot cũ nên không bao giờ phải chờ Writer (người đang giữ Exclusive lock trên dòng đó). Đây là lý do Postgres xử lý đồng thời cực tốt mà không bị treo hệ thống khi có nhiều người đọc.

**Hỏi:** "Khi dùng Repeatable Read, nếu 2 transaction cùng update 1 dòng thì chuyện gì xảy ra?"
**Đáp:** Xảy ra lỗi `Serialization Failure`. Transaction nào Commit sau sẽ bị văng lỗi. App phải có cơ chế **Retry logic**. Đây là bài toán đánh đổi giữa tính đúng đắn và hiệu năng.
