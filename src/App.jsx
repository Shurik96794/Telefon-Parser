import { useEffect, useMemo, useState } from "react";

const MXIK_DB = {
  "478011969572": "123456789001001",
  "478011969122": "123456789001002",
  "478009290010": "123456789001003",
};

const SAMPLE_MARKIROVKA = `Maishiy elektr pechi Shivaki alohida turadigan MD 3618 L to’q qizil/to’q qizil rang	штук	010478011969572921hE5d=vAfk2Rc+0IzedVI
Maishiy kir yuvish mashinasi SHIVAKI yarimavtomат model TG80FP City 01	шт	010478011969122621aUNJJn4E_lNbEXHncoBg`;

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

function groupBy(rows, key) {
  const map = {};

  rows.forEach((r) => {
    const k = r[key] || "Aniqlanmadi";

    if (!map[k]) {
      map[k] = {
        key: k,
        qty: 0,
        amount: 0,
        count: 0,
      };
    }

    map[k].qty += Number(r.qty || 0);
    map[k].amount += Number(r.amount || 0);
    map[k].count += 1;
  });

  return Object.values(map);
}

function readNumber(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") {
      const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
      if (!Number.isNaN(n)) return n;
    }
  }

  return 0;
}

function readText(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }

  return "";
}

function findArrayDeep(obj) {
  const arrays = [];

  function walk(x, path = "") {
    if (!x || typeof x !== "object") return;

    if (Array.isArray(x)) {
      arrays.push({ path, arr: x });
      x.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }

    Object.keys(x).forEach((k) => walk(x[k], path ? `${path}.${k}` : k));
  }

  walk(obj);

  return arrays
    .filter((x) => x.arr.length > 0 && typeof x.arr[0] === "object")
    .sort((a, b) => b.arr.length - a.arr.length);
}

function getInvoiceInfo(json) {
  const factura = json?.Factura || json?.factura || json?.invoice || json?.Invoice || json;

  return {
    number: readText(
      factura?.FacturaId,
      factura?.FacturaNo,
      factura?.FacturaDoc?.FacturaNo,
      factura?.DocNumber,
      factura?.number,
      json?.FacturaId,
      json?.FacturaNo
    ),
    date: readText(
      factura?.FacturaDate,
      factura?.FacturaDoc?.FacturaDate,
      factura?.DocDate,
      factura?.date,
      json?.FacturaDate
    ),
    seller: readText(
      factura?.Seller?.Name,
      factura?.SellerName,
      factura?.seller?.name,
      json?.Seller?.Name
    ),
    buyer: readText(
      factura?.Buyer?.Name,
      factura?.BuyerName,
      factura?.buyer?.name,
      json?.Buyer?.Name
    ),
  };
}

function getProductArray(json) {
  const direct =
    json?.ProductList?.Products ||
    json?.ProductList?.products ||
    json?.Products ||
    json?.products ||
    json?.Items ||
    json?.items ||
    json?.goods ||
    json?.Factura?.ProductList?.Products ||
    json?.Factura?.Products ||
    json?.invoice?.items;

  if (Array.isArray(direct)) return direct;

  const arrays = findArrayDeep(json);

  const productArray = arrays.find(({ arr }) => {
    const sample = arr[0] || {};
    const keys = Object.keys(sample).join(" ").toLowerCase();

    return (
      keys.includes("catalog") ||
      keys.includes("barcode") ||
      keys.includes("mxik") ||
      keys.includes("package") ||
      keys.includes("mark") ||
      keys.includes("product") ||
      keys.includes("name") ||
      keys.includes("товар") ||
      keys.includes("номенклатура")
    );
  });

  return productArray ? productArray.arr : [];
}

function getMarksFromProduct(p) {
  const candidates =
    p?.Marks ||
    p?.marks ||
    p?.MarkingCodes ||
    p?.markingCodes ||
    p?.markirovka ||
    p?.PackageList ||
    p?.packages ||
    p?.Labels ||
    p?.labels ||
    p?.serials ||
    p?.Serials;

  if (Array.isArray(candidates)) {
    return candidates
      .map((x) => {
        if (typeof x === "string") return x;

        return readText(
          x?.MarkingCode,
          x?.markingCode,
          x?.Mark,
          x?.mark,
          x?.Code,
          x?.code,
          x?.KI,
          x?.ki
        );
      })
      .filter(Boolean);
  }

  const one = readText(
    p?.MarkingCode,
    p?.markingCode,
    p?.Mark,
    p?.mark,
    p?.KI,
    p?.ki
  );

  return one ? [one] : [];
}

