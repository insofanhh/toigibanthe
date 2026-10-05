# Bản đồ bếp gần bạn

Nút icon tuyến đường cạnh ô tìm kiếm trên Home mở `/chefs/map`.

- Dùng địa chỉ giao hàng hiện tại của user; chưa có địa chỉ thì yêu cầu chọn vị trí.
- Goong hiển thị vị trí giao đến và marker avatar tròn, tên của từng bếp.
- Danh sách xếp từ gần đến xa, đánh dấu bếp gần nhất. Chọn marker hoặc một dòng để xem thông tin và mở thực đơn bếp.
- Dùng `NEXT_PUBLIC_GOONG_MAP_KEY` hiện có. SDK chỉ tải khi mở bản đồ. Nếu bản đồ lỗi hoặc chưa cấu hình, danh sách bếp vẫn dùng được.
- Làm mới dữ liệu mỗi 30 giây, khi quay lại trang, cửa sổ lấy focus hoặc hệ thống cập nhật revision. Giữ nguyên bản đồ và dữ liệu cũ trong lúc tải; xóa marker nếu bếp không còn đủ điều kiện.

## API và điều kiện

`GET /api/catalog/chefs-map?lat=...&lng=...` là API công khai. Bắt buộc có tọa độ hợp lệ. Chỉ trả thông tin hồ sơ công khai, tọa độ và bán kính giao, không trả tài khoản ngân hàng, số điện thoại hay giấy tờ.

Bếp phải được duyệt, tài khoản còn hoạt động, bếp đang mở và có ít nhất một món còn bán: sản phẩm hoạt động, menu bật, tồn kho dương, chưa hết giờ. Kiểm tra ngày phục vụ theo múi giờ Việt Nam, gồm bữa qua đêm của ngày trước khi `day_offset=1`.

Khoảng cách dùng cùng công thức bán kính của catalog: khoảng cách địa lý theo tọa độ, không phải khoảng cách đường đi. User chỉ thấy bếp nếu khoảng cách không vượt bán kính giao của chính bếp. Map lấy toàn bộ bếp hợp lệ, không phụ thuộc giới hạn 60 món của Home; mỗi bếp có một marker.

Không cần migration database hoặc biến môi trường mới.

## Kiểm tra

`npm run test:chef-map` dùng MySQL local với fixture tạm và tự dọn sau kiểm thử; từ chối chạy trên database từ xa. Kiểm tra bán kính, thứ tự khoảng cách, không trùng bếp, không mất bếp sau 60 món, bếp đóng/tài khoản bị khóa/hồ sơ chưa duyệt, menu tắt/hết món/hết giờ và ngày phục vụ qua đêm.
