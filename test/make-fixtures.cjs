/**
 * Generates a layered PSD and a multi-page PDF so the psd / pages ingest paths
 * can be exercised without hunting for real files.
 *
 * Run: node test/make-fixtures.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { writePsd } = require("ag-psd");

const OUT = path.join(__dirname, ".fixtures");
fs.mkdirSync(OUT, { recursive: true });

const W = 900;
const H = 700;

function layerPixels(w, h, paint) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = paint(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width: w, height: h, data };
}

// Background wash
const bg = layerPixels(W, H, (x, y) => [
  40 + (x / W) * 60,
  36 + (y / H) * 40,
  70 + (x / W) * 50,
  255,
]);

// A disc, offset from the origin so trimmed bounds are actually exercised
const discW = 400;
const discH = 400;
const disc = layerPixels(discW, discH, (x, y) => {
  const d = Math.hypot(x - discW / 2, y - discH / 2);
  const a = d < discH / 2 - 4 ? 255 : d < discH / 2 ? 120 : 0;
  return [235, 150, 90, a];
});

// Sketch lines
const sketch = layerPixels(W, H, (x, y) => {
  const on = Math.abs(Math.sin(x / 26) * 90 + H / 2 - y) < 2.2;
  return [250, 250, 250, on ? 235 : 0];
});

const composite = layerPixels(W, H, (x, y) => {
  const dx = x - 430;
  const dy = y - 330;
  const inDisc = Math.hypot(dx, dy) < discH / 2 - 4;
  if (inDisc) return [235, 150, 90, 255];
  return [40 + (x / W) * 60, 36 + (y / H) * 40, 70 + (x / W) * 50, 255];
});

const psd = {
  width: W,
  height: H,
  imageData: composite,
  children: [
    { name: "Background", imageData: bg, left: 0, top: 0, right: W, bottom: H, opacity: 1 },
    {
      name: "Paint",
      opened: true,
      children: [
        {
          name: "Base shape",
          imageData: disc,
          left: 230,
          top: 130,
          right: 230 + discW,
          bottom: 130 + discH,
          opacity: 1,
          blendMode: "multiply",
        },
        {
          name: "Colour grade",
          imageData: layerPixels(200, 200, () => [255, 80, 80, 60]),
          left: 300,
          top: 200,
          right: 500,
          bottom: 400,
          opacity: 0.7,
          // Non-separable: should be flagged as unsupported in the panel.
          blendMode: "luminosity",
        },
      ],
    },
    {
      name: "Sketch",
      imageData: sketch,
      left: 0,
      top: 0,
      right: W,
      bottom: H,
      opacity: 0.85,
      hidden: true,
    },
  ],
};

const buffer = writePsd(psd, { generateThumbnail: false, imageResources: {} });
const psdPath = path.join(OUT, "layered-test.psd");
fs.writeFileSync(psdPath, Buffer.from(buffer));
console.log(`psd  → ${psdPath} (${(buffer.byteLength / 1024).toFixed(0)} KB)`);

// ── Minimal 3-page PDF ────────────────────────────────────────────────────────
// Hand-written because this machine has no poppler/ghostscript to generate one.
function makePdf(pageCount) {
  const objects = [];
  const kids = [];
  for (let i = 0; i < pageCount; i++) kids.push(`${4 + i * 2} 0 R`);

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  for (let i = 0; i < pageCount; i++) {
    const text = `BT /F1 44 Tf 72 640 Td (Review page ${i + 1}) Tj ET\n` +
      `1 0 0 RG 6 w 72 120 m 460 480 l S`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const pdfPath = path.join(OUT, "pages-test.pdf");
fs.writeFileSync(pdfPath, makePdf(3));
console.log(`pdf  → ${pdfPath}`);
