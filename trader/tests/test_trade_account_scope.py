from database.trade_account_scope import apply_trade_account_filter


class _Query:
    def __init__(self) -> None:
        self.filters: list[str] = []

    def or_(self, expr: str) -> "_Query":
        self.filters.append(f"or:{expr}")
        return self

    def eq(self, column: str, value: str) -> "_Query":
        self.filters.append(f"eq:{column}={value}")
        return self


def test_apply_trade_account_filter_legacy_or() -> None:
    query = _Query()
    result = apply_trade_account_filter(
        query,
        "DUR217910",
        include_legacy=True,
    )
    assert "or:ibkr_account_id.eq.DUR217910,ibkr_account_id.is.null" in result.filters


def test_apply_trade_account_filter_strict_eq() -> None:
    query = _Query()
    result = apply_trade_account_filter(
        query,
        "DUR217910",
        include_legacy=False,
    )
    assert result.filters == ["eq:ibkr_account_id=DUR217910"]
