# Keycloak Architectural Deep Dive

Keycloak là một giải pháp Quản lý Định danh và Truy cập (IAM) mã nguồn mở dành cho các ứng dụng và dịch vụ hiện đại. Nó cung cấp các tính năng mạnh mẽ bao gồm đăng nhập một lần (SSO), môi giới danh tính (identity brokering) và hợp nhất người dùng (user federation).

## Các Khái Niệm Cốt Lõi (Core Concepts)

| Khái niệm | Mô tả | Tương đương |
| :--- | :--- | :--- |
| **Realm** | Không gian riêng biệt để quản lý người dùng, vai trò và ứng dụng. | **Identity Domain** |
| **Client** | Ứng dụng yêu cầu xác thực cho người dùng. | **Application** |
| **Scope** | Định nghĩa các quyền hoặc dữ liệu được bao gồm trong token. | **Token Data** |
| **Role** | Nhóm các quyền được gán cho người dùng. | **Permission** |
| **Flow** | Chuỗi các bước cần thiết cho một hành động cụ thể (ví dụ: login). | **Pipeline** |

---

## Kiến Trúc Realm (Realm Architecture)

```mermaid
graph TD
    Realm["Realm (Identity Domain)"]
    Realm --> Users
    Realm --> Groups
    Realm --> Roles
    Realm --> Clients
    Realm --> Scopes["Client Scopes"]
    Realm --> IdP["Identity Providers (Google, FB, ...)"]
    Realm --> AuthFlows["Authentication Flows"]

    subgraph "Hệ thống Roles"
        Roles --> RR["Realm Roles (Global: Admin, User)"]
        Roles --> CR["Client Roles (App-specific: Editor, Viewer)"]
    end

    subgraph "Clients"
        Clients --> Web["Web App"]
        Clients --> Mobile["Mobile App"]
    end
```

---

## Các Luồng Xác Thực (Authentication Flows)

Keycloak hỗ trợ nhiều luồng OAuth 2.0 và OpenID Connect (OIDC) phù hợp cho các trường hợp sử dụng khác nhau.

### 1. Standard Flow (Authorization Code)
Luồng mặc định của OIDC/OAuth2.
- **Quy trình**: Client $\rightarrow$ Chuyển hướng tới Keycloak $\rightarrow$ Người dùng đăng nhập $\rightarrow$ Keycloak xác thực.
- **Kết quả**: Trả về `access_token` + `id_token`.

### 2. Direct Access Grants (Password Flow)
Còn gọi là Resource Owner Password Credentials.
- **Quy trình**: Client gửi trực tiếp `username` + `password` tới endpoint `/token` của Keycloak.
- **Lưu ý bảo mật**: **Không khuyến nghị** cho các ứng dụng hiện đại vì client phải xử lý mật khẩu người dùng trực tiếp.

### 3. Implicit Flow
Luồng cũ dành cho Single Page Applications (SPA).
- **Quy trình**: Access token được trả về trực tiếp trong fragment của URL chuyển hướng (`#access_token=...`).
- **Lưu ý bảo mật**: **Đã lỗi thời**. Dễ bị lộ token trong lịch sử trình duyệt. Hãy dùng **Authorization Code + PKCE** thay thế.

### 4. Service Account (Client Credentials Flow)
Dành cho giao tiếp giữa máy với máy (Machine-to-Machine - M2M).
- **Quy trình**: Service A $\rightarrow$ `client_id` + `client_secret` $\rightarrow$ Keycloak $\rightarrow$ `access_token`.
- **Đặc điểm**: Sử dụng **Service Account Roles** gắn trực tiếp cho client thay vì người dùng.

### 5. Standard Token Exchange
Cho phép đổi một token lấy một token khác.
- **Trường hợp sử dụng**: Giả mạo dịch vụ (impersonation), ủy quyền Microservice (Service A gọi Service B thay mặt người dùng).
- **Grant Type**: `urn:ietf:params:oauth:grant-type:token-exchange`.

