package dev.geodesic.plugin.engine

import com.google.gson.Gson
import com.google.gson.JsonObject
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

data class HealthResult(val ok: Boolean, val version: String)
data class ConnectionResult(val healthy: Boolean, val latencyMs: Long, val error: String?)
data class CrystalEntry(val id: String, val name: String, val fitness: Double)
data class SyncResult(val success: Boolean, val message: String)
data class StartJobResult(val jobId: String, val status: String)

data class JobProgress(
    val status: String,
    val stage: String,
    val phiZoneCount: Int,
    val crystalMatch: String?,
    val crystalMatchScore: Double?
)

data class JobResult(
    val jobId: String,
    val progress: JobProgress,
    val result: AnalysisResult?,
    val error: String?
)

data class AnalysisResult(
    val synthesis: SynthesisData,
    val artifactPaths: ArtifactPaths,
    val fingerprint: String
)

data class SynthesisData(
    val gapReport: GapReport,
    val architectureMapMarkdown: String,
    val skillFile: SkillFileMeta
)

data class SkillFileMeta(val meta: RepoMeta, val phiZones: List<PhiZone>)
data class RepoMeta(val repo: String, val analyzedAt: String, val analysisDurationMs: Long)
data class PhiZone(
    val file: String,
    val lineStart: Int,
    val lineEnd: Int,
    val phiFieldCount: Int,
    val protectionMissing: List<String>
)

data class GapReport(
    val repoName: String,
    val overallScore: Int,
    val overallGrade: String,
    val dimensions: List<Dimension>,
    val uncertainDetections: List<UncertainDetection>
)

data class Dimension(
    val dimension: String,
    val score: Int,
    val grade: String,
    val active: Boolean,
    val findings: List<Finding>
)

data class Finding(
    val severity: String,
    val description: String,
    val file: String,
    val lineStart: Int,
    val lineEnd: Int,
    val detail: String,
    val fix: String,
    val deduction: Int
)

data class UncertainDetection(
    val file: String,
    val lineStart: Int,
    val lineEnd: Int,
    val trigger: String,
    val confidencePct: Int,
    val recommendedAction: String
)

data class ArtifactPaths(
    val architectureMap: String,
    val skillFileJson: String,
    val skillFileMd: String,
    val gapReport: String
)

class EngineClient(private val port: Int) {
    private val gson = Gson()
    private val http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build()

    fun health(): HealthResult {
        val body = get("/health")
        val obj = gson.fromJson(body, JsonObject::class.java)
        return HealthResult(
            ok = obj.get("ok")?.asBoolean ?: false,
            version = obj.get("version")?.asString ?: ""
        )
    }

    fun testConnection(): ConnectionResult {
        val body = post("/config/test", "{}")
        val obj = gson.fromJson(body, JsonObject::class.java)
        return ConnectionResult(
            healthy = obj.get("healthy")?.asBoolean ?: false,
            latencyMs = obj.get("latencyMs")?.asLong ?: 0L,
            error = obj.get("error")?.asString
        )
    }

    fun listCrystals(): List<CrystalEntry> {
        val body = get("/crystals")
        val arr = gson.fromJson(body, Array<JsonObject>::class.java)
        return arr.map { o ->
            CrystalEntry(
                id = o.get("crystalId")?.asString ?: "",
                name = o.get("name")?.asString ?: "",
                fitness = o.get("fitness")?.asDouble ?: 0.0
            )
        }
    }

    fun syncCrystals(): SyncResult {
        val body = post("/crystals/sync", "{}")
        val obj = gson.fromJson(body, JsonObject::class.java)
        return SyncResult(
            success = obj.get("success")?.asBoolean ?: false,
            message = obj.get("message")?.asString ?: ""
        )
    }

    fun startAnalysis(repoPath: String): StartJobResult {
        val payload = """{"repoPath":${gson.toJson(repoPath)}}"""
        val body = post("/analyze", payload)
        val obj = gson.fromJson(body, JsonObject::class.java)
        return StartJobResult(
            jobId = obj.get("jobId")?.asString ?: "",
            status = obj.get("status")?.asString ?: ""
        )
    }

    fun getJob(jobId: String): JobResult {
        val body = get("/jobs/$jobId")
        return gson.fromJson(body, JobResult::class.java)
    }

    fun pollJob(
        jobId: String,
        onProgress: (JobProgress) -> Unit,
        intervalMs: Long = 1500L,
        timeoutMs: Long = 600_000L
    ): JobResult {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val job = getJob(jobId)
            onProgress(job.progress)
            val status = job.progress.status
            if (status == "complete") return job
            if (status == "failed") throw RuntimeException("Analysis failed: ${job.error ?: "unknown error"}")
            Thread.sleep(intervalMs)
        }
        throw RuntimeException("Analysis timed out after ${timeoutMs / 1000}s")
    }

    private fun get(path: String): String {
        val req = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:$port$path"))
            .timeout(Duration.ofSeconds(30))
            .GET()
            .build()
        val resp = http.send(req, HttpResponse.BodyHandlers.ofString())
        if (resp.statusCode() !in 200..299) {
            throw RuntimeException("Engine returned ${resp.statusCode()} for GET $path: ${resp.body()}")
        }
        return resp.body()
    }

    private fun post(path: String, jsonBody: String): String {
        val req = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:$port$path"))
            .timeout(Duration.ofSeconds(30))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
            .build()
        val resp = http.send(req, HttpResponse.BodyHandlers.ofString())
        if (resp.statusCode() !in 200..299) {
            throw RuntimeException("Engine returned ${resp.statusCode()} for POST $path: ${resp.body()}")
        }
        return resp.body()
    }
}
