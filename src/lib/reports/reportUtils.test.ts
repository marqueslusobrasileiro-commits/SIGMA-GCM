import { describe, expect, it } from "vitest";
import { buildAiPrompt, cleanTrailingWhitespace, sortByTimestampAsc } from "./reportUtils";

describe("reportUtils", () => {
  it("cleanTrailingWhitespace remove espaços finais e trim", () => {
    expect(cleanTrailingWhitespace("  oi  \n\n")).toBe("oi");
    expect(cleanTrailingWhitespace("teste\t\t")).toBe("teste");
  });

  it("sortByTimestampAsc ordena por timestamp crescente sem mutar input", () => {
    const input = [
      { id: "b", timestamp: "2026-01-02T00:00:00.000Z" },
      { id: "a", timestamp: "2026-01-01T00:00:00.000Z" },
      { id: "c", timestamp: "2026-01-03T00:00:00.000Z" },
    ];
    const out = sortByTimestampAsc(input);
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(input.map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("buildAiPrompt inclui contagens e top tipos quando houver ocorrências", () => {
    const prompt = buildAiPrompt({
      todayPatrolsCount: 7,
      todayOccurrences: [
        { type: "A", timestamp: "2026-01-01T00:00:00.000Z" } as any,
        { type: "B", timestamp: "2026-01-01T00:00:01.000Z" } as any,
        { type: "A", timestamp: "2026-01-01T00:00:02.000Z" } as any,
      ],
    });
    expect(prompt).toContain("- Locais visitados: 7");
    expect(prompt).toContain("- Ocorrências registradas: 3");
    expect(prompt).toContain("Top tipos de ocorrência");
    expect(prompt).toContain("- A: 2");
    expect(prompt).toContain("- B: 1");
  });
});

