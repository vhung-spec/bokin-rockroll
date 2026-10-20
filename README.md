# MV Prompt Studio 🎙️

Công cụ tạo **bộ prompt video hoàn chỉnh** cho MV phong cách 1950s American (Doo-Wop, Rock & Roll, Rockabilly).
Bạn chỉ nhập **ý tưởng** của từng bài (1 dòng), công cụ tự sinh:

- **Character Bible**: mô tả cố định của cặp đôi, được chèn **nguyên văn** vào mọi prompt để nhân vật nhất quán giữa các clip.
- **Storyboard** chia theo cấu trúc bài hát (Intro → Verse → Pre-chorus → Chorus → … → Outro), mỗi cảnh có thời gian, mô tả tiếng Việt và **prompt tiếng Anh** đã gắn style preset ở cuối.
- **Thumbnail prompt**, 3 gợi ý **tiêu đề YouTube**, **mô tả** theo giọng văn kênh và **ghi chú dựng phim**.
- **Kiểm tra niên đại** (xe đời sau, điện thoại, LED, vòng đu quay trên Santa Monica Pier…), độ dài prompt, chữ trên màn hình, thương hiệu/người thật, nhịp dựng và **trùng lặp trong series**.

Chạy được **hàng loạt** (ví dụ 50 bài một lần) và xuất **XLSX (mỗi MV một sheet)**, CSV, Markdown, TXT, JSON, “Copy tất cả prompt” hoặc **File prompt (.txt)** — chỉ gồm các prompt, mỗi prompt cách nhau một dòng trống.

Khi công cụ tạo video trả clip về, app **ghép clip với nhạc thành MV hoàn chỉnh (MP4)**: ghép nguyên từng clip theo thứ tự cảnh và lặp lại cho tới hết bài (xem mục 2b).

Dùng **Muse (Meta)** thì app lo luôn phần clip: **Cổng Muse** chạy trên máy tự gửi từng cảnh cho Muse, clip nào xong tự vào đúng cảnh, đủ clip thì tự dựng (xem mục 2c).

---

## 1. Bắt đầu nhanh (không cần biết code)

1. **Cài Node.js** (một lần): tải bản **LTS** tại <https://nodejs.org> và cài như phần mềm bình thường.
2. **Tải app**: trên GitHub bấm **Code → Download ZIP**, rồi giải nén ra một thư mục (ví dụ `Documents/MV Prompt Studio`).
3. **Mở app**: bấm đúp vào
   - Windows: **`Chay-MV-Prompt-Studio.bat`**
   - macOS: **`Chay-MV-Prompt-Studio.command`** (lần đầu: chuột phải → *Open* → *Open* để macOS cho phép chạy.
     Nếu báo không có quyền chạy: mở Terminal, gõ `bash ` rồi kéo file này vào cửa sổ Terminal và nhấn Enter.)

   Lần đầu app tự cài thư viện và chuẩn bị (vài phút), các lần sau chỉ vài giây. Trình duyệt tự mở trang app.
   **Giữ cửa sổ đen (terminal) mở** trong khi dùng; đóng nó là tắt app.
4. Vào **Cài đặt → Cách tạo nội dung** và chọn một trong hai cách bên dưới.

### Chọn cách tạo nội dung

| | **claude.ai (copy – dán)** | **Claude API** |
|---|---|---|
| Cần gì | Tài khoản claude.ai (Free/Pro/Max) | API key (trả phí theo token) |
| Chi phí | **0 đ** phí API (dùng gói claude.ai của bạn) | khoảng **$0,10–0,20 / MV** (≈ 2.800–5.400 đ) với `claude-sonnet-5-5` |
| Cách làm | Mỗi MV: bấm **Copy yêu cầu** → dán vào claude.ai → dán câu trả lời lại vào app | Bấm **Chạy batch**, app tự làm hết (50 bài một lần) |
| Hợp với | Làm vài bài mỗi ngày | Làm hàng loạt |

- Chế độ **Tự động** (mặc định): có API key thì dùng API, chưa có thì dùng claude.ai.
- **Nhập API key ngay trong app**: Cài đặt → *API key của Claude* → dán key → **Lưu key** (app kiểm tra key luôn). Key được lưu trong file `.env.local` trên máy bạn.
  Lấy key tại <https://platform.claude.com/settings/keys>.
- Còn chế độ **Demo** (ghép từ mẫu, không dùng AI) để thử giao diện.

### Chi phí ($ và đ)

- Trước khi chạy, bảng xem trước hiện **ước tính chi phí** cho cả batch và trung bình mỗi MV.
- Sau khi chạy bằng API, app ghi **chi phí thật** (theo số token Claude báo về, gồm cả các lần sinh lại cảnh) ở trang kết quả, trang batch (tổng cả batch),
  Lịch sử (từng MV, tổng series, tổng phần đã chọn) và sheet “Tổng quan” trong file XLSX.
- Sửa **bảng giá** và **tỷ giá đ/USD** ở Cài đặt → *Chi phí & tỷ giá* (mặc định 26.000 đ/USD). Chi phí render clip trên Veo/Kling… không tính ở đây.

