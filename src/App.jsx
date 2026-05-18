import { useEffect, useState } from "react";

const SAMPLE_MARKIROVKA = `Maishiy elektr pechi Shivaki alohida turadigan MD 3618 L to’q qizil/to’q qizil rang	штук	010478011969572921hE5d=vAfk2Rc+0IzedVI
Maishiy kir yuvish mashinasi SHIVAKI yarimavtomat model TG80FP City 01	шт	010478011969122621aUNJJn4E_lNbEXHncoBg`;

const MXIK_DB = {
  "478011969572": "123456789001001",
  "478011969122": "123456789001002",
  "478009290010": "123456789001003",
};

function extractBarcode(mark) {
  const m = String(mark || "").match(/01(\d{12})/);
  return m ? m[1] : "";
}

function detectBrand(name) {
  const t = String(name || "").toUpperCase();
  if (t.includes("SHIVAKI")) return "SHIVAKI";
  if (t.includes("PREMIER") || t.includes("PRMWM")) return "PREMIER";
  if (t.includes("SAMSUNG")) return "SAMSUNG";
  if (t.includes("HONOR")) return "HONOR";
  if (t.includes("REDMI")) return "REDMI";
  if (t.includes("IPHONE")) return "IPHONE";
  return "Aniqlanmadi";
}

function detectModel(name) {
  const t = String(name || "").toUpperCase();

  let m = t.match(/TG80FP\s*CITY\s*\d+/);
  if (m) return m[0];

  m = t.match(/MD\s*\d+\s*L?/);
  if (m) return m[0];

  m = t.match(/PRMWM\d+/);
  if (m) return m[0];

  m = t.match(/SM-[A-Z0-9]+/);
  if (m) return m[0];

  m = t.match(/IPHONE\s*\d+\s*(PRO MAX|PRO|PLUS)?/);
  if (m) return m[0];

  return String(name || "").split(" ").slice(0, 4).join(" ");
}

