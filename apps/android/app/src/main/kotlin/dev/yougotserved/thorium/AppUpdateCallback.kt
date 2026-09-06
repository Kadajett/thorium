package dev.yougotserved.thorium

internal const val APP_UPDATE_RESULT_ACTION = "dev.yougotserved.thorium.APP_UPDATE_RESULT"
internal const val APP_UPDATE_PENDING_KEY = "pending-session"
internal const val APP_UPDATE_OUTCOME_KEY = "outcome"
internal const val APP_UPDATE_NO_SESSION = -1

internal fun appUpdateCallbackMatches(action: String?, expected: Int, actual: Int): Boolean =
    action == APP_UPDATE_RESULT_ACTION && expected >= 0 && actual == expected
