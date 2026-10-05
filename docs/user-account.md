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

## Duyệt / mở lại bếp khi tài khoản bị khóa

- Không được duyệt hoặc mở lại bếp nếu tài khoản chủ bếp bị khóa. Admin cần mở khóa tài khoản trong **Users** rồi mới duyệt / mở lại trong **Chefs**.
- Tài khoản đã soft delete không thể mở khóa hay mở lại bếp. Các mục hồ sơ, sản phẩm, đơn và doanh số vẫn xem được để tra cứu.
- UI báo lý do khi bấm Duyệt / Mở lại; API kiểm tra trạng thái hiện tại trong transaction và trả 409 khi bị chặn. Không đổi hồ sơ, cấp quyền Chef hoặc gửi thông báo duyệt khi thao tác thất bại.
- Duyệt bếp dùng cùng khóa transaction với khóa tài khoản, phân quyền và soft delete để tránh thao tác đồng thời vượt qua kiểm tra.

## Admin xóa tài khoản

- Admin → Users → Thao tác → **Xóa**, kiểm tra tên/email trong hộp xác nhận rồi bấm **Xác nhận xóa**.
- Dùng cùng luồng soft delete với user: giữ lịch sử, khóa tài khoản, đóng bếp nếu có, thu hồi tất cả phiên, tắt push và link xác minh. Có thể xóa tài khoản đã khóa, nhưng không xóa lại tài khoản đã xóa.
- Chặn thao tác với chính admin đang dùng và chặn nếu còn đơn hoặc đối soát/hoàn tiền chưa xử lý. Giữ ít nhất một admin hoạt động; kiểm tra quyền admin hiện tại trong transaction.
- Audit log ghi admin thực hiện, ID tài khoản bị xóa, thời điểm và `initiatedBy=admin`.
- User đang mở app: WebSocket bị đóng do phiên hết hiệu lực; app kiểm tra tài khoản, hiển thị thông báo tài khoản bị xóa, xóa giỏ/cache cá nhân và trở về trang chủ. Khi WebSocket chưa kết nối, kiểm tra lại lúc focus/quay lại app và mỗi 30 giây khi trang đang hiển thị. Server từ chối các API cần đăng nhập ngay sau khi xóa.
- User đang đóng app: không gửi thêm push sau khi xóa. Lần mở lại với cookie cũ còn hạn sẽ nhận thông báo rồi trở về Home. Nếu cookie hết hạn, app mở ở trạng thái khách.
- Đăng nhập lại bằng mật khẩu đúng hoặc Google đều báo tài khoản đã bị xóa. User có thể liên hệ hỗ trợ để tra cứu lịch sử đơn; không có chức năng tự khôi phục.

Production cần chạy `database/015_account_session_revocations.sql`. Bảng này chỉ lưu hash phiên, user ID, lý do và hạn phiên để báo đúng lý do đăng xuất. Cron xóa bản ghi hết hạn; không lưu token đăng nhập thô.

## Kiểm tra local

`npm run db:migrate` rồi `npm run test:account` kiểm tra bằng fixture riêng trên MySQL local, không gửi email và không ghi Blob thật.

Để kiểm tra thêm HTTP/cookie, chạy server local ở terminal khác rồi chạy `npm run test:account:http`.

`npm run test:avatar:browser` kiểm tra ảnh điện thoại lớn trong trình duyệt ở viewport mobile: thu nhỏ trước request, lưu avatar, ảnh vượt giới hạn/không đọc được, fallback JPEG khi không encode WebP và thông báo 413. API và Blob được giả lập, không upload ra production. Cần server local đã chạy và Playwright (có thể đặt `PLAYWRIGHT_MODULE` trỏ tới package Playwright có sẵn); mặc định dùng Edge headless. Có thể đặt `BROWSER_CHANNEL` và `TEST_BASE_URL` để đổi trình duyệt/cổng local.
