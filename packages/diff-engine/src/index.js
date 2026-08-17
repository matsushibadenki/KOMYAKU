export function segmentGraphemes(text, locale = "und") {
  return Array.from(new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text), ({ segment }) => segment);
}

