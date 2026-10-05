# Tôi gì, bạn đó!

Ứng dụng đặt món từ bếp cá nhân, ưu tiên mobile: user, chef, admin. Next.js + MySQL/TiDB + WebSocket + Vercel Blob. Không dùng Supabase.

## Chạy trên máy hiện tại

Đã khởi tạo database MySQL 8 riêng ở `127.0.0.1:3307`, dữ liệu trong `.local/mysql-data`; không thay đổi database Laragon cổng 3306. `.env.local` chứa cấu hình local và mật khẩu sinh ngẫu nhiên, được gitignore.

```powershell
npm run dev
```

Terminal thứ hai:

```powershell
npm run realtime
```

Mở `http://127.0.0.1:3000`. WebSocket local ở cổng 3001. Khi khởi động lại máy, chạy MySQL local trước bằng `scripts/start-local-db.ps1` hoặc dùng MySQL của bạn và cập nhật `DATABASE_URL`.

### Khôi phục local khi server cũ còn giữ cổng/cache

Local và production build dùng Webpack để tránh lỗi junction của `sharp` khi chạy Turbopack trên Windows. Nếu có `EADDRINUSE` hoặc không xóa được `.next`, chạy:

```powershell
npm run dev:reset
npm run dev -- --port 3010
```

Lệnh reset chỉ dừng Next.js của repository này rồi xóa cache `.next`; các server Next.js local của repo sẽ bị dừng. MySQL và WebSocket vẫn chạy. Không chạy reset trong lúc build. Khi đổi cổng local, cập nhật `SITE_URL` và thêm origin tương ứng vào `WS_ALLOWED_ORIGINS` trong `.env.local`.

Kiểm tra bản production trên máy: `npm run build` rồi `npm run start -- --port 3010`. Trên Vercel, build vẫn thông qua `npm run build`; không chạy lệnh reset local trên Vercel.

Tài khoản demo:

| Vai trò | Email                  | Trang  |
| ------- | ---------------------- | ------ |
| User    | user@toigibando.local  | /me    |
| Chef    | chef@toigibando.local  | /chef  |
| Admin   | admin@toigibando.local | /admin |

Mật khẩu demo là giá trị `SEED_PASSWORD` trong `.env.local`. Dữ liệu demo gồm 4 bếp, 16 món, banner, sale và voucher. Thực đơn có ngày cụ thể, hết ngày cần chef tạo/mở lại. Tài khoản ngân hàng demo để trống; chef nhập ngân hàng hợp lệ trước khi nhận đơn. Ảnh demo dùng Unsplash; ảnh upload mới đi qua Vercel Blob.

Bếp mẫu nằm ở Quận 3, TP.HCM. GPS ở ngoài bán kính giao sẽ không thấy món mẫu.

## Cài trên môi trường mới

Node.js >=20.19, MySQL 8.0+, database UTF-8. Tạo `.env.local` từ `.env.example` và điền `DATABASE_URL`, `AUTH_SECRET`, `SITE_URL`, `WS_ALLOWED_ORIGINS`, `CRON_SECRET`. URL phải encode các ký tự đặc biệt trong username/password.

```powershell
npm ci
npm run db:migrate
```

Seed trực tiếp môi trường development: đặt `SEED_PASSWORD` trước rồi chạy `npm run db:seed`. Để dùng dữ liệu mẫu trên production phục vụ dùng thử, xuất SQL theo hướng dẫn bên dưới. `scripts/setup-local.mjs` chỉ dành cho database riêng cổng 3307, không chạy lại trên môi trường đang dùng vì sẽ thay mật khẩu/config.

## Các tích hợp

