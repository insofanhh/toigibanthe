# Thông báo đăng ký mới trong Users

- Tab Users hiển thị badge đỏ `+N user` là số tài khoản đăng ký mới chưa được admin hiện tại xem. Menu thu gọn hiển thị `+N` cạnh icon, tooltip ghi đầy đủ số lượng.
- Tính cho tài khoản mới tạo bằng email hoặc Google; đăng nhập lại, liên kết Google vào tài khoản cũ và dữ liệu seed không tăng badge.
- Mở Users hoặc reload không tự xóa badge. Khi đã kiểm tra danh sách, bấm **Đã xem** ở thông báo đầu mục Users để đánh dấu những thông báo đã tải. Đăng ký đến sau thời điểm đó vẫn giữ badge.
- Trạng thái lưu trong MySQL/TiDB theo từng admin, giữ nguyên khi reload hoặc đổi thiết bị. Admin khác có trạng thái riêng.
- Chỉ admin đang hoạt động tại lúc đăng ký nhận thông báo. Không phát lại các tài khoản cũ khi mới triển khai.
- Cập nhật qua WebSocket hiện có (`admin-user-registration`, `admin-users-seen`), kèm thông báo nổi khi đang mở app. Tải lại mỗi 30 giây khi đang hiển thị, khi kết nối lại và khi quay lại tab để phục hồi nếu lỡ sự kiện.
- Thông báo riêng này không tăng bộ đếm Tin tức/Đơn hàng ở giao diện người dùng.
- Cache hết hạn chỉ kích hoạt cập nhật nền, không xóa nội dung đang hiển thị. Các sự kiện WebSocket đến trong 100ms được gộp thành một lượt cập nhật; sự kiện đã xem chỉ làm mới badge. Làm mới thủ công giữ cùng khóa cache, lỗi cập nhật giữ dữ liệu cũ kèm nút thử lại.

## Triển khai

Chạy SQL `database/011_admin_registration_alerts.sql` trên production trước khi deploy nếu tài khoản database không có quyền tạo bảng. Code tự tạo bảng nếu chưa có và được cấp quyền; không cần biến môi trường mới. Dùng cấu hình WebSocket hiện tại.

API chỉ dành cho admin:

- `GET /api/admin/users/registrations`: số chưa xem và tối đa 500 ID trong một lượt.
- `POST /api/admin/users/registrations` với `{ "ids": [...] }`: chỉ đánh dấu các ID của chính admin đó. Đọc lại không trừ thêm; đăng ký mới ngoài danh sách không bị đánh dấu nhầm. Nếu có hơn 500 thông báo, số còn lại vẫn được hiển thị và có thể xem tiếp.

Kiểm tra backend local: `npx tsx --env-file=.env.local tests/admin-registration-alerts.integration.ts`. Bộ kiểm thử giới hạn ở MySQL local, dọn dữ liệu sau khi chạy.
