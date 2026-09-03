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

    // Hilfsfunktion: löst @id-Verweise auf, indem sie im gesamten Datensatz nachschaut
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

    // Zubereitungsschritte einsammeln – auch aus verschachtelten "Abschnitten" (HowToSection)
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

    const ingredients = recipe.recipeIngredient || recipe.ingredients || [];
    const instructions = flattenInstructions(recipe.recipeInstructions);

    let image = recipe.image;
    image = resolveRef(image);
    if (Array.isArray(image)) image = image[0];
    if (image && typeof image === "object") image = image.url || image.contentUrl || "";
    if (typeof image !== "string") image = "";

    let servings = recipe.recipeYield || "";
    if (Array.isArray(servings)) servings = servings[servings.length - 1] || "";

    res.status(200).json({
      title: recipe.name || "",
      ingredients,
      instructions,
      image,
      servings,
    });
  } catch (err) {
    res.status(500).json({ error: "Seite konnte nicht abgerufen werden.", detail: String(err) });
  }
}
