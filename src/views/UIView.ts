/**
 * ============================================================================
 * VISTA: UIView.ts
 * Responsabilidad: Manejo y actualización de elementos del DOM de la interfaz,
 * superposición de métricas (cm en vivo), insignias de estado y controles.
 *
 * Mejoras v2:
 *  - Sistema de toasts apilables (showToast) con tipos success/warning/info.
 *  - Indicador de calidad de señal de pose (3 barras: Mala/Regular/Buena).
 *  - Toast automático de "¡Listo para saltar!" al detectar buena pose por primera vez.
 * ============================================================================
 */

import { JumpState, MeasurementMode } from "../models/JumpModel";

export interface UIEventCallbacks {
  onToggleCamera: () => void;
  onFlipCamera: () => void;
  onSelectVideoFile: (file: File) => void;
  onResetRecord: () => void;
  onRecalibrateBaseline: () => void;
  onChangeUserHeight: (heightCm: number) => void;
  onChangeMeasurementMode: (mode: MeasurementMode) => void;
}

export class UIView {
  // Elementos HTML
  private liveHeightVal: HTMLElement;
  private maxJumpVal: HTMLElement;
  private jumpStateBadge: HTMLElement;
  private jumpStateText: HTMLElement;
  private flightTimeText: HTMLElement;
  private displacementText: HTMLElement;
  private baselineStatusText: HTMLElement;
  private lastJumpTimeText: HTMLElement;

  private loadingOverlay: HTMLElement;
  private loadingText: HTMLElement;

  private btnToggleCam: HTMLButtonElement;
  private btnToggleCamText: HTMLElement;
  private btnUploadVideo: HTMLButtonElement;
  private btnUploadVideoText: HTMLElement;
  private videoFileInput: HTMLInputElement;
  private btnResetRecord: HTMLButtonElement;
  private btnRecalibrate: HTMLButtonElement;
  private btnFlipCam: HTMLButtonElement;

  private userHeightInput: HTMLInputElement;
  private measurementModeSelect: HTMLSelectElement;
  private autoHeightBadge: HTMLElement;
  private heightChips: HTMLButtonElement[];

  private videoElement: HTMLVideoElement;
  private canvasElement: HTMLCanvasElement;

  // Elementos de señal y toasts
  private signalBars: HTMLElement[];
  private signalLabel: HTMLElement;
  private toastContainer: HTMLElement;

  // Cache de últimos valores para evitar escrituras redundantes al DOM (60fps)
  private lastLiveHeight: string = '';
  private lastMaxJump: string = '';
  private lastState: string = '';
  private lastBaselineStatus: string = '';
  private lastSignalLevel: number = -1;

  // Estado de notificación "Listo para saltar"
  private readyToastShown: boolean = false;
  private lastAvgVisibility: number = 0;

  constructor() {
    // Obtener referencias de elementos del DOM
    this.liveHeightVal = this.getElement("live-height-val");
    this.maxJumpVal = this.getElement("max-jump-val");
    this.jumpStateBadge = this.getElement("jump-state-badge");
    this.jumpStateText = this.getElement("jump-state-text");
    this.flightTimeText = this.getElement("flight-time-text");
    this.displacementText = this.getElement("displacement-text");
    this.baselineStatusText = this.getElement("baseline-status-text");
    this.lastJumpTimeText = this.getElement("last-jump-time");

    this.loadingOverlay = this.getElement("loading-overlay");
    this.loadingText = this.getElement("loading-text");

    this.btnToggleCam = this.getElement("btn-toggle-cam") as HTMLButtonElement;
    this.btnToggleCamText = this.getElement("btn-toggle-cam-text");

    this.btnUploadVideo = this.getElement("btn-upload-video") as HTMLButtonElement;
    this.btnUploadVideoText = this.getElement("btn-upload-video-text");
    this.videoFileInput = this.getElement("video-file-input") as HTMLInputElement;

    this.btnResetRecord = this.getElement("btn-reset-record") as HTMLButtonElement;
    this.btnRecalibrate = this.getElement("btn-recalibrate") as HTMLButtonElement;
    this.btnFlipCam = this.getElement("btn-flip-cam") as HTMLButtonElement;

    this.userHeightInput = this.getElement("user-height-input") as HTMLInputElement;
    this.measurementModeSelect = this.getElement("measurement-mode-select") as HTMLSelectElement;
    this.autoHeightBadge = this.getElement("auto-height-badge");
    this.heightChips = Array.from(document.querySelectorAll<HTMLButtonElement>("#mobile-height-chips .chip-btn"));

    this.videoElement = this.getElement("webcam") as HTMLVideoElement;
    this.canvasElement = this.getElement("output-canvas") as HTMLCanvasElement;

    // Indicador de calidad de señal
    this.signalBars = [
      this.getElement("signal-bar-1"),
      this.getElement("signal-bar-2"),
      this.getElement("signal-bar-3")
    ];
    this.signalLabel = this.getElement("signal-label");
    this.toastContainer = this.getElement("toast-container");
  }

