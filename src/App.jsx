import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";

function extractBarcode(mark) {
  const m = String(mark || "").match(/01(\d{12,14})/);
  return m ? m[1].slice(0, 12) : "";
}

function readText(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
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

function detectBrand(name) {
  const t = String(name || "").toUpperCase();
  if (t.includes("SHIVAKI")) return "SHIVAKI";
  if (t.includes("PREMIER")) return "PREMIER";
  if (t.includes("AUX")) return "AUX";
  if (t.includes("ZIFFLER")) return "ZIFFLER";
  if (t.includes("LG")) return "LG";
  if (t.includes("SAMSUNG")) return "SAMSUNG";
  if (t.includes("HONOR")) return "HONOR";
  if (t.includes("REDMI")) return "REDMI";
  if (t.includes("IPHONE")) return "IPHONE";
  return "Aniqlanmadi";
}

function detectModel(name) {
  const t = String(name || "").toUpperCase();
  const patterns = [
    /TG80FP\s*CITY\s*\d+/,
    /MD\s*\d+\s*L?/,
    /PRMWM\d+/,
    /ASF[-\s]?[A-Z0-9/]+/,
    /ASW[-\s]?[A-Z0-9/]+/,
    /F\d{2}Q\d{3}U/,
    /L\d{2}Q\d{3}U/,
    /F2V3GS6W/,
    /BLACK-T10/,
    /BWM-[A-Z0-9]+/,
    /SM-[A-Z0-9]+/,
    /IPHONE\s*\d+\s*(PRO MAX|PRO|PLUS)?/,
  ];

  for (const p of patterns) {
    const m = t.match(p);
    if (m) return m[0];
  }

  return String(name || "").split(" ").slice(0, 5).join(" ");
}

function makeProduct(x, i = 0) {
  const costPrice = Number(x.costPrice || x.price || 0);
  const qty = Number(x.qty || 0);
  const costAmount = Number(x.costAmount || costPrice * qty || 0);
  const markup = Number(x.markup || 0);
  const salePrice = Number(x.salePrice || costPrice * (1 + markup / 100) || 0);
  const saleAmount = Number(x.saleAmount || salePrice * qty || 0);
  const profit = Number(saleAmount - costAmount);

  return {
    id: Date.now() + Math.random() + i,
    name: x.name || "",
    unit: x.unit || "dona",
    barcode: x.barcode || "",
    mxik: x.mxik || "",
    qty,
    costPrice,
    costAmount,
    markup,
    salePrice,
    saleAmount,
    profit,
    markirovka: x.markirovka || "",
    brand: detectBrand(x.name),
    model: detectModel(x.name),
    invoiceNo: x.invoiceNo || "",
    invoiceDate: x.invoiceDate || "",
    seller: x.seller || "",
    buyer: x.buyer || "",
    warehouse: x.warehouse || "Asosiy sklad",
    source: x.source || "",
  };
}

function groupBy(rows, key) {
  const map = {};

  rows.forEach((r) => {
    const k = r[key] || "Aniqlanmadi";

    if (!map[k]) {
      map[k] = {
        key: k,
        qty: 0,
        costAmount: 0,
        saleAmount: 0,
        profit: 0,
        count: 0,
      };
    }

    map[k].qty += Number(r.qty || 0);
    map[k].costAmount += Number(r.costAmount || 0);
    map[k].saleAmount += Number(r.saleAmount || 0);
    map[k].profit += Number(r.profit || 0);
    map[k].count += 1;
  });

  return Object.values(map);
}

function findArrays(obj) {
  const arrays = [];

  function walk(x) {
    if (!x || typeof x !== "object") return;

    if (Array.isArray(x)) {
      if (x.length && typeof x[0] === "object") arrays.push(x);
      x.forEach(walk);
      return;
    }

    Object.values(x).forEach(walk);
  }

  walk(obj);
  return arrays;
}

function getProductArray(json) {
  const direct =
    json?.ProductList?.Products ||
    json?.Factura?.ProductList?.Products ||
    json?.Products ||
    json?.products ||
    json?.items ||
    json?.Items;

  if (Array.isArray(direct)) return direct;

  return (
    findArrays(json).find((arr) => {
      const keys = Object.keys(arr[0] || {}).join(" ").toLowerCase();
      return (
        keys.includes("catalog") ||
        keys.includes("barcode") ||
        keys.includes("product") ||
        keys.includes("name") ||
        keys.includes("mark")
      );
    }) || []
  );
}

function getInvoiceInfo(json) {
  const f = json?.Factura || json?.factura || json?.invoice || json;

  return {
    number: readText(f?.FacturaNo, f?.FacturaId, f?.FacturaDoc?.FacturaNo, f?.number),
    date: readText(f?.FacturaDate, f?.FacturaDoc?.FacturaDate, f?.date),
    seller: readText(f?.Seller?.Name, f?.SellerName, f?.seller?.name),
    buyer: readText(f?.Buyer?.Name, f?.BuyerName, f?.buyer?.name),
  };
}

function getMarks(p) {
  const arr =
    p?.Marks ||
    p?.marks ||
    p?.MarkingCodes ||
    p?.PackageList ||
    p?.packages ||
    p?.Labels;

  if (Array.isArray(arr)) {
    return arr
      .map((x) =>
        typeof x === "string"
          ? x
          : readText(x?.MarkingCode, x?.markingCode, x?.Mark, x?.mark, x?.Code, x?.code, x?.KI)
      )
      .filter(Boolean);
  }

  const one = readText(p?.MarkingCode, p?.markingCode, p?.Mark, p?.mark, p?.KI);
  return one ? [one] : [];
}

function normalizeInvoiceProduct(p, inv) {
  const name = readText(
    p?.Name,
    p?.name,
    p?.ProductName,
    p?.CatalogName,
    p?.catalogName,
    p?.Номенклатура,
    p?.Товар
  );

  const unit = readText(p?.MeasureName, p?.UnitName, p?.unit, p?.Ед, "dona");
  const mxik = readText(p?.CatalogCode, p?.catalogCode, p?.catalogcode, p?.MXIK, p?.mxik, p?.МХИК);
  const barcodeJson = readText(p?.Barcode, p?.barcode, p?.BarCode, p?.Штрихкод);

  const qty = readNumber(p?.Count, p?.Qty, p?.Quantity, p?.Количество);
  const costPrice = readNumber(p?.Price, p?.Цена);
  const costAmount = readNumber(p?.DeliverySum, p?.Sum, p?.Amount, p?.Сумма);

  const marks = getMarks(p);

  if (marks.length) {
    return marks.map((mark, i) => {
      const barcode = barcodeJson || extractBarcode(mark);

      return makeProduct(
        {
          name,
          unit,
          barcode,
          mxik,
          qty: 1,
          costPrice,
          costAmount: costPrice || costAmount / Math.max(qty || marks.length, 1),
          markirovka: mark,
          invoiceNo: inv.number,
          invoiceDate: inv.date,
          seller: inv.seller,
          buyer: inv.buyer,
          warehouse: "Faktura kirim",
          source: "Kirim faktura",
        },
        i
      );
    });
  }

  return [
    makeProduct({
      name,
      unit,
      barcode: barcodeJson,
      mxik,
      qty: qty || 1,
      costPrice,
      costAmount,
      invoiceNo: inv.number,
      invoiceDate: inv.date,
      seller: inv.seller,
      buyer: inv.buyer,
      warehouse: "Faktura kirim",
      source: "Kirim faktura",
    }),
  ];
}

function parseExcelRows(rows) {
  return rows
    .map((r, i) => {
      const name = readText(
        r["Mahsulot"],
        r["Маҳсулот номи"],
        r["Номенклатура"],
        r["Tovar"],
        r["Наименование"],
        r["name"]
      );

      const markirovka = readText(r["Маркировка"], r["Markirovka"], r["markirovka"]);
      const barcode =
        readText(r["Shtrix"], r["Штрих код"], r["Штрихкод"], r["barcode"]) || extractBarcode(markirovka);

      const qty = readNumber(r["Qoldiq"], r["Miqdor"], r["Количество"], r["Остаток"], r["qty"]);
      const costPrice = readNumber(r["Tannarx"], r["Narx"], r["Цена"], r["price"]);
      const markup = readNumber(r["Natsenka"], r["Наценка"], r["markup"]);
      const salePrice = readNumber(r["Sotish narxi"], r["Цена продажи"], r["salePrice"]);

      return makeProduct(
        {
          name,
          unit: readText(r["Birlik"], r["Ед"], r["Ўлчов бирлиги"], "dona"),
          barcode,
          mxik: readText(r["MXIK"], r["МХИК"], r["catalogcode"]),
          qty,
          costPrice,
          costAmount: readNumber(r["Tannarx summa"], r["Summa"], r["Сумма"], r["amount"]),
          markup,
          salePrice,
          markirovka,
          warehouse: readText(r["Sklad"], r["Склад"], "Excel"),
          source: "Excel qoldiq",
        },
        i
      );
    })
    .filter((x) => x.name || x.barcode || x.markirovka);
}

function normalizeUprSaleRow(r, i) {
  const name = readText(
    r["Mahsulot"],
    r["Номенклатура"],
    r["Tovar"],
    r["Наименование"],
    r["name"]
  );

  const markirovka = readText(r["Маркировка"], r["Markirovka"], r["markirovka"]);
  const barcode =
    readText(r["Shtrix"], r["Штрих код"], r["Штрихкод"], r["barcode"]) || extractBarcode(markirovka);

  const qty = readNumber(r["Soni"], r["Miqdor"], r["Количество"], r["qty"]);
  const salePrice = readNumber(r["Sotish narxi"], r["Цена продажи"], r["Цена"], r["salePrice"]);
  const saleAmount = readNumber(r["Sotish summa"], r["Сумма продажи"], r["Summa"], r["Сумма"], r["saleAmount"]);

  return {
    id: Date.now() + Math.random() + i,
    name,
    barcode,
    markirovka,
    qty,
    salePrice,
    saleAmount: saleAmount || salePrice * qty,
    buyer: readText(r["Xaridor"], r["Покупатель"], r["buyer"], "UPR xaridor"),
    date: readText(r["Sana"], r["Дата"], r["date"], new Date().toLocaleDateString("ru-RU")),
  };
}

export default function App() {
  const [tab, setTab] = useState("home");
  const [products, setProducts] = useState([]);
  const [invoicePreview, setInvoicePreview] = useState([]);
  const [sales, setSales] = useState([]);
  const [salePreview, setSalePreview] = useState([]);
  const [markupPercent, setMarkupPercent] = useState(20);
  const [outBarcode, setOutBarcode] = useState("");
  const [outQty, setOutQty] = useState(1);
  const [buyerName, setBuyerName] = useState("UPR xaridor");

  useEffect(() => {
    const savedProducts = localStorage.getItem("ombor_upr_products");
    const savedSales = localStorage.getItem("ombor_upr_sales");

    if (savedProducts) setProducts(JSON.parse(savedProducts));
    if (savedSales) setSales(JSON.parse(savedSales));
  }, []);

  useEffect(() => {
    localStorage.setItem("ombor_upr_products", JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem("ombor_upr_sales", JSON.stringify(sales));
  }, [sales]);

  const totalQty = products.reduce((s, p) => s + Number(p.qty || 0), 0);
  const totalCost = products.reduce((s, p) => s + Number(p.costAmount || 0), 0);
  const totalSale = products.reduce((s, p) => s + Number(p.saleAmount || 0), 0);
  const totalProfit = sales.reduce((s, p) => s + Number(p.profit || 0), 0);

  const byModel = useMemo(() => groupBy(products, "model"), [products]);
  const byBrand = useMemo(() => groupBy(products, "brand"), [products]);
  const byBarcode = useMemo(() => groupBy(products, "barcode"), [products]);
  const saleByBuyer = useMemo(() => groupBy(sales, "buyer"), [sales]);

  function applyMarkupToStock() {
    const m = Number(markupPercent || 0);

    setProducts((old) =>
      old.map((p) =>
        makeProduct({
          ...p,
          markup: m,
          salePrice: Number(p.costPrice || 0) * (1 + m / 100),
          saleAmount: Number(p.costPrice || 0) * (1 + m / 100) * Number(p.qty || 0),
        })
      )
    );

    alert("Natsenka qo‘yildi");
  }

  async function uploadStockExcel(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    const parsed = parseExcelRows(rows);

    setProducts(parsed);
    alert(`${parsed.length} ta qoldiq Excel’dan yuklandi`);
  }

  async function uploadInvoice(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    let jsons = [];

    if (file.name.toLowerCase().endsWith(".zip")) {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const files = Object.values(zip.files).filter((f) => f.name.toLowerCase().endsWith(".json"));

      for (const f of files) {
        const text = await f.async("text");
        jsons.push(JSON.parse(text));
      }
    } else {
      jsons.push(JSON.parse(await file.text()));
    }

    let all = [];

    jsons.forEach((json) => {
      const inv = getInvoiceInfo(json);
      const arr = getProductArray(json);
      all.push(...arr.flatMap((p) => normalizeInvoiceProduct(p, inv)));
    });

    setInvoicePreview(all);
    alert(`${all.length} ta mahsulot fakturadan olindi`);
  }

  function addInvoiceToStock() {
    setProducts((old) => [...old, ...invoicePreview]);
    setInvoicePreview([]);
    alert("Kirim faktura qoldiqqa qo‘shildi");
  }

  async function uploadUprSales(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    const parsed = rows.map(normalizeUprSaleRow).filter((x) => x.barcode || x.name || x.markirovka);

    setSalePreview(parsed);
    alert(`${parsed.length} ta UPR sotuv yuklandi`);
  }

  function processUprSales() {
    if (!salePreview.length) return alert("Avval UPR sotuv Excel yuklang");

    let stock = [...products];
    const createdSales = [];

    for (const sale of salePreview) {
      let left = Number(sale.qty || 0);
      let costAmount = 0;
      let soldName = sale.name;
      let soldBarcode = sale.barcode;

      stock = stock
        .map((p) => {
          const match =
            (sale.barcode && p.barcode === sale.barcode) ||
            (sale.markirovka && p.markirovka === sale.markirovka) ||
            (!sale.barcode && sale.name && p.name.toUpperCase().includes(sale.name.toUpperCase()));

          if (match && left > 0) {
            const take = Math.min(Number(p.qty || 0), left);
            left -= take;
            costAmount += take * Number(p.costPrice || 0);
            soldName = p.name || soldName;
            soldBarcode = p.barcode || soldBarcode;

            return { ...p, qty: Number(p.qty || 0) - take };
          }

          return p;
        })
        .filter((p) => Number(p.qty || 0) > 0);

      if (left > 0) {
        alert(`Qoldiq yetmadi: ${sale.name || sale.barcode}`);
        return;
      }

      const saleAmount = Number(sale.saleAmount || sale.salePrice * sale.qty);
      const profit = saleAmount - costAmount;

      createdSales.push({
        ...sale,
        name: soldName,
        barcode: soldBarcode,
        costAmount,
        profit,
        invoiceNo: "UPR-" + Date.now(),
        source: "UPR sotuv",
      });
    }

    setProducts(stock);
    setSales((old) => [...old, ...createdSales]);
    setSalePreview([]);
    alert("UPR sotuv bajarildi va chiqim faktura yaratildi");
  }

  function manualExpense() {
    let left = Number(outQty || 0);
    if (!outBarcode || left <= 0) return alert("Shtrix yoki markirovka kiriting");

    let costAmount = 0;
    let soldProduct = null;

    const updated = products
      .map((p) => {
        if ((p.barcode === outBarcode || p.markirovka === outBarcode) && left > 0) {
          const take = Math.min(Number(p.qty), left);
          left -= take;
          costAmount += take * Number(p.costPrice || 0);
          soldProduct = p;
          return { ...p, qty: Number(p.qty) - take };
        }
        return p;
      })
      .filter((p) => Number(p.qty) > 0);

    if (left > 0) return alert("Qoldiq yetarli emas");

    const qty = Number(outQty || 0);
    const salePrice = Number(soldProduct?.salePrice || soldProduct?.costPrice || 0);
    const saleAmount = salePrice * qty;

    setProducts(updated);
    setSales((old) => [
      ...old,
      {
        id: Date.now(),
        name: soldProduct?.name || "",
        barcode: soldProduct?.barcode || outBarcode,
        qty,
        salePrice,
        saleAmount,
        costAmount,
        profit: saleAmount - costAmount,
        buyer: buyerName,
        date: new Date().toLocaleDateString("ru-RU"),
        invoiceNo: "CHQ-" + Date.now(),
        source: "Qo‘lda chiqim",
      },
    ]);

    alert("Chiqim faktura yaratildi");
  }

  function exportSalesInvoice() {
    const data = sales.map((s) => ({
      Sana: s.date,
      Faktura: s.invoiceNo,
      Xaridor: s.buyer,
      Mahsulot: s.name,
      Shtrix: s.barcode,
      Soni: s.qty,
      "Sotish narxi": s.salePrice,
      "Sotish summa": s.saleAmount,
      Tannarx: s.costAmount,
      Foyda: s.profit,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "Chiqim fakturalar");
    XLSX.writeFile(wb, "chiqim_fakturalar.xlsx");
  }

  function exportStock() {
    const ws = XLSX.utils.json_to_sheet(products);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "Qoldiq");
    XLSX.writeFile(wb, "qoldiq_hisobot.xlsx");
  }

  return (
    <div style={s.app}>
      <aside style={s.aside}>
        <div style={s.logo}>1C UPR OMBOR</div>

        {[
          ["home", "Bosh sahifa"],
          ["stock", "Sklad qoldiq"],
          ["invoice", "Kirim faktura"],
          ["excel", "Excel qoldiq"],
          ["price", "Narx / Natsenka"],
          ["upr", "UPR sotuv yuklash"],
          ["expense", "Qo‘lda chiqim"],
          ["sales", "Chiqim fakturalar"],
          ["reports", "Hisobotlar"],
        ].map(([k, v]) => (
          <button key={k} style={tab === k ? s.menuActive : s.menu} onClick={() => setTab(k)}>
            {v}
          </button>
        ))}
      </aside>

      <main style={s.main}>
        <div style={s.header}>
          <h1 style={s.h1}>UPR sotuv va avtomatik faktura tizimi</h1>

          <div>
            <button style={s.btn} onClick={exportStock}>Qoldiq Excel</button>
            <button style={s.btn} onClick={exportSalesInvoice}>Chiqim Excel</button>
          </div>
        </div>

        {tab === "home" && (
          <div style={s.cards}>
            <Card title="Jami qoldiq" value={totalQty} />
            <Card title="Jami tannarx" value={money(totalCost)} />
            <Card title="Sotuv summasi" value={money(totalSale)} />
            <Card title="Real foyda" value={money(totalProfit)} />
          </div>
        )}

        {tab === "stock" && (
          <Panel title="Sklad qoldiq">
            <ProductTable rows={products} />
          </Panel>
        )}

        {tab === "invoice" && (
          <Panel title="Kirim faktura ZIP/JSON">
            <p style={s.help}>ZIP yuklasangiz, ichidagi JSON’ni o‘zi topadi.</p>
            <input style={s.file} type="file" accept=".zip,.json" onChange={uploadInvoice} />

            {invoicePreview.length > 0 && (
              <>
                <ProductTable rows={invoicePreview} />
                <button style={s.greenBtn} onClick={addInvoiceToStock}>
                  Fakturani kirim qilish
                </button>
              </>
            )}
          </Panel>
        )}

        {tab === "excel" && (
          <Panel title="Excel orqali qoldiq yuklash">
            <p style={s.help}>
              Ustunlar: Mahsulot, Shtrix, MXIK, Qoldiq, Tannarx, Natsenka, Sotish narxi
            </p>
            <input style={s.file} type="file" accept=".xlsx,.xls" onChange={uploadStockExcel} />
          </Panel>
        )}

        {tab === "price" && (
          <Panel title="Narx va natsenka sozlash">
            <input
              style={s.input}
              type="number"
              value={markupPercent}
              onChange={(e) => setMarkupPercent(e.target.value)}
              placeholder="Natsenka %"
            />
            <button style={s.greenBtn} onClick={applyMarkupToStock}>
              Barcha qoldiqqa natsenka qo‘yish
            </button>
          </Panel>
        )}

        {tab === "upr" && (
          <Panel title="UPR sotuv Excel yuklash">
            <p style={s.help}>
              Ustunlar: Mahsulot, Shtrix, Markirovka, Soni, Sotish narxi, Sotish summa, Xaridor
            </p>

            <input style={s.file} type="file" accept=".xlsx,.xls" onChange={uploadUprSales} />

            {salePreview.length > 0 && (
              <>
                <SalesTable rows={salePreview} />
                <button style={s.greenBtn} onClick={processUprSales}>
                  Sotuvni bajarish va avtomatik faktura yaratish
                </button>
              </>
            )}
          </Panel>
        )}

        {tab === "expense" && (
          <Panel title="Qo‘lda chiqim faktura">
            <input
              style={s.input}
              placeholder="Xaridor nomi"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
            />

            <input
              style={s.input}
              placeholder="Shtrix kod yoki markirovka"
              value={outBarcode}
              onChange={(e) => setOutBarcode(e.target.value)}
            />

            <input
              style={s.input}
              type="number"
              placeholder="Soni"
              value={outQty}
              onChange={(e) => setOutQty(e.target.value)}
            />

            <button style={s.redBtn} onClick={manualExpense}>
              Chiqim faktura yaratish
            </button>
          </Panel>
        )}

        {tab === "sales" && (
          <Panel title="Chiqim fakturalar">
            <SalesTable rows={sales} />
          </Panel>
        )}

        {tab === "reports" && (
          <>
            <Report title="Model bo‘yicha qoldiq" rows={byModel} />
            <Report title="Brend bo‘yicha qoldiq" rows={byBrand} />
            <Report title="Shtrix kod bo‘yicha qoldiq" rows={byBarcode} />
            <Report title="Xaridor bo‘yicha sotuv" rows={saleByBuyer} />
          </>
        )}
      </main>
    </div>
  );
}

function Card({ title, value }) {
  return (
    <div style={s.card}>
      <div style={s.cardTitle}>{title}</div>
      <div style={s.cardValue}>{value}</div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section style={s.panel}>
      <h2 style={s.h2}>{title}</h2>
      {children}
    </section>
  );
}

function ProductTable({ rows }) {
  return (
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead>
          <tr>
            {[
              "Mahsulot",
              "Brend",
              "Model",
              "Shtrix",
              "MXIK",
              "Qoldiq",
              "Tannarx",
              "Tannarx summa",
              "Natsenka %",
              "Sotish narxi",
              "Sotish summa",
              "Faktura",
            ].map((h) => (
              <th key={h} style={s.th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={s.td}>{r.name}</td>
              <td style={s.td}>{r.brand}</td>
              <td style={s.td}>{r.model}</td>
              <td style={s.td}>{r.barcode}</td>
              <td style={s.td}>{r.mxik || "Yo‘q"}</td>
              <td style={s.td}>
                <b>{r.qty}</b>
              </td>
              <td style={s.td}>{money(r.costPrice)}</td>
              <td style={s.td}>{money(r.costAmount)}</td>
              <td style={s.td}>{r.markup || 0}%</td>
              <td style={s.td}>{money(r.salePrice)}</td>
              <td style={s.td}>{money(r.saleAmount)}</td>
              <td style={s.td}>{r.invoiceNo || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SalesTable({ rows }) {
  return (
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead>
          <tr>
            {[
              "Sana",
              "Faktura",
              "Xaridor",
              "Mahsulot",
              "Shtrix",
              "Soni",
              "Sotish narxi",
              "Sotish summa",
              "Tannarx",
              "Foyda",
            ].map((h) => (
              <th key={h} style={s.th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={s.td}>{r.date || "—"}</td>
              <td style={s.td}>{r.invoiceNo || "—"}</td>
              <td style={s.td}>{r.buyer || "—"}</td>
              <td style={s.td}>{r.name}</td>
              <td style={s.td}>{r.barcode}</td>
              <td style={s.td}>
                <b>{r.qty}</b>
              </td>
              <td style={s.td}>{money(r.salePrice)}</td>
              <td style={s.td}>{money(r.saleAmount)}</td>
              <td style={s.td}>{money(r.costAmount)}</td>
              <td style={s.td}>{money(r.profit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Report({ title, rows }) {
  return (
    <Panel title={title}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Nomi</th>
            <th style={s.th}>Soni</th>
            <th style={s.th}>Tannarx summa</th>
            <th style={s.th}>Sotish summa</th>
            <th style={s.th}>Foyda</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={s.td}>{r.key || "Aniqlanmadi"}</td>
              <td style={s.td}>
                <b>{r.qty}</b>
              </td>
              <td style={s.td}>{money(r.costAmount)}</td>
              <td style={s.td}>{money(r.saleAmount)}</td>
              <td style={s.td}>{money(r.profit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function money(n) {
  return Number(n || 0).toLocaleString("ru-RU");
}

const s = {
  app: {
    display: "flex",
    minHeight: "100vh",
    background: "#fff",
    color: "#222",
    fontFamily: "Arial, sans-serif",
    fontSize: 15,
  },
  aside: {
    width: 230,
    background: "#fff2a8",
    padding: 16,
    borderRight: "1px solid #d6ca83",
  },
  logo: {
    fontSize: 21,
    fontWeight: "bold",
    marginBottom: 22,
    color: "#9a7b00",
  },
  menu: {
    width: "100%",
    border: 0,
    background: "transparent",
    textAlign: "left",
    padding: "13px 10px",
    cursor: "pointer",
    fontSize: 15,
  },
  menuActive: {
    width: "100%",
    border: 0,
    background: "#ffd84d",
    textAlign: "left",
    padding: "13px 10px",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: "bold",
    borderRadius: 6,
  },
  main: {
    flex: 1,
    padding: 22,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  h1: {
    margin: 0,
    fontSize: 28,
    fontWeight: 400,
  },
  h2: {
    marginTop: 0,
    color: "#008a22",
    fontWeight: 400,
  },
  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 14,
  },
  card: {
    background: "#fff9d7",
    padding: 22,
    minHeight: 120,
    border: "1px solid #f0e7aa",
  },
  cardTitle: {
    color: "#008a22",
    fontSize: 18,
    marginBottom: 20,
  },
  cardValue: {
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "right",
  },
  panel: {
    background: "#fffdf0",
    border: "1px solid #eee4a8",
    padding: 20,
    marginBottom: 18,
  },
  help: {
    color: "#555",
  },
  input: {
    width: "100%",
    padding: 12,
    marginBottom: 10,
    border: "1px solid #bbb",
    borderRadius: 4,
    fontSize: 15,
  },
  file: {
    padding: 14,
    background: "#fff",
    border: "1px solid #bbb",
    borderRadius: 4,
    width: "100%",
    marginBottom: 16,
  },
  btn: {
    background: "#e9e9e9",
    border: "1px solid #aaa",
    padding: "10px 18px",
    cursor: "pointer",
    borderRadius: 4,
    marginLeft: 8,
  },
  greenBtn: {
    background: "#e9e9e9",
    border: "1px solid #aaa",
    padding: "10px 18px",
    cursor: "pointer",
    borderRadius: 4,
    marginTop: 10,
  },
  redBtn: {
    background: "#d9534f",
    color: "white",
    border: 0,
    padding: "11px 18px",
    cursor: "pointer",
    borderRadius: 4,
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    background: "white",
    fontSize: 14,
  },
  th: {
    border: "1px solid #bbb",
    padding: 9,
    background: "#f2f2f2",
    textAlign: "left",
    whiteSpace: "nowrap",
  },
  td: {
    border: "1px solid #ddd",
    padding: 8,
    verticalAlign: "top",
  },
};