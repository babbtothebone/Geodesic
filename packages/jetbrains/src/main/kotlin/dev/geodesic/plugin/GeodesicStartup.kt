package dev.geodesic.plugin

import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import dev.geodesic.plugin.engine.EngineManager
import dev.geodesic.plugin.settings.GeodesicSettings
import dev.geodesic.plugin.toolwindow.GeodesicToolWindowService

class GeodesicStartup : ProjectActivity {
    override suspend fun execute(project: Project) {
        val settings = GeodesicSettings.getInstance()
        if (!settings.autoStartEngine) return

        val service = project.getService(GeodesicToolWindowService::class.java) ?: return
        service.ensureEngineStarted()
    }
}
