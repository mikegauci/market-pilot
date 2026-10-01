from __future__ import annotations

import sys
from pathlib import Path
from typing import List

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from models.types import DataSource, ExecutionMode, TradingMode
from strategy.config import StrategyConfig

LIVE_CONFIRMATION_PHRASE = "I_UNDERSTAND_LIVE_TRADING"
LIVE_PORTS = {4001, 7496}
PAPER_PORTS = {4002, 7497}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    trading_mode: TradingMode = TradingMode.PAPER
    live_trading_confirmation: str = ""

    ibkr_host: str = "127.0.0.1"
    ibkr_port: int = 4002
    ibkr_client_id: int = 1
    ibkr_account: str = ""
    ibkr_market_data_type: int = 1

    watchlist: str = "NVDA,AAPL,MSFT,META,GOOGL"

    supabase_url: str = ""
    supabase_service_role_key: str = ""

    data_source: DataSource = DataSource.IBKR
    execution_mode: ExecutionMode = ExecutionMode.IBKR
    eval_interval_sec: float = 1.0
    closed_market_eval_interval_sec: float = 300.0
    jev_enabled: bool = True
    typesafe_ai_api_key: str = ""
    jev_model: str = "jev-latest"
    jev_timeout_sec: float = 20.0
    jev_max_workers: int = 5
    ibkr_fill_timeout_sec: float = 60.0
    ibkr_entry_cooldown_sec: float = 120.0

    heartbeat_interval_sec: int = 5
    bot_control_refresh_interval_sec: float = 5.0
    settings_refresh_interval_sec: float = 15.0
    portfolio_history_interval_sec: float = 30.0
    market_snapshots_enabled: bool = False
    risk_sync_threshold_pct: float = 0.05
    log_level: str = "INFO"

    strategy_max_spread_pct: float = 0.0015
    strategy_max_rsi: float = 70.0
    strategy_require_price_above_ema20: bool = True
    strategy_max_spy_drop_5m_pct: float = -0.3
    strategy_min_buy_hold_margin: float = 0.15
    strategy_confirmation_cycles: int = 2
    strategy_max_hold_minutes: float = 0.0
    strategy_jev_sell_exit_threshold: float = 0.95
    strategy_max_correlated_positions: int = 2
    strategy_warmup_min_1m_bars: int = 15
    strategy_min_live_1m_bars_open: int = 3
    strategy_min_news_sentiment: float = -0.3
    strategy_min_volume_ratio: float = 0.0
    strategy_min_dollar_volume: float = 0.0
    strategy_min_buy_sell_margin: float = 0.10
    strategy_confirmation_seconds: float = 30.0
    strategy_max_benchmark_drop_5m_pct: float = -0.12
    strategy_entry_cutoff_minutes_before_close: float = 15.0
    strategy_eod_flatten_minutes_before_close: float = 10.0
    strategy_max_china_factor_positions: int = 3
    strategy_news_block_tags: str = "downgrade,lawsuit,sec_investigation,guidance_cut,layoffs"
    strategy_block_on_earnings: bool = False

    news_enabled: bool = False
    finnhub_api_key: str = ""
    news_cache_ttl_sec: float = 600.0
    news_general_refresh_sec: float = 600.0
    news_lookback_hours: int = 24
    news_max_headlines: int = 5
    news_skip_symbols: str = "SPY,QQQ,IWM,DIA"
    news_empty_cooldown_sec: float = 300.0
    news_failure_cooldown_sec: float = 60.0
    news_fetch_workers: int = 3
    news_max_retries: int = 3
    news_general_keep: int = 100

    em_universe_path: str = ""
    bar_backfill_pacing_sec: float = 12.0
    live_bar_flush_interval_sec: float = 60.0
    bar_daily_duration: str = "1 W"
    bar_intraday_duration: str = "3 D"
    em_backfill_on_startup: bool = True
    forward_return_backfill_enabled: bool = True

    @field_validator("trading_mode", mode="before")
    @classmethod
    def parse_trading_mode(cls, value: object) -> TradingMode:
        if isinstance(value, TradingMode):
            return value
        normalized = str(value).strip().lower()
        try:
            return TradingMode(normalized)
        except ValueError as exc:
            raise ValueError(
                f"TRADING_MODE must be 'paper' or 'live', got: {value!r}"
            ) from exc

    @field_validator("execution_mode", mode="before")
    @classmethod
    def parse_execution_mode(cls, value: object) -> ExecutionMode:
        if isinstance(value, ExecutionMode):
            return value
        normalized = str(value).strip().lower()
        try:
            return ExecutionMode(normalized)
        except ValueError as exc:
            raise ValueError(
                f"EXECUTION_MODE must be 'simulated' or 'ibkr', got: {value!r}"
            ) from exc

    @field_validator("data_source", mode="before")
    @classmethod
    def parse_data_source(cls, value: object) -> DataSource:
        if isinstance(value, DataSource):
            return value
        normalized = str(value).strip().lower()
        try:
            return DataSource(normalized)
        except ValueError as exc:
            raise ValueError(
                f"DATA_SOURCE must be 'mock' or 'ibkr', got: {value!r}"
            ) from exc

    @field_validator("jev_enabled", mode="before")
    @classmethod
    def parse_jev_enabled(cls, value: object) -> bool:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    @field_validator("news_enabled", mode="before")
    @classmethod
    def parse_news_enabled(cls, value: object) -> bool:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    @field_validator("market_snapshots_enabled", mode="before")
    @classmethod
    def parse_market_snapshots_enabled(cls, value: object) -> bool:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    @field_validator("em_backfill_on_startup", mode="before")
    @classmethod
    def parse_em_backfill_on_startup(cls, value: object) -> bool:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    @field_validator("forward_return_backfill_enabled", mode="before")
    @classmethod
    def parse_forward_return_backfill_enabled(cls, value: object) -> bool:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    @field_validator("strategy_block_on_earnings", mode="before")
    @classmethod
    def parse_news_bool(cls, value: object) -> bool:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    @field_validator("strategy_require_price_above_ema20", mode="before")
    @classmethod
    def parse_strategy_bool(cls, value: object) -> bool:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    @model_validator(mode="after")
    def validate_execution_mode(self) -> Settings:
        if self.execution_mode == ExecutionMode.IBKR and self.data_source != DataSource.IBKR:
            print(
                "WARNING: EXECUTION_MODE=ibkr requires DATA_SOURCE=ibkr. "
                "IBKR orders will be skipped until DATA_SOURCE=ibkr.",
                file=sys.stderr,
            )
        return self

    @model_validator(mode="after")
    def disable_news_without_api_key(self) -> Settings:
        if self.news_enabled and not self.finnhub_api_key.strip():
            self.news_enabled = False
        return self

    @property
    def news_skip_symbol_set(self) -> frozenset[str]:
        return frozenset(
            symbol.strip().upper()
            for symbol in self.news_skip_symbols.split(",")
            if symbol.strip()
        )

    @model_validator(mode="after")
    def validate_live_trading_safety(self) -> Settings:
        if self.trading_mode == TradingMode.LIVE:
            if self.live_trading_confirmation != LIVE_CONFIRMATION_PHRASE:
                print(
                    "\n*** LIVE TRADING BLOCKED ***\n"
                    "TRADING_MODE=live requires:\n"
                    f"  LIVE_TRADING_CONFIRMATION={LIVE_CONFIRMATION_PHRASE}\n",
                    file=sys.stderr,
                )
                sys.exit(1)
        return self

    @property
    def watchlist_symbols(self) -> List[str]:
        return [s.strip().upper() for s in self.watchlist.split(",") if s.strip()]

    @property
    def resolved_em_universe_path(self) -> Path:
        if self.em_universe_path.strip():
            return Path(self.em_universe_path.strip())
        trader_root = Path(__file__).resolve().parent
        return trader_root.parent / "dashboard" / "data" / "em-us-listed.json"

    @property
    def strategy_config(self) -> StrategyConfig:
        return StrategyConfig(
            max_spread_pct=self.strategy_max_spread_pct,
            max_rsi=self.strategy_max_rsi,
            require_price_above_ema20=self.strategy_require_price_above_ema20,
            max_spy_drop_5m_pct=self.strategy_max_spy_drop_5m_pct,
            min_buy_hold_margin=self.strategy_min_buy_hold_margin,
            confirmation_cycles=self.strategy_confirmation_cycles,
            max_hold_minutes=self.strategy_max_hold_minutes,
            jev_sell_exit_threshold=self.strategy_jev_sell_exit_threshold,
            max_correlated_positions=self.strategy_max_correlated_positions,
            warmup_min_1m_bars=self.strategy_warmup_min_1m_bars,
            min_live_1m_bars_open=self.strategy_min_live_1m_bars_open,
            min_news_sentiment=self.strategy_min_news_sentiment,
            min_volume_ratio=self.strategy_min_volume_ratio,
            min_dollar_volume=self.strategy_min_dollar_volume,
            min_buy_sell_margin=self.strategy_min_buy_sell_margin,
            confirmation_seconds=self.strategy_confirmation_seconds,
            max_benchmark_drop_5m_pct=self.strategy_max_benchmark_drop_5m_pct,
            entry_cutoff_minutes_before_close=self.strategy_entry_cutoff_minutes_before_close,
            eod_flatten_minutes_before_close=self.strategy_eod_flatten_minutes_before_close,
            max_china_factor_positions=self.strategy_max_china_factor_positions,
            news_block_tags=tuple(
                tag.strip()
                for tag in self.strategy_news_block_tags.split(",")
                if tag.strip()
            ),
            block_on_earnings=self.strategy_block_on_earnings,
        )

    @property
    def mode_banner(self) -> str:
        if self.trading_mode == TradingMode.LIVE:
            return "LIVE TRADING - REAL MONEY"
        return "PAPER TRADING"

    def warn_port_mismatch(self) -> None:
        if self.trading_mode == TradingMode.PAPER and self.ibkr_port in LIVE_PORTS:
            print(
                f"WARNING: TRADING_MODE=paper but IBKR_PORT={self.ibkr_port} "
                f"looks like a live port. Paper ports: {sorted(PAPER_PORTS)}",
                file=sys.stderr,
            )
        if self.trading_mode == TradingMode.LIVE and self.ibkr_port in PAPER_PORTS:
            print(
                f"WARNING: TRADING_MODE=live but IBKR_PORT={self.ibkr_port} "
                f"looks like a paper port. Live ports: {sorted(LIVE_PORTS)}",
                file=sys.stderr,
            )


def load_settings() -> Settings:
    settings = Settings()
    settings.warn_port_mismatch()
    return settings
