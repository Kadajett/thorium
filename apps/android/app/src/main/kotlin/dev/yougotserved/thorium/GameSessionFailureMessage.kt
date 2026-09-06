package dev.yougotserved.thorium

internal fun gameSessionFailureMessage(reason: GameSessionStartFailure): String = when (reason) {
    GameSessionStartFailure.RELEASE_INTEGRITY -> "Game files failed verification. Connect and press Play to repair."
    GameSessionStartFailure.LOCAL_PLAYER_POLICY -> "This game needs more players than this device can provide."
    GameSessionStartFailure.AUTHORITY_REJECTED -> "Online play was rejected. Press Play to check for a game update."
    GameSessionStartFailure.AUTHORITY_RESPONSE_MISMATCH -> "The game server returned a mismatched session. Try again."
    GameSessionStartFailure.ACCOUNT_AUTHORIZATION_UNAVAILABLE -> "Could not sign in this device for online play."
    GameSessionStartFailure.AUTHORITY_UNAVAILABLE -> "This game's online server is temporarily unavailable."
    GameSessionStartFailure.NETWORK_REQUIRED -> "This game requires an internet connection."
}