### 6. OAuth 2.0 Device Authorization Grant
Dành cho các thiết bị hạn chế nhập liệu (Smart TVs, CLI, IoT).
- **Quy trình**: Thiết bị $\rightarrow$ `device_code` $\rightarrow$ Người dùng đăng nhập trên thiết bị thứ hai (Điện thoại/PC) $\rightarrow$ Thiết bị nhận `access_token`.

### 7. OIDC CIBA Grant
*Client Initiated Backchannel Authentication*.
- **Quy trình**: Client khởi tạo xác thực $\rightarrow$ Keycloak gửi thông báo đẩy tới ứng dụng di động của người dùng $\rightarrow$ Người dùng phê duyệt ngoài luồng (out-of-band).
- **Lợi ích**: Không cần chuyển hướng trình duyệt.

---

## Lựa Chọn Luồng Phù Hợp (Recommended Modern Flows)

| Loại ứng dụng | Luồng khuyến nghị |
| :--- | :--- |
| **Web Application** | Authorization Code Flow |
| **SPA / Mobile** | Authorization Code + PKCE |
| **Service to Service** | Client Credentials Flow |
| **IoT / CLI** | Device Authorization Grant |
| **Advanced Auth** | CIBA |

### 🛑 Cơ chế PKCE (Proof Key for Code Exchange)
PKCE thêm một lớp bảo mật cho luồng Authorization Code bằng cách đảm bảo rằng client yêu cầu token chính là client đã khởi tạo yêu cầu xác thực ban đầu thông qua một `code_verifier` duy nhất.

---

## Các Loại Mã Thông Báo (Key Tokens)

1.  **Access Token**: Dùng để ủy quyền cho các yêu cầu API.
    - *Header:* `Authorization: Bearer <access_token>`
2.  **ID Token**: Cung cấp thông tin danh tính có thể xác minh về người dùng.
    - *Sử dụng:* Được frontend tiêu thụ để hiển thị thông tin người dùng (tên, email...). **Không bao giờ dùng để gọi API.**

---

## Phân Quyền & Mapping Role (User-Level Authorization)

Keycloak cung cấp nhiều cách để quản lý quyền cho từng người dùng, từ các phép gán role đơn giản đến các chính sách dựa trên tài nguyên phức tạp.

### 1. Kiểm Soát Truy Cập Dựa Trên Vai Trò (RBAC)
Đây là phương pháp tiêu chuẩn, trong đó người dùng được cấp quyền thông qua các vai trò (Role).

| Phương pháp | Mô tả | Trường hợp sử dụng |
| :--- | :--- | :--- |
| **Gán trực tiếp (Direct)** | Gán các role cụ thể trực tiếp vào hồ sơ người dùng. | Dành cho các quyền đặc thù hoặc user admin hệ thống. |
| **Gán qua Nhóm (Group)** | Người dùng tham gia một nhóm (ví dụ: `Kỹ thuật`, `Nhân sự`) và kế thừa các role từ nhóm đó. | **Khuyến nghị** để quản lý mở rộng. Thay đổi role của nhóm sẽ ảnh hưởng đến tất cả thành viên. |
| **Role Hợp nhất (Composite)** | Một role chứa các role khác bên trong (ví dụ: `Admin` = `Read` + `Write` + `Delete`). | Đơn giản hóa cấu trúc phân quyền phức tạp. |

### 2. Realm Roles vs. Client Roles
*   **Realm Roles**: Quyền toàn cục có giá trị trên tất cả các Client trong Realm (ví dụ: `super-admin`, `premium-user`).
*   **Client Roles**: Quyền theo ngữ cảnh cụ thể của một ứng dụng. Một user có thể là `Biên tập viên` trong app "Tin tức" nhưng chỉ là `Người xem` trong app "Báo cáo".

### 3. Phân quyền chi tiết (Fine-grained Authorization Services)
Dành cho các yêu cầu phức tạp hơn danh tính (ví dụ: "User A chỉ được phép sửa ảnh do chính họ tải lên"), Keycloak cung cấp **Authorization Services**:
*   **Resources**: Tài nguyên cần bảo vệ (ví dụ: `/blog/123`).
*   **Scopes**: Hành động trên tài nguyên (ví dụ: `view`, `delete`, `edit`).
*   **Policies**: Quy tắc xác định quyền truy cập (ví dụ: "Role phải là VIP", "Thời gian truy cập phải trong giờ làm việc").
*   **Permissions**: Sự kết hợp giữa Tài nguyên, Hành động và Quy tắc.

