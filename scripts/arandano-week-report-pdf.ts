/**
 * Carta semanal Arándano Café Bar — tamaño carta
 * Periodo: 30 ago → 6 sep 2026
 * Uso: node scripts/with-env.mjs npx ts-node --transpile-only scripts/arandano-week-report-pdf.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { pgPoolConfig } from '../src/common/pg-pool-config';
import { bogotaDateKey } from '../src/common/bogota-time';
import { splitPaymentChannels } from '../src/common/payment-channels';

const COMPANY_ID = 'seed-arandano-cafe-bar';
const FROM_KEY = '2026-08-30';
const TO_KEY = '2026-09-06';
const FROM = new Date(`${FROM_KEY}T00:00:00-05:00`);
const TO = new Date(`${TO_KEY}T23:59:59.999-05:00`);

const META_MIN = 1_500_000;
const META_IDEAL = 1_700_000;

const M = { top: 48, bottom: 48, left: 50, right: 50 };

const C = {
  green: '#1F5C3A',
  greenSoft: '#E8F2EC',
  orange: '#D35400',
  blue: '#1A5276',
  ink: '#1C1C1C',
  muted: '#5A5A5A',
  line: '#C8C8C8',
  rowAlt: '#F6F7F5',
  white: '#FFFFFF',
  danger: '#922B21',
  soft: '#FAFAF8',
};

function cop(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Math.round(n || 0));
}

function dayLabel(key: string): string {
  const dt = new Date(`${key}T12:00:00-05:00`);
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Bogota',
  }).format(dt);
}

function dateKeyFromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function enumerateDays(fromKey: string, toKey: string): string[] {
  const keys: string[] = [];
  let cursor = fromKey;
  while (cursor <= toKey) {
    keys.push(cursor);
    const [y, m, d] = cursor.split('-').map(Number);
    cursor = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }
  return keys;
}

function resolveLogo(outDir: string): string | null {
  for (const name of ['arandano-logo.jpg', 'arandano-logo.jpeg', 'arandano-logo.png']) {
    const p = path.join(outDir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function classifySalePayment(
  method: string,
  saleTotal: number,
): { cashCOP: number; transferNequiCOP: number; otherCOP: number } {
  const trimmed = (method ?? '').trim();
  const lower = trimmed.toLowerCase();
  const total = Math.round(saleTotal);
  if (!trimmed || total <= 0) {
    return { cashCOP: 0, transferNequiCOP: 0, otherCOP: 0 };
  }
  const split = splitPaymentChannels(trimmed, total);
  if (/efectivo[^0-9]*[\d.,]+/i.test(trimmed) || /nequi[^0-9]*[\d.,]+/i.test(trimmed)) {
    return {
      cashCOP: split.cashCOP,
      transferNequiCOP: split.nequiCOP,
      otherCOP: split.otherCOP,
    };
  }
  if (
    lower.includes('nequi') ||
    lower.includes('transferencia') ||
    lower.includes('transfer') ||
    lower.includes('daviplata')
  ) {
    return { cashCOP: 0, transferNequiCOP: total, otherCOP: 0 };
  }
  if (lower.includes('efectivo') || lower.includes('cash') || lower.includes('caja')) {
    return { cashCOP: total, transferNequiCOP: 0, otherCOP: 0 };
  }
  return {
    cashCOP: split.cashCOP,
    transferNequiCOP: split.nequiCOP,
    otherCOP: split.otherCOP || total,
  };
}

type Doc = PDFKit.PDFDocument;

function contentWidth(doc: Doc): number {
  return doc.page.width - M.left - M.right;
}

function ensureSpace(doc: Doc, need: number): void {
  if (doc.y + need > doc.page.height - M.bottom - 20) {
    doc.addPage();
  }
}

function section(doc: Doc, title: string): void {
  ensureSpace(doc, 36);
  doc.moveDown(0.35);
  const y = doc.y;
  doc.rect(M.left, y, 3, 14).fill(C.green);
  doc
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .fillColor(C.green)
    .text(title, M.left + 10, y + 1, { width: contentWidth(doc) - 12 });
  doc.y = Math.max(doc.y, y + 18);
}

function p(doc: Doc, text: string): void {
  ensureSpace(doc, 24);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(C.ink)
    .text(text, M.left, doc.y, {
      width: contentWidth(doc),
      align: 'justify',
      lineGap: 2,
    });
  doc.moveDown(0.4);
}

function bullet(doc: Doc, text: string): void {
  ensureSpace(doc, 16);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(C.ink)
    .text(`•  ${text}`, M.left + 4, doc.y, {
      width: contentWidth(doc) - 8,
      lineGap: 1,
    });
  doc.moveDown(0.2);
}

async function main() {
  const pool = new Pool(pgPoolConfig(process.env.DATABASE_URL!));
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: COMPANY_ID },
    select: { id: true, name: true },
  });

  const [sales, purchases, shifts, cashCloses] = await Promise.all([
    prisma.sale.findMany({
      where: { companyId: COMPANY_ID, saleDate: { gte: FROM, lte: TO } },
      orderBy: { saleDate: 'asc' },
      include: {
        lines: {
          select: {
            productName: true,
            quantity: true,
            unitPrice: true,
            profit: true,
          },
        },
      },
    }),
    prisma.purchaseLot.findMany({
      where: { companyId: COMPANY_ID, purchaseDate: { gte: FROM, lte: TO } },
      orderBy: { purchaseDate: 'asc' },
      include: {
        lines: {
          select: {
            lineName: true,
            quantityPurchased: true,
            purchaseUnitCostCOP: true,
            lineTotalCOP: true,
          },
        },
      },
    }),
    prisma.staffShift.findMany({
      where: { companyId: COMPANY_ID, shiftDate: { gte: FROM, lte: TO } },
      orderBy: { shiftDate: 'asc' },
      include: { staffMember: { select: { name: true } } },
    }),
    prisma.cashClose.findMany({
      where: { companyId: COMPANY_ID, closeDate: { gte: FROM, lte: TO } },
      orderBy: { closeDate: 'asc' },
    }),
  ]);

  const days = enumerateDays(FROM_KEY, TO_KEY);
  const byDay = new Map<
    string,
    { sales: number; salesCount: number; purchases: number; purchasesCount: number; labor: number }
  >();
  for (const d of days) {
    byDay.set(d, {
      sales: 0,
      salesCount: 0,
      purchases: 0,
      purchasesCount: 0,
      labor: 0,
    });
  }

  let salesTotal = 0;
  let cashCOP = 0;
  let transferNequiCOP = 0;
  let otherCOP = 0;
  let grossMargin = 0;
  const productMap = new Map<string, { qty: number; revenue: number }>();

  for (const s of sales) {
    const day = bogotaDateKey(s.saleDate);
    const total = Number(s.total);
    salesTotal += total;
    const bucket = byDay.get(day);
    if (bucket) {
      bucket.sales += total;
      bucket.salesCount += 1;
    }
    const ch = classifySalePayment(s.paymentMethod ?? '', total);
    cashCOP += ch.cashCOP;
    transferNequiCOP += ch.transferNequiCOP;
    otherCOP += ch.otherCOP;
    for (const ln of s.lines) {
      const name = ln.productName.trim() || 'Sin nombre';
      const prev = productMap.get(name) ?? { qty: 0, revenue: 0 };
      prev.qty += Number(ln.quantity);
      prev.revenue += Number(ln.quantity) * Number(ln.unitPrice);
      productMap.set(name, prev);
      grossMargin += Number(ln.profit ?? 0);
    }
  }

  let purchasesTotal = 0;
  for (const p of purchases) {
    const day = bogotaDateKey(p.purchaseDate);
    const total = Number(p.totalValue ?? 0);
    purchasesTotal += total;
    const bucket = byDay.get(day);
    if (bucket) {
      bucket.purchases += total;
      bucket.purchasesCount += 1;
    }
  }

  let laborTotal = 0;
  let laborHours = 0;
  for (const sh of shifts) {
    const day = dateKeyFromDbDate(sh.shiftDate);
    const pay = Number(sh.totalPayCOP ?? 0);
    laborTotal += pay;
    laborHours += Number(sh.hoursWorked ?? 0);
    const bucket = byDay.get(day);
    if (bucket) bucket.labor += pay;
  }

  /** Utilidad de caja de la semana: ventas − compras − nómina. */
  const utilidadCaja = salesTotal - purchasesTotal - laborTotal;
  /** Punto de equilibrio semanal: ventas mínimas para cubrir egresos del periodo. */
  const puntoEquilibrio = purchasesTotal + laborTotal;
  const sobreEquilibrio = salesTotal - puntoEquilibrio;
  const avanceMeta = salesTotal / META_MIN;
  const ticketPromedio = sales.length ? salesTotal / sales.length : 0;
  const margenPct = salesTotal > 0 ? (grossMargin / salesTotal) * 100 : 0;
  const diasConVenta = days.filter((d) => (byDay.get(d)?.sales ?? 0) > 0).length;
  const mejorDia = [...days].sort(
    (a, b) => (byDay.get(b)?.sales ?? 0) - (byDay.get(a)?.sales ?? 0),
  )[0];
  const peorDiaConVenta = [...days]
    .filter((d) => (byDay.get(d)?.sales ?? 0) > 0)
    .sort((a, b) => (byDay.get(a)?.sales ?? 0) - (byDay.get(b)?.sales ?? 0))[0];

  const topProducts = [...productMap.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  const chartRows = days.map((d) => {
    const b = byDay.get(d)!;
    return { label: dayLabel(d), sales: b.sales, purchases: b.purchases };
  });

  const outDir = path.join(process.cwd(), 'tmp');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    'arandano-informe-semana-2026-08-30_2026-09-06.pdf',
  );
  const logoPath = resolveLogo(outDir);

  const generatedAt = new Date().toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'long',
    timeStyle: 'short',
  });

  let pageCount = 0;
  let paintingFooter = false;
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: M,
    autoFirstPage: true,
    info: {
      Title: 'Carta semanal — Arándano Café Bar (30 ago – 6 sep 2026)',
      Author: 'Arándano Café Bar',
      Subject: 'Carta semanal de operación',
    },
  });

  const paintFooter = () => {
    if (paintingFooter) return;
    paintingFooter = true;
    pageCount += 1;
    const savedY = doc.y;
    const prevBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 28;
    doc
      .moveTo(M.left, y - 6)
      .lineTo(doc.page.width - M.right, y - 6)
      .strokeColor(C.line)
      .lineWidth(0.5)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.muted)
      .text('Arándano Café Bar · Carta semanal · Uso interno', M.left, y, {
        width: contentWidth(doc) * 0.7,
        lineBreak: false,
        height: 10,
      });
    doc.text(`Página ${pageCount}`, M.left, y, {
      width: contentWidth(doc),
      align: 'right',
      lineBreak: false,
      height: 10,
    });
    doc.page.margins.bottom = prevBottom;
    doc.y = savedY;
    paintingFooter = false;
  };

  doc.on('pageAdded', () => {
    paintFooter();
  });

  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const w = contentWidth(doc);

  paintFooter();

  // ── Encabezado carta ──
  const logoSize = 70;
  if (logoPath) {
    try {
      doc.image(logoPath, M.left + (w - logoSize) / 2, M.top, {
        fit: [logoSize, logoSize],
      });
    } catch (e) {
      console.warn('Logo:', e);
    }
  }
  doc.y = M.top + (logoPath ? logoSize + 8 : 0);
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor(C.green)
    .text(company.name.toUpperCase(), M.left, doc.y, { width: w, align: 'center' });
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(C.ink)
    .text('Carta semanal de operación', M.left, doc.y + 2, {
      width: w,
      align: 'center',
    });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(C.muted)
    .text(
      '30 de agosto – 6 de septiembre de 2026  ·  Generada ' + generatedAt,
      M.left,
      doc.y + 3,
      { width: w, align: 'center' },
    );
  const lineY = doc.y + 8;
  doc
    .moveTo(M.left, lineY)
    .lineTo(M.left + w, lineY)
    .strokeColor(C.green)
    .lineWidth(1.2)
    .stroke();
  doc
    .moveTo(M.left, lineY + 2.5)
    .lineTo(M.left + w, lineY + 2.5)
    .strokeColor(C.orange)
    .lineWidth(0.7)
    .stroke();
  doc.y = lineY + 12;

  p(
    doc,
    'Equipo Arándano: esta es la carta semanal con el resultado de los registros en VOS-AI. Sirve para mirar con claridad cómo cerramos la semana, dónde estamos frente a la meta y qué debemos ajustar de inmediato.',
  );

  // ── Cifras clave ──
  section(doc, '1. Cifras de la semana');

  const kpis: { label: string; value: string; note: string; accent: string }[] = [
    {
      label: 'Ventas',
      value: cop(salesTotal),
      note: `${sales.length} comandas · ticket ${cop(ticketPromedio)}`,
      accent: C.green,
    },
    {
      label: 'Utilidad de caja',
      value: cop(utilidadCaja),
      note: 'Ventas − compras − nómina',
      accent: utilidadCaja >= 0 ? C.green : C.danger,
    },
    {
      label: 'Punto de equilibrio',
      value: cop(puntoEquilibrio),
      note:
        sobreEquilibrio >= 0
          ? `Superado por ${cop(sobreEquilibrio)}`
          : `Faltan ${cop(-sobreEquilibrio)}`,
      accent: C.blue,
    },
    {
      label: 'Avance meta',
      value: `${(avanceMeta * 100).toFixed(0)}%`,
      note: `Meta mín. ${cop(META_MIN)}`,
      accent: C.orange,
    },
  ];

  ensureSpace(doc, 70);
  {
    const gap = 7;
    const boxW = (w - gap * 3) / 4;
    const y = doc.y;
    const h = 62;
    kpis.forEach((item, i) => {
      const x = M.left + i * (boxW + gap);
      doc.roundedRect(x, y, boxW, h, 4).fillAndStroke(C.white, C.line);
      doc.rect(x, y, 3, h).fill(item.accent);
      doc
        .font('Helvetica')
        .fontSize(6.5)
        .fillColor(C.muted)
        .text(item.label.toUpperCase(), x + 7, y + 8, {
          width: boxW - 12,
          lineBreak: false,
        });
      doc
        .font('Helvetica-Bold')
        .fontSize(item.value.length > 11 ? 8.5 : 10)
        .fillColor(item.accent)
        .text(item.value, x + 7, y + 22, { width: boxW - 12 });
      doc
        .font('Helvetica')
        .fontSize(6)
        .fillColor(C.muted)
        .text(item.note, x + 7, y + 42, { width: boxW - 12 });
    });
    doc.y = y + h + 10;
  }

  p(
    doc,
    `Compras del periodo: ${cop(purchasesTotal)} (${purchases.length} lotes). Nómina registrada: ${cop(laborTotal)} (${shifts.length} turno${shifts.length === 1 ? '' : 's'}). Margen bruto estimado sobre productos vendidos: ${cop(grossMargin)} (${margenPct.toFixed(0)}% de las ventas). Cobros: efectivo ${cop(cashCOP)}; Nequi/transferencia ${cop(transferNequiCOP)}${otherCOP > 0 ? `; otros ${cop(otherCOP)}` : ''}. Las ventas marcadas como «Transferencia» se cuentan aquí como Nequi/transferencia.`,
  );

  p(
    doc,
    `El punto de equilibrio semanal (${cop(puntoEquilibrio)}) es lo mínimo que debíamos vender para cubrir compras y nómina de estos días. Cerramos ${sobreEquilibrio >= 0 ? 'por encima' : 'por debajo'} de ese umbral en ${cop(Math.abs(sobreEquilibrio))}. Frente a la meta mínima de ${cop(META_MIN)} aún faltan ${cop(Math.max(0, META_MIN - salesTotal))}; a la ideal de ${cop(META_IDEAL)}, ${cop(Math.max(0, META_IDEAL - salesTotal))}.`,
  );

  // ── Lectura / retos ──
  section(doc, '2. Lectura de la semana y retos');
  p(
    doc,
    `Hubo ventas en ${diasConVenta} de ${days.length} días. El mejor día fue ${dayLabel(mejorDia)} (${cop(byDay.get(mejorDia)?.sales ?? 0)}).${peorDiaConVenta ? ` El día con menor venta (entre los que sí operaron) fue ${dayLabel(peorDiaConVenta)} (${cop(byDay.get(peorDiaConVenta)?.sales ?? 0)}).` : ''}`,
  );

  const retos: string[] = [
    `La venta semanal (${cop(salesTotal)}) quedó muy por debajo de la meta mínima (${cop(META_MIN)}): el foco de esta semana tiene que ser rotar inventario, no comprar de más.`,
    utilidadCaja < 100_000
      ? `La utilidad de caja (${cop(utilidadCaja)}) es estrecha: cada compra nueva sin venta inmediata reduce el colchón.`
      : `Mantener la utilidad de caja (${cop(utilidadCaja)}) exige disciplina en reposición y ticket promedio.`,
    cashCloses.length === 0
      ? 'No hay cierres de caja formalizados en el periodo: sin total del día no hay control temprano frente a la meta.'
      : `Solo ${cashCloses.length} cierre(s) de caja en el periodo: hay que cerrar todos los días.`,
    shifts.length <= 1
      ? 'Los turnos casi no quedaron registrados: dificulta medir nómina real y cobertura del local.'
      : 'Seguir registrando cada turno con horas y cierre.',
    'Varias ventas salieron como «Transferencia» en lugar de «Nequi»: unificar el medio de pago en la app para no confundir reportes.',
    'Prioridad comercial: perro pequeño (hay stock). Perro grande solo si el cliente lo pide. Impulsar combos y bebidas (Gin & Tonic, Mojito, Cóctel Arándano, michelada, vino por copa).',
  ];
  for (const r of retos) bullet(doc, r);
  doc.moveDown(0.25);

  // ── Gráfica ──
  section(doc, '3. Ventas y compras día a día');
  ensureSpace(doc, 28 + chartRows.length * 26);
  {
    const x = M.left;
    const labelW = 76;
    const valueW = 68;
    const barArea = w - labelW - valueW - 8;
    const max = Math.max(1, ...chartRows.flatMap((r) => [r.sales, r.purchases]));
    const legendY = doc.y;
    doc.rect(x + labelW, legendY + 1, 8, 8).fill(C.green);
    doc.font('Helvetica').fontSize(8).fillColor(C.ink).text('Ventas', x + labelW + 12, legendY, {
      lineBreak: false,
    });
    doc.rect(x + labelW + 68, legendY + 1, 8, 8).fill(C.orange);
    doc.text('Compras', x + labelW + 80, legendY, { lineBreak: false });
    doc.y = legendY + 14;

    for (const row of chartRows) {
      ensureSpace(doc, 26);
      const cy = doc.y;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(C.ink)
        .text(row.label, x, cy + 2, { width: labelW - 4, lineBreak: false });
      const sw = Math.max(row.sales > 0 ? 2 : 0, (row.sales / max) * barArea);
      const pw = Math.max(row.purchases > 0 ? 2 : 0, (row.purchases / max) * barArea);
      doc.roundedRect(x + labelW, cy, sw, 7, 1.5).fill(C.green);
      doc.roundedRect(x + labelW, cy + 10, pw, 7, 1.5).fill(C.orange);
      doc
        .font('Helvetica')
        .fontSize(6.5)
        .fillColor(C.muted)
        .text(cop(row.sales), x + labelW + barArea + 2, cy, {
          width: valueW,
          align: 'right',
          lineBreak: false,
        });
      doc.text(cop(row.purchases), x + labelW + barArea + 2, cy + 10, {
        width: valueW,
        align: 'right',
        lineBreak: false,
      });
      doc.y = cy + 24;
    }
  }
  doc.moveDown(0.3);

  // ── Tabla diaria ──
  section(doc, '4. Resumen diario');
  {
    const cols = [
      { title: 'Día', width: 86 },
      { title: 'Ventas', width: 78, align: 'right' as const },
      { title: 'Ops', width: 34, align: 'center' as const },
      { title: 'Compras', width: 78, align: 'right' as const },
      { title: 'Neto', width: w - 86 - 78 - 34 - 78, align: 'right' as const },
    ];
    ensureSpace(doc, 20 + days.length * 15);
    const hy = doc.y;
    doc.rect(M.left, hy, w, 16).fill(C.green);
    let hx = M.left;
    for (const col of cols) {
      doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor(C.white)
        .text(col.title, hx + 3, hy + 4, {
          width: col.width - 6,
          align: col.align ?? 'left',
          lineBreak: false,
        });
      hx += col.width;
    }
    doc.y = hy + 16;
    days.forEach((d, i) => {
      ensureSpace(doc, 15);
      const b = byDay.get(d)!;
      const dayNet = b.sales - b.purchases - b.labor;
      const y = doc.y;
      if (i % 2 === 1) doc.rect(M.left, y, w, 14).fill(C.rowAlt);
      const vals = [
        dayLabel(d),
        cop(b.sales),
        String(b.salesCount),
        cop(b.purchases),
        cop(dayNet),
      ];
      let x = M.left;
      vals.forEach((text, j) => {
        doc
          .font('Helvetica')
          .fontSize(7.5)
          .fillColor(C.ink)
          .text(text, x + 3, y + 3, {
            width: cols[j].width - 6,
            align: cols[j].align ?? 'left',
            lineBreak: false,
          });
        x += cols[j].width;
      });
      doc.y = y + 14;
    });
  }
  doc.moveDown(0.45);

  // ── Top productos ──
  section(doc, '5. Productos que más aportaron');
  if (!topProducts.length) {
    p(doc, 'Sin líneas de venta en el periodo.');
  } else {
    for (const prod of topProducts) {
      bullet(
        doc,
        `${prod.name}: ${prod.qty % 1 === 0 ? prod.qty : prod.qty.toFixed(1)} ud · ${cop(prod.revenue)}`,
      );
    }
    doc.moveDown(0.25);
  }

  // ── Movimientos (compacto) ──
  section(doc, '6. Movimientos registrados');
  p(
    doc,
    `Se registraron ${sales.length} ventas y ${purchases.length} compras. A continuación, el detalle resumido (código, medio y total).`,
  );

  ensureSpace(doc, 18);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.green).text('Ventas', M.left, doc.y);
  doc.moveDown(0.2);
  for (const s of sales) {
    ensureSpace(doc, 12);
    const day = bogotaDateKey(s.saleDate);
    const pay = String(s.paymentMethod ?? '—')
      .replace(/^Transferencia\b/i, 'Nequi/transf.')
      .replace(/\s*\$[\d.\s\u00a0]+$/, '');
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.ink)
      .text(
        `${dayLabel(day)} · ${s.code ?? s.id.slice(0, 8)} · ${pay} · ${cop(Number(s.total))}`,
        M.left,
        doc.y,
        { width: w, lineBreak: false },
      );
    doc.moveDown(0.12);
  }

  doc.moveDown(0.35);
  ensureSpace(doc, 18);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange).text('Compras', M.left, doc.y);
  doc.moveDown(0.2);
  for (const purchase of purchases) {
    ensureSpace(doc, 12);
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.ink)
      .text(
        `${dayLabel(bogotaDateKey(purchase.purchaseDate))} · ${purchase.code} · ${purchase.name ?? purchase.supplier ?? 'Compra'} · ${cop(Number(purchase.totalValue ?? 0))}`,
        M.left,
        doc.y,
        { width: w },
      );
    doc.moveDown(0.12);
  }

  if (shifts.length) {
    doc.moveDown(0.35);
    ensureSpace(doc, 18);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.blue).text('Turnos', M.left, doc.y);
    doc.moveDown(0.2);
    for (const sh of shifts) {
      ensureSpace(doc, 12);
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(C.ink)
        .text(
          `${dayLabel(dateKeyFromDbDate(sh.shiftDate))} · ${sh.staffMember.name} · ${sh.hoursWorked != null ? `${Number(sh.hoursWorked)} h` : '—'} · ${cop(Number(sh.totalPayCOP ?? 0))}`,
          M.left,
          doc.y,
          { width: w, lineBreak: false },
        );
      doc.moveDown(0.12);
    }
  }

  // ── Plan de acción (parte de la carta, no anexo) ──
  section(doc, '7. Plan de acción de esta semana');
  p(
    doc,
    'Hola equipo Arándano, muy buenas noches. Esta semana nos concentramos en vender y rotar lo que ya tenemos. No habrá compras nuevas salvo reposición indispensable, pagada con el mismo dinero que genere el negocio.',
  );

  ensureSpace(doc, 44);
  {
    const y = doc.y;
    doc.roundedRect(M.left, y, w, 36, 4).fillAndStroke(C.greenSoft, C.green);
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(C.green)
      .text(
        `Meta mínima: ${cop(META_MIN)}     ·     Meta ideal: ${cop(META_IDEAL)}`,
        M.left + 10,
        y + 12,
        { width: w - 20, align: 'center' },
      );
    doc.y = y + 44;
  }

  p(
    doc,
    'La prioridad es el PERRO PEQUEÑO (tenemos abastecido). El perro grande no se promociona: quedan pocas unidades y solo se vende si el cliente lo pide.',
  );

  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.orange).text('Combos para ofrecer siempre', M.left, doc.y);
  doc.moveDown(0.2);
  bullet(doc, 'Perro pequeño + Poker: $12.000');
  bullet(doc, 'Perro pequeño + Poker michelada: $15.000');
  bullet(doc, 'Perro pequeño + copa de vino: $17.000');
  p(
    doc,
    'No son descuentos: juntamos productos de la carta para facilitar la venta. Impulsar también Gin & Tonic, Mojito, Cóctel Arándano, cerveza/michelada, vino por copa y licores en stock.',
  );

  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('Regla de atención', M.left, doc.y);
  doc.moveDown(0.2);
  p(
    doc,
    'Ningún pedido sin complemento. Perro → bebida. Cerveza → michelada. Bebida → perro pequeño. Si termina la bebida → ofrecer otra ronda.',
  );

  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text('Publicaciones y tablero', M.left, doc.y);
  doc.moveDown(0.2);
  p(
    doc,
    'Cada día, mínimo 3 historias: perro/combos, cerveza o vino, y cócteles (viernes y sábado reforzar bebidas). En el tablero de ventas: al abrir se escribe la META; durante el turno se actualiza VENDIDO y FALTA (se ve en la app); al cierre se deja el TOTAL DEL DÍA. No esperamos al domingo para descubrir que no llegamos.',
  );

  doc
    .font('Helvetica-Oblique')
    .fontSize(10)
    .fillColor(C.green)
    .text('¡Espero que lo logremos!', M.left, doc.y + 4, {
      width: w,
      align: 'center',
    });

  doc.moveDown(1);
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(C.muted)
    .text(
      'Fin de la carta semanal · Datos de VOS-AI · Confidencial — equipo Arándano Café Bar',
      M.left,
      doc.y,
      { width: w, align: 'center' },
    );

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });

  await prisma.$disconnect();
  await pool.end();

  console.log(outPath);
  console.log(
    JSON.stringify(
      {
        salesTotal,
        utilidadCaja,
        puntoEquilibrio,
        grossMargin,
        purchasesTotal,
        pages: pageCount,
        logo: Boolean(logoPath),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
