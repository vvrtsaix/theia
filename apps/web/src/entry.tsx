/* @refresh reload */

import { Router } from "@solidjs/router"
import { render } from "solid-js/web"
import { App } from "#app"
import "./styles.css"

const root = document.getElementById("root")
if (!root) throw new Error("#root not found")

render(
  () => (
    <Router>
      <App />
    </Router>
  ),
  root,
)