---

## Vòng Đời Token & Bảo Mật (Token Lifecycle & Security)

Xử lý việc token hết hạn và thu hồi quyền truy cập là yếu tố then chốt để đảm bảo tính toàn vẹn của hệ thống.

### 1. Xử lý Token hết hạn (Expiration)
*   **Access Token**: Có tuổi thọ ngắn (ví dụ: 5-15 phút). Khi hết hạn, Backend sẽ trả về lỗi `401 Unauthorized`.
*   **Refresh Token**: Có tuổi thọ dài hơn. Được Client dùng để đổi lấy Access Token mới từ Keycloak mà không cần người dùng nhập lại mật khẩu.
*   **Kết thúc phiên**: Nếu Refresh Token hết hạn hoặc Session trên Keycloak bị xóa, người dùng bắt buộc phải đăng nhập lại.

### 2. Khi Người dùng bị xóa hoặc bị khóa (Revocation)
Vì Access Token (JWT) mang tính chất **stateless** (không trạng thái), chúng vẫn có hiệu lực về mặt kỹ thuật cho đến khi hết hạn thực tế, ngay cả khi người dùng đã bị xóa trong database.

**Các giải pháp ngăn chặn truy cập trái phép:**
1.  **TTL ngắn**: Để Access Token có thời gian sống cực ngắn nhằm giảm thiểu rủi ro.
2.  **Token Introspection**: Backend gửi yêu cầu kiểm tra trạng thái token trực tiếp tới Keycloak cho mỗi request. Nếu user bị xóa, Keycloak trả về `active: false`.
3.  **Chính sách "Not Before"**: Keycloak cho phép thiết lập chính sách vô hiệu hóa toàn bộ token được cấp phát trước một mốc thời gian cụ thể.
4.  **Backchannel Logout**: Keycloak gửi thông báo trực tiếp (Web-hook) tới các Client để yêu cầu xóa session của người dùng ngay lập tức.
5.  **Kiểm tra tại bước Refresh**: Đây là chốt chặn phổ biến nhất. Khi Access Token ngắn hạn hết hạn, Keycloak sẽ từ chối cấp token mới nếu người dùng không còn tồn tại hoặc đang bị khóa.

---

## Góc Nhìn Principal: Quyết Định Kiến Trúc & Đánh Đổi

Là một Principal Engineer, điều quan trọng không chỉ là cách sử dụng Keycloak, mà là cách nó khớp vào kiến trúc hệ thống lớn.

### 1. Vấn đề Token Bloat (Phình to Token)
*   **Vấn đề**: Việc đưa quá nhiều role, group hoặc claim tùy chỉnh vào payload JWT sẽ làm tăng kích thước token. Token quá lớn có thể vượt quá giới hạn HTTP header của Load Balancer (ví dụ: mặc định của Nginx là 4KB-8KB), dẫn đến lỗi `431 Request Header Fields Too Large`.
*   **Giải pháp**: Giữ Access Token gọn nhẹ. Sử dụng **UserInfo Endpoint** (`/protocol/openid-connect/userinfo`) để lấy các dữ liệu phụ trợ không bắt buộc phải có trong mọi logic ủy quyền của request.

### 2. Khả năng Sẵn sàng Cao (HA) & Scale
*   **Chi phí JVM**: Keycloak tiêu tốn tài nguyên hơn các giải pháp dựa trên Go (như Hydra/Zitadel). Cần giám sát JVM heap và garbage collection chặt chẽ.
*   **Infinispan Clustering**: Keycloak sử dụng Infinispan để làm caching phân tán cho session và token. Trong thiết lập Multi-DC (nhiều trung tâm dữ liệu), độ trễ đồng bộ hóa là thách thức lớn nhất.
*   **Kết nối Database**: Đảm bảo DB của bạn (PostgreSQL/MariaDB) có pool kết nối đủ mạnh (Sử dụng Agroal trong các bản Keycloak mới).

