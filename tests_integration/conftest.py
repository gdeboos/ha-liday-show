"""Tests for custom_components/haliday_show, run against the real app on a local port.

Run with Home Assistant's test kit installed (see .github/workflows/ci.yml, job "integration"):
    python -m pytest -q tests_integration
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "haliday_show" / "app")]


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations, socket_enabled):
    yield
