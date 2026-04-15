# HLS Deep Dive: Cơ chế hoạt động của Video Streaming

Tài liệu này giải thích chi tiết cách công nghệ bên dưới (như FFmpeg/MediaConvert) tạo ra luồng HLS và cách trình phát video (Mobile/Web) tiêu thụ chúng.

## 1. Dưới nắp máy (Under the Hood): FFmpeg tạo HLS như thế nào?

Bản chất của HLS (HTTP Live Streaming) là chia nhỏ 1 file video lớn thành hàng nghìn mảnh nhỏ.

### Quá trình Transcoding & Segmenting:
Khi MediaConvert (hoặc FFmpeg) xử lý, nó thực hiện 3 lệnh đồng thời:
1.  **Re-encoding:** Chuyển đổi codec video gốc sang H.264 hoặc H.265 (nén tốt nhất cho web).
2.  **Segmenting:** Cắt video ra thành các đoạn nhỏ (thường là 6 hoặc 10 giây). 
3.  **M3U8 Generation:** Ghi lại danh sách các đoạn đó vào file text.

**Ví dụ lệnh FFmpeg thủ công để tạo HLS:**
```bash
ffmpeg -i input.mp4 \
    -profile:v baseline -level 3.0 \
    -s 1280x720 -start_number 0 -hls_time 10 -hls_list_size 0 \
    -f hls playlist.m3u8
```
*   `-hls_time 10`: Cứ 10 giây cắt 1 mảnh `.ts`.
*   `-f hls`: Định dạng đầu ra là HLS.

**Kết quả trong S3 sẽ trông như thế này:**
*   `playlist.m3u8` (File mục lục)
*   `segment0.ts` (10 giây đầu)
*   `segment1.ts` (10 giây tiếp theo)
*   ...
*   `segmentN.ts` (Đoạn cuối)

---

## 2. Giải phẫu file .m3u8 (The Manifest)

File `.m3u8` thực chất chỉ là một file text chứa URLs. Khi bạn mở nó ra, bạn sẽ thấy:

```text
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.000,
segment0.ts
#EXTINF:10.000,
segment1.ts
#EXT-X-ENDLIST
```
*   **#EXTINF:** Độ dài chính xác của mảnh video đó.
*   **segmentX.ts:** Đường dẫn để Player biết cần tải file nào về.

---

## 3. Player (Mobile/FE) hoạt động như thế nào khi bạn ấn "Play"?

Quy trình của một trình phát video (như **hls.js** trên Web, **AVPlayer** trên iOS, **ExoPlayer** trên Android) diễn ra như sau:

1.  **Fetch Manifest:** Player tải file `.m3u8` về trước. Đây là một file cực nhẹ nên tải rất nhanh.
2.  **Parsing:** Player đọc file text để biết có bao nhiêu mảnh, mỗi mảnh dài bao lâu.
3.  **Initial Buffering (Điểm mấu chốt):** 
    *   Player sẽ tải khoảng 3 mảnh `.ts` đầu tiên (ví dụ 30 giây video) vào bộ nhớ đệm (Buffer).
    *   Ngay khi mảnh đầu tiên tải xong, video bắt đầu phát. Bạn không cần đợi tải hết 1GB video để xem.
4.  **Continuous Download:** Trong khi bạn đang xem mảnh 1, Player âm thầm tải mảnh 4, 5, 6... về đắp vào Buffer. 
5.  **Adaptive Bitrate (ABR):** 
    *   Nếu mạng của bạn bỗng dưng yếu đi, Player phát hiện tốc độ tải mảnh `.ts` lâu hơn dự kiến.
    *   Nó sẽ tự động đổi sang đọc một file `.m3u8` khác có chất lượng thấp hơn (ví dụ 360p) để video không bị xoay vòng (buffering).

---

## 4. Tại sao Mobile/FE click là xem được ngay?

*   **HTTP Protocol:** Vì HLS dùng giao thức HTTP chuẩn (cổng 80/443), nên nó không bao giờ bị chặn bởi tường lửa (firewall) và có thể tận dụng hoàn hảo sức mạnh của CDN (CloudFront).
*   **Sequential Loading:** Cơ chế tải tuần tự giúp giảm tải cho thiết bị đầu cuối (không cần RAM khủng để chứa cả file video).
*   **Native Support:** Apple (iOS) và Android tích hợp sẵn bộ giải mã HLS cực kỳ tối ưu về pin và hiệu năng phần cứng.

---

## Tóm tắt cho Principal:
Để hệ thống mượt, bạn phải cấu hình **Keyframe Interval** (GOP - Group of Pictures) đồng bộ với **Segment Duration**. Ví dụ: Nếu bạn cắt mảnh 10s, thì mỗi 2s hoặc 5s video gốc phải có 1 Keyframe (điểm bắt đầu của một đoạn độc lập). Nếu không, khi đổi chất lượng video sẽ bị giật hình (artifacts).