function normalizeProductFromInvoice(p, invoice) {
  const name = readText(
    p?.Name,
    p?.name,
    p?.ProductName,
    p?.productName,
    p?.CatalogName,
    p?.catalogName,
    p?.Номенклатура,
    p?.Товар
  );

  const unit = readText(
    p?.MeasureName,
    p?.measureName,
    p?.UnitName,
    p?.unitName,
    p?.unit,
    p?.Ед,
    "шт"
  );

  const catalogCode = readText(
    p?.CatalogCode,
    p?.catalogCode,
    p?.catalogcode,
    p?.MXIK,
    p?.mxik,
    p?.МХИК
  );

  const barcodeFromJson = readText(
    p?.Barcode,
    p?.barcode,
    p?.BarCode,
    p?.barCode,
    p?.Штрихкод,
    p?.shtrix
  );

  const qty = readNumber(p?.Count, p?.count, p?.Qty, p?.qty, p?.Quantity, p?.quantity, p?.Количество);
  const price = readNumber(p?.Price, p?.price, p?.Цена);
  const amount = readNumber(p?.DeliverySum, p?.deliverySum, p?.Sum, p?.sum, p?.Amount, p?.amount, p?.Сумма);
  const vatRate = readNumber(p?.VatRate, p?.vatRate, p?.VATRate, p?.НДС);
  const vatSum = readNumber(p?.VatSum, p?.vatSum, p?.VATSum, p?.СуммаНДС);

  const marks = getMarksFromProduct(p);

  if (marks.length > 0) {
    return marks.map((mark, i) => {
      const barcode = barcodeFromJson || extractBarcode(mark);

      return {
        id: Date.now() + Math.random() + i,
        source: "Faktura JSON",
        invoiceNo: invoice.number,
        invoiceDate: invoice.date,
        seller: invoice.seller,
        buyer: invoice.buyer,
        name,
        unit,
        markirovka: mark,
        barcode,
        mxik: catalogCode || MXIK_DB[barcode] || "",
        brand: detectBrand(name),
        model: detectModel(name),
        qty: 1,
        price,
        amount: price || amount / Math.max(qty || marks.length, 1),
        vatRate,
        vatSum: vatSum / Math.max(qty || marks.length, 1),
        warehouse: "Faktura kirim",
      };
    });
  }

  const barcode = barcodeFromJson;

  return [
    {
      id: Date.now() + Math.random(),
      source: "Faktura JSON",
      invoiceNo: invoice.number,
      invoiceDate: invoice.date,
      seller: invoice.seller,
      buyer: invoice.buyer,
      name,
      unit,
      markirovka: "",
      barcode,
      mxik: catalogCode || MXIK_DB[barcode] || "",
      brand: detectBrand(name),
      model: detectModel(name),
      qty: qty || 1,
      price,
      amount,
      vatRate,
      vatSum,
      warehouse: "Faktura kirim",
    },
  ];
}

function parseManualRows(text) {
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

      return {
        id: Date.now() + i,
        source: "Qo‘lda kirim",
        invoiceNo: "",
        invoiceDate: "",
        seller: "",
        buyer: "",
        name,
        unit,
        markirovka,
        barcode,
        mxik: MXIK_DB[barcode] || "",
        brand: detectBrand(name),
        model: detectModel(name),
        qty: 1,
        price: 0,
        amount: 0,
        vatRate: 0,
        vatSum: 0,
        warehouse: "Asosiy sklad",
      };
    });
}

