# Dragonfly: Kho Lưu Trữ Dữ Liệu In-Memory Hiện Đại (Deep Dive)

DragonflyDB được thành lập bởi Roman Gershman (cựu Principal Engineer thuộc team ElastiCache của AWS) với mục tiêu giải quyết triệt để các hạn chế về kiến trúc của Redis để xây dựng "Kho lưu trữ dữ liệu In-Memory nhanh nhất thế giới."

---

## 1. Kiến Trúc Cốt Lõi: Shared-Nothing & Đa Luồng (Multi-Threading)

Khác với Redis (vốn dĩ chạy đơn luồng cho việc xử lý lệnh), Dragonfly được xây dựng từ đầu để tận dụng tối đa phần cứng máy chủ đa nhân hiện đại.

### Thiết kế Shared-Nothing (Không chia sẻ gì cả)
- **Phân đoạn Dataset:** Dữ liệu được chia thành **N shard (phân đoạn)**, với `N <= số lượng thread` (luồng) của server.
- **Quy tắc Sở hữu Độc lập:** Mỗi shard được quản lý bởi duy nhất **một thread cố định**.
- **Không xảy ra tranh chấp khóa (Lock Contention):** Vì mỗi thread có quyền sở hữu tuyệt đối đối với shard của mình, nó không cần dùng tới `locks` (mutex) để xử lý các lệnh, tránh được hiện tượng thắt cổ chai do tranh giành tài nguyên vốn thường thấy trong các hệ thống đa luồng truyền thống.

### Giao tiếp giữa các luồng (Message Bus)
- Các thread trong Dragonfly giao tiếp với nhau qua một **Message Bus** (ý tưởng tương tự như **Go Channels**).
- Ví dụ: Nếu client kết nối tới Thread A nhưng muốn truy cập dữ liệu thuộc Shard B (do Thread B quản lý), Thread A sẽ gửi một thông điệp qua Bus để yêu cầu Thread B xử lý.

---

## 2. Chiến Lược Mở Rộng: Ưu Tiên Chiều Dọc (Vertical-First)

Dragonfly tập trung tối ưu hóa **Vertical Scaling** (mở rộng trên một node duy nhất) trước khi tính đến mở rộng chiều ngang (Cluster).

### Tại sao ưu tiên chiều dọc? (Định luật Căn bậc hai - Root Square Law)
- **Hiệu quả phần cứng:** Một máy chủ cấu hình cực lớn thường tiết kiệm chi phí phần cứng hơn ~20-30% so với một cụm gồm nhiều máy chủ nhỏ có tổng dung lượng tương đương.
- **Sự đơn giản trong vận hành:** Không cần quản lý Cluster phức tạp, không cần Sentinel, và không phải đối mặt với các cuộc "di cư" dữ liệu (slot migration) đắt đỏ giữa các node mạng cho đến khi thực sự cần thiết.

---

## 3. Các Thuật Toán & Cấu Trúc Dữ Liệu "Cutting Edge"

Dragonfly thay thế các thuật toán cũ kỹ của Redis bằng những công nghệ tiên tiến nhất:

### Nghị thức VLL (Very Lightweight Locking)
- Được sử dụng để thực hiện **Atomic Transactions** (giao dịch nguyên tử) trên nhiều shard cùng lúc.
- Mạnh mẽ và chuẩn xác hơn cơ chế `MULTI/EXEC` của Redis (vốn không hỗ trợ rollback thực sự nếu một lệnh lẻ tẻ bị lỗi).

### Chính sách giải phóng bộ nhớ 2Q (Eviction Policy)
- Redis sử dụng **Approximated LRU** (Ít sử dụng gần đây nhất - mang tính xấp xỉ), thường gặp khó khăn với các mẫu truy cập dạng "Long Tail".
- Dragonfly sử dụng thuật toán **2Q**, theo dõi cả **tính mới (Recency)** và **tần suất (Frequency)** để đưa ra quyết định chính xác hơn về việc xóa key nào khi hết bộ nhớ.

### DashTable
- Dragonfly sử dụng **DashTable** để lưu trữ (key, value) chính.
- Thử nghiệm cho thấy DashTable tốn **ít hơn ~50% bộ nhớ** so với HashTable dạng chaining của Redis và giúp CPU truy cập dữ liệu nhanh hơn nhờ tối ưu hóa Cache Locality.

---

## 4. Phân Đoạn Lại Dữ Liệu & Mở Rộng (Redis vs Dragonfly)

### 4.1 Redis Scaling: Di Cư Slot (Slot Migration)
Redis Cluster sử dụng **16384 hash slots**.
- **Cơ chế:** Việc di cư dữ liệu diễn ra theo từng **slot một**. Hệ thống phải di chuyển tường minh từng key từ bộ nhớ của node này sang node kia thông qua mạng.
- **Chi phí:** Vì Redis đơn luồng, nó phải cân bằng giữa việc di cư dữ liệu và xử lý các lệnh từ client. Đây là một công việc **nặng nề về vận hành (operator-heavy)**.

### 4.2 Dragonfly Scaling: Luồng Dữ Liệu Đa Luồng (Multi-Threaded streaming)
Dragonfly xử lý việc phân bổ lại dữ liệu vượt trội hơn nhờ kiến trúc **Shared-Nothing đa luồng**:

#### A. Phân đoạn theo chiều dọc (Trong 1 Node)
- Khi thay đổi số nhân CPU (ví dụ: nâng cấp từ 4 lên 8 threads trên cùng một máy), Dragonfly thực hiện **Dàn xếp lại trong tiến trình (In-Process Redistribution)** ngay khi khởi động.
- Vì tất cả nằm trong cùng một không gian RAM, các key được ánh xạ ngay lập tức và song song vào các shard/thread mới. Không tốn chi phí mạng.

#### B. Phân đoạn theo chiều ngang (Swarm Mode)
- **Truyền dữ liệu song song:** Khác với Redis (một Core duy nhất xử lý cả di cư lẫn lệnh), Dragonfly sử dụng **nhiều thread** để truyền (stream) các phân đoạn dữ liệu song song.
- **Di cư Thread-to-Thread:** Các luồng (thread) ở node nguồn sẽ truyền trực tiếp các shard cho các luồng tương ứng ở node đích thông qua nhiều kết nối TCP song song.
- **Hiệu quả:** Điều này giúp quá trình resharding nhanh hơn **nhiều bậc (orders of magnitude)** và giảm thiểu hiện tượng "đứng máy" (latency stall) thường thấy trong các cụm Redis.

---

## 5. So Sánh: Redis vs Dragonfly

| Đặc tính | Redis | Dragonfly |
| :--- | :--- | :--- |
| **Luồng (Threading)** | Đơn luồng (Single-thread) | Đa luồng (Shared-nothing) |
| **Resharding** | Di cư từng Slot (Mạng) | Truyền đa luồng song song |
| **Mở rộng** | Ưu tiên chiều ngang (Cluster) | Ưu tiên chiều dọc (Core/RAM) |
| **Xóa key (Eviction)** | Approx. LRU | 2Q (Mới + Tần suất) |
| **Giao dịch** | Giả cầy (không rollback) | VLL (Atomic đa shard) |

---

## 5. Interview One-Liner
> Dragonfly đạt throughput gấp 25 lần Redis nhờ kiến trúc **shared-nothing đa luồng**, phân chia dữ liệu vào các shard độc lập cho từng nhân CPU, kết hợp với các thuật toán hiện đại như **DashTable** và **VLL** để loại bỏ tranh chấp khóa và tối ưu hóa bộ nhớ.