## 2. Cách dùng

1. **Nhập ý tưởng** → tab **Dán bảng** → bấm **“Dùng 5 dòng ví dụ”** (hoặc dán bảng của bạn từ Google Docs/Sheets) → **Đọc bảng & xem trước**.
   Bảng xem trước cho biết năm, địa điểm đã khớp thư viện hay sẽ tự suy luận, chủ đề có trong thư viện chưa, số prompt và chi phí ước tính.
2. - **Claude API**: bấm **Chạy batch** → trang **Chạy batch** hiện thanh tiến trình. Có thể **Tạm dừng**, **Dừng ngay**, **Chạy tiếp**, **Thử lại mục lỗi**.
     Batch vẫn chạy khi bạn chuyển sang xem trang khác; nếu tải lại trang, bấm “Chạy tiếp”.
   - **claude.ai**: bấm **Tạo … yêu cầu cho claude.ai** → trang **claude.ai** liệt kê từng MV với 3 bước: **Copy yêu cầu** → **Mở claude.ai** (cuộc trò chuyện mới, dán, gửi)
     → dán câu trả lời của Claude vào ô và bấm **Hoàn tất MV**.
3. Bấm **Mở storyboard** để xem từng MV: mỗi cảnh có nút **Copy prompt**, **Sinh lại cảnh này** (kèm yêu cầu, vd. “góc máy khác”; ở chế độ claude.ai cũng là copy – dán) và **Sửa tay**.
4. Xuất file: **XLSX** (sheet “Tổng quan” + mỗi MV một sheet), **CSV** (có cột `mv_id`), **MD/TXT** (đọc nhanh), **JSON** (nhập lại được ở trang Lịch sử), **Copy tất cả prompt** (mỗi prompt một dòng), hoặc **File prompt (.txt)**: chỉ gồm các prompt, mỗi prompt cách nhau một dòng trống — tiện nhập hàng loạt vào công cụ tạo video. Có ở trang batch, trang kết quả và Lịch sử (cả theo series).

## 2b. Ghép video với nhạc (ra MP4 hoàn chỉnh)

Trên trang kết quả của MV bấm **🎬 Ghép video với nhạc**:

1. **Bài hát**: chọn hoặc thả file nhạc (MP3, WAV, M4A, FLAC…). App đo độ dài, **nhận nhịp (BPM)** và vẽ dạng sóng âm.
2. **Clip video**: **thả tất cả clip (hoặc cả thư mục) vào một lần** — hoặc bấm **Chọn clip** / **Chọn cả thư mục**. Không cần chọn cho từng cảnh:
   app tự xếp — file có số cảnh trong tên (`shot-03.mp4`, `cảnh 3.mov`, `03.mp4`) vào đúng chỗ, còn lại theo **thứ tự tên file**
   (nên tải clip về theo thứ tự cảnh, vd. `veo_20261019_101500.mp4`, `veo_20261019_102233.mp4`…). Có **nhiều clip hơn số cảnh** cũng được:
   clip thêm được phát nối tiếp sau cảnh cuối. Các clip hiện thành một dải theo đúng thứ tự phát; muốn tải bộ khác thì **Xoá tất cả clip**.
   Mục **Sửa từng cảnh** (không bắt buộc) để thay / chuyển một clip, hoặc copy prompt cho cảnh còn thiếu.
3. **Cách dựng** — chọn một trong hai cách ghép:
   - **Ghép nguyên clip, lặp đến hết bài** (mặc định): mỗi clip phát **trọn vẹn** (không cắt nhỏ) theo thứ tự cảnh 1 → N; hết lượt thì lặp lại từ clip 1
     cho tới khi hết nhạc, clip cuối được cắt đúng lúc bài kết thúc. Ví dụ 20 clip × 8 giây = một vòng 2:40; bài 3:00 → phát 20 clip rồi lặp thêm 3 clip đầu.
     **🎲 Xáo các vòng sau**: vòng đầu vẫn theo thứ tự, các vòng lặp sau đổi thứ tự (không bao giờ hai clip giống nhau liền nhau).
   - **Cắt theo nhịp nhạc**: cắt clip thành nhiều nhát ngắn 2–5 giây, đoạn nào dùng cảnh của đoạn đó, điểm cắt đúng phách.

   Tuỳ chọn chung: khung hình (1080p, 720p, dọc 9:16 cho Shorts/TikTok), cắt cho đầy khung hay thêm viền đen, 24/30 hình/giây, mờ dần đầu/cuối,
   lật ngang khi lặp. Xem trước ngay trên **timeline** (bấm vào để nghe từ chỗ đó).
