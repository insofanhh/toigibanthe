# Xác minh email đăng ký bằng mật khẩu

## Luồng

- Đăng ký tạo tài khoản và thông báo user mới cho admin, không tạo session.
- User thấy màn hình chờ xác minh, có gửi lại email và hướng dẫn kiểm tra thư rác.
- Link email mở `/verify-email?token=...`. Mở link chỉ kiểm tra thông tin, không xác minh hoặc đăng nhập (tránh trình quét email sử dụng link).
- Bấm **Xác minh email**: server xác minh token, cập nhật trạng thái, tiêu thụ tất cả token của tài khoản, tạo session và chuyển tới đường dẫn đã lưu lúc đăng ký.
- Trang đăng ký ở tab cũ sẽ chuyển tới trang đích nếu xác minh trong tab khác cùng trình duyệt.
- Token random 32 byte, database chỉ lưu SHA-256, hiệu lực 24 giờ, dùng một lần. Gửi lại cách nhau ít nhất 60 giây, tối đa 5 email/tài khoản/giờ; API còn có giới hạn theo IP.
- Không cho đăng nhập bằng mật khẩu khi tài khoản mới chưa xác minh. Đăng nhập với mật khẩu đúng đưa user tới màn hình chờ, có gửi lại email.
- Nếu SMTP lỗi sau khi tạo tài khoản: vẫn giữ tài khoản chờ xác minh, không báo gửi thành công; user có thể gửi lại, không cần đăng ký lần nữa.
- Admin → Users hiển thị **Chờ xác minh**, **Đã xác minh**, hoặc **Chưa xác minh** (tài khoản cũ không có chứng cứ xác minh). Hồ sơ có thời gian xác minh.
- Google dùng email đã được Google xác thực; không gửi email SMTP lần nữa. Tài khoản mật khẩu cũ không bị khóa bởi bản cập nhật này.

## Production

1. Trong SQL Editor của cluster production mới, chọn `toigibanthe`, chạy nội dung `database/013_email_verification.sql`. File này idempotent, không xóa dữ liệu.
2. Lấy cấu hình SMTP từ nhà cung cấp email đang có và thêm vào Vercel **Settings → Environment Variables → Production**:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@toigibando.app
SMTP_PASSWORD=your-smtp-password
SMTP_FROM="Tôi gì, bạn đó! <noreply@toigibando.app>"
SITE_URL=https://www.toigibando.app
```

Trong giao diện Vercel, value `SMTP_FROM` không cần dấu ngoặc kép bao ngoài. Dùng địa chỉ From được SMTP cho phép. Nếu nhà cung cấp dùng cổng **465**, đặt **SMTP_SECURE=true**. Cổng 587 dùng STARTTLS và **SMTP_SECURE=false**. Server yêu cầu TLS hợp lệ; không tắt kiểm tra chứng chỉ. Không dùng prefix `NEXT_PUBLIC_` cho thông tin SMTP.

3. Cấu hình các bản ghi SPF/DKIM theo nhà cung cấp mail để thư không rơi vào spam. Nếu dùng Gmail, dùng mật khẩu ứng dụng theo cấu hình tài khoản Gmail của bạn, không dùng mật khẩu đăng nhập thông thường.
4. Push code và redeploy để áp dụng biến môi trường.
5. Đăng ký một email bạn sở hữu tại `/login?next=/me`, kiểm tra email, bấm xác minh. Đảm bảo chuyển tới `/me`, đã đăng nhập, và admin thấy **Đã xác minh**.
6. Kiểm tra gửi lại, link đã dùng, link hết hạn và login chưa xác minh. Không gửi SMTP password hoặc token lên chat.

Không tự động gửi test tới người dùng thật. Muốn kiểm tra SMTP mà không gửi mail, sau khi đặt cấu hình local chạy `npm run mail:check`.

## Local

Thêm SMTP vào `.env.local`, dùng đúng `SITE_URL` local. Chạy `npm run db:migrate` và `npm run dev`.

`npm run test:email-verification` chỉ dùng MySQL local và giả lập SMTP, không gửi mail tới bên ngoài.

Nodemailer reference: https://nodemailer.com/smtp
