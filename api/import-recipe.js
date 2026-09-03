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

    for (const match of matches) {
      try {
        let data = JSON.parse(match[1].trim());
        const candidates = Array.isArray(data) ? data : data["@graph"] || [data];
        const found = candidates.find((item) => {
          const type = item["@type"];
          return type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"));
        });
        if (found) { recipe = found; break; }
      } catch {
        // dieses Script-Tag war kein gültiges JSON – überspringen
      }
    }

    if (!recipe) {
      res.status(404).json({ error: "Kein strukturiertes Rezept auf dieser Seite gefunden.", htmlLength: html.length });
      return;
    }

    const toText = (val) => {
      if (!val) return "";
      if (typeof val === "string") return val;
      if (val.text) return val.text;
      return "";
    };

    const ingredients = recipe.recipeIngredient || recipe.ingredients || [];
    const instructionsRaw = recipe.recipeInstructions || [];
    const instructions = Array.isArray(instructionsRaw)
      ? instructionsRaw.map(toText).filter(Boolean)
      : [toText(instructionsRaw)].filter(Boolean);

    res.status(200).json({
      title: recipe.name || "",
      ingredients,
      instructions,
      image: Array.isArray(recipe.image) ? recipe.image[0] : (recipe.image?.url || recipe.image || ""),
      servings: recipe.recipeYield || "",
    });
  } catch (err) {
    res.status(500).json({ error: "Seite konnte nicht abgerufen werden.", detail: String(err) });
  }
}
