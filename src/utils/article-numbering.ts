import type { CollectionEntry } from 'astro:content';

export type Article = CollectionEntry<'articles'>;

/** Keep article order deterministic when two articles share a publication date. */
export function sortArticles(a: Article, b: Article) {
  const dateDiff = a.data.pubDate.getTime() - b.data.pubDate.getTime();
  return dateDiff || a.slug.localeCompare(b.slug, 'en', { numeric: true });
}

export function getPartNumber(series?: string) {
  const match = series?.match(/^Phần (\d+):/);
  return match ? Number(match[1]) : null;
}

/** Groups articles and sorts numbered learning-note parts numerically. */
export function groupArticlesBySeries(articles: Article[]) {
  const seriesMap = new Map<string, Article[]>();

  for (const article of articles) {
    const series = article.data.series ?? 'Khác';
    if (!seriesMap.has(series)) seriesMap.set(series, []);
    seriesMap.get(series)!.push(article);
  }

  return Array.from(seriesMap.entries())
    .map(([series, items]) => [series, items.sort(sortArticles)] as const)
    .sort(([a], [b]) => {
      const aPart = getPartNumber(a);
      const bPart = getPartNumber(b);
      if (aPart !== null && bPart !== null) return aPart - bPart;
      if (aPart !== null) return -1;
      if (bPart !== null) return 1;
      return a.localeCompare(b);
    });
}

/** Returns the one-based article number within its series. */
export function buildLocalArticleNumbers(articles: Article[]) {
  const numbers = new Map<string, number>();
  for (const [, items] of groupArticlesBySeries(articles)) {
    items.forEach((article, index) => numbers.set(article.slug, index + 1));
  }
  return numbers;
}

export function formatArticleNumber(number?: number) {
  return number === undefined ? '??' : String(number).padStart(2, '0');
}
