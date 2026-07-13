import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

async function dataUrlToBytes(u) {
  const r = await fetch(u)
  return new Uint8Array(await r.arrayBuffer())
}

// masterBytes: ArrayBuffer/Uint8Array of the master PDF
// fields: [{id,page,x,y,w,h,type,signer,label}]  (x/y/w/h are 0..1 fractions, y from top)
// values: { [fieldId]: string | boolean | dataURL }  (signature/initials must be image dataURLs)
export async function flattenPdf(masterBytes, fields, values) {
  const pdf = await PDFDocument.load(masterBytes)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()
  for (const f of fields || []) {
    const v = values ? values[f.id] : undefined
    if (v === undefined || v === null || v === '' || v === false) continue
    const page = pages[(f.page || 1) - 1]
    if (!page) continue
    const pw = page.getWidth(), ph = page.getHeight()
    const x = f.x * pw, w = f.w * pw, h = f.h * ph
    const y = ph - (f.y * ph) - h
    if (f.type === 'signature' || f.type === 'initials') {
      try {
        const png = await pdf.embedPng(await dataUrlToBytes(v))
        const scale = Math.min(w / png.width, h / png.height)
        const dw = png.width * scale, dh = png.height * scale
        page.drawImage(png, { x: x + (w - dw) / 2, y: y + (h - dh) / 2, width: dw, height: dh })
      } catch (e) { /* skip bad image */ }
    } else if (f.type === 'checkbox') {
      const size = Math.min(h, w) * 0.9
      page.drawText('X', { x: x + w / 2 - size * 0.3, y: y + (h - size) / 2 + 1, size, font, color: rgb(0, 0, 0) })
    } else {
      const size = Math.max(6, Math.min(13, h * 0.6))
      page.drawText(String(v), { x: x + 2, y: y + (h - size) / 2 + 1, size, font, color: rgb(0, 0, 0), maxWidth: w - 4 })
    }
  }
  return await pdf.save()
}
