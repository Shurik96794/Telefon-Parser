import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";

function readText(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
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

function extractBarcode(mark) {
  const m = String(mark || "").match(/01(\d{12,14})/);
  return m ? m[1].slice(0, 12) : "";
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
  const qty = Number(x.qty || 0);
  const costPrice = Number(x.costPrice || 0);
  const costAmount = Number(x.costAmount || costPrice * qty || 0);
  const markup = Number(x.markup || 0);
  const salePrice = Number(x.salePrice || costPrice * (1 + markup / 100) || 0);
  const saleAmount = Number(x.saleAmount || salePrice * qty || 0);

  return {
    id: Date.now() + Math.random() + i,
    name: x.name || "",
    unit: x.unit || "dona",
    barcode: x.barcode || "",
    mxik: x.mxik || "",
    markirovka: x.markirovka || "",
    qty,
    costPrice,
    costAmount,
    markup,
    salePrice,
    saleAmount,
    brand: detectBrand(x.name),
    model: detectModel(x.name),
    invoiceNo: x.invoiceNo || "",
    invoiceDate: x.invoiceDate || "",
    supplier: x.supplier || "",
    customer: x.customer || "",
    warehouse: x.warehouse || "Asosiy sklad",
    source: x.source || "",
  };
}

function groupBy(rows, key) {
  const map = {};
  rows.forEach((r) => {
    const k = r[key] || "Aniqlanmadi";
    if (!map[k]) {
      map[k] = { key: k, qty: 0, costAmount: 0, saleAmount: 0, profit: 0, count: 0 };
    }
    map[k].qty += Number(r.qty || 0);
    map[k].costAmount += Number(r.costAmount || 0);
    map[k].saleAmount += Number(r.saleAmount || 0);
    map[k].profit += Number(r.saleAmount || 0) - Number(r.costAmount || 0);
    map[k].count += 1;
  });
  return Object.values(map);
}

function getMarks(p) {
  const arr =
    p?.marks?.identtransupak ||
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
    json?.productlist?.products ||
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
      return keys.includes("catalog") || keys.includes("barcode") || keys.includes("product") || keys.includes("name") || keys.includes("mark");
    }) || []
  );
}

function getInvoiceInfo(json) {
  const f = json?.facturadoc || json?.facturaDoc || json?.FacturaDoc || json?.Factura || json?.factura || json?.invoice || json;

  return {
    number: readText(f?.facturano, f?.FacturaNo, f?.FacturaId, f?.number, json?.facturaid),
    date: readText(f?.facturadate, f?.FacturaDate, f?.date),
    supplier: readText(json?.seller?.name, json?.Seller?.Name, json?.SellerName),
    customer: readText(json?.buyer?.name, json?.Buyer?.Name, json?.BuyerName),
  };
}

function normalizeInvoiceProduct(p, inv) {
  const name = readText(p?.name, p?.Name, p?.ProductName, p?.catalogname, p?.CatalogName, p?.Номенклатура, p?.Товар);
  const unit = readText(p?.packagename, p?.MeasureName, p?.UnitName, p?.unit, p?.Ед, "dona");
  const mxik = readText(p?.catalogcode, p?.CatalogCode, p?.MXIK, p?.mxik, p?.МХИК);
  const barcodeJson = readText(p?.barcode, p?.Barcode, p?.BarCode, p?.Штрихкод);
  const qty = readNumber(p?.count, p?.Count, p?.Qty, p?.Quantity, p?.Количество);
  const costPrice = readNumber(p?.summa, p?.Price, p?.Цена);
  const costAmount = readNumber(p?.deliverysum, p?.DeliverySum, p?.Sum, p?.Amount, p?.Сумма);

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
          supplier: inv.supplier,
          customer: inv.customer,
          warehouse: "Kirim faktura",
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
      supplier: inv.supplier,
      customer: inv.customer,
      warehouse: "Kirim faktura",
      source: "Kirim faktura",
    }),
  ];
}

