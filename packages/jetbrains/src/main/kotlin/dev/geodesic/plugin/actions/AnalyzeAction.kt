package dev.geodesic.plugin.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.wm.ToolWindowManager
import dev.geodesic.plugin.toolwindow.GeodesicToolWindowService

class AnalyzeAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return

        // Open the Geodesic tool window
        val toolWindowManager = ToolWindowManager.getInstance(project)
        val toolWindow = toolWindowManager.getToolWindow("Geodesic")
        if (toolWindow != null) {
            toolWindow.show()
            return
        }

        Messages.showInfoMessage(project, "Open the Geodesic tool window to run an analysis.", "Geodesic")
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null
    }
}