4. **Âm thanh, logo & intro** (cách xuất của Bokin Studio Music):
   - **Cân bằng âm lượng**: Chuẩn YouTube −14 LUFS (mặc định), −18 LUFS (mặc định của Bokin Studio Music), hoặc tắt.
   - **Chất lượng xuất**: YouTube (đẹp nhất) hoặc Nhanh (để xem thử).
   - **Logo kênh** ở góc: vị trí, cỡ, độ hiện, lề, cắt tròn, hiện từ giây thứ mấy.
   - **Intro tiêu đề**: tiêu đề (để trống = tên bài), dòng phụ (vd. tên kênh), độ dài, độ nhoè nền, font riêng (.ttf/.otf) nếu muốn.
   - **Thông tin video** ghi vào file MP4 **tự động cho từng MV** từ gợi ý lúc dựng kịch bản: tiêu đề = gợi ý tiêu đề YouTube số 1,
     mô tả = mô tả YouTube, từ khoá = các hashtag trong mô tả, năm = năm dựng; chỉ cần nhập một lần **tên kênh** và **thể loại**.
     File tải về cũng mang tên theo tiêu đề đó — YouTube lấy tên file làm tiêu đề mặc định khi upload.
   - **Xem thử khung hình** ở một giây bất kỳ để kiểm tra logo / intro mà không cần dựng cả video.
5. Bấm **Dựng video** → xem ngay trên trang và **Tải MP4 về máy**. File cũng nằm trong `data/media/<mã MV>/`.
   Dưới video có báo cáo: âm lượng trước → sau, đỉnh tiếng, và kết quả kiểm tra (đủ khung hình, độ dài hình/tiếng).

### Dựng nhiều MV một lượt: **Hàng chờ dựng**

Thiết lập ở bước 3–4 (cách ghép, khung hình, chất lượng, âm lượng, logo, font, intro, thông tin video) là **thiết lập chung cho mọi MV** —
chỉ cần chọn **một lần**, sửa ở trang của MV nào hay ở trang **Hàng chờ dựng** cũng là sửa chung. Tiêu đề intro / tiêu đề video để trống thì mỗi MV
tự lấy tên bài của mình. Riêng nhạc, clip, BPM và mốc các đoạn (khi cắt theo nhịp) là của từng MV.

Trang **Hàng chờ dựng** (thanh menu trên cùng):

1. **Thiết lập dựng** — xem / sửa thiết lập chung (có nút xem thử khung hình).
2. **Chọn MV để dựng** — bảng mọi MV với tình trạng bài hát và số clip; **Chọn tất cả MV đủ nhạc + clip** → **Thêm & ▶ chạy ngay**
   (hoặc chỉ thêm vào hàng chờ rồi chạy sau). MV chưa có nhạc / clip không chọn được — bấm **Tải nhạc / clip** để mở trang của MV đó.
3. **Hàng chờ** — app dựng **lần lượt từng MV** (mỗi lúc một MV để máy không quá tải), hiện tiến độ của MV đang dựng; xong MV nào có nút **⬇ Tải MP4** ngay.
   **‖ Dừng sau MV này**, **✖ Huỷ MV đang dựng**, **↻ Dựng lại** mục lỗi / bỏ qua, **Xoá các mục đã xong**. MV thiếu nhạc hoặc clip được **bỏ qua** (ghi rõ lý do)
   và app dựng tiếp MV sau.

Cũng thêm được MV vào hàng chờ từ trang Ghép video của MV (**➕ Thêm vào hàng chờ**) hoặc từ trang **Lịch sử** (chọn nhiều MV → **🎬 Thêm vào hàng chờ dựng**).
Hàng chờ được lưu lại (`data/render_queue.json`); nếu tắt app giữa chừng, MV đang dựng dở sẽ quay về hàng chờ — mở app, bấm **▶ Chạy hàng chờ** để tiếp tục.

App dựng thế nào:

- Ghép nguyên clip: các clip nối liền nhau, chuyển clip đúng khung hình; cảnh nào chưa có clip thì bỏ qua và lặp các clip đã có.
  Nếu cuối bài chỉ còn chưa tới 1 giây, app giữ khung cuối của clip đang phát (lúc đó hình đang mờ dần) thay vì chớp sang clip mới.
  Clip giống hệt nhau ở các vòng lặp chỉ phải dựng một lần nên nhanh hơn.
- Cắt theo nhịp: mỗi đoạn của bài (Intro, Verse, Chorus…) dùng **cảnh của chính đoạn đó**, đoạn thiếu clip mượn cảnh cùng loại (vd. Chorus 1 ↔ Chorus 2),
  lần lặp sau lấy **khúc khác** trong clip; điệp khúc cắt nhanh (khoảng 2–2,5 giây/nhát), verse ~4 giây, intro/outro giữ lâu hơn; khi nhận ra nhịp,
  mọi điểm cắt rơi **đúng phách nhạc**. Các đoạn được giãn theo độ dài thật của bài; nếu điệp khúc thật bắt đầu ở chỗ khác, mở **Mốc các đoạn trong bài**,
  phát nhạc và bấm **⏱ Đặt ở đây** đúng lúc đoạn bắt đầu.
