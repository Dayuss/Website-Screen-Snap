// Minimal single-page PDF writer (no dependencies). Embeds a canvas as one full-page image.
//   - up to LOSSLESS_MAX_PIXELS: raw RGB compressed with Flate (lossless, text stays sharp)
//   - larger canvases: JPEG (DCT) to keep memory in check
const LOSSLESS_MAX_PIXELS = 40e6;
const PDF_MAX_POINTS = 14400; // PDF 1.4 page size limit (200 in)
const CSS_PX_TO_PT = 0.75; // 96 dpi -> 72 dpi

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encodeImage(canvas) {
  const { width: w, height: h } = canvas;
  if (w * h <= LOSSLESS_MAX_PIXELS) {
    const rgba = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }
    return { data: await deflate(rgb), filter: '/FlateDecode' };
  }
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  return { data: new Uint8Array(await jpeg.arrayBuffer()), filter: '/DCTDecode' };
}

// cssW/cssH: page size in CSS px (the page is sized to the screenshot, so nothing gets split or cropped).
async function buildPdf(canvas, cssW, cssH) {
  let pageW = cssW * CSS_PX_TO_PT;
  let pageH = cssH * CSS_PX_TO_PT;
  const over = Math.max(pageW, pageH) / PDF_MAX_POINTS;
  if (over > 1) {
    pageW /= over;
    pageH /= over;
  }
  const W = pageW.toFixed(2);
  const H = pageH.toFixed(2);

  const { data, filter } = await encodeImage(canvas);
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let offset = 0;
  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    offset += bytes.length;
  };
  const begin = (n) => {
    offsets[n] = offset;
    push(`${n} 0 obj\n`);
  };
  const end = () => push('endobj\n');

  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;

  push('%PDF-1.4\n%âãÏÓ\n');
  begin(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\n');
  end();
  begin(2);
  push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n');
  end();
  begin(3);
  push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\n`);
  end();
  begin(4);
  push(
    `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${filter} /Length ${data.length} >>\nstream\n`,
  );
  push(data);
  push('\nendstream\n');
  end();
  begin(5);
  push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\n`);
  end();

  const xrefAt = offset;
  push('xref\n0 6\n0000000000 65535 f \n');
  for (let n = 1; n <= 5; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  return new Blob(parts, { type: 'application/pdf' });
}

if (typeof module !== 'undefined') module.exports = { buildPdf };
