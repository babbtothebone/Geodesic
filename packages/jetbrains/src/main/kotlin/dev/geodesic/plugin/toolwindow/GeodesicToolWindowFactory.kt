package dev.geodesic.plugin.toolwindow

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

class GeodesicToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val service = project.getService(GeodesicToolWindowService::class.java)
            ?: GeodesicToolWindowService(project).also { /* fallback — should not happen */ }

        val sidebarPanel = SidebarPanel(project, service)
        service.registerSidebarPanel(sidebarPanel)
        service.ensureEngineStarted()

        val content = ContentFactory.getInstance().createContent(sidebarPanel, "", false)
        toolWindow.contentManager.addContent(content)
    }
}
