export const runtime = "nodejs";

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function logout({ host, sessionId }) {
  const url = `${host}/ws/0.3/logout`;
  await fetch(url, {
    method: "POST",
    headers: {
      Cookie: `PHPSESSID=${sessionId}`
    }
  });
}

async function login({ host, username, password }) {
  const url = `${host}/ws/0.3/login`;

  const body = new URLSearchParams({
    _username: username,
    _password: password
  }).toString();

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const text = await response.text();

  if (text === "Invalid credentials.") {
    throw new Error("Invalid credentials");
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Unexpected login response: " + text);
  }

  if (!json.sessionId) {
    throw new Error("No sessionId returned by login WS");
  }

  return json.sessionId;
}

async function getBasket({ host, sessionId, basketCode }) {
  const url = `${host}/ws/0.4/basket/get/${encodeURIComponent(basketCode)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `PHPSESSID=${sessionId}`
    }
  });

  const contentType = response.headers.get("content-type");
  const data = contentType?.includes("application/json")
    ? await response.json()
    : await response.text();

  return data;
}

async function postToMake(makeWebhookUrl, payload) {
  const res = await fetch(makeWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  return { ok: res.ok, status: res.status, responseText: text };
}

function getClientIp(req) {
  // Vercel / proxies
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  );
}

/**
 * GET /api/ingest?basketCode=XXXX&key=OPTIONNEL
 * -> récupère basket via Emersya puis envoie à Make.
 */
export async function GET(req) {
  const host = process.env.EMERSYA_HOST || "https://testws.emersya.com";
  const username = mustGetEnv("EMERSYA_USERNAME");
  const password = mustGetEnv("EMERSYA_PASSWORD");
  const makeWebhookUrl = mustGetEnv("MAKE_WEBHOOK_URL");

  const { searchParams } = new URL(req.url);
  const basketCode = searchParams.get("basketCode");
  const providedKey = searchParams.get("key");
  const expectedKey = process.env.INGEST_KEY;

  if (expectedKey && providedKey !== expectedKey) {
    return Response.json(
      { ok: false, error: "Unauthorized (bad key)" },
      { status: 401 }
    );
  }

  if (!basketCode) {
    return Response.json(
      { ok: false, error: "Missing basketCode" },
      { status: 400 }
    );
  }

  let sessionId;

  try {
    sessionId = await login({ host, username, password });

    const result = await getBasket({ host, sessionId, basketCode });

    const basket = result?.resultSet?.data?.[0] ?? null;
    const metaData = basket?.metaData ?? null;

    const payload = {
      source: "emersya",
      receivedAt: new Date().toISOString(),
      basketCode,
      clientIp: getClientIp(req),
      emersya: {
        raw: result,
        basket,
        metaData,
        mondayId: metaData?.mondayId ?? null
      }
    };

    const makeRes = await postToMake(makeWebhookUrl, payload);

    return Response.json({
      ok: true,
      basketFound: !!basket,
      mondayId: metaData?.mondayId ?? null,
      make: makeRes
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  } finally {
    if (sessionId) {
      try {
        await logout({ host, sessionId });
      } catch {
        // on ignore l'erreur de logout
      }
    }
  }
}