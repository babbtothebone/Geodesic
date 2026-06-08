package dev.geodesic.plugin.engine

import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.util.SystemInfo
import java.io.File
import java.nio.file.Paths
import java.util.concurrent.atomic.AtomicBoolean

private val LOG = logger<EngineManager>()
private val PORT_PATTERN = Regex("""GEODE_ENGINE_PORT=(\d+)""")
private const val STARTUP_TIMEOUT_MS = 15_000L

class EngineManager {
    private var process: Process? = null
    @Volatile private var _port: Int? = null
    val port: Int? get() = _port

    private val statusListeners = mutableListOf<(String) -> Unit>()

    fun addStatusListener(listener: (String) -> Unit) {
        statusListeners.add(listener)
    }

    private fun fireStatus(msg: String) {
        statusListeners.forEach { it(msg) }
    }

    fun start(): Boolean {
        if (process != null) return true

        val scriptPath = findEngineScript() ?: run {
            fireStatus("Engine not found — install @geodesic/cli via npm")
            return false
        }

        val nodeBin = findNodeBinary()
        fireStatus("Starting engine…")

        val pb = ProcessBuilder(nodeBin, scriptPath)
            .redirectErrorStream(false)
            .apply { environment()["NODE_ENV"] = "production" }

        val proc = try {
            pb.start()
        } catch (e: Exception) {
            LOG.error("Failed to start engine process", e)
            fireStatus("Engine start failed: ${e.message}")
            return false
        }

        process = proc

        val startTime = System.currentTimeMillis()
        val portFound = AtomicBoolean(false)

        Thread {
            proc.inputStream.bufferedReader().use { reader ->
                var line = reader.readLine()
                while (line != null) {
                    val match = PORT_PATTERN.find(line)
                    if (match != null) {
                        _port = match.groupValues[1].toIntOrNull()
                        portFound.set(true)
                        fireStatus("Engine running on port ${_port}")
                    }
                    line = reader.readLine()
                }
            }
        }.also { it.isDaemon = true; it.start() }

        Thread {
            proc.errorStream.bufferedReader().use { reader ->
                var line = reader.readLine()
                while (line != null) {
                    LOG.warn("Engine stderr: $line")
                    line = reader.readLine()
                }
            }
        }.also { it.isDaemon = true; it.start() }

        // Wait for port to be discovered (up to STARTUP_TIMEOUT_MS)
        val deadline = startTime + STARTUP_TIMEOUT_MS
        while (!portFound.get() && System.currentTimeMillis() < deadline && proc.isAlive) {
            Thread.sleep(100)
        }

        if (!portFound.get()) {
            proc.destroyForcibly()
            process = null
            fireStatus("Engine failed to start within ${STARTUP_TIMEOUT_MS / 1000}s timeout")
            return false
        }

        Thread {
            val code = proc.waitFor()
            process = null
            _port = null
            fireStatus(if (code != 0) "Engine stopped (exit $code)" else "Engine stopped")
        }.also { it.isDaemon = true; it.start() }

        return true
    }

    fun stop() {
        process?.destroy()
        process = null
        _port = null
    }

    private fun findEngineScript(): String? {
        val npmGlobalPaths = buildList {
            if (SystemInfo.isWindows) {
                val appData = System.getenv("APPDATA") ?: ""
                add(Paths.get(appData, "npm", "node_modules", "@geodesic", "engine", "dist", "server", "start.js").toString())
                // Also check npm prefix for non-APPDATA installs
                add(Paths.get(appData, "npm", "node_modules", "@geodesic", "cli", "node_modules", "@geodesic", "engine", "dist", "server", "start.js").toString())
            } else {
                add("/usr/local/lib/node_modules/@geodesic/engine/dist/server/start.js")
                add("/usr/lib/node_modules/@geodesic/engine/dist/server/start.js")
                val home = System.getProperty("user.home") ?: ""
                add(Paths.get(home, ".npm-global", "lib", "node_modules", "@geodesic", "engine", "dist", "server", "start.js").toString())
            }
        }

        for (p in npmGlobalPaths) {
            if (File(p).exists()) return p
        }

        // NVM locations (unix)
        val home = System.getProperty("user.home") ?: ""
        val nvmBase = File(home, ".nvm/versions/node")
        if (nvmBase.exists()) {
            nvmBase.listFiles()?.sortedDescending()?.forEach { nodeDir ->
                val candidate = File(nodeDir, "lib/node_modules/@geodesic/engine/dist/server/start.js")
                if (candidate.exists()) return candidate.absolutePath
            }
        }

        // NVM Windows
        if (SystemInfo.isWindows) {
            val appData = System.getenv("APPDATA") ?: ""
            val nvmWinBase = File(appData, "nvm")
            if (nvmWinBase.exists()) {
                nvmWinBase.listFiles()?.sortedDescending()?.forEach { nodeDir ->
                    val candidate = File(nodeDir, "node_modules/@geodesic/engine/dist/server/start.js")
                    if (candidate.exists()) return candidate.absolutePath
                }
            }
        }

        return null
    }

    private fun findNodeBinary(): String {
        val candidates = buildList {
            if (SystemInfo.isWindows) {
                add("node.exe")
                add("C:\\Program Files\\nodejs\\node.exe")
                val appData = System.getenv("APPDATA") ?: ""
                add(Paths.get(appData, "nvm", "current", "node.exe").toString())
            } else {
                add("node")
                add("/usr/local/bin/node")
                add("/usr/bin/node")
                val home = System.getProperty("user.home") ?: ""
                add("$home/.nvm/current/bin/node")
            }
        }

        for (bin in candidates) {
            try {
                val result = Runtime.getRuntime().exec(arrayOf(bin, "--version"))
                result.waitFor()
                if (result.exitValue() == 0) return bin
            } catch (_: Exception) { /* try next */ }
        }

        return "node"
    }
}
