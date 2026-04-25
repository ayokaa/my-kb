export async function POST(req: Request) {
  const { messages } = await req.json();
  const lastMessage = messages.at(-1)?.content || '';

  const mockResponse = `收到你的问题："${lastMessage}"

这是 Mock 回答，用于验证流式输出是否正常工作。

实际接入时，这里会是 Agent 基于知识库检索后的推理结果。`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      for (const char of mockResponse) {
        controller.enqueue(encoder.encode(`0:${JSON.stringify(char)}\n`));
        await new Promise((r) => setTimeout(r, 20));
      }

      controller.enqueue(encoder.encode('d:{"finishReason":"stop"}\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
