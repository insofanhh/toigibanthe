# Ảnh đại diện và xóa tài khoản

## Production

1. Chạy nội dung `database/014_user_account_details.sql` trong database production hiện tại. Không cần seed lại; không xóa dữ liệu.
2. Giữ cấu hình `BLOB_PUBLIC_READ_WRITE_TOKEN` của kho ảnh public đã có. Không dùng kho hồ sơ private cho ảnh đại diện.
3. Push và redeploy code, thử upload ảnh tại **Tôi → Cài đặt**, bấm **Lưu thông tin**. Ảnh phải hiện trong trang Tôi và Admin → Users / chi tiết tài khoản.

Avatar JPG/PNG/WebP có ảnh gốc tối đa 20 MB. Trình duyệt đọc hướng EXIF, cắt giữa ảnh và thu nhỏ tối đa 512 × 512 trước khi gửi. File gửi lên tối đa 1 MB, tránh giới hạn request của Vercel. Trình duyệt không encode WebP sẽ gửi JPEG; server luôn chuyển sang WebP trước khi lưu Blob. Giới hạn upload API chung vẫn là 3 MB. Server chỉ cho chọn asset ảnh thuộc tài khoản hiện tại; không nhận URL tùy ý hoặc hồ sơ riêng tư làm avatar. Gỡ ảnh cần bấm lưu. Ảnh cũ vẫn được giữ trong Blob.

## Xóa tài khoản

- Bấm **Xóa tài khoản → Xác nhận xóa** trong Cài đặt.
- Hệ thống đặt `users.active=FALSE`, ghi `deleted_at`, thu hồi tất cả phiên, tắt push và vô hiệu hóa các link xác minh đang chờ. Client xóa giỏ hàng và chuyển về Home.
- User vẫn tồn tại trong Admin → Users với nhãn **Đã xóa**; thuộc bộ lọc tài khoản đã khóa. Giữ lại lịch sử đơn, ảnh và dữ liệu đối soát. Nút mở khóa/phân quyền bị vô hiệu hóa với tài khoản đã xóa.
- Tài khoản có đơn chưa kết thúc hoặc đối soát/hoàn tiền chưa xử lý cần hoàn tất trước khi xóa. Bếp bị đóng và hồ sơ chuyển tạm ngưng khi chủ bếp xóa tài khoản.
- Không được xóa admin cuối cùng đang hoạt động. Việc xóa và phân quyền dùng chung khóa để chống thay đổi đồng thời.
- Email của tài khoản đã xóa vẫn được giữ và không thể đăng ký lại bằng email đó.

## Kiểm tra local

`npm run db:migrate` rồi `npm run test:account` kiểm tra bằng fixture riêng trên MySQL local, không gửi email và không ghi Blob thật.

Để kiểm tra thêm HTTP/cookie, chạy server local ở terminal khác rồi chạy `npm run test:account:http`.

`npm run test:avatar:browser` kiểm tra ảnh điện thoại lớn trong trình duyệt ở viewport mobile: thu nhỏ trước request, lưu avatar, ảnh vượt giới hạn/không đọc được, fallback JPEG khi không encode WebP và thông báo 413. API và Blob được giả lập, không upload ra production. Cần server local đã chạy và Playwright (có thể đặt `PLAYWRIGHT_MODULE` trỏ tới package Playwright có sẵn); mặc định dùng Edge headless. Có thể đặt `BROWSER_CHANNEL` và `TEST_BASE_URL` để đổi trình duyệt/cổng local.
