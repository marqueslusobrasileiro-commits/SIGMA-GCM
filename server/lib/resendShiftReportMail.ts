const RESEND_API = "https://api.resend.com/emails";

export function isResendConfigured(): boolean {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM || "").trim();

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
  const from = String(process.env.RESEND_FROM || "").trim();

  if (!apiKey) {
    throw new Error("RESEND_API_KEY não definido.");
  }

  if (!from) {
    throw new Error("RESEND_FROM não definido.");
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