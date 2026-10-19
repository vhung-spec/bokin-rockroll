// Chế độ demo: sinh storyboard mẫu từ thư viện bằng template (không gọi API).
// Dùng khi chưa có ANTHROPIC_API_KEY hoặc bật "Chế độ demo" trong Cài đặt.

import { placeholdersIn } from "./assemble";
import type { RawGeneration, RawLocation, RawShot } from "./llmSchemas";
import type { GenContext } from "./prompts";
import type { Character, EraYear, PlannedShot, ShotClass, StructurePlan, Tone } from "./types";

// ---------- RNG có seed (kết quả lặp lại được) ----------

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Cặp đôi mẫu ----------

const COUPLES: Character[][] = [
  [
    { id: "HE", role: "male lead", description: "an early-20s man with a glossy black pompadour, warm brown eyes and a strong jaw, wearing a white T-shirt under a red varsity jacket, cuffed blue jeans and black loafers, a silver ID bracelet" },
    { id: "SHE", role: "female lead", description: "an early-20s woman with platinum-blonde victory-roll curls and red lipstick, wearing a mint-green halter sundress with white polka dots and white cat-eye sunglasses pushed up on her head" },
  ],
  [
    { id: "HE", role: "male lead", description: "a 22-year-old man with a sandy-brown ducktail haircut, freckles and an easy grin, wearing a black leather jacket over a white T-shirt, rolled dark jeans and engineer boots, a red bandana in his pocket" },
    { id: "SHE", role: "female lead", description: "a 20-year-old woman with a glossy auburn ponytail tied with a yellow chiffon scarf, bright green eyes, wearing a pink poodle skirt, a white cropped cardigan and saddle shoes, a charm bracelet" },
  ],
  [
    { id: "HE", role: "male lead", description: "a mid-20s man with slicked-back dark hair, a thin mustache and kind hazel eyes, wearing a cream two-tone bowling shirt, high-waisted grey slacks and two-tone shoes, a gold wristwatch" },
    { id: "SHE", role: "female lead", description: "a 21-year-old woman with short raven-black curls, rosy cheeks and a beauty mark, wearing a cherry-red swing dress with a white Peter Pan collar, white gloves and pearl earrings" },
  ],
];

export function mockCouple(seedText: string): Character[] {
  const pick = COUPLES[hashSeed(seedText) % COUPLES.length];
  return pick.map((c) => ({ ...c }));
}

// ---------- Template cảnh ----------

interface Pools {
  landmark: (i: number) => string;
  vehicle: (i: number) => string;
  prop: (i: number) => string;
  light: string;
  dance: string;
  year: number;
  place: string;
}

interface Template {
  core: (p: Pools) => string;
  vi: string;
  camera: string;
  motion?: boolean;
  sizes?: ShotClass[];
}

