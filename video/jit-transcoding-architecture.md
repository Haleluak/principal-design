# Just-In-Time (JIT) Video Transcoding Architecture

Tài liệu này mô tả kiến trúc xử lý truyền thông quy mô lớn, nơi video chỉ được transcode sang HLS khi có yêu cầu truy cập thực tế (On-demand), giúp tối ưu chi phí lưu trữ và tài nguyên.

## 1. Luồng hoạt động (Workflow)

```text
GIAI ĐOẠN 1: UPLOAD & METADATA
User (App/Web) --> API (Backend) --> S3 (Raw Storage)
                                  |
                                  --> Database (Lưu trạng thái: PENDING)

GIAI ĐOẠN 2: TRUY CẬP (JIT TRANSCODING)
User Request (m3u8) --> CloudFront 
                             |
                             --> Lambda@Edge (Origin Request)
                                      |
                                      --> 1. Kiểm tra S3 (Manifest exists?)
                                      |
                                      --> 2. Nếu CHƯA CÓ:
                                      |      - Gọi MediaConvert khởi tạo Job.
                                      |      - Cập nhật DB (Status: PROCESSING).
                                      |      - Trả về Header/Response "Retry-Later" hoặc URL chờ.
                                      |
                                      --> 3. Nếu ĐÃ CÓ:
                                             - Trả về .m3u8 và bắt đầu streaming.
```

---

## 2. Phân tích kỹ thuật (Principal Perspective)

### A. Thách thức: Độ trễ của lần đầu xem (First-viewer Latency)
MediaConvert là một dịch vụ xử lý theo hàng đợi, không thể xong ngay lập tức trong vài mili giây.
*   **Giải pháp:** Lambda@Edge không nên block request để đợi MediaConvert. Thay vào đó, nó sẽ khởi tạo job và trả về một trạng thái đặc biệt cho Frontend (ví dụ: HTTP 202 Accepted). Frontend sẽ hiển thị màn hình "Video đang được xử lý" và dùng kỹ thuật Polling hoặc WebSocket để biết khi nào xong.

### B. Tránh xử lý trùng lặp (Double Processing)
Nếu 100 người cùng click vào một video chưa xử lý tại cùng 1 thời điểm:
*   **Giải pháp:** Sử dụng cơ chế **Idempotency** và **Locking**. Trước khi gọi MediaConvert, Lambda@Edge phải kiểm tra trạng thái trong DB (ví dụ: Redis hoặc DynamoDB). Nếu trạng thái là `PROCESSING`, nó sẽ không tạo thêm job mới mà chỉ trả về thông báo "đang xử lý".

### C. Tối ưu chi phí S3 & MediaConvert
*   Chỉ transcode những video thực sự có người xem. 
*   Các video "nguội" (sau 30 ngày không ai xem) có thể thiết lập Lifecycle để xóa bản transcode, chỉ giữ lại bản gốc để tiết kiệm tiền. Nếu sau này có ai xem lại, quy trình JIT sẽ tự kích hoạt lại.

---

## 3. Cấu hình Lambda@Edge tiêu biểu

Dưới đây là một phần logic xử lý tại Origin Request của CloudFront:

```javascript
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const mc = new AWS.MediaConvert({ /* endpoint */ });

exports.handler = async (event) => {
    const request = event.Records[0].cf.request;
    const s3Path = request.uri; // Ví dụ: /video123/playlist.m3u8

    try {
        // 1. Kiểm tra xem file manifest đã tồn tại chưa
        await s3.headObject({ Bucket: 'processed-bucket', Key: s3Path }).promise();
        
        // Nếu không lỗi, file đã tồn tại -> Cho phép request đi tiếp tới S3 Origin
        return request;
    } catch (err) {
        if (err.code === 'NotFound') {
            // 2. Kích hoạt MediaConvert Job (Logic rút gọn)
            await mc.createJob({ /* Job Settings */ }).promise();
            
            // 3. Trả về response thông báo cho Client đang xử lý
            return {
                status: '202',
                statusDescription: 'Accepted',
                body: 'Video is being processed. Please try again in a few minutes.',
            };
        }
        throw err;
    }
};
```

---

## 4. Bảo mật & Quy mô lớn (Extra-Miles)

1.  **MediaConvert Queues:** Sử dụng "Reserved Queues" nếu bạn có lưu lượng lớn và ổn định để đảm bảo thời gian transcode nhanh nhất có thể.
2.  **CDN Token Auth:** Sử dụng Signed URLs/Cookies tại Lambda@Edge để đảm bảo chỉ những user đã thanh toán/đăng nhập mới có thể kích hoạt job xử lý (tránh bị đối thủ DDOS làm tăng tiền MediaConvert).
3.  **SQS làm bộ đệm:** Thay vì Lambda@Edge gọi trực tiếp MediaConvert (có thể bị limit rate), hãy đẩy một message vào SQS. Một Lambda khác sẽ tiêu thụ SQS và quản lý số lượng job đang chạy một cách mượt mà.