function parseRows(text) {
  return String(text || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((line, i) => {
      const parts = line.split(/\t+/);
      const name = parts[0] || "";
      const unit = parts[1] || "шт";
      const markirovka = parts[2] || line;
      const barcode = extractBarcode(markirovka);
      const mxik = MXIK_DB[barcode] || "";

      return {
        id: Date.now() + i,
        name,
        unit,
        markirovka,
        barcode,
        mxik,
        brand: detectBrand(name),
        model: detectModel(name),
        qty: 1,
        warehouse: "Asosiy sklad",
      };
    });
}

function groupBy(rows, key) {
  const map = {};
  rows.forEach((r) => {
    const k = r[key] || "Aniqlanmadi";
    if (!map[k]) map[k] = { key: k, qty: 0, count: 0 };
    map[k].qty += Number(r.qty || 0);
    map[k].count += 1;
  });
  return Object.values(map);
}

export default function App() {
  const [tab, setTab] = useState("home");
  const [products, setProducts] = useState([]);
  const [input, setInput] = useState(SAMPLE_MARKIROVKA);
  const [outBarcode, setOutBarcode] = useState("");
  const [outQty, setOutQty] = useState(1);
  const [apiUrl, setApiUrl] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("ombor_products");
    if (saved) setProducts(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem("ombor_products", JSON.stringify(products));
  }, [products]);

  const totalQty = products.reduce((s, p) => s + Number(p.qty || 0), 0);
  const totalTypes = new Set(products.map((p) => p.barcode)).size;
  const noMxik = products.filter((p) => !p.mxik).length;

  function income() {
    const rows = parseRows(input);
    setProducts((old) => [...old, ...rows]);
    alert("Kirim qilindi");
  }

  function expense() {
    const qty = Number(outQty || 0);
    if (!outBarcode || qty <= 0) return alert("Shtrix kod va son kiriting");

    let left = qty;

    const updated = products
      .map((p) => {
        if (p.barcode === outBarcode && left > 0) {
          const take = Math.min(Number(p.qty), left);
          left -= take;
          return { ...p, qty: Number(p.qty) - take };
        }
        return p;
      })
      .filter((p) => Number(p.qty) > 0);

    if (left > 0) return alert("Qoldiq yetarli emas");

    setProducts(updated);
    alert("Chiqim qilindi");
  }

  async function loadFrom1C() {
    if (!apiUrl) return alert("1C API URL kiriting");

    try {
      const res = await fetch(apiUrl);
      const data = await res.json();

      const rows = data.map((x, i) => ({
        id: Date.now() + i,
        name: x.name || x.Номенклатура || "",
        unit: x.unit || x.Ед || "шт",
        barcode: x.barcode || x.shtrix || x.Штрихкод || "",
        mxik: x.mxik || x.МХИК || "",
        brand: detectBrand(x.name || x.Номенклатура || ""),
        model: detectModel(x.name || x.Номенклатура || ""),
        qty: Number(x.stock || x.qty || x.Остаток || 0),
        warehouse: x.warehouse || x.Склад || "1C sklad",
        markirovka: "",
      }));

      setProducts(rows);
      alert("1C dan qoldiq olindi");
    } catch {
      alert("API ishlamadi. 1C JSON qaytarishi kerak.");
    }
  }

  const byModel = groupBy(products, "model");
  const byBrand = groupBy(products, "brand");
  const byBarcode = groupBy(products, "barcode");
  const byMxik = groupBy(products, "mxik");

  return (
    <div style={s.app}>
      <aside style={s.aside}>
        <h2 style={s.logo}>OMBOR</h2>
        <button style={s.menuBtn} onClick={() => setTab("home")}>Bosh sahifa</button>
        <button style={s.menuBtn} onClick={() => setTab("products")}>Tovarlar</button>
        <button style={s.menuBtn} onClick={() => setTab("income")}>Faktura kirim</button>
        <button style={s.menuBtn} onClick={() => setTab("expense")}>Chiqim</button>
        <button style={s.menuBtn} onClick={() => setTab("reports")}>Hisobotlar</button>
        <button style={s.menuBtn} onClick={() => setTab("api")}>1C API</button>
      </aside>

      <main style={s.main}>
        <h1 style={s.title}>1C uslubidagi qoldiq va markirovka tizimi</h1>

        {tab === "home" && (
          <div style={s.cards}>
            <Card title="Jami qoldiq" value={totalQty} />
            <Card title="Tovar turi" value={totalTypes} />
            <Card title="MXIK yo‘q" value={noMxik} />
          </div>
        )}

        {tab === "income" && (
          <section style={s.card}>
            <h2>Faktura kirim</h2>
            <p>Format: mahsulot nomi TAB birlik TAB markirovka kodi</p>
            <textarea style={s.textarea} value={input} onChange={(e) => setInput(e.target.value)} />
            <button style={s.actionBtn} onClick={income}>Kirim qilish</button>
          </section>
        )}

        {tab === "expense" && (
          <section style={s.card}>
            <h2>Chiqim qilish</h2>
            <input style={s.input} placeholder="Shtrix kod" value={outBarcode} onChange={(e) => setOutBarcode(e.target.value)} />
            <input style={s.input} type="number" placeholder="Soni" value={outQty} onChange={(e) => setOutQty(e.target.value)} />
            <button style={s.actionBtn} onClick={expense}>Chiqim qilish</button>
          </section>
        )}

        {tab === "api" && (
          <section style={s.card}>
            <h2>1C API orqali qoldiq olish</h2>
            <input style={s.input} placeholder="Masalan: https://server.uz/api/stocks" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
            <button style={s.actionBtn} onClick={loadFrom1C}>1C dan qoldiq olish</button>
          </section>
        )}

        {tab === "products" && (
          <section style={s.card}>
            <h2>Tovarlar qoldig‘i</h2>
            <ProductTable rows={products} />
          </section>
        )}

        {tab === "reports" && (
          <>
            <Report title="Model bo‘yicha hisobot" rows={byModel} />
            <Report title="Brend bo‘yicha hisobot" rows={byBrand} />
            <Report title="Shtrix kod bo‘yicha hisobot" rows={byBarcode} />
            <Report title="MXIK bo‘yicha hisobot" rows={byMxik} />
          </>
        )}
      </main>
    </div>
  );
}

