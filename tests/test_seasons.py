import pytest

from halidayshow import seasons


def test_halloween_and_christmas_are_there_until_changed_and_both_out():
    assert seasons.load({}) == [{"id": "halloween", "name": "Halloween", "out": True},
                                {"id": "christmas", "name": "Christmas", "out": True}]
    assert seasons.load({"seasons": []}) == []


def test_a_prop_is_packed_away_only_when_every_season_it_is_in_is_packed_away():
    s = [{"id": "halloween", "name": "Halloween", "out": False}, {"id": "bonfire", "name": "Bonfire Night", "out": True},
         {"id": "christmas", "name": "Christmas", "out": False}]
    devices = [{"id": "tree"}, {"id": "ghost", "seasons": ["halloween"]}, {"id": "orange", "seasons": ["halloween", "bonfire"]},
               {"id": "old", "seasons": ["gone"]}, {"id": "santa", "seasons": ["christmas", "gone"]}]
    # A season that's been deleted doesn't count: "old" is all year now.
    assert seasons.away(devices, s) == {"ghost", "santa"}


def test_seasons_are_checked():
    ok = [{"id": "halloween", "name": " Halloween ", "out": False}, {"name": "Bonfire Night"}]
    assert seasons.clean(ok) == [{"id": "halloween", "name": "Halloween", "out": False},
                                 {"id": "bonfire-night", "name": "Bonfire Night", "out": True}]
    for bad in ("x", [{"name": ""}], [{"name": "A"}, {"name": "a"}], [{"id": "Bad id!", "name": "A"}],
                [{"name": f"S{i}"} for i in range(21)]):
        with pytest.raises(ValueError):
            seasons.clean(bad)
