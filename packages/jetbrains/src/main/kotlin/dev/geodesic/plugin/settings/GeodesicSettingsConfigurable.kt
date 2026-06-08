package dev.geodesic.plugin.settings

import com.intellij.openapi.options.Configurable
import com.intellij.openapi.ui.ComboBox
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets
import javax.swing.*

class GeodesicSettingsConfigurable : Configurable {

    private val providerCombo = ComboBox(arrayOf("anthropic", "openai", "gemini", "azure", "ollama"))
    private val apiKeyField = JPasswordField()
    private val autoStartCheckbox = JCheckBox("Auto-start engine on IDE startup")

    override fun getDisplayName(): String = "Geodesic"

    override fun createComponent(): JComponent {
        val (provider, apiKey) = GeodesicSettings.readConfig()
        providerCombo.selectedItem = provider
        apiKeyField.text = apiKey
        autoStartCheckbox.isSelected = GeodesicSettings.getInstance().autoStartEngine

        val panel = JPanel(GridBagLayout())
        val gbc = GridBagConstraints().apply {
            insets = Insets(4, 4, 4, 4)
            fill = GridBagConstraints.HORIZONTAL
            anchor = GridBagConstraints.WEST
        }

        gbc.gridx = 0; gbc.gridy = 0; gbc.weightx = 0.0
        panel.add(JLabel("Provider:"), gbc)
        gbc.gridx = 1; gbc.weightx = 1.0
        panel.add(providerCombo, gbc)

        gbc.gridx = 0; gbc.gridy = 1; gbc.weightx = 0.0
        panel.add(JLabel("API Key:"), gbc)
        gbc.gridx = 1; gbc.weightx = 1.0
        panel.add(apiKeyField, gbc)

        gbc.gridx = 0; gbc.gridy = 2; gbc.gridwidth = 2; gbc.weightx = 1.0
        panel.add(autoStartCheckbox, gbc)

        gbc.gridy = 3; gbc.weighty = 1.0; gbc.fill = GridBagConstraints.BOTH
        panel.add(JPanel(), gbc)

        return panel
    }

    override fun isModified(): Boolean {
        val (provider, apiKey) = GeodesicSettings.readConfig()
        return providerCombo.selectedItem != provider
            || String(apiKeyField.password) != apiKey
            || autoStartCheckbox.isSelected != GeodesicSettings.getInstance().autoStartEngine
    }

    override fun apply() {
        GeodesicSettings.saveConfig(
            provider = providerCombo.selectedItem as String,
            apiKey = String(apiKeyField.password),
        )
        GeodesicSettings.getInstance().autoStartEngine = autoStartCheckbox.isSelected
    }

    override fun reset() {
        val (provider, apiKey) = GeodesicSettings.readConfig()
        providerCombo.selectedItem = provider
        apiKeyField.text = apiKey
        autoStartCheckbox.isSelected = GeodesicSettings.getInstance().autoStartEngine
    }
}
