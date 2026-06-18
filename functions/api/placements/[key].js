// GET /api/placements/:key
export async function onRequestGet(context) {
  const { env, params } = context;
  const key = params.key;
  if (!env.PLACEMENTS_KV) {
    return new Response(JSON.stringify({ error: "KV Namespace PLACEMENTS_KV not bound" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const val = await env.PLACEMENTS_KV.get(key);
  if (val) {
    return new Response(val, {
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

  return new Response(JSON.stringify({ error: "Placement not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" }
  });
}

// DELETE /api/placements/:key
export async function onRequestDelete(context) {
  const { env, params } = context;
  const key = params.key;
  if (!env.PLACEMENTS_KV) {
    return new Response(JSON.stringify({ error: "KV Namespace PLACEMENTS_KV not bound" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  await env.PLACEMENTS_KV.delete(key);
  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" }
  });
}
