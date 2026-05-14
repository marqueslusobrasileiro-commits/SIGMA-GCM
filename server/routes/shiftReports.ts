const url = String(data?.downloadUrl || "").trim();

if (url && /^https?:\/\//i.test(url) && isLikelyFirebaseStorageHttpsUrl(url)) {
  try {
    const resp = await fetch(url, { method: "GET" });

    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer());

      if (buf.length) {
        console.log("[shift-reports] PDF obtido por downloadUrl (HTTPS Firebase)", {
          reportId,
          bytes: buf.length,
        });

        return buf;
      }
    }
  } catch (e) {
    console.warn("[shift-reports] tentativa Storage falhou", {
      reportId,
      storagePath,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}