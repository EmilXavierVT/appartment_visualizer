import { defineConfig } from 'vite'

function cleanText(value = '') {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&times;|&#215;/g, 'x')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractJsonLd(html) {
  const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  const entries = []

  for (const match of jsonLdMatches) {
    try {
      const data = JSON.parse(cleanText(match[1]))
      entries.push(...flattenJsonLd(data))
    } catch {
      // Ignore invalid JSON-LD blocks.
    }
  }

  return entries
}

function flattenJsonLd(value) {
  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return value.flatMap(flattenJsonLd)
  }

  if (typeof value !== 'object') {
    return []
  }

  return [value, ...flattenJsonLd(value['@graph'])]
}

function extractTitle(html) {
  const product = extractJsonLd(html).find((entry) => isProduct(entry))

  if (product?.name) {
    return cleanText(product.name)
  }

  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)

  return cleanText(ogTitle?.[1] || title?.[1] || 'Imported furniture')
}

function absoluteUrl(value, baseUrl) {
  if (!value) {
    return null
  }

  try {
    return new URL(cleanText(String(value)), baseUrl).toString()
  } catch {
    return null
  }
}

function imageFromJsonLdValue(value) {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(imageFromJsonLdValue).find(Boolean) || null
  }

  if (typeof value === 'object') {
    return imageFromJsonLdValue(value.url || value.contentUrl || value.thumbnailUrl)
  }

  return null
}

function extractImageUrl(html, url) {
  const product = extractJsonLd(html).find((entry) => isProduct(entry))
  const structuredImage = imageFromJsonLdValue(product?.image)

  if (structuredImage) {
    return absoluteUrl(structuredImage, url)
  }

  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)

    if (match?.[1]) {
      return absoluteUrl(match[1], url)
    }
  }

  return null
}

function parseNumber(value) {
  return Number(value.replace(',', '.'))
}

function toCentimeters(value, unit) {
  const normalizedUnit = unit?.toLowerCase()

  if (!normalizedUnit) {
    return value
  }

  if (normalizedUnit === 'm') {
    return value * 100
  }

  if (normalizedUnit === 'mm') {
    return value / 10
  }

  if (normalizedUnit === 'in' || normalizedUnit === 'inch' || normalizedUnit === 'inches') {
    return value * 2.54
  }

  return value
}

function isProduct(entry) {
  const type = entry?.['@type']
  const types = Array.isArray(type) ? type : [type]

  return types.some((item) => String(item).toLowerCase() === 'product')
}

function normalizeLabel(label = '') {
  return cleanText(label).toLowerCase()
}

function dimensionRoleFromLabel(label = '') {
  const normalized = normalizeLabel(label)

  if (/^(?:b|w|width|bredde)$/.test(normalized)) {
    return 'width'
  }

  if (/^(?:d|depth|dybde)$/.test(normalized)) {
    return 'depth'
  }

  if (/^(?:h|height|højde|hojde|høyde|hoeyde)$/.test(normalized)) {
    return 'height'
  }

  if (/^(?:l|length|længde|laengde|lengde)$/.test(normalized)) {
    return 'width'
  }

  return null
}

function collectDimensionText(entry) {
  if (!entry || typeof entry !== 'object') {
    return []
  }

  const values = []
  const keys = ['width', 'depth', 'height', 'length', 'size', 'dimensions', 'additionalProperty']

  keys.forEach((key) => {
    const value = entry[key]

    if (typeof value === 'string' || typeof value === 'number') {
      values.push(`${key} ${value}`)
    }

    if (value && typeof value === 'object') {
      values.push(JSON.stringify(value))
    }
  })

  return values
}

function buildDimensions(widthCm, depthCm, heightCm, source, confidence = 1) {
  const dimensions = {
    widthCm: Math.round(widthCm),
    depthCm: Math.round(depthCm),
    heightCm: Math.round(heightCm),
    source,
    confidence,
  }

  return validateDimensions(dimensions)
}

function validateDimensions(dimensions) {
  const values = [dimensions.widthCm, dimensions.depthCm, dimensions.heightCm]

  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    return null
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const warnings = []

  if (max < 25) {
    warnings.push('Imported dimensions are unusually small; verify the product page uses cm/mm/m correctly.')
  }

  if (max > 450) {
    warnings.push('Imported dimensions are unusually large; verify this is not package size or a room-size measurement.')
  }

  if (min < 2) {
    warnings.push('One dimension is below 2 cm, which usually means the page was parsed incorrectly.')
  }

  return { ...dimensions, warnings }
}