- Tiếng của clip (Veo có tiếng) được tắt — MV chỉ dùng nhạc của bài. Video xuất ra là MP4 H.264 + AAC, xem được trên mọi máy và tải thẳng lên YouTube.
- **Khâu xuất chuyển từ engine của Bokin Studio Music** (`loop_music/loudness.py`, `quality.py`, `branding.py`, `engine.py`):
  - Bài hát được chuẩn hoá về 48 kHz stereo 24-bit (bài mono được nhân đôi đúng mức).
  - Âm lượng được đo bằng ebur128 (true peak), rồi chỉnh bằng **một mức gain cố định** = min(mục tiêu − độ to, −1,5 dBTP − đỉnh, +12 dB) — không nén, không loudnorm.
  - Sau khi mã hoá AAC, app đo lại đỉnh trên tiếng đã giải mã; vượt trần thì giảm gain và mã hoá lại (tối đa 3 lần).
  - Preset YouTube: H.264 High, CRF 17, giới hạn bitrate theo bảng upload SDR của YouTube (×1,5), keyframe mỗi nửa giây, không B-frame, đổi màu sang BT.709 (lanczos) và gắn thẻ màu cho mọi khung, AAC 384 kbps.
  - Logo (mặt nạ tròn, độ hiện, mờ dần) và intro "title" (mờ từ đen 1,5 s, chữ hiện từ 0,6 s, tắt trong giây cuối, nền nhoè rồi rõ dần 1,5 s) giữ đúng thông số của Bokin Studio Music.
    Chữ được đọc từ file (libass hoặc drawtext) nên không phải escape tên bài.
  - Trước khi công bố file, app **kiểm tra đầu ra**: giải mã toàn bộ hình và tiếng, đúng H.264 + AAC, đủ số khung hình, độ dài hình và tiếng lệch bài hát không quá 0,1 giây.
- Phần ghép / lặp 15–20 clip là của MV Prompt Studio — engine của Bokin Studio Music chỉ lặp một video nền dưới danh sách bài.
- Muốn tự dựng trong CapCut / Premiere: bấm **Danh sách cắt (.csv)** để có thời điểm và clip của từng nhát cắt.
- Cần **ffmpeg**: app tự cài kèm (`ffmpeg-static`) khi chạy file khởi động. Nếu báo thiếu, cài ffmpeg (Windows: `winget install ffmpeg`, macOS: `brew install ffmpeg`)
  hoặc đặt biến môi trường `FFMPEG_PATH` trỏ tới file ffmpeg.
- Thời gian dựng (máy thử 4 nhân, bài 3 phút, 20 clip, 1080p, chất lượng YouTube): ghép nguyên clip khoảng **2 phút** (bật lật ngang khi lặp: khoảng 2 phút 30 giây,
  vì clip lật phải dựng riêng), cắt theo nhịp khoảng **2 phút 50 giây**. Chất lượng Nhanh và 720p nhanh hơn nhiều.

### Cách chạy cho người dùng dòng lệnh

```bash
npm install
npm run dev          # http://127.0.0.1:3000 (tự cập nhật khi sửa mã)
# hoặc bản tối ưu:
npm run build && npm start
# hoặc giống file bấm đúp: node scripts/start.mjs
```

API key cũng có thể đặt trong file `.env` (xem `.env.example`). App chỉ mở trên máy của bạn (`127.0.0.1`), máy khác trong mạng không truy cập được.

### Định dạng bảng đầu vào

Mỗi dòng: `id | world_location | theme | outline | [tên bài] | [thời lượng] | [nhịp] | [lời] | [series]`
(tách bằng **tab** khi copy từ Sheets, hoặc bằng `|`). Có thể có dòng tiêu đề, tiếng Việt hay tiếng Anh đều được:

| Trường | Bắt buộc | Ví dụ |
|---|---|---|
| `id` | có (tự đánh số nếu thiếu) | `1` |
| `world_location` | có — **nên có năm** | `Hollywood Boulevard Summer 1954` |
| `theme_code` | có | `T01` hoặc `T01 Sét ái tình` |
| `outline` | có (tiếng Việt) | `Chàng trai bắt gặp cô gái…` |
| `song_title` | không | `Ferris Wheel Heart` |
| `duration_sec` | không (mặc định 180) | `200`, `3:20` |
| `bpm` / `tempo` | không | `slow`, `mid`, `fast`, `150` |
| `lyrics` | không | lời bài hát; nên có nhãn `[Verse 1]`, `[Chorus]`… |
| `series` | không | `1–50 · California – Las Vegas – Route 66 – New York` |

Upload **CSV/XLSX**: dòng đầu là tiêu đề cột như trên (sheet đầu tiên của file XLSX được đọc).

## 2c. Tạo clip bằng Muse

**Muse** là trợ lý AI của Meta (muse.ai) — nó làm được video từ prompt. App có hai cách gửi cảnh cho Muse (chọn ở **Cài đặt → Tạo clip bằng Muse**):

| | **Cổng Muse (tự động)** — mặc định | **HaoHao (dán tay)** |
|---|---|---|
| Gửi đi | App **tự gửi** từng cảnh (kèm ảnh tham chiếu nhân vật nếu có) | App copy prompt, bạn **dán một lần** vào tab Studio của HaoHao |
| Nhận về | Tự động: clip xong tự vào đúng cảnh | Tự động: app **chỉ đọc** hàng đợi của HaoHao (`tasks.json`), so nội dung prompt để biết clip của cảnh nào |
| Cần gì | Google Chrome, Node.js 22.18+ (file khởi động tự mở cổng) | Tool HaoHao đã cài và đăng nhập |

