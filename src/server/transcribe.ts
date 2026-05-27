import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";

const GEMINI_MODEL = "gemini-3.5-flash";
const TIMEOUT_MS = 25_000;

/**
 * Downloads a TG voice / video_note by file_id and runs it through Gemini
 * 3.5 Flash to get a verbatim transcript (Hebrew or Russian — both handled
 * natively). When `opts.translate === true`, the same call also produces a
 * natural Russian translation (or an empty string when the source language
 * is already Russian). Returns `null` on any failure — never throws.
 *
 * Inline base64 in the prompt is fine because both TG voice (OGG/Opus) and
 * video_note (MP4) are well under Gemini's 20 MB inline limit (our
 * video_notes are hard-capped at 12 MiB elsewhere in this codebase).
 */
export async function transcribeTgAudio(
  fileId: string,
  kind: "voice" | "video_note",
  opts?: { translate?: boolean },
): Promise<{ transcript: string; translation: string | null } | null> {
  const apiKey = serverEnv.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[transcribe] skipped — GEMINI_API_KEY not set");
    return null;
  }

  const translate = opts?.translate === true;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const file = await getBot().api.getFile(fileId);
    if (!file.file_path) return null;
    const url = `https://api.telegram.org/file/bot${serverEnv.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

    const audioRes = await fetch(url, { signal: ac.signal });
    if (!audioRes.ok) return null;
    const bytes = new Uint8Array(await audioRes.arrayBuffer());
    const b64 = Buffer.from(bytes).toString("base64");
    const mime = kind === "voice" ? "audio/ogg" : "video/mp4";

    const promptText = translate
      ? "Transcribe this audio verbatim, preserving the spoken language " +
        "(usually Hebrew, sometimes Russian). If the source language is " +
        "NOT Russian, also produce a natural Russian translation. Return " +
        "STRICT JSON of the shape: " +
        "{\"transcript\":\"<verbatim>\",\"russian_translation\":\"<translation or empty string if source is already Russian>\"}. " +
        "No commentary, no language tags."
      : "Transcribe this audio verbatim. Preserve the spoken language " +
        "(usually Hebrew, sometimes Russian). Return only the transcript " +
        "text, no commentary, no quotes, no language tags.";

    const body: Record<string, unknown> = {
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mime, data: b64 } },
            { text: promptText },
          ],
        },
      ],
    };
    if (translate) {
      body.generationConfig = { response_mime_type: "application/json" };
    }

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        signal: ac.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!r.ok) {
      const errBody = await r.text().catch(() => "");
      console.warn("[transcribe] gemini non-ok", r.status, errBody.slice(0, 300));
      return null;
    }
    const data = (await r.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!raw) return null;

    if (!translate) {
      return { transcript: raw, translation: null };
    }
    try {
      const parsed = JSON.parse(raw) as {
        transcript?: string;
        russian_translation?: string;
      };
      const transcript = parsed.transcript?.trim();
      const translation = parsed.russian_translation?.trim();
      if (!transcript) return null;
      return {
        transcript,
        translation: translation && translation.length > 0 ? translation : null,
      };
    } catch (e) {
      console.warn(
        "[transcribe] gemini json parse failed",
        (e as Error).message,
        raw.slice(0, 200),
      );
      return null;
    }
  } catch (e) {
    console.warn("[transcribe] failed", (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
