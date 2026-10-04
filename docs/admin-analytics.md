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

## Phân tích Sản phẩm

- `GET /api/admin/product-analytics/{summary,trends,operations,list,supply}` và `/api/admin/product-analytics/detail/:id?panel=overview|menu|orders|reviews|history`. Tất cả API yêu cầu admin đang hoạt động. `POST /api/admin/product-analytics/settings` lưu ngưỡng vào platform_settings, có audit/realtime. Ẩn/hiện món dùng API hiện có, bắt buộc lý do sau trim.
- Tám KPI; so kỳ trước cho món đã bán, số phần, doanh số và món mới; biểu đồ sức bán/top 10; cảnh báo có bộ lọc nhóm trước giới hạn 30. Bộ lọc ngày/chef/khu vực bếp/bữa/tìm kiếm có phạm vi rõ. Trạng thái/nhóm/thứ tự/trang chỉ thay danh sách. URL tham số `p*` giữ trạng thái khi xem chi tiết/quay lại.
- SQL tổng hợp toàn bộ phạm vi, lọc/sắp xếp/phân trang danh sách trên server sau truy vấn; 20 món/trang, ID phá hòa. Menu/đơn/review/audit chi tiết dùng COUNT/LIMIT SQL. Facts cache 20 giây, operations/supply đọc mới, tự kiểm tra mỗi phút khi tab visible. Version request và cache client giữ UI khi refresh. Cần tối ưu lọc SQL/tổng hợp định kỳ khi dữ liệu lớn; hiện chưa có kiểm tra tải ở quy mô lớn.
- Voucher được chia trên toàn đơn bằng DECIMAL và phân bổ phần dư VND ổn định trước lọc sản phẩm. Gộp dòng cùng product/order trước đếm đơn/khách/review. Giá snapshot tại checkout, không trừ sale hai lần; doanh số COMPLETED không gồm phí giao hoặc suy ra tiền hoàn theo món. Đơn cũ thiếu completion event dùng updated_at có cảnh báo.
- Lịch sử thiếu product vẫn giữ doanh số, có nhóm riêng và không có thao tác ẩn/hiện. Rating là đánh giá **đơn có món**, kèm số mẫu/user/món/thời gian và sorting. Review từ cùng đơn chỉ đếm một lần cho mỗi món. Đối soát cấp đơn có canonical request và tuổi giai đoạn, không cộng tiền hoàn toàn đơn vào từng món.
- Ready kiểm tra product/chef/chủ/ngân hàng/session/menu/suất/cutoff, gồm bữa qua nửa đêm ngày dịch vụ trước. Suất khả dụng có thể đã trừ phần giữ cho đơn chưa trả tiền, chưa phải tỷ lệ bán hết. Nguồn cung theo vị trí bếp không bảo đảm giao được mọi địa chỉ khách; checkout tiếp tục kiểm tra bán kính.
- Phiên xem/thêm giỏ là số phiên độc lập; lượt thích là hiện trạng. Có thời điểm bắt đầu ghi nhận và số đơn có analytics context; chưa có impression/checkout item snapshot nên chưa tính funnel món. Audit chef tạo/sửa món bắt đầu từ lần cập nhật này, không tái tạo lịch sử giá hoặc tồn kho.
- Không thêm dịch vụ/bảng/biến môi trường. Xem định nghĩa và đợt sau tại `docs/admin-products-plan.md`.
- `npm run test:products`: hơn 100 món, literal search/phân trang, voucher/làm tròn/lọc món, nhiều dòng/menu/review, ngày hoàn thành/legacy/orphan, readiness/qua nửa đêm, đối soát/tuổi giai đoạn, nguồn cung/heatmap, phiên/favorites, mua lại, năm tab, audit/outbox và lưu ngưỡng. Fixture chỉ chạy MySQL local, tự dọn và khôi phục cấu hình. Kiểm tra quyền API trong `test:sepay`.

## Phân tích Đơn hàng

