# MV Prompt Studio 🎙️

Công cụ tạo **bộ prompt video hoàn chỉnh** cho MV phong cách 1950s American (Doo-Wop, Rock & Roll, Rockabilly).
Bạn chỉ nhập **ý tưởng** của từng bài (1 dòng), công cụ tự sinh:

- **Character Bible**: mô tả cố định của cặp đôi, được chèn **nguyên văn** vào mọi prompt để nhân vật nhất quán giữa các clip.
- **Storyboard** chia theo cấu trúc bài hát (Intro → Verse → Pre-chorus → Chorus → … → Outro), mỗi cảnh có thời gian, mô tả tiếng Việt và **prompt tiếng Anh** đã gắn style preset ở cuối.
- **Thumbnail prompt**, 3 gợi ý **tiêu đề YouTube**, **mô tả** theo giọng văn kênh và **ghi chú dựng phim**.
- **Kiểm tra niên đại** (xe đời sau, điện thoại, LED, vòng đu quay trên Santa Monica Pier…), độ dài prompt, chữ trên màn hình, thương hiệu/người thật, nhịp dựng và **trùng lặp trong series**.

Chạy được **hàng loạt** (ví dụ 50 bài một lần) và xuất **XLSX (mỗi MV một sheet)**, CSV, Markdown, TXT, JSON, “Copy tất cả prompt” hoặc **File prompt (.txt)** — chỉ gồm các prompt, mỗi prompt cách nhau một dòng trống.

---

## 1. Cài đặt

Yêu cầu: **Node.js 20.9 trở lên** (khuyên dùng Node 22 LTS) — tải tại <https://nodejs.org>.

```bash
git clone <địa chỉ repo này>
cd bokin-rockroll
npm install
```

### API key của Claude

1. Lấy API key tại <https://platform.claude.com/settings/keys>.
2. Sao chép file mẫu và điền key:

   ```bash
   cp .env.example .env
   ```

   Mở `.env` và sửa dòng: `ANTHROPIC_API_KEY=sk-ant-...`

> Không có API key? Công cụ vẫn chạy ở **chế độ demo**: storyboard được ghép từ mẫu có sẵn trong thư viện (không dùng AI) — tiện để thử giao diện, quy trình batch và xuất file.

## 2. Chạy

```bash
npm run dev
```

Mở trình duyệt tại <http://localhost:3000>.

Chạy bản tối ưu (nhanh hơn):

```bash
npm run build
npm start
```

## 3. Cách dùng nhanh

1. **Nhập ý tưởng** → tab **Dán bảng** → bấm **“Dùng 5 dòng ví dụ”** (hoặc dán bảng của bạn từ Google Docs/Sheets) → **Đọc bảng & xem trước**.
   Bảng xem trước cho biết năm, địa điểm đã khớp thư viện hay sẽ tự suy luận, chủ đề có trong thư viện chưa.
2. Bấm **Chạy batch** → trang **Chạy batch** hiện thanh tiến trình. Có thể **Tạm dừng**, **Dừng ngay**, **Chạy tiếp**, **Thử lại mục lỗi**.
   Batch vẫn chạy khi bạn chuyển sang xem trang khác; nếu tải lại trang, bấm “Chạy tiếp”.
3. Bấm **Mở storyboard** để xem từng MV: mỗi cảnh có nút **Copy prompt**, **Sinh lại cảnh này** (kèm yêu cầu, vd. “góc máy khác”) và **Sửa tay**.
4. Xuất file: **XLSX** (sheet “Tổng quan” + mỗi MV một sheet), **CSV** (có cột `mv_id`), **MD/TXT** (đọc nhanh), **JSON** (nhập lại được ở trang Lịch sử), **Copy tất cả prompt** (mỗi prompt một dòng), hoặc **File prompt (.txt)**: chỉ gồm các prompt, mỗi prompt cách nhau một dòng trống — tiện nhập hàng loạt vào công cụ tạo video. Có ở trang batch, trang kết quả và Lịch sử (cả theo series).

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

## 4. Logic sinh MV

1. **Character Bible** — Claude tạo cặp đôi HE/SHE (hoặc dùng **cặp đôi cố định cho cả series** nếu bật trong Cài đặt).
   Claude viết prompt với placeholder `{{HE}}`, `{{SHE}}`; công cụ thay bằng mô tả nguyên văn, nên nhân vật luôn đồng nhất.
2. **Cấu trúc bài hát → danh sách cảnh** (thuần code, `src/lib/structure.ts`): số cảnh = `ceil(thời lượng / độ dài clip)`, chia theo tỉ lệ
   Intro 8% · Verse 1 17% · Pre-chorus 8% · Chorus 1 15% · Verse 2 15% · Chorus 2 12% · Bridge 10% · Final chorus 10% · Outro 5%.
   Nhịp `fast` → chorus dùng clip ngắn hơn (nhiều cảnh hơn). Mỗi chorus được gán ít nhất một cảnh nhảy/chuyển động mạnh,
   `signature_shots` của chủ đề được gán ≥ 2 lần, cỡ cảnh luân phiên, lời bài hát (nếu có) được khớp vào từng cảnh.
