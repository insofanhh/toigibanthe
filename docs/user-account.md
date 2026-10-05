# Ảnh đại diện và xóa tài khoản

## Production

1. Chạy nội dung `database/014_user_account_details.sql` trong database production hiện tại. Không cần seed lại; không xóa dữ liệu.
2. Giữ cấu hình `BLOB_PUBLIC_READ_WRITE_TOKEN` của kho ảnh public đã có. Không dùng kho hồ sơ private cho ảnh đại diện.
3. Push và redeploy code, thử upload ảnh tại **Tôi → Cài đặt**, bấm **Lưu thông tin**. Ảnh phải hiện trong trang Tôi và Admin → Users / chi tiết tài khoản.

Ảnh JPG/PNG/WebP tối đa 3 MB được tự xoay, thu nhỏ tối đa 512 × 512 và chuyển sang WebP trước khi lưu. Server chỉ cho chọn asset ảnh thuộc tài khoản hiện tại; không nhận URL tùy ý hoặc hồ sơ riêng tư làm avatar. Gỡ ảnh cần bấm lưu. Ảnh cũ vẫn được giữ trong Blob.

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
