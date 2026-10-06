from __future__ import annotations

from database.repository._accounts import SupabaseAccountsMixin
from database.repository._bars import SupabaseBarsMixin
from database.repository._base import SupabaseRepositoryBase
from database.repository._bot import SupabaseBotStatusMixin
from database.repository._bot_control import SupabaseBotControlMixin
from database.repository._commands import SupabaseCommandsMixin
from database.repository._portfolio import SupabasePortfolioMixin
from database.repository._predictions import SupabasePredictionsMixin
from database.repository._settings import SupabaseSettingsMixin
from database.repository._trades import SupabaseTradesMixin


class SupabaseRepository(
    SupabaseRepositoryBase,
    SupabaseBotStatusMixin,
    SupabaseAccountsMixin,
    SupabasePortfolioMixin,
    SupabaseBotControlMixin,
    SupabaseSettingsMixin,
    SupabaseBarsMixin,
    SupabaseTradesMixin,
    SupabasePredictionsMixin,
    SupabaseCommandsMixin,
):
    """Thin Supabase wrapper for trader persistence."""
