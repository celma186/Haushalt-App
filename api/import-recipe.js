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
    console.log("Import-Status:", response.status, response.statusText, "URL:", url);

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
        // ungültiges JSON – überspringen
      }
    }

    if (!recipe) {
      res.status(404).json({ error: "Kein strukturiertes Rezept auf dieser Seite gefunden." });
      return;
    }

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
        if (typeof item === "string") steps.push(item);
        else if (item?.itemListElement) steps = steps.concat(flattenInstructions(item.itemListElement));
        else {
          const text = toText(item);
          if (text) steps.push(text);
        }
      }
      return steps;
    };

    /* ---- Zutaten in strukturierte Felder zerlegen (name/product/amount/unit) ---- */

    const QUANTITY_ONLY = /^(\d+([.,\/]\d+)?|etwas|einige|ein paar)\s*(g|kg|ml|l|el|tl|stück|stk|prise[n]?|bund|zehe[n]?|scheibe[n]?|dose[n]?|päckchen|tasse[n]?|zweig[e]?)?\.?$/i;
    const AMOUNT_QUALIFIER_WORDS = /\b(gestr\.?|gestrichen(?:er|e|en)?|gehäuft(?:er|e|en)?|glatt(?:er|e|en)?)\b/gi;
    const APPROX_QUANTITY_PREFIX = /^(etwas|einige|ein paar|nach belieben|nach geschmack)\s+/i;
    const AMOUNT_UNIT_START = /^(\d+(?:[.,\/]\d+)?)\s*(g|kg|ml|l|el|tl|stück|stk|prise[n]?|bund|zehe[n]?|scheibe[n]?|dose[n]?|päckchen|tasse[n]?|zweig[e]?)?\s*\.?\s*/i;

    const UNIT_MAP = {
      el: "EL", tl: "TL", g: "g", kg: "kg", ml: "ml", l: "l",
      stück: "Stück", stk: "Stück", prise: "Stück", prisen: "Stück",
      bund: "Bund", zehe: "Stück", zehen: "Stück",
      scheibe: "Stück", scheiben: "Stück", dose: "Dose", dosen: "Dose",
      päckchen: "Packung", tasse: "Stück", tassen: "Stück",
      zweig: "Stück", zweige: "Stück",
    };

    function parseAmount(raw) {
      const cleaned = raw.replace(",", ".");
      if (cleaned.includes("/")) {
        const [a, b] = cleaned.split("/").map(Number);
        return b ? a / b : Number(a) || 0;
      }
      return Number(cleaned) || 0;
    }

    // "Pfeffer, schwarzer" -> { name: "Pfeffer", product: "schwarzer" }
    function splitNameProduct(text) {
      const cleaned = text.replace(/^[.,]\s*/, "").trim();
      const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return { name: parts[0], product: parts.slice(1).join(", ") };
      }
      return { name: cleaned, product: "" };
    }

    // Baut aus einem rohen Zutaten-Text ein Objekt { name, product, amount, unit }.
    function parseIngredient(raw) {
      let text = (raw || "").trim();
      const notes = [];

      text = text.replace(APPROX_QUANTITY_PREFIX, (m, word) => {
        notes.push(word.trim());
        return "";
      });

      let amount = 0;
      let unit = "Stück";
      const m = text.match(AMOUNT_UNIT_START);
      if (m) {
        amount = parseAmount(m[1]);
        if (m[2]) unit = UNIT_MAP[m[2].toLowerCase()] || m[2];
        text = text.slice(m[0].length);
      }

      text = text.replace(AMOUNT_QUALIFIER_WORDS, (match) => {
        notes.push(match.trim());
        return "";
      });

      text = text.replace(/^[.,]\s*/, "").replace(/\s+/g, " ").trim();

      const { name, product } = splitNameProduct(text);
      const productWithNote = notes.length > 0
        ? `${product ? product + " " : ""}(${notes.join(", ")})`.trim()
        : product;

      return { name: name || text, product: productWithNote, amount, unit };
    }

    // Fügt getrennte Mengen-/Namens-Paare wieder zusammen und baut daraus
    // strukturierte Zutaten-Objekte.
    function buildIngredients(rawList) {
      const result = [];
      for (let i = 0; i < rawList.length; i++) {
        const current = (rawList[i] || "").trim();
        const next = (rawList[i + 1] || "").trim();
        if (!current) continue;

        let combinedText;
        if (QUANTITY_ONLY.test(current) && next && !QUANTITY_ONLY.test(next)) {
          combinedText = `${current} ${next}`;
          i++;
        } else if (!QUANTITY_ONLY.test(current) && next && QUANTITY_ONLY.test(next)) {
          combinedText = `${next} ${current}`;
          i++;
        } else {
          combinedText = current;
        }
        result.push(parseIngredient(combinedText));
      }
      return result;
    }

    const ingredients = buildIngredients(
      (recipe.recipeIngredient || []).map((i) => (typeof i === "string" ? i : toText(i)))
    );

    const result = {
      title: recipe.name || "",
      description: recipe.description || "",
      image: typeof recipe.image === "string" ? recipe.image : recipe.image?.url || recipe.image?.[0] || "",
      servings: recipe.recipeYield || "",
      ingredients: ingredients,
      steps: flattenInstructions(recipe.recipeInstructions),
    };

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: "Unerwarteter Fehler: " + err.message });
  }
}
