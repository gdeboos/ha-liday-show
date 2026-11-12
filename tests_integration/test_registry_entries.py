"""registry_entries works whether going through a registry gives ids (older HA) or entries (2026.11 on)."""
from custom_components.haliday_show.const import registry_entries


class Entry:
    def __init__(self, id):
        self.id = id


def test_ids_are_looked_up():
    found = {"a": Entry("a"), "b": Entry("b")}
    assert [e.id for e in registry_entries(found, found.get)] == ["a", "b"]


def test_entries_pass_through_and_gone_ones_are_skipped():
    items = [Entry("a"), "gone"]
    assert [e.id for e in registry_entries(items, lambda _id: None)] == ["a"]