const T: Record<string, Template[]> = {
  intro: [
    { core: (p) => `of ${p.landmark(0)} in ${p.year}, crowds in period clothes strolling past, a ${p.vehicle(0)} gliding by, ${p.light}, slow crane shot descending to street level, nostalgic anticipation`, vi: "Toàn cảnh bối cảnh đúng năm, đám đông và xe cổ qua lại.", camera: "slow crane down", sizes: ["wide"] },
    { core: (p) => `of ${p.landmark(1)} as the day unfolds, a ${p.vehicle(1)} parked at the curb, ${p.prop(0)} in the foreground, ${p.light}, gentle push-in, warm and inviting`, vi: "Chi tiết landmark tiêu biểu, xe cổ đỗ bên đường.", camera: "slow push-in", sizes: ["medium", "close"] },
    { core: (p) => `of ${p.landmark(2)} seen through passing traffic, a ${p.vehicle(2)} rolling through frame, ${p.light}, smooth lateral dolly, a promise of romance`, vi: "Bối cảnh nhìn qua dòng xe cổ, máy lia ngang.", camera: "lateral dolly", sizes: ["wide", "medium"] },
    { core: (p) => `of ${p.prop(1)} in sharp focus with ${p.landmark(0)} softly blurred behind, ${p.light}, slow rack focus to the street, quiet expectation`, vi: "Cận cảnh một món đồ thời 50s, hậu cảnh là con phố mờ dần.", camera: "rack focus", sizes: ["close"] },
  ],
  verse1: [
    { core: (p) => `{{HE}} strolls along ${p.landmark(0)}, hands in his pockets, whistling and passing ${p.prop(0)}, ${p.light}, steady tracking shot alongside him, carefree`, vi: "Chàng trai thong thả dạo bước, tay đút túi, huýt sáo.", camera: "tracking shot", sizes: ["wide", "medium"] },
    { core: (p) => `{{SHE}} steps out into the light at ${p.landmark(1)}, lowering her sunglasses and looking around as people flow past her, slow dolly in, poised and curious`, vi: "Cô gái bước ra, khẽ hạ kính râm nhìn quanh giữa dòng người.", camera: "slow dolly in", sizes: ["wide", "medium"] },
    { core: (p) => `{{HE}} leans against a ${p.vehicle(0)}, flipping a coin and joking with friends, ${p.landmark(2)} behind him, ${p.light}, slow pan, relaxed charm`, vi: "Chàng trai tựa vào chiếc xe cổ, tung đồng xu đùa với bạn bè.", camera: "slow pan", sizes: ["medium", "wide"] },
    { core: (p) => `{{SHE}} browses ${p.prop(1)} with a girlfriend, laughing softly, ${p.landmark(0)} in the background, handheld follow, light-hearted`, vi: "Cô gái cùng bạn gái xem đồ, cười khẽ.", camera: "handheld follow", sizes: ["medium", "wide"] },
    { core: (p) => `{{HE}} combing his hair in the reflection of a shop window, a confident half-smile, ${p.light}, slow push-in, youthful swagger`, vi: "Chàng trai chải tóc trước tấm kính cửa hiệu, cười tự tin.", camera: "slow push-in", sizes: ["close"] },
    { core: (p) => `{{SHE}} humming along to a song from a nearby radio, eyes half closed, ${p.light} on her face, gentle drift, dreamy daydream`, vi: "Cô gái khẽ ngân nga theo bài hát từ chiếc radio gần đó.", camera: "gentle drift", sizes: ["close"] },
  ],
  pre: [
    { core: () => `{{HE}}, his eyes widening as he notices her across the crowd, slow motion, background blurring into soft bokeh, slow push-in, breathless`, vi: "Ánh mắt chàng trai mở to khi nhìn thấy cô giữa đám đông.", camera: "slow push-in", sizes: ["close"] },
    { core: () => `{{SHE}} glances back over her shoulder and their eyes meet, a shy smile forming, slow motion, rack focus, time seeming to stop`, vi: "Cô gái ngoái lại, ánh mắt hai người chạm nhau, nụ cười e thẹn.", camera: "rack focus", sizes: ["close", "medium"] },
    { core: (p) => `{{HE}} and {{SHE}} reach for the same ${p.prop(0).replace(/^(the|a|an) /i, "")} at the same moment, fingertips touching, both freezing in surprise, slow push-in, electric`, vi: "Hai bàn tay cùng chạm vào một món đồ, cả hai khựng lại.", camera: "slow push-in", sizes: ["medium", "close"] },
    { core: (p) => `{{HE}} and {{SHE}} on opposite sides of ${p.landmark(0)}, a ${p.vehicle(0)} passing between them, both turning at the same moment, whip pan between their faces, sudden spark`, vi: "Hai người ở hai bên đường, cùng quay lại nhìn nhau khi xe chạy qua.", camera: "whip pan", sizes: ["wide", "medium"] },
  ],
  chorusMotion: [
    { core: (p) => `{{HE}} and {{SHE}} dance a swinging ${p.dance} in the middle of ${p.landmark(0)}, her skirt flaring as he spins her, onlookers clapping, ${p.light}, slow 360-degree orbit, joyful`, vi: "Hai người nhảy giữa phố, váy cô xoè rộng khi anh xoay cô, mọi người vỗ tay.", camera: "slow 360° orbit", motion: true, sizes: ["wide", "medium"] },
    { core: (p) => `{{HE}} twirls {{SHE}} under his arm beside ${p.landmark(1)}, both laughing as a ${p.vehicle(0)} passes behind them, handheld follow, exhilarated`, vi: "Chàng trai xoay cô gái dưới cánh tay, cả hai cười vang.", camera: "handheld follow", motion: true, sizes: ["medium", "wide"] },
    { core: (p) => `{{HE}} and {{SHE}} run hand in hand along ${p.landmark(2)}, her hair streaming behind her, low tracking shot racing beside them, carefree joy`, vi: "Hai người nắm tay chạy dọc phố, mái tóc cô bay theo gió.", camera: "low tracking shot", motion: true, sizes: ["wide", "medium"] },
    { core: (p) => `{{HE}} and {{SHE}} bop to the music beside ${p.prop(1)}, shoulders bouncing and fingers snapping, quick push-in on the beat, playful energy`, vi: "Hai người lắc lư theo nhạc, búng tay theo nhịp.", camera: "quick push-in on the beat", motion: true, sizes: ["medium"] },
    { core: (p) => `{{HE}} slides across the floor on his knees toward {{SHE}}, who claps and laughs, ${p.light}, low-angle dolly, cheeky showmanship`, vi: "Chàng trai trượt quỳ gối trên sàn về phía cô gái, cô vỗ tay cười.", camera: "low-angle dolly", motion: true, sizes: ["medium", "wide"] },
    { core: (p) => `{{SHE}} spins in place so her skirt flares into a perfect circle, ${p.landmark(0)} whirling behind her, overhead camera turning with her, pure delight`, vi: "Cô gái xoay tròn, váy xoè thành vòng tròn hoàn hảo.", camera: "overhead spin", motion: true, sizes: ["medium", "wide"] },
    { core: (p) => `a crowd of young dancers joins {{HE}} and {{SHE}} in a synchronized routine of claps, kicks and spins near ${p.landmark(1)}, ${p.light}, crane sweeping over the dancers, infectious energy`, vi: "Đám đông nhập cuộc nhảy cùng hai người, vỗ tay và đá chân đồng loạt.", camera: "crane sweep", motion: true, sizes: ["wide"] },
  ],
  chorus: [
    { core: () => `{{HE}} and {{SHE}} face each other on the sidewalk as the crowd around them fades into soft blur and freezes, only they move, slow orbit, time stops`, vi: "Hai người đối diện nhau, đám đông xung quanh nhoè đi và đứng yên.", camera: "slow orbit", sizes: ["medium", "wide"] },
    { core: (p) => `{{SHE}} laughs with her head tilted back, ${p.light} flaring through her hair, slow motion, gentle drift, pure happiness`, vi: "Cô gái ngửa đầu cười, ánh sáng loé qua mái tóc.", camera: "gentle drift", sizes: ["close"] },
    { core: () => `{{HE}} grins and offers her his arm with a little bow, lens flare across the frame, slow push-in, confident romance`, vi: "Chàng trai cười, khẽ cúi chào và đưa tay mời cô.", camera: "slow push-in", sizes: ["close", "medium"] },
    { core: (p) => `{{HE}} and {{SHE}} press their foreheads together, eyes closed, ${p.landmark(1)} glowing out of focus behind, slow push-in, overwhelming tenderness`, vi: "Hai người tựa trán vào nhau, mắt nhắm, hậu cảnh lung linh.", camera: "slow push-in", sizes: ["close"] },
    { core: (p) => `{{SHE}} tucks a flower into his jacket pocket while {{HE}} watches her, smitten, ${p.light}, handheld close, sweet devotion`, vi: "Cô gái cài bông hoa lên túi áo chàng trai, anh say mê nhìn cô.", camera: "handheld close", sizes: ["close", "medium"] },
  ],
  verse2: [
    { core: (p) => `{{HE}} and {{SHE}} share a milkshake with two straws in a red vinyl booth, leaning a little closer, ${p.light}, slow dolly in, sweet nervousness`, vi: "Hai người chung một ly milkshake hai ống hút, ngồi sát lại gần.", camera: "slow dolly in", sizes: ["medium", "close"] },
    { core: (p) => `{{HE}} opens the door of a ${p.vehicle(1)} for {{SHE}}, she slides in smiling, ${p.landmark(1)} glowing behind them, tracking shot, gentlemanly charm`, vi: "Chàng trai mở cửa xe cho cô gái, cô mỉm cười bước vào.", camera: "tracking shot", sizes: ["medium", "wide"] },
    { core: (p) => `{{HE}} and {{SHE}} walk past ${p.landmark(2)} sharing a paper bag of popcorn, bumping shoulders, steadicam follow, growing closeness`, vi: "Hai người dạo bước chung túi bỏng ngô, vai chạm vai.", camera: "steadicam follow", sizes: ["wide", "medium"] },
    { core: (p) => `{{SHE}} straightens his collar while {{HE}} pretends to protest, ${p.prop(2)} nearby, ${p.light}, slow rack focus, playful tenderness`, vi: "Cô gái chỉnh cổ áo cho chàng trai, anh giả vờ phản đối.", camera: "rack focus", sizes: ["close", "medium"] },
    { core: (p) => `{{HE}} and {{SHE}} cruise past ${p.landmark(0)} in a ${p.vehicle(0)}, her scarf fluttering in the wind, ${p.light}, tracking shot from a parallel car, freedom`, vi: "Hai người lái xe mui trần dạo phố, khăn của cô bay trong gió.", camera: "parallel tracking shot", sizes: ["wide", "medium"] },
    { core: () => `{{SHE}} whispers something in his ear and {{HE}} bursts out laughing, slow motion, shallow focus, easy intimacy`, vi: "Cô gái thì thầm vào tai, chàng trai bật cười.", camera: "static close", sizes: ["close"] },
  ],
  bridge: [
    { core: (p) => `{{HE}} and {{SHE}} sit side by side on a bench at dusk, heads close together, ${p.landmark(0)} lighting up behind them, slow push-in, quiet intimacy`, vi: "Hai người ngồi cạnh nhau trên ghế đá lúc chạng vạng.", camera: "slow push-in", sizes: ["wide", "medium"] },
    { core: () => `{{SHE}} waits alone by a rain-streaked window, holding a single flower, soft reflections on the glass, slow dolly back, wistful pause`, vi: "Cô gái một mình bên cửa sổ mưa, tay cầm một bông hoa.", camera: "slow dolly back", sizes: ["medium", "close"] },
    { core: () => `{{HE}} hesitates under a streetlamp, turning a small keepsake in his fingers, gentle handheld, a moment of doubt`, vi: "Chàng trai ngập ngừng dưới đèn đường, mân mê một kỷ vật nhỏ.", camera: "gentle handheld", sizes: ["medium", "close", "wide"] },
  ],
  finalMotion: [
    { core: (p) => `{{HE}} and {{SHE}} lead a crowd of dancers in a joyful rock and roll routine in front of ${p.landmark(0)}, everyone spinning in sync, ${p.light}, sweeping crane up, euphoric climax`, vi: "Hai người dẫn đầu cả đám đông cùng nhảy rock & roll.", camera: "sweeping crane up", motion: true, sizes: ["wide"] },
    { core: (p) => `{{HE}} lifts {{SHE}} and swings her around in a full circle, her skirt and hair flying, ${p.landmark(1)} glowing behind, fast orbit, triumphant joy`, vi: "Chàng trai bế bổng cô gái xoay một vòng, váy và tóc bay tung.", camera: "fast orbit", motion: true, sizes: ["medium", "wide"] },
    { core: (p) => `{{HE}} dips {{SHE}} low at the end of a fast spin as confetti bursts around them near ${p.landmark(2)}, whip pan into slow motion, show-stopping finale`, vi: "Chàng trai ngả cô gái xuống sau vòng xoay, hoa giấy tung bay.", camera: "whip pan into slow motion", motion: true, sizes: ["medium", "wide"] },
  ],
  final: [
    { core: () => `{{HE}} and {{SHE}} share a soft kiss as the world around them dissolves into warm light, soft backlight, slow push-in, magical`, vi: "Nụ hôn nhẹ, thế giới xung quanh tan vào ánh sáng ấm.", camera: "slow push-in", sizes: ["close", "medium"] },
    { core: () => `{{SHE}} rests her head on his shoulder as {{HE}} smiles, confetti drifting through the air, slow motion, blissful`, vi: "Cô gái tựa đầu vào vai chàng trai, hoa giấy bay lả tả.", camera: "slow motion drift", sizes: ["close", "medium"] },
  ],
  outro: [
    { core: (p) => `seen from behind, {{HE}} and {{SHE}} walk side by side past ${p.landmark(0)} at dusk, lights flickering on one by one, camera slowly rising, peaceful happy ending`, vi: "Hai người sánh bước đi xa lúc hoàng hôn, đèn lần lượt bật sáng.", camera: "slow crane up", sizes: ["wide"] },
    { core: (p) => `of ${p.landmark(1)} at night, glowing and nearly empty, a ${p.vehicle(0)} driving off into the distance, slow pull-back, nostalgic farewell`, vi: "Bối cảnh về đêm, chiếc xe cổ chạy xa dần.", camera: "slow pull-back", sizes: ["wide"] },
  ],
};

