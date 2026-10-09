import "server-only";

import OpenAI from "openai";
import { makeParseableTextFormat } from "openai/lib/parser";

export function openAiBriefModel(): string {
  return process.env.OPENAI_BRIEF_MODEL?.trim() || "gpt-4o-mini";
}

export function requireOpenAiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OpenAI is not configured. Add OPENAI_API_KEY to the dashboard server environment.",
    );
  }
  return key;
}

function incompleteReason(response: OpenAI.Responses.Response): string | null {
  const details = response.incomplete_details;
  if (!details || typeof details !== "object" || !("reason" in details)) {
    return null;
  }
  const reason = details.reason;
  return typeof reason === "string" ? reason : null;
}

export type StructuredRequest<T> = {
  /** JSON schema name sent to OpenAI (e.g. "skip_explanation"). */
  name: string;
  schema: Record<string, unknown>;
  /** Parses and validates the model's JSON text; throw to reject. */
  parse: (content: string) => T;
  system: string;
  packet: unknown;
  maxOutputTokens: number;
  /** Retry once with this budget when the first reply ran out of output tokens. */
  retryMaxOutputTokens?: number;
  /** Noun phrase for the error, e.g. "an explanation". */
  outputLabel: string;
  /** Closing hint on the error; defaults to "Try again." */
  retryHint?: string;
};

/** One structured (JSON-schema) Responses call shared by every dashboard AI feature. */
export async function runStructured<T>(
  req: StructuredRequest<T>,
): Promise<{ output: T; model: string }> {
  const client = new OpenAI({ apiKey: requireOpenAiKey() });
  const model = openAiBriefModel();
  const format = makeParseableTextFormat(
    { type: "json_schema", name: req.name, schema: req.schema, strict: true },
    req.parse,
  );

  const request = (maxOutputTokens: number) =>
    client.responses.parse({
      model,
      max_output_tokens: maxOutputTokens,
      input: [
        { role: "system", content: req.system },
        { role: "user", content: JSON.stringify(req.packet) },
      ],
      text: { format },
    });

  let response = await request(req.maxOutputTokens);

  if (
    req.retryMaxOutputTokens != null &&
    !response.output_parsed &&
    response.status === "incomplete" &&
    incompleteReason(response) === "max_output_tokens"
  ) {
    response = await request(req.retryMaxOutputTokens);
  }

  if (response.error) {
    throw new Error(response.error.message ?? "OpenAI request failed.");
  }

  const output = response.output_parsed;
  if (!output) {
    const status = "status" in response ? String(response.status) : "unknown";
    const reason = incompleteReason(response);
    const detail =
      reason === "max_output_tokens"
        ? " The model ran out of output space — try again or set OPENAI_BRIEF_MODEL to gpt-4o-mini."
        : reason
          ? ` (${reason})`
          : "";
    throw new Error(
      `OpenAI did not return ${req.outputLabel} (status: ${status})${detail} ${req.retryHint ?? "Try again."}`,
    );
  }

  return { output, model };
}
