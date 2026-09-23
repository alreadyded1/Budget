"""Sort-order arithmetic behind Alt+Up / Alt+Down."""

import pytest

from app.domain.ordering import moved, moved_to, normalized


def test_normalized_is_gap_free():
    assert normalized([7, 3, 9]) == {7: 0, 3: 1, 9: 2}


def test_moving_up_swaps_with_the_one_above():
    assert moved([1, 2, 3, 4], 3, -1) == [1, 3, 2, 4]


def test_moving_down_swaps_with_the_one_below():
    assert moved([1, 2, 3, 4], 2, 1) == [1, 3, 2, 4]


def test_moving_the_first_item_up_does_nothing():
    assert moved([1, 2, 3], 1, -1) == [1, 2, 3]


def test_moving_the_last_item_down_does_nothing():
    assert moved([1, 2, 3], 3, 1) == [1, 2, 3]


def test_a_large_offset_clamps_to_the_ends():
    assert moved([1, 2, 3, 4], 4, -99) == [4, 1, 2, 3]
    assert moved([1, 2, 3, 4], 1, 99) == [2, 3, 4, 1]


def test_moving_an_unknown_id_is_an_error():
    with pytest.raises(ValueError, match="not in this list"):
        moved([1, 2], 5, 1)


def test_moved_to_an_absolute_position():
    assert moved_to([1, 2, 3, 4], 4, 0) == [4, 1, 2, 3]
    assert moved_to([1, 2, 3, 4], 1, 2) == [2, 3, 1, 4]


def test_a_single_item_list_never_changes():
    assert moved([9], 9, -1) == [9]
    assert moved([9], 9, 1) == [9]


def test_the_list_keeps_every_id():
    original = [5, 6, 7, 8]
    for offset in (-2, -1, 1, 2):
        assert sorted(moved(original, 7, offset)) == sorted(original)