Cả hai cách đều: tiến độ từng cảnh trên app, MV đủ clip + có bài hát thì **tự vào hàng chờ dựng** (tắt được), tắt app giữa chừng mở lại vẫn nhận tiếp
(tiến độ lưu ở `data/muse.json`).

### Cổng Muse là gì

Một chương trình nhỏ chạy riêng trên máy (`gateway/`, địa chỉ `http://127.0.0.1:18700`). Nó mở **Google Chrome với profile riêng** (thư mục
`chrome-profile` trong thư mục dữ liệu cổng, vd. `D:\bokin-rockroll-muse-gateway`), gửi prompt vào Muse như người gõ (“Tạo video · tỷ lệ 16:9 ngang” + prompt), chờ Muse làm xong rồi tải video về thư mục `videos/` trong đó.

- **Bấm đúp `Chay-MV-Prompt-Studio`** là mở cả app lẫn cổng; đóng cửa sổ đen là tắt cả hai (Chrome của cổng cũng tự tắt). Chạy riêng cổng: `npm run gateway`.
- **Làm lần lượt từng cảnh** trên một tài khoản Muse, nghỉ khoảng 15 giây giữa hai lần gửi (không gửi dồn). Một cảnh mất khoảng 1–2 phút.
  Thử thật 20/10/2026 (2 cảnh): Muse ra clip **10 giây, 1280×720, 24 hình/giây, H.264, có tiếng** (AAC mono — MV tắt tiếng clip), đúng nội dung prompt.
- **Không tự gửi lại** khi Muse đã nhận lệnh: mất mạng lúc chờ thì cổng dò lại đúng phiên đó (không tốn thêm lượt). Muse không ra video → cảnh báo lỗi kèm
  lời Muse trả lời; bấm **↻ Gửi lại** nếu muốn thử lại (tốn thêm lượt).
- **Hết hạn mức tuần** của Muse → cổng tạm dừng, báo ngày đặt lại, tới ngày tự chạy tiếp.
- **Không có API key**: cổng chỉ nghe trên máy này (`127.0.0.1`), chỉ nhận yêu cầu gửi tới đúng `127.0.0.1:18700` / `localhost:18700`, và **từ chối mọi yêu cầu
  đến từ trang web** (có `Origin` / `Sec-Fetch-Site`) hay POST không phải JSON — trang web lạ mở trong trình duyệt không gọi được cổng.
- Dữ liệu cổng (có phiên đăng nhập Muse) nằm **ngoài thư mục app** (thư mục kế bên, cùng ổ đĩa; đổi được bằng biến `MUSE_GATEWAY_DIR`): lúc build Next.js đọc file trong thư mục app và sẽ vấp vào profile Chrome đang mở. Không bao giờ được commit.
- Lưu ý: cổng điều khiển trang web Muse giống người dùng; Meta đổi trang thì có thể phải sửa cổng. Tự động hoá có thể trái điều khoản của Meta — cổng chỉ dùng
  **một tài khoản**, không proxy, không xoay vòng tài khoản.

API của cổng (cho app khác trên máy): `GET /status` · `POST /login` · `POST /check` · `GET /tasks` · `POST /tasks {prompt, ratio?, kind?, label?, images?: [data URL]}` ·
`GET /tasks/:id` · `POST /tasks/:id/cancel | /retry | /recheck` · `GET /tasks/:id/file?i=0` · `GET /tasks/:id/history` (chẩn đoán) — xem đầu file `gateway/server.ts`.
Hạn mức tuần: cổng đọc % hạn mức từ trang Muse; lần thử thật chưa đọc được (thẻ không hiện %), nên khi hết hạn mức cảnh sẽ báo lỗi thay vì tự tạm dừng.

### Chuẩn bị (một lần)

1. Cài **Google Chrome** (nếu chưa có). Mở app bằng **`Chay-MV-Prompt-Studio`**.
2. Vào **Cài đặt → Tạo clip bằng Muse**: chọn **Cổng Muse (tự động)** (mặc định). Thẻ báo “✓ Cổng Muse đang chạy”.
3. Bấm **Đăng nhập Muse** → cửa sổ Chrome của cổng hiện ra → **bạn tự đăng nhập** Muse (tài khoản Meta). Đăng nhập xong cửa sổ tự cất đi; thẻ báo
   “Đã đăng nhập Muse” và % hạn mức tuần đã dùng. App không bao giờ thấy hay lưu mật khẩu; phiên đăng nhập nằm trong profile Chrome của cổng.
4. Ở thẻ **Công cụ video & storyboard** chọn **Meta Muse** để Claude viết prompt đúng kiểu Muse (clip 10 giây, một đoạn văn liền, không mô tả âm thanh vì MV
   dùng nhạc của bài). Giới hạn ký tự trong hồ sơ này là ước tính — chỉnh ở trang **Thư viện** sau khi thử thật.
