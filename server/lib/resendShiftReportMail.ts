const RESEND_API = "https://api.resend.com/emails";

function resolveResendFrom(): string {
  return String(
    process.env.RESEND_FROM || process.env.EMAIL_FROM || process.env.SMTP_FROM || "",
  ).trim();
}

export function isResendConfigured(): boolean {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  const from = resolveResendFrom();
  return !!(key && from);
}

export async function sendEmailWithPdfViaResend(opts: {
  to: string;
  subject: string;
  text: string;
  pdfFilename: string;
  pdfBuffer: Buffer;
  reportId?: string;
}): Promise<void> {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = resolveResendFrom();

  if (!apiKey) {
    throw new Error("RESEND_API_KEY não definido.");
  }

  if (!from) {
    throw new Error("RESEND_FROM, EMAIL_FROM ou SMTP_FROM é obrigatório para Resend.");
  }

  const body = {
    from,
    to: [opts.to],
    subject: opts.subject,
    text: opts.text,
    attachments: [
      {
        filename: opts.pdfFilename,
        content: opts.pdfBuffer.toString("base64"),
      },
    ],
  };

  const response = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Resend erro: ${txt}`);
  }
}