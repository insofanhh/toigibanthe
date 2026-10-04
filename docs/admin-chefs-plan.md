# Thiết kế thống kê và quản lý Chefs

Ngày lập và triển khai: 2026-10-04. Đợt đầu đã được triển khai; các hạng mục đợt sau nằm ở mục 9 và 10.

## 1. Mục tiêu quản trị

Admin cần trả lời được: hồ sơ nào cần duyệt; bao nhiêu bếp thực sự nhận được đơn; bếp nào có hiệu quả tốt; bếp nào cần hỗ trợ về vận hành, khách hàng hoặc thanh toán; khu vực/bữa nào cần bổ sung nguồn cung.

Phạm vi đợt đầu: tám KPI bấm để lọc, hai biểu đồ, cảnh báo có liên kết tới chi tiết, bộ lọc và phân trang 20 bếp, duyệt hồ sơ và sáu tab chi tiết. Dữ liệu tổng hợp được truy vấn đầy đủ rồi lọc/sắp xếp/phân trang trên server; không lấy tổng từ trang đang xem hoặc payload quản trị cũ giới hạn 100 hồ sơ. Các bảng chi tiết dùng COUNT và LIMIT trong SQL. Khi quy mô bếp tăng lớn cần chuyển bộ lọc/phân trang aggregate xuống SQL.

Lượt nộp lại được tách trong bảng số liệu tăng trưởng; không cộng vào hồ sơ mới. Tỷ lệ kích hoạt loại các bếp có đơn trả tiền trước mốc duyệt đầu ghi nhận khỏi mẫu đủ điều kiện và báo thiếu mốc hợp lệ. Ngày có thực đơn không đồng nghĩa ngày đã mở bán. Bảng menu/sản phẩm phản ánh trạng thái và suất hiện tại.

Không tải bản đồ trong đợt đầu; hồ sơ hiển thị địa chỉ và bán kính giao. Heatmap bữa/ngày và phân bố nguồn cung thuộc đợt mở rộng. Ngân hàng/SePay nằm trong tab Hồ sơ; báo cáo chỉ phản ánh cấu hình và lần nhận webhook.

Tham khảo cách phân tách sales, operations, customer insights và feedback của Uber Eats Manager; cách theo dõi hủy có thể tránh, thời gian chờ và rating của DoorDash. Chỉ đưa vào những chỉ số có dữ liệu tương ứng trong hệ thống này, vì chef tự bố trí giao hàng.

- https://help.uber.com/en-GB/merchants-and-restaurants/article/understanding-customer-and-order-data-in-uber-eats-manager-?nodeId=49fc4e14-cd2e-4224-99e5-3b922cf78dc8
- https://help.doordash.com/en-au/merchants/article/what-is-service-quality-reporting

## 2. Bố cục

1. Bộ lọc ngày (7/30/90 ngày và tùy chọn), khu vực bếp, bữa, tên bếp/tên chủ/email/số điện thoại.
2. Tám KPI bấm được để lọc danh sách: tổng hồ sơ, chờ duyệt, đã duyệt, đang nhận đơn, có đơn hoàn thành trong kỳ, duyệt mới trong kỳ, tạm ngưng, cần chú ý.
3. Cảnh báo hiện tại và hai biểu đồ.
4. Hai tab chính: Danh sách bếp và Duyệt hồ sơ. Tab duyệt có số hồ sơ đang chờ và các bộ lọc cần bổ sung/từ chối.
5. Chi tiết bếp mở theo URL, quay lại giữ kỳ, bộ lọc và trang danh sách.

Ngày áp dụng cho chỉ số lịch sử; chỉ số hiện tại ghi rõ “Hiện tại”. Nhóm trạng thái/vận hành và bộ lọc danh sách không làm thay đổi số tổng trong báo cáo phía trên; phải nêu phạm vi rõ như Users.

Khu vực trang Chefs mặc định là vị trí bếp. Nếu phân tích khu vực giao cho khách trong chi tiết bếp thì có bộ lọc riêng, tên rõ ràng; không dùng cùng một trường “khu vực” với hai ý nghĩa. Bếp chưa có tọa độ hợp lệ nằm trong nhóm chưa xác định.

Desktop: sidebar hiện có, KPI 4 cột, biểu đồ 2 cột, bảng đầy chiều rộng. Tablet: KPI 2–4 cột tùy chiều rộng. Mobile: KPI 2 cột, biểu đồ xếp dọc, hàng bếp dạng thẻ gọn hoặc bảng có hướng dẫn vuốt ngang. Không dựng bản đồ Goong mặc định; chỉ tải khi mở chi tiết vị trí.

