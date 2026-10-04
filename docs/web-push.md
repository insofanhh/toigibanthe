# Thông báo đẩy Web Push

## Bật trên thiết bị

Đăng nhập → Tôi → Cài đặt → Thông báo trên thiết bị → Bật thông báo. Chỉ nút này yêu cầu quyền trình duyệt. Chọn Đơn hàng/Tin tức/Khuyến mãi; khuyến mãi mặc định tắt. Dùng “Gửi thông báo thử” để kiểm tra thông báo ngoài ứng dụng. Nút thử không tạo thông báo trong danh sách hoặc tăng số chưa đọc, giới hạn một lần/30 giây.

iPhone/iPad cần iOS 16.4 trở lên: Safari → Chia sẻ → Thêm vào Màn hình chính, sau đó mở biểu tượng app và bật thông báo. Chrome/Edge/Firefox/Safari trên các nền tảng được hỗ trợ cần HTTPS (localhost được dùng để phát triển). Trình duyệt, hệ điều hành, chế độ tập trung và tiết kiệm pin có thể làm chậm/chặn thông báo; Web Push không bảo đảm đến ngay.

Nhấn thông báo mở đúng nhóm Đơn hàng/Tin tức, đánh dấu đã đọc, rồi mở chi tiết. Trở về giữ nhóm đã chọn. Khuyến mãi hiện dưới nhóm Tin tức. Tắt thông báo chỉ ảnh hưởng thiết bị hiện tại. Đăng xuất thu hồi thiết bị thuộc phiên hiện tại, xóa thông báo hệ thống còn hiển thị và hủy đăng ký trình duyệt. Các thiết bị khác giữ nguyên. Đăng nhập lại rồi bật lại để nhận thông báo. Phiên đăng nhập hiện có hạn 7 ngày; khi hết hạn cần đăng nhập lại và bật lại.

## Cấu hình

1. `npm run push:keys` tạo bộ VAPID trong `.local/push-keys/` đã được Git ignore, không in khóa ra log. Không tạo lại bộ khóa mỗi lần deploy.
2. Thêm `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` vào môi trường Production của Vercel và `.env.local` nếu cần chạy local. Dùng giá trị trong các tệp tương ứng, bỏ ký tự xuống dòng. Subject là `https://toigibanthe.vercel.app` hoặc email `mailto:...` hợp lệ. Không đặt private key trong biến `NEXT_PUBLIC_*`.
3. `database/008_push.sql` là migration chỉ thêm 2 bảng MySQL/TiDB. Runtime cũng tạo bảng idempotent khi dùng tính năng. Tài khoản DB cần quyền CREATE TABLE lúc khởi tạo.
4. Redeploy cả service web và realtime để cùng dùng một bộ khóa. Không cần Firebase/Supabase hoặc tài khoản dịch vụ push bổ sung.

Đổi bộ khóa khiến thiết bị cũ cần bật lại. Lưu private key ở nơi an toàn. Không đưa endpoint hoặc khóa đăng ký thiết bị vào log.

## Luồng gửi và giới hạn

`notify()` ghi thông báo, WebSocket outbox và Web Push delivery cùng giao dịch DB. Nếu giao dịch rollback sẽ không gửi push. API sử dụng Next `after()` để gửi sau phản hồi, gồm cả webhook SePay. Tin tức/khuyến mãi từ admin vẫn qua broadcast job để phân phối cho đúng đối tượng. Service realtime thử lại hàng đợi mỗi 5 giây khi service đang chạy, độc lập số kết nối WebSocket. `/api/cron` cũng xử lý broadcast/push theo lịch hiện có.

Vercel có thể tạm ngưng instance không hoạt động; timer trong Node service không phải scheduler luôn chạy. Lần gửi đầu được chạy bằng `after()` của request; retry/broadcast số lượng lớn còn tồn sẽ tiếp tục khi service được gọi lại hoặc cron chạy. Không tăng tần suất cron trên Hobby. Khi mở rộng cần worker/scheduler chạy liên tục hoặc gọi cron bảo mật từ scheduler ngoài. Theo dõi `push_deliveries` để phát hiện backlog trước khi tăng quy mô.

Mỗi delivery được claim bằng DB lease 60 giây để nhiều instance không gửi cùng lúc; gửi tối đa 4 kết nối HTTPS song song, tối đa 100 jobs/lần. Lỗi mạng/5xx thử lại tối đa 5 lần, backoff từ 30 giây đến 15 phút. HTTP 404/410 tắt đăng ký đã hết hạn. Đơn hàng có TTL 1 giờ; tin tức/khuyến mãi 24 giờ, thử 5 phút. Đã đọc, tài khoản bị khóa, phiên hết hạn, tắt loại thông báo hoặc đổi tài khoản thì delivery bị hủy. Dữ liệu delivery hết hạn hơn 7 ngày được dọn định kỳ. Tag/topic giữ một thông báo hiển thị cho mỗi ID nếu cần retry. Endpoint chỉ cho các push service của Apple, Google, Mozilla và Microsoft, không cho URL tùy ý.

Service worker không có fetch handler, không cache trang/API và không thay đổi luồng đăng nhập. Payload của tài khoản cũ đến muộn chỉ hiển thị thông báo chung, không hiển thị nội dung riêng. Khi nhấn, kiểm tra tài khoản hiện tại lại trước khi mở chi tiết.

## Kiểm tra

`npm run test:push` kiểm tra hàng đợi MySQL local với sender giả (không gửi đến thiết bị thật), rollback, quyền sở hữu, preferences, retry, đọc, khóa tài khoản, phiên hết hạn, thu hồi và tự kiểm tra. `npm run test:push:worker` kiểm tra service worker bằng browser API giả.

Kiểm tra thực tế trên production: bật bằng thiết bị thật → gửi thông báo thử → đóng app → phát sinh thông báo đơn hàng → mở thông báo → quay lại đúng nhóm. Kiểm tra riêng Android và iOS PWA; test giả không xác nhận được việc hệ điều hành giao thông báo.
