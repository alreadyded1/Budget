"""Sort-order arithmetic for keyboard reordering. Pure functions over plain ids."""


def normalized(ids: list[int]) -> dict[int, int]:
    """Map each id to a gap-free sort order starting at 0."""
    return {item_id: index for index, item_id in enumerate(ids)}


def moved(ids: list[int], item_id: int, offset: int) -> list[int]:
    """Move one id by `offset` places, clamped to the ends of the list.

    Moving the first item up or the last item down is a no-op rather than an error, so
    holding Alt+Up at the top of a list does nothing surprising.
    """
    if item_id not in ids:
        raise ValueError(f"{item_id} is not in this list")

    current = ids.index(item_id)
    target = max(0, min(len(ids) - 1, current + offset))
    if target == current:
        return list(ids)

    reordered = [other for other in ids if other != item_id]
    reordered.insert(target, item_id)
    return reordered


def moved_to(ids: list[int], item_id: int, position: int) -> list[int]:
    """Move one id to an absolute position, clamped to the list."""
    if item_id not in ids:
        raise ValueError(f"{item_id} is not in this list")
    return moved(ids, item_id, position - ids.index(item_id))
