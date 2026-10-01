from unittest.mock import MagicMock

from broker.ibkr import IBKRClient


def _client(*, preferred: str = "") -> IBKRClient:
    client = IBKRClient("127.0.0.1", 4002, 1, account=preferred)
    client.ib = MagicMock()
    client.ib.isConnected.return_value = True
    return client


def test_pinned_account_overrides_session_list() -> None:
    client = _client(preferred="DUR217910")
    client.ib.managedAccounts.return_value = ["DUR226344"]

    assert client._sync_session_account() == "DUR217910"


def test_session_account_follows_single_managed_account() -> None:
    client = _client(preferred="")
    client.ib.managedAccounts.return_value = ["DUR226344"]

    assert client._sync_session_account() == "DUR226344"

    client.ib.managedAccounts.return_value = ["DUR217910"]
    assert client._sync_session_account() == "DUR217910"


def test_session_keeps_current_account_when_still_managed() -> None:
    client = _client(preferred="")
    client.account = "DUR217910"
    client.ib.managedAccounts.return_value = ["DUR226344", "DUR217910"]

    assert client._sync_session_account() == "DUR217910"