## 3. Định nghĩa KPI

| Chỉ số             | Phạm vi / định nghĩa                                                                                                                  | Khi bấm                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Tổng hồ sơ         | Tất cả bản ghi chef phù hợp khu vực/tìm kiếm                                                                                          | Tất cả hồ sơ                 |
| Chờ duyệt          | Trạng thái pending hiện tại                                                                                                           | Tab duyệt, pending           |
| Đã duyệt           | Trạng thái approved hiện tại; không đồng nghĩa đang mở                                                                                | Danh sách approved           |
| Đang nhận đơn      | Approved, tài khoản chủ mở, ngân hàng hợp lệ, phiên dịch vụ hiện tại bật, có món hoạt động/enabled/còn suất/chưa hết giờ của bữa chọn | Bếp nhận được đơn hiện tại   |
| Có đơn trong kỳ    | Số bếp duy nhất có đơn COMPLETED với thời điểm hoàn thành trong kỳ                                                                    | Bếp có đơn hoàn thành        |
| Duyệt mới trong kỳ | Số bếp có lần duyệt đầu tiên được ghi nhận trong kỳ                                                                                   | Danh sách được duyệt lần đầu |
| Tạm ngưng          | Trạng thái suspended hiện tại                                                                                                         | Danh sách suspended          |
| Cần chú ý          | Số chef duy nhất có ít nhất một cảnh báo đang áp dụng                                                                                 | Danh sách có cảnh báo        |

Nếu chọn bữa, các chỉ số đơn/thực đơn/vận hành giới hạn theo bữa; tổng hồ sơ và trạng thái duyệt vẫn chỉ áp dụng khu vực/tìm kiếm. Bếp chưa có thực đơn vẫn cần xuất hiện để hỗ trợ kích hoạt.

## 4. Trạng thái và cảnh báo

Ba nhóm tag độc lập:

- Hồ sơ: Chờ duyệt, Cần bổ sung, Từ chối, Đã duyệt, Tạm ngưng (giữ màu đã có).
- Vận hành: Đang nhận đơn, Đã bật nhưng chưa có món hợp lệ, Chưa mở hôm nay, Hết giờ nhận, Tài khoản chủ bị khóa, Chưa cấu hình ngân hàng.
- Theo dõi: Chưa có đơn đầu tiên, Chậm nhận, Đối soát chờ chef, Đối soát chờ admin, Đánh giá thấp.

Hồ sơ chưa duyệt không gán nhãn vận hành yếu. Chef không mở mỗi ngày không mặc nhiên vi phạm: mô hình hiện tại không có lịch làm việc cam kết. Sau khi mọi bữa hết giờ, trạng thái Hết giờ nhận là thông tin bình thường, không tính vào Cần chú ý.

Cảnh báo ưu tiên:

1. Đơn đã trả tiền chờ nhận quá ngưỡng: dùng SLA hiện có, mặc định 10 phút.
2. Yêu cầu đối soát OPEN chờ chef hoặc REVIEW chờ admin quá ngưỡng: mặc định 24 giờ mỗi giai đoạn, tính từ lần vào giai đoạn gần nhất.
3. Hồ sơ pending quá ngưỡng: mặc định 48 giờ, tính từ lần nộp lại gần nhất nếu có.
4. Approved nhưng thiếu điều kiện kích hoạt: ngân hàng, sản phẩm hoặc thực đơn. Đây là tác vụ hỗ trợ.
5. Approved chưa có đơn đầu: gợi ý theo dõi sau 7 ngày từ lần duyệt đầu; không tự phạt hoặc tạm ngưng.
6. Rating thấp/tỷ lệ từ chối cao: ngưỡng cấu hình và số mẫu tối thiểu; hiển thị mẫu số. Gợi ý ban đầu rating <3,5 với ít nhất 5 đánh giá; tỷ lệ từ chối >10% với ít nhất 30 đơn đã trả tiền có kết quả. Đây là ngưỡng đề xuất, không phải tiêu chuẩn ngành hoặc kết luận chef có lỗi.

Mỗi cảnh báo có tên bếp, loại, số đơn/yêu cầu liên quan, thời gian chờ và nút mở đúng đơn/hồ sơ/đối soát. Một chef có nhiều cảnh báo chỉ tính một lần trong KPI Cần chú ý.

## 5. Biểu đồ

### Tăng trưởng và kích hoạt bếp

