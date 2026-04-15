# Image Processing & Optimization Architecture

Tài liệu này hướng dẫn cách thiết kế hệ thống xử lý ảnh tự động (giảm chất lượng, đổi định dạng) sau khi upload lên AWS.

## 1. Hai phương pháp tiếp cận chính

### A. Xử lý bất đồng bộ (Async Processing - Event Driven)
Đây là cách tiếp cận phổ biến nhất, phù hợp khi bạn cần lưu trữ vĩnh viễn các phiên bản ảnh khác nhau.

```text
Upload (S3 Raw Bucket) --> Event Trigger --> AWS Lambda --> S3 Processed Bucket
```

*   **Luồng hoạt động:**
    1.  User upload ảnh gốc vào `my-app-raw` bucket.
    2.  S3 phát ra event `s3:ObjectCreated`.
    3.  AWS Lambda được trigger, đọc file gốc.
    4.  Lambda sử dụng thư viện (như Sharp hoặc Pillow) để:
        *   Resize (Thumbnail, Large, Medium).
        *   Nén chất lượng (mặc định 80%).
        *   Chuyển định dạng (sang WebP, AVIF).
    5.  Lưu các file đã xử lý vào `my-app-optimized` bucket.
*   **Ưu điểm:** Độ trễ thấp khi user xem ảnh (vì ảnh đã có sẵn), dễ debug.
*   **Nhược điểm:** Tốn dung lượng lưu trữ (phải lưu nhiều phiên bản).

### B. Xử lý thời gian thực (On-the-fly Processing)
Phù hợp với các hệ thống hiện đại, yêu cầu linh hoạt về kích thước ảnh.

```text
User Request --> CloudFront --> Lambda@Edge / CloudFront Functions --> S3 (Origin)
```

*   **Luồng hoạt động:**
    1.  User yêu cầu URL: `cdn.com/image.jpg?w=300&fmt=webp`.
    2.  CloudFront kiểm tra cache. Nếu miss, nó gọi Lambda@Edge.
    3.  Lambda@Edge lấy ảnh gốc từ S3, xử lý trực tiếp (resize, convert) rồi trả về cho CloudFront.
    4.  CloudFront cache lại kết quả cho các request sau.
*   **Ưu điểm:** Tiết kiệm bộ nhớ, linh hoạt (thay đổi size nào cũng được).
*   **Nhược điểm:** Lần đầu truy cập (Cache miss) sẽ hơi chậm.

---

## 2. Chiến lược tối ưu định dạng & chất lượng

Để đạt được hiệu quả tốt nhất (Best Practices), bạn nên thực hiện các bước sau:

### Chuyển đổi định dạng (Format Conversion)
*   **WebP:** Hiệu quả hơn JPEG 25-35%. Hỗ trợ hầu hết trình duyệt hiện nay.
*   **AVIF:** Định dạng mới nhất, nén cực tốt nhưng tốn tài nguyên xử lý hơn WebP.
*   **Lưu ý:** Luôn giữ lại file gốc (JPEG/PNG) làm fallback cho các trình duyệt cũ.

### Giảm chất lượng (Compression)
*   Sử dụng thông số **Quality: 75-85**. Đây là "điểm ngọt" (sweet spot) khi dung lượng giảm mạnh nhưng mắt thường không nhận ra sự khác biệt.
*   Bỏ các metadata không cần thiết (EXIF data) để giảm thêm vài KB.

### Progressive JPEGs
*   Nếu dùng JPEG, hãy bật chế độ `progressive`. Ảnh sẽ hiện ra mờ trước rồi nét dần, tạo cảm giác trải nghiệm nhanh hơn cho người dùng.

---

## 3. Mã nguồn mẫu (Node.js + Sharp)

Thư viện **Sharp** là lựa chọn số 1 về hiệu năng cho xử lý ảnh.

```javascript
const sharp = require('sharp');
const aws = require('aws-sdk');
const s3 = new aws.S3();

exports.handler = async (event) => {
    const bucket = event.Records[0].s3.bucket.name;
    const key = event.Records[0].s3.object.key;

    // 1. Lấy ảnh gốc
    const image = await s3.getObject({ Bucket: bucket, Key: key }).promise();

    // 2. Xử lý ảnh (Ví dụ: Chuyển sang WebP, rộng 800px, quality 80)
    const processedImage = await sharp(image.Body)
        .resize(800)
        .webp({ quality: 80 })
        .toBuffer();

    // 3. Lưu lại vào bucket xử lý
    const newKey = key.replace('raw/', 'optimized/').replace(/\.[^.]+$/, '.webp');
    await s3.putObject({
        Bucket: 'my-app-optimized',
        Key: newKey,
        Body: processedImage,
        ContentType: 'image/webp'
    }).promise();
};
```

---

## 4. Các lưu ý quan trọng (Principal Level)

1.  **Lambda Memory:** Xử lý ảnh tốn nhiều RAM. Hãy cấp ít nhất 1024MB - 2048MB cho Lambda để tận dụng CPU đa nhân giúp xử lý nhanh hơn (Sharp hỗ trợ đa nhân).
2.  **Concurrency Limit:** Nếu có hàng nghìn ảnh upload cùng lúc, Lambda có thể đạt giới hạn concurrency. Cần cấu hình `Reserved Concurrency` để không ảnh hưởng đến các service khác.
3.  **Cost:** Xử lý On-the-fly (Lambda@Edge) có thể đắt hơn Async (Lambda cơ bản). Hãy tính toán kỹ dựa trên lưu lượng truy cập.
4.  **Security:** Nếu dùng xử lý Real-time qua URL params (`?w=300`), hãy **Sign URL** hoặc giới hạn các kích thước được phép (Whitelist) để tránh bị tấn công DDOS làm cạn kiệt tài nguyên Lambda.
