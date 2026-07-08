export async function onRequest(context) {
    const url = new URL(context.request.url);
    const target = url.searchParams.get("url");

    if (!target) {
        return new Response("Missing url", { status: 400 });
    }

    const headers = { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" };

    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        // POST avoids GET URL length limits (TinyURL rejects very long query strings)
        const res = await fetch("https://tinyurl.com/api-create.php", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `url=${encodeURIComponent(target)}`,
            signal: ctrl.signal
        });
        clearTimeout(timer);
        const short = (await res.text()).trim();
        if (short.startsWith("http")) {
            return new Response(short, { headers });
        }
        throw new Error("Bad response");
    } catch (e) {
        return new Response("", { status: 502, headers });
    }
}
