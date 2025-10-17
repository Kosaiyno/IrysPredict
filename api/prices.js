// /api/prices.js
export const config = { runtime: "edge" };

// /api/prices?ids=bitcoin,ethereum
export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const ids = searchParams.get("ids") || "";
    if (!ids) {
      return new Response(JSON.stringify({ error: "missing ids" }), {
        status: 400, headers: { "content-type": "application/json" }
      });
    }

    const url = `https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&include_24hr_change=true&ids=${encodeURIComponent(ids)}`;

    const once = () => fetch(url, {
      headers: {
        "accept": "application/json",
        "user-agent": "IrysPredict/1.0 (+https://iryspredict.xyz)"
      },
      next: { revalidate: 15 } // let edge cache a bit, reduces 429s
    });

    let res = await once();
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 700 + Math.random()*300));
      res = await once();
    }

    const text = await res.text();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `coingecko ${res.status}`, body: text }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    }

    return new Response(text, {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=10, s-maxage=15, stale-while-revalidate=30"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }
}