### 3. Keycloak SPI (Service Provider Interface)
*   **Khả năng mở rộng**: Nếu các phương thức xác thực chuẩn không đáp ứng được (ví dụ: hash DB cũ, custom biometric), hãy sử dụng Java SPI để mở rộng Keycloak. **Lưu ý**: SPI chạy bên trong JVM, nên code kém chất lượng có thể làm sập toàn bộ dịch vụ IAM/SSO.

### 4. Checklist Bảo mật Chuyên sâu
*   **Bắt buộc dùng PKCE**: Yêu cầu PKCE ngay cả cho các app Server-side để ngăn chặn việc đánh chặn authorization code.
*   **Root Realm**: Không bao giờ sử dụng realm `master` cho các ứng dụng của bạn. Hãy tạo realm riêng biệt cho từng môi trường hoặc dòng sản phẩm.
*   **Audit Logging**: Cấu hình event listeners để đẩy audit log ra các hệ thống observability bên ngoài (ELK/Grafana) nhằm theo dõi bảo mật theo thời gian thực.

---

## Các Edge Cases Thực Tế & Xử Lý Sự Cố

Những cạm bẫy thực tế thường gặp trong các hệ thống production quy mô lớn.

### 1. Lỗi "Issuer Mismatch" (URL Công khai vs Nội bộ)
*   **Vấn đề**: Client thực hiện xác thực qua `https://auth.company.com`. Backend (bên trong K8s) kiểm tra token qua DNS nội bộ `http://keycloak-service:8080`.
*   **Hệ quả**: Backend từ chối token vì trường `iss` (issuer) trong JWT là `https://auth.company.com`, trong khi lookup nội bộ lại mong đợi `http://keycloak-service:8080`.
*   **Khắc phục**: Thiết lập `KC_HOSTNAME` nhất quán thành URL công khai cho cả lưu lượng nội bộ và bên ngoài.

### 2. Clock Skew (Lệch thời gian hệ thống)
*   **Vấn đề**: App server và Keycloak server bị lệch giờ nhau chỉ vài giây.
*   **Hệ quả**: Token hợp lệ bị từ chối với lỗi `Token is not valid yet` (iat nằm ở tương lai) hoặc `Token expired`.
*   **Khắc phục**: Sử dụng **Network Time Protocol (NTP)** để đồng bộ hóa thời gian cho tất cả các máy chủ trong hạ tầng.

### 3. Hạn chế Cookie SameSite
*   **Vấn đề**: Các trình duyệt hiện đại (Chrome/Safari) mặc định chặn cookie bên thứ ba.
*   **Hệ quả**: Luồng làm mới ẩn (Silent Refresh) diễn ra trong iframe bị lỗi, gây ra việc đăng xuất session bất ngờ ngay cả khi người dùng đang hoạt động.
*   **Khắc phục**: Cấu hình Keycloak để sử dụng cookie `SameSite=None; Secure` và đảm bảo luôn sử dụng HTTPS.

### 4. Session "Mồ côi" (Orphaned Sessions - Logout không hết)
*   **Vấn đề**: Người dùng đăng xuất khỏi App A. App B (cùng dùng SSO đó) vẫn đang mở.
*   **Hệ quả**: Nếu không cấu hình **Backchannel Logout** hoặc **Frontchannel Logout** chuẩn, App B vẫn duy trì trạng thái đăng nhập cho đến khi token cục bộ hết hạn—một lỗ hổng bảo mật đáng kể.

### 5. Home Realm Discovery (HRD)
*   **Vấn đề**: Ứng dụng multi-tenant yêu cầu người dùng được chuyển hướng đến IdP doanh nghiệp cụ thể (SAML/OIDC) dựa trên domain email của họ.
*   **Khắc phục**: Triển khai một **Identity Provider Redirector** tùy chỉnh trong luồng xác thực để phát hiện `user@enterprise.com` và tự động điều hướng đến đúng nhà cung cấp.
