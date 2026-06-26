// POST /api/chat — Cloudflare Pages Function proxy for OpenRouter API
// Routes browser requests to OpenRouter from the server-side to avoid CORS/CSP/ad-blocker issues

export async function onRequestPost(context) {
  const { request } = context;

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  try {
    const body = await request.json();
    const { apiKey, model, messages } = body;

    if (!apiKey || !model || !messages) {
      return new Response(
        JSON.stringify({ error: 'Missing "apiKey", "model", or "messages" in request body' }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }

    // Forward the request to OpenRouter
    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": request.headers.get("origin") || "https://eyeglass.fit",
        "X-Title": "3D Eyewear Studio"
      },
      body: JSON.stringify({ model, messages })
    });

    const data = await openRouterRes.json();

    if (!openRouterRes.ok) {
      console.error("[api/chat] OpenRouter error:", openRouterRes.status, JSON.stringify(data).slice(0, 500));
      return new Response(
        JSON.stringify({
          error: data.error?.message || `OpenRouter returned status ${openRouterRes.status}`,
          detail: data
        }),
        {
          status: openRouterRes.status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }

    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (err) {
    console.error("[api/chat] Proxy error:", err.message);
    return new Response(
      JSON.stringify({ error: "Failed to reach OpenRouter API. Please try again." }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
}