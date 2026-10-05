# Popup trang chủ

## Cấu hình

Vào **Admin → Cài đặt**:

1. **Giờ hết nhận theo bữa**: bốn bữa nằm trong một bảng. Chỉnh giờ, ngày hết nhận và bấm **Lưu giờ các bữa**. Các thay đổi được lưu cùng một transaction và cập nhật hạn nhận của thực đơn còn nhận đơn.
2. **Popup trang chủ**: bật riêng **Hướng dẫn cài app** hoặc **Khuyến mãi / sự kiện**. Mặc định cả hai tắt.
3. Chọn tần suất (mỗi phiên, mỗi ngày, mỗi 7 ngày), loại ưu tiên và độ trễ 0–30 giây.
4. Popup hướng dẫn có tiêu đề, mô tả và tùy chọn video. Hướng dẫn tự chọn iOS/Android; user vẫn có thể đổi thiết bị hướng dẫn.
5. Popup khuyến mãi có tên, nội dung, ảnh upload, nội dung nút, đường dẫn nội bộ (ví dụ `/offers`) và thời gian bắt đầu/kết thúc không bắt buộc. Khi bật phải có tên và ảnh. Upload dùng pipeline WebP/Vercel Blob hiện có.
6. Bấm **Xem thử** để xem đúng bố cục; bản xem thử không ghi nhận đã xem, không cài app và không chuyển trang.
7. Bấm **Lưu cài đặt popup** để áp dụng. Mỗi bản lưu có version mới, cho phép nội dung mới xuất hiện lại.

Mỗi lượt vào Home chỉ hiện một popup. Nếu popup ưu tiên không đủ điều kiện hoặc đã xem trong thời gian giới hạn, thử loại còn lại. Đóng popup không bật tiếp popup thứ hai ngay lập tức. Khuyến mãi vẫn có thể hiện trong PWA; hướng dẫn cài app chỉ hiện trên thiết bị di động, ẩn khi chạy ở chế độ standalone hoặc đã nhận sự kiện cài đặt trong phiên.

Tần suất lưu theo trình duyệt/thiết bị: sessionStorage cho mỗi phiên; localStorage cho mỗi ngày/7 ngày. Đây là khoảng thời gian 24 giờ/168 giờ kể từ lần hiện, không phải ngày lịch. Có bộ nhớ dự phòng khi trình duyệt không cho dùng storage. Không cần đăng nhập để xem popup.

## Hướng dẫn cài app

- iOS: Safari → Chia sẻ → Thêm vào Màn hình chính → Thêm. Theo [hướng dẫn Apple](https://support.apple.com/en-eg/guide/iphone/iphea86e5236/ios).
- Android: Chrome → menu → Cài đặt ứng dụng hoặc Thêm vào màn hình chính. Khi nhận được `beforeinstallprompt`, có thêm nút **Cài ứng dụng** gọi prompt của trình duyệt từ thao tác của user. Event chỉ dùng một lần. Theo [MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt).
- Safari không cung cấp prompt cài đặt như Chromium. Video và các bước là hướng dẫn thao tác, không giả lập việc đã cài thành công.
- iOS không cung cấp cách kiểm tra chắc chắn từ tab Safari xem user đã từng thêm website vào màn hình chính; standalone xác định khi user đang chạy app từ màn hình chính.
- Trình duyệt trong Facebook/Zalo/Instagram có hướng dẫn mở bằng Safari/Chrome.

Hai video MP4 gốc, 12 giây, khoảng 56 KB/video, cùng ảnh poster nằm trong `public/install-guide-*`. Video chỉ tải khi phát, có controls, playsInline và hướng dẫn bằng chữ để dùng khi không phát được. Không tự phát video.

Dựng lại bằng `node scripts/generate-install-guides.mjs` với FFmpeg trong PATH hoặc biến `FFMPEG_PATH`. Các video minh họa menu; vị trí/tên tác vụ thực tế có thể khác theo phiên bản hệ điều hành.

## Lưu trữ và API

Dùng JSON trong bảng `platform_settings`, khóa `home-popups`, tương thích MySQL/TiDB. Không cần migration hoặc biến môi trường mới. POST dùng transaction và audit log; chỉ admin có quyền.

- `GET /api/home-popups`: cấu hình công khai và thời gian server. Home lấy cấu hình mới cho từng lượt vào; làm mới khi focus, khi hệ thống thay đổi revision và mỗi 60 giây khi tab hiển thị. Có timer cho các mốc bắt đầu/kết thúc.
- `GET /api/admin/home-popups`: cấu hình cho admin.
- `POST /api/admin/home-popups`: lưu cấu hình. Version do server tạo, không nhận version của client.
- `POST /api/admin/meals` với `{meals:[{id,cutoff,dayOffset}]}`: lưu nhiều bữa trong một transaction. Từ chối ID không tồn tại, trùng ID, giờ không hợp lệ. Endpoint cũ `POST /api/admin/meals/:id` vẫn hoạt động.

Home chờ auth/storage sẵn sàng và tránh đè lên hộp chọn địa chỉ. Bố cục dialog có nền mờ, ảnh lớn, nút đóng phía trên, hỗ trợ Escape, focus trong modal và khóa cuộn nền. Lỗi tải cấu hình không chặn Home.

## Kiểm tra

- `npm test`: có test điều kiện hiển thị, thời gian, tần suất và validation.
- `CHECK_URL=http://127.0.0.1:3010 npm run test:home-popups`: cần app local đang chạy và MySQL local. Test dùng dữ liệu tạm, khôi phục cấu hình popup trước đó, kiểm tra quyền, lưu/đọc cấu hình và cập nhật giờ thực đơn. Trên PowerShell đặt `$env:CHECK_URL='http://127.0.0.1:3010'` trước khi chạy.
- Browser QA: 320/390/768/1440px, cả hai video, phân loại iOS/Android/standalone/desktop, install event, tần suất, ưu tiên, đóng popup, lịch chạy, CTA, upload ảnh, preview và lưu cài đặt. Native prompt được mô phỏng trong Chrome; chưa kiểm thử cài PWA trên thiết bị iOS/Android thật.
