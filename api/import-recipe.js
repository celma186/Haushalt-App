export default async function handler(req, res) {
  const url = req.query.url;
  if (!url) {
    res.status(400).json({ error: "Keine URL angegeben." });
    return;
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        "Referer": "https://www.google.com/",
      },
    });

    if (!response.ok) {
      res.status(502).json({ error: `Seite hat mit Status ${response.status} geantwortet – vermutlich blockiert.` });
      return;
    }

    const html = await response.text();
    const matches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

    let recipe = null;
    let allNodes = [];

    for (const match of matches) {
      try {
        let data = JSON.parse(match[1].trim());
        const candidates = Array.isArray(data) ? data : data["@graph"] || [data];
        allNodes = allNodes.concat(candidates);
        const found = candidates.find((item) => {
          const type = item["@type"];
          return type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"));
        });
        if (found && !recipe) recipe = found;
      } catch {
        // dieses Script-Tag war kein gültiges JSON – überspringen
      }
    }

    if (!recipe) {
      res.status(404).json({ error: "Kein strukturiertes Rezept auf dieser Seite gefunden." });
      return;
    }

    const resolveRef = (val) => {
      if (!val) return null;
      if (typeof val === "string") return val;
      if (val["@id"] && !val.url) {
        const target = allNodes.find((n) => n["@id"] === val["@id"]);
        return target || val;
      }
      return val;
    };

    const toText = (val) => {
      if (!val) return "";
      if (typeof val === "string") return val;
      if (val.text) return val.text;
      return "";
    };

    const flattenInstructions = (raw) => {
      if (!raw) return [];
      const list = Array.isArray(raw) ? raw : [raw];
      let steps = [];
      for (const item of list) {
        if (typeof item === "string") {
          steps.push(item);
        } else if (item?.itemListElement) {
          steps = steps.concat(flattenInstructions(item.itemListElement));
        } else {
          const text = toText(item);
          if (text) steps.push(text);
        }
      }
      return steps;
    };

    // Erkennt Einträge, die NUR aus einer Mengenangabe bestehen (z.B. "1 TL",
    // "etwas", "1 Stück") – ohne Zutatenname. Solche Einträge liefert Chefkoch
    // manchmal getrennt von der zugehörigen Zutat als eigenen Listeneintrag.
    const QUANTITY_ONLY = /^(\d+([.,\/]\d+)?|etwas|einige|ein paar)\s*(g|kg|ml|l|el|tl|stück|stk|prise[n]?|bund|zehe[n]?|scheibe[n]?|dose[n]?|päckchen|tasse[n]?|zweig[e]?)?\.?$/i;

    // Fügt versehentlich getrennte Mengen-/Namens-Paare wieder zusammen,
    // egal in welcher Reihenfolge sie geliefert wurden.
      // Wörter, die nur beschreiben, WIE die Menge gemeint ist (z.B. "1
// gestrichener TL"), aber durch einen Chefkoch-Datenfehler fälschlich
// vorne im Zutatennamen landen. Werden komplett entfernt.
const AMOUNT_QUALIFIER_WORDS = /\b(gestr\.?|gestrichen(er|e|en)?|gehäuft(er|e|en)?|glatt(er|e|en)?)\b/gi;

// Wörter, die eine ungefähre Menge ausdrücken (z.B. "etwas Salz"), statt
// einer echten Zahl. Werden vom Namen entfernt, damit z.B. "etwas
// Kümmelpulver" als einfach "Kümmelpulver" erkannt wird.
const APPROX_QUANTITY_PREFIX = /^(etwas|einige|ein paar|nach belieben|nach geschmack)\s+/i;

// Räumt einen einzelnen Zutatennamen auf: entfernt verrutschte Kommas
// am Anfang sowie Mengen-Wörter wie "gestr." oder "etwas".
function cleanIngredientName(text) {
  return text
    .replace(/^,\s*/, "")
    .replace(AMOUNT_QUALIFIER_WORDS, "")
    .replace(APPROX_QUANTITY_PREFIX, "")
    .replace(/\s+/g, " ")
    .replace(/^,\s*/, "")
    .trim();
}

function cleanupIngredientList(rawList) {
  const cleaned = [];
  for (let i = 0; i < rawList.length; i++) {
    const current = (rawList[i] || "").trim();
    const next = (rawList[i + 1] || "").trim();
    if (!current) continue;

    let combined;
    if (QUANTITY_ONLY.test(current) && next && !QUANTITY_ONLY.test(next)) {
      combined = `${current} ${cleanIngredientName(next)}`;
      i++;
    } else if (!QUANTITY_ONLY.test(current) && next && QUANTITY_ONLY.test(next)) {
      combined = `${next} ${cleanIngredientName(current)}`;
      i++;
    } else {
      combined = cleanIngredientName(current);
    }
    cleaned.push(combined.replace(/\s+/g, " ").trim());
  }
  return cleaned;
}
