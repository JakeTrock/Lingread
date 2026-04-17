export const SUPPORTED_DOCUMENT_ACCEPT =
  '.txt,text/plain,.pdf,application/pdf,.epub,application/epub+zip'

export const SUPPORTED_DOCUMENT_LABEL = '.txt, .pdf, or .epub'

const EPUB_CONTAINER_PATH = 'META-INF/container.xml'
let pdfWorkerConfigured = false
type ZipArchive = Awaited<ReturnType<typeof loadZipArchive>>

export async function extractTextFromDocument(file: File): Promise<string> {
  const extension = getFileExtension(file.name)

  if (extension === 'txt') {
    return normalizeExtractedText(await file.text())
  }

  if (extension === 'pdf') {
    return normalizeExtractedText(await extractTextFromPdf(file))
  }

  if (extension === 'epub') {
    return normalizeExtractedText(await extractTextFromEpub(file))
  }

  throw new Error(`Unsupported file type. Choose ${SUPPORTED_DOCUMENT_LABEL}.`)
}

async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfWorkerConfigured) {
    const { default: pdfWorkerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    pdfWorkerConfigured = true
  }

  const bytes = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: bytes })

  try {
    const pdf = await loadingTask.promise
    const pages: string[] = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const parts: string[] = []

      for (const item of textContent.items) {
        if (!('str' in item) || typeof item.str !== 'string') continue
        const text = item.str.trim()
        if (text) parts.push(text)
        if (item.hasEOL) parts.push('\n')
      }

      pages.push(parts.join(' '))
      page.cleanup()
    }

    return pages.join('\n\n')
  } catch {
    throw new Error('Could not read text from this PDF.')
  } finally {
    void loadingTask.destroy()
  }
}

async function extractTextFromEpub(file: File): Promise<string> {
  try {
    const zip = await loadZipArchive(file)
    const containerEntry = zip.file(EPUB_CONTAINER_PATH)
    if (!containerEntry) {
      throw new Error('Missing EPUB container metadata.')
    }

    const containerXml = await containerEntry.async('string')
    const containerDoc = parseXml(containerXml, 'EPUB container metadata')
    const rootfile = findElementsByLocalName(containerDoc, 'rootfile')[0]
    const packagePath = rootfile?.getAttribute('full-path')
    if (!packagePath) {
      throw new Error('Missing EPUB package manifest.')
    }

    const packageEntry = getZipEntry(zip, packagePath)
    if (!packageEntry) {
      throw new Error('EPUB package manifest could not be loaded.')
    }

    const packageXml = await packageEntry.async('string')
    const packageDoc = parseXml(packageXml, 'EPUB package manifest')
    const manifest = buildEpubManifest(packageDoc, packagePath)
    const orderedContentPaths = getOrderedEpubContentPaths(packageDoc, manifest)
    const fallbackPaths = getFallbackEpubContentPaths(zip)
    const contentPaths = orderedContentPaths.length > 0 ? orderedContentPaths : fallbackPaths

    const sections: string[] = []
    for (const path of contentPaths) {
      const entry = getZipEntry(zip, path)
      if (!entry) continue
      const markup = await entry.async('string')
      const text = extractTextFromMarkup(markup)
      if (text) sections.push(text)
    }

    if (sections.length === 0) {
      throw new Error('This EPUB does not contain readable text content.')
    }

    return sections.join('\n\n')
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }

    throw new Error('Could not read text from this EPUB.')
  }
}

function buildEpubManifest(doc: XMLDocument, packagePath: string): Map<string, string> {
  const manifest = new Map<string, string>()

  for (const item of findElementsByLocalName(doc, 'item')) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (!id || !href) continue
    manifest.set(id, resolveZipPath(packagePath, href))
  }

  return manifest
}

function getOrderedEpubContentPaths(doc: XMLDocument, manifest: Map<string, string>): string[] {
  const contentPaths: string[] = []

  for (const itemref of findElementsByLocalName(doc, 'itemref')) {
    const idref = itemref.getAttribute('idref')
    if (!idref) continue
    const path = manifest.get(idref)
    if (!path) continue
    contentPaths.push(path)
  }

  return dedupe(contentPaths)
}

function getFallbackEpubContentPaths(zip: ZipArchive): string[] {
  return Object.keys(zip.files)
    .filter((path) => /\.(xhtml|html|htm)$/i.test(path))
    .sort((a, b) => a.localeCompare(b))
}

function extractTextFromMarkup(markup: string): string {
  const parser = new DOMParser()
  const htmlDoc = parser.parseFromString(markup, 'text/html')

  for (const selector of ['script', 'style', 'noscript', 'svg', 'math', 'head', 'title']) {
    htmlDoc.querySelectorAll(selector).forEach((node) => node.remove())
  }

  return normalizeExtractedText(htmlDoc.body?.textContent ?? htmlDoc.documentElement?.textContent ?? '')
}

function parseXml(text: string, label: string): XMLDocument {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error(`Could not parse ${label}.`)
  }
  return doc
}

function findElementsByLocalName(root: XMLDocument | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((element) => element.localName === localName)
}

function getZipEntry(zip: ZipArchive, path: string) {
  return zip.file(path) ?? zip.file(safelyDecodeUriComponent(path))
}

async function loadZipArchive(file: File) {
  const { default: JSZip } = await import('jszip')
  return JSZip.loadAsync(await file.arrayBuffer())
}

function resolveZipPath(fromPath: string, relativePath: string): string {
  if (relativePath.startsWith('/')) {
    return normalizeZipPath(relativePath)
  }

  const baseDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : ''
  return normalizeZipPath(`${baseDir}${relativePath}`)
}

function normalizeZipPath(path: string): string {
  const parts = path.replace(/^\/+/, '').split('/')
  const normalized: string[] = []

  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      normalized.pop()
      continue
    }
    normalized.push(part)
  }

  return normalized.join('/')
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getFileExtension(name: string): string {
  const match = /\.([^.]+)$/.exec(name.trim().toLowerCase())
  return match?.[1] ?? ''
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function safelyDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
