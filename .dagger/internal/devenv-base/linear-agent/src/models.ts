// Picks the model for the OpenRouter runtime when OPENROUTER_MODEL is unset:
// the cheapest open-weight model OpenRouter lists that can call tools. Read
// from OpenRouter's own model list when a turn needs it, not hardcoded,
// because prices and the catalogue change weekly and the point is the
// cheapest one at the time of the turn.

/** The fields of one entry of GET /api/v1/models this file reads. */
export interface OpenRouterModel {
  id: string;
  /** Set for open-weight models (the weights are on Hugging Face), empty otherwise. */
  hugging_face_id?: string | null;
  context_length?: number | null;
  /** Dollars per token, as decimal strings. */
  pricing?: { prompt?: string; completion?: string } | null;
  supported_parameters?: string[] | null;
}

/**
 * A turn sends the issue, the tool schemas and every tool result back on
 * each step, so a model with a small window fails mid-turn however cheap it
 * is.
 */
export const MIN_CONTEXT = 65_536;

/**
 * An agent turn reads far more than it writes: each step resends the whole
 * conversation and adds a short tool call. Prompt tokens are weighted 3:1
 * against completion tokens when comparing prices.
 */
const PROMPT_WEIGHT = 3;

function price(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Returns the cheapest model that is open-weight, calls tools, has at least
 * MIN_CONTEXT of context, and has a real per-token price. `:free` variants
 * are left out: they are rate-limited to a handful of requests a minute,
 * which an agent turn exceeds on its own, and their providers may log
 * prompts. So are zero and negative prices, which OpenRouter uses for
 * routers whose price is only known per request. Ties go to the id that
 * sorts first, so the choice is stable.
 */
export function cheapestOpenModel(models: readonly OpenRouterModel[]): OpenRouterModel | undefined {
  let best: { model: OpenRouterModel; cost: number } | undefined;
  for (const model of models) {
    if (!model.hugging_face_id) continue;
    if (model.id.endsWith(":free")) continue;
    if (!model.supported_parameters?.includes("tools")) continue;
    if ((model.context_length ?? 0) < MIN_CONTEXT) continue;
    const prompt = price(model.pricing?.prompt);
    const completion = price(model.pricing?.completion);
    if (!(prompt > 0) || !(completion > 0)) continue;
    const cost = PROMPT_WEIGHT * prompt + completion;
    if (!best || cost < best.cost || (cost === best.cost && model.id < best.model.id)) {
      best = { model, cost };
    }
  }
  return best?.model;
}

const MODELS_URL = "https://openrouter.ai/api/v1/models?supported_parameters=tools";
const REFRESH_MS = 6 * 60 * 60 * 1000;

let cached: { id: string; at: number } | undefined;

/**
 * The model id to use for a turn: `configured` when set, otherwise the
 * cheapest open-weight model, looked up at most every six hours. A failed
 * lookup keeps using the last answer if there is one, and otherwise fails
 * the turn (which the session reports on the issue as an error).
 */
export async function resolveModel(
  configured: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<string> {
  if (configured) return configured;
  if (cached && now - cached.at < REFRESH_MS) return cached.id;
  try {
    const res = await fetchImpl(MODELS_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`OpenRouter model list: ${res.status} ${await res.text()}`);
    const { data } = (await res.json()) as { data: OpenRouterModel[] };
    const model = cheapestOpenModel(data ?? []);
    if (!model) throw new Error("OpenRouter lists no open-weight model with tool calling; set OPENROUTER_MODEL");
    if (cached?.id !== model.id) console.log(`openrouter: using ${model.id}, the cheapest open-weight model with tool calling`);
    cached = { id: model.id, at: now };
    return model.id;
  } catch (err) {
    if (cached) {
      console.error(`openrouter: model list unavailable, keeping ${cached.id}`, err);
      return cached.id;
    }
    throw err;
  }
}

/** Tests only: forget the cached choice. */
export function resetModelCache(): void {
  cached = undefined;
}
