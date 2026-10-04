# 🎨 PSB History Engine — Card Templates & Visualization

This guide covers ready-to-use **Piotras Smart Button (PSB)** dashboard templates designed to fetch and render `attributes.history` directly from RAM without lag.

## 🚀 Recommended Templates

| Category | Features & Capabilities | Template Code |
| :--- | :--- | :---: |
| ⚡ **Energy Engine** | Main meter vs sub-meters balance, hourly breakdown, unmeasured usage | [View Template](templates/energy-history.md) |
| 🌡️ **Climate Advice Engine** | Smooth temperature curve, Min/Max trend indicators, daily advice | [View Template](templates/temperature-advice.md) |
| 🔋 **Battery Health Monitor** | Battery discharge history with dynamic color thresholds and alerts | [View Template](templates/battery-health.md) |

## 💡 Why Piotras Smart Button?
- **Zero Heavy Libraries:** Renders interactive SVG charts directly in the browser DOM.
- **Instant RAM Reads:** Reads the compact `[timestamp, value]` array with no backend database overhead.
- **Full Customization:** Uses `custom_data` YAML logic for flexible state-based styling.