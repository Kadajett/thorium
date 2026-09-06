package dev.yougotserved.thorium

/** Automatic Android focus must not choose a utility while the first game is still loading. */
internal fun catalogUtilityCanFocus(state: CatalogLibraryState, target: CatalogFocusTarget): Boolean =
    !state.searchEditing && state.focus.target == target
