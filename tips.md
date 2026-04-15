- tips enginer: 
1) sinh ra id 1 khoảng trước vd trong db id là 500 thì services gen trước 500-> 1500 store vào ram và trả theo thứ tự thì hết range id thì lên lấy range mới.
sài slide window để biết khi user nhiều lượng id sinh ra nhiều /s thì time càng nhanh, ít request thì id sinh ra ít time call dynamo lâu hơn.

2) python
- 4 core → tối đa 4 thread chạy song song thật (parallel) vì với N thread → vẫn chỉ 1 thread chạy Python code tại 1 thời điểm.
- Thread: 
    + Không phụ thuộc vào số core
    + Mà phụ thuộc vào:
        - RAM
        - OS limit
        - overhead

vd: 4GB => ~1000–3000 threads
8GB => ~3000–8000
vì mỗi thread tốn: ~1MB stack (default)

CPU thực tế
Core1: Thread A chạy Python
Core2: idle
Core3: idle
Core4: idle

Nếu dùng multiprocessing
4 core → tạo 4 process → mỗi process 1 thread chạy

Tổng kết dễ nhớ: 
- Số thread tạo được → phụ thuộc RAM
- Số thread chạy cùng lúc → phụ thuộc số core

Tạo nhiều thread không làm chương trình nhanh hơn
→ thậm chí còn chậm hơn (do context switching)

Code API Python bình thường (không multiprocessing) thì có dùng được nhiều core không?
Có — nhưng KHÔNG phải do code của bạn,
mà do server (Gunicorn/Uvicorn) spawn nhiều process

Go: goroutine ~2KB
G → P → M → CPU
G = goroutine 
M = OS thread (machine) thật do OS cấp phát
P = processor (scheduler context)
Máy 8GB RAM
8GB = 8192MB
8192MB / 2MB ≈ 4000 threads


gRPC Stream và WebSocket
HTTP Upgrade trong WebSocket
Upgrade để làm gì?
HTTP/1.1 ban đầu chỉ là request/response — client hỏi, server trả lời, đóng kết nối. Không có khái niệm "kết nối sống lâu dài 2 chiều".
Upgrade là cách "xin phép" chuyển giao thức:
Client                          Server
  │                               │
  │── GET /chat HTTP/1.1          │
  │   Upgrade: websocket          │  ← "tôi muốn chuyển sang WS"
  │   Connection: Upgrade ───────►│
  │                               │
  │◄── 101 Switching Protocols ───│  ← "OK, đồng ý"
  │                               │
  │  Từ đây TCP tunnel mở 2 chiều │
  │◄─────────────────────────────►│  ← không còn là HTTP nữa

App Chat thực tế — WebSocket
- Mỗi user mở 1 TCP connection đến server
- 1000 users online = 1000 TCP connections mở trên server
- Mỗi user giữ 1 TCP connection sống liên tục với server — không phải A nối thẳng tới B.

Socket, File Descriptor, và Poller
Mỗi TCP connection = 1 file descriptor (fd)
Client A connect  →  server tạo fd=5
Client B connect  →  server tạo fd=6
Client C connect  →  server tạo fd=7
1000 clients = 1000 fd trên server
Linux coi mọi thứ đều là file — TCP connection cũng vậy, mỗi connection được đại diện bởi 1 fd.

Poller hoạt động như thế nào?
Server không thể tạo 1000 thread để đọc 1000 fd — quá tốn RAM. Thay vào đó dùng I/O multiplexing:
epoll (Linux) / kqueue (macOS)
         │
         │  "báo tao khi fd nào có data"
         │
    ┌────▼────┐
    │  epoll  │  ← đăng ký tất cả fd vào đây
    └────┬────┘
         │
         │  fd=5 có data! ──► đọc fd=5
         │  fd=7 có data! ──► đọc fd=7
         │  ... chờ ...
         │  fd=6 có data! ──► đọc fd=6
1 thread duy nhất có thể quản lý hàng nghìn connection — không block, không chờ.

gRPC xử lý fd như thế nào?
Application (gRPC code)
        │
   gRPC library
        │
   HTTP/2 framing
        │
   TLS (thường có)
        │
   TCP socket (fd)
        │
   epoll / kqueue
gRPC không tự đọc fd — nó ngồi trên TCP, nhờ HTTP/2 lo việc đó.
Vậy gRPC dùng bao nhiêu fd?
1 client  →  1 TCP connection  →  1 fd
                   │
                   └── chứa N streams bên trong (HTTP/2)
                       stream 1: Chat RPC
                       stream 2: Order RPC
                       stream 3: Payment RPC

Btree và B+ tree Postgres
Mỗi page (8192 bytes) có cấu trúc:
┌─────────────────────────────┐
│ Page Header (24 bytes)      │
├─────────────────────────────┤
│ Line Pointer 1 (4 bytes)    │
│ Line Pointer 2 (4 bytes)    │
│ Line Pointer 3 (4 bytes)    │
│ ...                         │
├─────────────────────────────┤
│ Free space                  │
├─────────────────────────────┤
│ Item 3 (data)               │
│ Item 2 (data)               │
│ Item 1 (data)               │
└─────────────────────────────┘
TID = (page_number, line_pointer_number)
        ↓                ↓
      trang 5          slot 3