function dimensionFromValue(value) {
  if (!value) {
    return null
  }

  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'object') {
    return dimensionFromValue(value.value ?? value['@value'] ?? value.name)
  }

  const match = String(value).match(/(\d+(?:[.,]\d+)?)\s*(cm|mm|m|in|inch|inches)?/i)

  if (!match) {
    return null
  }

  return toCentimeters(parseNumber(match[1]), match[2])
}

function extractStructuredDimensions(html) {
  const product = extractJsonLd(html).find((entry) => isProduct(entry))

  if (!product) {
    return null
  }

  const width = dimensionFromValue(product.width)
  const height = dimensionFromValue(product.height)
  const depth = dimensionFromValue(product.depth ?? product.length)

  if (width && depth && height) {
    return buildDimensions(width, depth, height, 'structured product data', 3)
  }

  const fromProductText = extractDimensionsFromText(collectDimensionText(product).join(' '), 'structured product text', 2)

  if (fromProductText) {
    return fromProductText
  }

  return null
}

function inferCompactUnit(values, unit) {
  if (unit) {
    return unit
  }

  const max = Math.max(...values)

  if (max <= 10) {
    return 'm'
  }

  if (max > 450) {
    return 'mm'
  }

  return 'cm'
}

function buildCompactDimensions(match, source, confidence) {
  const rawValues = [parseNumber(match[1]), parseNumber(match[3]), parseNumber(match[5])]
  const inferredUnit = inferCompactUnit(rawValues, match[2] || match[4] || match[6])
  const values = rawValues.map((value) => toCentimeters(value, inferredUnit))

  return buildDimensions(values[0], values[1], values[2], source, confidence)
}

function scoreCompactDimensionMatch(text, match) {
  const before = text.slice(Math.max(0, match.index - 64), match.index).toLowerCase()
  const after = text.slice(match.index + match[0].length, match.index + match[0].length + 64).toLowerCase()
  const context = `${before} ${after}`
  let score = 0

  if (/(dimension|dimensions|size|sizes|mål|mal|mått|measure|measurements|spec|specification|bredde|width|depth|height|højde|hojde|dybde|length|længde|laengde)/i.test(context)) {
    score += 4
  }

  if (/(package|packaging|parcel|shipping|box|emballage)/i.test(context)) {
    score -= 3
  }

  if (match[2] || match[4] || match[6]) {
    score += 2
  }

  return score
}

function findLabeledValue(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(`(?:${label})\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)\\s*(cm|mm|m|in|inch|inches)?`, 'i')
    const match = text.match(pattern)

    if (match) {
      return toCentimeters(parseNumber(match[1]), match[2])
    }
  }

  return null
}

function extractLooseLabeledDimensions(text, source, confidence) {
  const normalized = cleanText(text)
  const width = findLabeledValue(normalized, ['width', 'w', 'bredde', 'b'])
  const depth = findLabeledValue(normalized, ['depth', 'd', 'dybde', 'length', 'længde', 'laengde', 'lengde', 'l'])
  const height = findLabeledValue(normalized, ['height', 'h', 'højde', 'hojde', 'høyde', 'hoeyde'])

  if (width && depth && height) {
    return buildDimensions(width, depth, height, `${source} labeled fallback`, confidence)
  }

  return null
}

function extractLabeledCompactDimensions(text, source, confidence) {
  const normalized = cleanText(text)
  const valuePattern = '(?:width|w|bredde|b|depth|d|dybde|length|længde|laengde|lengde|l|height|h|højde|hojde|høyde|hoeyde)\\s*[:=]?\\s*\\d+(?:[.,]\\d+)?\\s*(?:cm|mm|m|in|inch|inches)?'
  const pattern = new RegExp(`${valuePattern}(?:\\s*(?:x|×|\\*)\\s*${valuePattern}){2}`, 'i')
  const match = normalized.match(pattern)

  if (!match) {
    return null
  }

  return extractLooseLabeledDimensions(match[0], source, confidence)
}

