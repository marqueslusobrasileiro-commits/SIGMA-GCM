import { doc, getDocFromServer } from "firebase/firestore";
import { format } from "date-fns";
import type { Firestore } from "firebase/firestore";
import type { OccurrenceRecord, PatrolRecord, Team, UserProfile } from "../../types";
import { buildAiPrompt, cleanTrailingWhitespace, sortByTimestampAsc } from "./reportUtils";
import { getShiftWindow, isWithinWindow, normalizeShift } from "../shifts";
import { addSigmaHeader } from "./pdfBranding";

type GenerateGeminiText = (req: { prompt: string; model?: string }) => Promise<string>;

type GenerateEndOfShiftReportParams = {
  profile: UserProfile;
  patrols: PatrolRecord[];
  occurrences: OccurrenceRecord[];
  teams: Team[];
  db: Firestore;
  generateGeminiText: GenerateGeminiText;
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao ler imagem (FileReader)"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

async function loadImage(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Falha ao baixar imagem: ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  return await blobToDataUrl(blob);
}

export async function generateEndOfShiftReportPdf(
  params: GenerateEndOfShiftReportParams,
): Promise<{ filename: string; blob: Blob; windowStart: string; windowEnd: string; shift: string }> {
  const { profile, patrols, occurrences, teams, db, generateGeminiText } = params;

  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const pdfDoc = new jsPDF();
  const now = new Date();

  // Fetch the latest team data directly from Firestore to ensure it's up to date
  let team: Team | undefined = undefined;
  if (profile.teamId) {
    try {
      const teamDoc = await getDocFromServer(doc(db, "teams", profile.teamId));
      if (teamDoc.exists()) {
        team = { id: teamDoc.id, ...(teamDoc.data() as Omit<Team, "id">) } as Team;
      }
    } catch (e) {
      console.error("Error fetching latest team data for report:", e);
      team = teams.find((t) => t.id === profile.teamId);
    }
  }

  const window = getShiftWindow(now, team?.shift);

  const shiftPatrols = sortByTimestampAsc(
    patrols.filter((p) => {
      try {
        const isFromSameTeam = !!profile.teamId && p.teamId === profile.teamId;
        return isFromSameTeam && isWithinWindow(p.timestamp, window);
      } catch {
        return false;
      }
    }),
  );

  const shiftOccurrences = sortByTimestampAsc(
    occurrences.filter((o) => {
      try {
        // Filter by teamId if present, or agentId as fallback for legacy data
        const isFromSameTeam =
          o.teamId && profile.teamId ? o.teamId === profile.teamId : o.agentId === profile.uid;
        return isFromSameTeam && isWithinWindow(o.timestamp, window);
      } catch {
        return false;
      }
    }),
  );

  await addSigmaHeader(pdfDoc as any, {
    title: "SIGMA-GCM",
    subtitleLine1: "Sistema Inteligente de Gestão e Monitoramento Avançado da Guarda Civil Municipal",
    subtitleLine2: "Guarda Civil Municipal de Araçoiaba da Serra",
    centerLine: "Relatório Operacional de Plantão",
    generatedAt: new Date(),
  });

  // Info Section
  pdfDoc.setTextColor(0, 0, 0);
  pdfDoc.setFontSize(11);
  pdfDoc.setFont("helvetica", "bold");
  pdfDoc.text("DADOS DO PLANTÃO", 20, 55);
  pdfDoc.line(20, 57, 190, 57);

  pdfDoc.setFontSize(10);
  pdfDoc.setFont("helvetica", "normal");
  pdfDoc.text(`Agente Responsável: ${profile.name || "N/A"}`, 20, 65);
  pdfDoc.text(`Matrícula: ${profile.registration || "N/A"}`, 20, 72);
  pdfDoc.text(
    `Período: ${format(window.start, "dd/MM/yyyy HH:mm")} – ${format(window.end, "dd/MM/yyyy HH:mm")}`,
    20,
    79,
  );

  pdfDoc.text(`Viatura: ${team?.vehiclePrefix || "N/A"}`, 110, 65);
  pdfDoc.text(`Equipe: ${team?.name || "N/A"}`, 110, 72);
  pdfDoc.text(`Turno: ${normalizeShift(team?.shift) || "N/A"}`, 110, 79);

  // Composition Section
  pdfDoc.setFont("helvetica", "bold");
  pdfDoc.text("COMPOSIÇÃO DA EQUIPE", 20, 92);
  pdfDoc.line(20, 94, 190, 94);

  pdfDoc.setFont("helvetica", "normal");
  pdfDoc.text(`Condutor: ${team?.driver || "N/A"}`, 20, 102);
  pdfDoc.text(`Encarregado: ${team?.inCharge || "N/A"}`, 20, 109);
  pdfDoc.text(`Auxiliar 01: ${team?.aux1 || "-"}`, 110, 102);
  pdfDoc.text(`Auxiliar 02: ${team?.aux2 || "-"}`, 110, 109);

  if (team?.members && team.members.length > 0) {
    pdfDoc.text(`Membros Adicionais: ${team.members.join(", ")}`, 20, 116);
  }

  // Patrols Table
  pdfDoc.setFont("helvetica", "bold");
  pdfDoc.text("HISTÓRICO DE RONDAS", 20, 125);

  const patrolTableData = shiftPatrols.map((p) => [
    format(new Date(p.timestamp), "HH:mm"),
    p.propertyName,
    p.plusCode || "-",
    p.status?.toUpperCase() || "NORMAL",
    p.observation || "-",
  ]);

  autoTable(pdfDoc, {
    startY: 130,
    head: [["Horário", "Local / Próprio Público", "Plus Code", "Status", "Observações"]],
    body: patrolTableData,
    headStyles: { fillColor: [0, 33, 71] },
    styles: { fontSize: 8 },
    margin: { left: 20, right: 20 },
  });

  // Summary
  let finalY = (pdfDoc as any).lastAutoTable.finalY + 15;
  pdfDoc.setFont("helvetica", "bold");
  pdfDoc.text(`Total de locais visitados: ${shiftPatrols.length}`, 20, finalY);

  // Optional AI summary (server-side Gemini; no secrets in client)
  try {
    const prompt = buildAiPrompt({
      todayPatrolsCount: shiftPatrols.length,
      todayOccurrences: shiftOccurrences,
    });

    const aiText = await generateGeminiText({ prompt });
    const cleaned = cleanTrailingWhitespace(aiText);
    if (cleaned) {
      finalY += 10;
      if (finalY > 250) {
        pdfDoc.addPage();
        finalY = 20;
      }

      pdfDoc.setFont("helvetica", "bold");
      pdfDoc.setFontSize(11);
      pdfDoc.text("RESUMO IA", 20, finalY);
      pdfDoc.line(20, finalY + 2, 190, finalY + 2);

      pdfDoc.setFont("helvetica", "normal");
      pdfDoc.setFontSize(9);
      const wrapped = pdfDoc.splitTextToSize(cleaned, 170);
      pdfDoc.text(wrapped, 20, finalY + 10);

      finalY += 10 + wrapped.length * 4;
    }
  } catch (err) {
    console.warn("Gemini summary skipped:", err);
  }

  // Occurrences Section
  finalY += 15;

  if (shiftOccurrences.length > 0) {
    if (finalY > 250) {
      pdfDoc.addPage();
      finalY = 20;
    }

    pdfDoc.setFont("helvetica", "bold");
    pdfDoc.text("OCORRÊNCIAS REGISTRADAS", 20, finalY);

    const occurrenceTableData = shiftOccurrences.map((o) => [
      format(new Date(o.timestamp), "HH:mm"),
      o.propertyName || "N/A",
      o.type,
      o.description,
    ]);

    autoTable(pdfDoc, {
      startY: finalY + 5,
      head: [["Horário", "Local / Posto", "Tipo de Ocorrência", "Descrição / Relato"]],
      body: occurrenceTableData,
      headStyles: { fillColor: [153, 0, 0] }, // Dark red
      styles: { fontSize: 9 },
      margin: { left: 20, right: 20 },
    });

    finalY = (pdfDoc as any).lastAutoTable.finalY + 15;

    // Add Photos if any
    const occurrencesWithPhotos = shiftOccurrences.filter((o) => o.photoUrl);
    if (occurrencesWithPhotos.length > 0) {
      if (finalY > 200) {
        pdfDoc.addPage();
        finalY = 20;
      }
      pdfDoc.setFont("helvetica", "bold");
      pdfDoc.text("ANEXOS FOTOGRÁFICOS (OCORRÊNCIAS)", 20, finalY);
      finalY += 10;

      for (const occ of occurrencesWithPhotos) {
        if (finalY > 230) {
          pdfDoc.addPage();
          finalY = 20;
        }
        pdfDoc.setFont("helvetica", "normal");
        pdfDoc.setFontSize(8);
        pdfDoc.text(
          `${format(new Date(occ.timestamp), "HH:mm")} - ${occ.type} (${occ.propertyName || "N/A"})`,
          20,
          finalY,
        );
        finalY += 5;
        try {
          const imgData = await loadImage(occ.photoUrl!);
          pdfDoc.addImage(imgData, "JPEG", 20, finalY, 60, 45);
          finalY += 55;
        } catch (e) {
          console.error("Error adding image to PDF:", e);
          pdfDoc.text("[Erro ao carregar imagem]", 20, finalY);
          finalY += 10;
        }
      }
    }
  } else {
    finalY += 10;
    pdfDoc.setFont("helvetica", "italic");
    pdfDoc.text("Nenhuma ocorrência registrada neste plantão.", 20, finalY);
    finalY += 20;
  }

  pdfDoc.line(60, finalY + 10, 150, finalY + 10);
  pdfDoc.setFont("helvetica", "normal");
  pdfDoc.setFontSize(10);
  pdfDoc.text("Assinatura do Agente Responsável", 105, finalY + 18, { align: "center" });
  pdfDoc.text(`${profile.name} - GCM`, 105, finalY + 25, { align: "center" });

  const filename = `Relatorio_Plantao_${profile.registration || "GCM"}_${format(window.start, "yyyyMMdd")}.pdf`;
  const blob = pdfDoc.output("blob");
  pdfDoc.save(filename);
  return {
    filename,
    blob,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    shift: window.label,
  };
}

