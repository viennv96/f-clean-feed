# Hồ sơ xuất bản Chrome Web Store – F Clean Feed

Mọi nội dung dưới đây dán thẳng vào [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## 0. Trước khi nộp

- [ ] **Thẻ quảng cáo trên trang Facebook:** chính sách Chrome Web Store cấm extension chèn quảng cáo vào trang của bên thứ ba, nhất là với một trình chặn quảng cáo. Trước khi nộp store, đặt `showPromo: false` trong `content/settings.js` và `content/bridge.js`, hoặc bỏ hẳn phần “Developer's card” trong `content/bridge.js`. Liên kết trong popup thì giữ được.
- [ ] **Chạy thử trên Facebook thật.** Quảng cáo cột phải và khay Reels mới chỉ được test trên trang giả. Nộp bản chặn chưa sạch dễ bị đánh giá 1 sao ngay từ đầu.
- [ ] Đăng ký tài khoản developer (phí một lần 5 USD) và bật xác minh 2 bước cho tài khoản Google.
- [ ] Chính sách quyền riêng tư đã được đăng qua GitHub Pages: https://cleanfeed.viennv.dev/privacy-policy.html (mở thử link trước khi nộp).
- [ ] Chạy lại `sh store/build.sh` (cần server `fixture` đang chạy) để có `dist/f-clean-feed-<version>.zip` mới nhất.

## 1. Gói tải lên

`dist/f-clean-feed-<version>.zip` (cũng có trong GitHub Releases) chỉ chứa `manifest.json`, `_locales/`, `content/`, `icons/`, `popup/`. Không có thư mục test hay tài nguyên store.

## 2. Thông tin store (Store listing)

| Trường | Giá trị |
|---|---|
| Tên | Lấy từ manifest: **F Clean Feed: Ad & Reels Blocker for Facebook** (tiếng Việt: *F Clean Feed: Chặn quảng cáo & Reels cho Facebook*) |
| Tóm tắt | Lấy từ manifest (≤ 132 ký tự) |
| Danh mục | Social & Communication |
| Ngôn ngữ | English (mặc định), Tiếng Việt |
| Icon | `icons/128.png` (đã có sẵn lề trong suốt 16 px theo hướng dẫn của Google) |
| Ảnh chụp màn hình (1280×800) | `store/assets/en/screenshot-1…4.png`. Cho bản tiếng Việt dùng `store/assets/vi/…` |
| Ô quảng bá nhỏ (440×280) | `store/assets/en/promo-small-440x280.png` |
| Ảnh marquee (1400×560) | `store/assets/en/promo-marquee-1400x560.png` |
| Trang chủ / hỗ trợ | https://viennv.dev (đã khai báo `homepage_url` trong manifest) |

### Mô tả chi tiết – English

```
F Clean Feed gives you a calmer Facebook feed: just the people, groups and pages you actually follow.

WHAT IT HIDES
• Sponsored posts in the news feed
• "Suggested for you" posts
• Reels trays and short videos (optionally keep reels shared by your friends)
• People You May Know and suggested groups
• Stories bar (optional)
• Ads on Marketplace, in search results and in the right-hand column
• Birthday reminders and notification counters (optional)
• Clean mode: hide both side columns on the home page for a focused, centred feed

HOW IT WORKS
• Every filter is a single switch. Changes apply instantly, with no reload.
• Choose "Remove" to drop hidden items entirely, or "Collapse" to leave a slim line you can click to reveal.
• See how much clutter has been removed today and in total.

PRIVATE BY DESIGN
• No account, no sign-up.
• No servers, no analytics, no third-party code. Nothing you read ever leaves your browser.
• Only runs on facebook.com, and only needs the "storage" permission to remember your settings.

F Clean Feed is free. It shows one small card labelled “Ad” for the developer's VPS hosting service (viennv.dev) in the right column of the Facebook home page, plus a link in the popup. The card can be hidden for 7 days or turned off in the popup.

Developer: Nguyễn Văn Viên – https://viennv.dev

Facebook is a trademark of Meta Platforms, Inc. F Clean Feed is an independent project and is not affiliated with, endorsed or sponsored by Meta.
```

### Mô tả chi tiết – Tiếng Việt

```
F Clean Feed giúp bảng tin Facebook gọn gàng hơn: chỉ còn bạn bè, nhóm và trang bạn thực sự theo dõi.

ẨN NHỮNG GÌ
• Bài được tài trợ trên bảng tin
• Bài "Gợi ý cho bạn"
• Khay Reels và video ngắn (có thể giữ lại Reels bạn bè chia sẻ)
• "Những người bạn có thể biết" và nhóm gợi ý
• Thanh Tin (Stories) – tuỳ chọn
• Quảng cáo trên Marketplace, trong kết quả tìm kiếm và ở cột phải
• Nhắc sinh nhật và số đếm thông báo – tuỳ chọn
• Chế độ gọn: ẩn hai cột bên ở trang chủ để bảng tin nằm giữa, tập trung hơn

CÁCH DÙNG
• Mỗi bộ lọc là một công tắc, có hiệu lực ngay, không cần tải lại trang.
• Chọn "Xoá khỏi trang" để ẩn hẳn, hoặc "Thu gọn" để còn một dòng nhỏ, bấm vào là xem lại.
• Xem thống kê số nội dung đã lọc hôm nay và tổng cộng.

RIÊNG TƯ NGAY TỪ THIẾT KẾ
• Không cần tài khoản, không cần đăng ký.
• Không máy chủ, không analytics, không mã bên thứ ba. Những gì bạn đọc không bao giờ rời khỏi trình duyệt.
• Chỉ chạy trên facebook.com, chỉ cần quyền "storage" để nhớ cài đặt.

F Clean Feed hoàn toàn miễn phí. Extension hiển thị một thẻ nhỏ có nhãn “Quảng cáo” cho dịch vụ VPS của nhà phát triển (viennv.dev) ở cột phải trang chủ Facebook, và một liên kết trong popup. Có thể ẩn thẻ 7 ngày hoặc tắt hẳn trong popup.

Nhà phát triển: Nguyễn Văn Viên – https://viennv.dev

Facebook là thương hiệu của Meta Platforms, Inc. F Clean Feed là dự án độc lập, không liên kết, không được Meta bảo trợ hay tài trợ.
```

## 3. Tab Privacy (Quyền riêng tư)

**Single purpose (Mục đích duy nhất):**

```
F Clean Feed hides unwanted units on facebook.com – sponsored posts, recommendations, Reels, Stories and side-column ads – according to the user's settings.
```

**Permission justification:**

| Quyền | Lý do (dán vào ô tương ứng) |
|---|---|
| `storage` | Stores the user's filter settings (chrome.storage.sync) and local counters of how many items were hidden (chrome.storage.local). No personal data is stored. |
| Host permission `https://www.facebook.com/*`, `https://web.facebook.com/*` | Content scripts must run on facebook.com to detect and hide sponsored and recommended units. The extension does not run on any other site. |

**Remote code:** chọn *No, I am not using remote code*. Mọi JavaScript đều nằm trong gói.

**Data usage:** không tích chọn mục dữ liệu nào (extension không thu thập dữ liệu), sau đó tích đủ 3 ô cam kết:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** `https://cleanfeed.viennv.dev/privacy-policy.html`

## 4. Rủi ro khi duyệt

- **Thương hiệu:** tên có chữ "Facebook". Đây là cách dùng mô tả, phổ biến trên store và đã kèm tuyên bố "không liên kết với Meta" ở mô tả, ảnh và chính sách. Icon không dùng logo hay màu của Facebook. Nếu bị từ chối vì lý do thương hiệu, đổi tên thành `F Clean Feed – Ad & Reels Blocker` và chỉ nhắc Facebook trong phần mô tả.
- **Liên kết quảng bá VPS:** chỉ nằm trong popup và đã ghi rõ trong mô tả. Không được chèn quảng cáo hay link vào trang Facebook: Google cấm extension chèn quảng cáo vào trang của bên thứ ba, đồng thời điều đó mâu thuẫn với chính mục đích của một trình chặn quảng cáo.
- **`world: "MAIN"`:** script chạy trong ngữ cảnh trang để đọc dữ liệu React. Đây là API chính thức của MV3, không phải remote code, nhưng reviewer có thể hỏi. Câu trả lời: script chỉ đọc thuộc tính DOM và React fiber để phân loại bài, không gửi request, không sửa dữ liệu trang.
- Thời gian duyệt thường từ vài ngày đến khoảng 2 tuần.

## 5. Cập nhật phiên bản sau

1. Tăng `version` trong `manifest.json`.
2. `sh store/build.sh`
3. Dashboard → Package → Upload new package → Submit for review.
