/**
 * ============================================================================
 * PUNTO DE ENTRADA: main.ts
 * Responsabilidad: Inicializar la aplicación con la arquitectura MVC.
 * ============================================================================
 */

import { JumpController } from "./controllers/JumpController";

document.addEventListener("DOMContentLoaded", () => {
  // Instanciar el controlador principal de la aplicación
  new JumpController();
});
