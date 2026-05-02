type GeminiGenerateRequest = {
  prompt: string;
  model?: string;
};

type GeminiGenerateResponse =
  | { text: string }
  | { error: string };

export async function generateGeminiText(req: GeminiGenerateRequest): Promise<string> {
  const { auth } = await import("../firebase");
  const { apiFetch } = await import("./apiClient");
  const idToken = await auth.currentUser?.getIdToken();

  const res = await apiFetch("/api/gemini/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(req),
  });

  const data = (await res.json()) as GeminiGenerateResponse;
  if (!res.ok) {
    const msg = "error" in data ? data.error : "Gemini request failed";
    throw new Error(msg);
  }

  if (!("text" in data) || typeof data.text !== "string") {
    throw new Error("Invalid Gemini response");
  }
  return data.text;
}