5. Tuỳ chọn: **Đủ clip + có bài hát → tự thêm vào hàng chờ dựng và chạy** (bật sẵn), **Ghép negative prompt vào cuối prompt (“Avoid: …”)** (bật sẵn — Muse không
   có ô negative prompt riêng).

### Tạo clip

1. Một MV: trang **🎬 Ghép video với nhạc** → thẻ **Tạo clip bằng Muse** → **🎬 Gửi N cảnh chưa có clip sang Muse**.
   Nhiều MV: menu **Clip Muse** → chọn MV → **🎬 Gửi sang Muse**. App hỏi lại trước khi gửi vì **mỗi cảnh là một lượt Muse** (tính vào hạn mức tuần).
2. Xong. Mỗi cảnh hiện một ô theo tiến độ: **Đang chờ tới lượt** → **Muse đang làm** → **✓ Đã vào MV**. Ô đỏ = lỗi, rê chuột để xem lý do.
3. MV đủ clip cho mọi cảnh và đã có bài hát → app tự thêm vào **Hàng chờ dựng** và dựng (nếu bật). Chưa có bài hát thì tải bài lên lúc nào cũng được.

Chi tiết:

- **Bấm gửi hai lần** không gửi lại cảnh đang làm. Hai cảnh trùng hệt prompt chỉ gửi một lần (dùng chung clip).
- **Không tốn lượt thừa**: cảnh chưa có clip mà **đã có sẵn video cùng prompt** (vd. bạn xoá nhầm clip) → app nhận luôn video đó, không gửi lại.
- **Clip bạn tự thêm** vào một cảnh sau khi gửi thì được giữ nguyên, app không đè bằng clip Muse.
- **Muse làm xong mà đưa clip vào MV bị lỗi**: bấm **↻ Nhận lại N clip (không tốn lượt)** — app chỉ lấy lại file, không gửi lại cho Muse.
  Lỗi “file đang bận” thoáng qua trên Windows thì app tự thử lại.
- **Cảnh báo lỗi mà có thể Muse đã làm xong** (vd. Muse trả lời “Muốn mình làm thêm bản biến tấu khác…”): bấm **↻ Kiểm tra lại N cảnh (không tốn lượt)** —
  cổng đọc lại đúng cuộc chat cũ và tải video nếu có, không gửi lại. Cổng cũng tự tìm video Muse ghi trong câu trả lời khi không có “thẻ video” riêng
  (gặp khi thử thật). Chỉ khi kiểm tra lại vẫn lỗi mới cần **↻ Gửi lại** (tốn thêm lượt).
- Đổi cách gửi giữa chừng: cảnh gửi bằng cách cũ được giữ nguyên kèm lời nhắc; cảnh còn chờ dán vào HaoHao thì gửi lại qua Cổng Muse được.
- Video gốc vẫn nằm trong thư mục `videos/` của cổng (hoặc thư mục lưu của HaoHao); app chép một bản vào `data/media/<mã MV>/`.

### Cách dán tay vào HaoHao (dự phòng)

Chọn **HaoHao (dán tay)** trong Cài đặt. Đăng nhập Muse trong HaoHao, và nên đổi **Thư mục lưu** của HaoHao sang ổ còn nhiều chỗ (mặc định là
`Videos\MuseStudioPro` trên ổ C). Thư mục dữ liệu HaoHao để trống là app tự tìm (Windows: `%APPDATA%\HaoHao`, macOS: `~/Library/Application Support/HaoHao`).
Bấm **🎬 Tạo N cảnh chưa có clip** → app copy sẵn các prompt (cách nhau một dòng trống) → mở **HaoHao → tab Studio** → chọn **Video**, tỉ lệ **16:9** → **dán** → tạo.
Cảnh lỗi: bấm **Thử lại** ngay trong HaoHao (app tự theo) hoặc **↻ Gửi lại** trong app rồi dán lại. Lỡ mất chữ đã copy: **📋 Copy lại N prompt chờ dán**.
App không sửa gì bên HaoHao. HaoHao để tỉ lệ khác 16:9 thì cảnh có ghi chú nhắc; MV vẫn dựng được.

## 3. Logic sinh MV

1. **Character Bible** — Claude tạo cặp đôi HE/SHE (hoặc dùng **cặp đôi cố định cho cả series** nếu bật trong Cài đặt).
   Claude viết prompt với placeholder `{{HE}}`, `{{SHE}}`; công cụ thay bằng mô tả nguyên văn, nên nhân vật luôn đồng nhất.
2. **Cấu trúc bài hát → danh sách cảnh** (thuần code, `src/lib/structure.ts`): số cảnh = `ceil(thời lượng / độ dài clip)`, rồi giới hạn trong khoảng
   **tối thiểu – tối đa** của Cài đặt (mặc định **15–20 cảnh = 15–20 prompt mỗi MV**). Khi bật **“Cảnh sẽ được lặp lại khi dựng”**, Claude viết mỗi cảnh
   thành một clip độc lập, dùng lại được, và ghi chú dựng có mục **“Lặp cảnh”** gợi ý dùng lại cảnh nào ở đoạn nào. Các đoạn chia theo tỉ lệ
   Intro 8% · Verse 1 17% · Pre-chorus 8% · Chorus 1 15% · Verse 2 15% · Chorus 2 12% · Bridge 10% · Final chorus 10% · Outro 5%.
   Nhịp `fast` → chorus dùng clip ngắn hơn (nhiều cảnh hơn). Mỗi chorus được gán ít nhất một cảnh nhảy/chuyển động mạnh,
   `signature_shots` của chủ đề được gán ≥ 2 lần, cỡ cảnh luân phiên, lời bài hát (nếu có) được khớp vào từng cảnh.
