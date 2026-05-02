import { addDays, set } from 'date-fns';

export type NormalizedShift = 'Diurno' | 'Intermediário' | 'Noturno' | '12x36';

type ShiftWindow = {
  start: Date;
  end: Date;
  label: NormalizedShift;
};

export function normalizeShift(input?: string | null): NormalizedShift {
  const v = (input || '').trim();
  if (!v) return 'Diurno';

  // Compatibilidade com valores antigos
  if (v === 'Manhã') return 'Diurno';
  if (v === 'Tarde') return 'Intermediário';
  if (v === 'Noite') return 'Noturno';

  if (v === 'Diurno' || v === 'Intermediário' || v === 'Noturno' || v === '12x36') return v;
  return 'Diurno';
}

function atTime(base: Date, hh: number, mm: number): Date {
  return set(base, { hours: hh, minutes: mm, seconds: 0, milliseconds: 0 });
}

/**
 * Retorna a janela do plantão mais apropriada baseada no horário "agora".
 * - Para turnos que atravessam meia-noite, ancora corretamente no dia anterior quando necessário.
 * - Se "agora" estiver fora da janela, retorna a janela mais recente que terminou antes de "agora".
 */
export function getShiftWindow(now: Date, shiftRaw?: string | null): ShiftWindow {
  const label = normalizeShift(shiftRaw);

  if (label === '12x36') {
    // Fallback simples: 12h para trás até agora. (Pode ser refinado depois conforme escala real.)
    const end = now;
    const start = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    return { start, end, label };
  }

  const day = now;
  let start = now;
  let end = now;

  if (label === 'Diurno') {
    start = atTime(day, 6, 0);
    end = atTime(day, 18, 0);
  } else if (label === 'Noturno') {
    start = atTime(day, 18, 0);
    end = atTime(addDays(day, 1), 6, 0);
  } else {
    // Intermediário
    start = atTime(day, 14, 0);
    end = atTime(addDays(day, 1), 2, 0);
  }

  // Se a janela atravessa meia-noite e agora ainda está na "madrugada",
  // ancora o start no dia anterior.
  if (label !== 'Diurno') {
    const earlyEnd = label === 'Noturno' ? atTime(day, 6, 0) : atTime(day, 2, 0);
    if (now < earlyEnd) {
      start = label === 'Noturno' ? atTime(addDays(day, -1), 18, 0) : atTime(addDays(day, -1), 14, 0);
      end = earlyEnd;
    }
  }

  // Se agora está fora, retorna a janela mais recente encerrada antes de agora
  if (!(now >= start && now <= end)) {
    if (now < start) {
      // pega janela anterior
      const prevDay = addDays(day, -1);
      if (label === 'Diurno') {
        start = atTime(prevDay, 6, 0);
        end = atTime(prevDay, 18, 0);
      } else if (label === 'Noturno') {
        start = atTime(prevDay, 18, 0);
        end = atTime(day, 6, 0);
      } else {
        start = atTime(prevDay, 14, 0);
        end = atTime(day, 2, 0);
      }
    } else {
      // now > end: mantém start/end calculados para o dia (janela "de hoje") mas já passou;
      // isso é adequado para "encerrar" logo após o fim.
    }
  }

  return { start, end, label };
}

export function isWithinWindow(ts: string, window: { start: Date; end: Date }): boolean {
  const d = new Date(ts);
  const t = d.getTime();
  return !Number.isNaN(t) && t >= window.start.getTime() && t <= window.end.getTime();
}

