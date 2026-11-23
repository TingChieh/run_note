"""Fixtures shared by several integration modules; pytest finds them here, so tests never import
fixtures (an imported fixture would need lint suppressions in every test that uses it)."""

from tests.integration.test_showcase import site

__all__ = ["site"]