function Card({ title, value }) {
  return (
    <div style={s.card}>
      <h3>{title}</h3>
      <b style={s.big}>{value}</b>
    </div>
  );
}

function ProductTable({ rows }) {
  return (
    <table style={s.table}>
      <thead>
        <tr>
          <th style={s.th}>Mahsulot</th>
          <th style={s.th}>Brend</th>
          <th style={s.th}>Model</th>
          <th style={s.th}>Birlik</th>
          <th style={s.th}>Shtrix kod</th>
          <th style={s.th}>MXIK</th>
          <th style={s.th}>Sklad</th>
          <th style={s.th}>Qoldiq</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td style={s.td}>{r.name}</td>
            <td style={s.td}>{r.brand}</td>
            <td style={s.td}>{r.model}</td>
            <td style={s.td}>{r.unit}</td>
            <td style={s.td}>{r.barcode}</td>
            <td style={s.td}>{r.mxik || "Yo‘q"}</td>
            <td style={s.td}>{r.warehouse}</td>
            <td style={s.td}><b>{r.qty}</b></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Report({ title, rows }) {
  return (
    <div style={s.card}>
      <h2>{title}</h2>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Nomi</th>
            <th style={s.th}>Soni</th>
            <th style={s.th}>Qatorlar</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={s.td}>{r.key || "Aniqlanmadi"}</td>
              <td style={s.td}><b>{r.qty}</b></td>
              <td style={s.td}>{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const s = {
  app: {
    display: "flex",
    minHeight: "100vh",
    color: "white",
    fontFamily: "Arial, sans-serif",
    background:
      'linear-gradient(rgba(0,0,0,.75), rgba(0,0,0,.82)), url("https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=2070")',
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundAttachment: "fixed",
  },
  aside: {
    width: 250,
    padding: 25,
    background: "rgba(255,255,255,.08)",
    borderRight: "1px solid rgba(255,255,255,.15)",
    backdropFilter: "blur(12px)",
  },
  logo: {
    marginTop: 0,
    color: "#7dd3fc",
  },
  menuBtn: {
    width: "100%",
    display: "block",
    marginBottom: 12,
    padding: 14,
    border: 0,
    borderRadius: 12,
    background: "rgba(255,255,255,.12)",
    color: "white",
    textAlign: "left",
    cursor: "pointer",
  },
  main: {
    flex: 1,
    padding: 30,
    overflowX: "auto",
  },
  title: {
    marginTop: 0,
    fontSize: 34,
    color: "#7dd3fc",
  },
  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 18,
  },
  card: {
    background: "rgba(255,255,255,.1)",
    border: "1px solid rgba(255,255,255,.16)",
    borderRadius: 18,
    padding: 22,
    marginBottom: 20,
    backdropFilter: "blur(14px)",
    boxShadow: "0 10px 30px rgba(0,0,0,.25)",
  },
  big: {
    fontSize: 34,
    color: "#86efac",
  },
  textarea: {
    width: "100%",
    height: 220,
    border: "1px solid rgba(255,255,255,.2)",
    borderRadius: 14,
    padding: 14,
    background: "rgba(0,0,0,.45)",
    color: "white",
  },
  input: {
    width: "100%",
    marginBottom: 12,
    padding: 14,
    border: "1px solid rgba(255,255,255,.2)",
    borderRadius: 12,
    background: "rgba(0,0,0,.45)",
    color: "white",
  },
  actionBtn: {
    padding: "14px 25px",
    border: 0,
    borderRadius: 12,
    background: "linear-gradient(90deg, #0284c7, #2563eb)",
    color: "white",
    fontWeight: "bold",
    cursor: "pointer",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: 15,
    background: "rgba(0,0,0,.25)",
  },
  th: {
    padding: 11,
    background: "rgba(37,99,235,.85)",
    borderBottom: "1px solid rgba(255,255,255,.12)",
    textAlign: "left",
  },
  td: {
    padding: 11,
    borderBottom: "1px solid rgba(255,255,255,.12)",
  },
};