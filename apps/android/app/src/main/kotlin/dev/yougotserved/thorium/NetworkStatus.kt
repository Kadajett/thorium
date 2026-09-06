package dev.yougotserved.thorium

enum class NetworkStatus(val label: String) {
    CHECKING("Checking network…"),
    ONLINE("Online"),
    LIMITED("No internet access"),
    OFFLINE("Offline"),
}

internal fun networkStatus(hasInternet: Boolean, validated: Boolean): NetworkStatus =
    if (hasInternet && validated) NetworkStatus.ONLINE else NetworkStatus.LIMITED

internal fun catalogNetworkLabel(game: CatalogGame): String = when {
    game.multiplayerRequiresOnline -> "Online required"
    game.multiplayerOnline -> "Offline + online"
    else -> "Offline play"
}
