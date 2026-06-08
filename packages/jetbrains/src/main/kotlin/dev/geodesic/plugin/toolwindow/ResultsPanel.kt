package dev.geodesic.plugin.toolwindow

import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTabbedPane
import com.intellij.ui.content.ContentFactory
import dev.geodesic.plugin.engine.GapReport
import dev.geodesic.plugin.engine.JobResult
import dev.geodesic.plugin.engine.SynthesisData
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Cursor
import java.awt.FlowLayout
import java.awt.Font
import javax.swing.*

class ResultsPanel private constructor(
    project: Project,
    job: JobResult
) : JPanel(BorderLayout()) {

    init {
        val tabs = JBTabbedPane()
        val synthesis = job.result?.synthesis

        tabs.addTab("Architecture", buildArchTab(synthesis?.architectureMapMarkdown ?: ""))
        tabs.addTab("Skill File", buildSkillTab(synthesis))
        tabs.addTab("Gap Report", buildGapTab(project, synthesis?.gapReport))

        add(tabs, BorderLayout.CENTER)

        val header = JPanel(BorderLayout())
        val repoName = synthesis?.gapReport?.repoName ?: "Unknown"
        val score = synthesis?.gapReport?.overallScore
        val grade = synthesis?.gapReport?.overallGrade
        val title = if (score != null) "$repoName — $score/100 ($grade)" else repoName
        header.add(JBLabel(title).apply { font = font.deriveFont(Font.BOLD, 13f) }, BorderLayout.CENTER)
        add(header, BorderLayout.NORTH)
    }

    private fun buildArchTab(markdown: String): JComponent {
        val pane = JEditorPane("text/html", markdownToHtml(markdown)).apply {
            isEditable = false
            contentType = "text/html"
        }
        return JBScrollPane(pane)
    }

    private fun buildSkillTab(synthesis: SynthesisData?): JComponent {
        val panel = JPanel(BorderLayout())
        if (synthesis == null) {
            panel.add(JBLabel("No skill file data."), BorderLayout.CENTER)
            return panel
        }

        val phiZones = synthesis.skillFile.phiZones
        val topPanel = JPanel(BorderLayout())

        if (phiZones.isNotEmpty()) {
            val phiList = JPanel().apply { layout = BoxLayout(this, BoxLayout.Y_AXIS) }
            phiList.add(JBLabel("PHI Zones Detected (${phiZones.size}):").apply {
                font = font.deriveFont(Font.BOLD)
            })
            for (zone in phiZones) {
                phiList.add(JBLabel("${zone.file}:${zone.lineStart}–${zone.lineEnd} — ${zone.protectionMissing.joinToString(", ")}").apply {
                    foreground = Color(0xCC, 0x88, 0x00)
                })
            }
            topPanel.add(JBScrollPane(phiList).apply { preferredSize = java.awt.Dimension(0, 100) }, BorderLayout.NORTH)
        }

        val meta = synthesis.skillFile.meta
        val json = """
            Repo: ${meta.repo}
            Analyzed At: ${meta.analyzedAt}
            Duration: ${meta.analysisDurationMs}ms
            PHI Zones: ${phiZones.size}
        """.trimIndent()
        val textArea = JTextArea(json).apply { isEditable = false; font = Font(Font.MONOSPACED, Font.PLAIN, 12) }
        topPanel.add(JBScrollPane(textArea), BorderLayout.CENTER)

        panel.add(topPanel, BorderLayout.CENTER)
        return panel
    }

    private fun buildGapTab(project: Project, gapReport: GapReport?): JComponent {
        val panel = JPanel(BorderLayout())
        if (gapReport == null) {
            panel.add(JBLabel("No gap report data."), BorderLayout.CENTER)
            return panel
        }

        val content = JPanel().apply { layout = BoxLayout(this, BoxLayout.Y_AXIS) }

        // Score bar
        val scoreBar = JProgressBar(0, 100).apply {
            value = gapReport.overallScore
            isStringPainted = true
            string = "${gapReport.overallScore}/100 (${gapReport.overallGrade})"
        }
        content.add(scoreBar)
        content.add(Box.createVerticalStrut(8))

        // Findings by dimension
        for (dim in gapReport.dimensions) {
            if (!dim.active || dim.findings.isEmpty()) continue

            val dimLabel = JBLabel("${dim.dimension} — ${dim.score}/100 (${dim.grade})").apply {
                font = font.deriveFont(Font.BOLD)
            }
            content.add(dimLabel)

            for (finding in dim.findings) {
                val severity = finding.severity
                val color = when (severity) {
                    "P0" -> Color(0xCC, 0x00, 0x00)
                    "P1" -> Color(0xCC, 0x55, 0x00)
                    "P2" -> Color(0xCC, 0x88, 0x00)
                    else -> Color(0x44, 0x88, 0x44)
                }

                val findingPanel = JPanel(FlowLayout(FlowLayout.LEFT, 4, 2))
                val sevLabel = JBLabel("[$severity]").apply { foreground = color; font = font.deriveFont(Font.BOLD) }
                val descLabel = JBLabel(finding.description)
                findingPanel.add(sevLabel)
                findingPanel.add(descLabel)

                if (finding.file.isNotEmpty()) {
                    val linkLabel = JBLabel("<html><a href='#'>${finding.file}:${finding.lineStart}</a></html>").apply {
                        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
                        addMouseListener(object : java.awt.event.MouseAdapter() {
                            override fun mouseClicked(e: java.awt.event.MouseEvent) {
                                openFile(project, finding.file, finding.lineStart)
                            }
                        })
                    }
                    findingPanel.add(linkLabel)
                }

                content.add(findingPanel)

                if (finding.fix.isNotEmpty()) {
                    content.add(JBLabel("  Fix: ${finding.fix}").apply {
                        foreground = Color.GRAY
                        font = font.deriveFont(11f)
                    })
                }
            }

            content.add(Box.createVerticalStrut(6))
        }

        panel.add(JBScrollPane(content), BorderLayout.CENTER)
        return panel
    }

    private fun openFile(project: Project, filePath: String, lineStart: Int) {
        val vf = LocalFileSystem.getInstance().findFileByPath(filePath) ?: return
        OpenFileDescriptor(project, vf, maxOf(0, lineStart - 1), 0).navigate(true)
    }

    private fun markdownToHtml(md: String): String {
        val sb = StringBuilder("<html><body style='font-family:sans-serif;padding:8px'>")
        for (line in md.lines()) {
            val escaped = line
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
            val converted = when {
                escaped.startsWith("### ") -> "<h3>${escaped.removePrefix("### ")}</h3>"
                escaped.startsWith("## ") -> "<h2>${escaped.removePrefix("## ")}</h2>"
                escaped.startsWith("# ") -> "<h1>${escaped.removePrefix("# ")}</h1>"
                escaped.startsWith("- ") || escaped.startsWith("* ") -> "<li>${escaped.drop(2)}</li>"
                escaped.isBlank() -> "<br>"
                else -> "<p>$escaped</p>"
            }
            sb.append(converted)
        }
        sb.append("</body></html>")
        return sb.toString()
    }

    companion object {
        fun show(project: Project, job: JobResult) {
            SwingUtilities.invokeLater {
                val repoName = job.result?.synthesis?.gapReport?.repoName ?: "Analysis"
                val panel = ResultsPanel(project, job)

                val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Geodesic")
                if (toolWindow != null) {
                    val content = ContentFactory.getInstance().createContent(panel, "Results: $repoName", true)
                    content.isCloseable = true
                    toolWindow.contentManager.addContent(content)
                    toolWindow.contentManager.setSelectedContent(content)
                    toolWindow.show()
                    toolWindow.activate(null)
                } else {
                    // Fallback if tool window not available
                    val frame = JFrame("Geodesic — $repoName")
                    frame.defaultCloseOperation = JFrame.DISPOSE_ON_CLOSE
                    frame.setSize(900, 650)
                    frame.contentPane = panel
                    frame.setLocationRelativeTo(null)
                    frame.isVisible = true
                }
            }
        }
    }
}
