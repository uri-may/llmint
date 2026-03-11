export interface ProviderConfig {
  upstreamUrl: string;
  upstreamApiKey: string;
}

export interface InferenceResult {
  body: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface InferenceStream {
  stream: ReadableStream<Uint8Array>;
  done: Promise<InferenceResult>;
}

export async function complete(
  config: ProviderConfig,
  requestBody: Record<string, unknown>,
): Promise<InferenceResult> {
  const body = { ...requestBody, stream: false };

  const response = await fetch(
    `${config.upstreamUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.upstreamApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Upstream error ${response.status}: ${text}`,
    );
  }

  const json = (await response.json()) as Record<string, unknown>;
  const usage = json["usage"] as
    | Record<string, unknown>
    | undefined;

  return {
    body: json,
    inputTokens: (usage?.["prompt_tokens"] as number) ?? 0,
    outputTokens:
      (usage?.["completion_tokens"] as number) ?? 0,
    model: (json["model"] as string) ?? "unknown",
  };
}

export function completeStream(
  config: ProviderConfig,
  requestBody: Record<string, unknown>,
): InferenceStream {
  const body = {
    ...requestBody,
    stream: true,
    stream_options: { include_usage: true },
  };

  let resolveResult!: (result: InferenceResult) => void;
  let rejectResult!: (err: unknown) => void;
  const done = new Promise<InferenceResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  let model = (requestBody["model"] as string) ?? "unknown";
  let inputTokens = 0;
  let outputTokens = 0;
  let lastBody: Record<string, unknown> = {};
  let buffer = "";

  const fetchPromise = fetch(
    `${config.upstreamUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.upstreamApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let response: Response;
      try {
        response = await fetchPromise;
      } catch (err) {
        rejectResult(err);
        controller.error(err);
        return;
      }

      if (!response.ok || !response.body) {
        const text = await response.text();
        const error = new Error(
          `Upstream error ${response.status}: ${text}`,
        );
        rejectResult(error);
        controller.error(error);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        for (;;) {
          const { done: readerDone, value } =
            await reader.read();
          if (readerDone) break;

          controller.enqueue(value);

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const chunk = JSON.parse(data) as Record<
                string,
                unknown
              >;
              if (chunk["model"]) {
                model = chunk["model"] as string;
              }
              const usage = chunk["usage"] as
                | Record<string, unknown>
                | undefined;
              if (usage) {
                inputTokens =
                  (usage["prompt_tokens"] as number) ??
                  inputTokens;
                outputTokens =
                  (usage["completion_tokens"] as number) ??
                  outputTokens;
              }
              lastBody = chunk;
            } catch {
              // partial JSON chunk, skip
            }
          }
        }

        controller.close();
        resolveResult({
          body: lastBody,
          inputTokens,
          outputTokens,
          model,
        });
      } catch (err) {
        rejectResult(err);
        controller.error(err);
      }
    },
  });

  return { stream, done };
}