function groupFor(section: string, motion: boolean): string[] {
  const s = section.toLowerCase();
  if (s.includes("intro")) return ["intro"];
  if (s.includes("pre")) return ["pre"];
  if (s.includes("final")) return motion ? ["finalMotion", "chorusMotion"] : ["final", "chorus"];
  if (s.includes("chorus")) return motion ? ["chorusMotion"] : ["chorus", "chorusMotion"];
  if (s.includes("bridge")) return ["bridge", "verse2"];
  if (s.includes("outro")) return ["outro"];
  if (/verse 2|verse2|\b2\b/.test(s)) return ["verse2"];
  return ["verse1"];
}

const SIZE_LABEL: Record<ShotClass, string[]> = {
  wide: ["Wide shot", "Extreme wide shot", "Wide establishing shot"],
  medium: ["Medium shot", "Medium tracking shot", "Medium two-shot"],
  close: ["Close-up", "Extreme close-up", "Tight close-up"],
};
const SIZE_VALUE: Record<ShotClass, string> = { wide: "wide", medium: "medium", close: "close-up" };

const TRANSITIONS = ["match cut on movement", "cut on the beat", "whip pan", "dissolve through light flare", "match cut on the lights", "hard cut on the snare hit"];

const TONE_MOOD: Record<Tone, string> = { default: "", playful: ", playful and bouncy", melancholy: ", bittersweet and wistful", cinematic: ", grand and cinematic" };

