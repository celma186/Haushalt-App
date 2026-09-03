// ---------------------------------------------------------------------
// TEXT-PARSER: Zerlegt eingefügten/erkannten Rezepttext automatisch in
// Titel, Zutaten und Zubereitungsschritte. Arbeitet rein mit Mustern
// (keine KI) – Ergebnis ist eine gute erste Vorlage, die der Nutzer im
// Formular danach noch von Hand korrigieren kann.
// ---------------------------------------------------------------------

// Erkennt typische Zutaten-Zeilen: beginnt mit einer Zahl/Bruch + evtl.
// Einheit (g, kg, ml, l, EL, TL, Stück, Prise, Bund, ...), oder mit
// einem Aufzählungszeichen (-, •, *).
const INGREDIENT_PATTERN = /^(\s*[-•*]\s*)?(\d+([.,\/]\d+)?\s*(g|kg|ml|l|el|tl|stück|stk|prise[n]?|bund|zehe[n]?|scheibe[n]?|dose[n]?|päckchen|tasse[n]?|zweig[e]?)?\b)/i;

const SECTION_HEADINGS = {
  ingredients: /^(zutaten|ingredients)\s*:?\s*$/i,
  instructions: /^(zubereitung|anleitung|schritte|instructions|directions)\s*:?\s*$/i,
};

export function parseRecipeText(rawText) {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { title: "", ingredients: [], instructions: [] };
  }

  // Titel: erste Zeile, falls sie kurz genug ist und keine Zutat/Überschrift ist
  let title = "";
  let startIndex = 0;
  if (
    lines[0].length <= 80 &&
    !INGREDIENT_PATTERN.test(lines[0]) &&
    !SECTION_HEADINGS.ingredients.test(lines[0]) &&
    !SECTION_HEADINGS.instructions.test(lines[0])
  ) {
    title = lines[0];
    startIndex = 1;
  }

  const rest = lines.slice(startIndex);

  // Variante A: Es gibt explizite Überschriften "Zutaten" / "Zubereitung"
  const ingredientsHeadingIndex = rest.findIndex((l) => SECTION_HEADINGS.ingredients.test(l));
  const instructionsHeadingIndex = rest.findIndex((l) => SECTION_HEADINGS.instructions.test(l));

  if (ingredientsHeadingIndex !== -1 || instructionsHeadingIndex !== -1) {
    const ingStart = ingredientsHeadingIndex !== -1 ? ingredientsHeadingIndex + 1 : 0;
    const ingEnd = instructionsHeadingIndex !== -1 ? instructionsHeadingIndex : rest.length;
    const insStart = instructionsHeadingIndex !== -1 ? instructionsHeadingIndex + 1 : rest.length;

    const ingredients = rest
      .slice(ingStart, ingEnd)
      .map((l) => l.replace(/^[-•*]\s*/, ""))
      .filter(Boolean);

    const instructions = rest
      .slice(insStart)
      .map((l) => l.replace(/^\d+[.)]\s*/, "").replace(/^[-•*]\s*/, ""))
      .filter(Boolean);

    return { title, ingredients, instructions };
  }

  // Variante B: keine Überschriften – jede Zeile per Muster zuordnen
  const ingredients = [];
  const instructions = [];

  for (const line of rest) {
    if (INGREDIENT_PATTERN.test(line)) {
      ingredients.push(line.replace(/^[-•*]\s*/, ""));
    } else {
      instructions.push(line.replace(/^\d+[.)]\s*/, "").replace(/^[-•*]\s*/, ""));
    }
  }

  return { title, ingredients, instructions };
}

// Zerlegt eine einzelne Zutaten-Zeile (z.B. "350 g Spaghetti") in
// Menge, Einheit und Name – für die automatische Übernahme ins Formular.
const UNIT_ALIASES = {
  g: "g", kg: "kg", ml: "ml", l: "l",
  el: "EL", tl: "TL",
  "stück": "Stück", stk: "Stück",
  prise: "Prise", prisen: "Prise",
  bund: "Bund",
  zehe: "Zehe", zehen: "Zehe",
  scheibe: "Scheibe", scheiben: "Scheibe",
  dose: "Dose", dosen: "Dose",
  "päckchen": "Päckchen",
  tasse: "Tasse", tassen: "Tasse",
};

export function parseIngredientLine(line) {
  const cleaned = line.trim();
  const match = cleaned.match(/^(\d+([.,\/]\d+)?)\s*([a-zäöüß]+)?\.?\s*(.*)$/i);

  if (!match) return { name: cleaned, product: "", amount: "", unit: "Stück" };

  const [, amountRaw, , unitRaw, rest] = match;
  const amount = amountRaw.replace(",", ".");
  const unitKey = (unitRaw || "").toLowerCase();
  const unit = UNIT_ALIASES[unitKey] || "Stück";
  const name = unitRaw && UNIT_ALIASES[unitKey] ? rest.trim() : `${unitRaw || ""} ${rest}`.trim();

  return { name: name || cleaned, product: "", amount, unit };
}