function parseExcelRows(rows) {
  return rows
    .map((r, i) => {
      const name = readText(r["Mahsulot"], r["Маҳсулот номи"], r["Номенклатура"], r["Tovar"], r["Наименование"], r["name"]);
      const markirovka = readText(r["Маркировка"], r["Markirovka"], r["markirovka"]);
      const barcode = readText(r["Shtrix"], r["Штрих код"], r["Штрихкод"], r["barcode"]) || extractBarcode(markirovka);
      const qty = readNumber(r["Qoldiq"], r["Miqdor"], r["Количество"], r["Остаток"], r["qty"]);
      const costPrice = readNumber(r["Tannarx"], r["Kirim narxi"], r["Narx"], r["Цена"], r["price"]);
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

function parseUprSaleRows(rows) {
  return rows
    .map((r, i) => {
      const name = readText(r["Mahsulot"], r["Номенклатура"], r["Tovar"], r["Наименование"], r["name"]);
      const markirovka = readText(r["Маркировка"], r["Markirovka"], r["markirovka"]);
      const barcode = readText(r["Shtrix"], r["Штрих код"], r["Штрихкод"], r["barcode"]) || extractBarcode(markirovka);
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
        customer: readText(r["Xaridor"], r["Покупатель"], r["buyer"], "UPR xaridor"),
        date: readText(r["Sana"], r["Дата"], r["date"], new Date().toLocaleDateString("ru-RU")),
      };
    })
    .filter((x) => x.barcode || x.name || x.markirovka);
}

export default function App() {
  const [tab, setTab] = useState("home");
  const [products, setProducts] = useState([]);
  const [invoicePreview, setInvoicePreview] = useState([]);
  const [sales, setSales] = useState([]);
  const [salePreview, setSalePreview] = useState([]);
  const [markupPercent, setMarkupPercent] = useState(20);
  const [outCode, setOutCode] = useState("");
  const [outQty, setOutQty] = useState(1);
  const [customerName, setCustomerName] = useState("UPR xaridor");
  const [suppliers, setSuppliers] = useState([]);
  const [customers, setCustomers] = useState([]);

  useEffect(() => {
    const p = localStorage.getItem("universal_products");
    const s = localStorage.getItem("universal_sales");
    const sp = localStorage.getItem("universal_suppliers");
    const cs = localStorage.getItem("universal_customers");

    if (p) setProducts(JSON.parse(p));
    if (s) setSales(JSON.parse(s));
    if (sp) setSuppliers(JSON.parse(sp));
    if (cs) setCustomers(JSON.parse(cs));
  }, []);

  useEffect(() => localStorage.setItem("universal_products", JSON.stringify(products)), [products]);
  useEffect(() => localStorage.setItem("universal_sales", JSON.stringify(sales)), [sales]);
  useEffect(() => localStorage.setItem("universal_suppliers", JSON.stringify(suppliers)), [suppliers]);
  useEffect(() => localStorage.setItem("universal_customers", JSON.stringify(customers)), [customers]);

  const totalQty = products.reduce((s, p) => s + Number(p.qty || 0), 0);
  const totalCost = products.reduce((s, p) => s + Number(p.costAmount || 0), 0);
  const totalSalePotential = products.reduce((s, p) => s + Number(p.saleAmount || 0), 0);
  const realSale = sales.reduce((s, p) => s + Number(p.saleAmount || 0), 0);
  const realProfit = sales.reduce((s, p) => s + Number(p.profit || 0), 0);

  const byModel = useMemo(() => groupBy(products, "model"), [products]);
  const byBrand = useMemo(() => groupBy(products, "brand"), [products]);
  const byBarcode = useMemo(() => groupBy(products, "barcode"), [products]);
  const byMxik = useMemo(() => groupBy(products, "mxik"), [products]);
  const saleByCustomer = useMemo(() => groupBy(sales, "customer"), [sales]);

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

    try {
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

        if (inv.supplier && !suppliers.some((x) => x.name === inv.supplier)) {
          setSuppliers((old) => [...old, { id: Date.now(), name: inv.supplier }]);
        }

        if (inv.customer && !customers.some((x) => x.name === inv.customer)) {
          setCustomers((old) => [...old, { id: Date.now(), name: inv.customer }]);
        }
      });

      setInvoicePreview(all);
      alert(`${all.length} ta mahsulot fakturadan olindi`);
    } catch {
      alert("Fayl o‘qilmadi. ZIP ichida JSON bo‘lishi kerak.");
    }
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
    const parsed = parseUprSaleRows(rows);

    setSalePreview(parsed);
    alert(`${parsed.length} ta UPR sotuv yuklandi`);
  }

  function applyMarkup() {
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

  function processUprSales() {
    if (!salePreview.length) return alert("Avval UPR sotuv Excel yuklang");

    let stock = [...products];
    const created = [];

    for (const sale of salePreview) {
      let left = Number(sale.qty || 0);
      let costAmount = 0;
      let soldProduct = null;

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
            soldProduct = p;
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

      created.push({
        id: Date.now() + Math.random(),
        date: sale.date,
        invoiceNo: "UPR-" + Date.now(),
        customer: sale.customer,
        name: soldProduct?.name || sale.name,
        barcode: soldProduct?.barcode || sale.barcode,
        qty: sale.qty,
        salePrice: sale.salePrice || soldProduct?.salePrice || 0,
        saleAmount,
        costAmount,
        profit,
        source: "UPR sotuv",
      });
    }

    setProducts(stock);
    setSales((old) => [...old, ...created]);
    setSalePreview([]);
    alert("UPR sotuv bajarildi va avtomatik chiqim faktura yaratildi");
  }

  function manualExpense() {
    let left = Number(outQty || 0);
    if (!outCode || left <= 0) return alert("Shtrix yoki markirovka kiriting");

    let stock = [...products];
    let costAmount = 0;
    let soldProduct = null;

    stock = stock
      .map((p) => {
        if ((p.barcode === outCode || p.markirovka === outCode) && left > 0) {
          const take = Math.min(Number(p.qty || 0), left);
          left -= take;
          costAmount += take * Number(p.costPrice || 0);
          soldProduct = p;
          return { ...p, qty: Number(p.qty || 0) - take };
        }

        return p;
      })
      .filter((p) => Number(p.qty || 0) > 0);

    if (left > 0) return alert("Qoldiq yetarli emas");

    const qty = Number(outQty || 0);
    const salePrice = Number(soldProduct?.salePrice || soldProduct?.costPrice || 0);
    const saleAmount = salePrice * qty;

    setProducts(stock);

    setSales((old) => [
      ...old,
      {
        id: Date.now(),
        date: new Date().toLocaleDateString("ru-RU"),
        invoiceNo: "CHQ-" + Date.now(),
        customer: customerName,
        name: soldProduct?.name || "",
        barcode: soldProduct?.barcode || outCode,
        qty,
        salePrice,
        saleAmount,
        costAmount,
        profit: saleAmount - costAmount,
        source: "Qo‘lda chiqim",
      },
    ]);

    alert("Chiqim faktura yaratildi");
  }

  function exportStock() {
    const ws = XLSX.utils.json_to_sheet(products);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Qoldiq");
    XLSX.writeFile(wb, "qoldiq_hisobot.xlsx");
  }

  function exportSales() {
    const ws = XLSX.utils.json_to_sheet(sales);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Chiqim fakturalar");
    XLSX.writeFile(wb, "chiqim_fakturalar.xlsx");
  }

  function addSupplier() {
    const name = prompt("Ta’minotchi nomi");
    if (!name) return;
    setSuppliers((old) => [...old, { id: Date.now(), name }]);
  }

  function addCustomer() {
    const name = prompt("Xaridor nomi");
    if (!name) return;
    setCustomers((old) => [...old, { id: Date.now(), name }]);
  }

  return (
    <div style={s.app}>
      <aside style={s.aside}>
        <div style={s.logo}>1C UPR OMBOR</div>

        {[
          ["home", "Bosh sahifa"],
          ["stock", "Sklad qoldiq"],
          ["invoice", "Kirim faktura ZIP/JSON"],
          ["excel", "Excel qoldiq"],
          ["price", "Narx / Natsenka"],
          ["upr", "UPR sotuv yuklash"],
          ["expense", "Qo‘lda chiqim"],
          ["sales", "Chiqim fakturalar"],
          ["reports", "Hisobotlar"],
          ["refs", "Spravochniklar"],
        ].map(([k, v]) => (
          <button key={k} style={tab === k ? s.menuActive : s.menu} onClick={() => setTab(k)}>
            {v}
          </button>
        ))}
      </aside>

      <main style={s.main}>
        <div style={s.header}>
          <h1 style={s.h1}>UPR, faktura, qoldiq va natsenka tizimi</h1>
          <div>
            <button style={s.btn} onClick={exportStock}>Qoldiq Excel</button>
            <button style={s.btn} onClick={exportSales}>Chiqim Excel</button>
          </div>
        </div>

        {tab === "home" && (
          <div style={s.cards}>
            <Card title="Jami qoldiq" value={totalQty} />
            <Card title="Jami tannarx" value={money(totalCost)} />
            <Card title="Sotuv potensial" value={money(totalSalePotential)} />
            <Card title="Real sotuv / foyda" value={`${money(realSale)} / ${money(realProfit)}`} />
          </div>
        )}

        {tab === "stock" && <Panel title="Sklad qoldiq"><ProductTable rows={products} /></Panel>}

        {tab === "invoice" && (
          <Panel title="Kirim faktura ZIP/JSON">
            <p style={s.help}>ZIP yuklasangiz, ichidagi JSON’ni o‘zi topadi. Dona narxi = summa, umumiy = deliverysum.</p>
            <input style={s.file} type="file" accept=".zip,.json" onChange={uploadInvoice} />

            {invoicePreview.length > 0 && (
              <>
                <ProductTable rows={invoicePreview} />
                <button style={s.greenBtn} onClick={addInvoiceToStock}>Fakturani kirim qilish</button>
              </>
            )}
          </Panel>
        )}

        {tab === "excel" && (
          <Panel title="Excel orqali qoldiq yuklash">
            <p style={s.help}>Ustunlar: Mahsulot, Shtrix, MXIK, Qoldiq, Tannarx, Natsenka, Sotish narxi</p>
            <input style={s.file} type="file" accept=".xlsx,.xls" onChange={uploadStockExcel} />
          </Panel>
        )}

        {tab === "price" && (
          <Panel title="Narx va natsenka">
            <input style={s.input} type="number" value={markupPercent} onChange={(e) => setMarkupPercent(e.target.value)} placeholder="Natsenka %" />
            <button style={s.greenBtn} onClick={applyMarkup}>Barcha qoldiqqa natsenka qo‘yish</button>
          </Panel>
        )}

        {tab === "upr" && (
          <Panel title="UPR sotuv Excel yuklash">
            <p style={s.help}>Ustunlar: Mahsulot, Shtrix, Markirovka, Soni, Sotish narxi, Sotish summa, Xaridor</p>
            <input style={s.file} type="file" accept=".xlsx,.xls" onChange={uploadUprSales} />

            {salePreview.length > 0 && (
              <>
                <SalesTable rows={salePreview} />
                <button style={s.greenBtn} onClick={processUprSales}>Sotuvni bajarish va avtomatik faktura yaratish</button>
              </>
            )}
          </Panel>
        )}

        {tab === "expense" && (
          <Panel title="Qo‘lda chiqim faktura">
            <input style={s.input} placeholder="Xaridor nomi" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            <input style={s.input} placeholder="Shtrix kod yoki markirovka" value={outCode} onChange={(e) => setOutCode(e.target.value)} />
            <input style={s.input} type="number" placeholder="Soni" value={outQty} onChange={(e) => setOutQty(e.target.value)} />
            <button style={s.redBtn} onClick={manualExpense}>Chiqim faktura yaratish</button>
          </Panel>
        )}

        {tab === "sales" && <Panel title="Chiqim fakturalar"><SalesTable rows={sales} /></Panel>}

        {tab === "reports" && (
          <>
            <Report title="Model bo‘yicha qoldiq" rows={byModel} />
            <Report title="Brend bo‘yicha qoldiq" rows={byBrand} />
            <Report title="Shtrix kod bo‘yicha qoldiq" rows={byBarcode} />
            <Report title="MXIK bo‘yicha qoldiq" rows={byMxik} />
            <Report title="Xaridor bo‘yicha sotuv" rows={saleByCustomer} />
          </>
        )}

        {tab === "refs" && (
          <Panel title="Spravochniklar">
            <button style={s.greenBtn} onClick={addSupplier}>Ta’minotchi qo‘shish</button>
            <button style={s.greenBtn} onClick={addCustomer}>Xaridor qo‘shish</button>

            <div style={s.refGrid}>
              <div>
                <h3>Ta’minotchilar</h3>
                {suppliers.map((x) => <div style={s.refItem} key={x.id}>{x.name}</div>)}
              </div>
              <div>
                <h3>Xaridorlar</h3>
                {customers.map((x) => <div style={s.refItem} key={x.id}>{x.name}</div>)}
              </div>
            </div>
          </Panel>
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
              "Markirovka",
              "Qoldiq",
              "Dona tannarx",
              "Umumiy tannarx",
              "Natsenka %",
              "Sotish narxi",
              "Sotish summa",
              "Faktura",
            ].map((h) => (
              <th key={h} style={s.th}>{h}</th>
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
              <td style={s.td}>{r.markirovka ? r.markirovka.slice(0, 30) + "..." : "—"}</td>
              <td style={s.td}><b>{r.qty}</b></td>
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
            {["Sana", "Faktura", "Xaridor", "Mahsulot", "Shtrix", "Soni", "Sotish narxi", "Sotish summa", "Tannarx", "Foyda"].map((h) => (
              <th key={h} style={s.th}>{h}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={s.td}>{r.date || "—"}</td>
              <td style={s.td}>{r.invoiceNo || "—"}</td>
              <td style={s.td}>{r.customer || "—"}</td>
              <td style={s.td}>{r.name}</td>
              <td style={s.td}>{r.barcode}</td>
              <td style={s.td}><b>{r.qty}</b></td>
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
            <th style={s.th}>Tannarx</th>
            <th style={s.th}>Sotish</th>
            <th style={s.th}>Foyda</th>
            <th style={s.th}>Qator</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={s.td}>{r.key || "Aniqlanmadi"}</td>
              <td style={s.td}><b>{r.qty}</b></td>
              <td style={s.td}>{money(r.costAmount)}</td>
              <td style={s.td}>{money(r.saleAmount)}</td>
              <td style={s.td}>{money(r.profit)}</td>
              <td style={s.td}>{r.count}</td>
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
  app: { display: "flex", minHeight: "100vh", background: "#fff", color: "#222", fontFamily: "Arial, sans-serif", fontSize: 15 },
  aside: { width: 235, background: "#fff2a8", padding: 16, borderRight: "1px solid #d6ca83" },
  logo: { fontSize: 20, fontWeight: "bold", marginBottom: 22, color: "#9a7b00" },
  menu: { width: "100%", border: 0, background: "transparent", textAlign: "left", padding: "13px 10px", cursor: "pointer", fontSize: 15 },
  menuActive: { width: "100%", border: 0, background: "#ffd84d", textAlign: "left", padding: "13px 10px", cursor: "pointer", fontSize: 15, fontWeight: "bold", borderRadius: 6 },
  main: { flex: 1, padding: 22, overflowX: "auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  h1: { margin: 0, fontSize: 28, fontWeight: 400 },
  h2: { marginTop: 0, color: "#008a22", fontWeight: 400 },
  cards: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 },
  card: { background: "#fff9d7", padding: 22, minHeight: 120, border: "1px solid #f0e7aa" },
  cardTitle: { color: "#008a22", fontSize: 18, marginBottom: 20 },
  cardValue: { fontSize: 22, fontWeight: "bold", textAlign: "right" },
  panel: { background: "#fffdf0", border: "1px solid #eee4a8", padding: 20, marginBottom: 18 },
  help: { color: "#555" },
  input: { width: "100%", padding: 12, marginBottom: 10, border: "1px solid #bbb", borderRadius: 4, fontSize: 15 },
  file: { padding: 14, background: "#fff", border: "1px solid #bbb", borderRadius: 4, width: "100%", marginBottom: 16 },
  btn: { background: "#e9e9e9", border: "1px solid #aaa", padding: "10px 18px", cursor: "pointer", borderRadius: 4, marginLeft: 8 },
  greenBtn: { background: "#e9e9e9", border: "1px solid #aaa", padding: "10px 18px", cursor: "pointer", borderRadius: 4, marginTop: 10, marginRight: 8 },
  redBtn: { background: "#d9534f", color: "white", border: 0, padding: "11px 18px", cursor: "pointer", borderRadius: 4 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", background: "white", fontSize: 14 },
  th: { border: "1px solid #bbb", padding: 9, background: "#f2f2f2", textAlign: "left", whiteSpace: "nowrap" },
  td: { border: "1px solid #ddd", padding: 8, verticalAlign: "top" },
  refGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 20 },
  refItem: { background: "white", border: "1px solid #ddd", padding: 10, marginBottom: 6 },
};