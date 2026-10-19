import { describe, expect, it } from "vitest";
import eraRules from "../data/era_rules.json";
import locations from "../data/locations.json";
import { checkText, hasVietnamese } from "@/lib/eraCheck";
import type { EraRules, LocationLibrary } from "@/lib/types";

const rules = eraRules as EraRules;
const lib = locations as LocationLibrary;

const msgs = (text: string, year = 1954, loc?: string) =>
  checkText(text, { year, rules, location: loc ? lib[loc] : null }).map((i) => `${i.severity}:${i.category}:${i.term}`);

describe("checkText", () => {
  it("prompt hợp lệ không có cảnh báo", () => {
    expect(
      msgs("Wide establishing shot of a palm-lined boulevard, 1954 Chevrolet Bel Air and 1953 Cadillac Eldorado convertible passing, crowds in hats, slow crane down."),
    ).toEqual([]);
  });

  it("bắt điện thoại, LED, xe hiện đại", () => {
    const r = msgs("She checks her smartphone under LED signs while an SUV passes.");
    expect(r.filter((x) => x.startsWith("error:era"))).toHaveLength(3);
  });

  it("không bắt 'led' viết thường (động từ) và các cụm phủ định", () => {
    expect(msgs("He led her across the dance floor, no smartphones, without any modern cars.")).toEqual([]);
  });

  it("xe đời sau năm của cảnh", () => {
    const r = checkText("A 1957 Chevrolet Bel Air cruises by.", { year: 1954, rules });
    expect(r[0].severity).toBe("error");
    expect(r[0].message_vi).toContain("1957");
    expect(checkText("A '57 Chevy cruises by.", { year: 1955, rules })[0].message_vi).toContain("1957");
    expect(checkText("A 1957 Chevrolet Bel Air cruises by.", { year: 1957, rules })).toEqual([]);
  });

  it("vật dụng ra đời sau năm của cảnh", () => {
    expect(msgs("Kids play with a hula hoop on the lawn.", 1955)).toEqual(["error:era:hula hoop"]);
    expect(msgs("Kids play with a hula hoop on the lawn.", 1958)).toEqual([]);
    expect(msgs("A red Ford Thunderbird parked outside.", 1954)[0]).toMatch(/^error:era:Thunderbird/);
    expect(msgs("She wears a beehive hairdo.", 1959)[0]).toMatch(/^error:era:beehive/);
  });

  it("năm khác được nhắc tới (không tính 1950s)", () => {
    expect(msgs("Summer 1958 night, 1950s fashion everywhere.", 1954)).toEqual(["warning:era:1958"]);
  });

  it("quy tắc riêng của địa điểm", () => {
    expect(msgs("The couple rides the Ferris wheel above the pier.", 1954, "Santa Monica Pier")).toEqual(["error:location:Ferris wheel"]);
    expect(msgs("The couple rides the Ferris wheel above the boardwalk.", 1954, "Coney Island")).toEqual([]);
    expect(msgs("Hand-in-hand under the canopy of palm trees.", 1955, "Fremont Street")).toEqual([]);
    expect(msgs("Neon glow under the LED canopy.", 1955, "Fremont Street").some((x) => x.startsWith("error:location"))).toBe(true);
  });

  it("thương hiệu, người thật, chữ trên màn hình", () => {
    expect(msgs("She sips a Coca-Cola beside an Elvis poster.")).toEqual(["warning:brand:Coca-Cola", "warning:brand:Elvis"]);
    expect(msgs('A neon sign reading "EAT" glows.').some((x) => x.startsWith("warning:text"))).toBe(true);
  });

  it("bỏ qua đoạn style/nhân vật được chỉ định", () => {
    const style = "Shot on 35mm Kodachrome film, 1950s America";
    expect(checkText(`A diner at dusk. ${style}`, { year: 1954, rules, ignoreTexts: [style] })).toEqual([]);
  });
});

describe("hasVietnamese", () => {
  it("phát hiện tiếng Việt có dấu", () => {
    expect(hasVietnamese("Toàn cảnh Hollywood")).toBe(true);
    expect(hasVietnamese("Wide shot of Hollywood")).toBe(false);
  });
});
