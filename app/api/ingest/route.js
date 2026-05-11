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

// ─── Réserve ─────────────────────────────────────────────────────────────────
/**
 * Cherche récursivement la première part dont le title correspond à `titleTarget`
 * (comparaison insensible à la casse).
 */
function findPartByTitle(parts = [], titleTarget) {
  for (const part of parts) {
    if (part.title?.toLowerCase() === titleTarget.toLowerCase()) return part;
    if (Array.isArray(part.parts) && part.parts.length > 0) {
      const found = findPartByTitle(part.parts, titleTarget);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Extrait la première valeur numérique trouvée dans une chaîne.
 * Ex: "20 m2" → 20 | "25.5" → 25.5 | null si non trouvée.
 */
function parseM2(raw) {
  if (raw == null) return null;
  const match = String(raw).match(/[\d]+(?:[.,]\d+)?/);
  if (!match) return null;
  return parseFloat(match[0].replace(",", "."));
}

/**
 * Calcule la surface (width × depth) depuis les sous-parts de "Dimensions".
 * Retourne null si les valeurs sont absentes ou non numériques.
 */
function getSurface(replayRawParts) {
  const dimensionsPart = findPartByTitle(replayRawParts, "dimensions");
  const dimParts = dimensionsPart?.parts ?? [];

  const width = parseFloat(findPartByTitle(dimParts, "width")?.reference?.value ?? NaN);
  const depth = parseFloat(findPartByTitle(dimParts, "depth")?.reference?.value ?? NaN);

  if (isNaN(width) || isNaN(depth)) return null;
  return width * depth;
}

function computeReserve(replayRawParts) {
  // 1. Le champ "Storage" doit exister, sinon pas de réserve
  const storagePart = findPartByTitle(replayRawParts, "storage");
  if (!storagePart) return "pas de réserve";

  // 2. Surface = width × depth, puis règles de réserve
  const m2 = getSurface(replayRawParts);
  if (m2 === null) return "pas de réserve";

  if (m2 >= 36) return "3m2";
  if (m2 >= 26) return "2m2";
  if (m2 >= 12) return "1m2";
  return "pas de réserve"; // 9 à 11 m2
}

function buildEnseigneReserve(replayRawParts) {
  const reserve = computeReserve(replayRawParts);
  if (reserve === "pas de réserve") return null;

  const m2 = getSurface(replayRawParts);
  if (m2 === null || m2 <= 25) return null;

  return "1000x1000";
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Lot AMCO ────────────────────────────────────────────────────────────────
const AMCO_PART_NAMES = new Set([
  "BORNE ECRAN 46'' TACTILE",
  "CAISSON NUMERIQUE AVEC DALLES LED _H",
  "CAISSON NUMERIQUE AVEC DALLES LED",
  "COMPTOIR NUMERIQUE AVEC DALLES LED",
  "TRIPLETTE.003",
  "POIDUM BLANC 50x50x50cm HT",
  "POIDUM BLANC 50x50x75cm HT",
  "POIDUM BLANC 50x50x100cm HT",
  "POIDUM NOIR 50x50x50cm HT",
  "POIDUM NOIR 50x50x75cm HT",
  "POIDUM NOIR 50x50x100cm HT",
  "MEUBLE BAS DE RANGEMENT",
  "TV 32''.fbx",
  "TV 43''.fbx",
  "TV 55''.fbx",
  "TV 65''.fbx",
  "ENSEIGNE HAUTE 1x1x1m HT.fbx",
  "ENSEIGNE HAUTE 2x2x1m HT.fbx"
]);

/**
 * Parcourt récursivement toutes les parts (et sous-parts) et retourne
 * celles dont le `name` appartient au lot AMCO.
 */
function collectAmcoParts(parts = []) {
  const found = [];
  for (const part of parts) {
    if (part.name && AMCO_PART_NAMES.has(part.title)) {
      found.push(part);
    }
    if (Array.isArray(part.parts) && part.parts.length > 0) {
      found.push(...collectAmcoParts(part.parts));
    }
  }
  return found;
}

function buildAmcoLot(replayRawParts) {
  const amcoParts = collectAmcoParts(replayRawParts);

  const lotNames = amcoParts
    .map(p => p.name)
    .filter(Boolean)
    .join(" - ");

  const priceAmco = amcoParts.reduce((sum, p) => {
    const price = p.computedPrice?.inclTax ?? 0;
    return sum + (typeof price === "number" ? price : 0);
  }, 0);

  return {
    "Lot AMCO": lotNames || null,
    "Price AMCO": priceAmco
  };
}
// ─────────────────────────────────────────────────────────────────────────────

function cleanReplayPart(part) {
  const opt = part.currentOption ?? null;
  const subParts = Array.isArray(part.parts) && part.parts.length > 0
    ? part.parts.map(cleanReplayPart)
    : undefined;

  return {
    name: part.name ?? null,
    title: part.title ?? null,
    reference: part.reference?.value ?? part.reference ?? null,
    computedPriceInclTax: part.computedPrice?.inclTax ?? null,
    currentOption: opt
      ? {
          name: opt.name ?? null,
          title: opt.title ?? null,
          reference: opt.reference?.value ?? null,
          priceInclTax: opt.price?.inclTax ?? null
        }
      : null,
    ...(subParts ? { parts: subParts } : {})
  };
}

function optRef(opt) {
  return opt?.reference?.value ?? opt?.reference ?? null;
}

function buildMoquette(replayRawParts) {
  const floorPart = findPartByTitle(replayRawParts, "floor");
  const opt = floorPart?.currentOption ?? null;
  if (!opt) return null;
  return `${opt.title} - ${optRef(opt)}`;
}

function buildEmpreinte(replayRawParts) {
  const personalizationPart = findPartByTitle(replayRawParts, "personalization");
  const opt = personalizationPart?.currentOption ?? null;
  if (!opt) return null;
  return `${opt.title} - ${optRef(opt)}`;
}

function buildCotonCloison(replayRawParts) {
  const wallPart = findPartByTitle(replayRawParts, "wall");
  const opt = wallPart?.currentOption ?? null;
  if (!opt) return null;
  return `${opt.title} - ${optRef(opt)}`;
}

function buildComptoir(replayRawParts) {
  const counterPart = findPartByTitle(replayRawParts, "counter");
  const opt = counterPart?.currentOption ?? null;
  if (!opt) return null;
  return `${opt.title} - ${optRef(opt)}`;
}

function buildPlante(replayRawParts) {
  function hasTitle(parts) {
    for (const part of parts) {
      if (part.title?.toLowerCase().includes("plante")) return true;
      if (Array.isArray(part.parts) && hasTitle(part.parts)) return true;
    }
    return false;
  }
  return hasTitle(replayRawParts) ? "OUI" : "PAS BESOIN";
}

const MOBILIER_STANDING_NAMES = new Set([
  "TABOURET_SIAE",
  "TABLE_HAUTE",
  "PORTE_DOCUMENTS",
  "CORBEILLE"
]);

function buildMobilierStanding(replayRawParts) {
  function hasAny(parts) {
    for (const part of parts) {
      const matchesPrefix = part.name && MOBILIER_EXT_PREFIXES.some(p => part.name.startsWith(p));
      const priceIsZero = (part.computedPrice?.inclTax ?? 0) === 0;
      if (matchesPrefix && priceIsZero) return true;
      if (Array.isArray(part.parts) && hasAny(part.parts)) return true;
    }
    return false;
  }
  return hasAny(replayRawParts) ? "OUI" : "PAS BESOIN";
}

const MOBILIER_EXT_PREFIXES = [
  "TABLE_HAUTE",
  "TABOURET_SIAE",
  "PORTE_DOCUMENTS",
  "CORBEILLE"
];

function buildMobilierExt(replayRawParts) {
  function hasAny(parts) {
    for (const part of parts) {
      const matchesPrefix = part.name && MOBILIER_EXT_PREFIXES.some(p => part.name.startsWith(p));
      const hasPrice = (part.computedPrice?.inclTax ?? 0) > 0;
      if (matchesPrefix && hasPrice) return true;
      if (Array.isArray(part.parts) && hasAny(part.parts)) return true;
    }
    return false;
  }
  return hasAny(replayRawParts) ? "OUI" : "PAS BESOIN";
}

function buildCleanPayload({ basket }) {
  const meta = basket?.metaData ?? {};
  const replayRawParts = meta?.replay?.basket?.products?.[0]?.parts ?? [];
  const companyName = meta?.replay?.basket?.billingContact?.companyName ?? null;

  return {
    mondayId: meta.mondayId ?? null,
    companyName,
    customInstructions: meta.customInstructions ?? null,
    storeLocation: {
      salon: meta.storeLocation?.salon ?? null,
      location: meta.storeLocation?.location ?? null
    },
    parts: replayRawParts.map(cleanReplayPart),
    ...buildAmcoLot(replayRawParts),
    réserve: computeReserve(replayRawParts),
    "enseigne reserve": buildEnseigneReserve(replayRawParts),
    moquette: buildMoquette(replayRawParts),
    empreinte: buildEmpreinte(replayRawParts),
    "coton cloison": buildCotonCloison(replayRawParts),
    comptoir: buildComptoir(replayRawParts),
    "tete de cloison": companyName,
    plante: buildPlante(replayRawParts),
    "MOBILIER STAND-ING": buildMobilierStanding(replayRawParts),
    "MOBILIER EXT": buildMobilierExt(replayRawParts)
  };
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
    const mondayId = basket?.metaData?.mondayId ?? null;

    const payload = buildCleanPayload({ basket });

    const makeRes = await postToMake(makeWebhookUrl, payload);

    return Response.json({
      ok: true,
      basketFound: !!basket,
      mondayId,
      make: makeRes,
      payload
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