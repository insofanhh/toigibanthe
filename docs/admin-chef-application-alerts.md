# Thông báo yêu cầu mở bếp trong Chefs

- Menu Chefs có badge đỏ `+N yêu cầu` cho các yêu cầu mới chưa xem của admin hiện tại. Khi thu gọn menu, badge hiển thị `+N` và tooltip đầy đủ.
- Hồ sơ gửi thành công lần đầu hoặc gửi lại từ trạng thái từ chối/cần bổ sung tạo thông báo mới. Gửi trùng khi đang chờ duyệt hoặc đã duyệt không tăng badge.
- Mở tab Chefs (kể cả truy cập trực tiếp/reload) khi có thông báo mới sẽ hiện toast **Có N yêu cầu mở bếp mới**, tự đánh dấu đã xem và ẩn badge. Toast giữ 8 giây sau khi ghi nhận thành công và không có nút **Đã xem**. Khi đang ở Chefs, yêu cầu mới cũng hiện toast và tự ghi nhận đã xem.
- Chỉ ghi nhận ID trong snapshot đã thông báo. Yêu cầu mới đến khi admin đã chuyển mục khác vẫn giữ badge. Trạng thái riêng cho mỗi admin, lưu trong MySQL/TiDB, giữ khi đổi thiết bị. Lỗi ghi nhận đã xem khôi phục badge và có nút **Thử lại**, không tự gửi lặp liên tục; bấm lại Chefs có thể thử lại.
- Khi duyệt bếp thành công, mọi thông báo mở bếp chưa xem của bếp đó được đánh dấu đã xem cho tất cả admin và badge giảm qua WebSocket. Các bếp khác giữ nguyên. Duyệt thất bại không giảm badge. Hồ sơ đã duyệt từ trước cũng được đối chiếu và đánh dấu đã xem khi lấy lại badge.
- Badge đếm thông báo chưa xem, độc lập với số hồ sơ đang chờ duyệt. Xem thông báo không duyệt hồ sơ. Tạm ngưng bếp không làm xuất hiện lại thông báo đã xử lý. Không tạo thông báo cho các hồ sơ cũ/seed khi triển khai.
- WebSocket dùng sự kiện `notification` hiện có với metadata `adminAlert: { type: "chef-application", alertId }`. Sự kiện `admin-chefs-seen` đồng bộ đã xem. Giữ tin hệ thống và push đang có, không phát hai toast cho cùng yêu cầu.
- Khi kết nối lại, lấy lại dữ liệu; có polling 30 giây khi tab trình duyệt hiển thị và cập nhật khi quay lại cửa sổ. Cập nhật nền giữ báo cáo/bảng, không thay bằng loading.

## Production

Chạy [012_admin_chef_application_alerts.sql](../database/012_admin_chef_application_alerts.sql) trước khi deploy nếu tài khoản DB không có quyền tạo bảng. Code tự tạo bảng nếu được cấp quyền. Không cần biến môi trường hoặc cấu hình WebSocket mới.

API yêu cầu quyền admin:

- `GET /api/admin/chefs/applications`: tổng chưa xem và tối đa 500 ID mỗi lượt.
- `POST /api/admin/chefs/applications` với `{ "ids": [...] }`: xác nhận snapshot của admin hiện tại, không ảnh hưởng admin khác; gọi lại cùng ID không trừ thêm.

Kiểm tra backend với dữ liệu tạm trên MySQL local: `npm run test:chef-applications`.
