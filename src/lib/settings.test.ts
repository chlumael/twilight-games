import { describe, expect, it } from "vitest";
import { gameByTitle, pickDetectedGame } from "./settings";

describe("게임 알아보기", () => {
  it("창 이름이 게임 이름과 통째로 같을 때만 (공백·대소문자 무시)", () => {
    expect(gameByTitle("명일방주")).toBe("arknights");
    expect(gameByTitle("arknights")).toBe("arknights");
    expect(gameByTitle("Arknights: Endfield")).toBe("endfield");
    expect(gameByTitle("원신")).toBe("genshin");
    expect(gameByTitle("원신 5.3 공식 영상 - YouTube")).toBeNull();
    expect(gameByTitle("")).toBeNull();
    expect(gameByTitle(null)).toBeNull();
  });
  it("앞에 있는 게임 > 지금 게임이 실행 중이면 그대로 > 실행 중인 첫 게임", () => {
    expect(pickDetectedGame(["genshin", "limbus"], "arknights", "limbus")).toBe("arknights");
    expect(pickDetectedGame(["genshin", "limbus"], null, "limbus")).toBe("limbus");
    expect(pickDetectedGame(["genshin"], null, "limbus")).toBe("genshin");
  });
});
