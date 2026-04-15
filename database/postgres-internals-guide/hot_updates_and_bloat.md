# POSTGRESQL HOT UPDATES: Tuyệt đỉnh tối ưu hiệu năng Ghi

Tại sao cùng một lượng dữ liệu, PostgreSQL đôi khi `UPDATE` nhanh gấp 10 lần hệ thống khác? Câu trả lời chính là **HOT (Heap Only Tuple)**. Đây là kỹ thuật sinh ra để khắc phục nhược điểm lớn nhất của MVCC.

---

## 1. Nỗi đau mang tên "Index Bloat"
Vì cơ chế MVCC, lệnh `UPDATE` thực chất là `DELETE + INSERT`. 
- **Nếu không có HOT**: Mỗi lần `UPDATE`, địa chỉ vật lý (CTID) của dòng dữ liệu bị thay đổi. Postgres buộc phải cập nhật lại địa chỉ mới này vào **TẤT CẢ** các file Index (`.index`) của bảng đó.
- Bảng càng nhiều Index, lệnh `UPDATE` càng chậm vì tốn chi phí Disk I/O để ghi vào các file Index.

---

## 2. Cách HOT vận hành (The Redirect Trick)

Nếu bạn cập nhật một cột (Ví dụ: `age`) mà cột này **không nằm trong bất kỳ Index nào**, và trong Page 8KB hiện tại vẫn còn chỗ trống:

1. **Tuple V1 (Cũ)**: Line Pointer #1 -> Tọa độ vật lý của bản ghi cũ.
2. **Tuple V2 (Mới)**: Được chèn vào ngay trong cùng một Page 8KB với V1.
3. **Redirect**: Line Pointer #1 được đổi trạng thái thành **REDIRECT**, trỏ trực tiếp sang Tuple V2.
4. **Index Files**: Hệ thống **KHÔNG CẦN** cập nhật các file Index. Các Index vẫn cứ trỏ về Line Pointer #1. 

`=> Khi User tìm kiếm qua Index, Postgres nhảy tới Line Pointer #1, thấy biển chỉ đường sang V2 và lấy dữ liệu mới nhất. Toàn bộ quá trình cực kỳ nhẹ nhàng.`

---

## 3. Tuyệt chiêu của Principal: Tuning `FILLFACTOR`

Mặc định `FILLFACTOR = 100` (Postgres sẽ cố nhét dữ liệu đầy kịt Page để tiết kiệm đĩa). Nhưng nếu bảng của bạn có tần suất `UPDATE` cực cao, đây lại là "gậy ông đập lưng ông" vì không còn chỗ cho HOT diễn kịch.

- **Lời khuyên**: Với bảng High-Update, hãy set `FILLFACTOR = 80` hoặc `90`.
- **Lợi ích**: Postgres sẽ bớt lại 10-20% không gian trống trong mỗi Page. Khi có lệnh Update, nó sẽ nhét ngay Tuple mới vào cùng Page để kích hoạt **HOT Update**.
- **Lệnh thực hiện**: 
```sql
ALTER TABLE users SET (fillfactor = 85);
-- Sau đó cần chạy REINDEX hoặc VACUUM FULL để cấu trúc lại bảng theo factor mới.
VACUUM FULL users; 
```

---

## 4. Cách kiểm tra "Tỷ lệ HOT" của hệ thống
Hãy dùng Query sau để biết sức khỏe hệ thống PostgreSQL của bạn:

```sql
SELECT 
    relname AS table_name, 
    n_tup_upd AS total_updates, 
    n_tup_hot_upd AS hot_updates, 
    CASE WHEN n_tup_upd > 0 
         THEN (n_tup_hot_upd::float / n_tup_upd::float) * 100 
         ELSE 0 
    END AS hot_ratio_percentage
FROM pg_stat_user_tables
ORDER BY n_tup_upd DESC;
```
*Kết quả lý tưởng cho các bảng thường xuyên Update là `hot_ratio_percentage > 80%`.*

---

## Tóm lược cho Principal:
1. **HOT Update** cứu cánh cho Disk I/O.
2. Chỉ hoạt động khi cột được Update **KHÔNG** thuộc bất kỳ Index nào.
3. Đòi hỏi Page phải còn **Free Space** (Sử dụng `FILLFACTOR`).
4. Giúp giảm thiểu tối đa hiện tượng "Index Bloat" (Phình to Index vô ích).
