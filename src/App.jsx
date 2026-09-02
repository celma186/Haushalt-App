import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

/* ---------------------------------------------------------------------- */
/* KONSTANTEN                                                              */
/* ---------------------------------------------------------------------- */

// Eine feste Zeile in der Tabelle "household_state" wird von euch beiden geteilt.
// Ändere diese ID, falls ihr mehrere getrennte Haushalte in derselben Tabelle
// verwalten wollt (z.B. pro Paar eine eigene ID).
const HOUSEHOLD_ID = "shared";
const TABLE = "household_state";

/* ---------------------------------------------------------------------- */
/* SUPABASE-CLIENT                                                         */
/* URL und Key kommen aus Umgebungsvariablen (siehe .env.example).         */
/* Vite ersetzt import.meta.env.VITE_* beim Build durch die echten Werte.  */
/* ---------------------------------------------------------------------- */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    "Supabase-Konfiguration fehlt. Bitte VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY setzen (.env Datei bzw. Vercel-Umgebungsvariablen)."
  );
}

const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");

/* ---------------------------------------------------------------------- */
/* SPEICHER-ADAPTER (SUPABASE)                                             */
/* Speichert den gesamten App-Zustand als ein JSON-Objekt in einer Zeile.  */
/* Realtime-Updates werden separat über useSharedState() verteilt.         */
/* ---------------------------------------------------------------------- */

const storageAdapter = {
  async get() {
    const { data, error } = await supabase
      .from(TABLE)
      .select("data")
      .eq("id", HOUSEHOLD_ID)
      .maybeSingle();
    if (error || !data) return null;
    return { value: JSON.stringify(data.data) };
  },
  async set(_key, value) {
    const parsed = JSON.parse(value);
    const { error } = await supabase
      .from(TABLE)
      .upsert({ id: HOUSEHOLD_ID, data: parsed, updated_at: new Date().toISOString() });
    if (error) throw error;
    return { value };
  },
};

const TASK_CATEGORIES = [
  { id: "putzen", label: "Putzen", icon: "🧹", color: "#C99A3E" },
  { id: "waesche", label: "Wäsche", icon: "🧺", color: "#8FA0B3" },
  { id: "einkaufen", label: "Einkaufen", icon: "🛒", color: "#D98B98" },
  { id: "sonstiges", label: "Sonstiges", icon: "📝", color: "#A6957F" },
];

const RECURRENCE_OPTIONS = [
  { id: "none", label: "Einmalig" },
  { id: "daily", label: "Täglich" },
  { id: "every2days", label: "Alle 2 Tage" },
  { id: "weekly", label: "Wöchentlich" },
  { id: "biweekly", label: "Alle 2 Wochen" },
  { id: "monthly", label: "Monatlich" },
  { id: "every3months", label: "Alle 3 Monate" },
  { id: "yearly", label: "Jährlich" },
  { id: "weekday", label: "An bestimmtem Wochentag" },
];

const PRIORITIES = [
  { id: "high", label: "Hoch", icon: "🔴" },
  { id: "medium", label: "Mittel", icon: "🟡" },
  { id: "low", label: "Niedrig", icon: "🟢" },
];

const SHOPPING_CATEGORIES = [
  { id: "obst-gemuese", label: "Obst & Gemüse", icon: "🥬" },
  { id: "fleisch-fisch", label: "Fleisch & Fisch", icon: "🥩" },
  { id: "milchprodukte", label: "Milchprodukte", icon: "🥛" },
  { id: "vorraete", label: "Vorräte", icon: "🥫" },
  { id: "backwaren", label: "Backwaren", icon: "🥖" },
  { id: "tiefkuehl", label: "Tiefkühl", icon: "🧊" },
  { id: "haushalt", label: "Haushalt", icon: "🧴" },
  { id: "reinigung", label: "Reinigung", icon: "🧼" },
  { id: "hygiene", label: "Hygiene", icon: "🧴" },
  { id: "snacks", label: "Snacks", icon: "🍫" },
  { id: "sonstiges", label: "Sonstiges", icon: "🛍️" },
];

const INVENTORY_LOCATIONS = [
  { id: "fridge", label: "Kühlschrank", icon: "🧊" },
  { id: "freezer", label: "Gefrierschrank", icon: "❄️" },
  { id: "pantry", label: "Vorratsschrank", icon: "🥫" },
];

/* ---------------------------------------------------------------------- */
/* BARCODE-SCAN: Kategorie- & Haltbarkeits-Zuordnung                       */
/* Ordnet einem per Barcode gefundenen Produkt (Open Food Facts) eine      */
/* interne Warengruppe zu und schlägt anhand dieser Gruppe eine grobe      */
/* Haltbarkeit vor. Reine Schätzwerte – das aufgedruckte MHD auf der       */
/* Verpackung hat immer Vorrang und der Wert bleibt jederzeit editierbar.  */
/* ---------------------------------------------------------------------- */

// Grobe Haltbarkeit in Tagen ab heute, je interner Warengruppe.
// null = keine Ablaufdatum-Vorschlag (z.B. Haushaltsartikel).
const CATEGORY_SHELF_LIFE_DAYS = {
  "obst-gemuese": 6,
  "fleisch-fisch": 3,
  "milchprodukte": 7,
  "vorraete": 270,
  "backwaren": 5,
  "tiefkuehl": 240,
  "haushalt": null,
  "reinigung": null,
  "hygiene": null,
  "snacks": 90,
  "sonstiges": 14,
};

// Naheliegender Lagerort je Warengruppe, nur als Vorschlag – frei änderbar.
const LOCATION_BY_CATEGORY = {
  "obst-gemuese": "fridge",
  "fleisch-fisch": "fridge",
  "milchprodukte": "fridge",
  "backwaren": "pantry",
  "vorraete": "pantry",
  "haushalt": "pantry",
  "reinigung": "pantry",
  "hygiene": "pantry",
  "snacks": "pantry",
  "tiefkuehl": "freezer",
  "sonstiges": "pantry",
};

// Schlüsselwörter aus den Open-Food-Facts-Kategorie-Tags (Englisch, z.B.
// "en:dairies"), die auf unsere internen Warengruppen gemappt werden.
// Reihenfolge zählt: der erste Treffer gewinnt.
const OFF_CATEGORY_KEYWORDS = [
  { keywords: ["frozen"], category: "tiefkuehl" },
  { keywords: ["dairies", "milk", "cheese", "yogurt", "yoghurt", "cream", "butter"], category: "milchprodukte" },
  { keywords: ["meat", "poultry", "sausage", "fish", "seafood"], category: "fleisch-fisch" },
  { keywords: ["fruit", "vegetable", "salad"], category: "obst-gemuese" },
  { keywords: ["bread", "bakery", "pastr", "cake", "viennoiserie"], category: "backwaren" },
  { keywords: ["snack", "chip", "sweet", "chocolate", "candy", "biscuit", "cookie"], category: "snacks" },
  { keywords: ["clean", "detergent", "dish-washing"], category: "reinigung" },
  { keywords: ["hygiene", "cosmetic", "care-product"], category: "hygiene" },
];

// Ordnet ein von Open Food Facts geliefertes Produkt einer internen
// Warengruppe zu, anhand der Kategorie-Tags (bevorzugt) oder des Produktnamens.
function mapOffCategoryToInternal(product) {
  const tags = (product?.categories_tags || []).join(" ").toLowerCase();
  const name = (product?.product_name || "").toLowerCase();
  const haystack = `${tags} ${name}`;
  for (const entry of OFF_CATEGORY_KEYWORDS) {
    if (entry.keywords.some((k) => haystack.includes(k))) return entry.category;
  }
  return "vorraete";
}

// Liefert ein vorgeschlagenes Haltbarkeitsdatum (ISO-String) für eine
// Warengruppe, oder "" wenn dafür kein Vorschlag sinnvoll ist.
function suggestExpiryForCategory(category) {
  const days = CATEGORY_SHELF_LIFE_DAYS[category];
  return days == null ? "" : addDays(todayStr(), days);
}

