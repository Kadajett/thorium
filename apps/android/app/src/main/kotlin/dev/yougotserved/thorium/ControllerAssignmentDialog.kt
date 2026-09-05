package dev.yougotserved.thorium

import android.app.Activity
import android.app.Dialog
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Host-owned assignment to admitted slots, never to an account or a guessed device number. */
class ControllerAssignmentDialog(
    activity: Activity,
    private val deviceId: Int,
    private val slots: List<Int>,
    private val assign: (Int) -> Unit,
) : Dialog(activity) {
    private val choices = mutableListOf<Button>()
    private val stick = CatalogStickNavigator()
    private var selected = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setTitle(R.string.controller_assignment_title)
        val content = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            val padding = (24 * resources.displayMetrics.density).toInt()
            setPadding(padding, padding, padding, padding)
        }
        content.addView(TextView(context).apply { setText(R.string.controller_assignment_help) })
        slots.forEachIndexed { index, slot ->
            val button = Button(context).apply {
                text = context.getString(R.string.controller_assignment_player, slot + 1)
                setOnClickListener { choose(index) }
                setOnFocusChangeListener { _, focused -> if (focused) selected = index }
            }
            choices += button
            content.addView(button)
        }
        content.addView(Button(context).apply {
            setText(R.string.controller_assignment_cancel)
            setOnClickListener { dismiss() }
        })
        setContentView(ScrollView(context).apply { addView(content) })
        choices.first().requestFocus()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val mapped = AndroidGameControllerInput.key(event.deviceId, event.keyCode, event.action)
        if (mapped == null) return super.dispatchKeyEvent(event)
        if (event.deviceId != deviceId) return true
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_LEFT -> move(-1)
                KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_RIGHT -> move(1)
                KeyEvent.KEYCODE_BUTTON_A -> if (event.repeatCount == 0) choose(selected)
                KeyEvent.KEYCODE_BUTTON_B -> dismiss()
            }
        }
        return true
    }

    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        val axes = AndroidGamepadMotion.read(event) ?: return super.dispatchGenericMotionEvent(event)
        if (event.deviceId == deviceId) {
            when (stick.command(axes.horizontal, axes.vertical, event.eventTime)) {
                CatalogControllerCommand.MOVE_UP, CatalogControllerCommand.MOVE_LEFT -> move(-1)
                CatalogControllerCommand.MOVE_DOWN, CatalogControllerCommand.MOVE_RIGHT -> move(1)
                else -> Unit
            }
        }
        return true
    }

    private fun move(delta: Int) {
        selected = (selected + delta).coerceIn(0, choices.lastIndex)
        choices[selected].requestFocus()
    }

    private fun choose(index: Int) {
        assign(slots[index])
        dismiss()
    }
}
