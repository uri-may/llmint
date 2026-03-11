import { createServer, type Server } from "node:http";

const NON_STREAMING_RESPONSE = {
  id: "chatcmpl-mock-001",
  object: "chat.completion",
  created: 1700000000,
  model: "gpt-4",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello! How can I help you?" },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 8,
    total_tokens: 18,
  },
};

function buildStreamChunks(): string[] {
  return [
    `data: ${JSON.stringify({
      id: "chatcmpl-mock-002",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "gpt-4",
      choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: "chatcmpl-mock-002",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "gpt-4",
      choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: "chatcmpl-mock-002",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "gpt-4",
      choices: [{ index: 0, delta: { content: "!" }, finish_reason: "stop" }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: "chatcmpl-mock-002",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "gpt-4",
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    })}\n\n`,
    "data: [DONE]\n\n",
  ];
}

export function startMockProvider(port: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url !== "/chat/completions" || req.method !== "POST") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        const parsed = JSON.parse(body) as Record<string, unknown>;

        if (parsed["stream"] === true) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });

          const chunks = buildStreamChunks();
          let i = 0;
          const send = () => {
            if (i < chunks.length) {
              res.write(chunks[i]);
              i++;
              setTimeout(send, 10);
            } else {
              res.end();
            }
          };
          send();
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(NON_STREAMING_RESPONSE));
        }
      });
    });

    server.listen(port, () => {
      resolve(server);
    });
  });
}
