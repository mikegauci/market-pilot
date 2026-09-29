export type TradeModeCopy = {
  sidebarLabel: string;
  statusLine: string;
};

export function getTradeModeCopy(options: {
  ibkrConnected: boolean;
  traderOnline: boolean;
}): TradeModeCopy {
  if (options.ibkrConnected) {
    return {
      sidebarLabel: "Paper broker",
      statusLine: "Orders sent to paper broker",
    };
  }

  if (!options.traderOnline) {
    return {
      sidebarLabel: "Engine stopped",
      statusLine: "Start the trading engine and IB Gateway to place paper orders",
    };
  }

  return {
    sidebarLabel: "Broker offline",
    statusLine: "Connect IB Gateway — new orders pause until the broker is reachable",
  };
}

export type BrokerNoticeCopy = {
  tone: "emerald" | "amber";
  message: string;
};

export function getBrokerNotice(options: {
  ibkrConnected: boolean;
  traderOnline: boolean;
}): BrokerNoticeCopy | null {
  if (options.ibkrConnected) {
    return {
      tone: "emerald",
      message: "Broker connected — orders will go to your paper account.",
    };
  }

  if (!options.traderOnline) {
    return {
      tone: "amber",
      message:
        "Trading engine is not running. Start it on your computer (with IB Gateway open) so the bot can reach your broker.",
    };
  }

  return {
    tone: "amber",
    message:
      "Can't reach your broker. Open IB Gateway, log in, and wait until it shows connected — then restart the trading engine.",
  };
}