function extractLabeledSequenceDimensions(text, source, confidence) {
  const normalized = cleanText(text)
  const pattern = /(?:^|[^a-zæøå])(?<label>width|bredde|depth|dybde|height|højde|hojde|høyde|hoeyde|length|længde|laengde|lengde|w|b|d|h|l)\s*[:=\-]?\s*(?<value>\d+(?:[.,]\d+)?)\s*(?<unit>cm|mm|m|in|inch|inches)?/gi
  const matches = [...normalized.matchAll(pattern)].map((match) => ({
    index: match.index,
    end: match.index + match[0].length,
    role: dimensionRoleFromLabel(match.groups.label),
    value: toCentimeters(parseNumber(match.groups.value), match.groups.unit || 'cm'),
  })).filter((match) => match.role)

  for (let index = 0; index < matches.length; index += 1) {
    const dimensions = {}
    const start = matches[index].index

    for (let nextIndex = index; nextIndex < matches.length; nextIndex += 1) {
      const match = matches[nextIndex]

      if (match.end - start > 140) {
        break
      }

      dimensions[match.role] ??= match.value

      if (dimensions.width && dimensions.depth && dimensions.height) {
        return buildDimensions(dimensions.width, dimensions.depth, dimensions.height, `${source} labeled sequence`, confidence + 1)
      }
    }
  }

  return null
}

function extractDanishSizeDimensions(text, source, confidence) {
  const normalized = cleanText(text)
  const bedSizeMatch = normalized.match(/(?:størrelse|stoerrelse|mål|maal)[^0-9]{0,20}b\s*(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*(?:x|×|\*)\s*l\s*(\d+(?:[.,]\d+)?)\s*(?:cm)?[^.]{0,80}h(?:ø|oe|o)jde\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|m|in|inch|inches)?/i)

  if (bedSizeMatch) {
    return buildDimensions(
      toCentimeters(parseNumber(bedSizeMatch[1]), bedSizeMatch[4] || 'cm'),
      toCentimeters(parseNumber(bedSizeMatch[2]), bedSizeMatch[4] || 'cm'),
      toCentimeters(parseNumber(bedSizeMatch[3]), bedSizeMatch[4] || 'cm'),
      `${source} Danish size`,
      confidence + 1,
    )
  }

  const specsMatch = normalized.match(/h(?:ø|oe|o)jde(?:\s+ekskl\.[^0-9]{0,24})?\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|m|in|inch|inches)?[^.]{0,120}(?:størrelse|stoerrelse)[^.]{0,80}bredde\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|m|in|inch|inches)?[^.]{0,80}l(?:æ|ae|e)ngde\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|m|in|inch|inches)?/i)

  if (specsMatch) {
    return buildDimensions(
      toCentimeters(parseNumber(specsMatch[3]), specsMatch[4] || specsMatch[2] || 'cm'),
      toCentimeters(parseNumber(specsMatch[5]), specsMatch[6] || specsMatch[2] || 'cm'),
      toCentimeters(parseNumber(specsMatch[1]), specsMatch[2] || 'cm'),
      `${source} Danish specs`,
      confidence + 1,
    )
  }

  return null
}

function findProductFootprint(text) {
  const normalized = cleanText(text)
  const match = normalized.match(/(?:^|[^0-9])(\d{2,3})\s*(?:x|×|\*)\s*(\d{2,3})\s*(?:cm)?(?:[^0-9]|$)/i)

  if (!match) {
    return null
  }

  return {
    width: toCentimeters(parseNumber(match[1]), 'cm'),
    depth: toCentimeters(parseNumber(match[2]), 'cm'),
  }
}

function findProductHeight(text) {
  const normalized = cleanText(text)
  const patterns = [
    /(?:sengeh(?:ø|oe|o)jden|sengens\s+h(?:ø|oe|o)jde|siddeh(?:ø|oe|o)jde|totalh(?:ø|oe|o)jde)\D{0,32}(\d+(?:[.,]\d+)?)\s*(cm|mm|m|in|inch|inches)?/i,
    /(?:height|h(?:ø|oe|o)jde)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|m|in|inch|inches)?/i,
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)

    if (match) {
      return toCentimeters(parseNumber(match[1]), match[2] || 'cm')
    }
  }

  return null
}

function extractFootprintWithSeparateHeight(text, url, source, confidence) {
  const titleFootprint = findProductFootprint(extractTitle(text))
  const urlFootprint = findProductFootprint(decodeURIComponent(url || ''))
  const pageFootprint = findProductFootprint(text)
  const footprint = titleFootprint || urlFootprint || pageFootprint
  const height = findProductHeight(text)

  if (footprint && height) {
    return buildDimensions(footprint.width, footprint.depth, height, `${source} footprint plus height`, confidence)
  }

  return null
}

