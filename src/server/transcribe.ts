import { getBot } from "@/lib/tg";
import { serverEnv } from "@/lib/env";

const GEMINI_MODEL = "gemini-3.5-flash";
const TIMEOUT_MS = 25_000;

/**
 * Downloads a TG voice / video_note by file_id and runs it through Gemini
 * 3.5 Flash to get a verbatim transcript (Hebrew or Russian — both handled
 * natively). Returns `null` on any failure — never throws.
 *
 * Translation is intentionally NOT done in this call. A combined
 * transcribe+translate prompt caused Gemini to bleed Russian tokens into
 * the Hebrew transcript itself (e.g. «היום э привет מה עושה»). Keep this
 * single-purpose; translation lives in `translateToRussian` and runs as
 * a separate text-only call when needed.
 *
 * Inline base64 in the prompt is fine because both TG voice (OGG/Opus) and
 * video_note (MP4) are well under Gemini's 20 MB inline limit (our
 * video_notes are hard-capped at 12 MiB elsewhere in this codebase).
 */
export async function transcribeTgAudio(
  fileId: string,
  kind: "voice" | "video_note",
): Promise<string | null> {
  const apiKey = serverEnv.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[transcribe] skipped — GEMINI_API_KEY not set");
    return null;
  }

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

    const body = {
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mime, data: b64 } },
            {
              text:
                // The audio comes from a Hebrew tutor — Hebrew is the
                // overwhelming default. Explicit anti-transliteration
                // rule because earlier looser prompts caused Gemini to
                // emit Hebrew speech as Cyrillic phonetics or to
                // auto-translate to Russian.
                "This is audio from a Hebrew-language tutor. Transcribe it verbatim in Hebrew script (אבגדהוזחטיכלמנסעפצקרשת).\n" +
                "If — and only if — the speaker is clearly using Russian instead, transcribe in Cyrillic script.\n" +
                "Do NOT translate. Do NOT transliterate (never write Hebrew in Cyrillic, never write Russian in Latin).\n" +
                "Return ONLY the transcript text — no commentary, no quotes, no language labels.",
            },
          ],
        },
      ],
    };

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
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch (e) {
    console.warn("[transcribe] failed", (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cheap script-majority heuristic: if more Cyrillic chars than other
 * letters, it's already Russian → caller should skip translation. Punctuation
 * + whitespace + digits don't count. Hebrew chars (block U+0590..U+05FF)
 * are the main competing script in our audience.
 *
 * False-positives (a Russian sentence with a Hebrew word) → we'd skip a
 * useful translation. False-negatives (a Hebrew sentence with a single
 * Russian word) → we'd pay for an unnecessary translation call. Both are
 * tolerable.
 */
export function isMostlyRussian(text: string): boolean {
  let ru = 0;
  let other = 0;
  for (const ch of text) {
    if (/[Ѐ-ӿ]/.test(ch)) ru++;
    else if (/\p{L}/u.test(ch)) other++;
  }
  if (ru === 0 && other === 0) return false;
  return ru > other;
}

/**
 * Translates `text` to natural Russian via a text-only Gemini call.
 * Returns `null` on any failure — never throws.
 *
 * Caller is responsible for the "is this already Russian" gate via
 * `isMostlyRussian` so we don't waste a round-trip echoing the source.
 */
export async function translateToRussian(text: string): Promise<string | null> {
  const apiKey = serverEnv.GEMINI_API_KEY;
  if (!apiKey) return null;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const body = {
      contents: [
        {
          parts: [
            {
              text:
                // Source is overwhelmingly Hebrew (tutor's lessons);
                // very occasionally English or another non-Russian
                // language. The caller already filters out Russian-only
                // inputs via the Cyrillic-majority heuristic, so we
                // don't have to handle "source is already Russian".
                "Translate the following Hebrew text to natural, idiomatic Russian. " +
                "Return ONLY the Russian translation — no commentary, no quotes, no language tags, no original text alongside.\n\n" +
                text,
            },
          ],
        },
      ],
    };
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
      console.warn("[translate] gemini non-ok", r.status, errBody.slice(0, 300));
      return null;
    }
    const data = (await r.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return out && out.length > 0 ? out : null;
  } catch (e) {
    console.warn("[translate] failed", (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
