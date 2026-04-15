# Master Design: High-Scale Media System (Images & Video Streaming)

Chào mừng bạn đến với tài liệu thiết kế hệ thống Media quy mô lớn. Tài liệu này tổng hợp toàn bộ kiến trúc từ lưu trữ, xử lý ảnh cho đến truyền phát video chất lượng cao (HLS) theo tiêu chuẩn Principal Engineer.

---

## 1. Hạ tầng cốt lõi (S3 & CloudFront)

Đây là nền tảng vững chắc để đảm bảo tính bảo mật và hiệu năng.

### Cơ chế bảo mật OAC (Origin Access Control)
*   **S3 Bucket:** Tuyệt đối khóa Public (Block All Public Access).
*   **CloudFront OAC:** Chỉ cho phép CloudFront có quyền `s3:GetObject` thông qua Bucket Policy. Điều này chặn đứng việc lộ link S3 gốc.
*   **Custom Domain & SSL:** Sử dụng ACM để gán domain riêng (ví dụ: `cdn.yourcompany.com`) cho CloudFront.

### Quy trình Upload bảo mật (Presigned URL)
Thay vì gửi file qua Server, ta sử dụng **Presigned URL** để Client upload trực tiếp lên S3.
*   **Bảo mật:** URL chỉ tồn tại trong thời gian ngắn (ví dụ 5 phút).
*   **Chống phá hoại:** Backend phải validate `Content-Type` và `Content-Length` trước khi cấp URL.

---

## 2. Hệ thống xử lý ảnh (Image Optimization)

### Hai mô hình xử lý:
1.  **Async (S3 Trigger):** Upload -> S3 Event -> Lambda -> Resize/Convert -> Save. Phù hợp để tạo Thumbnail cố định.
2.  **On-the-fly (Real-time):** Request URL -> CloudFront -> Lambda@Edge -> Resize trực tiếp. Tiết kiệm bộ nhớ, cực kỳ linh hoạt.

### Tiêu chuẩn tối ưu:
*   **Format:** Ưu tiên WebP/AVIF để giảm 30-50% dung lượng.
*   **Quality:** Duy trì ở mức 75-85 (Sweet spot).
*   **Metadata:** Xóa bỏ EXIF data không cần thiết.

---

## 3. Video Streaming Architecture (HLS)

Dành cho hệ thống không lưu file MP4 mà phát dưới dạng luồng (Stream).

### Công nghệ chuẩn: HLS (HTTP Live Streaming)
*   **File .m3u8 (Playlist):** Bản đồ chỉ dẫn các đoạn video.
*   **File .ts (Segments):** Các mảnh video nhỏ (thường 6-10 giây).
*   **ABR (Adaptive Bitrate):** Tự động đổi chất lượng (360p, 720p, 1080p) theo tốc độ mạng.

### JIT Transcoding (Just-In-Time)
Hệ thống chỉ transcode video khi có người thực sự xem lần đầu:
1.  User gọi `.m3u8`.
2.  Lambda@Edge kiểm tra S3, nếu chưa có bản transcode -> Gọi **MediaConvert Job**.
3.  Trả về trạng thái `202 Accepted` cho Frontend để hiển thị màn hình chờ.
4.  Các lần xem sau sẽ được lấy trực tiếp từ cache CDN.

---

## 4. Deep Dive: Cơ chế hoạt động của FFmpeg & Player

### FFmpeg (Dưới nắp máy)
MediaConvert thực hiện lệnh tương tự FFmpeg để "phẫu thuật" video:
*   **Re-encoding:** Đưa về codec H.264/H.265.
*   **Segmenting:** Cắt nhỏ video đồng bộ với **Keyframes (GOP)** để tránh giật hình khi tua.

### Tại sao Mobile/FE click là xem được ngay?
*   **Cơ chế Buffering:** Player tải file `.m3u8` cực nhẹ về trước, sau đó tải 2-3 mảnh đầu tiên vào bộ nhớ đệm (Buffering). Khi đủ 1-2 mảnh (vài giây), nó bắt đầu phát ngay lập tức trong khi âm thầm tải các mảnh tiếp theo.
*   **Native Support:** Tuyệt đối mượt mà trên iOS (AVPlayer) và Android (ExoPlayer) nhờ hỗ trợ phần cứng.

---

## 5. Lưu ý cho Principal Engineer (The Big Picture)

1.  **Scale:** S3 có giới hạn request trên Prefix. Hãy dùng UUID hoặc Sharding prefix nếu có hàng triệu ảnh/video.
2.  **Cost:** 
    *   Sử dụng **S3 Intelligent-Tiering** cho các file gốc ít dùng.
    *   **CloudFront Signed Cookies:** Tốt hơn Signed URL cho HLS vì cookie cấp quyền cho cả thư mục chứa hàng nghìn file `.ts`.
3.  **Idempotency (Chống xử lý trùng):** Đảm bảo nhiều request JIT cùng lúc chỉ kích hoạt DUY NHẤT 1 job MediaConvert qua cơ chế Locking (Redis/DynamoDB).
4.  **Security:** Luôn Signature-V4 cho mọi request giữa các thành phần AWS.

```text
SỨ MỆNH: Hệ thống truyền thông hiện đại phải Nhanh (CDN), Tiết kiệm (JIT) và Bảo mật (OAC).
```
