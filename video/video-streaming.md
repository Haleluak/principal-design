# Video Streaming Architecture (HLS)

Tài liệu này hướng dẫn cách thiết kế hệ thống chuyển đổi video sang định dạng chuẩn **HLS (HTTP Live Streaming)** để truyền phát (streaming) hiệu quả qua CloudFront.

## 1. Tại sao dùng HLS (.m3u8 và .ts)?

Thay vì bắt user tải nguyên một file `.mp4` nặng nề, HLS chia nhỏ video thành các đoạn (segments) vài giây:
*   **File .m3u8 (Playlist):** Đóng vai trò như một mục lục, chỉ dẫn cho trình chơi video biết cần tải đoạn nào tiếp theo.
*   **File .ts (Segments):** Các mảnh video nhỏ đã được mã hóa.
*   **Adaptive Bitrate (ABR):** HLS cho phép tự động đổi chất lượng video (360p, 720p, 1080p) tùy theo tốc độ mạng của người dùng.

---

## 2. Kiến trúc tổng quan (AWS Best Practices)

Mô hình tiêu chuẩn sử dụng **AWS Elemental MediaConvert**:

```text
Upload (S3 Raw) --> Trigger (Lambda) --> MediaConvert (Job) --> S3 (HLS Segments) --> CloudFront
```

### Quy trình hoạt động:
1.  **Upload:** User upload file gốc (ví dụ `.mp4`, `.mov`) lên S3 Raw Bucket.
2.  **Trigger:** Một Lambda function được kích hoạt. Lambda này không trực tiếp xử lý video (vì video rất nặng) mà nó sẽ gửi một "Job" tới **AWS Elemental MediaConvert**.
3.  **Transcoding:** MediaConvert thực hiện:
    *   Chia nhỏ video thành các file `.ts`.
    *   Tạo file playlist `.m3u8`.
    *   Tạo nhiều phiên bản độ phân giải khác nhau (Cấu hình ABR).
4.  **Storage:** Các file kết quả được lưu vào một S3 Bucket khác (Processed Bucket).
5.  **Delivery:** CloudFront phân phối các file này. Khi user click "Play", trình duyệt sẽ tải file `.m3u8` trước, sau đó lần lượt tải các đoạn `.ts` để phát.

---

## 3. Cấu hình CloudFront cho HLS

Để streaming mượt mà, CloudFront cần được tối ưu:
*   **Cache Policy:** Sử dụng `Managed-CachingOptimized`.
*   **CORS:** Cho phép các domain của bạn được phép GET file từ CDN.
*   **Origin Access Control (OAC):** Đảm bảo user không thể truy cập trực tiếp vào S3 chứa các mảnh `.ts`.

---

## 4. Mã nguồn Lambda mẫu (Python + MediaConvert)

Hàm Lambda này chỉ làm nhiệm vụ "ra lệnh" cho MediaConvert xử lý:

```python
import boto3
import json
import os

mediaconvert = boto3.client('mediaconvert', endpoint_url='YOUR_ENDPOINT_URL')

def lambda_handler(event, context):
    bucket = event['Records'][0]['s3']['bucket']['name']
    key = event['Records'][0]['s3']['object']['key']
    
    # Định nghĩa cấu hình Output (HLS)
    # Trong thực tế, bạn nên dùng Job Templates để quản lý cấu hình này
    job_settings = {
        "Inputs": [{
            "FileInput": f"s3://{bucket}/{key}"
        }],
        "OutputGroups": [{
            "Name": "Apple HLS",
            "OutputGroupSettings": {
                "Type": "HLS_GROUP_SETTINGS",
                "HlsGroupSettings": {
                    "SegmentLength": 10,
                    "Destination": f"s3://my-output-bucket/hls/{key}/"
                }
            },
            "Outputs": [
                {"NameModifier": "_720p", "VideoDescription": {"Width": 1280, "Height": 720}},
                {"NameModifier": "_1080p", "VideoDescription": {"Width": 1920, "Height": 1080}}
            ]
        }]
    }

    response = mediaconvert.create_job(
        Role='MediaConvert_Default_Role',
        Settings=job_settings
    )
    
    return {"statusCode": 200, "body": json.dumps("Job Created")}
```

---

## 5. Lưu ý cho Principal Engineer

1.  **Job Templates:** Không bao giờ hardcode cài đặt video trong code Lambda. Hãy tạo **Job Template** trên Console MediaConvert và gọi Template ID trong code.
2.  **Adaptive Bitrate (ABR):** Đảm bảo bạn xuất ra ít nhất 3 loại chất lượng (360p, 720p, 1080p) để tối ưu trải nghiệm người dùng mobile.
3.  **Security (Signed Cookies):** Với video trả phí hoặc bảo mật cao, không nên dùng Signed URL (vì user phải load hàng nghìn file `.ts`). Hãy dùng **CloudFront Signed Cookies** để cấp quyền một lần cho cả thư mục video.
4.  **Cost:** MediaConvert tính tiền theo phút video. Hãy cân nhắc việc sử dụng "Professional Tier" nếu cần các tính năng nâng cao như DRM (FairPlay, Widevine) để chống lậu video.
5.  **CORS:** File `.m3u8` và `.ts` thường xuyên gặp lỗi CORS trên trình duyệt nếu không được cấu hình đúng Header `Access-Control-Allow-Origin`.
