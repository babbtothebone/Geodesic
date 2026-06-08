package dev.geodesic.plugin.toolwindow

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import dev.geodesic.plugin.engine.EngineClient
import dev.geodesic.plugin.engine.EngineManager
import java.util.concurrent.atomic.AtomicBoolean

@Service(Service.Level.PROJECT)
class GeodesicToolWindowService(private val project: Project) : Disposable {
    val engineManager = EngineManager()
    var engineClient: EngineClient? = null
        private set

    private var sidebarPanel: SidebarPanel? = null
    private val starting = AtomicBoolean(false)

    fun registerSidebarPanel(panel: SidebarPanel) {
        sidebarPanel = panel
        engineManager.addStatusListener { status ->
            javax.swing.SwingUtilities.invokeLater { panel.onEngineStatus(status) }
        }
    }

    fun ensureEngineStarted() {
        if (engineManager.port != null) return
        if (!starting.compareAndSet(false, true)) return  // prevent concurrent starts
        Thread {
            try {
                val ok = engineManager.start()
                if (ok && engineManager.port != null) {
                    engineClient = EngineClient(engineManager.port!!)
                    javax.swing.SwingUtilities.invokeLater { sidebarPanel?.refreshState() }
                }
            } finally {
                starting.set(false)
            }
        }.also { it.isDaemon = true; it.start() }
    }

    override fun dispose() {
        engineManager.stop()
    }
}
