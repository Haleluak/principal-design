# Rate Limiting Strategies: From Basic to Principal Level

Tài liệu này tổng hợp các kỹ thuật giới hạn lưu lượng (Rate Limiting) từ các thuật toán kinh điển đến những tư duy thiết kế hệ thống cao cấp mà các Principal Engineer hoặc Solutions Architect hay áp dụng.

---

## 1. Các Thuật Toán Phổ Biến (Core Algorithms)

### A. Token Bucket
- **Cơ chế**: Một "xô" chứa các token. Token được thêm vào theo tỉ lệ cố định. Mỗi request tiêu tốn 1 token. Nếu xô hết token, request bị từ chối.
- **Pros**: Cho phép xử lý **burst traffic** (lưu lượng tăng đột biến trong ngắn hạn) rất tốt.
- **Cons**: Có thể gây áp lực lên tài nguyên nếu burst quá lớn.
- **Khi nào dùng**: Build các API public cho user, nơi cần sự linh hoạt khi user reload trang hoặc gọi liên tục vài request một lúc.

> [!NOTE]
> **Cách Implement (Logic):**
> 1. Lưu trữ 2 giá trị trong Redis: `last_refill_time` và `current_tokens`.
> 2. Khi có request:
>    - `delta = current_time - last_refill_time`
>    - `new_tokens = delta * refill_rate`
>    - `current_tokens = min(capacity, current_tokens + new_tokens)`
>    - Nếu `current_tokens >= 1`: `current_tokens--`, cho phép request.
>    - Ngược lại: Từ chối.

### B. Leaky Bucket
- **Cơ chế**: Request chảy vào xô, và được xử lý (chảy ra) với một tốc độ không đổi (constant rate). Nếu xô đầy, request tràn ra ngoài (bị drop).
- **Pros**: Đầu ra cực kỳ ổn định, bảo vệ hệ thống phía sau khỏi spikes.
- **Cons**: Không cho phép burst traffic. Nếu user gửi nhanh, họ sẽ bị drop ngay cả khi hệ thống rảnh.
- **Khi nào dùng**: Thích hợp cho các worker backend, xử lý queue, hoặc các tác vụ background cần độ ổn định tuyệt đối.

> [!NOTE]
> **Cách Implement (Logic):**
> 1. Dùng một Queue (hàng đợi) có kích thước cố định.
> 2. Request đến: Nếu hàng đợi chưa đầy -> Push vào queue. Nếu đầy -> Drop.
> 3. Một worker (hoặc timer) chạy định kỳ: Lấy request ra khỏi queue và xử lý với tốc độ không đổi.

### C. Fixed Window Counter
- **Cơ chế**: Chia thời gian thành các cửa sổ cố định (ví dụ: 1 phút). Mỗi cửa sổ có một biến đếm.
- **Pros**: Đơn giản nhất để implement, tốn cực ít bộ nhớ.
- **Cons**: **Vấn đề biên (Edge case)**. Nếu user gửi 100 request ở giây cuối của phút 1, và 100 request ở giây đầu của phút 2 -> Hệ thống chịu tải 200 request trong 2 giây, vượt quá limit 100/phút.
- **Khi nào dùng**: Các hệ thống đơn giản, không quá khắt khe về độ chính xác tại thời điểm giao thoa.

> [!NOTE]
> **Cách Implement (Logic):**
> 1. Key trong Redis: `ratelimit:{user_id}:{timestamp_minute}`.
> 2. `current_count = INCR(key)`.
> 3. Nếu `current_count == 1`: `EXPIRE(key, 60)`.
> 4. Nếu `current_count > limit`: Từ chối.

### D. Sliding Window Counter
- **Cơ chế**: Lai giữa Fixed Window và Sliding Window Log. Nó tính toán số lượng request dựa trên trọng số của cửa sổ hiện tại và cửa sổ trước đó.
- **Pros**: Giải quyết vấn đề biên của Fixed Window mà không tốn bộ nhớ như Sliding Window Log.
- **Cons**: Độ chính xác chỉ là tương đối (approximation), nhưng đủ dùng cho 99% trường hợp.
- **Khi nào dùng**: Đây là thuật toán **Standard** nhất hiện nay cho các hệ thống lớn (như Cloudflare, GitHub).

> [!NOTE]
> **Cách Implement (Logic):**
> **Công thức:** `count = count_current_window + count_previous_window * (1 - overlap_percentage)`
> 1. Lấy count của phút hiện tại và phút trước đó (Fixed Window).
> 2. Tính xem hiện tại đã đi qua bao nhiêu % của phút này (ví dụ: giây thứ 15 -> 25%).
> 3. Áp dụng công thức để ước lượng tổng request trong 60 giây gần nhất.

---

## 2. Tư duy Principal/SA: "Smarter" Rate Limiting

