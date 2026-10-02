/** PostgREST `or` filter: entries since ET day start, plus any still-open positions. */
export function tradingDayTradesOrFilter(dayStartIso: string): string {
  return `entry_time.gte.${dayStartIso},status.eq.open`;
}