| Biến                          | Cách dùng                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| DATABASE_URL                  | MySQL/TiDB connection URL                                                                         |
| DATABASE_SSL                  | `true` trên TiDB production, kiểm chứng chứng chỉ TLS                                             |
| AUTH_SECRET                   | Ít nhất 32 ký tự ngẫu nhiên; dùng chung web/realtime                                              |
| SITE_URL                      | Origin HTTPS production hoặc URL local                                                            |
| NEXT_PUBLIC_WS_URL            | `ws://127.0.0.1:3001` local; để trống trên Vercel Services để dùng `/realtime/socket` cùng domain |
| WS_ALLOWED_ORIGINS            | Các origin được phép mở socket, phân cách dấu phẩy; realtime tự thêm origin của `SITE_URL`         |
| WS_PORT                       | Cổng server Node local/host riêng                                                                 |
| GOONG_API_KEY                 | REST key, chỉ server                                                                              |
| NEXT_PUBLIC_GOONG_MAP_KEY     | Map key công khai, giới hạn domain trong Goong                                                    |
| BLOB_PUBLIC_READ_WRITE_TOKEN  | Token Blob store public: ảnh món/banner                                                           |
| BLOB_PRIVATE_READ_WRITE_TOKEN | Token Blob store private: tài liệu chef                                                           |
| CRON_SECRET                   | Bảo vệ `/api/cron` bằng Authorization Bearer                                                      |

Tạo hai Blob store public/private. Tài liệu private không trả trực tiếp URL blob cho client; `/api/files/:id` kiểm tra chủ sở hữu/admin. Upload tối đa 3 MB, JPG/PNG/WebP; hồ sơ cho phép PDF. Token không có prefix `NEXT_PUBLIC`.

### Cấu hình ảnh trên production

1. Vercel → project `toigibanthe` → Storage → Create Storage → Blob. Tạo store Public cho ảnh món, avatar và banner; kết nối với project ở Production/Preview.
2. Lấy read-write token của store Public, lưu vào biến server `BLOB_PUBLIC_READ_WRITE_TOKEN` trong Environment Variables. App dùng tên này, không dùng tên mặc định `BLOB_READ_WRITE_TOKEN`.
3. Tạo store Private riêng cho hồ sơ xác minh chef, lưu token vào `BLOB_PRIVATE_READ_WRITE_TOKEN`. Dùng token đúng store Public/Private.
4. Redeploy để deployment nhận các biến mới.
5. Chef → Quản lý sản phẩm → sửa món → chọn ảnh → đợi tải lên → lưu món. Admin có thể dùng upload ảnh trong mục Banner. Việc tạo Blob store không tự thay URL ảnh mẫu đã lưu trong TiDB.

Ảnh seed nằm trên Unsplash. Hiện `next.config.ts` dùng `images.unoptimized: true` để trình duyệt tải trực tiếp từ CDN, vì `/_next/image` trong deployment Services trả HTML thay vì ảnh. Next Image vẫn giữ lazy loading và kích thước bố cục; không tạo ảnh thu nhỏ qua Vercel Image Optimization. Nên upload ảnh JPG/WebP đã nén với dung lượng khoảng 200–500 KB để tải nhanh trên mobile.