// Fragt Open Food Facts (kostenlose, offene Produktdatenbank) nach einer
// EAN/GTIN ab. Gibt null zurück, wenn nichts gefunden wurde oder die
// Anfrage fehlschlägt.
async function fetchProductFromBarcode(barcode) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,product_name_de,brands,categories_tags`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Netzwerkfehler");
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  return data.product;
}

const UNITS = ["Stück", "g", "kg", "ml", "l", "Packung", "Dose", "Becher", "Bund"];
/* Einheiten, für die eine Packungsgröße (Inhalt je Packung) sinnvoll ist. */
const PACKAGE_CAPABLE_UNITS = ["Packung", "Dose", "Becher", "Stück", "Bund"];
/* Einheiten mit fester Umrechnung untereinander (für Packungsinhalte i.d.R. Gewicht/Volumen). */
const PACKAGE_CONTENT_UNITS = ["g", "kg", "ml", "l", "Stück"];

/* Deutsche Zahlendarstellung, z.B. 1000 -> "1.000", 1.5 -> "1,5". */
function formatDE(n, maxDecimals = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: maxDecimals }).format(n);
}

const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const WEEKDAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

const ASSIGNEES = ["person1", "person2", "gemeinsam"];

/* ---------------------------------------------------------------------- */
/* DATUM-HILFSFUNKTIONEN                                                   */
/* ---------------------------------------------------------------------- */

function pad(n) { return String(n).padStart(2, "0"); }

function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function todayStr() { return toISODate(todayDate()); }

function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(dateStr, n) {
  const d = parseISO(dateStr);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

function addMonths(dateStr, n) {
  const d = parseISO(dateStr);
  d.setMonth(d.getMonth() + n);
  return toISODate(d);
}

function addYears(dateStr, n) {
  const d = parseISO(dateStr);
  d.setFullYear(d.getFullYear() + n);
  return toISODate(d);
}

function weekdayIndex(dateStr) {
  const d = parseISO(dateStr);
  return (d.getDay() + 6) % 7; // 0 = Montag
}

function formatHuman(dateStr) {
  const d = parseISO(dateStr);
  return `${WEEKDAYS[weekdayIndex(dateStr)]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

function formatShort(dateStr) {
  const d = parseISO(dateStr);
  return `${d.getDate()}.${pad(d.getMonth() + 1)}.`;
}

function relativeLabel(dateStr) {
  const diff = Math.round((parseISO(dateStr) - todayDate()) / 86400000);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  if (diff === -1) return "Gestern";
  if (diff < 0) return `Vor ${-diff} Tagen`;
  if (diff < 7) return WEEKDAYS[weekdayIndex(dateStr)];
  return formatShort(dateStr);
}

function nextOccurrence(dateStr, recurrence) {
  switch (recurrence?.type) {
    case "daily": return addDays(dateStr, 1);
    case "every2days": return addDays(dateStr, 2);
    case "weekly": return addDays(dateStr, 7);
    case "biweekly": return addDays(dateStr, 14);
    case "monthly": return addMonths(dateStr, 1);
    case "every3months": return addMonths(dateStr, 3);
    case "yearly": return addYears(dateStr, 1);
    case "weekday": {
      // Konkreter Wochentag, z.B. "jeden Samstag" – unabhängig vom Ausgangsdatum.
      const target = recurrence.weekday ?? weekdayIndex(dateStr);
      let d = addDays(dateStr, 1);
      for (let i = 0; i < 7; i++) {
        if (weekdayIndex(d) === target) return d;
        d = addDays(d, 1);
      }
      return null;
    }
    default: return null;
  }
}

/* Start der Kalenderwoche (Montag/Sonntag je nach Einstellung) für ein Datum. */
function startOfWeek(dateStr, weekStart) {
  const d = parseISO(dateStr);
  const jsDay = d.getDay(); // 0 = Sonntag ... 6 = Samstag
  const diff = (jsDay - weekStart + 7) % 7;
  return addDays(dateStr, -diff);
}

/* Liefert die 7 ISO-Datumsstrings einer Kalenderwoche (Mo–So bzw. So–Sa). */
function weekDatesFor(dateStr, weekStart) {
  const start = startOfWeek(dateStr, weekStart);
  return [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(start, n));
}

function weekRangeLabel(weekDates) {
  const first = parseISO(weekDates[0]);
  const last = parseISO(weekDates[6]);
  const sameMonth = first.getMonth() === last.getMonth();
  const firstLabel = `${first.getDate()}.${sameMonth ? "" : pad(first.getMonth() + 1) + "."}`;
  return `${firstLabel} – ${formatShort(weekDates[6])}`;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------------------------------------------------------------- */
/* DEMO-DATEN                                                              */
/* ---------------------------------------------------------------------- */

function buildDemoState() {
  const t = todayStr();
  return {
    settings: {
      householdName: "Unser Zuhause",
      person1Name: "Person 1",
      person2Name: "Person 2",
      weekStart: 1,
      theme: "warm",
    },
    tasks: [
      { id: uid(), title: "Badezimmer putzen", category: "putzen", assignee: "person1", date: t, time: "", recurrence: { type: "weekly" }, priority: "medium", note: "", completed: false },
      { id: uid(), title: "Wäsche waschen", category: "waesche", assignee: "gemeinsam", date: t, time: "", recurrence: { type: "none" }, priority: "medium", note: "", completed: false },
      { id: uid(), title: "Küche aufräumen", category: "putzen", assignee: "person2", date: t, time: "", recurrence: { type: "daily" }, priority: "low", note: "", completed: false },
      { id: uid(), title: "Staubsaugen", category: "putzen", assignee: "gemeinsam", date: addDays(t, 1), time: "", recurrence: { type: "weekly" }, priority: "low", note: "", completed: false },
      { id: uid(), title: "Bettwäsche wechseln", category: "waesche", assignee: "person1", date: addDays(t, 2), time: "", recurrence: { type: "monthly" }, priority: "low", note: "", completed: false },
      { id: uid(), title: "Fenster putzen", category: "putzen", assignee: "person2", date: addDays(t, 5), time: "", recurrence: { type: "monthly" }, priority: "low", note: "", completed: false },
    ],
    shopping: [
      { id: uid(), name: "Milch", category: "milchprodukte", quantity: 2, unit: "l", checked: false },
      { id: uid(), name: "Eier", category: "milchprodukte", quantity: 1, unit: "Packung", checked: false },
      { id: uid(), name: "Hackfleisch", category: "fleisch-fisch", quantity: 500, unit: "g", checked: false },
      { id: uid(), name: "Brot", category: "backwaren", quantity: 1, unit: "Stück", checked: false },
      { id: uid(), name: "Waschmittel", category: "reinigung", quantity: 1, unit: "Stück", checked: true },
    ],
    inventory: [
      { id: uid(), name: "Milch", category: "milchprodukte", quantity: 0.5, unit: "l", minStock: 1, expiry: addDays(t, 3), location: "fridge" },
      { id: uid(), name: "Butter", category: "milchprodukte", quantity: 1, unit: "Stück", minStock: 1, expiry: addDays(t, 20), location: "fridge" },
      { id: uid(), name: "Käse", product: "Gouda", category: "milchprodukte", quantity: 1, unit: "Stück", minStock: 1, expiry: addDays(t, 10), location: "fridge" },
      { id: uid(), name: "Joghurt", category: "milchprodukte", quantity: 4, unit: "Becher", minStock: 2, expiry: addDays(t, 6), location: "fridge" },
      { id: uid(), name: "Frischkäse", category: "milchprodukte", quantity: 1, unit: "Becher", minStock: 1, expiry: addDays(t, 1), location: "fridge" },
      { id: uid(), name: "Eier", category: "sonstiges", quantity: 6, unit: "Stück", minStock: 4, expiry: addDays(t, 14), location: "fridge" },
      { id: uid(), name: "Paprika", category: "obst-gemuese", quantity: 2, unit: "Stück", minStock: 1, expiry: addDays(t, 1), location: "fridge" },
      { id: uid(), name: "Gurke", category: "obst-gemuese", quantity: 1, unit: "Stück", minStock: 1, expiry: addDays(t, 4), location: "fridge" },
      { id: uid(), name: "Tomaten", category: "obst-gemuese", quantity: 3, unit: "Stück", minStock: 2, expiry: addDays(t, 3), location: "fridge" },
      { id: uid(), name: "Zwiebel", category: "obst-gemuese", quantity: 3, unit: "Stück", minStock: 2, expiry: addDays(t, 30), location: "pantry" },
      { id: uid(), name: "Hackfleisch", category: "fleisch-fisch", quantity: 0, unit: "g", minStock: 300, expiry: null, location: "fridge" },
      { id: uid(), name: "Hähnchenbrust", category: "fleisch-fisch", quantity: 400, unit: "g", minStock: 200, expiry: addDays(t, 2), location: "fridge" },
      { id: uid(), name: "Nudeln", product: "Spaghetti", category: "vorraete", quantity: 3, unit: "Packung", minStock: 2, expiry: null, location: "pantry", packageSize: { amount: 500, unit: "g" } },
      { id: uid(), name: "Reis", product: "Basmatireis", category: "vorraete", quantity: 1, unit: "Packung", minStock: 1, expiry: null, location: "pantry" },
      { id: uid(), name: "Tomatensoße", category: "vorraete", quantity: 2, unit: "Dose", minStock: 1, expiry: null, location: "pantry" },
      { id: uid(), name: "Dosentomaten", category: "vorraete", quantity: 2, unit: "Dose", minStock: 1, expiry: null, location: "pantry" },
      { id: uid(), name: "Mehl", category: "vorraete", quantity: 1, unit: "Packung", minStock: 1, expiry: null, location: "pantry" },
      { id: uid(), name: "Haferflocken", category: "vorraete", quantity: 1, unit: "Packung", minStock: 1, expiry: null, location: "pantry" },
      { id: uid(), name: "Öl", category: "vorraete", quantity: 1, unit: "Stück", minStock: 1, expiry: null, location: "pantry" },
      { id: uid(), name: "Tortilla Wraps", category: "backwaren", quantity: 1, unit: "Packung", minStock: 1, expiry: addDays(t, 12), location: "pantry" },
    ],
    recipes: [
      {
        id: uid(), name: "Spaghetti Bolognese", description: "Der Klassiker mit herzhafter Hackfleischsoße.",
        servings: 4, prepTime: 35, category: "Pasta",
        ingredients: [
          { name: "Nudeln", product: "Spaghetti", amount: 500, unit: "g" },
          { name: "Hackfleisch", amount: 500, unit: "g" },
          { name: "Dosentomaten", amount: 1, unit: "Dose" },
          { name: "Zwiebel", amount: 1, unit: "Stück" },
        ],
      },
      {
        id: uid(), name: "Wraps", description: "Schnelle, gefüllte Tortilla-Wraps mit Hähnchen und Gemüse.",
        servings: 2, prepTime: 20, category: "Schnell",
        ingredients: [
          { name: "Tortilla Wraps", amount: 4, unit: "Stück" },
          { name: "Hähnchenbrust", amount: 300, unit: "g" },
          { name: "Paprika", amount: 1, unit: "Stück" },
          { name: "Gurke", amount: 0.5, unit: "Stück" },
        ],
      },
      {
        id: uid(), name: "Ofenkartoffeln mit Hähnchen", description: "Knusprige Ofenkartoffeln mit gewürztem Hähnchen.",
        servings: 4, prepTime: 45, category: "Ofen",
        ingredients: [
          { name: "Hähnchenbrust", amount: 400, unit: "g" },
          { name: "Öl", amount: 2, unit: "Stück" },
          { name: "Zwiebel", amount: 1, unit: "Stück" },
        ],
      },
      {
        id: uid(), name: "Gemüsepfanne", description: "Bunte Pfanne mit dem, was der Kühlschrank hergibt.",
        servings: 2, prepTime: 20, category: "Vegetarisch",
        ingredients: [
          { name: "Paprika", amount: 1, unit: "Stück" },
          { name: "Gurke", amount: 1, unit: "Stück" },
          { name: "Zwiebel", amount: 1, unit: "Stück" },
          { name: "Reis", product: "Basmatireis", amount: 1, unit: "Packung" },
        ],
      },
      {
        id: uid(), name: "Tomatennudeln", description: "Einfache Pasta mit würziger Tomatensoße.",
        servings: 3, prepTime: 15, category: "Pasta",
        ingredients: [
          { name: "Nudeln", product: "Spaghetti", amount: 300, unit: "g" },
          { name: "Tomatensoße", amount: 1, unit: "Dose" },
          { name: "Käse", product: "Gouda", amount: 1, unit: "Stück" },
        ],
      },
    ],
    mealPlan: {},
    notes: [
      { id: uid(), text: "Am Wochenende Gäste" },
      { id: uid(), text: "Waschmittel kaufen" },
    ],
    ignoredSuggestions: [],
    cookedMeals: {},
  };
}

/* ---------------------------------------------------------------------- */
/* STYLES                                                                   */
/* ---------------------------------------------------------------------- */

const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Nunito:wght@400;500;600;700;800&display=swap');

    .nest-app, .nest-app * { box-sizing: border-box; }
    .nest-app {
    .nest-app a {
  color: var(--rose-deep);
  text-decoration: none;
}

.nest-app a:hover {
  color: var(--rose);
}

.nest-app *:focus {
  outline: none;
}

.nest-app button:focus,
.nest-app input:focus,
.nest-app select:focus,
.nest-app textarea:focus {
  border-color: var(--rose);
  box-shadow: 0 0 0 3px rgba(217,139,152,0.15);
}

      --cream: #F7F1E8;
      --card: #FFFCF7;
      --card-2: #FBF5EC;
      --ink: #4A3A32;
      --ink-soft: #8A7A6E;
      --rose: #D98B98;
      --rose-deep: #B96777;
      --rose-tint: #F7E4E8;
      --taupe: #A6957F;
      --taupe-tint: #EFE7DA;
      --gold: #C99A3E;
      --gold-tint: #F6E9CB;
      --sage: #7C9B76;
      --sage-tint: #E4EEE0;
      --red: #C96A5C;
      --red-tint: #F7E2DD;
      --line: #E9DFD1;
      --shadow: 0 2px 14px rgba(120, 95, 70, 0.08);
      --shadow-md: 0 6px 24px rgba(120, 95, 70, 0.12);
      font-family: 'Nunito', sans-serif;
      color: var(--ink);
      background: var(--cream);
      width: 100%;
      min-height: 100%;
      position: relative;
      -webkit-font-smoothing: antialiased;
    }
    .nest-app h1, .nest-app h2, .nest-app h3, .nest-app .serif {
      font-family: 'Fraunces', serif;
      font-weight: 500;
      letter-spacing: -0.01em;
      margin: 0;
    }
    .nest-app button { font-family: 'Nunito', sans-serif; cursor: pointer; }
    .nest-app input, .nest-app select, .nest-app textarea { font-family: 'Nunito', sans-serif; }
    .nest-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
    .nest-scroll::-webkit-scrollbar-thumb { background: var(--line); border-radius: 4px; }

    .nest-shell { display: flex; min-height: 100vh; max-width: 1180px; margin: 0 auto; }
    .nest-sidebar {
      width: 232px; flex-shrink: 0; background: var(--card); border-right: 1px solid var(--line);
      padding: 28px 18px; display: flex; flex-direction: column; gap: 26px;
    }
    .nest-brand { display: flex; align-items: center; gap: 10px; padding: 0 8px; }
    .nest-brand-mark {
      width: 38px; height: 38px; border-radius: 12px; background: var(--rose-tint);
      display: flex; align-items: center; justify-content: center; font-size: 19px; flex-shrink: 0;
    }
    .nest-nav { display: flex; flex-direction: column; gap: 4px; }
    .nest-nav-item {
      display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: 12px;
      border: none; background: transparent; color: var(--ink-soft); font-size: 15px; font-weight: 600;
      text-align: left; transition: background .15s, color .15s;
    }
    .nest-nav-item:hover { background: var(--taupe-tint); }
    .nest-nav-item.active { background: var(--rose-tint); color: var(--rose-deep); }
    .nest-nav-icon { font-size: 18px; width: 22px; text-align: center; }

    .nest-main { flex: 1; min-width: 0; padding: 32px 36px 100px; }
    .nest-page-title { font-size: 26px; margin-bottom: 4px; }
    .nest-page-sub { color: var(--ink-soft); font-size: 14.5px; margin-bottom: 24px; }

    .nest-card {
      background: var(--card); border-radius: 18px; border: 1px solid var(--line);
      box-shadow: var(--shadow); padding: 20px 22px;
    }
    .nest-section { margin-bottom: 26px; }
    .nest-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .nest-section-title { font-size: 18px; display: flex; align-items: center; gap: 8px; }

    .nest-btn {
      display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: 11px;
      border: 1px solid var(--line); background: var(--card); color: var(--ink); font-size: 14px; font-weight: 700;
      transition: transform .1s, background .15s;
    }
    .nest-btn:hover { background: var(--card-2); }
    .nest-btn:active { transform: scale(0.97); }
    .nest-btn-primary { background: var(--rose); border-color: var(--rose); color: #fff; }
    .nest-btn-primary:hover { background: var(--rose-deep); }
    .nest-btn-ghost { border-color: transparent; background: transparent; }
    .nest-btn-ghost:hover { background: var(--taupe-tint); }
    .nest-btn-sm { padding: 6px 12px; font-size: 13px; border-radius: 9px; }
    .nest-btn-danger { color: var(--red); border-color: var(--red-tint); }
    .nest-btn-danger:hover { background: var(--red-tint); }
    .nest-btn:disabled { opacity: .45; cursor: default; }

    .nest-chip {
      display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 20px;
      font-size: 12.5px; font-weight: 700; background: var(--taupe-tint); color: var(--ink-soft);
    }

    .nest-task-row {
      display: flex; align-items: center; gap: 12px; padding: 12px 6px; border-bottom: 1px solid var(--line);
    }
    .nest-task-row:last-child { border-bottom: none; }
    .nest-check {
      width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--taupe); flex-shrink: 0;
      background: transparent; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 13px;
      transition: all .15s;
    }
    .nest-check.done { background: var(--sage); border-color: var(--sage); }
    .nest-task-title { font-size: 15px; font-weight: 700; flex: 1; }
    .nest-task-title.done { text-decoration: line-through; color: var(--ink-soft); }
    .nest-task-meta { font-size: 12.5px; color: var(--ink-soft); display: flex; align-items: center; gap: 6px; }

    .nest-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .nest-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .nest-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .nest-grid-auto { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }

    .nest-metric {
      background: var(--card-2); border-radius: 14px; padding: 14px 16px;
    }
    .nest-metric-label { font-size: 12.5px; color: var(--ink-soft); font-weight: 700; }
    .nest-metric-value { font-size: 22px; font-family: 'Fraunces', serif; margin-top: 2px; }
    .nest-metric-preview { font-size: 12px; color: var(--ink-soft); margin-top: 6px; line-height: 1.4; }
    .nest-metric-click {
      border: 1px solid transparent; text-align: left; width: 100%; display: block;
      transition: background .15s, border-color .15s, transform .1s; font-family: 'Nunito', sans-serif;
    }
    .nest-metric-click:hover { background: var(--taupe-tint); border-color: var(--line); }
    .nest-metric-click:active { transform: scale(0.98); }

    .nest-weekplan-row {
      display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line);
    }
    .nest-weekplan-row:last-child { border-bottom: none; }
    .nest-weekplan-day {
      width: 34px; flex-shrink: 0; font-size: 12px; font-weight: 800; color: var(--ink-soft); text-transform: uppercase;
    }
    .nest-weekplan-day.today { color: var(--rose-deep); }

    .nest-progress-track { height: 8px; border-radius: 6px; background: var(--taupe-tint); overflow: hidden; }
    .nest-progress-fill { height: 100%; background: var(--sage); border-radius: 6px; transition: width .3s; }

    .nest-input, .nest-select, .nest-textarea {
      width: 100%; padding: 10px 13px; border-radius: 11px; border: 1px solid var(--line);
      background: #fff; font-size: 14.5px; color: var(--ink); outline: none;
    }
    .nest-input:focus, .nest-select:focus, .nest-textarea:focus { border-color: var(--rose); }
    .nest-field { margin-bottom: 14px; }
    .nest-label { font-size: 13px; font-weight: 700; color: var(--ink-soft); margin-bottom: 6px; display: block; }
    .nest-textarea { resize: vertical; min-height: 64px; }

    .nest-modal-overlay {
      position: fixed; inset: 0; background: rgba(74, 58, 50, 0.35); display: flex; align-items: flex-end;
      justify-content: center; z-index: 100; backdrop-filter: blur(2px);
    }
    .nest-modal {
      background: var(--cream); width: 100%; max-width: 480px; border-radius: 22px 22px 0 0;
      max-height: 90vh; overflow-y: auto; padding: 22px 22px 28px; box-shadow: 0 -8px 30px rgba(0,0,0,.15);
    }
    @media (min-width: 720px) {
      .nest-modal-overlay { align-items: center; }
      .nest-modal { border-radius: 20px; max-height: 85vh; }
    }
    .nest-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
    .nest-modal-close { background: none; border: none; font-size: 22px; color: var(--ink-soft); line-height: 1; }

    .nest-pill-select { display: flex; flex-wrap: wrap; gap: 8px; }
    .nest-pill {
      padding: 8px 14px; border-radius: 20px; border: 1.5px solid var(--line); background: #fff;
      font-size: 13.5px; font-weight: 700; color: var(--ink-soft); display: flex; align-items: center; gap: 6px;
    }
    .nest-pill.active { border-color: var(--rose); background: var(--rose-tint); color: var(--rose-deep); }

    .nest-empty { text-align: center; padding: 40px 20px; color: var(--ink-soft); }
    .nest-empty-icon { font-size: 34px; margin-bottom: 10px; }
    .nest-empty-title { font-family: 'Fraunces', serif; font-size: 17px; color: var(--ink); margin-bottom: 4px; }

    .nest-banner {
      display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 14px;
      background: var(--gold-tint); margin-bottom: 10px; font-size: 13.5px;
    }
    .nest-banner-urgent { background: var(--red-tint); }
    .nest-banner-actions { margin-left: auto; display: flex; gap: 6px; flex-shrink: 0; }

    .nest-stepper { display: flex; align-items: center; gap: 10px; }
    .nest-stepper button {
      width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--line); background: #fff;
      font-size: 16px; font-weight: 700; color: var(--ink); display: flex; align-items: center; justify-content: center;
    }
    .nest-stepper button:hover { background: var(--taupe-tint); }
    .nest-stepper-val { min-width: 44px; text-align: center; font-weight: 800; font-size: 14.5px; }

    .nest-bottomnav {
      display: none;
    }
    @media (max-width: 860px) {
      .nest-sidebar { display: none; }
      .nest-main { padding: 20px 16px 90px; }
      .nest-bottomnav {
        display: flex; position: fixed; bottom: 0; left: 0; right: 0; background: var(--card);
        border-top: 1px solid var(--line); padding: 8px 4px calc(8px + env(safe-area-inset-bottom));
        z-index: 50; justify-content: space-around;
      }
      .nest-bottomnav-item {
        display: flex; flex-direction: column; align-items: center; gap: 2px; background: none; border: none;
        color: var(--ink-soft); font-size: 10.5px; font-weight: 700; padding: 4px 6px; border-radius: 10px; flex: 1;
      }
      .nest-bottomnav-item.active { color: var(--rose-deep); }
      .nest-bottomnav-icon { font-size: 20px; }
      .nest-grid-2, .nest-grid-3, .nest-grid-4 { grid-template-columns: 1fr 1fr; }
      .nest-shell { max-width: 100%; }
    }
    @media (max-width: 480px) {
      .nest-grid-3, .nest-grid-4 { grid-template-columns: 1fr 1fr; }
    }

    .nest-fab-row { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; }
    .nest-fab {
      flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 16px;
      border-radius: 16px; border: 1px solid var(--line); background: var(--card); font-size: 12.5px; font-weight: 700;
      min-width: 76px;
    }
    .nest-fab:hover { background: var(--card-2); }
    .nest-fab-icon { font-size: 20px; }

    .nest-swatch { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

    .nest-ingredient-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }

    .nest-btn-danger-solid { background: var(--red); border-color: var(--red); color: #fff; }
    .nest-btn-danger-solid:hover { background: #b25749; }

    .nest-confirm-box {
      background: var(--cream); width: 100%; max-width: 380px; border-radius: 18px;
      padding: 20px 20px 18px; box-shadow: 0 -8px 30px rgba(0,0,0,.15); margin: 16px;
    }

    .nest-toast {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
      background: var(--ink); color: #fff; padding: 12px 20px; border-radius: 14px;
      font-size: 13.5px; font-weight: 700; box-shadow: var(--shadow-md); z-index: 300;
      max-width: calc(100vw - 32px); text-align: center;
    }
    @media (max-width: 860px) { .nest-toast { bottom: 84px; } }

    .nest-searchbar { position: relative; flex: 1; min-width: 180px; }
    .nest-searchbar input { padding-left: 34px; }
    .nest-searchbar-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 14px; color: var(--ink-soft); pointer-events: none; }

    .nest-alt-note { font-size: 12.5px; color: var(--gold); margin-top: 4px; }
    .nest-cook-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); }
    .nest-cook-row:last-child { border-bottom: none; }

    .nest-checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 700; }

    .nest-scanner-box {
      border-radius: 14px; overflow: hidden; background: #000; border: 1px solid var(--line);
    }
    .nest-scanner-video { width: 100%; min-height: 220px; }
    .nest-scanner-video video { width: 100% !important; border-radius: 14px; }
  `}</style>
);

/* ---------------------------------------------------------------------- */
/* KLEINE UI-BAUSTEINE                                                     */
/* ---------------------------------------------------------------------- */

function urgencyOfExpiry(expiry) {
  if (!expiry) return null;
  const diff = Math.round((parseISO(expiry) - todayDate()) / 86400000);
  if (diff < 0) return "abgelaufen";
  if (diff === 0) return "heute";
  if (diff <= 2) return "bald";
  return "ok";
}

function categoryMeta(id) {
  return TASK_CATEGORIES.find((c) => c.id === id) || TASK_CATEGORIES[3];
}
function shoppingCategoryMeta(id) {
  return SHOPPING_CATEGORIES.find((c) => c.id === id) || SHOPPING_CATEGORIES[SHOPPING_CATEGORIES.length - 1];
}
function assigneeLabel(id, settings) {
  if (id === "person1") return settings.person1Name;
  if (id === "person2") return settings.person2Name;
  return "Gemeinsam";
}
function assigneeIcon(id) {
  if (id === "person1") return "👩";
  if (id === "person2") return "👨";
  return "👫";
}


function EmptyState({ icon, title, actionLabel, onAction }) {
  return (
    <div className="nest-empty">
      <div className="nest-empty-icon">{icon}</div>
      <div className="nest-empty-title">{title}</div>
      {actionLabel && (
        <button className="nest-btn nest-btn-primary" style={{ marginTop: 12 }} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  const modalRef = useRef(null);

  useEffect(() => {
    // Tastaturbedienung: Escape schließt, Tab bleibt innerhalb des Dialogs.
    const node = modalRef.current;
    const focusable = () => node
      ? Array.from(node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((el) => !el.disabled)
      : [];
    const first = focusable()[0];
    first?.focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const items = focusable();
        if (items.length === 0) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <div className="nest-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nest-modal" ref={modalRef} style={wide ? { maxWidth: 560 } : undefined} role="dialog" aria-modal="true" aria-label={title}>
        <div className="nest-modal-head">
          <h2>{title}</h2>
          <button className="nest-modal-close" onClick={onClose} aria-label="Schließen">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* SICHERHEITSABFRAGE & ERFOLGSMELDUNGEN (ersetzen Browser-Alerts)         */
/* ---------------------------------------------------------------------- */

function ConfirmDialog({ message, detail, confirmLabel, danger, onConfirm, onClose }) {
  const boxRef = useRef(null);
  useEffect(() => {
    boxRef.current?.querySelector("button")?.focus();
    const onKeyDown = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);
  return (
    <div className="nest-modal-overlay" style={{ zIndex: 200 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nest-confirm-box" ref={boxRef} role="alertdialog" aria-modal="true">
        <div style={{ fontWeight: 800, fontSize: 15.5 }}>{message}</div>
        {detail && <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 6 }}>{detail}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="nest-btn nest-btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>Abbrechen</button>
          <button className={`nest-btn ${danger ? "nest-btn-danger-solid" : "nest-btn-primary"}`} style={{ flex: 1, justifyContent: "center" }}
            onClick={() => { onConfirm(); onClose(); }} autoFocus>
            {confirmLabel || "Löschen"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className="nest-toast" role="status" aria-live="polite">
      {toast.icon || "✅"} {toast.message}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="nest-field">
      <label className="nest-label">{label}</label>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* AUFGABEN-MODAL                                                          */
/* ---------------------------------------------------------------------- */

function TaskModal({ initial, prefill, onSave, onDelete, onClose }) {
  const defaults = initial || prefill || {};
  const [title, setTitle] = useState(initial?.title || "");
  const [category, setCategory] = useState(defaults.category || "putzen");
  const [assignee, setAssignee] = useState(defaults.assignee || "gemeinsam");
  const [date, setDate] = useState(defaults.date || todayStr());
  const [time, setTime] = useState(initial?.time || "");
  const [recurrence, setRecurrence] = useState(initial?.recurrence?.type || "none");
  const [weekday, setWeekday] = useState(
    initial?.recurrence?.type === "weekday" ? initial.recurrence.weekday : weekdayIndex(defaults.date || todayStr())
  );
  const [priority, setPriority] = useState(initial?.priority || "medium");
  const [note, setNote] = useState(initial?.note || "");

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      id: initial?.id || uid(),
      seriesId: initial?.seriesId,
      title: title.trim(),
      category, assignee, date, time,
      recurrence: recurrence === "weekday" ? { type: recurrence, weekday } : { type: recurrence },
      priority, note,
      completed: initial?.completed || false,
    });
  };

  return (
    <Modal title={initial ? "Aufgabe bearbeiten" : "Neue Aufgabe"} onClose={onClose}>
      <Field label="Titel">
        <input className="nest-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Bad putzen" autoFocus />
      </Field>
      <Field label="Kategorie">
        <div className="nest-pill-select">
          {TASK_CATEGORIES.map((c) => (
            <button key={c.id} className={`nest-pill ${category === c.id ? "active" : ""}`} onClick={() => setCategory(c.id)}>
              <span>{c.icon}</span>{c.label}
            </button>
          ))}
        </div>
      </Field>
      <div className="nest-grid-2">
        <Field label="Datum">
          <input type="date" className="nest-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Uhrzeit (optional)">
          <input type="time" className="nest-input" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Wiederholung">
        <select className="nest-select" value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
          {RECURRENCE_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </Field>
      {recurrence === "weekday" && (
        <Field label="Jeden…">
          <select className="nest-select" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
            {WEEKDAYS.map((w, idx) => <option key={w} value={idx}>Jeden {w}</option>)}
          </select>
        </Field>
      )}
      <Field label="Priorität">
        <div className="nest-pill-select">
          {PRIORITIES.map((p) => (
            <button key={p.id} className={`nest-pill ${priority === p.id ? "active" : ""}`} onClick={() => setPriority(p.id)}>
              <span>{p.icon}</span>{p.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Zuständig">
        <div className="nest-pill-select">
          {ASSIGNEES.map((a) => (
            <button key={a} className={`nest-pill ${assignee === a ? "active" : ""}`} onClick={() => setAssignee(a)}>
              <span>{assigneeIcon(a)}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Notiz (optional)">
        <textarea className="nest-textarea" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button className="nest-btn nest-btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={handleSave}>
          Speichern
        </button>
        {initial && (
          <button className="nest-btn nest-btn-danger" onClick={() => onDelete(initial.id)}>Löschen</button>
        )}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* AUFGABEN-KARTE (TaskRow)                                                */
/* ---------------------------------------------------------------------- */

function TaskRow({ task, settings, onToggle, onEdit }) {
  const cat = categoryMeta(task.category);
  const overdue = !task.completed && task.date < todayStr();
  return (
    <div className="nest-task-row">
      <button
        className={`nest-check ${task.completed ? "done" : ""}`}
        onClick={() => onToggle(task)}
        aria-label="Aufgabe abhaken"
      >
        {task.completed ? "✓" : ""}
      </button>
      <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onEdit(task)}>
        <div className={`nest-task-title ${task.completed ? "done" : ""}`}>
          {cat.icon} {task.title}
        </div>
        <div className="nest-task-meta">
          <span className="nest-swatch" style={{ background: cat.color }}></span>
          {cat.label}
          <span>·</span>
          <span>{assigneeIcon(task.assignee)} {assigneeLabel(task.assignee, settings)}</span>
          {overdue && <><span>·</span><span style={{ color: "var(--red)", fontWeight: 800 }}>Überfällig</span></>}
          {task.recurrence?.type !== "none" && <span title="wiederkehrend">🔁</span>}
        </div>
      </div>
      {task.priority === "high" && <span title="Hohe Priorität">🔴</span>}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* BARCODE-SCANNER-MODAL                                                   */
/* Öffnet die Handykamera, erkennt EAN/GTIN-Barcodes und meldet den        */
/* erkannten Code per onDetected() zurück. Enthält außerdem ein manuelles  */
/* Eingabefeld, falls die Kamera nicht zur Verfügung steht oder der        */
/* Barcode schlecht lesbar ist.                                            */
/* ---------------------------------------------------------------------- */

const SCANNER_REGION_ID = "nest-barcode-scanner-region";

function BarcodeScannerModal({ onDetected, onClose }) {
  const [manualCode, setManualCode] = useState("");
  const [cameraError, setCameraError] = useState("");
  const scannerRef = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const instance = new Html5Qrcode(SCANNER_REGION_ID, {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
      ],
      verbose: false,
    });
    scannerRef.current = instance;

    instance
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 140 } },
        (decodedText) => {
          if (cancelled) return;
          cancelled = true;
          startedRef.current = false;
          instance.stop().then(() => instance.clear()).catch(() => {}).finally(() => onDetected(decodedText));

        },
        () => { /* laufende Scan-Versuche ohne Treffer – ignorieren */ }
      )
      .then(() => { startedRef.current = true; })
      .catch(() => {
        if (!cancelled) setCameraError("Kamera konnte nicht gestartet werden. Bitte Kamerazugriff erlauben oder Barcode unten manuell eingeben.");
      });

    return () => {
      cancelled = true;
      if (startedRef.current) {
        instance.stop().then(() => instance.clear()).catch(() => {});
      } else {
        instance.clear().catch(() => {});
      }
    };
  }, [onDetected]);

  const submitManual = () => {
    const code = manualCode.trim();
    if (!code) return;
    onDetected(code);
  };

  return (
    <Modal title="Barcode scannen" onClose={onClose}>
      <div className="nest-scanner-box">
        <div id={SCANNER_REGION_ID} className="nest-scanner-video" />
      </div>
      {cameraError ? (
        <div style={{ fontSize: 13, color: "var(--red)", marginTop: 10 }}>{cameraError}</div>
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 10 }}>
          Verpackung mit dem Barcode vor die Kamera halten.
        </div>
      )}
      <Field label="Oder Barcode-Nummer manuell eingeben">
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="nest-input"
            style={{ flex: 1 }}
            inputMode="numeric"
            placeholder="z.B. 4000417025005"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitManual(); }}
          />
          <button className="nest-btn nest-btn-primary" onClick={submitManual}>Suchen</button>
        </div>
      </Field>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* VORRAT-MODAL                                                           */
/* ---------------------------------------------------------------------- */

function InventoryModal({ initial, defaultLocation, defaultCategory, defaultName, defaultProduct, defaultExpiry, defaultBarcode, onSave, onDelete, onClose }) {
  const [name, setName] = useState(initial?.name || defaultName || "");
  const [product, setProduct] = useState(initial?.product || defaultProduct || "");
  const [category, setCategory] = useState(initial?.category || defaultCategory || "sonstiges");
  const [quantity, setQuantity] = useState(initial?.quantity ?? 1);
  const [unit, setUnit] = useState(initial?.unit || "Stück");
  const [minStock, setMinStock] = useState(initial?.minStock ?? 1);
  const [expiry, setExpiry] = useState(initial?.expiry || defaultExpiry || "");
  const [location, setLocation] = useState(initial?.location || defaultLocation || "fridge");
  const barcode = initial?.barcode || defaultBarcode || null;
  const [hasPackageSize, setHasPackageSize] = useState(!!initial?.packageSize);
  const [packageAmount, setPackageAmount] = useState(initial?.packageSize?.amount ?? "");
  const [packageUnit, setPackageUnit] = useState(initial?.packageSize?.unit || "g");

  const packageCapable = PACKAGE_CAPABLE_UNITS.includes(unit);
  const totalContent = hasPackageSize && packageAmount ? Number(quantity || 0) * Number(packageAmount) : null;

  const handleSave = () => {
    if (!name.trim()) return;
    const packageSize = hasPackageSize && packageCapable && packageAmount
      ? { amount: Number(packageAmount) || 0, unit: packageUnit }
      : null;
    onSave({
      id: initial?.id || uid(),
      name: name.trim(), product: product.trim(), category, quantity: Number(quantity) || 0, unit,
      minStock: Number(minStock) || 0, expiry: expiry || null, location, packageSize, barcode,
    });
  };

  return (
    <Modal title={initial ? "Artikel bearbeiten" : "Artikel hinzufügen"} onClose={onClose}>
      {barcode && (
        <div className="nest-chip" style={{ marginBottom: 14 }}>
          📷 Barcode {barcode} · Angaben bitte prüfen und bei Bedarf anpassen
        </div>
      )}
      <div className="nest-grid-2">
        <Field label="Lebensmittelgruppe">
          <input className="nest-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Nudeln" autoFocus />
        </Field>
        <Field label="Konkretes Produkt (optional)">
          <input className="nest-input" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="z.B. Spaghetti" />
        </Field>
      </div>
      <Field label="Ort">
        <div className="nest-pill-select">
          {INVENTORY_LOCATIONS.map((l) => (
            <button key={l.id} className={`nest-pill ${location === l.id ? "active" : ""}`} onClick={() => setLocation(l.id)}>
              <span>{l.icon}</span>{l.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Warengruppe">
        <select className="nest-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {SHOPPING_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
        </select>
      </Field>
      <div className="nest-grid-2">
        <Field label={packageCapable ? "Anzahl Packungen" : "Menge"}>
          <input type="number" step="any" className="nest-input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field label="Einheit">
          <select className="nest-select" value={unit} onChange={(e) => { setUnit(e.target.value); if (!PACKAGE_CAPABLE_UNITS.includes(e.target.value)) setHasPackageSize(false); }}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
      </div>
      {packageCapable && (
        <Field label="Packungsgröße (optional)">
          <label className="nest-checkbox-row" style={{ marginBottom: hasPackageSize ? 10 : 0 }}>
            <input type="checkbox" checked={hasPackageSize} onChange={(e) => setHasPackageSize(e.target.checked)} />
            Inhalt je Packung angeben (z.B. 500 g), um Rezepte mit Grammangaben genau zu prüfen
          </label>
          {hasPackageSize && (
            <>
              <div className="nest-grid-2">
                <input type="number" step="any" className="nest-input" placeholder="z.B. 500" value={packageAmount}
                  onChange={(e) => setPackageAmount(e.target.value)} />
                <select className="nest-select" value={packageUnit} onChange={(e) => setPackageUnit(e.target.value)}>
                  {PACKAGE_CONTENT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              {totalContent !== null && (
                <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 6 }}>
                  Gesamtbestand: {formatDE(quantity)} × {formatDE(packageAmount)} {packageUnit} = <strong>{formatDE(totalContent)} {packageUnit}</strong>
                </div>
              )}
            </>
          )}
        </Field>
      )}
      <Field label="Mindestbestand">
        <input type="number" step="any" className="nest-input" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
      </Field>
      <Field label="Haltbar bis (optional)">
        <input type="date" className="nest-input" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        {barcode && (
          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6 }}>
            Nur ein grober Vorschlag anhand der Warengruppe. Das aufgedruckte Mindesthaltbarkeitsdatum auf der Verpackung hat immer Vorrang – bitte hier entsprechend anpassen.
          </div>
        )}
      </Field>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button className="nest-btn nest-btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={handleSave}>
          Speichern
        </button>
        {initial && <button className="nest-btn nest-btn-danger" onClick={() => onDelete(initial.id)}>Löschen</button>}
      </div>
    </Modal>
  );
}

function InventoryCard({ item, onEdit, onQuantity }) {
  const urgency = urgencyOfExpiry(item.expiry);
  const low = item.quantity <= item.minStock;
  const totalContent = item.packageSize?.amount ? item.quantity * Number(item.packageSize.amount) : null;
  return (
    <div className="nest-card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ cursor: "pointer", flex: 1, minWidth: 0 }} onClick={() => onEdit(item)}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>
            {shoppingCategoryMeta(item.category).icon} {item.product || item.name}
          </div>
          {item.product && (
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 1 }}>{item.name}</div>
          )}
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>
            {item.expiry ? `Haltbar bis ${formatShort(item.expiry)}` : "Ohne Ablaufdatum"}
          </div>
          {totalContent !== null && (
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
              à {formatDE(item.packageSize.amount)} {item.packageSize.unit} · Gesamt {formatDE(totalContent)} {item.packageSize.unit}
            </div>
          )}
        </div>
        {urgency && urgency !== "ok" && (
          <span className="nest-chip" style={{
            background: urgency === "abgelaufen" || urgency === "heute" ? "var(--red-tint)" : "var(--gold-tint)",
            color: urgency === "abgelaufen" || urgency === "heute" ? "var(--red)" : "var(--gold)",
          }}>
            {urgency === "abgelaufen" ? "abgelaufen" : urgency === "heute" ? "heute" : "bald"}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
        <div className="nest-stepper">
          <button onClick={() => onQuantity(item, -1)} aria-label="Menge verringern">–</button>
          <span className="nest-stepper-val">{formatDE(item.quantity)} {item.unit}</span>
          <button onClick={() => onQuantity(item, 1)} aria-label="Menge erhöhen">+</button>
        </div>
        {low && <span style={{ fontSize: 12, fontWeight: 800, color: "var(--gold)" }}>wird knapp</span>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* EINKAUFSLISTE                                                           */
/* ---------------------------------------------------------------------- */

function ShoppingItemModal({ initial, onSave, onDelete, onClose }) {
  const [name, setName] = useState(initial?.name || "");
  const [category, setCategory] = useState(initial?.category || "sonstiges");
  const [quantity, setQuantity] = useState(initial?.quantity ?? 1);
  const [unit, setUnit] = useState(initial?.unit || "Stück");

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      id: initial?.id || uid(), name: name.trim(), category,
      quantity: Number(quantity) || 1, unit, checked: initial?.checked || false,
    });
  };

  return (
    <Modal title={initial ? "Artikel bearbeiten" : "Zur Einkaufsliste hinzufügen"} onClose={onClose}>
      <Field label="Name">
        <input className="nest-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Milch" autoFocus />
      </Field>
      <Field label="Kategorie">
        <select className="nest-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {SHOPPING_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
        </select>
      </Field>
      <div className="nest-grid-2">
        <Field label="Menge">
          <input type="number" step="any" className="nest-input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field label="Einheit">
          <select className="nest-select" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button className="nest-btn nest-btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={handleSave}>
          Speichern
        </button>
        {initial && <button className="nest-btn nest-btn-danger" onClick={() => onDelete(initial.id)}>Löschen</button>}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* REZEPT-MODAL                                                            */
/* ---------------------------------------------------------------------- */

function RecipeModal({ initial, onSave, onDelete, onClose }) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [servings, setServings] = useState(initial?.servings || 4);
  const [prepTime, setPrepTime] = useState(initial?.prepTime || 30);
  const [category, setCategory] = useState(initial?.category || "");
  const [ingredients, setIngredients] = useState(
    initial?.ingredients?.length ? initial.ingredients.map((i) => ({ product: "", ...i })) : [{ name: "", product: "", amount: "", unit: "Stück" }]
  );

  const updateIngredient = (idx, field, value) => {
    setIngredients((prev) => prev.map((ing, i) => (i === idx ? { ...ing, [field]: value } : ing)));
  };
  const addIngredient = () => setIngredients((prev) => [...prev, { name: "", product: "", amount: "", unit: "Stück" }]);
  const removeIngredient = (idx) => setIngredients((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = () => {
    if (!name.trim()) return;
    const cleanIngredients = ingredients
      .filter((i) => i.name.trim())
      .map((i) => ({ name: i.name.trim(), product: (i.product || "").trim(), amount: Number(i.amount) || 0, unit: i.unit || "Stück" }));
    onSave({
      id: initial?.id || uid(), name: name.trim(), description, servings: Number(servings) || 1,
      prepTime: Number(prepTime) || 0, category: category.trim() || "Sonstiges", ingredients: cleanIngredients,
    });
  };

  return (
    <Modal title={initial ? "Rezept bearbeiten" : "Neues Rezept"} onClose={onClose} wide>
      <Field label="Name">
        <input className="nest-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Spaghetti Bolognese" autoFocus />
      </Field>
      <Field label="Beschreibung">
        <textarea className="nest-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="nest-grid-3">
        <Field label="Portionen">
          <input type="number" className="nest-input" value={servings} onChange={(e) => setServings(e.target.value)} />
        </Field>
        <Field label="Minuten">
          <input type="number" className="nest-input" value={prepTime} onChange={(e) => setPrepTime(e.target.value)} />
        </Field>
        <Field label="Kategorie">
          <input className="nest-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Pasta" />
        </Field>
      </div>
      <Field label="Zutaten">
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 8 }}>
          Kategorie ist die allgemeine Zutat (z.B. „Nudeln“), Produkt optional das konkrete Produkt (z.B. „Spaghetti“) – so kann genauer mit den Vorräten abgeglichen werden.
        </div>
        {ingredients.map((ing, idx) => (
          <div key={idx} style={{ marginBottom: 10, padding: "10px", borderRadius: 12, background: "var(--card-2)" }}>
            <div className="nest-ingredient-row" style={{ marginBottom: 6 }}>
              <input className="nest-input" style={{ flex: 1 }} placeholder="Kategorie, z.B. Nudeln" value={ing.name}
                onChange={(e) => updateIngredient(idx, "name", e.target.value)} />
              <input className="nest-input" style={{ flex: 1 }} placeholder="Produkt (optional), z.B. Spaghetti" value={ing.product || ""}
                onChange={(e) => updateIngredient(idx, "product", e.target.value)} />
            </div>
            <div className="nest-ingredient-row" style={{ marginBottom: 0 }}>
              <input type="number" step="any" className="nest-input" style={{ flex: 1 }} placeholder="Menge" value={ing.amount}
                onChange={(e) => updateIngredient(idx, "amount", e.target.value)} />
              <select className="nest-select" style={{ flex: 1 }} value={ing.unit}
                onChange={(e) => updateIngredient(idx, "unit", e.target.value)}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <button className="nest-btn nest-btn-ghost nest-btn-sm" onClick={() => removeIngredient(idx)} aria-label="Entfernen">✕</button>
            </div>
          </div>
        ))}
        <button className="nest-btn nest-btn-sm" onClick={addIngredient}>+ Zutat</button>
      </Field>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button className="nest-btn nest-btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={handleSave}>
          Speichern
        </button>
        {initial && <button className="nest-btn nest-btn-danger" onClick={() => onDelete(initial.id)}>Löschen</button>}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* REZEPT-VERFÜGBARKEIT                                                    */
/* ---------------------------------------------------------------------- */

/* ingredient kann ein String (nur Kategorie, Altformat) oder ein Objekt
   { name, product } sein. Ist ein konkretes Produkt angegeben (z.B.
   „Makkaroni“), zählt NUR ein Vorratsartikel mit passendem Produktnamen als
   ausreichender Bestand – ein anderes Produkt derselben Lebensmittelgruppe
   (z.B. „Spaghetti“) gilt dann nicht automatisch als Ersatz, wird aber als
   Alternative vorgeschlagen. Ist kein Produkt verlangt, reicht jedes Produkt
   der Kategorie.
   Rückgabe: { exact, alternatives, categoryMatches } */
function matchIngredient(ingredient, inventory) {
  const ing = typeof ingredient === "string" ? { name: ingredient } : ingredient;
  const needleProduct = (ing.product || "").trim().toLowerCase();
  const needleName = (ing.name || "").trim().toLowerCase();

  const categoryMatches = inventory.filter((item) => {
    const hay = (item.name || "").trim().toLowerCase();
    return hay && (hay === needleName || hay.includes(needleName) || needleName.includes(hay));
  });

  if (needleProduct) {
    const productMatches = (list) => list.filter((item) => {
      const hayProduct = (item.product || "").trim().toLowerCase();
      return hayProduct && (hayProduct === needleProduct || hayProduct.includes(needleProduct) || needleProduct.includes(hayProduct));
    });
    // Alle passenden Vorratseinträge (nicht nur der erste) – werden beim
    // Verfügbarkeits-Check zusammengerechnet und beim Kochen nacheinander abgezogen.
    // Kein globaler Fallback: ein konkretes Produkt zählt nur innerhalb der
    // passenden Lebensmittelgruppe (categoryMatches) als Treffer.
    const matches = productMatches(categoryMatches);
    const exact = matches[0] || null;
    const alternatives = categoryMatches.filter((item) => !matches.some((m) => m.id === item.id) && item.quantity > 0);
    return { exact, matches, alternatives, categoryMatches };
  }

  return { exact: categoryMatches[0] || null, matches: categoryMatches, alternatives: [], categoryMatches };
}

function ingredientLabel(ing) {
  return ing.product ? ing.product : ing.name;
}

/* Einheiten-Umrechnung: g/kg und ml/l. Andere Einheiten (Stück, Packung, …)
   werden nur bei exakter Übereinstimmung verglichen. */
const UNIT_GROUPS = {
  g: { group: "weight", factor: 1 },
  kg: { group: "weight", factor: 1000 },
  ml: { group: "volume", factor: 1 },
  l: { group: "volume", factor: 1000 },
};

function convertQuantity(qty, fromUnit, toUnit) {
  if (fromUnit === toUnit) return qty;
  const from = UNIT_GROUPS[fromUnit];
  const to = UNIT_GROUPS[toUnit];
  if (!from || !to || from.group !== to.group) return null; // nicht umrechenbar
  const base = qty * from.factor;
  return base / to.factor;
}

/* Zwei Packungsgrößen gelten nur als gleich, wenn beide fehlen oder Menge
   und Einheit exakt übereinstimmen. */
function packageSizeEqual(a, b) {
  const aEmpty = !a || !a.amount;
  const bEmpty = !b || !b.amount;
  if (aEmpty || bEmpty) return aEmpty && bEmpty;
  return Number(a.amount) === Number(b.amount) && a.unit === b.unit;
}

/* Verfügbare Menge eines Inventar-Eintrags, ausgedrückt in der Rezept-Einheit.
   Rechnet bei Bedarf über die optionale Packungsgröße um (z.B. Vorrat in
   „Packung“, Rezept verlangt „g“). null = Einheiten sind nicht vergleichbar. */
function availableInUnit(item, unit) {
  const direct = convertQuantity(item.quantity, item.unit, unit);
  if (direct !== null) return direct;
  if (item.packageSize?.amount && item.packageSize?.unit) {
    const totalInPackageUnit = item.quantity * Number(item.packageSize.amount);
    return convertQuantity(totalInPackageUnit, item.packageSize.unit, unit);
  }
  return null;
}

/* Zieht `amount unit` von einem Vorratsartikel ab und liefert die neue Menge
   (in item.unit, nie negativ). Rechnet bei Bedarf über die Packungsgröße um. */
function deductFromItem(item, amount, unit) {
  const direct = convertQuantity(amount, unit, item.unit);
  if (direct !== null) {
    return Math.max(0, Math.round((item.quantity - direct) * 100) / 100);
  }
  if (item.packageSize?.amount && item.packageSize?.unit) {
    const inPackageUnit = convertQuantity(amount, unit, item.packageSize.unit);
    if (inPackageUnit !== null) {
      const packagesNeeded = inPackageUnit / Number(item.packageSize.amount);
      return Math.max(0, Math.round((item.quantity - packagesNeeded) * 1000) / 1000);
    }
  }
  return item.quantity; // nicht umrechenbar – Bestand bleibt unverändert
}

/* Zieht `amount unit` nacheinander von mehreren passenden Vorratseinträgen ab
   (z.B. zwei Packungen derselben Zutat werden zusammengerechnet). Reihenfolge:
   zuerst der Eintrag mit dem früheren Ablaufdatum (kein Ablaufdatum zuletzt).
   Ein Eintrag wird nie negativ – reicht ein Eintrag nicht aus, wird der Rest
   vom nächsten passenden Eintrag abgezogen, bis die Menge aufgebraucht ist
   oder keine passenden Einträge mehr übrig sind.
   Rückgabe: { updates: { [itemId]: neueMenge }, remaining, usedItems } */
function deductAmountAcrossItems(items, amount, unit) {
  const ordered = [...items].sort((a, b) => {
    const ea = a.expiry ? parseISO(a.expiry).getTime() : Infinity;
    const eb = b.expiry ? parseISO(b.expiry).getTime() : Infinity;
    return ea - eb;
  });
  let remaining = amount;
  const updates = {};
  const usedItems = [];
  for (const item of ordered) {
    if (remaining <= 1e-9) break;
    const available = availableInUnit(item, unit);
    if (available === null || available <= 0) continue;
    const take = Math.min(available, remaining);
    if (take <= 1e-9) continue;
    updates[item.id] = deductFromItem(item, take, unit);
    usedItems.push(item);
    remaining -= take;
  }
  return { updates, remaining: Math.max(0, Math.round(remaining * 1e6) / 1e6), usedItems };
}

/* substitutes: optionale Zuordnung { ingredientIndex: inventoryItemId }, mit
   der ein Nutzer statt des fehlenden konkreten Produkts ein vorhandenes
   Ersatzprodukt auswählen kann. */
function analyzeRecipe(recipe, inventory, substitutes = {}) {
  // Abgelaufene Lebensmittel gelten nicht als verfügbare Zutat.
  const usable = inventory.filter((i) => urgencyOfExpiry(i.expiry) !== "abgelaufen");
  const missing = [];
  const soonExpiringUsed = [];
  recipe.ingredients.forEach((ing, idx) => {
    const match = matchIngredient(ing, usable);
    const subId = substitutes[idx];
    const sub = subId ? usable.find((i) => i.id === subId) : null;
    // Mehrere passende Vorratseinträge (z.B. zwei angebrochene Packungen der
    // gleichen Zutat) zählen zusammen; ein gewähltes Ersatzprodukt ersetzt sie.
    const items = (sub ? [sub] : match.matches).filter((item) => item.quantity > 0);

    if (items.length === 0) {
      const entry = { ...ing, idx };
      if (ing.product && match.alternatives.length > 0) {
        entry.alternativeNote = `${ingredientLabel(ing)} fehlen. Andere ${ing.name} sind vorhanden.`;
        entry.alternatives = match.alternatives.map((a) => ({ id: a.id, label: a.product || a.name, quantity: a.quantity, unit: a.unit }));
      }
      missing.push(entry);
      return;
    }
    const convertible = items.filter((item) => availableInUnit(item, ing.unit) !== null);
    if (convertible.length === 0) {
      // Einheiten nicht vergleichbar – nur Vorhandensein prüfen, als Hinweis markieren.
      const item = items[0];
      missing.push({ ...ing, idx, incompatibleUnit: true, itemLabel: item.product || item.name, itemQuantity: item.quantity, itemUnit: item.unit });
      return;
    }
    const available = convertible.reduce((sum, item) => sum + availableInUnit(item, ing.unit), 0);
    if (available + 1e-9 < ing.amount) {
      const missingAmount = Math.round((ing.amount - available) * 100) / 100;
      const entry = { ...ing, idx, amount: missingAmount, partial: available > 0 };
      if (ing.product && match.alternatives.length > 0 && !sub) {
        entry.alternativeNote = `${ingredientLabel(ing)} fehlen. Andere ${ing.name} sind vorhanden.`;
        entry.alternatives = match.alternatives.map((a) => ({ id: a.id, label: a.product || a.name, quantity: a.quantity, unit: a.unit }));
      }
      missing.push(entry);
    } else {
      const { usedItems } = deductAmountAcrossItems(convertible, ing.amount, ing.unit);
      usedItems.forEach((item) => {
        const urgency = urgencyOfExpiry(item.expiry);
        if (urgency === "heute" || urgency === "bald") soonExpiringUsed.push(item.name);
      });
    }
  });
  return { missing, soonExpiringUsed, cookable: missing.length === 0 };
}

function RecipeCard({ recipe, inventory, onEdit, onAddMissing, onPlan }) {
  const [substitutes, setSubstitutes] = useState({});
  const analysis = useMemo(() => analyzeRecipe(recipe, inventory, substitutes), [recipe, inventory, substitutes]);
  return (
    <div className="nest-card" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ cursor: "pointer", flex: 1 }} onClick={() => onEdit(recipe)}>
          <div className="serif" style={{ fontSize: 17 }}>{recipe.name}</div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 2 }}>{recipe.description}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <span className="nest-chip">⏱ {recipe.prepTime} Min</span>
        <span className="nest-chip">🍽 {recipe.servings} Portionen</span>
        <span className="nest-chip">{recipe.category}</span>
      </div>
      {analysis.cookable ? (
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--sage)", fontWeight: 800 }}>
          ✅ Alle Zutaten vorhanden
          {analysis.soonExpiringUsed.length > 0 && (
            <span style={{ color: "var(--gold)", marginLeft: 6 }}>· nutzt bald ablaufende Zutaten</span>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--red)" }}>
          {analysis.missing.map((m) => (
            <div key={m.idx} style={{ marginBottom: 6 }}>
              <div>
                {m.incompatibleUnit
                  ? `${ingredientLabel(m)}: Einheiten nicht vergleichbar (Rezept ${m.amount} ${m.unit}, Vorrat ${formatDE(m.itemQuantity)} ${m.itemUnit}) – bitte prüfen.`
                  : `${ingredientLabel(m)} fehlt${m.amount ? ` (${formatDE(m.amount)} ${m.unit})` : ""}`}
              </div>
              {m.alternativeNote && !substitutes[m.idx] && (
                <div className="nest-alt-note">
                  {m.alternativeNote}{" "}
                  <select className="nest-select" style={{ display: "inline-block", width: "auto", marginTop: 4, fontSize: 12.5, padding: "4px 8px" }}
                    value="" onChange={(e) => e.target.value && setSubstitutes((prev) => ({ ...prev, [m.idx]: e.target.value }))}>
                    <option value="">Ersatzprodukt wählen…</option>
                    {m.alternatives.map((a) => (
                      <option key={a.id} value={a.id}>{a.label} ({formatDE(a.quantity)} {a.unit})</option>
                    ))}
                  </select>
                </div>
              )}
              {substitutes[m.idx] && (
                <div className="nest-alt-note" style={{ color: "var(--sage)" }}>
                  Ersatz ausgewählt.{" "}
                  <button className="nest-btn nest-btn-sm nest-btn-ghost" style={{ padding: "2px 8px" }}
                    onClick={() => setSubstitutes((prev) => { const next = { ...prev }; delete next[m.idx]; return next; })}>
                    Zurücksetzen
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {onPlan && <button className="nest-btn nest-btn-sm" onClick={() => onPlan(recipe)}>Einplanen</button>}
        {!analysis.cookable && (
          <button className="nest-btn nest-btn-sm" onClick={() => onAddMissing(recipe, analysis.missing)}>
            Fehlendes zur Liste
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* NOTIZ-MODAL                                                             */
/* ---------------------------------------------------------------------- */

function NoteModal({ initial, onSave, onDelete, onClose }) {
  const [text, setText] = useState(initial?.text || "");
  return (
    <Modal title={initial ? "Notiz bearbeiten" : "Neue Notiz"} onClose={onClose}>
      <Field label="Notiz">
        <textarea className="nest-textarea" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="nest-btn nest-btn-primary" style={{ flex: 1, justifyContent: "center" }}
          onClick={() => text.trim() && onSave({ id: initial?.id || uid(), text: text.trim() })}>
          Speichern
        </button>
        {initial && <button className="nest-btn nest-btn-danger" onClick={() => onDelete(initial.id)}>Löschen</button>}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* MAHLZEIT-PLANEN-MODAL (Tag wählen für Rezept)                           */
/* ---------------------------------------------------------------------- */

function PlanMealModal({ recipe, onConfirm, onClose }) {
  const [date, setDate] = useState(todayStr());
  return (
    <Modal title={`„${recipe.name}“ einplanen`} onClose={onClose}>
      <Field label="Datum">
        <input type="date" className="nest-input" value={date} onChange={(e) => setDate(e.target.value)} autoFocus />
      </Field>
      <button className="nest-btn nest-btn-primary" style={{ width: "100%", justifyContent: "center" }}
        onClick={() => onConfirm(date)}>
        Einplanen
      </button>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* KOCH-BESTÄTIGUNG (vor dem Abziehen der Vorräte)                         */
/* ---------------------------------------------------------------------- */

function CookConfirmModal({ recipe, inventory, onAddMissing, onConfirm, onClose }) {
  const [substitutes, setSubstitutes] = useState({});
  const analysis = useMemo(() => analyzeRecipe(recipe, inventory, substitutes), [recipe, inventory, substitutes]);
  const usable = useMemo(() => inventory.filter((i) => urgencyOfExpiry(i.expiry) !== "abgelaufen"), [inventory]);

  const rows = recipe.ingredients.map((ing, idx) => {
    const match = matchIngredient(ing, usable);
    const subId = substitutes[idx];
    const sub = subId ? usable.find((i) => i.id === subId) : null;
    // Mehrere passende Vorratseinträge werden für die Anzeige zusammengerechnet.
    const items = (sub ? [sub] : match.matches).filter((i) => i.quantity > 0);
    const convertible = items.filter((i) => availableInUnit(i, ing.unit) !== null);
    const item = items[0] || null;
    const available = convertible.length > 0 ? convertible.reduce((sum, i) => sum + availableInUnit(i, ing.unit), 0) : null;
    const missingEntry = analysis.missing.find((m) => m.idx === idx);
    return { ing, idx, item, available, missingEntry, match };
  });

  return (
    <Modal title={`„${recipe.name}“ als gekocht markieren`} onClose={onClose}>
      <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 10 }}>
        Diese Mengen werden von den Vorräten abgezogen:
      </div>
      <div className="nest-card" style={{ padding: "6px 16px" }}>
        {rows.map(({ ing, idx, item, available, missingEntry }) => (
          <div className="nest-cook-row" key={idx}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{ingredientLabel(ing)}</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>
                Benötigt: {formatDE(ing.amount)} {ing.unit}
                {item && missingEntry?.incompatibleUnit && ` · Vorrat: ${formatDE(item.quantity)} ${item.unit} (Einheiten nicht vergleichbar)`}
                {item && !missingEntry?.incompatibleUnit && available !== null && ` · Vorhanden: ${formatDE(available)} ${ing.unit}`}
                {!item && " · nicht auf Lager"}
              </div>
              {missingEntry?.alternativeNote && !substitutes[idx] && (
                <div className="nest-alt-note">
                  {missingEntry.alternativeNote}{" "}
                  <select className="nest-select" style={{ display: "inline-block", width: "auto", marginTop: 4, fontSize: 12.5, padding: "4px 8px" }}
                    value="" onChange={(e) => e.target.value && setSubstitutes((prev) => ({ ...prev, [idx]: e.target.value }))}>
                    <option value="">Ersatzprodukt wählen…</option>
                    {missingEntry.alternatives.map((a) => (
                      <option key={a.id} value={a.id}>{a.label} ({formatDE(a.quantity)} {a.unit})</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <span className="nest-chip" style={{
              background: !missingEntry ? "var(--sage-tint)" : "var(--red-tint)",
              color: !missingEntry ? "var(--sage)" : "var(--red)",
              flexShrink: 0,
            }}>
              {!missingEntry ? "✓ ausreichend" : missingEntry.incompatibleUnit ? "prüfen" : "fehlt"}
            </span>
          </div>
        ))}
      </div>

      {analysis.cookable ? (
        <button className="nest-btn nest-btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 14 }}
          onClick={() => onConfirm(substitutes)}>
          Bestätigen und Vorräte abziehen
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          <div style={{ fontSize: 13, color: "var(--red)" }}>
            Es fehlen noch Zutaten. Die Mahlzeit gilt erst nach deiner Bestätigung als gekocht.
          </div>
          <button className="nest-btn" onClick={() => { onAddMissing(recipe, analysis.missing); onClose(); }}>
            Fehlendes zur Einkaufsliste
          </button>
          <button className="nest-btn nest-btn-primary" style={{ justifyContent: "center" }} onClick={() => onConfirm(substitutes)}>
            Trotzdem fortfahren
          </button>
          <button className="nest-btn nest-btn-ghost" style={{ justifyContent: "center" }} onClick={onClose}>
            Abbrechen
          </button>
        </div>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* EINKAUF → VORRAT ÜBERNEHMEN                                             */
/* ---------------------------------------------------------------------- */

function guessLocation(category) {
  if (category === "tiefkuehl") return "freezer";
  if (["milchprodukte", "fleisch-fisch", "obst-gemuese"].includes(category)) return "fridge";
  return "pantry";
}

function PurchaseTransferModal({ items, onConfirm, onClose }) {
  const [rows, setRows] = useState(() => items.map((s) => ({
    shoppingId: s.id, include: true, name: s.name, product: "", category: s.category,
    quantity: s.quantity, unit: s.unit, location: guessLocation(s.category),
  })));

  const update = (idx, field, value) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const includedCount = rows.filter((r) => r.include).length;

  const handleConfirm = () => {
    const transfers = rows.filter((r) => r.include).map((r) => ({
      ...r, product: r.product.trim(), quantity: Number(r.quantity) || 0,
    }));
    if (transfers.length === 0) return;
    onConfirm(transfers);
  };

  return (
    <Modal title="Gekaufte Artikel in den Vorrat übernehmen" onClose={onClose} wide>
      <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12 }}>
        Vorratsort wählen und optional die konkrete Produktsorte angeben.
      </div>
      {rows.map((r, idx) => (
        <div key={r.shoppingId} style={{ marginBottom: 12, padding: 12, borderRadius: 12, background: "var(--card-2)" }}>
          <label className="nest-checkbox-row" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={r.include} onChange={(e) => update(idx, "include", e.target.checked)} />
            {r.name} · {formatDE(r.quantity)} {r.unit}
          </label>
          {r.include && (
            <>
              <div className="nest-grid-2" style={{ marginBottom: 8 }}>
                <input className="nest-input" placeholder="konkretes Produkt (optional)" value={r.product}
                  onChange={(e) => update(idx, "product", e.target.value)} />
                <select className="nest-select" value={r.location} onChange={(e) => update(idx, "location", e.target.value)}>
                  {INVENTORY_LOCATIONS.map((l) => <option key={l.id} value={l.id}>{l.icon} {l.label}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
      ))}
      <button className="nest-btn nest-btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
        disabled={includedCount === 0} onClick={handleConfirm}>
        {includedCount} Artikel übernehmen
      </button>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* INFO-LISTEN-MODAL (für klickbare Dashboard-Kacheln)                     */
/* ---------------------------------------------------------------------- */

function InfoListModal({ title, icon, rows, emptyIcon, emptyText, actionLabel, onAction, onRowClick, onClose }) {
  return (
    <Modal title={`${icon} ${title}`} onClose={onClose}>
      {rows.length === 0 ? (
        <EmptyState icon={emptyIcon || "🌷"} title={emptyText} />
      ) : (
        <div className="nest-card" style={{ padding: "4px 16px" }}>
          {rows.map((row, idx) => (
            <div className="nest-task-row" key={idx}
              style={onRowClick && row.item ? { cursor: "pointer" } : undefined}
              onClick={onRowClick && row.item ? () => { onRowClick(row.item); onClose(); } : undefined}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{row.primary}</div>
                {row.secondary && <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>{row.secondary}</div>}
              </div>
              {row.chip && (
                <span className="nest-chip" style={{
                  background: row.urgent ? "var(--red-tint)" : "var(--gold-tint)",
                  color: row.urgent ? "var(--red)" : "var(--gold)",
                }}>{row.chip}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {actionLabel && (
        <button className="nest-btn nest-btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 14 }}
          onClick={() => { onAction(); onClose(); }}>
          {actionLabel}
        </button>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* SEITE: DASHBOARD                                                        */
/* ---------------------------------------------------------------------- */

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return "Guten Morgen";
  if (h < 18) return "Guten Tag";
  return "Guten Abend";
}

/* Kurzer Vorschautext für Dashboard-Kacheln, z.B. "Milch, Reis, Nudeln …" */
function previewLine(labels, limit = 3) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, limit).join(", ");
  return labels.length > limit ? `${shown} …` : shown;
}

function DashboardPage({ state, actions, openModal, setPage, navigate }) {
  const { settings, tasks, shopping, inventory, recipes, mealPlan } = state;
  const t = todayStr();

  const todayTasks = useMemo(() => {
    return tasks
      .filter((task) => !task.completed && task.date <= t)
      .sort((a, b) => {
        const pr = { high: 0, medium: 1, low: 2 };
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return pr[a.priority] - pr[b.priority];
      });
  }, [tasks, t]);

  const upcoming = useMemo(() => {
    const days = [0, 1, 2, 3].map((n) => addDays(t, n));
    return days.map((d) => ({
      date: d,
      count: tasks.filter((task) => !task.completed && task.date === d).length,
    }));
  }, [tasks, t]);

  const expiringSoon = useMemo(() => {
    return inventory
      .filter((i) => i.expiry && ["heute", "bald", "abgelaufen"].includes(urgencyOfExpiry(i.expiry)))
      .sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
  }, [inventory]);

  const lowStock = useMemo(() => inventory.filter((i) => i.quantity <= i.minStock), [inventory]);

  const suggestions = useMemo(() => {
    return lowStock
      .filter((i) => !state.ignoredSuggestions?.includes(i.id))
      .filter((i) => !shopping.some((s) => !s.checked && s.name.toLowerCase() === ingredientLabel(i).toLowerCase()));
  }, [lowStock, shopping, state.ignoredSuggestions]);

  // Wochenfortschritt: nur Aufgaben, deren Termin in der aktuellen Kalenderwoche liegt.
  const weekDates = useMemo(() => weekDatesFor(t, settings.weekStart), [t, settings.weekStart]);
  const weekTasks = useMemo(() => {
    const weekDateSet = new Set(weekDates);
    return tasks.filter((tk) => weekDateSet.has(tk.date));
  }, [tasks, weekDates]);
  const cleaningProgress = weekTasks.length
    ? Math.round((weekTasks.filter((tk) => tk.completed).length / weekTasks.length) * 100)
    : 0;

  // Kompakte Essensplan-Vorschau für die aktuelle Kalenderwoche.
  const weekMeals = useMemo(() => {
    return weekDates.map((d) => ({
      date: d,
      recipe: recipes.find((r) => r.id === mealPlan[d]) || null,
    }));
  }, [weekDates, recipes, mealPlan]);
  const mealPlanCount = weekMeals.filter((m) => m.recipe).length;

  const uncheckedShoppingItems = useMemo(() => shopping.filter((s) => !s.checked), [shopping]);
  const uncheckedShopping = uncheckedShoppingItems.length;

  const cookable = useMemo(() => {
    return recipes
      .map((r) => ({ recipe: r, analysis: analyzeRecipe(r, inventory) }))
      .filter((x) => x.analysis.cookable)
      .sort((a, b) => b.analysis.soonExpiringUsed.length - a.analysis.soonExpiringUsed.length)
      .map((x) => x.recipe);
  }, [recipes, inventory]);

  const byPerson = useMemo(() => {
    const groups = { person1: [], person2: [], gemeinsam: [] };
    todayTasks.filter((tk) => tk.date === t).forEach((tk) => groups[tk.assignee]?.push(tk));
    return groups;
  }, [todayTasks, t]);

  const openShoppingList = () => openModal("infoList", {
    title: "Einkaufen", icon: "🛒",
    rows: uncheckedShoppingItems.map((s) => ({ primary: s.name, secondary: `${formatDE(s.quantity)} ${s.unit}`, item: s })),
    emptyIcon: "🛒", emptyText: "Die Einkaufsliste ist leer.",
    actionLabel: "Zur Einkaufsliste", onAction: () => navigate("einkaufen", { type: "open" }),
    onRowClick: (item) => openModal("shopping", item),
  });

  const openLowStockList = () => openModal("infoList", {
    title: "Bald leer", icon: "⚠️",
    rows: lowStock.map((i) => ({
      primary: i.product || i.name,
      secondary: `${formatDE(i.quantity)} ${i.unit} übrig · Mindestbestand ${formatDE(i.minStock)} ${i.unit}`,
      item: i,
    })),
    emptyIcon: "🥫", emptyText: "Alle Vorräte sind gut gefüllt.",
    actionLabel: "Zu den Vorräten", onAction: () => navigate("vorraete", { type: "lowStock" }),
    onRowClick: (item) => openModal("inventory", item),
  });

  const openExpiringList = () => openModal("infoList", {
    title: "Bald ablaufend", icon: "⏰",
    rows: expiringSoon.map((i) => {
      const u = urgencyOfExpiry(i.expiry);
      return {
        primary: i.product || i.name,
        secondary: i.expiry ? `Haltbar bis ${formatHuman(i.expiry)}` : "",
        chip: u === "abgelaufen" ? "abgelaufen" : u === "heute" ? "heute" : "bald",
        urgent: u === "abgelaufen" || u === "heute",
        item: i,
      };
    }),
    emptyIcon: "⏰", emptyText: "Nichts läuft bald ab.",
    actionLabel: "Zu den Vorräten", onAction: () => navigate("vorraete", { type: "expiring" }),
    onRowClick: (item) => openModal("inventory", item),
  });

  const lowStockPreview = previewLine(lowStock.map((i) => i.product || i.name));
  const expiringPreview = previewLine(expiringSoon.map((i) => i.product || i.name));
  const shoppingPreview = previewLine(uncheckedShoppingItems.map((s) => s.name));

  return (
    <div>
      <h1 className="nest-page-title">{greeting()}{settings.person1Name ? `, ${settings.person1Name}` : ""} 🌷</h1>
      <p className="nest-page-sub">
        {formatHuman(t)} · Heute {tasks.filter((tk) => !tk.completed && tk.date === t).length + expiringSoon.filter(i => urgencyOfExpiry(i.expiry) === "heute" || urgencyOfExpiry(i.expiry) === "abgelaufen").length} Dinge im Blick
      </p>

      <div className="nest-section">
        <div className="nest-fab-row">
          <button className="nest-fab" onClick={() => openModal("task", { date: t })}><span className="nest-fab-icon">➕</span>Aufgabe</button>
          <button className="nest-fab" onClick={() => openModal("shopping")}><span className="nest-fab-icon">🛒</span>Einkauf</button>
          <button className="nest-fab" onClick={() => openModal("inventory")}><span className="nest-fab-icon">🥫</span>Lebensmittel</button>
          <button className="nest-fab" onClick={() => openModal("recipe")}><span className="nest-fab-icon">🍝</span>Rezept</button>
          <button className="nest-fab" onClick={() => openModal("note")}><span className="nest-fab-icon">📝</span>Notiz</button>
        </div>
      </div>

      {(expiringSoon.length > 0 || suggestions.length > 0) && (
        <div className="nest-section">
          <div className="nest-section-title" style={{ marginBottom: 10 }}>⚠️ Das solltest du wissen</div>
          {expiringSoon.slice(0, 4).map((item) => {
            const u = urgencyOfExpiry(item.expiry);
            return (
              <div key={item.id} className={`nest-banner ${u === "abgelaufen" || u === "heute" ? "nest-banner-urgent" : ""}`} style={{ cursor: "pointer" }} onClick={openExpiringList}>
                <span>{shoppingCategoryMeta(item.category).icon}</span>
                <span><strong>{item.product || item.name}</strong> {u === "abgelaufen" ? "ist abgelaufen" : u === "heute" ? "läuft heute ab" : "sollte bald verbraucht werden"}</span>
              </div>
            );
          })}
          {suggestions.slice(0, 3).map((item) => (
            <div key={item.id} className="nest-banner">
              <span>🛒</span>
              <span><strong>{item.product || item.name}</strong> ist fast leer – auf die Einkaufsliste?</span>
              <div className="nest-banner-actions">
                <button className="nest-btn nest-btn-sm nest-btn-primary" onClick={() => actions.addSuggestionToShopping(item)}>Hinzufügen</button>
                <button className="nest-btn nest-btn-sm nest-btn-ghost" onClick={() => actions.ignoreSuggestion(item.id)}>Ignorieren</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="nest-section">
        <div className="nest-section-head">
          <div className="nest-section-title">Heute</div>
          <button className="nest-btn nest-btn-sm nest-btn-ghost" onClick={() => openModal("task", { date: t })}>+ Aufgabe</button>
        </div>
        <div className="nest-card">
          {todayTasks.length === 0 ? (
            <EmptyState icon="🌷" title="Für heute ist nichts geplant." actionLabel="Aufgabe hinzufügen" onAction={() => openModal("task", { date: t })} />
          ) : (
            todayTasks.map((task) => (
              <TaskRow key={task.id} task={task} settings={settings} onToggle={actions.toggleTask} onEdit={(tk) => openModal("task", tk)} />
            ))
          )}
        </div>
      </div>
     
      <div className="nest-section">
        <div className="nest-section-title" style={{ marginBottom: 10 }}>Was steht an?</div>
        <div className="nest-grid-4">
          {upcoming.map((u, idx) => (
            <div key={u.date} className="nest-metric">
              <div className="nest-metric-label">{idx === 0 ? "Heute" : relativeLabel(u.date)}</div>
              <div className="nest-metric-value">{u.count}</div>
            </div>
          ))}
        </div>
      </div>

      {(byPerson.person1.length > 0 || byPerson.person2.length > 0 || byPerson.gemeinsam.length > 0) && (
        <div className="nest-section">
          <div className="nest-section-title" style={{ marginBottom: 10 }}>Wer macht was?</div>
          <div className="nest-grid-2">
            {["person1", "person2"].map((p) => (
              <div key={p} className="nest-card" style={{ padding: 14 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>{assigneeIcon(p)} {assigneeLabel(p, settings)}</div>
                {byPerson[p].length === 0 ? <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Nichts geplant</div> :
                  byPerson[p].map((tk) => <div key={tk.id} style={{ fontSize: 13.5, marginBottom: 4 }}>{categoryMeta(tk.category).icon} {tk.title}</div>)}
              </div>
            ))}
          </div>
          {byPerson.gemeinsam.length > 0 && (
            <div className="nest-card" style={{ padding: 14, marginTop: 14 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>👫 Gemeinsam</div>
              {byPerson.gemeinsam.map((tk) => <div key={tk.id} style={{ fontSize: 13.5, marginBottom: 4 }}>{categoryMeta(tk.category).icon} {tk.title}</div>)}
            </div>
          )}
        </div>
      )}

      <div className="nest-section">
        <div className="nest-section-head">
          <div className="nest-section-title">🍝 Diese Woche</div>
          <button className="nest-btn nest-btn-sm nest-btn-ghost" onClick={() => navigate("essen", { type: "currentWeek" })}>Wochenplan öffnen</button>
        </div>
        <div className="nest-card" style={{ cursor: "pointer" }} onClick={() => navigate("essen", { type: "currentWeek" })}>
          {weekMeals.map((m) => (
            <div className="nest-weekplan-row" key={m.date}>
              <span className={`nest-weekplan-day ${m.date === t ? "today" : ""}`}>{WEEKDAYS_SHORT[weekdayIndex(m.date)]}</span>
              <span style={{ fontSize: 14, flex: 1, color: m.recipe ? "var(--ink)" : "var(--ink-soft)", fontWeight: m.recipe ? 700 : 500 }}>
                {m.recipe ? m.recipe.name : "Noch nichts geplant"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="nest-section">
        <div className="nest-section-title" style={{ marginBottom: 10 }}>Übersicht</div>
        <div className="nest-grid-3">
          <button className="nest-metric nest-metric-click" onClick={() => navigate("haushalt", { type: "currentWeek" })}>
            <div className="nest-metric-label">🧹 Haushalt (diese Woche)</div>
            <div className="nest-metric-value">{cleaningProgress}%</div>
            <div className="nest-progress-track" style={{ marginTop: 8 }}>
              <div className="nest-progress-fill" style={{ width: `${cleaningProgress}%` }}></div>
            </div>
          </button>
          <button className="nest-metric nest-metric-click" onClick={openShoppingList}>
            <div className="nest-metric-label">🛒 Einkaufen</div>
            <div className="nest-metric-value">{uncheckedShopping}</div>
            <div className="nest-metric-preview">{shoppingPreview || "Nichts offen"}</div>
          </button>
          <button className="nest-metric nest-metric-click" onClick={() => navigate("essen", { type: "currentWeek" })}>
            <div className="nest-metric-label">🍝 Essensplan</div>
            <div className="nest-metric-value">{mealPlanCount}/7</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6 }}>Tage geplant</div>
          </button>
          <button className="nest-metric nest-metric-click" onClick={() => navigate("vorraete", { type: "all" })}>
            <div className="nest-metric-label">🥫 Vorräte</div>
            <div className="nest-metric-value">{inventory.length}</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6 }}>Artikel</div>
          </button>
          <button className="nest-metric nest-metric-click" onClick={openLowStockList}>
            <div className="nest-metric-label">⚠️ Bald leer</div>
            <div className="nest-metric-value">{lowStock.length}</div>
            <div className="nest-metric-preview">{lowStockPreview || "Alles im grünen Bereich"}</div>
          </button>
          <button className="nest-metric nest-metric-click" onClick={openExpiringList}>
            <div className="nest-metric-label">⏰ Bald ablaufend</div>
            <div className="nest-metric-value">{expiringSoon.length}</div>
            <div className="nest-metric-preview">{expiringPreview || "Nichts läuft bald ab"}</div>
          </button>
        </div>
      </div>

      <div className="nest-section">
        <div className="nest-section-head">
          <div className="nest-section-title">Was können wir heute kochen?</div>
        </div>
        {cookable.length === 0 ? (
          <div className="nest-card"><EmptyState icon="🍽️" title="Aktuell reicht der Vorrat für kein gespeichertes Rezept." /></div>
        ) : (
          <div className="nest-grid-auto">
            {cookable.slice(0, 3).map((r) => (
              <RecipeCard key={r.id} recipe={r} inventory={inventory} onEdit={() => openModal("recipe", r)}
                onAddMissing={() => {}} onPlan={(recipe) => openModal("planMeal", recipe)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* SEITE: HAUSHALT (Putzplan)                                              */
/* ---------------------------------------------------------------------- */

function CleaningPage({ state, actions, openModal, pendingFilter, consumeFilter }) {
  const { tasks, settings } = state;
  const [filter, setFilter] = useState("alle");
  const [view, setView] = useState("liste");
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    if (pendingFilter?.type === "currentWeek") {
      setView("woche");
      setWeekOffset(0);
      consumeFilter();
    }
  }, [pendingFilter, consumeFilter]);

  const grouped = useMemo(() => {
    const groups = { überfällig: [], heute: [], morgen: [], später: [], erledigt: [] };
    const t = todayStr();
    tasks.forEach((task) => {
      if (filter !== "alle" && task.category !== filter) return;
      if (task.completed) { groups.erledigt.push(task); return; }
      if (task.date < t) groups["überfällig"].push(task);
      else if (task.date === t) groups.heute.push(task);
      else if (task.date === addDays(t, 1)) groups.morgen.push(task);
      else groups["später"].push(task);
    });
    return groups;
  }, [tasks, filter]);

  const t = todayStr();
  const anchor = addDays(t, weekOffset * 7);
  const weekDays = useMemo(() => weekDatesFor(anchor, settings.weekStart), [anchor, settings.weekStart]);

  return (
    <div>
      <h1 className="nest-page-title">🧹 Haushalt</h1>
      <p className="nest-page-sub">Putzplan, Wäsche und wiederkehrende Aufgaben.</p>

      <div className="nest-section" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div className="nest-pill-select">
          <button className={`nest-pill ${filter === "alle" ? "active" : ""}`} onClick={() => setFilter("alle")}>Alle</button>
          {TASK_CATEGORIES.map((c) => (
            <button key={c.id} className={`nest-pill ${filter === c.id ? "active" : ""}`} onClick={() => setFilter(c.id)}>
              <span>{c.icon}</span>{c.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`nest-btn nest-btn-sm ${view === "liste" ? "nest-btn-primary" : ""}`} onClick={() => setView("liste")}>Liste</button>
          <button className={`nest-btn nest-btn-sm ${view === "woche" ? "nest-btn-primary" : ""}`} onClick={() => setView("woche")}>Woche</button>
          <button className="nest-btn nest-btn-sm nest-btn-primary" onClick={() => openModal("task", { date: t, category: filter !== "alle" ? filter : "putzen" })}>+ Aufgabe</button>
        </div>
      </div>

      {view === "liste" ? (
        <>
          {[
            ["überfällig", "Überfällig"],
            ["heute", "Heute"],
            ["morgen", "Morgen"],
            ["später", "Demnächst"],
          ].map(([key, label]) => (
            grouped[key].length > 0 && (
              <div className="nest-section" key={key}>
                <div className="nest-section-title" style={{ marginBottom: 8, fontSize: 15 }}>{label}</div>
                <div className="nest-card">
                  {grouped[key]
                    .sort((a, b) => (a.date < b.date ? -1 : 1))
                    .map((task) => (
                      <TaskRow key={task.id} task={task} settings={settings} onToggle={actions.toggleTask} onEdit={(tk) => openModal("task", tk)} />
                    ))}
                </div>
              </div>
            )
          ))}
          {grouped["überfällig"].length + grouped.heute.length + grouped.morgen.length + grouped["später"].length === 0 && (
            <div className="nest-card">
              <EmptyState icon="🧹" title="Keine offenen Aufgaben in dieser Ansicht." actionLabel="Aufgabe hinzufügen" onAction={() => openModal("task", { date: t })} />
            </div>
          )}
          {grouped.erledigt.length > 0 && (
            <div className="nest-section">
              <div className="nest-section-title" style={{ marginBottom: 8, fontSize: 15, color: "var(--ink-soft)" }}>Erledigt</div>
              <div className="nest-card">
                {grouped.erledigt.slice(0, 15).map((task) => (
                  <TaskRow key={task.id} task={task} settings={settings} onToggle={actions.toggleTask} onEdit={(tk) => openModal("task", tk)} />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="nest-section" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <button className="nest-btn nest-btn-sm" onClick={() => setWeekOffset((w) => w - 1)}>← Vorherige Woche</button>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="serif" style={{ fontSize: 15 }}>{weekRangeLabel(weekDays)}</span>
              {weekOffset !== 0 && (
                <button className="nest-btn nest-btn-sm nest-btn-ghost" onClick={() => setWeekOffset(0)}>Aktuelle Woche</button>
              )}
            </div>
            <button className="nest-btn nest-btn-sm" onClick={() => setWeekOffset((w) => w + 1)}>Nächste Woche →</button>
          </div>
          <div className="nest-section" style={{ display: "grid", gap: 12 }}>
            {weekDays.map((d) => {
              const dayTasks = tasks.filter((tk) => tk.date === d && (filter === "alle" || tk.category === filter));
              return (
                <div className="nest-card" key={d}>
                  <div style={{ fontWeight: 800, marginBottom: dayTasks.length ? 8 : 0 }}>
                    {d === t ? "Heute" : WEEKDAYS[weekdayIndex(d)]} <span style={{ color: "var(--ink-soft)", fontWeight: 500 }}>· {formatShort(d)}</span>
                  </div>
                  {dayTasks.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Nichts geplant</div>
                  ) : (
                    dayTasks.map((task) => <TaskRow key={task.id} task={task} settings={settings} onToggle={actions.toggleTask} onEdit={(tk) => openModal("task", tk)} />)
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* SEITE: EINKAUFEN                                                        */
/* ---------------------------------------------------------------------- */

function ShoppingPage({ state, actions, openModal, pendingFilter, consumeFilter }) {
  const { shopping, inventory } = state;
  const [onlyOpen, setOnlyOpen] = useState(false);

  useEffect(() => {
    if (pendingFilter?.type === "open") {
      setOnlyOpen(true);
      consumeFilter();
    }
  }, [pendingFilter, consumeFilter]);

  const visible = onlyOpen ? shopping.filter((s) => !s.checked) : shopping;
  const grouped = useMemo(() => {
    const map = {};
    visible.forEach((item) => {
      const key = item.category;
      if (!map[key]) map[key] = [];
      map[key].push(item);
    });
    return map;
  }, [visible]);

  const uncheckedCount = shopping.filter((s) => !s.checked).length;
  const checkedItems = shopping.filter((s) => s.checked);

  return (
    <div>
      <h1 className="nest-page-title">🛒 Einkaufen</h1>
      <p className="nest-page-sub">{uncheckedCount} Artikel offen von {shopping.length}.</p>

      <div className="nest-section" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="nest-btn nest-btn-primary" onClick={() => openModal("shopping")}>+ Artikel</button>
        <div className="nest-pill-select">
          <button className={`nest-pill ${!onlyOpen ? "active" : ""}`} onClick={() => setOnlyOpen(false)}>Alle</button>
          <button className={`nest-pill ${onlyOpen ? "active" : ""}`} onClick={() => setOnlyOpen(true)}>Nur offene</button>
        </div>
        {checkedItems.length > 0 && (
          <button className="nest-btn nest-btn-ghost" onClick={actions.clearCheckedShopping}>Erledigte entfernen</button>
        )}
        {checkedItems.length > 0 && (
          <button className="nest-btn" onClick={() => openModal("purchaseTransfer", checkedItems)}>
            📦 Gekauftes in Vorrat übernehmen ({checkedItems.length})
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="nest-card">
          <EmptyState icon="🛒" title={onlyOpen ? "Keine offenen Artikel." : "Deine Einkaufsliste ist leer."} actionLabel="Artikel hinzufügen" onAction={() => openModal("shopping")} />
        </div>
      ) : (
        SHOPPING_CATEGORIES.filter((c) => grouped[c.id]?.length).map((c) => (
          <div className="nest-section" key={c.id}>
            <div className="nest-section-title" style={{ marginBottom: 8, fontSize: 15 }}>{c.icon} {c.label}</div>
            <div className="nest-card">
              {grouped[c.id].map((item) => (
                <div className="nest-task-row" key={item.id}>
                  <button className={`nest-check ${item.checked ? "done" : ""}`} onClick={() => actions.toggleShopping(item)}>
                    {item.checked ? "✓" : ""}
                  </button>
                  <div style={{ flex: 1, cursor: "pointer" }} onClick={() => openModal("shopping", item)}>
                    <div className={`nest-task-title ${item.checked ? "done" : ""}`}>{item.name}</div>
                    <div className="nest-task-meta">{formatDE(item.quantity)} {item.unit}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* SEITE: ESSEN (Essensplan + Rezepte)                                     */
/* ---------------------------------------------------------------------- */

function MealsPage({ state, actions, openModal, pendingFilter, consumeFilter }) {
  const { recipes, mealPlan, inventory, settings, cookedMeals } = state;
  const [tab, setTab] = useState("plan");
  const [weekOffset, setWeekOffset] = useState(0);
  const t = todayStr();
  const anchor = addDays(t, weekOffset * 7);
  const weekDays = useMemo(() => weekDatesFor(anchor, settings.weekStart), [anchor, settings.weekStart]);

  useEffect(() => {
    if (pendingFilter?.type === "currentWeek") {
      setTab("plan");
      setWeekOffset(0);
      consumeFilter();
    }
  }, [pendingFilter, consumeFilter]);

  const cookableNow = useMemo(() => {
    return recipes
      .map((r) => ({ recipe: r, analysis: analyzeRecipe(r, inventory) }))
      .filter((x) => x.analysis.cookable)
      .sort((a, b) => b.analysis.soonExpiringUsed.length - a.analysis.soonExpiringUsed.length)
      .map((x) => x.recipe);
  }, [recipes, inventory]);

  return (
    <div>
      <h1 className="nest-page-title">🍝 Essen</h1>
      <p className="nest-page-sub">Wochenplan und gespeicherte Rezepte.</p>

      <div className="nest-section" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div className="nest-pill-select">
          <button className={`nest-pill ${tab === "plan" ? "active" : ""}`} onClick={() => setTab("plan")}>Wochenplan</button>
          <button className={`nest-pill ${tab === "rezepte" ? "active" : ""}`} onClick={() => setTab("rezepte")}>Rezepte</button>
        </div>
        {tab === "rezepte" && <button className="nest-btn nest-btn-primary" onClick={() => openModal("recipe")}>+ Rezept</button>}
      </div>

      {tab === "plan" ? (
        <>
          {cookableNow.length > 0 && (
            <div className="nest-section">
              <div className="nest-section-title" style={{ marginBottom: 10 }}>Du hast genug Zutaten für</div>
              <div className="nest-grid-auto">
                {cookableNow.map((r) => (
                  <RecipeCard key={r.id} recipe={r} inventory={inventory} onEdit={() => openModal("recipe", r)}
                    onAddMissing={() => {}} onPlan={(recipe) => openModal("planMeal", recipe)} />
                ))}
              </div>
            </div>
          )}
          <div className="nest-section" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <button className="nest-btn nest-btn-sm" onClick={() => setWeekOffset((w) => w - 1)}>← Vorherige Woche</button>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="serif" style={{ fontSize: 15 }}>{weekRangeLabel(weekDays)}</span>
              {weekOffset !== 0 && (
                <button className="nest-btn nest-btn-sm nest-btn-ghost" onClick={() => setWeekOffset(0)}>Aktuelle Woche</button>
              )}
            </div>
            <button className="nest-btn nest-btn-sm" onClick={() => setWeekOffset((w) => w + 1)}>Nächste Woche →</button>
          </div>
          <div className="nest-section" style={{ display: "grid", gap: 10 }}>
            {weekDays.map((d) => {
              const recipeId = mealPlan[d];
              const recipe = recipes.find((r) => r.id === recipeId);
              const isCooked = cookedMeals?.[d] === recipeId && !!recipeId;
              return (
                <div className="nest-card" key={d} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{d === t ? "Heute" : WEEKDAYS[weekdayIndex(d)]} <span style={{ color: "var(--ink-soft)", fontWeight: 500, fontSize: 13 }}>· {formatShort(d)}</span></div>
                    <div style={{ fontSize: 14.5, marginTop: 4 }}>
                      {recipe ? recipe.name : "Noch nichts geplant"}
                      {isCooked && <span className="nest-chip" style={{ marginLeft: 8, background: "var(--sage-tint)", color: "var(--sage)" }}>✅ Gekocht</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <select className="nest-select" style={{ width: "auto" }} value={recipeId || ""} onChange={(e) => actions.setMealPlan(d, e.target.value || null)}>
                      <option value="">Rezept wählen…</option>
                      {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    {recipe && !isCooked && (
                      <button className="nest-btn nest-btn-sm nest-btn-primary" onClick={() => openModal("cookConfirm", { recipe, date: d })}>Als gekocht markieren</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        recipes.length === 0 ? (
          <div className="nest-card">
            <EmptyState icon="🍝" title="Noch keine Rezepte gespeichert." actionLabel="Erstes Rezept anlegen" onAction={() => openModal("recipe")} />
          </div>
        ) : (
          <div className="nest-grid-auto">
            {recipes.map((r) => (
              <RecipeCard key={r.id} recipe={r} inventory={inventory} onEdit={(rec) => openModal("recipe", rec)}
                onAddMissing={actions.addMissingIngredients} onPlan={(recipe) => openModal("planMeal", recipe)} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* SEITE: VORRÄTE                                                          */
/* ---------------------------------------------------------------------- */

const INVENTORY_STATUS_FILTERS = [
  { id: "alle", label: "Alle" },
  { id: "lowStock", label: "Bald leer" },
  { id: "expiring", label: "Bald ablaufend" },
];

function InventoryPage({ state, actions, openModal, pendingFilter, consumeFilter }) {
  const { inventory } = state;
  const [location, setLocation] = useState("fridge");
  const [statusFilter, setStatusFilter] = useState("alle");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (pendingFilter?.type === "lowStock" || pendingFilter?.type === "expiring" || pendingFilter?.type === "all") {
      setStatusFilter(pendingFilter.type === "all" ? "alle" : pendingFilter.type);
      setSearch("");
      consumeFilter();
    }
  }, [pendingFilter, consumeFilter]);

  const matchesStatus = (item) => {
    if (statusFilter === "lowStock") return item.quantity <= item.minStock;
    if (statusFilter === "expiring") return item.expiry && ["heute", "bald", "abgelaufen"].includes(urgencyOfExpiry(item.expiry));
    return true;
  };
  const matchesSearch = (item) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return item.name.toLowerCase().includes(q) || (item.product || "").toLowerCase().includes(q);
  };

  // Bei „Alle“ zählt zusätzlich der aktive Vorratsort; bei „Bald leer“/„Bald ablaufend“
  // wird ortsübergreifend gefiltert, damit die Dashboard-Kacheln vollständig treffen.
  const items = inventory
    .filter((i) => (statusFilter === "alle" ? i.location === location : true))
    .filter(matchesStatus)
    .filter(matchesSearch);

  const grouped = useMemo(() => {
    const map = {};
    items.forEach((item) => {
      if (!map[item.category]) map[item.category] = [];
      map[item.category].push(item);
    });
    return map;
  }, [items]);

  const emptyTitle = search.trim()
    ? "Keine Treffer für diese Suche."
    : statusFilter === "lowStock"
      ? "Aktuell ist nichts bald leer."
      : statusFilter === "expiring"
        ? "Nichts läuft bald ab."
        : `${INVENTORY_LOCATIONS.find((l) => l.id === location).label} ist noch leer.`;

  return (
    <div>
      <h1 className="nest-page-title">🥫 Vorräte</h1>
      <p className="nest-page-sub">Kühlschrank, Gefrierschrank und Vorratsschrank im Überblick.</p>

      <div className="nest-section" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div className="nest-pill-select">
          {INVENTORY_STATUS_FILTERS.map((f) => (
            <button key={f.id} className={`nest-pill ${statusFilter === f.id ? "active" : ""}`} onClick={() => setStatusFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="nest-btn" onClick={() => openModal("barcodeScan", { location })}>📷 Scannen</button>
          <button className="nest-btn nest-btn-primary" onClick={() => openModal("inventory", { location })}>+ Artikel</button>
        </div>
      </div>

      <div className="nest-section" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        {statusFilter === "alle" ? (
          <div className="nest-pill-select">
            {INVENTORY_LOCATIONS.map((l) => (
              <button key={l.id} className={`nest-pill ${location === l.id ? "active" : ""}`} onClick={() => setLocation(l.id)}>
                <span>{l.icon}</span>{l.label} <span style={{ opacity: 0.6 }}>({inventory.filter((i) => i.location === l.id).length})</span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Alle Vorratsorte</div>
        )}
        <input className="nest-input" style={{ maxWidth: 240 }} placeholder="Suchen…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {items.length === 0 ? (
        <div className="nest-card">
          <EmptyState icon={statusFilter === "lowStock" ? "⚠️" : statusFilter === "expiring" ? "⏰" : INVENTORY_LOCATIONS.find((l) => l.id === location).icon}
            title={emptyTitle}
            actionLabel={statusFilter === "alle" && !search.trim() ? "Lebensmittel hinzufügen" : undefined}
            onAction={statusFilter === "alle" && !search.trim() ? () => openModal("inventory", { location }) : undefined} />
        </div>
      ) : (
        SHOPPING_CATEGORIES.filter((c) => grouped[c.id]?.length).map((c) => (
          <div className="nest-section" key={c.id}>
            <div className="nest-section-title" style={{ marginBottom: 10, fontSize: 15 }}>{c.icon} {c.label}</div>
            <div className="nest-grid-auto">
              {grouped[c.id]
                .sort((a, b) => (a.expiry && b.expiry ? (a.expiry < b.expiry ? -1 : 1) : a.expiry ? -1 : 1))
                .map((item) => (
                  <InventoryCard key={item.id} item={item} onEdit={(it) => openModal("inventory", it)} onQuantity={actions.adjustQuantity} />
                ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}


/* ---------------------------------------------------------------------- */
/* SEITE: EINSTELLUNGEN                                                    */
/* ---------------------------------------------------------------------- */

function SettingsPage({ state, actions, askConfirm }) {
  const { settings, notes } = state;
  const [local, setLocal] = useState(settings);
  const fileInputRef = useRef(null);

  useEffect(() => setLocal(settings), [settings]);

  const save = () => actions.updateSettings(local);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "haushalt-export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        actions.replaceState(parsed);
      } catch {
        alert("Die Datei konnte nicht gelesen werden.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <h1 className="nest-page-title">⚙️ Einstellungen</h1>
      <p className="nest-page-sub">Passe die App an euren Haushalt an.</p>

      <div className="nest-section nest-card">
        <div className="nest-grid-2">
          <Field label="Name Person 1">
            <input className="nest-input" value={local.person1Name} onChange={(e) => setLocal({ ...local, person1Name: e.target.value })} />
          </Field>
          <Field label="Name Person 2">
            <input className="nest-input" value={local.person2Name} onChange={(e) => setLocal({ ...local, person2Name: e.target.value })} />
          </Field>
        </div>
        <Field label="Haushaltsname">
          <input className="nest-input" value={local.householdName} onChange={(e) => setLocal({ ...local, householdName: e.target.value })} />
        </Field>
        <Field label="Wochenstart">
          <select className="nest-select" value={local.weekStart} onChange={(e) => setLocal({ ...local, weekStart: Number(e.target.value) })}>
            <option value={1}>Montag</option>
            <option value={0}>Sonntag</option>
          </select>
        </Field>
        <button className="nest-btn nest-btn-primary" onClick={save}>Speichern</button>
      </div>

      <div className="nest-section">
        <div className="nest-section-title" style={{ marginBottom: 10 }}>📝 Notizen</div>
        <div className="nest-card">
          {notes.length === 0 ? <div style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>Noch keine Notizen.</div> :
            notes.map((n) => (
              <div key={n.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                <span style={{ fontSize: 14 }}>{n.text}</span>
                <button className="nest-btn nest-btn-sm nest-btn-ghost" onClick={() => askConfirm("Notiz wirklich löschen?", () => actions.deleteNote(n.id))}>✕</button>
              </div>
            ))}
        </div>
      </div>

      <div className="nest-section">
        <div className="nest-section-title" style={{ marginBottom: 10 }}>Daten</div>
        <div className="nest-card" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="nest-btn" onClick={exportData}>Exportieren</button>
          <button className="nest-btn" onClick={() => fileInputRef.current?.click()}>Importieren</button>
          <input ref={fileInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={importData} />
          <button className="nest-btn nest-btn-danger" onClick={() => askConfirm("Wirklich alle Daten zurücksetzen?", actions.resetData, { detail: "Alle Aufgaben, Vorräte, Einkäufe, Rezepte und Notizen gehen dabei verloren." })}>
            Daten zurücksetzen
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* NAVIGATION                                                               */
/* ---------------------------------------------------------------------- */

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "🏠" },
  { id: "haushalt", label: "Haushalt", icon: "🧹" },
  { id: "einkaufen", label: "Einkaufen", icon: "🛒" },
  { id: "essen", label: "Essen", icon: "🍝" },
  { id: "vorraete", label: "Vorräte", icon: "🥫" },
  { id: "einstellungen", label: "Einstellungen", icon: "⚙️" },
];

/* ---------------------------------------------------------------------- */
/* APP-ROOT                                                                 */
/* ---------------------------------------------------------------------- */

export default function App() {
  const [state, setState] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [pendingFilter, setPendingFilter] = useState(null);
  const saveTimeout = useRef(null);
  const toastTimeout = useRef(null);

  const notify = useCallback((message, icon) => {
    setToast({ message, icon });
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(null), 2800);
  }, []);

  // Zentrale Sicherheitsabfrage, z.B. vor dem Löschen eines Eintrags.
  const askConfirm = useCallback((message, onConfirm, opts = {}) => {
    setConfirmState({ message, onConfirm, danger: opts.danger !== false, confirmLabel: opts.confirmLabel, detail: opts.detail });
  }, []);
  const closeConfirm = useCallback(() => setConfirmState(null), []);

  // Navigation mit optionalem Filter, z.B. von einer klickbaren Dashboard-Kachel
  // direkt in die passende gefilterte Ansicht springen.
  const navigate = useCallback((pageId, filter) => {
    setPendingFilter(filter || null);
    setPage(pageId);
  }, []);
  const consumeFilter = useCallback(() => setPendingFilter(null), []);

  // Verhindert, dass ein per Realtime empfangenes Update gleich wieder
  // zurückgespeichert wird (Endlosschleife zwischen den Geräten).
  const suppressNextSave = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await storageAdapter.get();
        if (!cancelled) {
          if (result?.value) {
            const parsed = JSON.parse(result.value);
            setState({ ignoredSuggestions: [], mealPlan: {}, notes: [], cookedMeals: {}, ...parsed });
          } else {
            // Noch keine Zeile in Supabase vorhanden -> mit Demo-Daten anlegen,
            // damit beide Geräte von Anfang an denselben Stand haben.
            const demo = buildDemoState();
            setState(demo);
            try { await storageAdapter.set(null, JSON.stringify(demo)); } catch { /* ignorieren */ }
          }
        }
      } catch {
        if (!cancelled) setState(buildDemoState());
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Realtime: Änderungen, die der Partner speichert, live übernehmen.
  useEffect(() => {
    const channel = supabase
      .channel("household_state_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLE, filter: `id=eq.${HOUSEHOLD_ID}` },
        (payload) => {
          const incoming = payload.new?.data;
          if (!incoming) return;
          suppressNextSave.current = true;
          setState({ ignoredSuggestions: [], mealPlan: {}, notes: [], cookedMeals: {}, ...incoming });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!loaded || !state) return;
    if (suppressNextSave.current) {
      // Dieser State-Change kam gerade per Realtime rein -> nicht zurückschreiben.
      suppressNextSave.current = false;
      return;
    }
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      try {
        await storageAdapter.set(null, JSON.stringify(state));
      } catch {
        /* Speichern fehlgeschlagen – App funktioniert weiter, nur ohne Persistenz */
      }
    }, 350);
    return () => clearTimeout(saveTimeout.current);
  }, [state, loaded]);

  const openModal = useCallback((type, payload) => setModal({ type, payload }), []);
  const closeModal = useCallback(() => setModal(null), []);

  // Wird aufgerufen, sobald der Barcode-Scanner einen Code erkannt hat (oder
  // der Code manuell eingetippt wurde). Sucht das Produkt bei Open Food
  // Facts, leitet daraus Warengruppe + Haltbarkeits-Vorschlag ab und öffnet
  // das normale Vorrat-Formular vorausgefüllt zur Kontrolle durch den Nutzer.
  const handleBarcodeScanned = useCallback(async (barcode, location) => {
    try {
      const product = await fetchProductFromBarcode(barcode);
      if (product) {
        const category = mapOffCategoryToInternal(product);
        const name = product.product_name_de || product.product_name || "";
        openModal("inventory", {
          location: LOCATION_BY_CATEGORY[category] || location || "fridge",
          category,
          name,
          product: product.brands || "",
          expiry: suggestExpiryForCategory(category),
          barcode,
        });
      } else {
        notify("Barcode nicht in der Datenbank gefunden – bitte Produkt und Warengruppe manuell eintragen.", "ℹ️");
        openModal("inventory", { location, barcode });
      }
    } catch {
      notify("Suche fehlgeschlagen (keine Verbindung?) – bitte manuell eintragen.", "⚠️");
      openModal("inventory", { location, barcode });
    }
  }, [openModal, notify]);

  // Stabile Referenz, damit der Scanner (und damit die Kamera) nicht bei
  // jedem Hintergrund-Sync neu gestartet wird, solange das Scan-Modal offen ist.
  const handleScanDetected = useCallback(
    (code) => handleBarcodeScanned(code, modal?.payload?.location),
    [handleBarcodeScanned, modal]
  );

  const actions = useMemo(() => ({
    toggleTask: (task) => {
      setState((prev) => {
        // Aktuelle Aufgabe als (nicht-)erledigt markieren; bleibt als Verlauf erhalten.
        let tasks = prev.tasks.map((tk) =>
          tk.id === task.id ? { ...tk, completed: !tk.completed } : tk
        );
        const toggled = tasks.find((tk) => tk.id === task.id);

        // Beim Erledigen einer wiederkehrenden Aufgabe genau eine neue Aufgabe
        // mit dem nächsten Termin erzeugen (gleiche Serien-ID).
        if (toggled.completed && toggled.recurrence?.type && toggled.recurrence.type !== "none") {
          const seriesId = toggled.seriesId || toggled.id;
          if (!toggled.seriesId) {
            tasks = tasks.map((tk) => (tk.id === toggled.id ? { ...tk, seriesId } : tk));
          }
          const nextDate = nextOccurrence(toggled.date, toggled.recurrence);
          const alreadyExists = tasks.some(
            (tk) => tk.seriesId === seriesId && tk.date === nextDate && !tk.completed
          );
          if (nextDate && !alreadyExists) {
            tasks = [
              ...tasks,
              {
                ...toggled,
                id: uid(),
                seriesId,
                date: nextDate,
                completed: false,
              },
            ];
          }
        }
        return { ...prev, tasks };
      });
    },
    saveTask: (task) => {
      setState((prev) => {
        const exists = prev.tasks.some((t) => t.id === task.id);
        const tasks = exists ? prev.tasks.map((t) => (t.id === task.id ? task : t)) : [...prev.tasks, task];
        return { ...prev, tasks };
      });
      closeModal();
      notify("Aufgabe gespeichert.");
    },
    deleteTask: (id) => {
      setState((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== id) }));
      closeModal();
      notify("Aufgabe gelöscht.");
    },
    // Legt einen Artikel neu an oder aktualisiert ihn. Beim Neuanlegen wird
    // geprüft, ob am selben Ort bereits dasselbe Produkt liegt – falls ja,
    // wird die Menge zusammengeführt statt einen doppelten Eintrag anzulegen.
    saveInventory: (item) => {
      let merged = false;
      setState((prev) => {
        const exists = prev.inventory.some((i) => i.id === item.id);
        let inventory;
        if (exists) {
          inventory = prev.inventory.map((i) => (i.id === item.id ? item : i));
        } else {
          const dupIdx = prev.inventory.findIndex((i) =>
            i.location === item.location &&
            i.name.trim().toLowerCase() === item.name.trim().toLowerCase() &&
            (i.product || "").trim().toLowerCase() === (item.product || "").trim().toLowerCase()
          );
          const packageSizeEqual = dupIdx !== -1 && (prev.inventory[dupIdx].packageSize || null) === (item.packageSize || null);
          if (dupIdx !== -1 && prev.inventory[dupIdx].unit === item.unit && packageSizeEqual) {
            merged = true;
            inventory = prev.inventory.map((i, idx) => idx === dupIdx
              ? { ...i, quantity: Math.round((i.quantity + item.quantity) * 100) / 100, expiry: item.expiry || i.expiry, packageSize: item.packageSize || i.packageSize }
              : i);
          } else {
            inventory = [...prev.inventory, item];
          }
        }
        const ignoredSuggestions = (prev.ignoredSuggestions || []).filter((id) => id !== item.id || item.quantity > item.minStock);
        return { ...prev, inventory, ignoredSuggestions };
      });
      closeModal();
      notify(merged ? "Menge zu vorhandenem Artikel hinzugefügt." : "Artikel gespeichert.");
    },
    deleteInventory: (id) => {
      setState((prev) => ({ ...prev, inventory: prev.inventory.filter((i) => i.id !== id) }));
      closeModal();
      notify("Artikel gelöscht.");
    },
    adjustQuantity: (item, delta) => {
      setState((prev) => {
        const inventory = prev.inventory.map((i) => {
          if (i.id !== item.id) return i;
          const nextQty = Math.max(0, Math.round((i.quantity + delta) * 100) / 100);
          return { ...i, quantity: nextQty };
        });
        let ignoredSuggestions = prev.ignoredSuggestions || [];
        const updated = inventory.find((i) => i.id === item.id);
        if (updated && updated.quantity > updated.minStock) {
          ignoredSuggestions = ignoredSuggestions.filter((id) => id !== item.id);
        }
        return { ...prev, inventory, ignoredSuggestions };
      });
    },
    saveShopping: (item) => {
      setState((prev) => {
        const exists = prev.shopping.some((s) => s.id === item.id);
        const shopping = exists ? prev.shopping.map((s) => (s.id === item.id ? item : s)) : [...prev.shopping, item];
        return { ...prev, shopping };
      });
      closeModal();
      notify("Einkaufsartikel gespeichert.");
    },
    deleteShopping: (id) => {
      setState((prev) => ({ ...prev, shopping: prev.shopping.filter((s) => s.id !== id) }));
      closeModal();
      notify("Einkaufsartikel gelöscht.");
    },
    toggleShopping: (item) => {
      setState((prev) => ({ ...prev, shopping: prev.shopping.map((s) => (s.id === item.id ? { ...s, checked: !s.checked } : s)) }));
    },
    clearCheckedShopping: () => {
      setState((prev) => ({ ...prev, shopping: prev.shopping.filter((s) => !s.checked) }));
      notify("Erledigte Artikel entfernt.");
    },
    addSuggestionToShopping: (item) => {
      setState((prev) => ({
        ...prev,
        shopping: [...prev.shopping, { id: uid(), name: item.product || item.name, category: item.category, quantity: 1, unit: item.unit, checked: false }],
        ignoredSuggestions: [...(prev.ignoredSuggestions || []), item.id],
      }));
      notify(`${item.product || item.name} zur Einkaufsliste hinzugefügt.`);
    },
    ignoreSuggestion: (id) => {
      setState((prev) => ({ ...prev, ignoredSuggestions: [...(prev.ignoredSuggestions || []), id] }));
    },
    // Übernimmt gekaufte (abgehakte) Einkaufsartikel in den gewählten Vorratsort.
    // Zusammengeführt wird nur, wenn ein bestehender Vorratsartikel in Gruppe
    // (Name), Produkt, Ort, Einheit UND Packungsgröße exakt übereinstimmt – bei
    // inkompatiblen bzw. abweichenden Einheiten wird NICHT umgerechnet und
    // zusammengeführt, sondern ein separater neuer Vorratsartikel angelegt.
    // Die Einkaufsartikel gelten danach als verarbeitet und werden von der
    // Liste entfernt.
    transferPurchasedToInventory: (transfers) => {
      setState((prev) => {
        let inventory = [...prev.inventory];
        transfers.forEach((t) => {
          const idx = inventory.findIndex((i) =>
            i.location === t.location &&
            i.name.trim().toLowerCase() === t.name.trim().toLowerCase() &&
            (i.product || "").trim().toLowerCase() === (t.product || "").trim().toLowerCase() &&
            i.unit === t.unit &&
            packageSizeEqual(i.packageSize, t.packageSize)
          );
          if (idx !== -1) {
            const item = inventory[idx];
            inventory[idx] = { ...item, quantity: Math.round((item.quantity + t.quantity) * 100) / 100 };
          } else {
            inventory.push({
              id: uid(), name: t.name, product: t.product || "", category: t.category,
              quantity: t.quantity, unit: t.unit, minStock: 1, expiry: null, location: t.location, packageSize: t.packageSize || null,
            });
          }
        });
        const processedIds = new Set(transfers.map((t) => t.shoppingId));
        const shopping = prev.shopping.filter((s) => !processedIds.has(s.id));
        return { ...prev, inventory, shopping };
      });
      closeModal();
      notify(`${transfers.length} Artikel in den Vorrat übernommen.`);
    },
    saveRecipe: (recipe) => {
      setState((prev) => {
        const exists = prev.recipes.some((r) => r.id === recipe.id);
        const recipes = exists ? prev.recipes.map((r) => (r.id === recipe.id ? recipe : r)) : [...prev.recipes, recipe];
        return { ...prev, recipes };
      });
      closeModal();
      notify("Rezept gespeichert.");
    },
    deleteRecipe: (id) => {
      setState((prev) => ({ ...prev, recipes: prev.recipes.filter((r) => r.id !== id) }));
      closeModal();
      notify("Rezept gelöscht.");
    },
    addMissingIngredients: (recipe, missing) => {
      let addedCount = 0;
      setState((prev) => {
        const existingNames = new Set(prev.shopping.filter((s) => !s.checked).map((s) => s.name.toLowerCase()));
        const additions = missing
          .filter((m) => !m.incompatibleUnit)
          .filter((m) => !existingNames.has(ingredientLabel(m).toLowerCase()))
          .map((m) => {
            const match = matchIngredient(m, prev.inventory);
            return {
              id: uid(), name: ingredientLabel(m), category: match.exact?.category || match.categoryMatches?.[0]?.category || "vorraete",
              quantity: m.amount || 1, unit: m.unit || "Stück", checked: false,
            };
          });
        addedCount = additions.length;
        return { ...prev, shopping: [...prev.shopping, ...additions] };
      });
      notify(addedCount > 0 ? `${addedCount} fehlende Zutat${addedCount === 1 ? "" : "en"} zur Einkaufsliste hinzugefügt.` : "War schon auf der Einkaufsliste.");
    },
    setMealPlan: (date, recipeId) => {
      setState((prev) => {
        const mealPlan = { ...prev.mealPlan };
        if (recipeId) mealPlan[date] = recipeId;
        else delete mealPlan[date];
        // Wird der Plan für den Tag geändert, gilt eine frühere „gekocht“-Markierung nicht mehr.
        const cookedMeals = { ...(prev.cookedMeals || {}) };
        delete cookedMeals[date];
        return { ...prev, mealPlan, cookedMeals };
      });
    },
    // substitutes: { ingredientIndex: inventoryItemId } – vom Nutzer in der
    // Kochbestätigung gewählte Ersatzprodukte. Bestände werden nie negativ;
    // eine Mahlzeit wird nur einmal abgezogen (cookedMeals-Guard).
    cookMeal: (date, substitutes = {}) => {
      setState((prev) => {
        const recipeId = prev.mealPlan[date];
        if (!recipeId) return prev;
        if (prev.cookedMeals?.[date]) return prev; // bereits einmal abgezogen
        const recipe = prev.recipes.find((r) => r.id === recipeId);
        if (!recipe) return prev;

        const usable = prev.inventory.filter((i) => urgencyOfExpiry(i.expiry) !== "abgelaufen");
        let inventory = [...prev.inventory];
        recipe.ingredients.forEach((ing, idx) => {
          const match = matchIngredient(ing, usable);
          const subId = substitutes[idx];
          const sub = subId ? usable.find((i) => i.id === subId) : null;
          // Mehrere passende Vorratseinträge werden nacheinander abgezogen, bis
          // die benötigte Menge aufgebraucht ist. Bestände werden nie negativ.
          const items = (sub ? [sub] : match.matches).filter((i) => i.quantity > 0);
          if (items.length === 0) return;
          const { updates } = deductAmountAcrossItems(items, ing.amount, ing.unit);
          Object.entries(updates).forEach(([itemId, nextQty]) => {
            const invIdx = inventory.findIndex((i) => i.id === itemId);
            if (invIdx === -1) return;
            inventory[invIdx] = { ...inventory[invIdx], quantity: nextQty };
          });
        });
        const cookedMeals = { ...(prev.cookedMeals || {}), [date]: recipeId };
        return { ...prev, inventory, cookedMeals };
      });
      closeModal();
      notify("Als gekocht markiert – Vorräte wurden angepasst.");
    },
    saveNote: (note) => {
      setState((prev) => {
        const exists = prev.notes.some((n) => n.id === note.id);
        const notes = exists ? prev.notes.map((n) => (n.id === note.id ? note : n)) : [...prev.notes, note];
        return { ...prev, notes };
      });
      closeModal();
      notify("Notiz gespeichert.");
    },
    deleteNote: (id) => {
      setState((prev) => ({ ...prev, notes: prev.notes.filter((n) => n.id !== id) }));
      closeModal();
      notify("Notiz gelöscht.");
    },
    updateSettings: (settings) => { setState((prev) => ({ ...prev, settings })); notify("Einstellungen gespeichert."); },
    resetData: () => { setState(buildDemoState()); notify("Daten wurden zurückgesetzt."); },
    replaceState: (data) => { setState({ ignoredSuggestions: [], mealPlan: {}, notes: [], cookedMeals: {}, ...data }); notify("Daten importiert."); },
  }), [closeModal, notify]);

  if (!state) {
    return (
      <div className="nest-app" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
        <GlobalStyles />
        <div style={{ color: "var(--ink-soft)" }}>Lädt…</div>
      </div>
    );
  }

  const pages = {
    dashboard: <DashboardPage state={state} actions={actions} openModal={openModal} setPage={setPage} navigate={navigate} />,
    haushalt: <CleaningPage state={state} actions={actions} openModal={openModal} pendingFilter={pendingFilter} consumeFilter={consumeFilter} />,
    einkaufen: <ShoppingPage state={state} actions={actions} openModal={openModal} pendingFilter={pendingFilter} consumeFilter={consumeFilter} />,
    essen: <MealsPage state={state} actions={actions} openModal={openModal} pendingFilter={pendingFilter} consumeFilter={consumeFilter} />,
    vorraete: <InventoryPage state={state} actions={actions} openModal={openModal} pendingFilter={pendingFilter} consumeFilter={consumeFilter} />,
    einstellungen: <SettingsPage state={state} actions={actions} askConfirm={askConfirm} />,
  };

  return (
    <div className="nest-app">
      <GlobalStyles />
      <div className="nest-shell">
        <aside className="nest-sidebar">
          <div className="nest-brand">
            <div className="nest-brand-mark">🌷</div>
            <div>
              <div className="serif" style={{ fontSize: 16 }}>{state.settings.householdName}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Haushaltsplaner</div>
            </div>
          </div>
          <nav className="nest-nav">
            {NAV_ITEMS.map((item) => (
              <button key={item.id} className={`nest-nav-item ${page === item.id ? "active" : ""}`} onClick={() => navigate(item.id)}>
                <span className="nest-nav-icon">{item.icon}</span>{item.label}
              </button>
            ))}
          </nav>
        </aside>
        <main className="nest-main nest-scroll">{pages[page]}</main>
      </div>

      <nav className="nest-bottomnav">
        {NAV_ITEMS.map((item) => (
          <button key={item.id} className={`nest-bottomnav-item ${page === item.id ? "active" : ""}`} onClick={() => navigate(item.id)}>
            <span className="nest-bottomnav-icon">{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>

      {modal?.type === "task" && (
        <TaskModal
          initial={modal.payload?.id ? modal.payload : null}
          prefill={!modal.payload?.id ? modal.payload : null}
          onSave={actions.saveTask}
          onDelete={(id) => askConfirm("Aufgabe wirklich löschen?", () => actions.deleteTask(id))}
          onClose={closeModal} />
      )}
      {modal?.type === "inventory" && (
        <InventoryModal
          initial={modal.payload?.id ? modal.payload : null}
          defaultLocation={modal.payload?.location}
          defaultCategory={!modal.payload?.id ? modal.payload?.category : null}
          defaultName={!modal.payload?.id ? modal.payload?.name : null}
          defaultProduct={!modal.payload?.id ? modal.payload?.product : null}
          defaultExpiry={!modal.payload?.id ? modal.payload?.expiry : null}
          defaultBarcode={!modal.payload?.id ? modal.payload?.barcode : null}
          onSave={actions.saveInventory}
          onDelete={(id) => askConfirm("Artikel wirklich löschen?", () => actions.deleteInventory(id))}
          onClose={closeModal} />
      )}
      {modal?.type === "barcodeScan" && (
        <BarcodeScannerModal onDetected={handleScanDetected} onClose={closeModal} />
      )}
      {modal?.type === "shopping" && (
        <ShoppingItemModal initial={modal.payload?.id ? modal.payload : null}
          onSave={actions.saveShopping}
          onDelete={(id) => askConfirm("Einkaufsartikel wirklich löschen?", () => actions.deleteShopping(id))}
          onClose={closeModal} />
      )}
      {modal?.type === "recipe" && (
        <RecipeModal initial={modal.payload?.id ? modal.payload : null}
          onSave={actions.saveRecipe}
          onDelete={(id) => askConfirm("Rezept wirklich löschen?", () => actions.deleteRecipe(id))}
          onClose={closeModal} />
      )}
      {modal?.type === "note" && (
        <NoteModal initial={modal.payload?.id ? modal.payload : null}
          onSave={actions.saveNote}
          onDelete={(id) => askConfirm("Notiz wirklich löschen?", () => actions.deleteNote(id))}
          onClose={closeModal} />
      )}
      {modal?.type === "planMeal" && (
        <PlanMealModal recipe={modal.payload}
          onConfirm={(date) => { actions.setMealPlan(date, modal.payload.id); closeModal(); }}
          onClose={closeModal} />
      )}
      {modal?.type === "cookConfirm" && (
        <CookConfirmModal
          recipe={modal.payload.recipe}
          inventory={state.inventory}
          onAddMissing={actions.addMissingIngredients}
          onConfirm={(substitutes) => actions.cookMeal(modal.payload.date, substitutes)}
          onClose={closeModal} />
      )}
      {modal?.type === "purchaseTransfer" && (
        <PurchaseTransferModal
          items={modal.payload}
          onConfirm={actions.transferPurchasedToInventory}
          onClose={closeModal} />
      )}
      {modal?.type === "infoList" && (
        <InfoListModal {...modal.payload} onClose={closeModal} />
      )}

      <Toast toast={toast} />
      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          detail={confirmState.detail}
          confirmLabel={confirmState.confirmLabel}
          danger={confirmState.danger}
          onConfirm={confirmState.onConfirm}
          onClose={closeConfirm}
        />
      )}
    </div>
  );
}