3. **Prompt từng cảnh** — một lời gọi Claude với *structured output* (JSON schema), theo công thức
   `[Cỡ cảnh] + [Chủ thể] + [Hành động] + [Bối cảnh đúng niên đại] + [Ánh sáng] + [Máy quay] + [Cảm xúc] + [STYLE]`.
   Nếu JSON lỗi / thiếu cảnh, công cụ tự **retry một lần**. Prompt dài quá giới hạn của công cụ video được Claude **rút gọn**, sau đó cắt tự động nếu vẫn dài.
4. **Tài nguyên bổ sung** — thumbnail 16:9, 3 tiêu đề, mô tả YouTube, ghi chú dựng phim, mạch truyện.

Sau khi sinh: **era check** (`src/lib/eraCheck.ts`) theo `data/era_rules.json` và quy tắc riêng của địa điểm, kiểm tra độ dài, style, tiếng Việt lẫn trong prompt,
chữ trên màn hình, thương hiệu/người thật, và so sánh với các MV khác **cùng series** để cảnh báo cảnh trùng lặp.

## 5. Thư viện cấu hình (`data/`)

Sửa trên giao diện (trang **Thư viện**) hoặc sửa trực tiếp file JSON:

| File | Nội dung |
|---|---|
| `themes.json` | 12 mã chủ đề T01–T12 (mood, nhịp dựng, signature shots). Các mã có `needs_review: true` là **tên gợi ý** — hãy sửa cho đúng. |
| `locations.json` | 24 địa điểm California – Las Vegas – Route 66 – New York (landmark, xe, trang phục, đạo cụ, ánh sáng, thứ **không được xuất hiện**). Địa điểm chưa có sẽ được Claude tự suy luận và lưu với `auto_generated: true` để bạn duyệt. |
| `era_rules.json` | Quy tắc theo từng năm 1950–1959, vật dụng theo năm ra đời (hula hoop 1958, Thunderbird 1955…), đồ hiện đại bị cấm, thương hiệu/người thật. |
| `style_presets.json` | Kodachrome 35mm (mặc định), Technicolor musical, Black & white noir, Faded home-movie 8mm. |
| `video_models.json` | Veo, Kling, Hailuo, Sora, Runway: giới hạn ký tự, độ dài clip, có âm thanh hay không, cách viết prompt. |
| `settings.json` | Cài đặt (model, công cụ video, độ dài clip, số cảnh tối đa, cặp đôi cố định, số luồng song song…). |
| `couples.json` | Cặp đôi cố định đã lưu cho từng series. |

Dữ liệu sinh ra khi chạy (không commit): `data/history/` (lịch sử MV, mỗi MV một file JSON) và `data/uploads/` (ảnh tham chiếu nhân vật).

## 6. Cài đặt đáng chú ý

- **Model**: mặc định `claude-sonnet-5-5`; đổi được trong trang Cài đặt. **Effort** `medium` là cân bằng tốt giữa chất lượng và tốc độ.
- **Fallback khi bị từ chối**: bật sẵn (server-side fallback của Claude API).
- **Số MV chạy song song**: mặc định 2 — giảm xuống nếu gặp lỗi *rate limit*.
- **Cặp đôi cố định cho cả series**: bật lên thì 50 MV cùng series dùng chung một cặp đôi.
- **Chế độ demo**: bật để thử mà không tốn API.

## 7. Tính năng khác

- **Sinh lại toàn MV với giọng khác** (vui tươi hơn, buồn hơn, điện ảnh hơn) — tạo phiên bản mới, bản cũ vẫn giữ trong Lịch sử.
- **Sửa Character Bible** trên trang kết quả → tự ghép lại toàn bộ prompt (trừ cảnh đã sửa tay); có thể lưu làm cặp đôi cố định của series.
- **Đổi style preset** cho cả MV.
- **Ảnh tham chiếu nhân vật** (cho image-to-video): upload trên trang kết quả, đường dẫn được ghi vào Character Bible và file xuất.
- **Lịch sử**: tìm theo tên bài, địa điểm, series, chủ đề; chọn nhiều MV để xuất; **XLSX cả series**; nhập lại file JSON.

## 8. Dành cho người phát triển

```bash
npm test          # unit test (cấu trúc bài hát, parser, era check, ghép prompt, pipeline, gọi Claude giả lập)
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
  generate.ts           pipeline sinh MV, sinh lại cảnh, sửa tay
  assemble.ts           ghép prompt: Character Bible nguyên văn + style
  eraCheck.ts           kiểm tra niên đại, thương hiệu, chữ trên màn hình
  validate.ts           kiểm tra độ dài, nhịp dựng, signature shots…
  duplicates.ts         cảnh báo trùng lặp trong series
  exporters.ts, xlsx.ts xuất CSV / MD / TXT / JSON / XLSX
  mock.ts               chế độ demo
  store.ts              đọc/ghi data/
src/app/                các trang: Nhập ý tưởng, Chạy batch, Kết quả (/mv/[id]), Lịch sử, Thư viện, Cài đặt; API trong src/app/api/
tests/                  vitest
```
