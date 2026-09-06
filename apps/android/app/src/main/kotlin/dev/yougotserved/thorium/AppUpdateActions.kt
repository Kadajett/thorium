package dev.yougotserved.thorium

internal data class AppUpdateActions(val confirm: () -> Unit, val dismiss: () -> Unit)
