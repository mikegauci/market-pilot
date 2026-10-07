export const PREDICTION_FEED_PAGE_SIZE = 50;

export type PredictionFeedFilters = {
  limit?: number;
  offset?: number;
  symbol?: string;
  sinceIso?: string;
};

export function predictionFeedPageCount(totalCount: number, pageSize: number): number {
  if (totalCount <= 0) return 1;
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

export function predictionFeedPageForIndex(index: number, pageSize: number): number {
  return Math.floor(index / pageSize) + 1;
}