function audioFor(section: string): string {
  const s = section.toLowerCase();
  if (s.includes("intro")) return "soft doo-wop vocal harmonies fading in, distant traffic and street chatter";
  if (s.includes("pre")) return "music drops to a heartbeat bass line, crowd noise muffled";
  if (s.includes("chorus")) return "upbeat rock and roll groove with handclaps, saxophone riff, delighted crowd";
  if (s.includes("bridge")) return "gentle slow doo-wop, crickets and a distant breeze";
  if (s.includes("outro")) return "final chord ringing out, soft evening ambience";
  return "light swing rhythm, footsteps and friendly chatter";
}

function withArticle(x: string): string {
  return /^(a|an|the)\s/i.test(x) ? x : `the ${x}`;
}

function pools(ctx: GenContext): Pools {
  const loc = ctx.location;
  const at = <V,>(arr: V[], fallback: V) => (i: number) => (arr.length ? arr[i % arr.length] : fallback);
  const vehicles = loc.vehicles.length ? loc.vehicles : ctx.eraYear.vehicles;
  return {
    landmark: (i) => withArticle(at(loc.landmarks, `${ctx.idea.world_location} street`)(i)),
    vehicle: at(vehicles.map((v) => v.replace(/\s*\(.*?\)\s*/g, " ").trim()), "vintage convertible"),
    prop: at(loc.props.length ? loc.props : ctx.eraYear.props, "a chrome jukebox"),
    light: loc.light.split(",")[0] || "warm afternoon light",
    dance: (ctx.eraYear.music_dance.find((d) => /jitterbug|bop|swing|lindy|rock/i.test(d)) ?? "jitterbug").replace(/craze/i, "").trim(),
    year: ctx.year,
    place: ctx.locationKey ?? ctx.idea.world_location,
  };
}

