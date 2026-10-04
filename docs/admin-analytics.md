# Dashboard quản trị hệ thống

## Triển khai

- API `/api/admin/analytics/{summary,trends,operations,performance,growth,goals}` yêu cầu admin đang hoạt động.
- Dùng MySQL 8+/TiDB và các bảng cộng thêm trong `database/007_analytics.sql`. Không thêm dịch vụ analytics bên ngoài.
- Các bảng tự tạo khi tính năng được dùng lần đầu. Nếu tài khoản database chỉ có quyền đọc/ghi, chạy `007_analytics.sql` bằng tài khoản migration trước khi deploy.
- Không cần thêm biến môi trường. WebSocket dùng kết nối và outbox đang có. Sự kiện `admin-analytics` làm mới báo cáo khi đơn/bếp/thực đơn thay đổi; vận hành tự kiểm tra lại mỗi phút khi tab đang hiển thị.
- Báo cáo tải độc lập. Cache trên server 20 giây cho báo cáo lịch sử, không cache vận hành; cache không dùng làm nguồn cho các quyết định thanh toán. Làm mới bằng nút bỏ qua cache cũ.

## Định nghĩa

- Ngày báo cáo theo `Asia/Ho_Chi_Minh`, khoảng đầu ngày đến trước đầu ngày kế tiếp. Kỳ trước có cùng số ngày.
- Đơn tạo mới, hủy, từ chối, phân bố trạng thái: nhóm đơn **tạo trong kỳ**, trạng thái hiện tại. Nhóm còn xử lý là kết quả chưa chốt. Hết hạn được tách khỏi hủy/từ chối.
- Đơn hoàn thành, doanh số, khách và món bán: theo thời gian sự kiện `COMPLETED`. Đơn nhập cũ thiếu sự kiện dùng `updated_at` thay thế và dashboard thông báo số bản ghi đó.
- Doanh số món = `subtotal - discount` trên đơn hoàn thành. `subtotal` đã áp dụng giá sale. Phí giao hàng được hiển thị riêng. Doanh số từng món phân bổ giảm giá voucher theo tỷ trọng giá trị món.
- Giá trị đơn đã xác nhận thanh toán = giá trị các đơn có `payment_confirmed_at` trong kỳ. Đây không phải số dư ngân hàng hay số tiền còn lại sau hoàn tiền. Xác nhận SePay được nhận diện bằng sự kiện thanh toán gốc.
- Khách mới = đơn hoàn thành đầu tiên trên toàn nền tảng. Mua lại 30 ngày chỉ xét khách có đủ 30 ngày từ đơn hoàn thành đầu tiên; mua lại trên toàn nền tảng, dù chef/khu vực/bữa khác. Nhóm khách theo tháng của đơn đầu tiên.
- Mua lại sau ưu đãi xét nhóm khách mới có đơn đầu tiên dùng ưu đãi và đã đủ 30 ngày. Kết quả gắn với ưu đãi không chứng minh tác động tăng thêm của chiến dịch.
- Rating chef/món và số lượt là toàn thời gian. Ngày có thực đơn là số ngày đã tạo thực đơn; không suy luận thời gian mở bếp từ trạng thái cuối ngày. Các lần bật/tắt và lưu thực đơn từ cập nhật này được ghi vào audit log.
- Cảnh báo chậm nhận tính từ lúc vào trạng thái đã thanh toán. Ngưỡng mặc định: 10 phút nhận đơn, 48 giờ duyệt hồ sơ, 24 giờ mỗi giai đoạn đối soát. Admin cấu hình được. Không kết luận giao trễ khi chưa có thời gian giao cam kết.

## Khu vực và hành vi

- Ô khu vực bằng làm tròn tọa độ theo bước 0,02 độ (xấp xỉ 2 km). Bộ lọc đơn dùng vị trí giao của khách, không dùng địa chỉ chef.
- Sự kiện chỉ lưu ô vị trí và nhãn khu vực nếu có; không lưu địa chỉ đầy đủ hoặc tọa độ GPS chính xác trong analytics.
- Nhu cầu là số phiên có dữ liệu catalog; phiên không có món là phiên có **ít nhất một lần** không có kết quả phù hợp, có thể sau đó tìm được món. Không đồng nghĩa mọi món trong khu vực đều không tồn tại.
- Với bữa cụ thể, dữ liệu gồm lần lọc bữa đó và các bữa có món được hiển thị trong danh sách tổng. Không suy luận món của bữa khác đã được xem nếu nằm ngoài trang danh sách đã trả về.
- Số bếp phục vụ hiện tại là ước tính ở tâm ô. Kiểm tra bán kính và điều kiện checkout tiếp tục dùng vị trí chính xác.
- Phiên trình duyệt hết hạn sau 30 phút không hoạt động. `utm_source` được giữ trong phiên. Admin không được tính vào hành vi khách.
- Hành trình nối các bước catalog có món → thêm giỏ → checkout → đơn bằng cùng phiên và thời gian theo thứ tự. Xem chi tiết là tùy chọn, bao gồm đường thêm ngay từ thẻ món. Các lần lặp vẫn được xét để tìm đường đi hợp lệ.
- Dữ liệu hành vi bắt đầu từ bản cập nhật này; không tái tạo lượt xem từ đơn cũ. Mã sự kiện và bản ghi đơn làm retry idempotent.
- Chiến dịch sale và số tiền giảm được snapshot tại checkout; thay giá/tên sự kiện sau đó không thay đổi báo cáo cũ.

## Mục tiêu và chi phí

- Mục tiêu có kỳ, phạm vi, baseline và target riêng; bộ lọc trang không thay đổi phạm vi mục tiêu. Các chỉ số số lượng/doanh số tăng, tỷ lệ hủy giảm.
- Chi phí admin nhập có ngày, loại, nguồn và phạm vi. Chi phí chung chỉ nằm trong báo cáo toàn hệ thống; không tự phân bổ tùy tiện vào một khu vực/bữa.
- Chi phí marketing / khách mới là tỷ số gộp. Theo nguồn chỉ hiển thị khi có chi phí và khách mới được gắn cùng nguồn; không phải mô hình attribution đa kênh.
- Hiện chưa thu phí nền tảng nên chưa báo lợi nhuận hoặc doanh thu phí dịch vụ. Muốn tính lợi nhuận trên đơn cần sổ doanh thu phí và chi phí được phân bổ thực tế.
- CSV có Unicode BOM, escape dấu phẩy/dấu nháy/xuống dòng và chống công thức spreadsheet trong text do người dùng nhập.

## Kiểm tra

`npm test`: ngày Việt Nam, kỳ đối chiếu, CSV, domain và cache.

`npm run test:analytics`: fixture MySQL local, hơn 100 đơn, ngày tạo/hoàn thành khác kỳ, bữa/khu vực, giảm giá/phí giao, cohort đủ 30 ngày, sự kiện lặp, mục tiêu/chi phí và retry. Tự xóa fixture sau khi chạy, từ chối database ngoài localhost.

`TEST_BASE_URL=http://127.0.0.1:3002 npm run test:sepay`: chạy các kiểm tra checkout, SePay, hủy, đối soát, đặt lại và thông báo với bản production local đang chạy.
