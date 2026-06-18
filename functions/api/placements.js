// GET /api/placements
export async function onRequestGet(context) {
  const { env } = context;
  if (!env.PLACEMENTS_KV) {
    return new Response(JSON.stringify({ error: "KV Namespace PLACEMENTS_KV not bound" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const list = await env.PLACEMENTS_KV.list();
  const obj = {};
  for (const key of list.keys) {
    const val = await env.PLACEMENTS_KV.get(key.name);
    if (val) {
      obj[key.name] = JSON.parse(val);
    }
  }

  return new Response(JSON.stringify(obj), {
    headers: { 
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

// POST /api/placements
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.PLACEMENTS_KV) {
    return new Response(JSON.stringify({ error: "KV Namespace PLACEMENTS_KV not bound" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const { key, config } = await request.json();
    if (!key || !config) {
      return new Response(JSON.stringify({ error: "Missing key or config" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    await env.PLACEMENTS_KV.put(key, JSON.stringify(config));
    return new Response(JSON.stringify({ success: true, key }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
