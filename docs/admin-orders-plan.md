# Thiết kế thống kê và theo dõi Đơn hàng

Ngày lập: 2026-10-04. Đã triển khai đợt đầu cho Admin → Đơn hàng, sau Users/Chefs/Sản phẩm. Các hạng mục đợt sau ở mục 11 chưa triển khai.

## 1. Mục tiêu và tham khảo

Admin cần biết lượng đơn tăng/giảm, đơn đang mắc ở bước nào, bếp cần hỗ trợ, thanh toán nào chưa khớp, yêu cầu hoàn tiền nào tồn đọng và bữa/khu vực có hiệu quả vận hành cần cải thiện.

Tham khảo nguồn chính thức:

- [Uber Eats — Merchant Order Reliability](https://help.uber.com/en/merchants-and-restaurants/article/guide-to-merchant-order-reliability?nodeId=13f6f5e1-c7e8-4a6c-9e03-9351fd5e99c0): theo dõi khả năng nhận/hoàn thành đơn, đơn hủy và đơn bị bỏ lỡ. Không áp benchmark của nền tảng khác vào bếp cá nhân khi chưa có dữ liệu nền.
- [DoorDash — Operations Quality](https://help.doordash.com/en-ca/merchants/article/merchant-portal-operations-quality): liên kết cảnh báo tới đơn cụ thể; xem chờ xử lý, hủy, phản hồi và thông tin thanh toán liên quan. Mô hình này do chef tự bố trí giao, nên không dùng chỉ số chờ tài xế tại cửa hàng khi chưa thu thập mốc tương ứng.
- [DoorDash — Reporting APIs](https://developer.doordash.com/en-US/api/reporting/): tách báo cáo chi tiết đơn, giao dịch và hủy. Thiết kế dưới đây áp dụng cách phân tách đó vào dữ liệu hiện có của dự án.

## 2. Hiện trạng đã kiểm tra trong code

- `AdminDashboard` tải cả `/api/admin` và `/api/admin/orders`. `listOrders()` giới hạn 100 đơn trước khi UI lọc chef. Chef ít đơn có thể không xuất hiện vì các bếp khác chiếm 100 bản ghi mới nhất.
- Thông báo doanh số trong danh sách cộng `orders.total` của các đơn hoàn thành đã tải, có phí giao và có thể thiếu lịch sử. Cần thay bằng tổng hợp đầy đủ và định nghĩa doanh số rõ.
- `orders` có snapshot người nhận, địa chỉ/tọa độ khách và bếp, khoảng cách, tuyến Goong, giá tiền, voucher, ngân hàng nhận, hạn thanh toán và mốc xác nhận tiền. `order_items` lưu tên/ảnh/giá/số lượng tại checkout.
- `order_events` lưu trạng thái, actor, note và thời gian. Có cả sự kiện `PAYMENT_REPORTED`; sự kiện này không phải trạng thái vận hành mới và không được đặt lại tuổi chờ.
- SePay có giao dịch riêng, thời gian ngân hàng `transaction_date`, thời gian hệ thống nhận `created_at`, kết quả xử lý và thông tin chẩn đoán. Webhook trả `DUPLICATE` khi retry không đồng nghĩa có thêm tiền: giao dịch duy nhất vẫn chỉ một bản ghi. Khoản chuyển thêm thật cho đơn đã trả tiền được lưu `EXTRA_PAYMENT`.
- Thanh toán thủ công có thể xác nhận tiền và nhận đơn trong cùng thao tác ACCEPTED, không có mốc ngân hàng chuyển tiền độc lập. Không dùng chênh lệch gần 0 này làm bằng chứng chef phản hồi nhanh.
- Yêu cầu khách có canonical record tại `payment_request_details`, tối đa một yêu cầu/đơn. Ngoại lệ tự động có thể có nhiều bản ghi cho một đơn. Trạng thái đơn, thanh toán và đối soát độc lập.
- Hoàn tiền hiện là chef gửi bằng chứng và admin duyệt; không có ledger giao dịch tiền ra, số tiền thực hoàn và ngày ngân hàng hoàn được xác minh độc lập.
- Goong là tuyến và thời lượng ước tính lúc đặt. Xe ở giữa tuyến khi DELIVERING là minh họa, chưa có GPS tài xế hoặc thời gian giao cam kết.
- GET danh sách hiện gọi `expireOrders()` và có tác dụng thay đổi đơn. API báo cáo mới phải đọc độc lập; việc hết hạn tiếp tục đi qua luồng nghiệp vụ/cron hiện có. Nếu đọc thấy PLACED đã quá `expires_at`, hiển thị cảnh báo chờ hệ thống xử lý, không tự sửa trạng thái trong query báo cáo.

## 3. Bố cục trang

1. Bộ lọc kỳ 7/30/90 ngày và tùy chọn; chef; bữa; khu vực giao cho khách; tìm mã đơn/mã chuyển khoản/tên người nhận hoặc khách/tên chef.
2. Tám KPI, có phạm vi thời gian ngay trên thẻ và bấm mở đúng danh sách.
3. Thanh trạng thái hiện tại: chờ thanh toán, đã trả tiền/chờ bếp nhận, bếp đã nhận, chuẩn bị, đang giao, đã giao/chờ khách xác nhận. Mỗi ô có số đơn và tuổi chờ lâu nhất nếu có mốc hợp lệ.
4. Khối Đơn cần chú ý, xếp theo mức ưu tiên và thời gian chờ, liên kết tới đúng đơn.
5. Hai biểu đồ mặc định: lượng đơn/doanh số theo ngày và kết quả nhóm đơn tạo trong kỳ.
6. Tabs: Danh sách đơn, Theo dõi xử lý, Thanh toán, Phân tích vận hành. Các báo cáo nặng chỉ tải khi mở tab.
7. Chi tiết đơn mở trong vùng nội dung, giữ URL/bộ lọc/trang khi quay lại; có liên kết tới trang chi tiết đơn hiện có.

Desktop: sidebar admin hiện có, KPI 4 cột × 2 hàng, biểu đồ 2 cột, bảng chiếm phần nội dung. Tablet/mobile: KPI 2 cột, biểu đồ xếp dọc, thẻ đơn gọn hoặc bảng cuộn trong vùng riêng có hướng dẫn. Chữ mảnh, tag màu, không slogan. Làm mới không remount/animate nội dung đã tải; chuyển trang giữ animation hiện có.

Khu vực mặc định là ô 0,02 độ của tọa độ giao trong snapshot đơn, thống nhất Tổng quan. Báo cáo địa bàn bếp dùng trường/bộ lọc riêng nếu thêm sau. Không dùng tọa độ hiện tại của chef để gán lại vùng cho đơn lịch sử. Tọa độ thiếu/hỏng thuộc nhóm Chưa xác định.

Tìm kiếm mở rộng bằng số điện thoại chỉ trong danh sách/chi tiết admin; khi sử dụng phải ghi rõ nó thay phạm vi thống kê. Không đưa số điện thoại hoặc địa chỉ đầy đủ vào biểu đồ khu vực.

## 4. Tám KPI và quy tắc phạm vi

| KPI                     | Định nghĩa                                                                   | Khi bấm                                  |
| ----------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| Đơn phát sinh           | DISTINCT order_id tạo trong kỳ                                               | Danh sách theo ngày tạo                  |
| Đơn xác nhận thanh toán | DISTINCT order_id có mốc xác nhận thanh toán trong kỳ, kể cả sau đó hủy/hoàn | Danh sách theo ngày xác nhận tiền        |
| Đơn hoàn thành          | DISTINCT order_id COMPLETED có mốc hoàn thành trong kỳ                       | Danh sách theo ngày hoàn thành           |
| Doanh số món            | SUM(subtotal − discount) của đơn hoàn thành trong kỳ; tách phí giao          | Cùng nhóm hoàn thành, xếp doanh số       |
| Đơn đang xử lý          | Hiện tại thuộc PLACED/PAID/ACCEPTED/PREPARING/DELIVERING/DELIVERED, mọi ngày | Tab Theo dõi xử lý, bỏ giới hạn ngày     |
| Đơn cần chú ý           | DISTINCT order_id có ít nhất một cảnh báo hiện hành, mọi ngày                | Nhóm cần chú ý, bỏ giới hạn ngày         |
| Đơn hủy / từ chối       | Nhóm đơn tạo trong kỳ đang CANCELLED hoặc REJECTED; tách hai số phụ          | Danh sách nhóm tạo trong kỳ + trạng thái |
| Đơn hết hạn             | Nhóm đơn tạo trong kỳ đang EXPIRED                                           | Danh sách nhóm tạo trong kỳ + EXPIRED    |

Chỉ số theo kỳ có so kỳ trước cùng độ dài; không có mẫu nền thì Chưa có kỳ đối chiếu. Hiện trạng không dựng kỳ trước từ trạng thái hiện tại. Chef/bữa/khu vực/tìm kiếm áp dụng toàn phạm vi. Trạng thái thanh toán/trạng thái đơn/nhóm cảnh báo/thứ tự/trang chỉ thay bảng, không âm thầm thay KPI.

Các chỉ số theo ngày tạo, xác nhận tiền và hoàn thành là các tập khác nhau, không cộng/trừ chúng như các bước phễu. Một đơn tạo kỳ trước có thể thanh toán/hoàn thành kỳ này.

KPI mở bảng với `dateBy=created|paid|completed` và `scope=period|current`; UI hiện tên mốc ngày và nhãn Mọi ngày ở chế độ hiện trạng. Khi bấm KPI đổi scope/mốc ngày/trạng thái cần thiết và xóa bộ lọc bảng xung đột. Khoảng ngày vẫn lưu trong URL để quay lại phân tích lịch sử; UI thể hiện rõ nó không giới hạn backlog hiện tại.

Chỉ số phụ trong tab phân tích: khách đặt duy nhất, chef có đơn, số món/số phần, giá trị món bình quân/đơn hoàn thành, phí giao, voucher, tỷ lệ kết quả đã chốt và thời gian xử lý có mẫu.

## 5. Trạng thái, tuổi chờ và cảnh báo

Ba tag độc lập trên mỗi đơn:

- Đơn: Chờ thanh toán (cam), Đã thanh toán (xanh dương), Bếp đã nhận/Chuẩn bị (tím), Đang giao (xanh lam), Đã giao (xanh ngọc), Hoàn thành (xanh lá), Từ chối/Hủy (đỏ), Hết hạn (xám).
- Thanh toán: Chờ tiền, Thiếu tiền, Cần đối soát, Đã xác nhận tự động, Đã xác nhận thủ công, Chờ hoàn, Đã ghi nhận hoàn thủ công. Giá trị lạ có nhãn Chưa xác định thay vì làm mất đơn.
- Đối soát: Chờ chef, Chờ hệ thống, Đã xử lý. Nếu nhiều ngoại lệ, hiện số yêu cầu đang mở và trạng thái theo ưu tiên; trong chi tiết xem từng yêu cầu, không chọn một bản ghi tùy tiện.

Tuổi giai đoạn dùng lần vào **trạng thái hiện tại** từ `order_events`, phá hòa bằng ID. Bỏ sự kiện báo chuyển tiền và các note không chuyển trạng thái. PAID dùng payment event/mốc xác nhận hợp lệ; PLACED dùng created_at. Thiếu mốc giai đoạn ghi Chưa đủ mốc và đưa vào nhóm chất lượng dữ liệu; không dùng updated_at bị webhook hoặc sửa note làm thay đổi để đo SLA.

| Cảnh báo                     | Điều kiện và mốc                                                                    | Hành động                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Đã trả tiền, bếp chậm nhận   | Status PAID; quá `analytics_sla.acceptMinutes` từ lúc xác nhận tiền                 | Xem đơn, mở chef, liên hệ                                   |
| Chuẩn bị lâu                 | Status ACCEPTED hoặc PREPARING; tuổi từng giai đoạn vượt ngưỡng theo dõi            | Xem lịch sử, liên hệ chef                                   |
| Đang giao lâu                | Status DELIVERING; quá ngưỡng theo dõi từ mốc bắt đầu giao                          | Liên hệ chef; nhãn Cần kiểm tra, không kết luận trễ cam kết |
| Đã giao, chưa xác nhận       | Status DELIVERED; tuổi chờ vượt ngưỡng                                              | Xem đơn/liên hệ, không tự hoàn thành                        |
| Tiền cần kiểm tra            | PARTIAL/PAYMENT_REVIEW hoặc có khoản LATE/EXTRA_PAYMENT chưa được xử lý             | Mở tab thanh toán và đối soát                               |
| Đối soát quá hạn             | OPEN/REVIEW canonical hoặc ngoại lệ hợp lệ; dùng SLA mỗi giai đoạn                  | Mở quản lý đối soát đúng đơn/chef                           |
| Hết hạn chưa cập nhật        | PLACED, now > expires_at                                                            | Xem trạng thái hệ thống, không gọi đây là đơn đã EXPIRED    |
| Thiếu mốc/số liệu không khớp | Trạng thái thiếu event, thời gian âm/khác thứ tự hoặc tổng dòng/giá tiền không khớp | Xem bằng chứng dữ liệu; không tự sửa                        |

Ưu tiên đề xuất: tiền trên đơn kết thúc/yêu cầu quá hạn → PAID chậm nhận → chuẩn bị/giao lâu → đã giao chờ khách → dữ liệu cần kiểm tra. DISTINCT order_id cho KPI; số cảnh báo riêng có thể lớn hơn số đơn.

Ngưỡng nhận đơn và đối soát dùng SLA Tổng quan hiện có. Ngưỡng kiểm tra ban đầu đề xuất: ACCEPTED 15 phút, PREPARING 45 phút, DELIVERING 60 phút, DELIVERED 120 phút, grace hệ thống hết hạn 5 phút; lưu cấu hình được trong platform_settings có audit. Đây là ngưỡng theo dõi sản phẩm, cần hiệu chỉnh theo dữ liệu thực tế, chưa là lời hứa giao hàng. Không tự hủy, nhận, hoàn thành hoặc hoàn tiền từ cảnh báo.

## 6. Biểu đồ và báo cáo chiến lược

### Trang đầu

1. Xu hướng theo ngày: chọn đơn phát sinh (ngày tạo), hoàn thành (ngày hoàn thành) hoặc doanh số món (ngày hoàn thành), so kỳ trước; một thang đo mỗi lần và bảng số liệu kèm theo.
2. Kết quả của nhóm đơn tạo trong kỳ: Hoàn thành, Hủy, Từ chối, Hết hạn, Còn xử lý. Cột số lượng và tỷ trọng, ghi ngày nhóm/as-of; bấm lọc danh sách. Đây là kết quả hiện tại của cùng nhóm đơn, không phải phễu ghép các KPI khác tập.

### Theo dõi xử lý

- Bảng theo giai đoạn: số đơn, số vượt ngưỡng, tuổi lâu nhất và đơn liên quan. Có preset Toàn bộ đang xử lý / Đã trả tiền / Cần chú ý / Chờ chef / Chờ khách.
- Bảng đang xử lý xếp cảnh báo trước, sau đó tuổi chờ giảm dần; phá hòa bằng ID. Không bỏ đơn cũ chỉ vì chọn báo cáo 7 ngày. Tự cập nhật mỗi phút khi visible và khi nhận WebSocket.

### Phân tích vận hành

- Heatmap thứ × giờ tạo đơn theo giờ Việt Nam; bữa từ meal_id snapshot. Không coi giờ hoàn thành là giờ phát sinh nhu cầu.
- Thời gian từng đoạn: tạo → xác nhận tiền; PAID tự động → ACCEPTED; ACCEPTED → PREPARING; PREPARING → DELIVERING; DELIVERING → DELIVERED; DELIVERED → COMPLETED. Median và P90 (nearest-rank ceil(0,9×n)), số mẫu/mốc thiếu; n<20 thì P90 Chưa đủ mẫu. Cho lọc theo mốc kết thúc đoạn trong kỳ, ghi rõ nó khác cohort ngày tạo.
- Chỉ lấy cặp event đúng thứ tự, không âm; không nội suy bước bỏ qua. Manual xác nhận và nhận đơn cùng lúc được báo riêng, loại khỏi latency phản hồi sau tiền. Đơn còn xử lý chỉ báo tuổi chờ, không trộn vào duration đã kết thúc. DELIVERED là chef báo giao; COMPLETED là xác nhận khách/admin, không đồng nhất thời điểm giao thật.
- Hủy/từ chối: theo actor event cuối tương ứng (chef/khách/admin/hệ thống/chưa xác định), note và đã có mốc trả tiền hay chưa. EXPIRED là hệ thống kể cả event actor_id=user_id. Chưa có reason_code chuẩn nên không tự phân loại nguyên nhân/khả năng tránh từ text hay gán mọi hủy là lỗi chef.
- Bảng chef: nhóm đơn tạo trong kỳ, kết quả chốt/chưa chốt, số PAID đang chậm nhận, median/P90 có mẫu và số đơn có đối soát. Doanh số hoàn thành theo kỳ có cột ghi rõ phạm vi riêng. Chưa xếp hạng tỷ lệ bếp ít mẫu (<20 kết quả đã chốt), vẫn hiển thị số thực.
- Bảng khu vực giao/bữa: lượng tạo mới, hoàn thành trong cùng nhóm, hủy/từ chối/hết hạn, số đang xử lý; báo số mẫu và khoảng cách snapshot. So khoảng cách đường bộ và đường thẳng riêng, không thay thế số thiếu bằng 0.

Tỷ lệ hoàn thành của nhóm tạo = COMPLETED / toàn bộ đơn tạo trong nhóm, luôn kèm Còn xử lý. Tỷ lệ hoàn thành trên kết quả đã chốt = COMPLETED / (COMPLETED+CANCELLED+REJECTED+EXPIRED), ghi đúng mẫu số. Không gọi hai tỷ lệ này cùng một tên. Tỷ lệ hủy trên nhóm đã trả tiền dùng mốc payment-confirmed gốc, không dùng payment_status hiện tại vì có thể đã chuyển REFUND_PENDING/REFUNDED_MANUAL.

## 7. Tab Thanh toán

- Tổng hợp đơn đã xác nhận theo kỳ/mốc xác nhận: số đơn, giá trị total của các đơn đó, tách tự động và thủ công. Đây là giá trị đơn đã xác nhận, chưa phải số tiền ngân hàng thực nhận.
- Bảng đơn chưa khớp: giá trị cần trả; tiền SePay hợp lệ đã ghi nhận; phần thiếu/thừa nếu xác định được; thời điểm giao dịch; thời điểm nhận webhook; số khoản chuyển; kết quả và lý do đối soát.
- Khoản SePay hợp lệ gắn đúng đơn/ngân hàng snapshot gồm PARTIAL/PAID/OVERPAID/LATE/EXTRA_PAYMENT, cộng bản ghi duy nhất. ACCOUNT_MISMATCH/INVALID_DATE/UNMATCHED và khoản chưa kết luận tách nhóm điều tra, không cộng vào tiền của đơn. Không lấy `received_amount` hiện tại làm tổng đầy đủ mọi khoản vì alias đó chỉ gồm PARTIAL/PAID/OVERPAID.
- Chưa có SePay tương ứng trên đơn PAID_MANUAL thì hiện Chưa có dữ liệu ngân hàng, không ghi thực nhận = total hoặc thiếu tiền = total. Nếu có xác nhận tay và giao dịch tự động, trình bày hai nguồn, không cộng xác nhận tay như một khoản tiền thứ hai.
- Khi kỳ theo transaction_date, số tiền là giao dịch ngân hàng trong kỳ; khi kỳ theo created_at, đó là webhook hệ thống ghi nhận trong kỳ. Cho chọn mốc rõ trong tab, báo giao dịch lệch kỳ và dữ liệu theo dõi có thể chưa đầy đủ. Kết quả đối soát có thể thay đổi sau retry, cần nhãn Theo trạng thái xử lý hiện tại.
- Giao dịch không khớp đơn nằm trong bảng riêng có pagination và tổng số, không bị mất do JOIN orders. Filter bữa/vùng giao không áp được với khoản chưa có order; chỉ lọc chef/kỳ/chẩn đoán và ghi rõ nhãn Chưa có phạm vi đơn. Không ép khoản này vào bữa/khu vực ngẫu nhiên.
- Yêu cầu cấp đơn tách số đơn có yêu cầu, số yêu cầu và số tiền đang yêu cầu xử lý. Không cộng số tiền exception trùng làm nghĩa vụ hoàn chính xác. Ngay khi chưa có ledger khoản hoàn, không tính tiền ròng sau hoàn hoặc số dư chef.
- RESOLVED là giải quyết, không luôn là trả tiền. REFUNDED là đã duyệt phương án/bằng chứng hoàn thủ công theo hệ thống, chưa là xác minh tiền ra ngân hàng. Số `exception.amount` có thể là khoản chuyển hoặc giá trị đơn cần xem xét, chưa là số tiền thực hoàn. Báo hoàn chính xác cần số tiền/thời gian/mã giao dịch hoàn riêng ở đợt sau.
- Đối soát vẫn xử lý qua luồng `/admin?tab=payments` hiện có; từ Đơn hàng chuyển tới đúng order_id/request_id/chef, không tạo luồng duyệt thứ hai.

## 8. Danh sách và chi tiết

### Bảng danh sách

- Mã đơn/ngày theo mốc đang chọn, ảnh thật snapshot, tên món tóm tắt, số món riêng/số phần.
- Chef, tên khách/người nhận; liên hệ đầy đủ nằm trong chi tiết admin.
- Ba nhóm tag đơn/thanh toán/đối soát.
- Giá trị món sau voucher, tổng cần trả và phí giao; không gọi total là doanh số món. Nguồn tiền tự động/thủ công, thông tin khớp hiển thị khi đủ dữ liệu.
- Giai đoạn hiện tại, tuổi chờ, cảnh báo; nút Xem chi tiết/Mở chef/Mở đối soát phù hợp.
- Cột nâng cao: voucher, khu vực giao, khoảng cách snapshot, thời điểm trả tiền/nhận/giao/hoàn thành, thời lượng từng bước có mốc.

Bộ lọc bảng: trạng thái đơn, trạng thái thanh toán, có yêu cầu/cảnh báo, actor hủy, nguồn xác nhận; `dateBy`, scope. Phân trang 20 đơn SQL COUNT/LIMIT; sort mới/cũ, tuổi chờ, giá trị, ưu tiên cảnh báo + ID. Tìm kiếm literal, validate enum/ngày, giới hạn độ dài và khoảng báo cáo như các mục khác. Không tính tổng từ một trang.

URL dùng `o*` cho bộ lọc riêng, order đang chọn và tab chi tiết; chef global tương thích điều hướng từ Tổng quan/Chefs/Sản phẩm. Link `filter=active` hiện có ánh xạ sang current/all-days. Đổi lọc reset trang; đóng chi tiết/back giữ phạm vi và page. Nếu CSV ở đợt sau: xuất đúng toàn bộ bộ lọc, không chỉ trang hiện tại, kiểm tra quyền và chống spreadsheet formula.

### Bốn tab chi tiết

1. Tổng quan: người đặt/người nhận/chef/liên hệ, món snapshot, số phần, giá checkout, voucher/phí giao/tổng và các tag. Hồ sơ món/bếp hiện tại không thay thông tin giá/tọa độ snapshot.
2. Tiến trình: mỗi mốc có actor, thời gian, note và thời lượng đủ dữ liệu; chọn bước để xem lịch sử, không tạo timeline trùng. Thiếu event ghi Chưa ghi nhận. Dùng ghi chú giải thích manual payment và xác nhận đã giao/hoàn thành.
3. Thanh toán & đối soát: snapshot ngân hàng, mã chuyển khoản, bảng giao dịch và chẩn đoán, yêu cầu khách/ngoại lệ tự động, sđt liên hệ, bằng chứng private qua API kiểm tra quyền, lịch sử gửi/duyệt. Nút mở luồng đối soát hiện có.
4. Giao hàng & phản hồi: địa chỉ/tọa độ snapshot và tuyến Goong tải khi mở; không GPS thật, không kết luận tiến độ từ icon. Review cả đơn nếu có, tên khách/thời gian/nội dung; các bước cập nhật bởi chef/admin có actor riêng.

Thao tác thay trạng thái tiếp tục dùng transition hiện có và kiểm tra server/lock; không thêm sửa tùy ý trạng thái hoặc xác nhận SePay bằng UI. Can thiệp admin có dialog, lý do bắt buộc cho thay đổi mang tính override, thông báo hai bên và audit. Không có thao tác hàng loạt thanh toán/hủy/hoàn ở đợt đầu.

## 9. Quy tắc dữ liệu và tài chính

- Asia/Ho_Chi_Minh, từ đầu ngày bao gồm đến trước đầu ngày sau cận cuối. Kỳ đối chiếu cùng độ dài.
- CTE/derived tables mỗi order_id một dòng: aggregate events/items/transactions/requests trước JOIN. Một đơn nhiều món/nhiều giao dịch/nhiều requests không nhân tổng đơn hoặc tiền. Giữ lịch sử kể cả chef/sản phẩm ẩn hoặc thiếu catalog bằng LEFT JOIN và nhãn thiếu liên kết.
- Tổng món từ unit_price snapshot × quantity; kiểm tra subtotal và `total = subtotal − discount + delivery_fee`. Sale đã trong unit_price/subtotal; không trừ thêm sale. Hiển thị sự khác biệt dữ liệu cũ thay vì chỉnh số liệu để khớp giả.
- GMV món = subtotal − discount trên COMPLETED. Phí giao riêng. Giá trị đơn xác nhận tiền = total theo mốc xác nhận. Giao dịch ngân hàng theo transaction_date là nhóm thứ ba. Không trộn ba tập này hoặc coi GMV là doanh thu/lợi nhuận nền tảng.
- Mốc hoàn thành ưu tiên event gốc; legacy dùng updated_at giống các mục trước và có tổng bản ghi fallback. Các mốc khác thiếu thì không dựng từ trạng thái hiện tại. Báo độ phủ event/payment source và mẫu hợp lệ của từng latency.
- Payment mode snapshot `sepay_order_settings.automatic` chỉ thể hiện cấu hình lúc đặt; nguồn xác nhận thực tế dựa event gốc/payment-confirmed đã ghi nhận. Không suy nguồn từ SePay enabled hiện tại hay payment_status đã bị đổi sau hoàn.
- Tuổi OPEN = reviewed_at của lần admin trả về chef nếu có, nếu không created_at; REVIEW = submitted_at. Yêu cầu customer legacy dùng canonical d.exception_id, giữ bản ghi trùng chỉ để tra lịch sử. System exceptions riêng vẫn giữ; khi KPI là số đơn thì DISTINCT order_id.
- Snapshot khu vực giao/bếp tránh vị trí hiện tại làm đổi báo cáo cũ. Analytics mới không ghi địa chỉ đầy đủ/GPS chính xác vào bảng hành vi.
- API báo cáo không lộ password hash, session, webhook key/hash; summary/list trả field whitelist, detail admin mới trả liên hệ/ngân hàng cần thiết. Evidence dùng asset API đã kiểm tra quyền.

## 10. API, hiệu năng và cập nhật

- API admin riêng: GET `/api/admin/order-analytics/{summary,trends,operations,list,performance,payments}` và `/detail/:id?panel=overview|timeline|payments|delivery`.
- POST `/api/admin/order-analytics/settings` cho ngưỡng kiểm tra mới; giữ SLA chung hiện có. platform_settings/audit_logs/WebSocket/outbox hiện có; đợt đầu không thêm dịch vụ hoặc env.
- Tách order event projection/financial projection dùng chung định nghĩa với Tổng quan/Chefs/Sản phẩm; không copy ba cách tính hoàn thành khác nhau. Kiểm tra chéo cùng scope trên production.
- Lọc/sắp xếp/phân trang xuống SQL cho orders và transactions ngay đợt đầu vì lịch sử đơn tăng nhanh hơn catalog. COUNT và aggregate toàn phạm vi; query param thay được COUNT/list nhất quán.
- Dùng EXPLAIN trên MySQL/TiDB; rà index orders(created_at,id), orders(payment_confirmed_at,id), orders(status,created_at,id), orders(chef_id,created_at,id), order_events(status,created_at,order_id), transaction_date/created_at của SePay. Chỉ thêm index thiếu và hữu ích theo query thật bằng migration idempotent, tránh lặp orders_chef/events_order hiện có.
- Cache báo cáo lịch sử 20 giây; operations/current bỏ cache hoặc TTL rất ngắn, không làm nguồn quyết định trạng thái/tiền. Báo cáo tải độc lập, failure một phần không làm mất bảng.
- WebSocket `admin-analytics`/notification invalidation khi đơn/thanh toán/đối soát cập nhật; tự kiểm tra mỗi phút khi visible, request version giữ nội dung tránh nháy, hiển thị lần cập nhật. Giao dịch chưa khớp đơn cũng cần phát invalidation cho admin, không chỉ giao dịch PAID.
- API báo cáo chỉ đọc; không gọi listOrders() hiện có để tránh LIMIT100 và side effect expire. Cron/transition xử lý hết hạn và backend checkout tiếp tục thực thi nghiệp vụ.
- Load chart bằng SVG/code hiện có, lazy các tab nâng cao và bản đồ; không thêm thư viện chart lớn. Khi lịch sử lớn hơn, cân nhắc projection timestamp và bảng tổng hợp ngày sau khi đo latency, không tải tất cả đơn vào bộ nhớ để phân trang.

## 11. Lộ trình

### Đợt đầu — dữ liệu hiện có

- Tám KPI, trạng thái/current backlog, cảnh báo/ngưỡng, hai biểu đồ, SQL filtering/pagination, bốn tab chi tiết.
- Tab vận hành: giờ tạo, duration có mẫu, kết quả theo cohort, chef/khu vực và actor hủy với note. Không suy reason tự động.
- Tab thanh toán: xác nhận tiền so với tiền SePay ghi nhận, khoản không khớp đơn, bộ lọc mốc ngày và đối soát qua luồng hiện có.
- Audit/invalidation bổ sung nếu còn thiếu ở can thiệp admin, webhook exception và resolution; RBAC/validation/private files như hiện tại. Có chỉ dẫn dữ liệu thiếu và fallback.

### Đợt sau — bổ sung dữ liệu để đo sâu

- Reason code hủy/từ chối có actor/origin chuẩn (system/chef/customer/admin), ghi từ thời điểm triển khai; không đổi nghĩa text lịch sử.
- Snapshot prep time, thời điểm sẵn sàng bàn giao, ETA giao cam kết và các lần cập nhật ETA. Khi đó mới có tỷ lệ giao đúng cam kết/đợi lấy món.
- Ledger hoàn tiền: amount/refunded_at/reference/method/evidence/approval, nhiều lần hoàn một yêu cầu nhưng tổng kiểm soát, xác minh khoản tiền ra. Không tự chuyển tiền ngân hàng từ dashboard.
- Event immutable cho chu kỳ exception/review, phiên bản kết quả SePay retry và payment confirmation origin; hỗ trợ truy vết và báo cáo as-of khi cần.
- Rollup ngày/projection mốc vận hành, snapshot label chef cần bảo toàn dài hạn; CSV phạm vi đầy đủ và tác vụ export có giới hạn.
- Mua lại sau hủy/đối soát theo nhóm khách đủ tuổi quan sát, mục tiêu SLA theo bữa/khu vực và theo dõi xu hướng. Cần cohort/cửa sổ rõ, không kết luận nguyên nhân từ tương quan.
- GPS người giao chỉ khi có quy trình/người giao/tracking thực; vẫn giữ chef tự bố trí giao trong mô hình ba vai trò hiện tại.

## 12. Quyết định admin có thể đưa ra

| Dữ liệu                                                    | Hướng hành động                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Nhiều PAID chậm nhận ở một chef/bữa                        | Kiểm tra khả năng nhận đơn, thông báo và hỗ trợ chef điều chỉnh lịch/suất                    |
| Nhiều đơn thiếu/thừa/sai mã, trong khi tạo đơn ổn          | Kiểm tra QR, snapshot ngân hàng và cấu hình đối soát                                         |
| Còn nhiều đơn cũ trong bước chuẩn bị/giao                  | Liên hệ chef để xác minh, điều chỉnh quy trình; chưa tự quy lỗi vận chuyển                   |
| Một bữa/vùng có nhiều đơn nhưng completion thấp với đủ mẫu | Đọc actor/note và lịch sử thanh toán, phối hợp bổ sung nguồn cung phù hợp                    |
| Chờ admin duyệt đối soát tăng                              | Phân bổ thời gian xử lý, đọc bằng chứng, theo dõi tuổi giai đoạn                             |
| Giá trị món bình quân tăng nhưng đơn giảm                  | Xem kết hợp số phần, giá snapshot, ưu đãi và kết quả khách; chưa coi là tăng trưởng bền vững |

## 13. Kiểm tra bắt buộc khi triển khai

- > 100 đơn, chef ngoài 100 bản ghi mới nhất vẫn tìm được; COUNT/KPI đúng, pagination ổn định, literal search/enum/date validation.
- Nhiều order_items/events/SePay/requests trên cùng order; aggregate không nhân, đơn/giao dịch unique sau retry; EXTRA_PAYMENT phân biệt retry DUPLICATE.
- Created/paid/completed/transaction/webhook khác kỳ; đúng giờ Việt Nam, so cùng độ dài, số 0 không bịa growth; cohort/status tổng khớp.
- PLACED quá expiry chưa EXPIRED; backlog/đối soát cũ không bị filter ngày che; report GET không mutate dữ liệu nghiệp vụ.
- Manual ACCEPTED/payment cùng lúc không tạo latency nhận đơn gần 0 giả; event thiếu/âm/khác thứ tự có nhãn/mẫu riêng; P90 dưới ngưỡng thiếu mẫu.
- Order đã trả tiền sau hủy đổi payment_status vẫn nằm trong paid history; refund approval không giả định bank cash-out; OVERPAID/LATE/EXTRA_PAYMENT/ACCOUNT_MISMATCH/UNMATCHED đúng scope.
- Yêu cầu customer trùng legacy và nhiều system exceptions: canonical/tuổi OPEN/REVIEW/DISTINCT order đúng, không cộng yêu cầu thành tiền hoàn chính xác.
- Snapshot món/giá/vị trí tuyến giữ đúng khi chef đổi giá/địa chỉ, món/chef ẩn/thiếu; phívoucher/sale đối chiếu với báo cáo Sản phẩm/Chefs/Tổng quan cùng scope.
- RBAC active admin, validation setting/override/reason; evidence private, không keys/password/session; mutation ghi audit/notify và invalidate.
- KPI click đổi đúng dateBy/scope, link active/chef từ các mục cũ tương thích; đóng/back giữ URL/page, tab độc lập, refresh không nháy.
- Responsive1920/1024/768/390 không document overflow; chart có bảng số, hiện trạng không dùng fake GPS/ETA để báo giao trễ.
- Build/typecheck và fixture MySQL local tự dọn; smoke TiDB production chỉ đọc, đo thời gian query để kiểm tra giới hạn Vercel.