- `GET /api/admin/order-analytics/{summary,trends,operations,list,performance,payments}` và `/detail/:id?panel=overview|timeline|payments|delivery`, yêu cầu admin đang hoạt động. Danh sách/tiến trình/giao dịch và bảng chef/vùng giao dùng SQL COUNT/LIMIT 20, có ID phá hòa; bỏ payload admin/orders giới hạn 100 trên giao diện mới.
- Tám KPI, kỳ đối chiếu cùng độ dài, xu hướng và kết quả của cùng nhóm tạo; bộ lọc ngày/chef/vùng **địa chỉ giao snapshot**/bữa/tìm literal. Bộ lọc bảng không đổi KPI. KPI chuyển đúng mốc created/paid/completed; current/attention dùng toàn bộ ngày. URL `o*`, `chef`, `order` giữ trang, tab, chi tiết và Back.
- Theo dõi giai đoạn và cảnh báo lấy thời điểm thực vào trạng thái; PAYMENT_REPORTED không đặt lại tuổi chờ. Cảnh báo hết hạn chờ hệ thống không tự hủy/expire khi mở báo cáo. API chỉ đọc nghiệp vụ, không gọi listOrders/expireOrders hoặc backfill request; khởi tạo DDL chỉ bổ sung schema/index thiếu.
- GMV COMPLETED sau voucher, không gồm giao. Giá trị đơn xác nhận theo paid_at tách với tiền SePay theo transaction_date/created_at. Chỉ khoản hợp lệ đúng snapshot chef/bank/account và không có subaccount được cộng; retry DUPLICATE không tạo khoản chuyển thêm. Nguồn xác nhận tay có audit từ lần triển khai này, trường hợp cũ mất nguồn hiển thị chưa rõ. Định nghĩa hoàn thành dùng chung các báo cáo, fallback updated_at có nhãn.
- Nhóm giao dịch chưa gắn đơn chỉ áp chef/kỳ/txQ; vùng giao/bữa/tìm đơn không áp dụng và có thông báo. Đối soát hiện tại dùng canonical customer request cộng ngoại lệ hệ thống; tuổi OPEN dùng reviewed_at/created_at, REVIEW dùng submitted_at. Số tiền yêu cầu không phải nghĩa vụ hoàn chính xác, RESOLVED không khẳng định đã trả tiền ra ngân hàng.
- Median/P90 chỉ dùng cặp mốc hợp lệ theo ngày kết thúc; P90 nearest-rank yêu cầu 20 mẫu. Nhận thủ công và xác nhận tiền cùng thao tác loại khỏi phản hồi sau tiền. Bảng chef/vùng có kết quả chốt/còn chờ, heatmap giờ tạo theo giờ Việt Nam và actor hủy; không suy nguyên nhân từ text.
- `POST /api/admin/order-analytics/settings` lưu ngưỡng theo dõi (15/45/60/120 phút, đệm expiry 5 phút mặc định), có audit/realtime; SLA nhận tiền và đối soát dùng cấu hình chung. `POST /transition/:id` chỉ cho chuyển hợp lệ, lý do trim 5–500 ký tự, dùng transaction/lock hiện có; ghi audit và thông báo hai bên. UI không thêm nút xác nhận thay SePay tự động.
- Bốn mục chi tiết tải riêng; evidence private qua `/api/files/:id`; Goong chỉ tải khi bấm hiển thị, ghi rõ icon mô phỏng. Không trả keys/password/session. Đối soát dẫn tới luồng duyệt hiện có với đúng order/request/chef.
- Cache trends/performance 20 giây, giới hạn 12 mục; version invalidation qua WebSocket hiện có. Current/payments đọc mới, tự làm mới mỗi phút khi visible và giữ nội dung tránh nháy. Webhook chưa khớp/ngoại lệ và resolution cũng phát admin-analytics.
- Index idempotent tại `order-report-schema.ts`: orders(created_at,id), orders(payment_confirmed_at,id), orders(chef_id,created_at,id), order_events(status,created_at,order_id), sepay_transactions(chef_id,transaction_date). Tái sử dụng index sepay_chef(chef_id,created_at); không tạo trùng index có cùng prefix. Lần đầu cần quyền CREATE INDEX; không có dịch vụ, dependency hay env mới. Chưa kiểm tra tải ở quy mô lịch sử lớn; rollup/projection ở đợt sau.
- `npm run test:orders`: >100 đơn, SQL pages/EXPLAIN, literal filters, ngày tạo/xác nhận/hoàn thành/ngân hàng/webhook khác nhau, ảnh/giá snapshot, fee/voucher, nhiều items/events/receipts/requests không nhân, tài khoản sai, đơn cũ/report read-only, canonical tuổi request, manual audit sau hoàn, missing/negative pairs và P90 19/20, bốn panels/pages, settings/RBAC/audit. MySQL local, tự dọn và khôi phục settings. `test:sepay` có báo cáo/chi tiết/admin transition/RBAC mới và hồi quy luồng thanh toán.

## Bộ kiểm tra chung

`npm test`: ngày Việt Nam, kỳ đối chiếu, CSV, domain và cache.

`npm run test:analytics`: fixture MySQL local, hơn 100 đơn, ngày tạo/hoàn thành khác kỳ, bữa/khu vực, giảm giá/phí giao, cohort đủ 30 ngày, sự kiện lặp, mục tiêu/chi phí và retry. Tự xóa fixture sau khi chạy, từ chối database ngoài localhost.

`TEST_BASE_URL=http://127.0.0.1:3002 npm run test:sepay`: chạy các kiểm tra checkout, SePay, hủy, đối soát, đặt lại và thông báo với bản production local đang chạy.