Goong dùng [Directions V2](https://help.goong.io/kb/rest-api-v2/directions-rest-api-v2/directions-v2/). Bán kính giao dùng khoảng cách địa lý; khoảng cách/phí đường đi dùng Goong. Khi chưa có key, UI cho nhập tọa độ và phí cố định; không giả khoảng cách đường đi. Xe ở giữa tuyến là minh họa trạng thái Đang giao, chưa phải GPS người giao.

QR dùng renderer SePay theo snapshot ngân hàng, số tiền và nội dung của đơn; không cần `VIETQR_CLIENT_ID` / `VIETQR_API_KEY`. Mã mới có dạng `TGBD` + 10 ký tự hex. Đơn cũ 12 ký tự vẫn được đối soát.

### Cấu hình SePay cho từng bếp

1. Chef lưu ngân hàng, số tài khoản và tên chủ tài khoản trong **Bếp → Cài đặt**.
2. Trong **Thanh toán tự động · SePay**, tạo API Key và sao chép trước khi lưu. Ứng dụng chỉ lưu SHA-256; để trống key khi sửa để giữ key cũ.
3. Liên kết đúng tài khoản ngân hàng trong SePay. Tạo webhook **Có tiền vào**, URL lấy từ cài đặt bếp, phương thức xác thực **API Key**, dán cùng key. SePay gửi `Authorization: Apikey KEY`. Đây không phải API Access Token. Nếu lọc mã thanh toán: tiền tố `TGBD`, hậu tố 10 ký tự chữ/số.
4. Bật tự xác nhận và lưu tại app. Dùng **Gửi thử** của SePay kiểm tra HTTP 200 và `success: true`; dùng **Render mã QR mẫu** kiểm tra ảnh. QR mẫu `TGBDTEST` không khớp đơn thật.
5. Tạo đơn mới, chuyển đúng số tiền/nội dung. Khi webhook hợp lệ, đơn chuyển **Đã thanh toán** (`PAID_AUTO`), chef bấm **Nhận đơn** để bắt đầu xử lý.

Schema bổ sung tại `database/004_sepay.sql` và `database/005_sepay_details.sql` tự khởi tạo khi tính năng được dùng lần đầu; tài khoản DB cần quyền CREATE TABLE. Có thể chạy các SQL này trước nếu DB chỉ cho quyền đọc/ghi. `SITE_URL` phải là URL production HTTPS; không cần biến API key chung vì mỗi chef có key riêng.

Webhook khớp chef, mã đơn, BIN ngân hàng, số tài khoản snapshot, thời gian và số tiền; chống trùng transaction ID/reference bằng unique indexes trong transaction. Tiền thiếu được cộng dồn, tiền thừa cần đối soát; tiền tới sau hạn/hủy đưa vào chờ hoàn tiền, không mở lại đơn. Đơn hoàn thành nhận thêm tiền tạo yêu cầu đối soát nhưng không đổi trạng thái thanh toán cũ. Chưa hỗ trợ tài khoản ảo VA. Hoàn tiền vẫn do bếp xử lý ngoài ứng dụng. Đơn tạo trước khi bật SePay giữ cách xác nhận cũ; admin có thể đối soát thủ công khi cần. Key mới phải cập nhật đồng thời ở SePay. WebSocket đẩy thông báo, màn hình đơn chờ kiểm tra thêm mỗi 10 giây khi đang mở.

Tài liệu: [Webhook SePay](https://docs.sepay.vn/tich-hop-webhooks.html), [QR renderer SePay](https://docs.sepay.vn/tao-qr-code-vietqr-dong.html).

### Webhook 200 nhưng đơn chưa thanh toán

`success: true` xác nhận hệ thống đã tiếp nhận webhook. Chỉ `result: PAID` xác nhận đã khớp đủ tiền với đơn. Với `UNMATCHED`, mở **Bếp → Cài đặt → Giao dịch gần đây** để xem số tiền, tài khoản nhận (4 số cuối), nội dung, mã/mô tả SePay và lý do. SePay phải theo dõi tài khoản nhận tiền trên QR của đơn, không phải tài khoản chuyển tiền. Khách cần giữ nguyên số tiền và nội dung `TGBD` kèm mã đơn. Không tự gán giao dịch không có mã theo số tiền hoặc tên người chuyển.

Các webhook mới lưu thêm code/description để chẩn đoán. Có thể xử lý lại receipt UNMATCHED nếu SePay bổ sung mã qua code/description, nhưng ngân hàng, tài khoản, số tiền, thời gian, reference và nội dung gốc phải giữ nguyên; receipt đã ghi nhận vào đơn không thể dùng lần hai. Các mã trích riêng trong trường code (10/12 ký tự hex) được hỗ trợ, mã mâu thuẫn vẫn bị từ chối.

## Vercel và TiDB production

`vercel.json` khai báo hai service: Next.js `web`, Node `realtime`; `/realtime/*` tới WebSocket, các route còn lại tới web. Cấu hình theo [Vercel Services beta](https://vercel.com/docs/services) và [hướng dẫn Node WebSocket](https://vercel.com/kb/guide/real-time-presence-hono-react).

Service `realtime` đặt `buildCommand: "npm run typecheck"` để kiểm tra kiểu trước khi Vercel biên dịch entrypoint TypeScript bằng Node builder. Cần giữ cấu hình này: hai service dùng chung root, nếu realtime chạy lại script `build` của package thì `next build` lần hai sẽ ghi đè `.next` và làm mất manifest của service web khi phát hành. Services yêu cầu build command có ít nhất một ký tự.

1. Tạo TiDB cluster/database riêng, lấy MySQL connection URL, đặt `DATABASE_SSL=true`; chạy migrations với tài khoản có quyền tạo schema. Chạy integration trên staging TiDB trước khi dùng dữ liệu thật.
2. Import repo vào Vercel, chọn Framework Preset **Services**. Đặt web và database gần nhau nếu cấu hình tài khoản cho phép; dùng Node 20.19+.
3. Điền tất cả env cho web và realtime. Đặt `SITE_URL`, `WS_ALLOWED_ORIGINS` theo domain thật; để trống `NEXT_PUBLIC_WS_URL` nếu dùng cùng domain.
4. Tạo Blob stores, Goong keys và webhook SePay; kiểm tra upload, đọc hồ sơ private, QR ngân hàng và directions thực.
5. Cấu hình không khai báo Vercel Cron để tránh giới hạn cron mỗi ngày của Hobby. Thiết lập scheduler bên ngoài theo hướng dẫn dưới để xử lý đơn hết hạn/broadcast khi không có socket đang mở. Runtime realtime cũng xử lý theo batch khi đang hoạt động; database khóa để chống chạy trùng.
6. Tạo user quản trị production riêng qua cơ chế provision nội bộ. Hoàn thiện chính sách/hỗ trợ, backup và cảnh báo trước khi nhận đơn thật.

WebSocket dùng outbox MySQL để mỗi instance nhận sự kiện, auth bằng JWT ngắn hạn gắn session; reconnect tải lại thông báo từ database. Socket có thể bị nền tảng đóng/khởi động lại; client tự kết nối lại. Chưa có Push khi trang đóng.

### Dữ liệu khởi tạo production

`database/003_initial_settings.sql` tạo 4 bữa và cấu hình phí giao ban đầu. Chạy bằng migration hoặc dán nội dung vào TiDB SQL Editor sau `USE toigibanthe;`. Có thể chạy lại; các giá trị đã có được giữ nguyên. Giờ đóng bữa và phí giao có thể chỉnh trong admin.

Đăng ký tài khoản của bạn trên web production để app tạo mật khẩu bcrypt. Trong TiDB SQL Editor, cấp quyền quản trị cho đúng email đã đăng ký:

```sql
USE toigibanthe;
UPDATE users SET role='admin' WHERE email='EMAIL_CUA_BAN' AND active=TRUE;
SELECT id,email,role FROM users WHERE email='EMAIL_CUA_BAN';
```

Sau đó đăng nhập bằng email/mật khẩu đã đăng ký và vào `/admin`. Tài khoản `.local` chỉ tồn tại ở MySQL local nếu chưa seed vào TiDB. Không nhập mật khẩu thô vào cột `password_hash`.

### Seed dữ liệu mẫu vào TiDB production để dùng thử

```powershell
npm run db:seed:export
```

Lệnh này xuất `.local/production-demo.sql` và `.local/production-demo.credentials.txt`, không kết nối database. Mật khẩu riêng được sinh ngẫu nhiên và băm bcrypt; không dùng mật khẩu local. Cả hai file được Git bỏ qua. Để xuất một bộ mới, dùng tên file khác: `npm run db:seed:export -- .local/production-demo-2.sql`.

1. Trên TiDB SQL Editor, thay nội dung hiện tại bằng toàn bộ file SQL vừa xuất. File bắt đầu bằng `USE toigibanthe;`. Chọn toàn bộ SQL rồi Run.
2. Kiểm tra truy vấn cuối trả 6 tài khoản và 16 sản phẩm. `INSERT IGNORE` giữ lại dữ liệu đã có; chạy lại không thay mật khẩu tài khoản đã tồn tại.
3. Lấy mật khẩu từ file credentials và đăng nhập trên web. Admin: `admin@toigibando.local`, user: `user@toigibando.local`, các chef: `chef@toigibando.local`, `nam@toigibando.local`, `ha@toigibando.local`, `linh@toigibando.local`.
4. Seed có 4 bếp ở Quận 3, TP.HCM, 16 món, banner, sale và voucher. Thực đơn/khuyến mãi được tính ở lúc chạy SQL theo giờ Việt Nam; bữa hết giờ vẫn bị ẩn. Ngày tiếp theo chef cần mở bếp và tạo thực đơn mới. GPS ngoài bán kính 5 km sẽ không thấy món của các bếp mẫu.

Các bếp mẫu không có thông tin ngân hàng để nhận thanh toán. Dùng tài khoản và dữ liệu thật khi chuyển sang vận hành nhận đơn thật. Nếu `DATABASE_URL` đã trỏ đúng `/toigibanthe` trên deployment hiện tại, nhập seed xong chỉ cần tải lại trang.

### Scheduler bên ngoài cho Vercel Hobby

Endpoint `/api/cron` vẫn yêu cầu secret, dù không dùng Vercel Cron. Sau khi deploy:

1. Tạo job tại [cron-job.org](https://cron-job.org/en/) (hỗ trợ miễn phí lịch mỗi phút).
2. URL: `https://DOMAIN-CUA-BAN/api/cron`, phương thức `GET`, lịch mỗi phút.
3. Trong phần header tùy chỉnh, thêm `Authorization` với giá trị `Bearer GIA-TRI-CRON_SECRET`; dùng đúng secret đã đặt trong Vercel Production, không đưa secret vào URL.
4. Chạy thử job và kiểm tra HTTP 200, JSON `ok: true`. Sai hoặc thiếu secret trả 401. Kiểm tra lịch sử thực thi sau khi đóng các tab app.

Dùng domain production ổn định, không dùng URL preview. Nếu Deployment Protection chặn request, cấu hình header automation bypass theo [tài liệu Vercel](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation). Hướng dẫn header scheduler: [cron-job.org](https://docs.cron-job.org/creating-cron-jobs.html).

Chưa thiết lập scheduler thì xử lý đơn hết hạn và broadcast có thể bị trì hoãn khi service realtime không hoạt động. Thông báo realtime cho các client đang kết nối vẫn đi qua WebSocket. Request từ scheduler vẫn tính vào quota Vercel và TiDB.

Nếu cần Node host riêng cho realtime, dùng `services/realtime/Dockerfile`, cấu hình WSS/TLS của host và `NEXT_PUBLIC_WS_URL`; web vẫn ở Vercel.

Đã kiểm chứng MySQL local; chưa có TiDB cluster, tài khoản deploy hay service keys để xác nhận production. Migrations dùng SQL MySQL thông thường, tọa độ DOUBLE, không phụ thuộc PostGIS/RLS hay Supabase.

## Đối soát / hoàn tiền

- Mỗi đơn chỉ có một yêu cầu của khách, kể cả gửi đồng thời. Số điện thoại liên hệ bắt buộc và được điền sẵn từ hồ sơ cá nhân.
- Khi đơn đang chờ thanh toán/chờ bếp nhận, ẩn mục gửi đối soát riêng. Hủy/từ chối đơn đã nhận tiền sẽ tạo yêu cầu hoàn tiền và thông báo chef trong cùng giao dịch với hủy đơn; số liên hệ lấy từ hồ sơ khách hoặc số điện thoại giao hàng. Nếu đã có yêu cầu cũ, dùng lại yêu cầu đó và chờ bằng chứng hoàn tiền mới.
- Chef gọi khách, ghi nội dung giải quyết và tải ảnh/PDF bằng chứng tối đa 3 MB. Tệp dùng Blob private và `BLOB_PRIVATE_READ_WRITE_TOKEN`; chỉ chủ tệp, khách của đơn và admin được xem.
- Trạng thái: `OPEN` (Chờ xử lý) → `REVIEW` (Chờ hệ thống) → `RESOLVED`/`REFUNDED` (Đã xử lý). Admin duyệt bằng chứng tại `/admin?tab=payments`, hoặc yêu cầu bổ sung để trả về `OPEN`. Khách vẫn không được tạo yêu cầu thứ hai.
- Migration `database/006_payment_requests.sql` thêm bảng chi tiết, ràng buộc duy nhất theo đơn và giữ nguyên các bản ghi trùng trong lịch sử. App cũng tự khởi tạo/backfill bảng này khi đọc hoặc gửi yêu cầu lần đầu trên MySQL/TiDB.
- Khi xác nhận đã hoàn tiền, chỉ đơn có `REFUND_PENDING` được chuyển sang `REFUNDED_MANUAL`; đối soát tiền dư không thay đổi thanh toán gốc của đơn. Đây là xác nhận bằng chứng, không thực hiện chuyển khoản ngân hàng tự động.

## Kiểm tra

```powershell
npm run typecheck
npm test
npm run build
```

Integration cần app và WebSocket đang chạy local:

```powershell
npm run test:integration
```

Tests tạo dữ liệu riêng rồi dọn theo ID: đăng nhập/session, suất cuối đồng thời, idempotency, báo giá và tổng thay đổi, phân quyền hồ sơ/đơn/admin, thanh toán thủ công, giao/hoàn thành/review, bán kính/cutoff, socket hợp lệ/sai.

## Cấu trúc

Chuyển trang dùng React ViewTransition có sẵn trong Next.js: Slide Out 200 ms, Slide In 280 ms, đổi chiều theo tab hoặc liên kết quay lại. Header/thanh dưới giữ vị trí; tôn trọng `prefers-reduced-motion`. Trình duyệt chưa có View Transitions dùng CSS Slide In dự phòng. Mã dùng chung tại `src/components/page-motion.tsx`, hiệu ứng tại `src/app/globals.css`.

- `src/app`: Next routes, metadata, CSS, API.
- `src/components`: giao diện user, dashboard, providers, bản đồ.
- `src/lib`: auth, MySQL, catalog, orders, báo giá, quản trị và jobs.
- `database`: SQL migrations.
- `services/realtime`: WebSocket server và Dockerfile.
- `scripts`: migrate/seed và setup local.
- `tests`: domain và integration.
- `docs/PRODUCT_PLAN.md`: phạm vi thực hiện và phần mở rộng.

Dashboard Tổng quan có bộ lọc kỳ/khu vực/bữa, chỉ số toàn hệ thống, cảnh báo, hiệu suất chef/món, nhu cầu, hành trình đặt hàng, khách quay lại, khuyến mãi, chi phí, mục tiêu và CSV. Định nghĩa số liệu, migration và giới hạn dữ liệu tại [docs/admin-analytics.md](docs/admin-analytics.md). Báo cáo tổng hợp độc lập với giới hạn danh sách quản lý.

Đăng nhập Google: xem [docs/google-login.md](docs/google-login.md) để cấu hình OAuth, biến môi trường Vercel và migration. Form đăng nhập/đăng ký hỗ trợ hiện/ẩn mật khẩu.

Tab Users có badge `+N user` cho đăng ký mới chưa xem, cập nhật qua WebSocket và lưu theo từng admin. Cấu hình database và quy tắc đã xem tại [docs/admin-registration-alerts.md](docs/admin-registration-alerts.md).

Chưa triển khai OTP, reset mật khẩu email, GPS người giao, quyết toán phí nền tảng và menu copy. Danh sách quản lý dashboard hiện giới hạn; cần phân trang và đo tải với dữ liệu production. Manifest hỗ trợ thêm màn hình chính; chưa có offline checkout. Chính sách vận hành cần chủ sản phẩm hoàn thiện trước công khai.
