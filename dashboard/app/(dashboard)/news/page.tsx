import { NewsFeed } from "@/components/news-feed";
import { getMarketNews } from "@/lib/queries";

export default async function NewsPage() {
  const articles = await getMarketNews(100);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold sm:text-2xl">News</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Latest market headlines from Finnhub
        </p>
      </header>
      <NewsFeed articles={articles} />
    </div>
  );
}
