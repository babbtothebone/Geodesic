package dev.geodesic.plugin.toolwindow

import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBPasswordField
import com.intellij.ui.components.JBScrollPane
import dev.geodesic.plugin.engine.JobProgress
import dev.geodesic.plugin.settings.GeodesicSettings
import dev.geodesic.plugin.settings.RepoEntry
import java.awt.BorderLayout
import java.awt.FlowLayout
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets
import javax.swing.*

class SidebarPanel(
    private val project: Project,
    private val service: GeodesicToolWindowService
) : JPanel(BorderLayout()) {

    private val statusLabel = JBLabel("⚙ Starting engine…")
    private val repoListModel = DefaultListModel<RepoEntry>()
    private val repoList = JBList(repoListModel)
    private val providerCombo = ComboBox(arrayOf("anthropic", "openai", "gemini", "azure", "ollama"))
    private val apiKeyField = JBPasswordField()
    private val runButton = JButton("▶ Run Analysis")
    private val progressBar = JProgressBar(0, 100).apply { isStringPainted = false }
    private val progressLabel = JBLabel("")
    private val crystalLabel = JBLabel("💎 0 crystals")
    private val progressPanel = JPanel(BorderLayout(0, 2))
    private val runPanel = JPanel(BorderLayout())

    init {
        val settings = GeodesicSettings.getInstance()
        val (provider, apiKey) = GeodesicSettings.readConfig()
        providerCombo.selectedItem = provider
        apiKeyField.text = apiKey
        settings.repos.forEach { repoListModel.addElement(it) }

        build()
    }

    private fun build() {
        val main = JPanel(GridBagLayout())
        val gbc = GridBagConstraints().apply {
            insets = Insets(3, 4, 3, 4)
            fill = GridBagConstraints.HORIZONTAL
            weightx = 1.0
            gridx = 0
        }

        // Status
        gbc.gridy = 0
        main.add(statusLabel, gbc)

        // Provider
        gbc.gridy = 1
        main.add(sectionLabel("AI Provider"), gbc)
        gbc.gridy = 2
        main.add(JBLabel("Provider:"), gbc)
        gbc.gridy = 3
        main.add(providerCombo, gbc)
        gbc.gridy = 4
        main.add(JBLabel("API Key:"), gbc)
        gbc.gridy = 5
        main.add(apiKeyField, gbc)

        val providerButtons = JPanel(FlowLayout(FlowLayout.LEFT, 4, 0))
        val saveBtn = JButton("Save")
        val testBtn = JButton("Test Connection")
        saveBtn.addActionListener { saveConfig() }
        testBtn.addActionListener { testConnection() }
        providerButtons.add(saveBtn)
        providerButtons.add(testBtn)
        gbc.gridy = 6
        main.add(providerButtons, gbc)

        // Repos
        gbc.gridy = 7
        main.add(sectionLabel("Repositories"), gbc)

        repoList.cellRenderer = RepoListCellRenderer()
        gbc.gridy = 8
        gbc.weighty = 0.3
        gbc.fill = GridBagConstraints.BOTH
        main.add(JBScrollPane(repoList).apply { preferredSize = java.awt.Dimension(0, 120) }, gbc)
        gbc.weighty = 0.0
        gbc.fill = GridBagConstraints.HORIZONTAL

        val repoButtons = JPanel(FlowLayout(FlowLayout.LEFT, 4, 0))
        val addBtn = JButton("+ Add")
        val removeBtn = JButton("✕ Remove")
        addBtn.addActionListener { addRepo() }
        removeBtn.addActionListener { removeRepo() }
        repoButtons.add(addBtn)
        repoButtons.add(removeBtn)
        gbc.gridy = 9
        main.add(repoButtons, gbc)

        // Run / progress
        gbc.gridy = 10
        main.add(JSeparator(), gbc)

        runButton.addActionListener { runAnalysis() }
        progressPanel.add(progressLabel, BorderLayout.NORTH)
        progressPanel.add(progressBar, BorderLayout.CENTER)
        progressPanel.isVisible = false

        runPanel.add(runButton, BorderLayout.CENTER)
        runPanel.add(progressPanel, BorderLayout.SOUTH)
        gbc.gridy = 11
        main.add(runPanel, gbc)

        // Crystal Store
        gbc.gridy = 12
        main.add(sectionLabel("Crystal Store"), gbc)
        val crystalRow = JPanel(FlowLayout(FlowLayout.LEFT, 6, 0))
        val syncBtn = JButton("↺ Sync")
        syncBtn.addActionListener { syncCrystals() }
        crystalRow.add(crystalLabel)
        crystalRow.add(syncBtn)
        gbc.gridy = 13
        main.add(crystalRow, gbc)

        // Spacer
        gbc.gridy = 14
        gbc.weighty = 1.0
        gbc.fill = GridBagConstraints.BOTH
        main.add(JPanel(), gbc)

        add(JBScrollPane(main), BorderLayout.CENTER)
        refreshRunButtonState()
    }

    private fun sectionLabel(text: String) = JBLabel(text.uppercase()).apply {
        font = font.deriveFont(java.awt.Font.BOLD, 10f)
    }

    fun onEngineStatus(status: String) {
        statusLabel.text = "⚙ $status"
        refreshRunButtonState()
    }

    fun refreshState() {
        val client = service.engineClient ?: return
        Thread {
            try {
                val crystals = client.listCrystals()
                SwingUtilities.invokeLater {
                    val count = crystals.size
                    crystalLabel.text = "💎 $count crystal${if (count != 1) "s" else ""}"
                }
            } catch (_: Exception) { /* engine not ready */ }
        }.also { it.isDaemon = true; it.start() }
    }

    private fun saveConfig() {
        val provider = providerCombo.selectedItem as String
        GeodesicSettings.saveConfig(provider, String(apiKeyField.password))
        Messages.showInfoMessage(project, "Provider saved: $provider", "Geodesic")
    }

    private fun testConnection() {
        val client = service.engineClient
        if (client == null) {
            Messages.showWarningDialog(project, "Engine not running yet.", "Geodesic")
            return
        }
        Thread {
            try {
                val result = client.testConnection()
                SwingUtilities.invokeLater {
                    if (result.healthy) {
                        Messages.showInfoMessage(project, "Provider connected (${result.latencyMs}ms)", "Geodesic")
                    } else {
                        Messages.showErrorDialog(project, "Provider error: ${result.error ?: "unknown"}", "Geodesic")
                    }
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    Messages.showErrorDialog(project, "Connection test failed: ${e.message}", "Geodesic")
                }
            }
        }.also { it.isDaemon = true; it.start() }
    }

    private fun addRepo() {
        val desc = FileChooserDescriptorFactory.createSingleFolderDescriptor()
            .apply { title = "Add Repository"; description = "Select a repository folder" }
        val chosen = FileChooser.chooseFile(desc, project, null) ?: return
        val path = chosen.path
        val label = chosen.name
        val entry = RepoEntry(label = label, path = path)
        repoListModel.addElement(entry)
        GeodesicSettings.getInstance().repos.add(entry)
        refreshRunButtonState()
    }

    private fun removeRepo() {
        val idx = repoList.selectedIndex
        if (idx < 0) return
        val entry = repoListModel.getElementAt(idx)
        repoListModel.removeElementAt(idx)
        GeodesicSettings.getInstance().repos.removeIf { it.path == entry.path }
        refreshRunButtonState()
    }

    private fun refreshRunButtonState() {
        val hasRepos = repoListModel.size() > 0
        val engineReady = service.engineManager.port != null
        runButton.isEnabled = hasRepos && engineReady
    }

    private fun runAnalysis() {
        val client = service.engineClient
        if (client == null) {
            Messages.showWarningDialog(project, "Engine not running.", "Geodesic")
            return
        }
        val repos = (0 until repoListModel.size()).map { repoListModel.getElementAt(it) }
        if (repos.isEmpty()) return

        runButton.isEnabled = false
        progressPanel.isVisible = true
        progressBar.value = 0

        Thread {
            for (repo in repos) {
                try {
                    SwingUtilities.invokeLater { progressLabel.text = "▶ Queuing ${repo.label}…" }
                    val startResult = client.startAnalysis(repo.path)
                    val finalJob = client.pollJob(
                        jobId = startResult.jobId,
                        onProgress = { progress -> updateProgress(progress) }
                    )
                    SwingUtilities.invokeLater {
                        val gr = finalJob.result?.synthesis?.gapReport
                        if (gr != null) {
                            ResultsPanel.show(project, finalJob)
                            Messages.showInfoMessage(
                                project,
                                "Analysis complete — ${gr.repoName}: ${gr.overallScore}/100 (${gr.overallGrade})",
                                "Geodesic"
                            )
                        }
                    }
                } catch (e: Exception) {
                    SwingUtilities.invokeLater {
                        Messages.showErrorDialog(project, "Analysis failed: ${e.message}", "Geodesic")
                    }
                }
            }
            SwingUtilities.invokeLater {
                progressPanel.isVisible = false
                progressBar.value = 0
                progressLabel.text = ""
                runButton.isEnabled = true
                refreshState()
            }
        }.also { it.isDaemon = true; it.start() }
    }

    private fun updateProgress(progress: JobProgress) {
        SwingUtilities.invokeLater {
            progressLabel.text = "▶ ${progress.stage.ifEmpty { progress.status }}"
            progressBar.value = progressWidth(progress.status)
        }
    }

    private fun progressWidth(status: String) = when (status) {
        "queued" -> 5
        "harvesting" -> 20
        "scrubbing" -> 40
        "querying-crystal" -> 55
        "synthesizing" -> 75
        "writing" -> 90
        "complete", "failed" -> 100
        else -> 10
    }

    private fun syncCrystals() {
        val client = service.engineClient ?: return
        Thread {
            try {
                val result = client.syncCrystals()
                SwingUtilities.invokeLater {
                    Messages.showInfoMessage(project, result.message, "Geodesic")
                    refreshState()
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    Messages.showErrorDialog(project, "Sync failed: ${e.message}", "Geodesic")
                }
            }
        }.also { it.isDaemon = true; it.start() }
    }
}

private class RepoListCellRenderer : DefaultListCellRenderer() {
    override fun getListCellRendererComponent(
        list: JList<*>?, value: Any?, index: Int, isSelected: Boolean, cellHasFocus: Boolean
    ): java.awt.Component {
        super.getListCellRendererComponent(list, value, index, isSelected, cellHasFocus)
        val entry = value as? RepoEntry
        text = if (entry != null) "${entry.label} — ${entry.path}" else value.toString()
        return this
    }
}