function extractDimensionsFromText(text, source, confidence = 1, url = '') {
  const normalized = cleanText(text)
  const number = '(\\d+(?:[.,]\\d+)?)'
  const unit = '(cm|mm|m|in|inch|inches)?'
  const labelGap = '[^0-9]{0,24}'
  const widthLabels = '(?:width|w|bredde|b)'
  const depthLabels = '(?:depth|d|dybde|length|længde|laengde|lengde|l)'
  const heightLabels = '(?:height|h|højde|hojde|høyde|hoeyde)'
  const labeledPatterns = [
    new RegExp(`${widthLabels}${labelGap}${number}\\s*${unit}.*?${depthLabels}${labelGap}${number}\\s*${unit}.*?${heightLabels}${labelGap}${number}\\s*${unit}`, 'i'),
    new RegExp(`${widthLabels}${labelGap}${number}\\s*${unit}.*?${heightLabels}${labelGap}${number}\\s*${unit}.*?${depthLabels}${labelGap}${number}\\s*${unit}`, 'i'),
  ]

  const danishSize = extractDanishSizeDimensions(normalized, source, confidence)

  if (danishSize) {
    return danishSize
  }

  const footprintWithHeight = extractFootprintWithSeparateHeight(normalized, url, source, confidence)

  if (footprintWithHeight) {
    return footprintWithHeight
  }

  const labeledSequence = extractLabeledSequenceDimensions(normalized, source, confidence)

  if (labeledSequence) {
    return labeledSequence
  }

  for (const pattern of labeledPatterns) {
    const match = normalized.match(pattern)

    if (!match) {
      continue
    }

    const width = toCentimeters(parseNumber(match[1]), match[2])
    const second = toCentimeters(parseNumber(match[3]), match[4])
    const third = toCentimeters(parseNumber(match[5]), match[6])
    const isWidthHeightDepth = /height|højde|hojde|høyde|hoeyde/i.test(match[0].split(match[3])[0])

    return isWidthHeightDepth
      ? buildDimensions(width, third, second, source, confidence)
      : buildDimensions(width, second, third, source, confidence)
  }

  const compactPattern = /(\d+(?:[.,]\d+)?)\s*(cm|mm|m|in|inch|inches)?\s*(?:x|×|\*|by)\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|m|in|inch|inches)?\s*(?:x|×|\*|by)\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|m|in|inch|inches)?/gi
  const compactMatches = [...normalized.matchAll(compactPattern)]

  const labeledCompact = extractLabeledCompactDimensions(normalized, source, confidence)

  if (labeledCompact) {
    return labeledCompact
  }

  const looseLabeled = extractLooseLabeledDimensions(normalized, source, confidence)

  if (looseLabeled) {
    return looseLabeled
  }

  for (const match of compactMatches) {
    if (scoreCompactDimensionMatch(normalized, match) < 4) {
      continue
    }

    return buildCompactDimensions(match, source, confidence)
  }

  const fallbackMatches = compactMatches
    .map((match) => ({ match, dimensions: buildCompactDimensions(match, `${source} fallback`, Math.max(confidence - 1, 0)), score: scoreCompactDimensionMatch(normalized, match) }))
    .filter(({ dimensions }) => dimensions)
    .sort((a, b) => b.score - a.score)

  if (fallbackMatches.length > 0) {
    const fallback = fallbackMatches[0].dimensions

    return {
      ...fallback,
      warnings: [
        ...fallback.warnings,
        'Dimensions were found without a clear product-dimension label; verify width, depth, and height below.',
      ],
    }
  }

  return null
}

function extractDimensions(html, url = '') {
  return extractStructuredDimensions(html)
    || extractDimensionsFromText(decodeURIComponent(url), 'product URL', 3, url)
    || extractDimensionsFromText(extractTitle(html), 'page title', 2, url)
    || extractDimensionsFromText(html, 'page text', 1, url)
}

function findSlashDepthCm(html) {
  const text = cleanText(html)
  const patterns = [
    /(?:dybde|depth|d)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|m|in|inch|inches)?/i,
    /(?:chaise(?:long)?\s+dybde|chaiselong\s+dybde)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|m|in|inch|inches)?/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)

    if (!match) {
      continue
    }

    if (match[2] && /^\d/.test(match[2])) {
      return Math.max(
        toCentimeters(parseNumber(match[1]), match[3] || 'cm'),
        toCentimeters(parseNumber(match[2]), match[3] || 'cm'),
      )
    }

    return toCentimeters(parseNumber(match[1]), match[2] || 'cm')
  }

  return null
}

function adjustDimensionsForShape(dimensions, html, shape) {
  if (shape !== 'chaise-sofa') {
    return dimensions
  }

  const slashDepthCm = findSlashDepthCm(html)

  if (!slashDepthCm || slashDepthCm <= dimensions.depthCm) {
    return dimensions
  }

  return {
    ...dimensions,
    depthCm: Math.round(slashDepthCm),
    source: `${dimensions.source} + chaise depth`,
  }
}