3. **Prompt từng cảnh** — một lời gọi Claude với *structured output* (JSON schema), theo công thức
   `[Cỡ cảnh] + [Chủ thể] + [Hành động] + [Bối cảnh đúng niên đại] + [Ánh sáng] + [Máy quay] + [Cảm xúc] + [STYLE]`.
   Nếu JSON lỗi / thiếu cảnh, công cụ tự **retry một lần**. Prompt dài quá giới hạn của công cụ video được Claude **rút gọn**, sau đó cắt tự động nếu vẫn dài.
4. **Tài nguyên bổ sung** — thumbnail 16:9, 3 tiêu đề, mô tả YouTube, ghi chú dựng phim, mạch truyện.

Sau khi sinh: **era check** (`src/lib/eraCheck.ts`) theo `data/era_rules.json` và quy tắc riêng của địa điểm, kiểm tra độ dài, style, tiếng Việt lẫn trong prompt,
chữ trên màn hình, thương hiệu/người thật, và so sánh với các MV khác **cùng series** để cảnh báo cảnh trùng lặp.

## 4. Thư viện cấu hình (`data/`)

Sửa trên giao diện (trang **Thư viện**) hoặc sửa trực tiếp file JSON:

| File | Nội dung |
|---|---|
| `themes.json` | 12 mã chủ đề T01–T12 (mood, nhịp dựng, signature shots). Các mã có `needs_review: true` là **tên gợi ý** — hãy sửa cho đúng. |
| `locations.json` | 24 địa điểm California – Las Vegas – Route 66 – New York (landmark, xe, trang phục, đạo cụ, ánh sáng, thứ **không được xuất hiện**). Địa điểm chưa có sẽ được Claude tự suy luận và lưu với `auto_generated: true` để bạn duyệt. |
| `era_rules.json` | Quy tắc theo từng năm 1950–1959, vật dụng theo năm ra đời (hula hoop 1958, Thunderbird 1955…), đồ hiện đại bị cấm, thương hiệu/người thật. |
| `style_presets.json` | Kodachrome 35mm (mặc định), Technicolor musical, Black & white noir, Faded home-movie 8mm. |
| `pricing.json` | Giá Claude API (USD / 1 triệu token) theo model và tỷ giá đ/USD — dùng để quy đổi chi phí. |
| `video_models.json` | Veo, Kling, Hailuo, Sora, Runway, Meta Muse: giới hạn ký tự, độ dài clip, có âm thanh hay không, cách viết prompt. |
| `settings.json` | Cài đặt (model, công cụ video, độ dài clip, số cảnh tối thiểu–tối đa, lặp cảnh, cặp đôi cố định, số luồng song song…). |
| `couples.json` | Cặp đôi cố định đã lưu cho từng series. |

Dữ liệu sinh ra khi chạy (không commit): `data/history/` (lịch sử MV, mỗi MV một file JSON), `data/drafts/` (MV đang chờ câu trả lời từ claude.ai), `data/uploads/` (ảnh tham chiếu nhân vật)
và `data/media/` (nhạc, clip và video đã dựng của từng MV — xoá MV trong Lịch sử thì thư mục này của MV cũng bị xoá;
`data/media/_shared/` là thiết lập dựng chung, logo và font), `data/render_queue.json` (hàng chờ dựng), `data/muse.json` (các cảnh đang tạo clip bằng Muse).

## 5. Cài đặt đáng chú ý

- **Model**: mặc định `claude-sonnet-5-5`; đổi được trong trang Cài đặt. **Effort** `medium` là cân bằng tốt giữa chất lượng và tốc độ.
- **Fallback khi bị từ chối**: bật sẵn (server-side fallback của Claude API).
- **Số MV chạy song song**: mặc định 2 — giảm xuống nếu gặp lỗi *rate limit*.
- **Cặp đôi cố định cho cả series**: bật lên thì 50 MV cùng series dùng chung một cặp đôi.
- **Cách tạo nội dung**: Tự động / claude.ai (copy – dán) / Claude API / Demo.
- **Số cảnh mỗi MV**: mặc định 15–20 (= 15–20 prompt); bật “Cảnh sẽ được lặp lại khi dựng” để mỗi cảnh độc lập, dùng lại được.

## 6. Tính năng khác

