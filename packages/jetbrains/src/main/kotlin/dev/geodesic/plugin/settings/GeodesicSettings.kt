package dev.geodesic.plugin.settings

import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service
import com.intellij.util.xmlb.XmlSerializerUtil
import java.net.InetAddress
import java.nio.file.Paths

@State(name = "GeodesicSettings", storages = [Storage("geodesic.xml")])
class GeodesicSettings : PersistentStateComponent<GeodesicSettings> {

    var repos: MutableList<RepoEntry> = mutableListOf()
    var autoStartEngine: Boolean = true
    // provider and apiKey are stored in ~/.geodesic/config.json (shared with CLI and VS Code extension)

    override fun getState(): GeodesicSettings = this

    override fun loadState(state: GeodesicSettings) {
        XmlSerializerUtil.copyBean(state, this)
    }

    companion object {
        fun getInstance(): GeodesicSettings = service()

        private val configFile
            get() = Paths.get(System.getProperty("user.home"), ".geodesic", "config.json").toFile()

        private val gson = GsonBuilder().setPrettyPrinting().create()

        /** Returns (provider, apiKey) from ~/.geodesic/config.json */
        fun readConfig(): Pair<String, String> {
            val file = configFile
            if (!file.exists()) return "anthropic" to ""
            return try {
                val obj = JsonParser.parseString(file.readText()).asJsonObject
                (obj.get("provider")?.asString ?: "anthropic") to (obj.get("apiKey")?.asString ?: "")
            } catch (_: Exception) {
                "anthropic" to ""
            }
        }

        /** Saves provider/apiKey to ~/.geodesic/config.json, preserving all other fields */
        fun saveConfig(provider: String, apiKey: String) {
            val file = configFile
            file.parentFile?.mkdirs()
            val obj: JsonObject = if (file.exists()) {
                try { JsonParser.parseString(file.readText()).asJsonObject }
                catch (_: Exception) { JsonObject() }
            } else JsonObject()

            obj.addProperty("provider", provider)
            if (apiKey.isNotEmpty()) obj.addProperty("apiKey", apiKey)
            else obj.remove("apiKey")

            if (!obj.has("analystId")) {
                val hostname = try { InetAddress.getLocalHost().hostName } catch (_: Exception) { "localhost" }
                obj.addProperty("analystId", "${System.getProperty("user.name")}@$hostname")
            }

            file.writeText(gson.toJson(obj))
        }
    }
}

data class RepoEntry(var label: String = "", var path: String = "")
