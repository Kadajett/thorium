package dev.yougotserved.thorium

data class CatalogLibraryActions(
    val search: (String) -> Unit,
    val open: (CatalogItem) -> Unit,
    val back: () -> Unit,
)

fun executeCatalogEffect(
    effect: CatalogLibraryEffect,
    items: List<CatalogItem>,
    actions: CatalogLibraryActions,
) {
    when (effect) {
        CatalogLibraryEffect.None -> Unit
        CatalogLibraryEffect.NavigateBack -> actions.back()
        is CatalogLibraryEffect.OpenCard -> items.getOrNull(effect.index)?.let(actions.open)
        is CatalogLibraryEffect.Search -> actions.search(effect.query)
    }
}
