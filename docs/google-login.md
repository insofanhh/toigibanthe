# Đăng nhập Google

Google OAuth chạy trên server, dùng MySQL/TiDB và session hiện có. Không cần Firebase hoặc Supabase. Chỉ xin `openid email profile`, không lưu access token hoặc refresh token.

## Cấu hình Google Cloud

1. Mở https://console.cloud.google.com/ và chọn/tạo project.
2. Vào **Google Auth Platform**. Cấu hình **Branding**: tên app, email hỗ trợ; thêm website, chính sách bảo mật nếu Google yêu cầu.
3. **Audience**: chọn **External**. Khi đang **Testing**, thêm email thử nghiệm vào **Test users**. Khi công khai cho mọi người, chuyển **In production** theo yêu cầu Google.
4. **Clients → Create client → Web application**.
5. Thêm **Authorized redirect URIs** chính xác:
   - Production: `https://toigibanthe.vercel.app/api/auth/google/callback`
   - Local: `http://127.0.0.1:3000/api/auth/google/callback`
   - Nếu dùng domain riêng, thêm `https://DOMAIN/api/auth/google/callback`.
6. Copy **Client ID** và **Client secret** sang biến môi trường server.

Luồng redirect trên server không dùng Google JavaScript SDK; không cần tải script Google hoặc khai báo key public phía client. Redirect URI phải khớp đầy đủ, kể cả protocol, host và port.

## Vercel

Trong **Project → Settings → Environment Variables**, đặt:

```dotenv
GOOGLE_CLIENT_ID=CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=CLIENT_SECRET
SITE_URL=https://toigibanthe.vercel.app
```

Giữ `AUTH_SECRET` hiện có (ít nhất 32 ký tự), `DATABASE_URL` và SSL như cấu hình trước. Client secret không dùng tiền tố `NEXT_PUBLIC_`. Redeploy sau khi lưu biến.

SQL mới: `database/010_google_auth.sql`. `npm run db:migrate` áp dụng migration; hệ thống cũng tự tạo bảng `google_identities` khi đăng nhập Google lần đầu nếu database user được phép tạo bảng. Với user database chỉ có quyền đọc/ghi, chạy SQL migration trước khi bật tính năng. Migration không sửa dữ liệu user cũ.

Nếu chưa cấu hình, nút Google bị vô hiệu hóa với thông báo; email/mật khẩu vẫn dùng được.

## Tài khoản và kiểm tra

- Google lần đầu tạo tài khoản role `user`. Bổ sung số điện thoại trong Cài đặt trước khi đặt hàng nếu cần.
- Lần sau nhận diện bằng Google `sub`, không chỉ dựa vào email.
- Email trùng tài khoản hiện có chỉ tự liên kết khi Google là bên quản lý email (Gmail hoặc Google Workspace có claim `hd`). Giữ nguyên vai trò, mật khẩu và dữ liệu của tài khoản đó. Email bên thứ ba đã tồn tại yêu cầu đăng nhập bằng mật khẩu; không tự gộp.
- Tài khoản bị tạm ngưng không đăng nhập được. Không tự cấp quyền chef/admin.
- OAuth có state ký bằng JWT, PKCE, nonce, kiểm tra chữ ký ID token, issuer, audience và thời hạn. Cookie OAuth hết hạn sau 10 phút.
- Đường dẫn quay lại được giới hạn trong app; hủy/sai phiên hiển thị thông báo ở trang đăng nhập, không lộ token.

Sau redeploy, kiểm tra: đăng nhập Google mới, đăng nhập lại, Gmail trùng user hiện có, hủy chọn tài khoản, quay lại checkout và logout. Kiểm tra hiện/ẩn mật khẩu ở cả đăng nhập/đăng ký không đổi nội dung đã nhập.

Tài liệu: https://developers.google.com/identity/openid-connect/openid-connect và https://developers.google.com/identity/gsi/web/guides/verify-google-id-token.
