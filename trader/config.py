from __future__ import annotations

import sys
from typing import List

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from models.types import DataSource, ExecutionMode, TradingMode

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
    ibkr_market_data_type: int = 3

    watchlist: str = "SPY,QQQ,NVDA,AAPL,MSFT,AMD,META,TSLA,GOOGL,AMZN"

    supabase_url: str = ""
    supabase_service_role_key: str = ""

    data_source: DataSource = DataSource.MOCK
    execution_mode: ExecutionMode = ExecutionMode.SIMULATED
    eval_interval_sec: float = 1.0
    closed_market_eval_interval_sec: float = 300.0
    jev_enabled: bool = True
    typesafe_ai_api_key: str = ""
    jev_model: str = "jev-latest"
    jev_timeout_sec: float = 10.0
    ibkr_fill_timeout_sec: float = 60.0
    ibkr_entry_cooldown_sec: float = 120.0

    heartbeat_interval_sec: int = 10
    risk_sync_threshold_pct: float = 0.05
    log_level: str = "INFO"

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
