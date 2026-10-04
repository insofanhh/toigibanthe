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

## Phân tích Users

- Users dùng API admin riêng: `GET /api/admin/users/report`, `/api/admin/users` và `/api/admin/users/:id`; tiếp tục dùng API khóa/mở tài khoản hiện có. Không thêm bảng hoặc biến môi trường.
- Sáu chỉ số và hai biểu đồ áp dụng vai trò, trạng thái tài khoản và tìm kiếm. Khoảng ngày chỉ áp dụng đăng ký mới và mua trong kỳ; tổng tài khoản, số bị khóa và nhóm mua hàng là hiện trạng/toàn thời gian.
- Nhóm chưa mua/mua một lần/mua nhiều lần theo số đơn hoàn thành. Khách mua lại trong kỳ có lần mua thứ hai trở đi trong kỳ; một khách có thể vừa mua lần đầu vừa mua lại trong cùng kỳ. Chef cũng có thể mua; chọn vai trò User khi cần chỉ xem tài khoản User.
- Lần mua đầu dùng thứ tự thời gian sự kiện hoàn thành và ID để phá hòa, gồm cả đơn đầu ngoài kỳ. Đơn cũ thiếu sự kiện dùng `updated_at`. Tổng giá trị món đã mua tính toàn thời gian, sau voucher, không gồm giao hàng. Không suy luận lần truy cập từ trạng thái tài khoản.
- Danh sách lọc/sắp xếp trên server, 20 tài khoản/trang và thứ tự ổn định; tổng không giới hạn bởi 100 tài khoản. Bấm KPI/nhóm lọc danh sách. Bộ lọc và trang giữ trong URL riêng của Users, hỗ trợ quay lại.
- Hồ sơ hiển thị liên hệ, thống kê và lịch sử toàn thời gian có phân trang, cùng tối đa 20 yêu cầu đối soát/hoàn tiền gần nhất. Không trả password hash hoặc session.
- `npm run test:users`: fixture local hơn 100 tài khoản, ngày tạo/hoàn thành khác kỳ, lần mua trùng thời gian, đơn cũ, nhóm, tìm kiếm literal, phân trang và hồ sơ/đối soát. Tự dọn fixture.

## Phân tích Chefs

- `GET /api/admin/chef-analytics/{summary,trends,operations,list}` và `/api/admin/chef-analytics/detail/:id?panel=overview|menu|orders|customers|payments|profile`. Tất cả yêu cầu admin đang hoạt động. Duyệt/tạm ngưng dùng API chef hiện có, bắt buộc lý do cho từ chối/bổ sung/tạm ngưng, ghi audit và thông báo realtime.
- Tám KPI; bộ lọc ngày/khu vực **vị trí bếp**/bữa/tìm kiếm; cảnh báo hiện tại, tăng trưởng và top doanh số/đơn; danh sách 20 bếp/trang. Trạng thái, nhóm, thứ tự và trang chỉ lọc bảng; không đổi tổng báo cáo. URL giữ riêng tham số `c*` và chef đang xem.
- Tổng hợp mọi hồ sơ trong phạm vi, không giới hạn 100. Lọc/sắp xếp/phân trang aggregate trên server sau truy vấn; chi tiết menu/đơn/đánh giá/đối soát dùng COUNT và LIMIT SQL. Thứ tự có ID phá hòa.
- Readiness xét hồ sơ approved, chủ mở, ngân hàng hợp lệ, bếp bật và món hoạt động/enabled/còn suất/chưa cutoff. Bữa qua nửa đêm lấy cả ngày dịch vụ trước. Số liệu hiện tại và chi tiết tự làm mới mỗi phút khi trang đang hiển thị; làm mới giữ nội dung đã tải để tránh nháy UI. Cache lịch sử 20 giây, version request làm mới khi nhận sự kiện hoặc bấm làm mới.
- Duyệt mới theo lần approved đầu ghi nhận trong audit. Tỷ lệ kích hoạt chỉ xét nhóm duyệt trong kỳ đã đủ thời gian; bếp có first paid trước mốc duyệt hoặc thiếu audit được ghi là thiếu mốc hợp lệ. Lượt gửi lại đếm riêng. Mua lại 30 ngày tính tại chính bếp, chỉ xét khách đã đủ tuổi.
- Doanh số theo COMPLETED, sau voucher và tách phí giao; đơn thiếu sự kiện dùng updated_at và có chú thích. Thời gian nhận là trung vị PAID → ACCEPTED hợp lệ. Từ chối chef theo actor; hủy khách/admin/hết hạn được tách trong chi tiết. Tồn đọng đơn/đối soát không bị giấu bởi khoảng ngày.
- `POST /api/admin/chef-analytics/settings` lưu ngưỡng kích hoạt/rating/từ chối vào platform_settings có audit và realtime. Ngưỡng SLA nhận đơn/duyệt/đối soát dùng cấu hình Tổng quan. Không tự tạm ngưng từ cảnh báo, không trả key SePay/password.
- Không thêm bảng/dịch vụ/biến môi trường. Xem định nghĩa, giới hạn lịch sử và lộ trình bổ sung tại `docs/admin-chefs-plan.md`.
- `npm run test:chefs`: hơn 100 bếp, phân trang đầy đủ, readiness/qua nửa đêm, hồ sơ nộp lại, cohort duyệt, doanh số/giảm giá/phí giao, trung vị lẻ/chẵn, actor từ chối/hủy, đối soát cũ/trùng/tuổi giai đoạn, review sorting/sample, sáu tab và validation. Chỉ cho MySQL local và tự dọn fixture. Kiểm tra quyền API tích hợp trong `test:sepay`.

## Bộ kiểm tra chung

`npm test`: ngày Việt Nam, kỳ đối chiếu, CSV, domain và cache.

`npm run test:analytics`: fixture MySQL local, hơn 100 đơn, ngày tạo/hoàn thành khác kỳ, bữa/khu vực, giảm giá/phí giao, cohort đủ 30 ngày, sự kiện lặp, mục tiêu/chi phí và retry. Tự xóa fixture sau khi chạy, từ chối database ngoài localhost.

`TEST_BASE_URL=http://127.0.0.1:3002 npm run test:sepay`: chạy các kiểm tra checkout, SePay, hủy, đối soát, đặt lại và thông báo với bản production local đang chạy.