/** Sinh một cảnh mẫu cho một ô trong plan. `variant` khác nhau cho ra phiên bản khác. */
export function mockShot(ctx: GenContext, slot: PlannedShot, variant = 0, used?: Set<string>): RawShot {
  const r = rng(hashSeed(`${ctx.idea.id}|${ctx.idea.world_location}|${slot.shot_no}|${variant}|${ctx.tone}`));
  const p = pools(ctx);
  const groups = groupFor(slot.section, slot.must_motion);
  const candidates = groups.flatMap((g) => T[g].map((t, i) => ({ t, key: `${g}:${i}` })));
  const bySize = candidates.filter(({ t }) => !t.sizes || t.sizes.includes(slot.size_hint));
  const pool = (bySize.length ? bySize : candidates).filter(({ key }) => !used?.has(key));
  const list = pool.length ? pool : bySize.length ? bySize : candidates;
  const { t, key } = list[Math.floor(r() * list.length)];
  used?.add(key);

  const offset = Math.floor(r() * 3);
  const shifted: Pools = {
    ...p,
    landmark: (i) => p.landmark(i + offset + variant),
    vehicle: (i) => p.vehicle(i + offset + variant),
    prop: (i) => p.prop(i + offset + variant),
  };
  const sizeLabel = SIZE_LABEL[slot.size_hint][Math.floor(r() * 3)];
  let body = t.core(shifted) + (TONE_MOOD[ctx.tone] ?? "");
  if (slot.signature_shot) body += `, ${slot.signature_shot}`;
  const core = body.startsWith("of ") ? `${sizeLabel} ${body}` : `${sizeLabel}, ${body}`;
  const isLast = slot.shot_no === ctx.plan.shots.length;
  return {
    shot_no: slot.shot_no,
    shot_size: SIZE_VALUE[slot.size_hint],
    camera: t.camera,
    characters_in_shot: placeholdersIn(core),
    description_vi: t.vi,
    prompt_core: core,
    audio: ctx.profile.supports_audio ? audioFor(slot.section) : null,
    negative_extra: [],
    transition_to_next: isLast ? "fade out" : TRANSITIONS[Math.floor(r() * TRANSITIONS.length)],
    signature_shot: slot.signature_shot,
    is_motion: Boolean(t.motion) || slot.must_motion,
  };
}