Để hệ thống thực sự "thông minh" và bền bỉ, các công ty lớn không chỉ dùng những thuật toán trên một cách máy móc. Họ áp dụng các chiến lược sau:

### 1. Adaptive Rate Limiting (Giới hạn thích ứng)
Thay vì đặt một con số cứng (Hard limit) như 1000 req/s, hệ thống sẽ tự quan sát các chỉ số:
- **CPU/Memory usage** của backend.
- **P99 Latency**.
- **Error rate**.
Nếu latency tăng cao, hệ thống tự động siết limit của tất cả user lại để bảo vệ database (tuyên tự thuật toán **TCP BBR** hoặc **Vegas**). Khi hệ thống khỏe lại, nó tự mở rộng limit ra.

> [!NOTE]
> **Tech Stack:** Thường kết hợp với một bộ quan sát (Prometheus/Grafana) và một Service Mesh (như Envoy/Istio) để tự động điều chỉnh limit dựa trên metrics runtime.

### 2. Cost-based Rate Limiting (Tính phí theo độ nặng)
Không phải mọi request đều "tốn" như nhau.
- `GET /health` -> 1 token.
- `POST /search` (với nhiều filter phức tạp) -> 10 tokens.
- `POST /export-csv` -> 50 tokens.
**Cách làm**: Gán "weight" cho từng endpoint. User có "budget" nhất định thay vì số lượng request đơn thuần. Đây là cách **Shopify** và **GitHub GraphQL API** đang vận hành.

> [!NOTE]
> **Tech Stack:** Middleware sẽ kiểm tra endpoint và payload, tính toán ra "cost" và trừ vào token bucket của user thay vì mặc định trừ 1.

### 3. Multi-tier Rate Limiting (Giới hạn đa tầng)
Áp dụng đồng thời nhiều lớp:
1. **Lớp Global (WAF/Edge)**: Chặn IP spam quá nhanh (chống DDoS).
2. **Lớp API Key/User**: Dựa trên gói subscription (Free vs Pro).
3. **Lớp Service (Local)**: Từng microservice tự bảo vệ mình nếu Redis (dùng cho global limit) bị chậm hoặc timeout.

### 4. Zero-Downtime Rate Limiting với Distributed State
Các Principal thường thiết kế cơ chế **"Fail-open"**:
- Nếu cụm Redis chứa counter bị sập, hệ thống không được phép chặn toàn bộ user (Error 500).
- Lúc này, nó sẽ fallback về **Local Rate Limit** (giới hạn ngay tại RAM của instance hiện tại) hoặc cho phép qua hết nhưng kèm theo cảnh báo (alerting).

### 5. Client-Side Cooperation (Hỗ trợ từ phía Client)
Một hệ thống thông minh sẽ trả về đầy đủ header:
- `X-RateLimit-Limit`: Giới hạn tối đa.
- `X-RateLimit-Remaining`: Còn lại bao nhiêu.
- `X-RateLimit-Reset`: Khi nào thì được reset (timestamp).
- **Retry-After**: Client nên đợi đúng bao lâu mới được gọi lại.
-> Client (Web/App) sẽ tự động dừng gọi trước khi bị server chặn, giúp giảm tải cho server và tạo trải nghiệm mượt cho user (thực hiện **Exponential Backoff with Jitter**).

### 6. Shadow Rate Limiting (Dry Run)
Trước khi áp dụng một limit mới cho hàng triệu user, các SA thường chạy ở chế độ **Shadow**:
- Hệ thống vẫn tính toán xem request có vi phạm limit hay không.
- Nếu vi phạm, nó **không chặn** mà chỉ ghi log hoặc bắn metric (ví dụ: `rate_limit_shadow_blocked`).
- Team Engineering sẽ quan sát dashboard để biết có bao nhiêu % user thật bị ảnh hưởng, từ đó điều chỉnh con số limit cho phù hợp trước khi "bật switch" chặn thật.

---

## 3. Tổng kết: Khi nào sài gì?

| Nhu cầu | Thuật toán khuyên dùng |
| :--- | :--- |
| API Public bình thường | **Sliding Window Counter** |
| Bảo vệ Database/Worker | **Leaky Bucket** |
| Cho phép burst (như Flash Sale) | **Token Bucket** |
| Hệ thống tối giản, tài nguyên thấp | **Fixed Window** |
| Hệ thống Scale lớn, phức tạp | **Adaptive + Cost-based** |

> [!TIP]
> **Lời khuyên từ Principal:** Đừng bao giờ bắt đầu bằng một hệ thống rate limit quá phức tạp. Hãy bắt đầu với **Sliding Window Counter** trên Redis. Chỉ khi hệ thống thực sự gặp vấn đề về chi phí tài nguyên xử lý request nặng, hãy mới chuyển sang **Cost-based**. 
