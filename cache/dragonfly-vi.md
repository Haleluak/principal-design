# 14. Phân Đoạn Lại Dữ Liệu & Mở Rộng Hệ Thống (Redis vs Dragonfly)

Mở rộng không chỉ là việc thêm node — 
đó là câu chuyện về **cách dữ liệu được phân phối lại (resharding)** khi cụm (cluster) thay đổi.

---

## 14.1 Mở Rộng & Resharding Trong Redis

### Kiến trúc

Redis Cluster:

- Sử dụng **16384 hash slots**
- Mỗi key được ánh xạ vào 1 slot:

```c
slot = CRC16(key) % 16384
```

- Mỗi node sở hữu một tập hợp các slots.

---

### Khi Thêm Node

Khi một node mới được thêm vào:

1. Cluster sẽ gán một số slot từ các node hiện có cho node mới.
2. Dữ liệu phải được **di cư (migrate) theo từng slot**.

---

### Quy trình Resharding

```
Node Nguồn ────► Node Đích
 (slot X)         (slot X)
```

Các bước:

- Khóa (lock) slot tạm thời.
- Di chuyển từng key một qua mạng.
- Cập nhật metadata của toàn Cluster.

---

### Đặc điểm

- **Online nhưng không hề "miễn phí"**:
  - Gây gánh nặng cho mạng (Network overhead).
  - Tăng độ trễ (latency) trong quá trình di cư.
- Cần sự điều phối (orchestration) cực kỳ cẩn thận.

---

### Hạn chế cốt lõi

> Resharding trong Redis là một công việc **thủ công/tường minh (explicit) và cực kỳ nặng nề về vận hành.**

---

## 14.2 Mở Rộng & Resharding Trong Dragonfly

Dragonfly có **hai cấp độ mở rộng**:

---

## (A) Mở Rộng Theo Chiều Dọc (Trong Một Node đơn lẻ)

Đây là nơi Dragonfly thực sự tỏa sáng (Vertical Scaling).

### Cơ chế

- Dữ liệu được chia thành **N phân đoạn (shards)**.
- Mỗi shard được sở hữu và xử lý bởi một **Thread (luồng)** riêng.

```
shard_id = hash(key) % N
```

---

### Khi Số Luồng Thay Đổi

Nếu bạn tăng số thread (ví dụ từ 4 core lên 8 core):

```
Cũ: N = 4
Mới: N = 8
```

→ Vị trí ánh xạ của Shard sẽ thay đổi hoàn toàn (`hash(key) % 4` khác `hash(key) % 8`).

---

### Giải pháp của Dragonfly

Dragonfly xử lý vấn đề này rất gọn vì việc mở rộng chiều dọc thường là một hoạt động **Offline Upgrade**:

- Lưu snapshot cấu hình cũ.
- Khởi động lại process với nhiều threads hơn (trên phần cứng mạnh hơn).
- Trong quá trình nạp lại dữ liệu (load), các key sẽ tự động được ánh xạ vào `shard_id` mới.
- **Không cần cơ chế di cư ngầm gây đứng máy (stall/lock)** như Redis Cluster.

---

### Đặc điểm

- Diễn ra **trong lúc nạp dữ liệu vào bộ nhớ** của một tiến trình duy nhất.
- Tránh được "cơn ác mộng" di cư dữ liệu online qua mạng.
- Cần một khoảng thời gian dừng (downtime) rất ngắn để khởi động lại node đã nâng cấp.

---

## (B) Mở Rộng Theo Chiều Ngang (Nhiều Nodes)

Dragonfly cũng hỗ trợ cụm đa node (mode Swarm), nhưng:

- Nó **không phụ thuộc quá nhiều vào Cluster mode như Redis**.
- Tập trung tối đa vào hiệu năng **Vertical Scaling** (một server cực lớn).

---

### So Sánh Nhanh Redis vs Dragonfly

| Khía cạnh | Redis | Dragonfly |
| :--- | :--- | :--- |
| **Chiến lược mở rộng** | Chiều ngang (Cluster) | Ưu tiên chiều dọc (cũng hỗ trợ Swarm) |
| **Resharding** | Di cư Slot (qua mạng) | Ánh xạ lúc nạp / Network tối ưu (Swarm) |
| **Chi phí** | Cao (Mạng + Điều phối) | Thấp cho chiều dọc, tối ưu cho chiều ngang |
| **Độ phức tạp** | Cao | Thấp |

---

## 14.3 Đánh Đổi Thực Tế

### Redis

**Ưu điểm:**
- Mô hình Cluster cực kỳ trưởng thành.
- Khả năng mở rộng chiều ngang thực thụ (hàng nghìn node).

**Nhược điểm:**
- Resharding rất đắt đỏ.
- Vận hành phức tạp (cần Redis Sentinel hoặc Cluster manager).

---

### Dragonfly

**Ưu điểm:**
- Hiệu năng cực đỉnh trên một node (tận dụng hết số Core CPU).
- Tận dụng CPU tốt hơn nhờ kiến trúc đa luồng.
- Phân đoạn lại dữ liệu trong bộ nhớ cực nhanh.

**Nhược điểm:**
- Câu chuyện mở rộng đa node (multi-node) vẫn đang hoàn thiện.
- Vẫn cần ánh xạ lại dữ liệu khi số lượng shard thay đổi.

---

## 14.4 Takeaway Phỏng Vấn (One-Liner)

> Redis sử dụng cơ chế hash slots và thực hiện resharding tường minh qua mạng khi mở rộng ngang, điều này gây tốn kém tài nguyên vận hành. Ngược lại, Dragonfly tối ưu cho mở rộng dọc với thiết kế shard-per-thread, cho phép phân bổ lại dữ liệu cực nhanh trong bộ nhớ và tránh các vấn đề về mạng khi tăng core CPU trên một node.
