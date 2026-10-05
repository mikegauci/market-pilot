from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import httpx

from database.supabase import SupabaseRepository
from models.types import TradeRecord, TradingMode
from notify import telegram as telegram_module
from notify.telegram import (
    configure_telegram,
    exit_reason_label,
    format_close_message,
    format_open_message,
    notify_trade_closed,
    notify_trade_opened,
)


class _InlineThread:
    def __init__(self, *, target, args, daemon, name) -> None:
        self._target = target
        self._args = args

    def start(self) -> None:
        self._target(*self._args)


def _trade() -> TradeRecord:
    return TradeRecord(
        id=str(uuid.uuid4()),
        symbol="AAPL",
        side="buy",
        entry_time=datetime.now(timezone.utc),
        entry_price=182.40,
        quantity=12,
        position_value=2188.80,
        stop_loss=180.10,
        take_profit=186.20,
        status="open",
        paper_or_live=TradingMode.PAPER.value,
        jev_buy_probability=0.87,
        execution_mode="simulated",
    )


class MessageFormatTests(unittest.TestCase):
    def test_open_includes_jev_stop_and_target(self) -> None:
        text = format_open_message("AAPL", 0.87, 180.10, 186.20)
        self.assertEqual(
            text,
            "OPENED AAPL\nJEV buy 87%\nStop $180.10 · target $186.20",
        )

    def test_open_omits_jev_when_missing(self) -> None:
        text = format_open_message("AAPL", None, 180.10, 186.20)
        self.assertEqual(text, "OPENED AAPL\nStop $180.10 · target $186.20")

    def test_close_labels_and_pnl(self) -> None:
        self.assertEqual(
            format_close_message("AAPL", "stop_loss", -28.2),
            "CLOSED AAPL — Stop loss\nNet PnL -$28.20",
        )
        self.assertEqual(
            format_close_message("AAPL", "profit_take", 12.5),
            "CLOSED AAPL — Soft Sell\nNet PnL +$12.50",
        )
        self.assertEqual(
            format_close_message("AAPL", "jev_sell", 0),
            "CLOSED AAPL — JEV hard sell\nNet PnL $0.00",
        )

    def test_exit_reason_labels_match_dashboard(self) -> None:
        expected = {
            "stop_loss": "Stop loss",
            "take_profit": "Top profit take",
            "profit_take": "Soft Sell",
            "time_exit": "Max hold",
            "jev_sell": "JEV hard sell",
            "demotion_exit": "Demotion exit",
            "eod_flatten": "EOD flatten (incl. losers)",
            "manual": "Manual close",
            "unknown": "Unknown",
        }
        for code, label in expected.items():
            self.assertEqual(exit_reason_label(code), label)
        self.assertEqual(exit_reason_label(None), "Unknown")
        self.assertEqual(exit_reason_label("ibkr_stop"), "Broker bracket")
        self.assertEqual(exit_reason_label("custom_reason"), "custom reason")


class SendTests(unittest.TestCase):
    def setUp(self) -> None:
        self._saved_configured = telegram_module._credentials_configured
        self._saved_token = telegram_module._configured_token
        self._saved_chat_id = telegram_module._configured_chat_id
        configure_telegram("", "")

    def tearDown(self) -> None:
        telegram_module._credentials_configured = self._saved_configured
        telegram_module._configured_token = self._saved_token
        telegram_module._configured_chat_id = self._saved_chat_id

    def test_blank_credentials_skip_http(self) -> None:
        configure_telegram("", "")
        with patch("notify.telegram.httpx.Client") as client_cls:
            notify_trade_closed("AAPL", -1.0, "stop_loss")
        client_cls.assert_not_called()

    def test_configure_uses_startup_settings_not_partial_environ(self) -> None:
        configure_telegram("tok-from-settings", "123-from-settings")
        with patch("notify.telegram.threading.Thread", _InlineThread):
            with patch("notify.telegram.httpx.Client") as client_cls:
                notify_trade_closed("AAPL", -1.0, "stop_loss")
        client_cls.return_value.__enter__.return_value.post.assert_called_once()
        body = client_cls.return_value.__enter__.return_value.post.call_args.kwargs["json"]
        self.assertEqual(body["chat_id"], "123-from-settings")

    def test_http_failure_is_logged_and_does_not_raise(self) -> None:
        configure_telegram("tok", "123")
        with patch("notify.telegram.threading.Thread", _InlineThread):
            with patch("notify.telegram.httpx.Client") as client_cls:
                client_cls.return_value.__enter__.return_value.post.side_effect = (
                    httpx.ConnectError("down")
                )
                with self.assertLogs("notify.telegram", level="WARNING") as logs:
                    notify_trade_opened(_trade())
        self.assertTrue(any("Telegram trade alert failed" in line for line in logs.output))
        self.assertFalse(any("tok" in line for line in logs.output))


class RepositoryHookTests(unittest.TestCase):
    def _repo(self, create_client: MagicMock) -> tuple[SupabaseRepository, MagicMock]:
        client = MagicMock()
        table = MagicMock()
        client.table.return_value = table
        select_chain = MagicMock()
        table.select.return_value = select_chain
        select_chain.eq.return_value = select_chain
        select_chain.limit.return_value = select_chain
        create_client.return_value = client
        repo = SupabaseRepository("https://example.supabase.co", "service-role-key")
        return repo, table

    @patch("database.supabase.create_client")
    @patch("database.supabase.notify_trade_opened")
    def test_insert_notifies_once(
        self, notify: MagicMock, create_client: MagicMock
    ) -> None:
        repo, table = self._repo(create_client)
        table.select.return_value.eq.return_value.limit.return_value.execute.return_value = (
            MagicMock(data=[])
        )
        trade = _trade()
        repo.insert_trade(trade)
        notify.assert_called_once_with(trade)

    @patch("database.supabase.create_client")
    @patch("database.supabase.notify_trade_opened")
    def test_idempotent_insert_does_not_notify(
        self, notify: MagicMock, create_client: MagicMock
    ) -> None:
        repo, table = self._repo(create_client)
        trade = _trade()
        table.select.return_value.eq.return_value.limit.return_value.execute.return_value = (
            MagicMock(data=[{"id": trade.id}])
        )
        repo.insert_trade(trade)
        notify.assert_not_called()
        table.insert.assert_not_called()

    def _close_update_chain(self, table: MagicMock) -> MagicMock:
        update_chain = MagicMock()
        table.update.return_value = update_chain
        update_chain.eq.return_value = update_chain
        update_chain.select.return_value = update_chain
        return update_chain

    @patch("database.supabase.create_client")
    @patch("database.supabase.notify_trade_closed")
    def test_close_notifies_only_when_still_open(
        self, notify: MagicMock, create_client: MagicMock
    ) -> None:
        repo, table = self._repo(create_client)
        update_chain = self._close_update_chain(table)
        update_chain.execute.return_value = MagicMock(data=[{"symbol": "AAPL"}])
        now = datetime.now(timezone.utc)
        repo.close_trade("trade-1", 180.05, now, -28.2, -28.2, exit_reason="stop_loss")
        notify.assert_called_once_with("AAPL", -28.2, "stop_loss")
        update_chain.eq.assert_any_call("status", "open")

        notify.reset_mock()
        update_chain.execute.return_value = MagicMock(data=[])
        repo.close_trade("trade-1", 180.05, now, -28.2, -28.2, exit_reason="stop_loss")
        notify.assert_not_called()


if __name__ == "__main__":
    unittest.main()
