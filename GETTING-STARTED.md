# Get Market Pilot running

Market Pilot watches a watchlist and can place **paper** trades through Interactive Brokers. It does not use your real money. This is not financial advice.

Plan on 30 to 45 minutes the first time. After that, each trading day is: open IB Gateway, log in, double-click Start.

## What you need

- A Mac or a Windows PC
- These free accounts:
  - [Supabase](https://supabase.com/dashboard) for the database
  - [Vercel](https://vercel.com/signup) for the website (the free Hobby plan is enough)
  - [Interactive Brokers paper trading](https://www.interactivebrokers.com/en/trading/paper-trading.php)
  - [TypeSafe AI](https://typesafe.ai) for predictions (a free key)
- Optional: [Finnhub](https://finnhub.io/register) for headlines, an OpenAI key for the written session brief, and a Telegram bot for alerts

## 1. Create a Supabase project

1. Sign up and create a new project. Pick a database password and save it.
2. Wait until the project finishes starting.
3. Open **Project Settings**, then **API**. You will need the project URL, the publishable (or anon) key, and the **service_role** key.
4. Click **Connect** at the top of the project. Under **Session pooler**, copy the connection string (port **5432**). Do not use the Direct connection, because most home internet cannot reach it, and do not use the Transaction pooler on port 6543.
5. Open **Authentication**, then **Providers**, then **Email**, and turn off public sign-ups if that switch is there. Setup will also remind you to add your website address later.

## 2. Install IB Gateway

1. Download [IB Gateway](https://www.interactivebrokers.com/en/trading/ibgateway-stable.php) and install it.
2. Log in with your **paper** username and password.
3. Open **Configure**, then **Settings**, then **API**, then **Settings**.
4. Turn on **ActiveX and Socket Clients**.
5. Set the socket port to **4002**.
6. Add trusted IP **127.0.0.1**.
7. Uncheck **Read-Only API**.

Leave IB Gateway open and logged in while the trader runs.

## 3. Run Setup

1. Unzip the Market Pilot download into your Documents folder.
2. Mac: right-click **Setup Market Pilot**, then **Open**. The first time, macOS asks you to confirm.
3. Windows: double-click **Setup Market Pilot**. If SmartScreen appears, choose **More info**, then **Run anyway**.
4. Answer the questions. Setup opens the right web page before each key. Optional keys can be skipped with Enter.
5. When it publishes the website, sign in to Vercel in the browser.
6. Finish the Supabase step it prints: set the Site URL and Redirect URL to your new `https://....vercel.app` link.

Your dashboard password is the one you chose during Setup. The secret Supabase key stays on your computer.

## 4. Every trading day

1. Open IB Gateway and log in with the paper account.
2. Double-click **Start Market Pilot**.
3. The window must stay open. Closing it stops trading. The website stays up and shows the bot as offline when Start is not running.
4. Bookmark the dashboard link. On a phone, use the browser's **Add to Home Screen**.

**Stop Market Pilot** stops the trader. **Check My Setup** prints a green and red list. If something breaks, send a screenshot of that window.

## 5. Updates

When a new version exists, Start says so and waits. Double-click **Update Market Pilot** when you are ready. Your keys and settings stay put. If an update fails, the previous copy is in the `backup` folder.

## 6. The dashboard

Sign in with the email and password from Setup.

- **Overview** shows whether the bot is running, your paper balance, and open positions.
- **Settings** is where you change risk and the watchlist. Saving only works for the owner login.
- The bot switch pauses new trades. It does not shut down IB Gateway.

If the market is closed, or the program is still warming up, it is normal for nothing to trade.

## If something goes wrong

| What you see | What to do |
|---|---|
| IB Gateway connection refused | Open IB Gateway, log in, and confirm the API port is 4002. |
| Dashboard says not authorized | Sign in with the owner email from Setup. |
| Login returns to the login page | Add your website link to Supabase under Authentication, then URL Configuration. |
| Dashboard shows the bot offline | Double-click Start and leave that window open. |
| Nothing is trading | The US market may be closed, or a filter in Settings is blocking entries. |
| Mac will not open the file | Right-click it, then Open. |
| Windows says winget was not found | Install App Installer from the Microsoft Store, then run Setup again. |
| You lost the dashboard password | In Supabase, open Authentication, then Users, and reset that user. |

The trader has to run on your computer, because that is where IB Gateway runs. The website can be opened from anywhere.