→ vào page 5
→ đọc Line Pointer số 3
→ biết item nằm ở offset nào
→ nhảy thẳng tới item
Page 5:
┌──────────────────────────┐
│ Header                   │
│ LP1 → offset=8100        │
│ LP2 → offset=8050        │
│ LP3 → offset=7990  ◄─────┼── TID trỏ vào đây
│                          │
│ Item3 tại 7990: {John...}│◄── đọc data thật
└──────────────────────────┘

B+ Tree:

         [30 | 70]          ← internal: key=30, key=70 chỉ để định hướng
        /     |     \
  [10|20] [30|50] [70|90]   ← leaf: key=30, key=70 xuất hiện LẠI ở đây

Key 30 và 70 tồn tại ở CẢ 2 tầng!

            [ 70 ]                <-- Root mới
           /      \
      [ 30 ]      [ 80 ]          <-- Tầng trung gian mới
     /    |        |    \
 [10|20] [30|50]  [70] [80|90]    <-- Tầng lá (Data thật)

B-Tree:

         [30 | 70]          ← key=30 và key=70 CHỈ nằm ở đây
        /     |     \
  [10|20]  [50]   [80|90]   ← không có 30, 70 ở leaf

Tính thực tế với 1 triệu records
key: 8 bytes
TID: 6 bytes  (trỏ tới record thật)
ptr: 6 bytes  (trỏ tới node con)
page: 8192 bytes

B+ Tree
Internal node:
1 entry = ptr(6) + key(8) = 14 bytes
8192 / 14 = 585 entries/node

Leaf node:
1 entry = key(8) + TID(6) = 14 bytes
8192 / 14 = 585 records/node

1 triệu records:
Leaf:     1,000,000 / 585 = 1,710 pages
Internal: 1,710 / 585     = 3 pages
Root:     1 page

Tổng = 1,714 pages
Disk  = 1,714 × 8192 = ~14 MB

B-Tree
Internal node (mang cả TID):
1 entry = ptr(6) + key(8) + TID(6) = 20 bytes
8192 / 20 = 409 entries/node

Leaf node — không có ptr:
1 entry = key(8) + TID(6) = 14 bytes
8192 / 14 = 585 records/node

1 triệu records:
Leaf:     1,000,000 / 585 = 1,710 pages
Internal: 1,710 / 409     = 5 pages
Root:     1 page

Tổng = 1,716 pages
Disk  = 1,716 × 8192 = ~14 MB

Redis
Quy tắc: Redis/Dragonfly sẽ chỉ băm phần nội dung bên trong dấu {}.
Ví dụ 1 (Không dùng Hash Tag):
user:123:profile -> Hash ngẫu nhiên -> Node A
user:123:orders -> Hash ngẫu nhiên -> Node B
Hệ quả: Bạn không thể dùng Lua script hay Pipeline đa lệnh (MGET/MSET) trên cả 2 key này vì chúng nằm khác chỗ.
Ví dụ 2 (Có dùng Hash Tag):
{user:123}:profile -> Chỉ băm chuỗi "user:123"
{user:123}:orders -> Chỉ băm chuỗi "user:123"
Kết quả: Cả 2 chắc chắn nằm trên cùng một Hash Slot, cùng một Core/Node.
3. Tại sao việc này lại quan trọng?
Đối với Redis Cluster:
Multi-key operations: Các lệnh như MGET, SUNION hoặc Lua Script chỉ hoạt động nếu tất cả các Key liên quan nằm trên cùng một Slot. Nếu không, bạn sẽ nhận lỗi CROSSSLOT Keys in request don't hash to the same slot.

Đối với Dragonfly:
Dragonfly tận dụng tính chất này để thực thi lệnh một cách "local" trên một Core.

Nếu bạn gom các key liên quan vào cùng một hash tag, Dragonfly sẽ xử lý chúng trên cùng một luồng (thread) mà không cần khóa (lock) dữ liệu trên các core khác. Điều này giúp đẩy throughput lên cực cao và giảm latency xuống mức tối thiểu.

4. Chiến lược đặt tên Key (Best Practices)
Để dễ quản lý và tối ưu hash, bạn nên đặt theo cấu trúc:
{ObjectPrefix:ID}:Attribute


“OFFLINE QUERY” VỚI DSU + SORTING
Vocal

I can't drink it all: ko log hết dc
crunchy: giòn
Kind of similar to: hơi giống
And vice: ngược lại
burn out: là tình trạng kiệt sức do áp lực công việc hoặc stress kéo dài.
debate: tranh luận
cutting edge: tiên tiến
disaster: thảm họa

What’s + (someone) + like?
- What's he like => hỏi về tính cách, phong cách, cách cư xử.
What does + (someone) + like?
- What does he like? => sở thích hoặc thứ người đó yêu thích.

No one should be more than 200 feet away from food.
