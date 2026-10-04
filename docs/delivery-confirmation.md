# Đơn đã giao và nhắc xác nhận

- Khi chef bấm **Báo đã giao**, đơn chuyển sang `DELIVERED`, ra khỏi bộ lọc **Đang xử lý** và số **Đơn đang xử lý** của chef. Đơn còn trong **Tất cả**; user và admin vẫn theo dõi được phần chờ xác nhận.
- Hệ thống lưu lịch nhắc vào `order_delivery_reminders` cùng transaction đổi trạng thái, đến hạn đúng 1 giờ sau thời điểm event `DELIVERED` theo UTC. Retry không đặt lại thời gian.
- Cron/worker khóa đơn, kiểm tra trạng thái rồi tạo một thông báo loại Đơn hàng, WebSocket outbox và Web Push queue cùng transaction. Một đơn chỉ nhắc một lần, kể cả nhiều instance chạy đồng thời. User xác nhận trước hạn thì hủy lịch nhắc.
- Thông báo mở `/orders/{id}`. User bấm **Tôi đã nhận món** để chuyển sang `COMPLETED`; thao tác vẫn kiểm tra chủ đơn và trạng thái trên server.
- Các đơn đã giao trước khi nâng cấp được bổ sung lịch dựa trên event đã giao; nếu không có event thì dùng `updated_at` làm mốc dự phòng.

## Production

- Không cần thêm biến môi trường. Schema tự khởi tạo; nếu tài khoản database không có quyền `CREATE TABLE`, chạy `database/009_delivery_reminders.sql` trước khi deploy.
- Dùng scheduler bên ngoài đang gọi `GET /api/cron` mỗi phút với header `Authorization: Bearer CRON_SECRET`. Response thêm `deliveryReminders: { sent, cancelled }` để theo dõi job. Thông báo được tạo ở lần cron đầu tiên sau hạn, thường trong vòng 1 phút nếu scheduler hoạt động và không có backlog.
- Worker realtime kiểm tra thêm mỗi 5 giây khi đang chạy. Vercel có thể tạm ngưng instance không hoạt động; cần giữ scheduler để gửi nhắc khi user đóng ứng dụng. Không khai báo cron mỗi phút của Vercel Hobby.
- Thông báo ngoài trình duyệt dùng VAPID/subscriptions đã cấu hình. Nếu user chưa bật quyền thông báo, thông báo vẫn xuất hiện ở tab Đơn hàng trong mục Thông báo.

Kiểm tra: `npm run test:delivery-reminders` tạo và dọn database local riêng, kiểm tra thời hạn, chống trùng, cạnh tranh với xác nhận và hàng đợi thông báo; không gửi push thật. Tài khoản kiểm thử cần quyền tạo/xóa database local. Nếu `DATABASE_URL` chỉ được cấp quyền trong database ứng dụng, truyền URL tài khoản kiểm thử qua `DELIVERY_TEST_DATABASE_URL`; không cần biến này ở production.