/** Gợi ý lặp cảnh khi MV dùng một bộ cảnh cố định rồi lặp lại cho hết bài. */
export function loopNote(plan: StructurePlan): { section: string; note_vi: string } {
  const list = (pred: (name: string) => boolean) =>
    plan.shots
      .filter((s) => pred(s.section.toLowerCase()))
      .map((s) => `#${s.shot_no}`)
      .join(", ");
  const chorus = list((n) => n.includes("chorus") && !n.includes("pre"));
  const verse = list((n) => n.includes("verse") || n.includes("pre"));
  const calm = list((n) => n.includes("intro") || n.includes("bridge") || n.includes("outro"));
  return {
    section: "Lặp cảnh",
    note_vi: `MV dùng ${plan.shots.length} cảnh rồi lặp lại cho hết bài. Mỗi lần điệp khúc dùng lại nhóm cảnh chorus (${chorus}), xen thứ tự khác nhau; các đoạn verse dùng lại ${verse}; đoạn lắng/kết dùng ${calm}. Tránh để cùng một cảnh lặp liền nhau, đổi tốc độ (slow-motion) hoặc lật khung khi dùng lại.`,
  };
}

export function mockEditingNotes(plan: StructurePlan, loop = false): { section: string; note_vi: string }[] {
  const notes = plan.sections.map((s) => {
    const n = s.name.toLowerCase();
    let note = "Cắt theo câu hát, mỗi câu một cảnh; giữ nhịp dựng tự nhiên.";
    if (n.includes("intro")) note = "Fade-in từ đen, giữ cảnh rộng lâu để khán giả 'bước vào' năm của câu chuyện.";
    else if (n.includes("pre")) note = "Slow-motion 50–60% cho khoảnh khắc ánh mắt/cái chạm; cắt đúng phách mạnh trước chorus.";
    else if (n.includes("final")) note = "Cao trào lớn nhất: cắt dồn dập theo beat, xen cảnh nhảy rộng với cận mặt; slow-motion ở nụ hôn/cái ôm cuối.";
    else if (n.includes("chorus")) note = "Cắt nhanh theo beat (mỗi 1–2 ô nhịp), xen cảnh nhảy và cận cảnh phản ứng.";
    else if (n.includes("bridge")) note = "Giảm nhịp cắt, dùng dissolve và slow-motion nhẹ cho khoảnh khắc lắng.";
    else if (n.includes("outro")) note = "Giữ cảnh rộng cuối thật lâu, fade out theo nốt nhạc cuối.";
    return { section: s.name, note_vi: note };
  });
  return loop ? [...notes, loopNote(plan)] : notes;
}

