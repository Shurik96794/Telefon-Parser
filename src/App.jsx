import { useMemo, useState } from "react";
import "./App.css";

const SAMPLE_DATA = `HONOR X9a 5G 6GB+128GB Emerald Green
HONOR 400 8GB+256GB Midnight Black
Samsung SM-A546EZKDSKZ Galaxy A54 8GB+256GB Black
SM-A556EZKCSKZ Samsung Galaxy A55 8/256 Navy
Redmi Note 13 Pro 8GB+256GB Midnight Black
Vivo V40 Lite 12GB+256GB Titanium Silver
iPhone 13 128GB Midnight
iPhone 15 Pro Max 256GB Natural Titanium`;

const colors = [
  ["midnight black", "Black"],
  ["black", "Black"],
  ["emerald green", "Green"],
  ["green", "Green"],
  ["navy", "Navy"],
  ["blue", "Blue"],
  ["silver", "Silver"],
  ["natural titanium", "Natural Titanium"],
  ["titanium", "Titanium"],
  ["midnight", "Midnight"],
  ["white", "White"],
  ["gold", "Gold"],
];

function getBrand(text) {
  const t = text.toLowerCase();
  if (t.includes("samsung") || /sm-[a-z0-9]+/i.test(text)) return "Samsung";
  if (t.includes("iphone") || t.includes("apple")) return "iPhone";
  if (t.includes("honor")) return "HONOR";
  if (t.includes("redmi")) return "Redmi";
  if (t.includes("vivo")) return "Vivo";
  if (t.includes("tecno")) return "Tecno";
  if (t.includes("infinix")) return "Infinix";
  return "Aniqlanmadi";
}

function getMemory(text) {
  let t = text.replace(/Gв/gi, "GB").replace(/Gb/gi, "GB");

  let m = t.match(/(\d{1,2})\s*GB?\s*[+\/]\s*(\d{2,4})\s*GB?/i);
  if (m) return `${m[1]}/${m[2]}`;

  m = t.match(/(\d{1,2})\s*\/\s*(\d{2,4})/i);
  if (m) return `${m[1]}/${m[2]}`;

  m = t.match(/\b(64|128|256|512|1024)\s*GB\b/i);
  if (m) return `${m[1]}GB`;

  return "—";
}

function getColor(text) {
  const t = text.toLowerCase();
  const found = colors.find(([key]) => t.includes(key));
  return found ? found[1] : "—";
}

function getModel(text, brand) {
  if (brand === "Samsung") {
    const sm = text.match(/SM-([A-Z])(\d{2})/i);
    if (sm) return `${sm[1].toUpperCase()}${sm[2]}`;

    const g = text.match(/Galaxy\s+([ASMZ]\d{2,3})/i);
    if (g) return g[1].toUpperCase();
  }

  if (brand === "iPhone") {
    const m = text.match(/iPhone\s+(\d{1,2}\s*(Pro Max|Pro|Plus|Mini)?)/i);
    if (m) return `iPhone ${m[1].trim()}`;
  }

  if (brand === "HONOR") {
    const m = text.match(/HONOR\s+([A-Z]?\d{1,3}[a-z]?\s*(Lite|Pro|Plus)?)/i);
    if (m) return m[1].trim().toUpperCase();
  }

  if (brand === "Redmi") {
    const m = text.match(/Redmi\s+((Note\s+)?\d{1,2}[A-Za-z]?\s*(Pro|Lite|Plus)?)/i);
    if (m) return m[1].trim();
  }

  if (brand === "Vivo") {
    const m = text.match(/Vivo\s+([A-Z]\d{1,3}\s*(Lite|Pro|Plus)?)/i);
    if (m) return m[1].trim().toUpperCase();
  }

  return "Aniqlanmadi";
}

function parsePhone(text, index) {
  const brand = getBrand(text);
  const model = getModel(text, brand);
  const memory = getMemory(text);
  const color = getColor(text);

  const standard = [brand, model, memory !== "—" ? memory : "", color !== "—" ? color : ""]
    .filter(Boolean)
    .join(" ");

  return {
    id: index + 1,
    original: text,
    brand,
    model,
    memory,
    color,
    standard,
    ok: brand !== "Aniqlanmadi" && model !== "Aniqlanmadi",
  };
}

export default function App() {
  const [input, setInput] = useState(SAMPLE_DATA);

  const rows = useMemo(() => {
    return input
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .map(parsePhone);
  }, [input]);

  return (
    <div className="page">
      <h1>Telefon Parser</h1>
      <p>Buxgalteriya va UPR uchun telefon nomlarini standart ko‘rinishga keltirish.</p>

      <div className="grid">
        <div className="card">
          <h2>Telefon nomlari</h2>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} />
        </div>

        <div className="card">
          <h2>Natija</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Original</th>
                <th>Brend</th>
                <th>Model</th>
                <th>Xotira</th>
                <th>Rang</th>
                <th>Standart nom</th>
                <th>Holat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.original}</td>
                  <td>{r.brand}</td>
                  <td>{r.model}</td>
                  <td>{r.memory}</td>
                  <td>{r.color}</td>
                  <td><b>{r.standard}</b></td>
                  <td>{r.ok ? "OK" : "Tekshir"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}