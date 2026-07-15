// Combine an array of files (images and/or PDFs) into a single PDF (Uint8Array).
// Images become one page each; PDFs have their pages copied in. Unembeddable files are skipped.
export async function filesToPdf(files) {
  const { PDFDocument } = await import('pdf-lib')
  const out = await PDFDocument.create()
  for (const f of files) {
    const buf = new Uint8Array(await f.arrayBuffer())
    const type = (f.type || '').toLowerCase()
    const name = (f.name || '').toLowerCase()
    if (type.includes('pdf') || name.endsWith('.pdf')) {
      try {
        const src = await PDFDocument.load(buf)
        const pages = await out.copyPages(src, src.getPageIndices())
        pages.forEach(p => out.addPage(p))
      } catch { /* skip unreadable pdf */ }
    } else {
      let img
      try { img = (type.includes('png') || name.endsWith('.png')) ? await out.embedPng(buf) : await out.embedJpg(buf) }
      catch { try { img = await out.embedPng(buf) } catch { continue } }
      const page = out.addPage([img.width, img.height])
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
    }
  }
  if (out.getPageCount() === 0) throw new Error('Could not read those files — please use JPG, PNG or PDF.')
  return await out.save()
}