- Hai chuỗi theo ngày/tuần: hồ sơ gửi mới và bếp duyệt lần đầu; yêu cầu nộp lại được đếm riêng để không thổi số chef mới.
- Theo dõi thêm thời gian từ duyệt đến đơn đã thanh toán đầu tiên, và đến đơn hoàn thành đầu tiên.
- Tỷ lệ kích hoạt trong 7 ngày: chỉ xét bếp đã đủ 7 ngày kể từ lần duyệt đầu có dữ liệu; bếp mới chưa đủ tuổi nằm trong nhóm đang chờ. Phải thể hiện số bếp đủ điều kiện và số thiếu mốc duyệt.
- Funnel cấu hình ngân hàng → có thực đơn → bếp đang nhận đơn có thể dùng trạng thái hiện tại, nhưng không gọi đó là tỷ lệ chuyển đổi lịch sử. Phân tích lịch sử cần mốc sự kiện đầy đủ.

### Hiệu quả bếp

- Top bếp theo số đơn hoàn thành hoặc doanh số món; chọn cách xếp hạng.
- Giá trị, số đơn và kỳ được ghi rõ; không xếp bếp không có đơn vào nhóm kém hiệu quả.
- Mở rộng sau: heatmap bữa/ngày trong tuần, phân bố nguồn cung theo vùng, nhóm bếp có thực đơn nhưng chưa có đơn.

## 6. Bảng danh sách bếp

Nhóm cột mặc định: Bếp/chủ/liên hệ/khu vực; hồ sơ và vận hành; số món nhận được đơn hiện tại; đơn hoàn thành trong kỳ; doanh số món trong kỳ; rating kèm số lượt; cảnh báo; thao tác.

Thông tin nâng cao trong chi tiết: đơn đang xử lý, trung vị thời gian nhận, số ngày có thực đơn, lần có thực đơn gần nhất, khách mua và khách quay lại bếp, tỷ lệ từ chối/hủy phân loại, đối soát mở và số tiền liên quan.

Tìm kiếm và lọc trên server, phân trang 20 bếp, sắp xếp ổn định bằng trường chọn + ID. Aggregate không tính từ danh sách giới hạn. Cho chọn sắp xếp doanh số, đơn, ngày đăng ký/duyệt, rating, cảnh báo; xếp rating luôn hiển thị số mẫu.

Thao tác:

- Pending: Xem yêu cầu, Duyệt, Yêu cầu bổ sung, Từ chối.
- Rejected/needs_changes: trạng thái và lý do; không hiện nhóm Hồ sơ/Sản phẩm/Đơn & doanh số/Tạm ngưng như yêu cầu đã có. Hồ sơ gửi lại trở về pending.
- Approved: Hồ sơ, Sản phẩm, Đơn & doanh số, Tạm ngưng có lý do.
- Suspended: Hồ sơ/lịch sử và Mở lại; backend kiểm tra quyền và ghi audit như hiện có.

Không thực hiện khóa hoặc tạm ngưng tự động từ chỉ số/cảnh báo.

## 7. Chi tiết bếp

Các tab: Tổng quan, Thực đơn & sản phẩm, Đơn hàng, Khách & đánh giá, Đối soát, Hồ sơ & lịch sử duyệt.

- Tổng quan: doanh số/đơn/khách, ngân hàng và trạng thái tích hợp SePay ở mức cấu hình; không hiển thị key hoặc tuyên bố ngân hàng đang đồng bộ nếu chưa có dữ liệu kiểm tra.
- Thực đơn: ngày dịch vụ, bữa, món, suất hiện tại, cutoff; số ngày có thực đơn khác với số ngày thực sự mở bán.
- Đơn: phân trang, trạng thái, thời gian từ PAID đến ACCEPTED, các sự kiện giao. Đây là thời điểm người dùng/chef cập nhật, không phải thời gian giao thực tế được GPS xác minh.
- Khách: số người mua duy nhất, người mua lần đầu tại bếp và người quay lại chính bếp. Phân biệt với khách mới toàn nền tảng ở Tổng quan/Users.
- Đánh giá: rating trong kỳ theo ngày gửi đánh giá, số lượt, phân bố 1–5 sao, user đánh giá và món trong đơn. Rating trọn đời hiển thị riêng.
- Đối soát: OPEN/REVIEW/RESOLVED, số tiền, tuổi yêu cầu, bằng chứng, lịch sử admin duyệt; dùng luồng và quyền tài liệu hiện có.
- Hồ sơ: thông tin, giấy tờ Blob có kiểm tra quyền, lần gửi/bổ sung/duyệt/tạm ngưng và lý do.