- **Sinh lại toàn MV với giọng khác** (vui tươi hơn, buồn hơn, điện ảnh hơn) — tạo phiên bản mới, bản cũ vẫn giữ trong Lịch sử.
- **Sửa Character Bible** trên trang kết quả → tự ghép lại toàn bộ prompt (trừ cảnh đã sửa tay); có thể lưu làm cặp đôi cố định của series.
- **Đổi style preset** cho cả MV.
- **Ảnh tham chiếu nhân vật** (cho image-to-video): upload trên trang kết quả, đường dẫn được ghi vào Character Bible và file xuất.
- **Lịch sử**: tìm theo tên bài, địa điểm, series, chủ đề; chọn nhiều MV để xuất; **XLSX cả series**; nhập lại file JSON.

## 7. Dành cho người phát triển

```bash
npm test          # unit test (cấu trúc bài hát, parser, era check, ghép prompt, pipeline, chế độ claude.ai, chi phí, gọi Claude giả lập,
                  #   nhận nhịp, kế hoạch cắt cảnh, cân bằng âm lượng / preset YouTube / logo / intro, hàng chờ dựng,
                  #   dựng MP4 thật bằng ffmpeg từ clip + nhạc tự tạo, tạo clip bằng Muse với một "HaoHao giả" — không tốn lượt Muse)
npm run typecheck
```

Cấu trúc mã nguồn:

```
data/                   thư viện cấu hình (JSON)
src/lib/
  structure.ts          chia cấu trúc bài hát → danh sách cảnh (thuần code)
  parser.ts             đọc bảng dán / CSV / ma trận XLSX
  llm.ts                gọi Claude (structured output, retry)
  prompts.ts            system prompt + user prompt
  llmSchemas.ts         JSON schema của kết quả
  generate.ts           pipeline sinh MV, sinh lại cảnh, sửa tay, bản nháp claude.ai
  manual.ts             chế độ claude.ai: yêu cầu để copy, đọc JSON dán về
  cost.ts               quy đổi token → $ / đ, ước tính chi phí
  apikey.ts             lưu API key vào .env.local
  assemble.ts           ghép prompt: Character Bible nguyên văn + style
  eraCheck.ts           kiểm tra niên đại, thương hiệu, chữ trên màn hình
  validate.ts           kiểm tra độ dài, nhịp dựng, signature shots…
  duplicates.ts         cảnh báo trùng lặp trong series
  exporters.ts, xlsx.ts xuất CSV / MD / TXT / JSON / XLSX
  mock.ts               chế độ demo
  store.ts              đọc/ghi data/
  edit.ts               kế hoạch dựng: rải cảnh lên bài hát, lặp cảnh, cắt theo phách (thuần code, dùng cả trên trình duyệt)
  beats.ts              ước tính BPM và vị trí phách từ âm thanh
  clipNames.ts          đoán clip thuộc cảnh nào theo tên file
  media.ts              lưu nhạc / clip của từng MV (data/media/)
  ffmpeg.ts, render.ts  gọi ffmpeg, dựng MP4 chạy nền (tiến độ, huỷ, kiểm tra đầu ra)
  queue.ts              hàng chờ dựng: dựng lần lượt nhiều MV với thiết lập chung (data/media/_shared)
  muse.ts               tạo clip bằng Muse — phần thuần: chữ gửi Muse, khớp task với cảnh, trạng thái từng cảnh
  museGateway.ts        gọi Cổng Muse (gửi cảnh, đăng nhập, xem task, tải file)
  haohao.ts             đọc (chỉ đọc) hàng đợi tasks.json và thư mục lưu của tool HaoHao (cách dán tay)
  museJobs.ts           theo dõi các cảnh (data/muse.json), dò chạy nền, đưa clip vào đúng cảnh, tự thêm vào hàng chờ dựng
  loudness.ts           cân bằng âm lượng (chuyển từ loop_music/loudness.py của Bokin Studio Music)
  quality.ts            preset YouTube (chuyển từ loop_music/quality.py)
  branding.ts, fonts.ts logo kênh, intro tiêu đề, thông tin MP4 (chuyển từ loop_music/branding.py, mp4meta.py)
src/app/                các trang: Nhập ý tưởng, Chạy batch, claude.ai (/manual), Kết quả (/mv/[id]), Ghép video (/mv/[id]/video), Clip Muse (/muse),
                        Hàng chờ dựng (/render-queue), Lịch sử, Thư viện, Cài đặt; API trong src/app/api/
gateway/                Cổng Muse — server riêng 127.0.0.1:18700 (Node chạy thẳng TypeScript, không cần build):
  server.ts             HTTP + chặn yêu cầu từ trang web, chạy: node gateway/server.ts
  runner.ts             gửi lệnh / dò / tải file, Worker chạy lần lượt trên một tài khoản (đăng nhập, hạn mức, không gửi lại khi lỗi mạng)
  musePage.ts           script chạy trong trang muse.ai + lớp gọi nó qua Chrome
  chrome.ts             mở Chrome với profile riêng, điều khiển qua CDP bằng pipe
  tasks.ts              hàng đợi task (tasks.json trong thư mục dữ liệu cổng)
scripts/start.mjs       khởi động một lệnh (dùng bởi Chay-MV-Prompt-Studio.bat / .command): mở Cổng Muse + app
tests/                  vitest (fakeMuse.ts = "Muse giả" cho test cổng)
```