  private getElement(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) {
      throw new Error(`Elemento no encontrado en el DOM: #${id}`);
    }
    return el;
  }

  public getVideoElement(): HTMLVideoElement {
    return this.videoElement;
  }

  public getCanvasElement(): HTMLCanvasElement {
    return this.canvasElement;
  }

  public setInitialValues(userHeightCm: number, mode: MeasurementMode): void {
    this.userHeightInput.value = String(userHeightCm);
    this.measurementModeSelect.value = mode;
    this.highlightActiveChip(userHeightCm);
  }

  /**
   * Actualiza el valor de estatura en la interfaz (ej. cuando la IA la estima automáticamente o se cambia por chip)
   */
  public updateUserHeightInput(heightCm: number, isAutoEstimated: boolean = true): void {
    this.userHeightInput.value = String(heightCm);
    this.highlightActiveChip(heightCm);
    this.setAutoHeightBadgeVisible(isAutoEstimated);
  }

  /**
   * Resalta el chip de estatura correspondiente al valor actual
   */
  public highlightActiveChip(heightCm: number): void {
    this.heightChips.forEach((chip) => {
      const h = parseFloat(chip.getAttribute("data-height") ?? "0");
      if (Math.abs(h - heightCm) <= 4) {
        chip.classList.add("active");
      } else {
        chip.classList.remove("active");
      }
    });
  }

  /**
   * Muestra u oculta el badge indicador "Estimado por IA"
   */
  public setAutoHeightBadgeVisible(visible: boolean): void {
    if (this.autoHeightBadge) {
      this.autoHeightBadge.style.display = visible ? "inline-block" : "none";
    }
  }

  /**
   * Configura el modo espejo (Mirror) para la cámara web, desactivándolo para archivos de video.
   */
  public setMirrorMode(enable: boolean): void {
    if (enable) {
      this.videoElement.classList.add("mirror");
      this.canvasElement.classList.add("mirror");
    } else {
      this.videoElement.classList.remove("mirror");
      this.canvasElement.classList.remove("mirror");
    }
  }

  /**
   * Vincula los controladores de eventos de usuario a los callbacks.
   */
  public bindEvents(callbacks: UIEventCallbacks): void {
    this.btnToggleCam.addEventListener("click", () => callbacks.onToggleCamera());

    // Botón de subir video -> abre el explorador de archivos
    this.btnUploadVideo.addEventListener("click", () => {
      this.videoFileInput.value = ""; // reset
      this.videoFileInput.click();
    });

    this.videoFileInput.addEventListener("change", () => {
      const files = this.videoFileInput.files;
      if (files && files.length > 0) {
        callbacks.onSelectVideoFile(files[0]);
      }
    });

    this.btnResetRecord.addEventListener("click", () => callbacks.onResetRecord());
    this.btnRecalibrate.addEventListener("click", () => callbacks.onRecalibrateBaseline());
    this.btnFlipCam.addEventListener("click", () => callbacks.onFlipCamera());

    // Eventos para chips táctiles de estatura (1-Tap para móvil)
    this.heightChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const val = parseFloat(chip.getAttribute("data-height") ?? "172");
        this.userHeightInput.value = String(val);
        this.highlightActiveChip(val);
        this.setAutoHeightBadgeVisible(false); // Selección manual desactiva badge de IA
        callbacks.onChangeUserHeight(val);
      });
    });

    this.userHeightInput.addEventListener("change", () => {
      const val = parseFloat(this.userHeightInput.value);
      if (!isNaN(val) && val >= 120 && val <= 230) {
        this.highlightActiveChip(val);
        this.setAutoHeightBadgeVisible(false); // Ajuste manual desactiva badge de IA
        callbacks.onChangeUserHeight(val);
      }
    });

    this.measurementModeSelect.addEventListener("change", () => {
      const mode = this.measurementModeSelect.value as MeasurementMode;
      callbacks.onChangeMeasurementMode(mode);
    });
  }

  /**
   * Muestra u oculta el botón de cambio de cámara (solo cuando la cámara está activa)
   */
  public setFlipButtonVisible(visible: boolean): void {
    this.btnFlipCam.style.display = visible ? "flex" : "none";
  }

  /**
   * Actualiza el texto de carga de MediaPipe
   */
  public updateLoadingState(isLoading: boolean, message: string = ""): void {
    if (isLoading) {
      this.loadingOverlay.style.opacity = "1";
      this.loadingOverlay.style.pointerEvents = "all";
      if (message) this.loadingText.textContent = message;
    } else {
      this.loadingOverlay.style.opacity = "0";
      this.loadingOverlay.style.pointerEvents = "none";
    }
  }

  /**
   * Actualiza las lecturas de salto en la interfaz
   */
  public updateMetrics(
    currentJumpCm: number,
    maxJumpCm: number,
    state: JumpState,
    isBaselineLocked: boolean,
    flightTimeMs: number,
    displacementCm: number = 0,
    avgVisibility: number = 0
  ): void {
    // 1. Altura en tiempo real (solo actualizar si cambia)
    const liveStr = currentJumpCm.toFixed(1);
    if (liveStr !== this.lastLiveHeight) {
      this.liveHeightVal.textContent = liveStr;
      this.lastLiveHeight = liveStr;
    }

    // 2. Récord máximo (solo actualizar si cambia)
    const maxStr = maxJumpCm.toFixed(1);
    if (maxStr !== this.lastMaxJump) {
      this.maxJumpVal.textContent = maxStr;
      this.lastMaxJump = maxStr;
    }

    // 3. Insignia de estado (solo actualizar si cambia)
    if (state !== this.lastState) {
      this.updateStateBadge(state);
      this.lastState = state;
    }

    // 4. Tiempo de vuelo actual
    if (flightTimeMs > 0) {
      this.flightTimeText.textContent = `${(flightTimeMs / 1000).toFixed(2)} s`;
      this.lastJumpTimeText.textContent = `Último vuelo: ${(flightTimeMs / 1000).toFixed(2)}s`;
    }

    // 5. Desplazamiento
    if (displacementCm > 0) {
      this.displacementText.textContent = `${displacementCm.toFixed(1)} cm`;
    }

    // 6. Estado Baseline Suelo
    const baselineStatusStr = isBaselineLocked ? '🔒 Fijado' : '⏳ Calibrando';
    if (baselineStatusStr !== this.lastBaselineStatus) {
      this.baselineStatusText.textContent = baselineStatusStr;
      this.baselineStatusText.className = isBaselineLocked ? 'status-locked' : 'status-calibrating';
      this.lastBaselineStatus = baselineStatusStr;
    }

    // 7. Indicador de calidad de señal
    this.updateSignalQuality(avgVisibility, state);

    // 8. Toast "Listo para saltar" cuando la señal pasa de mala a buena por primera vez
    if (!this.readyToastShown && this.lastAvgVisibility < 0.5 && avgVisibility >= 0.7) {
      this.showToast("🎯 ¡Listo para saltar!", 'success', 3000);
      this.readyToastShown = true;
    }
    // Resetear si la señal cae por debajo de 0.4 para permitir re-notificación
    if (avgVisibility < 0.4) {
      this.readyToastShown = false;
    }

    this.lastAvgVisibility = avgVisibility;
  }

  /**
   * Actualiza el indicador visual de calidad de señal de pose.
   * Niveles: 0 = Mala (<0.4), 1 = Regular (0.4-0.7), 2 = Buena (>0.7)
   */
  public updateSignalQuality(avgVisibility: number, _state: JumpState = 'IDLE'): void {
    let level: number;
    let label: string;
    let colorClass: string;

    if (avgVisibility >= 0.7) {
      level = 3; // Buena
      label = "Buena";
      colorClass = "signal-good";
    } else if (avgVisibility >= 0.4) {
      level = 2; // Regular
      label = "Regular";
      colorClass = "signal-medium";
    } else {
      level = 1; // Mala
      label = "Mala";
      colorClass = "signal-bad";
    }

    // Solo actualizar DOM si el nivel cambió
    if (level !== this.lastSignalLevel) {
      this.lastSignalLevel = level;

      // Actualizar barras
      this.signalBars.forEach((bar, idx) => {
        bar.className = "signal-bar";
        if (idx < level) {
          bar.classList.add(colorClass, "signal-bar-active");
        }
      });

      // Actualizar etiqueta
      this.signalLabel.textContent = label;
      this.signalLabel.className = "signal-text " + colorClass;
    }
  }

  /**
   * Dispara una animación visual de celebración cuando el usuario bate su récord personal.
   */
  public triggerRecordCelebration(peakCm: number): void {
    const recordCard = this.maxJumpVal.closest('.card');
    if (recordCard) {
      recordCard.classList.remove('record-celebration');
      // Forzar reflow para reiniciar la animación si se bate récord varias veces
      void (recordCard as HTMLElement).offsetHeight;
      recordCard.classList.add('record-celebration');

      setTimeout(() => {
        recordCard.classList.remove('record-celebration');
      }, 3500);
    }

    this.maxJumpVal.classList.remove('celebrate-text');
    void this.maxJumpVal.offsetHeight;
    this.maxJumpVal.classList.add('celebrate-text');
    setTimeout(() => {
      this.maxJumpVal.classList.remove('celebrate-text');
    }, 1500);

    this.showToast(`🏆 ¡NUEVO RÉCORD! ${peakCm.toFixed(1)} cm`, 'success', 4000);
  }

  /**
   * Muestra un toast flotante con mensaje y tipo.
   * Máximo 3 toasts simultáneos (el más antiguo se descarta si se supera el límite).
   */
  public showToast(message: string, type: 'success' | 'warning' | 'info', durationMs: number = 3000): void {
    // Limitar a 3 toasts simultáneos
    const existingToasts = this.toastContainer.querySelectorAll('.toast');
    if (existingToasts.length >= 3) {
      existingToasts[0].remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    this.toastContainer.appendChild(toast);

    // Forzar reflow para que la animación de entrada funcione
    void toast.offsetHeight;
    toast.classList.add('toast-visible');

    // Auto-eliminar tras la duración
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      toast.classList.add('toast-hiding');
      setTimeout(() => toast.remove(), 400);
    }, durationMs);
  }

  /**
   * Cambia el diseño visual de la insignia de estado del salto
   */
  private updateStateBadge(state: JumpState): void {
    this.jumpStateBadge.className = "state-badge";

    switch (state) {
      case "IDLE":
        this.jumpStateBadge.classList.add("state-idle");
        this.jumpStateText.textContent = "Reposo / En suelo";
        break;
      case "PREPARING":
        this.jumpStateBadge.classList.add("state-preparing");
        this.jumpStateText.textContent = "Flexionando / Preparando";
        break;
      case "IN_AIR":
        this.jumpStateBadge.classList.add("state-in-air");
        this.jumpStateText.textContent = "¡EN EL AIRE!";
        break;
      case "LANDED":
        this.jumpStateBadge.classList.add("state-landed");
        this.jumpStateText.textContent = "¡Aterrizaje Registrado!";
        break;
    }
  }

  /**
   * Actualiza la interfaz según la fuente activa (Cámara vs Video vs Inactivo)
   */
  public setSourceState(mode: 'camera' | 'video' | 'none', fileName?: string): void {
    // Resetear el toast de "Listo" al cambiar fuente
    this.readyToastShown = false;
    this.lastAvgVisibility = 0;
    this.lastSignalLevel = -1;

    if (mode === 'camera') {
      this.btnToggleCamText.textContent = "Detener Cámara";
      this.btnToggleCam.classList.remove("btn-primary");
      this.btnToggleCam.classList.add("btn-danger");

      this.btnUploadVideoText.textContent = "Subir Video";
      this.btnUploadVideo.classList.remove("btn-primary");
      this.btnUploadVideo.classList.add("btn-secondary");

      this.btnResetRecord.disabled = false;
    } else if (mode === 'video') {
      this.btnToggleCamText.textContent = "Usar Cámara";
      this.btnToggleCam.classList.remove("btn-danger");
      this.btnToggleCam.classList.add("btn-secondary");

      this.btnUploadVideoText.textContent = fileName ? `Video: ${fileName.substring(0, 10)}...` : "Cambiar Video";
      this.btnUploadVideo.classList.remove("btn-secondary");
      this.btnUploadVideo.classList.add("btn-primary");

      this.btnResetRecord.disabled = false;
    } else {
      this.btnToggleCamText.textContent = "Iniciar Cámara";
      this.btnToggleCam.classList.remove("btn-danger");
      this.btnToggleCam.classList.add("btn-primary");

      this.btnUploadVideoText.textContent = "Subir Video";
      this.btnUploadVideo.classList.remove("btn-primary");
      this.btnUploadVideo.classList.add("btn-secondary");

      this.btnResetRecord.disabled = true;

      // Resetear indicador de señal
      this.signalBars.forEach(bar => { bar.className = "signal-bar"; });
      this.signalLabel.textContent = "—";
      this.signalLabel.className = "signal-text";
    }
  }
}
