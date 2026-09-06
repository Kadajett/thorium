package dev.yougotserved.thorium

internal fun catalogPlayFixture(packages: CatalogPackagePort): CatalogPlayPorts = CatalogPlayPorts(
    currentRelease = { TestPackages.valid().release },
    packages = packages,
    launch = { game, online -> offlineTestLauncher().start(game, online) },
)

internal fun cachedCatalogPackage(game: CatalogGame): CatalogPackagePort = CatalogPackagePort(
    cached = { game },
    verify = { sameCatalogRelease(it, game) },
    install = { error("A verified cached game must not download") },
)

internal fun offlineTestLauncher(): GameSessionLauncher = GameSessionLauncher(
    authority = GameSessionAuthorityPort { _, _ -> error("Offline play must not request a server session") },
    accountAuthorization = AccountAuthorizationPort { error("Offline play must not request account credentials") },
    releaseIntegrity = GameReleaseIntegrityPort { true },
)