function classifyFurnitureText(text) {
  const normalized = text.toLowerCase()

  if (/(chaiselong|chaise|hjørnesofa|hjoernesofa|corner sofa|l-shape|l shape|sectional)/i.test(normalized)) {
    return 'chaise-sofa'
  }

  if (/(sofa|couch|sovesofa)/i.test(normalized)) {
    return 'sofa'
  }

  if (/(kontinental|boxmadras|madras|mattress|bed|seng|sengeramme)/i.test(normalized)) {
    return 'bed'
  }

  if (/(oval|ellipse|elliptisk).*?(bord|table)|(?:bord|table).*?(oval|ellipse|elliptisk)/i.test(normalized)) {
    return 'oval-table'
  }

  if (/(round|rund|circle|circular|rundt).*?(bord|table)|(?:bord|table).*?(round|rund|circle|circular|rundt)/i.test(normalized)) {
    return 'round-table'
  }

  if (/(spisebord|sofabord|coffee table|dining table|skrivebord|desk|bord|table)/i.test(normalized)) {
    return 'rect-table'
  }

  if (/(stol|chair|lænestol|laenestol|armchair|barstol)/i.test(normalized)) {
    return 'chair'
  }

  if (/(skab|cabinet|kommode|dresser|reol|shelf|bookcase|vitrine|tv bord|tv-bord)/i.test(normalized)) {
    return 'cabinet'
  }

  if (/(puf|pouffe|ottoman|bench|bænk|baenk)/i.test(normalized)) {
    return 'bench'
  }

  return null
}

function classifyFurnitureType(html, url = '') {
  const title = extractTitle(html)
  const productText = `${title} ${decodeURIComponent(url)}`
  const pageText = cleanText(html).slice(0, 12000)

  return classifyFurnitureText(productText) || classifyFurnitureText(pageText) || 'box'
}

function sendJson(response, statusCode, data) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(data))
}

function sendBinary(response, statusCode, buffer, contentType) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', contentType || 'application/octet-stream')
  response.setHeader('Cache-Control', 'public, max-age=86400')
  response.end(buffer)
}

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5175,
  },
  plugins: [
    {
      name: 'product-parser-api',
      configureServer(server) {
        server.middlewares.use('/api/image', async (request, response) => {
          try {
            const requestUrl = new URL(request.url, 'http://localhost')
            const url = requestUrl.searchParams.get('url')

            if (!url || !/^https?:\/\//i.test(url)) {
              sendJson(response, 400, { error: 'Enter a valid image URL.' })
              return
            }

            const fetchResponse = await fetch(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 ApartmentVisualizer/1.0',
                Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
              },
            })

            if (!fetchResponse.ok) {
              sendJson(response, 502, { error: `Image returned ${fetchResponse.status}.` })
              return
            }

            const contentType = fetchResponse.headers.get('content-type') || ''

            if (!contentType.startsWith('image/')) {
              sendJson(response, 415, { error: 'URL did not return an image.' })
              return
            }

            sendBinary(response, 200, Buffer.from(await fetchResponse.arrayBuffer()), contentType)
          } catch (error) {
            sendJson(response, 500, { error: error instanceof Error ? error.message : 'Could not fetch image.' })
          }
        })

        server.middlewares.use('/api/product', async (request, response) => {
          try {
            const requestUrl = new URL(request.url, 'http://localhost')
            const url = requestUrl.searchParams.get('url')

            if (!url || !/^https?:\/\//i.test(url)) {
              sendJson(response, 400, { error: 'Enter a valid http or https product URL.' })
              return
            }

            const fetchResponse = await fetch(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 ApartmentVisualizer/1.0',
                Accept: 'text/html,application/xhtml+xml',
              },
            })

            if (!fetchResponse.ok) {
              sendJson(response, 502, { error: `Product page returned ${fetchResponse.status}.` })
              return
            }

            const html = await fetchResponse.text()
            const shape = classifyFurnitureType(html, url)
            const parsedDimensions = extractDimensions(html, url)

            if (!parsedDimensions) {
              sendJson(response, 422, { error: 'Could not find product dimensions on that page.' })
              return
            }

            const dimensions = adjustDimensionsForShape(parsedDimensions, html, shape)

            sendJson(response, 200, { name: extractTitle(html), url, imageUrl: extractImageUrl(html, url), shape, ...dimensions })
          } catch (error) {
            sendJson(response, 500, { error: error instanceof Error ? error.message : 'Could not parse product page.' })
          }
        })
      },
    },
  ],
})
