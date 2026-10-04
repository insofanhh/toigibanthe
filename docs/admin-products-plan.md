# Thiết kế thống kê và quản lý Sản phẩm

Ngày lập: 2026-10-04. Đợt đầu đã được triển khai: KPI, biểu đồ, cảnh báo, nguồn cung, bảng quản lý, năm tab chi tiết và audit tạo/sửa món. Đợt sau là lộ trình bổ sung dữ liệu, chưa triển khai.

## 1. Mục tiêu và tham khảo

Mục Sản phẩm giúp admin xác định món đang tạo sức bán, món cần cải thiện nội dung/chất lượng, nguồn cung theo bữa và khu vực, cùng các vấn đề cần phối hợp với chef. Tách số liệu hiện tại, hiệu quả bán trong kỳ và hành vi có dữ liệu theo dõi.

Tham khảo chính thức:

- [Uber Eats Manager](https://help.uber.com/merchants-and-restaurants/article/understanding-customer-and-order-data-in-uber-eats-manager?nodeId=49fc4e14-cd2e-4224-99e5-3b922cf78dc8): món bán nhiều, hiệu quả theo thời gian và phản hồi về thực đơn.
- [DoorDash Insights](https://help.doordash.com/en-us/merchants/article/what-is-the-insights-hub-in-the-merchant-portal): product mix, tối ưu thông tin thực đơn và theo dõi vận hành.
- [DoorDash Menu Item Conversion](https://developer.doordash.com/en-US/docs/reporting/overview/reports/menu_conversion/): tách lượt xem chi tiết món, thêm giỏ và checkout theo món. Thiết kế của dự án sẽ dùng phiên duy nhất và thứ tự sự kiện; không sao chép công thức tỷ số sự kiện của DoorDash.

## 2. Dữ liệu thực tế đã kiểm tra

- Trước cập nhật, mục admin tải chung `/api/admin`, danh sách sản phẩm giới hạn 100. Đợt đầu thay bằng báo cáo và danh sách riêng; tổng không tính từ một trang hoặc giới hạn 100 món.
- `products` là món gốc: tên, ảnh, mô tả, thành phần, giá, active, rating, ngày tạo. Sản phẩm không có bữa cố định hoặc loại món như cơm/bún/đồ uống.
- `daily_menu` + `kitchen_sessions` là phiên bán theo ngày/bữa: cutoff, enabled, stock, sale_price, campaign, bếp bật/tắt. Một sản phẩm có thể xuất hiện ở nhiều bữa.
- `order_items` lưu tên/ảnh/giá/số lượng tại lúc đặt; báo cáo lịch sử dùng snapshot này, không nhân giá hiện tại.
- `order_events` có mốc hoàn thành; đơn cũ thiếu mốc dùng updated_at, giống Tổng quan/Chefs, và báo số bản ghi phải dùng thay thế.
- `reviews` hiện là đánh giá cả đơn. Code cộng cùng rating cho từng sản phẩm duy nhất trong đơn; nhãn đúng là “Đánh giá từ đơn có món này”, không khẳng định khách chấm riêng từng món.
- `favorites` cho biết số người đang thích món, không đủ để tái dựng lịch sử bỏ thích.
- Analytics đã có `dish_view`, `cart_add` theo product_id và phiên; checkout hiện không có danh sách món trong giỏ. `analytics_order_context` nối phiên với đơn. Chưa có impression của từng thẻ món.
- `payment_exceptions` và yêu cầu khách gắn với cả đơn, chưa có món/số tiền hoàn riêng từng dòng. Chỉ hiển thị “Đơn có món này có đối soát”, không quy toàn bộ số tiền hoàn cho một món.
- `stock` giảm khi giữ suất cho đơn chờ thanh toán và có thể được hoàn lại/điều chỉnh. Stock bằng 0 là không còn suất khả dụng, chưa chứng minh đã bán hết.
- Admin và chef hiện cùng ghi `products.active`; chưa có cờ admin khóa riêng. Admin không thể dựa vào active hoặc audit gần nhất để khẳng định món đang bị khóa bắt buộc bởi hệ thống.

## 3. Bố cục

1. Bộ lọc ngày 7/30/90 ngày hoặc tùy chọn; khu vực bếp; chef; bữa; tìm tên món/tên bếp/mã sản phẩm.
2. Tám KPI có thể bấm để lọc hoặc đổi xếp hạng.
3. Cảnh báo/tác vụ cần kiểm tra, chia nhóm Vận hành, Nội dung, Hiệu quả.
4. Hai biểu đồ mặc định: sức bán theo thời gian và top món. Báo cáo bữa/khu vực nằm trong tab riêng để trang đầu tải gọn.
5. Tabs: Danh sách món, Nguồn cung theo bữa, Hiệu quả & hành vi.
6. Chi tiết sản phẩm mở trong trang với URL riêng; quay lại giữ bộ lọc, thứ tự và trang.

Desktop: sidebar admin hiện có, KPI 4 cột, biểu đồ 2 cột, bảng đầy phần nội dung. Tablet/mobile: KPI 2 cột, biểu đồ xếp dọc, bảng cuộn trong vùng riêng có hướng dẫn; ảnh món và tên luôn dễ nhận diện. Không có slogan. Dùng chữ mảnh và tag màu như các mục Users/Chefs. Giữ animation chuyển trang hiện có; làm mới số liệu không animate/remount nội dung đã tải.

Phạm vi báo cáo áp dụng khu vực bếp/chef/tìm kiếm. Bữa chỉ áp dụng phiên bán, đơn, lượt tương tác có bữa; tổng món gốc/active/ngày tạo không loại món chưa có thực đơn. Bộ lọc trạng thái/nhóm/sắp xếp/trang chỉ thay bảng, không thay tổng phía trên. Kỳ trước có cùng số ngày; không có mẫu nền thì hiện “Chưa có kỳ đối chiếu”, không chia cho 0.

Khu vực mặc định là vị trí bếp, ô 0,02 độ như Chefs. Nếu phân tích vị trí khách trong tab hành vi phải có bộ lọc “Khu vực khách” riêng và thể hiện rõ phạm vi; không trộn vị trí bếp với vị trí giao. Không gọi một món là giao được cho mọi user chỉ vì có phiên bán hợp lệ; checkout vẫn kiểm tra bán kính theo tọa độ khách.

## 4. Tám KPI

| KPI               | Định nghĩa                                                           | Khi bấm                                 |
| ----------------- | -------------------------------------------------------------------- | --------------------------------------- |
| Tổng món          | Tất cả product_id trong phạm vi, kể cả món ẩn và bếp chưa được duyệt | Bỏ nhóm/trạng thái của bảng             |
| Món đang bật      | products.active hiện tại; chưa đảm bảo bán được                      | active=true                             |
| Món nhận được đơn | DISTINCT product_id có ít nhất một phiên bán hợp lệ hiện tại         | Nhóm đang nhận đơn                      |
| Món đã bán        | DISTINCT product_id trong đơn COMPLETED hoàn thành trong kỳ/bữa chọn | Nhóm có doanh số                        |
| Phần đã bán       | SUM(quantity) của các dòng món trên đơn hoàn thành trong kỳ          | Nhóm có doanh số, xếp số phần giảm dần  |
| Doanh số món      | Tổng giá trị dòng món sau phân bổ voucher, không gồm giao hàng       | Nhóm có doanh số, xếp doanh số giảm dần |
| Món mới           | products.created_at trong kỳ; không đồng nghĩa đã mở bán             | Nhóm tạo mới trong kỳ                   |
| Món cần chú ý     | DISTINCT product_id có ít nhất một tác vụ/cảnh báo đang áp dụng      | Nhóm cần chú ý                          |

Tổng món/active/readiness/cần chú ý là hiện trạng. Món mới/sức bán/doanh số là kỳ đã chọn. KPI số phần khác số món, khác số đơn. Đơn nhiều món chỉ đếm một lần trong tổng đơn toàn phạm vi; số đơn từng món có thể cùng chứa một đơn và không được cộng lại thành tổng đơn hệ thống.

Readiness: sản phẩm active; chef approved; chủ active; ngân hàng hợp lệ; session mở; menu enabled; còn stock; cutoff còn hạn; ngày dịch vụ hôm nay hoặc ngày trước với bữa day_offset=1 còn hạn. Chọn bữa giới hạn đúng bữa đó. Một phiên hợp lệ là đủ để sản phẩm ready; các phiên còn lại có trạng thái riêng trong chi tiết.

## 5. Trạng thái và cảnh báo

Ba nhóm tag độc lập:

- Trạng thái món: Đang bật (xanh), Đã ẩn (xám).
- Khả năng bán: Đang nhận đơn (xanh), Chưa lên thực đơn (xám), Bếp chưa mở (xám), Không còn suất khả dụng (cam), Bữa đã hết giờ (xám), Phiên bán đã tắt (xám), Bếp/chủ tài khoản chưa đủ điều kiện (đỏ/cam).
- Theo dõi: Thiếu thông tin, Đánh giá thấp, Chưa có đơn khi đã lên thực đơn, Đơn liên quan có đối soát.

Chi tiết hiển thị tất cả nguyên nhân của từng phiên. Nếu sản phẩm không ready, bảng chọn nguyên nhân chính theo thứ tự: món ẩn → bếp/chủ/ngân hàng → không có phiên phù hợp → bếp chưa mở/phiên tắt → hết giờ → thiếu suất. Không xếp trạng thái hết giờ bình thường thành lỗi.

Cảnh báo đợt đầu:

1. Nội dung thiếu: ảnh trống/placeholder, mô tả hoặc thành phần trống. Gọi là “Cần bổ sung thông tin”; không suy luận độ an toàn thực phẩm từ dữ liệu này.
2. Rating thấp: đề xuất <3,5 sao và >=5 đánh giá từ đơn có món trong kỳ; có số mẫu và nhãn nguồn đánh giá. Cho admin cấu hình, không tự ẩn món.
3. Có thực đơn nhưng chưa phát sinh đơn hoàn thành: đề xuất >=3 ngày dịch vụ đã có thực đơn, đã qua ít nhất 7 ngày từ lần lên thực đơn đầu ghi nhận. Chỉ là gợi ý kiểm tra khả năng tiếp cận/giá/nội dung; chưa chứng minh món đã thực sự được bán đủ thời gian. Món chưa lên thực đơn có nhóm riêng, không gắn “bán kém”.
4. Đơn chứa món có yêu cầu đối soát OPEN/REVIEW: đếm DISTINCT order_id, liên kết tới đơn và quản lý đối soát đúng chef. Tuổi chờ theo giai đoạn hiện tại, dùng SLA đã có. Một đơn nhiều món không trở thành nhiều yêu cầu.
5. Không còn suất trong một phiên còn giờ, session mở và các điều kiện khác hợp lệ: cảnh báo thông tin để chef kiểm tra; phân biệt suất có thể đang giữ và không tự động gọi là “cháy hàng”.

Đợt sau mới bật nhóm nhiều phiên xem nhưng ít thêm giỏ. Ngưỡng khởi đầu để nghiên cứu: >=100 phiên xem chi tiết và <5% chuyển sang thêm giỏ sau xem; cấu hình được, có kỳ/mẫu số, không dùng làm kết luận chất lượng hoặc tác động giá.

## 6. Biểu đồ và báo cáo

### Hai biểu đồ trang đầu

- Sức bán theo ngày: chọn số phần hoặc doanh số, so với kỳ trước cùng độ dài. Một thang đo mỗi lần, không dùng hai trục khó đọc. Có bảng số liệu kèm theo.
- Top 10 món: chọn số phần, doanh số, số đơn hoàn thành; luôn có ảnh/tên/bếp, giá trị và kỳ. Bấm mở chi tiết. Không gộp các món trùng tên của nhiều chef thành một sản phẩm.

### Nguồn cung theo bữa

- Bảng bữa × khu vực bếp: số sản phẩm nhận được đơn hiện tại, số chef đang có món nhận đơn và số suất khả dụng hiện tại.
- Heatmap thứ trong tuần × bữa: số phần trên đơn hoàn thành trong kỳ; thứ tính theo ngày hoàn thành tại Việt Nam, bữa theo snapshot meal_id của đơn. Đây là sức bán đã ghi nhận, không phải toàn bộ nhu cầu hoặc thời gian ăn thực tế.
- Cho chuyển sang số ngày có thực đơn trong kỳ; không gọi là số ngày mở bán. Không so số suất hiện tại với số đã bán cả tháng để tính tỷ lệ bán hết.

### Hiệu quả & hành vi

- Danh sách phiên xem chi tiết, phiên thêm giỏ, số người đang thích; món mới chưa đủ dữ liệu có nhãn riêng.
- Không dùng catalog result_count làm số lần từng món được hiển thị.
- Chuyển đổi xem → thêm giỏ: phiên có view món P trong kỳ và ít nhất một cart_add của cùng P sau một view hợp lệ trong cùng phiên/bữa, chia phiên view; tìm mọi chuỗi hợp lệ để không bỏ lần quay lại. Phiên thêm giỏ trực tiếp từ thẻ món được báo riêng.
- Chuyển đổi thêm giỏ → đặt: bắt đầu từ phiên cart_add trong kỳ, cùng phiên có đơn chứa đúng product_id và bữa, thời gian tạo sau lần thêm tương ứng, trong cửa sổ 30 phút. Cho theo dõi thêm đã PAID/COMPLETED. Các phiên chưa đủ cửa sổ được ghi chờ; dùng grace window sau cuối kỳ để tránh cắt cụt mẫu. Cùng phiên có thể thêm nhiều món, nên không cộng các funnel món thành funnel hệ thống.
- Checkout từng món cần bổ sung snapshot danh sách món trong giỏ ở thời điểm checkout. Không suy ngược từ đơn cuối rằng mọi món khách từng thêm đã vào checkout.
- Dữ liệu hành vi mới chỉ đại diện các phiên được ghi nhận, có thể thiếu do trình duyệt/mất mạng; hiển thị thời điểm bắt đầu đo và tỷ lệ đơn có analytics context. Chưa có impression và menu availability tại từng sự kiện nên không gọi là CTR hay funnel phủ toàn bộ người dùng.

## 7. Bảng quản lý và chi tiết

Bảng mặc định: ảnh/tên/chef; giá gốc hiện tại; trạng thái món/khả năng bán; bữa có phiên hợp lệ và suất khả dụng; phần đã bán; doanh số phân bổ; rating trong kỳ kèm số mẫu; cảnh báo; thao tác.

Ẩn cột nâng cao sau lựa chọn: số đơn, số khách mua, lượt thích hiện tại, số ngày có thực đơn, phiên xem/thêm giỏ, lần bán gần nhất. Giá sale có thể khác theo bữa nên ghi khoảng giá bán hiện tại hoặc mở phiên cụ thể; không hiển thị một giá sale duy nhất sai với các bữa còn lại.

Phân trang 20 món trên server; sắp xếp ổn định theo trường + ID. Nhóm: tất cả, active, ẩn, ready, không ready, có doanh số, mới, cần chú ý, chưa lên thực đơn và lịch sử thiếu liên kết. Tìm kiếm literal/validate enum và ngày như Users/Chefs. Tổng và thứ tự tính trên toàn bộ phạm vi trước phân trang, không tính từ một trang. Hiện truy vấn SQL tổng hợp rồi lọc/sắp xếp/phân trang danh sách trong server; các bảng chi tiết dùng COUNT/LIMIT SQL. Khi catalog và lịch sử tăng mạnh cần chuyển toàn bộ lọc danh sách xuống SQL, bổ sung tổng hợp định kỳ và đo thời gian truy vấn.

Thao tác: Xem chi tiết, Mở hồ sơ chef, Ẩn/cho hiển thị có lý do; giữ API/quyền hiện có. Món ẩn vẫn xem được báo cáo lịch sử. Dùng dialog thay prompt. Nêu rõ cho hiển thị không tự mở bếp hoặc mở bữa. Không xóa lịch sử hoặc tự đổi giá/stock của chef.

Năm tab chi tiết:

1. Tổng quan: thông tin hiện tại, sức bán, số khách mua và quay lại đúng product_id, giá thực bán bình quân sau voucher, ngày tạo/lần có thực đơn/lần hoàn thành đầu và gần nhất. Khách quay lại cùng món theo thứ tự các đơn hoàn thành, không theo số dòng order_items.
2. Thực đơn & suất: lịch ngày/bữa/session/cutoff, bật/tắt, stock và sale hiện tại, các nguyên nhân chưa nhận đơn. Nhóm qua nửa đêm theo service_date; các bảng lịch sử suất vẫn phản ánh giá trị đã chỉnh hiện tại, có chú thích.
3. Đơn có món: ngày tạo/completed chọn rõ phạm vi, trạng thái, số phần món này, giá snapshot và doanh số phân bổ; hủy bởi khách/chef/admin/hết hạn, link đơn. Không quy lỗi hủy của đơn cho sản phẩm.
4. Đánh giá & khách: rating 1–5 sao, sắp xếp cao/thấp/mới, tên user, món trong đơn, thời gian và nội dung; đếm review/order một lần cho mỗi product. Mọi đánh giá vẫn mang nhãn đánh giá đơn có món.
5. Hành vi & lịch sử: các phiên có ghi nhận, lượt thích hiện tại, lịch sử admin ẩn/hiện và lý do. Audit chef thay nội dung/giá chưa đầy đủ; bổ sung từ lần triển khai tới, không dựng lại giá cũ từ giá hiện tại.

Đơn có đối soát nằm trong tab Đơn có món với tag và liên kết tới luồng admin hiện có; không tạo luồng xử lý đối soát riêng cho từng sản phẩm.

## 8. Quy tắc tài chính và lịch sử

- Khoảng ngày theo Asia/Ho_Chi_Minh, đầu ngày bao gồm và đầu ngày sau cận cuối loại trừ.
- Sales theo COMPLETED; số đơn/khách DISTINCT; số phần SUM quantity. Tách nhóm ngày tạo của bảng đơn khỏi nhóm thời gian hoàn thành của doanh số.
- Doanh số dòng = unit_price × quantity × (subtotal − discount) / subtotal. Unit_price đã áp dụng sale tại checkout; discount là voucher nên không trừ sale thêm lần nữa. Gộp các dòng cùng product_id trong một đơn trước khi đếm đơn/khách/review.
- Phân bổ bằng DECIMAL. Nếu xuất VND nguyên, dùng phân bổ phần dư theo tỷ lệ và ID ổn định, đảm bảo tổng các dòng đúng subtotal − discount. Không làm tròn độc lập mỗi dòng rồi cộng. Nếu chỉ lọc một phần món trong đơn vẫn chia theo subtotal của toàn đơn, không chia lại toàn voucher cho những món còn trong bộ lọc.
- Phí giao/hoàn tiền không trộn vào doanh số món. Đơn COMPLETED sau đó đối soát không tự thành CANCELLED; hiển thị doanh số bán và vấn đề đối soát riêng. Muốn doanh số sau hoàn cần ledger hoàn tiền theo dòng.
- Thiếu snapshot/món đã đổi tên/ảnh: số tiền vẫn theo snapshot, tên hiện tại chỉ dùng nhận diện catalog. Giữ sản phẩm ẩn. Dòng order_items không còn products tương ứng nằm trong nhóm lịch sử thiếu liên kết, không bị silently drop hoặc tạo nhầm product gốc.
- Bữa/quầy đã đóng là hiện trạng; không dùng active hay stock hôm nay để lọc bỏ doanh số cũ. Nhiều phiên bán/món trùng dòng không được nhân doanh số khi JOIN reviews/menu/favorites.
- Rating tổng thể tính từ review hợp lệ khác nhau trên các đơn nằm trong phạm vi, không AVG trung bình các sản phẩm có số mẫu khác nhau.

## 9. Lộ trình triển khai

### Đợt đầu: quản trị và dữ liệu đã có

- Tám KPI, so kỳ trước cho chỉ số lịch sử, lọc/phân trang đầy đủ.
- Hai biểu đồ mặc định, nguồn cung theo bữa/khu vực và heatmap sức bán.
- Cảnh báo nội dung, đánh giá, suất, món lên thực đơn chưa có đơn và đối soát liên quan; ngưỡng cấu hình có audit.
- Bảng và năm tab chi tiết, ẩn/hiện có lý do, review sorting, lịch sử admin, favorites và số phiên view/add độc lập. Chưa trình bày funnel đầy đủ ở đợt này.
- API admin riêng `/api/admin/product-analytics/{summary,trends,operations,list,supply}` và `/detail/:id`; settings/export là POST/GET theo nghiệp vụ. Nếu có CSV phải theo bộ lọc đầy đủ, không chỉ xuất trang hiện tại, có chống spreadsheet formula và giới hạn truy vấn phù hợp Vercel.
- Tải báo cáo độc lập; MySQL/TiDB aggregate đầy đủ và server pagination như mục 7; cache facts 20 giây, operations/supply bỏ qua cache, current checks mỗi phút khi visible, version request giữ UI khi refresh. Mutation món/menu và admin-analytics WebSocket làm mới. Không fetch legacy admin payload 100 sản phẩm.
- Ghi audit chef tạo/sửa/ẩn món từ thời điểm triển khai. Dùng audit_logs/platform_settings hiện có; không thêm dịch vụ hoặc env.

### Đợt sau: dữ liệu còn thiếu

- Impression từng món có vị trí hiển thị/nguồn và snapshot availability, đo được CTR/phễu chuẩn.
- Checkout item snapshot và các chuỗi chuyển đổi cùng phiên/cùng món; giữ dữ liệu hành vi riêng khỏi số đơn tài chính.
- Sổ suất: bổ sung/điều chỉnh/giữ/hoàn/hoàn thành, snapshot đầu phiên và lịch sử mở/đóng để tính bán hết, thiếu suất và thời gian khả dụng.
- Cờ admin khóa riêng với chef active nếu cần cơ chế kiểm duyệt bắt buộc; backend checkout/catalog chặn nhất quán, chef không tự bật lại cờ admin.
- Đánh giá riêng món, nguyên nhân hủy và đối soát/hoàn tiền theo dòng.
- Loại món/tag có cấu trúc; giá vốn nếu muốn phân tích biên lợi nhuận. Không tự gom món chỉ từ tên hoặc coi bữa là loại món.
- Sau khi đủ dữ liệu, mở rộng phân tích bán kèm, mua lại cùng món, độ tập trung doanh số và thử nghiệm khuyến mãi. Món có nhiều đơn ưu đãi chưa chứng minh ưu đãi tạo tăng trưởng thêm.

## 10. Quyết định admin có thể đưa ra

| Tín hiệu                                            | Hướng hành động                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Món nhiều phần bán, phản hồi tốt, bếp đáp ứng tốt   | Cân nhắc đưa vào gợi ý, trao đổi chef về bổ sung suất                              |
| Món có thực đơn nhiều ngày nhưng chưa có đơn        | Kiểm tra giờ mở thực tế, phạm vi giao, ảnh/mô tả/giá, lịch sử tương tác            |
| Nhiều phiên xem nhưng ít thêm giỏ (khi đủ đo lường) | Kiểm tra nội dung, giá, tình trạng có thể đặt; không kết luận nguyên nhân từ tỷ số |
| Đơn chứa món có phản hồi thấp/đối soát              | Đọc chi tiết đơn và trao đổi chef trước khi can thiệp                              |
| Một bữa/khu vực ít bếp có món nhận đơn              | Tìm chef phù hợp và hỗ trợ mở thực đơn; số đơn thấp chưa phản ánh thiếu nhu cầu    |
| Doanh số tập trung vào ít món/bếp                   | Theo dõi phụ thuộc nguồn cung, hỗ trợ thêm lựa chọn phù hợp                        |

## 11. Kiểm tra bắt buộc khi triển khai

- > 100 món, pagination ổn định, aggregate đúng dù món cùng tên/nhiều chef/món ẩn.
- Một product nhiều menu và nhiều dòng trong đơn; JOIN không nhân revenue, review, buyer hoặc request.
- Đơn nhiều món/voucher/làm tròn/chỉ lọc một món; tổng phân bổ khớp đơn, không trừ sale hai lần.
- Created/paid/completed khác kỳ; fallback legacy; lịch sử sản phẩm thiếu liên kết.
- Readiness: chủ khóa, chef chưa duyệt, thiếu ngân hàng, session tắt, stock0, món/menu inactive, cutoff và bữa qua nửa đêm.
- Review đơn nhiều món chỉ một mẫu mỗi product/order; rating ít mẫu không tự cảnh báo; request cấp đơn không bị tính tiền nhiều lần.
- Không có analytics vẫn đầy đủ báo cáo tài chính; không coi checkout là từng món; không thêm giỏ trực tiếp vào cohort view thiếu sự kiện.
- RBAC admin, validation filter/ngưỡng/lý do, không lộ keys/sessions; mutation ghi audit/outbox và cập nhật chart/list.
- Đóng chi tiết/back giữ lọc và trang; responsive1920/1024/768/390; không overflow cả document và không nháy khi refresh. Một báo cáo lỗi không làm mất danh sách/thao tác.