/** Sinh toàn bộ MV mẫu, cùng cấu trúc với kết quả của Claude. */
export function mockGenerate(ctx: GenContext): RawGeneration {
  const bible = ctx.fixedBible?.characters ?? mockCouple(`${ctx.idea.series ?? ""}|${ctx.idea.id}|${ctx.idea.world_location}`);
  const used = new Set<string>();
  const shots = ctx.plan.shots.map((slot) => mockShot(ctx, slot, 0, used));
  const place = ctx.locationKey ?? ctx.idea.world_location;
  const song = ctx.idea.song_title || `${place} Sweetheart`;
  const outlineParts = ctx.idea.outline.split(/[;.]/).map((x) => x.trim()).filter(Boolean);
  return {
    character_bible: bible,
    story_arc: ctx.plan.sections.map((s, i) => ({
      section: s.name,
      beat_vi: `${s.role_vi}${outlineParts.length ? ` — ${outlineParts[Math.min(outlineParts.length - 1, Math.floor((i * outlineParts.length) / ctx.plan.sections.length))]}` : ""}`,
    })),
    shots,
    thumbnail_prompt: `Cinematic 16:9 still of {{HE}} and {{SHE}} dancing close together at ${ctx.location.landmarks[0] ?? place}, ${ctx.location.light.split(",")[0]}, golden glow, joyful eye contact, period-accurate ${ctx.year} details`,
    youtube_titles: [
      `${song} — ${place} ${ctx.year} | 1950s Rock & Roll Love Song`,
      `${song} | Vintage Doo-Wop Romance in ${place}`,
      `${place}, ${ctx.year}: ${song} (Retro 50s Music Video)`,
    ],
    youtube_description: `Imagine turning the dial of an old tabletop radio and landing on a ${ctx.year} evening in ${place}. Neon hums, chrome gleams, and two strangers are about to change each other's summer. "${song}" is a love letter to 1950s America — ${ctx.theme.mood}. Close your eyes, let the doo-wop harmonies carry you back, and fall in love the old-fashioned way.`,
    editing_notes: mockEditingNotes(ctx.plan, ctx.settings.loopScenes),
  };
}

export function mockLocation(name: string, year: number, eraYear: EraYear): RawLocation {
  return {
    landmarks: [
      `${name} main street lined with 1950s storefronts and striped awnings`,
      `neon-trimmed corner diner in ${name}`,
      `tree-lined town square of ${name} with old lampposts`,
      `${name} skyline at golden hour`,
    ],
    vehicles: eraYear.vehicles.slice(0, 4),
    wardrobe: eraYear.fashion.slice(0, 2),
    props: eraYear.props.slice(0, 4),
    light: "warm golden-hour sun by day, glowing neon by night",
    notes: `Địa điểm tự sinh (chế độ demo) cho năm ${year} — hãy bổ sung chi tiết thật.`,
    forbidden: [],
  };
}