## 8. Quy tắc dữ liệu

- Giờ Việt Nam, khoảng ngày bao gồm ngày cuối; truy vấn dùng đầu ngày tiếp theo làm cận trên loại trừ.
- Đơn và doanh số hoàn thành theo sự kiện COMPLETED. Bản nhập cũ thiếu sự kiện dùng updated_at và có chú thích/số bản ghi thiếu mốc.
- Doanh số món = subtotal - discount. Phí giao, tiền đã xác nhận thanh toán và số tiền liên quan đối soát hiển thị riêng; không gọi doanh số món là lợi nhuận/số dư ngân hàng.
- Tỷ lệ từ chối chef xét nhóm đơn đã PAID trong kỳ; chia số có sự kiện REJECTED do chef cho số đơn đã trả tiền có kết quả nhận hoặc từ chối. Đơn chưa xử lý được báo riêng, không biến thành từ chối.
- Hủy bởi khách/admin/hết hạn thanh toán tách riêng. Có thể dùng actor của order_events để nhận diện người thực hiện; phân tích lý do chuẩn cần thêm mã lý do ở tương lai.
- Thời gian nhận = ACCEPTED đầu tiên - PAID đầu tiên hợp lệ. Không dùng thời gian tạo đơn chứa thời gian khách chờ chuyển khoản. Hiển thị trung vị, số mẫu và số đơn chờ quá SLA.
- Với mua lại bếp trong 30 ngày, xét lần hoàn thành đầu tại chính bếp và chỉ tính nhóm đã đủ 30 ngày, quay lại cùng chef.
- Phân biệt thời điểm nhận đơn/đối soát đang chờ với lịch sử chỉ số trong kỳ; không giấu tồn đọng cũ do bộ lọc ngày mới.

## 9. Dữ liệu hiện có và cần bổ sung

Có thể làm ngay từ chefs/users, kitchen_sessions/daily_menu/products, orders/order_items/order_events, reviews, payment_exceptions/payment_request_details và audit_logs. Các audit chef.application, chef.status, kitchen.toggle, menu.saved đã có; dữ liệu lịch sử trước khi ghi audit có thể thiếu.

Cần bổ sung ở giai đoạn sau:

- Mốc ngân hàng đã cấu hình và điều kiện bếp bán được theo thời gian để có funnel kích hoạt lịch sử đầy đủ.
- Sổ thay đổi suất: thêm, điều chỉnh, giữ chỗ, trả lại, bán hoàn thành. stock hiện tại bị thay đổi/ghi đè, nên không đủ để tính tỷ lệ bán hết suất trong quá khứ.
- Lịch bếp cam kết và phiên mở/đóng có cutoff snapshot trước khi đo uptime hoặc nghỉ ngoài kế hoạch. Audit bật/tắt hiện có là nguồn từ thời điểm bắt đầu ghi nhận, không khôi phục lịch sử đầy đủ.
- Mã lý do hủy/từ chối chuẩn hóa để phân tích nguyên nhân.
- Thời gian giao cam kết trước khi có chỉ số giao đúng hạn. Không suy luận từ animation/icon shipper.

## 10. Kế hoạch triển khai

Đợt đầu: tám KPI; bộ lọc; hai biểu đồ; cảnh báo; bảng/phân trang; duyệt hồ sơ; chi tiết theo dữ liệu thật và giữ điều kiện quay lại. Không thêm dịch vụ, không đổi MySQL/TiDB, WebSocket hoặc Blob.

API báo cáo tách summary/trends/operations/list/detail dưới admin, tiếp tục dùng mutation duyệt hiện có. Thống kê lịch sử cache ngắn như Tổng quan; vận hành không cache hoặc tự làm mới theo SLA. Tải độc lập để một báo cáo lỗi không mất danh sách/duyệt. URL dùng bộ tham số riêng của Chefs.

Kiểm tra bắt buộc: hơn 100 bếp/phân trang; hồ sơ nộp lại; chủ bị khóa; bếp bật nhưng món hết suất/ngừng bán/hết giờ; bữa qua nửa đêm; first approval/first paid và nhóm đủ 7 ngày; create/paid/completed khác kỳ; actor hủy/từ chối; duplicate đối soát cũ; rating ít mẫu; quyền admin; responsive và back navigation.

Đợt sau: sổ suất, lịch mở bếp, nguyên nhân hủy chuẩn, tỷ lệ kích hoạt lịch sử đầy đủ và hiệu quả nguồn cung/giữ chân theo bếp.