export default function App() {
  const [tab, setTab] = useState("home");
  const [products, setProducts] = useState([]);
  const [manualInput, setManualInput] = useState(SAMPLE_MARKIROVKA);
  const [invoicePreview, setInvoicePreview] = useState([]);
  const [invoiceInfo, setInvoiceInfo] = useState(null);
  const [outBarcode, setOutBarcode] = useState("");
  const [outQty, setOutQty] = useState(1);
  const [apiUrl, setApiUrl] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("ombor_products_v2");
    if (saved) setProducts(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem("ombor_products_v2", JSON.stringify(products));
  }, [products]);

  const totalQty = products.reduce((s, p) => s + Number(p.qty || 0), 0);
  const totalAmount = products.reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalTypes = new Set(products.map((p) => p.barcode || p.name)).size;
  const noMxik = products.filter((p) => !p.mxik).length;

  const byModel = useMemo(() => groupBy(products, "model"), [products]);
  const byBrand = useMemo(() => groupBy(products, "brand"), [products]);
  const byBarcode = useMemo(() => groupBy(products, "barcode"), [products]);
  const byMxik = useMemo(() => groupBy(products, "mxik"), [products]);
  const invoices = useMemo(() => groupBy(products, "invoiceNo"), [products]);

  function manualIncome() {
    const rows = parseManualRows(manualInput);
    setProducts((old) => [...old, ...rows]);
    alert("Qo‘lda kirim qilindi");
  }

  function addInvoiceToStock() {
    if (invoicePreview.length === 0) return alert("Avval faktura JSON yuklang");
    setProducts((old) => [...old, ...invoicePreview]);
    setInvoicePreview([]);
    alert("Faktura kirimga qo‘shildi");
  }

  function expense() {
    const qty = Number(outQty || 0);
    if (!outBarcode || qty <= 0) return alert("Shtrix kod va son kiriting");

    let left = qty;

    const updated = products
      .map((p) => {
        if ((p.barcode === outBarcode || p.markirovka === outBarcode) && left > 0) {
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

      const rows = data.map((x, i) => {
        const name = readText(x.name, x.Номенклатура, x.Товар);

        return {
          id: Date.now() + i,
          source: "1C API",
          invoiceNo: "",
          invoiceDate: "",
          seller: "",
          buyer: "",
          name,
          unit: readText(x.unit, x.Ед, "шт"),
          barcode: readText(x.barcode, x.shtrix, x.Штрихкод),
          mxik: readText(x.mxik, x.МХИК),
          brand: detectBrand(name),
          model: detectModel(name),
          qty: readNumber(x.stock, x.qty, x.Остаток),
          price: readNumber(x.price, x.Цена),
          amount: readNumber(x.amount, x.Сумма),
          warehouse: readText(x.warehouse, x.Склад, "1C sklad"),
          markirovka: "",
        };
      });

      setProducts(rows);
      alert("1C dan qoldiq olindi");
    } catch {
      alert("API ishlamadi. 1C JSON qaytarishi kerak.");
    }
  }

  async function handleInvoiceFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();

    try {
      const json = JSON.parse(text);
      const invoice = getInvoiceInfo(json);
      const productArray = getProductArray(json);

      if (!productArray.length) {
        alert("Faktura ichidan mahsulotlar topilmadi");
        return;
      }

      const rows = productArray.flatMap((p) => normalizeProductFromInvoice(p, invoice));

      setInvoiceInfo(invoice);
      setInvoicePreview(rows);

      alert(`${rows.length} ta qator fakturadan olindi`);
    } catch {
      alert("Bu JSON fayl emas yoki format noto‘g‘ri. Zip ichidan .json faylni chiqarib yuklang.");
    }
  }

  function clearAll() {
    if (!confirm("Hamma qoldiqni o‘chirasizmi?")) return;
    setProducts([]);
    setInvoicePreview([]);
  }

  return (
    <div style={s.app}>
      <aside style={s.aside}>
        <h2 style={s.logo}>OMBOR</h2>

        <button style={s.menuBtn} onClick={() => setTab("home")}>Bosh sahifa</button>
        <button style={s.menuBtn} onClick={() => setTab("products")}>Tovarlar</button>
        <button style={s.menuBtn} onClick={() => setTab("invoice")}>Faktura yuklash</button>
        <button style={s.menuBtn} onClick={() => setTab("manual")}>Qo‘lda kirim</button>
        <button style={s.menuBtn} onClick={() => setTab("expense")}>Chiqim</button>
        <button style={s.menuBtn} onClick={() => setTab("reports")}>Hisobotlar</button>
        <button style={s.menuBtn} onClick={() => setTab("api")}>1C API</button>

        <button style={s.dangerBtn} onClick={clearAll}>Qoldiqni tozalash</button>
      </aside>

      <main style={s.main}>
        <h1 style={s.title}>1C uslubidagi qoldiq, faktura va markirovka tizimi</h1>

        {tab === "home" && (
          <div style={s.cards}>
            <Card title="Jami qoldiq" value={totalQty} />
            <Card title="Tovar turi" value={totalTypes} />
            <Card title="MXIK yo‘q" value={noMxik} />
            <Card title="Jami summa" value={formatMoney(totalAmount)} />
          </div>
        )}

        {tab === "invoice" && (
          <section style={s.card}>
            <h2>Faktura JSON yuklash</h2>
            <p>Zip ichidan .json faylni chiqarib, shu yerga yuklang.</p>

            <input style={s.fileInput} type="file" accept=".json,application/json" onChange={handleInvoiceFile} />

            {invoiceInfo && (
              <div style={s.infoBox}>
                <b>Faktura:</b> {invoiceInfo.number || "—"} <br />
                <b>Sana:</b> {invoiceInfo.date || "—"} <br />
                <b>Sotuvchi:</b> {invoiceInfo.seller || "—"} <br />
                <b>Xaridor:</b> {invoiceInfo.buyer || "—"}
              </div>
            )}

            {invoicePreview.length > 0 && (
              <>
                <h3>Yuklangan faktura mahsulotlari</h3>
                <ProductTable rows={invoicePreview} />
                <button style={s.actionBtn} onClick={addInvoiceToStock}>Fakturani kirim qilish</button>
              </>
            )}
          </section>
        )}

        {tab === "manual" && (
          <section style={s.card}>
            <h2>Qo‘lda kirim</h2>
            <p>Format: mahsulot nomi TAB birlik TAB markirovka kodi</p>
            <textarea style={s.textarea} value={manualInput} onChange={(e) => setManualInput(e.target.value)} />
            <button style={s.actionBtn} onClick={manualIncome}>Kirim qilish</button>
          </section>
        )}

        {tab === "expense" && (
          <section style={s.card}>
            <h2>Chiqim qilish</h2>
            <input style={s.input} placeholder="Shtrix kod yoki markirovka kodi" value={outBarcode} onChange={(e) => setOutBarcode(e.target.value)} />
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
            <Report title="Faktura bo‘yicha hisobot" rows={invoices} />
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
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Faktura</th>
            <th style={s.th}>Mahsulot</th>
            <th style={s.th}>Brend</th>
            <th style={s.th}>Model</th>
            <th style={s.th}>Birlik</th>
            <th style={s.th}>Shtrix kod</th>
            <th style={s.th}>MXIK</th>
            <th style={s.th}>Soni</th>
            <th style={s.th}>Narx</th>
            <th style={s.th}>Summa</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={s.td}>{r.invoiceNo || "—"}</td>
              <td style={s.td}>{r.name}</td>
              <td style={s.td}>{r.brand}</td>
              <td style={s.td}>{r.model}</td>
              <td style={s.td}>{r.unit}</td>
              <td style={s.td}>{r.barcode}</td>
              <td style={s.td}>{r.mxik || "Yo‘q"}</td>
              <td style={s.td}><b>{r.qty}</b></td>
              <td style={s.td}>{formatMoney(r.price)}</td>
              <td style={s.td}>{formatMoney(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
            <th style={s.th}>Summa</th>
            <th style={s.th}>Qatorlar</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={s.td}>{r.key || "Aniqlanmadi"}</td>
              <td style={s.td}><b>{r.qty}</b></td>
              <td style={s.td}>{formatMoney(r.amount)}</td>
              <td style={s.td}>{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatMoney(n) {
  return Number(n || 0).toLocaleString("ru-RU");
}

const s = {
  app: {
    display: "flex",
    minHeight: "100vh",
    color: "white",
    fontFamily: "Arial, sans-serif",
    background:
      'linear-gradient(rgba(0,0,0,.78), rgba(0,0,0,.85)), url("https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=2070")',
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundAttachment: "fixed",
  },

  aside: {
    width: 260,
    padding: 25,
    background: "rgba(255,255,255,.08)",
    borderRight: "1px solid rgba(255,255,255,.15)",
    backdropFilter: "blur(12px)",
  },

  logo: {
    marginTop: 0,
    color: "#7dd3fc",
    letterSpacing: 2,
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
    fontWeight: "bold",
  },

  dangerBtn: {
    width: "100%",
    marginTop: 25,
    padding: 14,
    border: 0,
    borderRadius: 12,
    background: "linear-gradient(90deg, #ef4444, #991b1b)",
    color: "white",
    cursor: "pointer",
    fontWeight: "bold",
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
    gridTemplateColumns: "repeat(4, 1fr)",
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
    fontSize: 30,
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

  fileInput: {
    width: "100%",
    padding: 18,
    border: "1px dashed rgba(255,255,255,.4)",
    borderRadius: 14,
    background: "rgba(0,0,0,.35)",
    color: "white",
    marginBottom: 20,
  },

  actionBtn: {
    padding: "14px 25px",
    border: 0,
    borderRadius: 12,
    background: "linear-gradient(90deg, #0284c7, #2563eb)",
    color: "white",
    fontWeight: "bold",
    cursor: "pointer",
    marginTop: 15,
  },

  infoBox: {
    background: "rgba(0,0,0,.35)",
    border: "1px solid rgba(255,255,255,.12)",
    borderRadius: 14,
    padding: 15,
    marginBottom: 20,
    lineHeight: 1.8,
  },

  tableWrap: {
    overflowX: "auto",
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
    whiteSpace: "nowrap",
  },

  td: {
    padding: 11,
    borderBottom: "1px solid rgba(255,255,255,.12)",
    verticalAlign: "top",
  },
};