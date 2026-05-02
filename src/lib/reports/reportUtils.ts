import type { OccurrenceRecord } from "../../types";

export function sortByTimestampAsc<T extends { timestamp: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

export function cleanTrailingWhitespace(text: string): string {
  return text.replace(/\s+$/g, "").trim();
}

export function buildAiPrompt(input: {
  todayPatrolsCount: number;
  todayOccurrences: OccurrenceRecord[];
}): string {
  const occurrenceTypes = input.todayOccurrences.reduce<Record<string, number>>((acc, o) => {
    acc[o.type] = (acc[o.type] || 0) + 1;
    return acc;
  }, {});

  const topTypes = (Object.entries(occurrenceTypes) as Array<[string, number]>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => `- ${type}: ${count}`)
    .join("\n");

  return [
    "Você é um analista operacional da Guarda Civil Municipal.",
    "Gere um resumo curto (máx. 8 linhas) e objetivo do plantão, em pt-BR.",
    "Inclua: panorama, pontos de atenção e recomendações imediatas.",
    "",
    "Dados:",
    `- Locais visitados: ${input.todayPatrolsCount}`,
    `- Ocorrências registradas: ${input.todayOccurrences.length}`,
    topTypes ? `- Top tipos de ocorrência:\n${topTypes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

