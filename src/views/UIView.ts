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

import { JumpState } from "../models/JumpModel";

export interface UIEventCallbacks {
  onSelectVideoFile: (file: File) => void;
  onResetRecord: () => void;
  onChangeUserHeight: (heightCm: number) => void;
  onShowRoutine?: () => void;
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

  private btnUploadVideo: HTMLButtonElement;
  private btnUploadVideoText: HTMLElement;
  private videoFileInput: HTMLInputElement;
  private btnResetRecord: HTMLButtonElement;

  private userHeightInput: HTMLInputElement;
  private autoHeightBadge: HTMLElement;
  private heightChips: HTMLButtonElement[];
  private videoElement: HTMLVideoElement;
  private canvasElement: HTMLCanvasElement;
  // Elementos de comparación y rutina en modal de pantalla completa
  private resultsModal: HTMLElement;
  private modalJumpVal: HTMLElement;
  private modalComparison: HTMLElement;
  private modalPrevVal: HTMLElement;
  private modalDiffBadge: HTMLElement;
  private modalDiffVal: HTMLElement;
  private modalFeedback: HTMLElement;
  private modalRoutineLevel: HTMLElement;
  private modalRoutineDesc: HTMLElement;
  private modalRoutineExercises: HTMLElement;
  private btnCloseModal: HTMLElement;
  private btnModalDismiss: HTMLElement;
  private btnShowRoutine: HTMLButtonElement;



  // Elementos de señal y toasts
  private signalBars: HTMLElement[];
  private signalLabel: HTMLElement;
  private toastContainer: HTMLElement;
  private confettiEffect: ConfettiEffect;
  private emptyState: HTMLElement | null;
  private athleteLevelBadge: HTMLElement | null;
  private levelProgressBar: HTMLElement | null;
  private levelProgressLabel: HTMLElement | null;

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

    this.btnUploadVideo = this.getElement("btn-upload-video") as HTMLButtonElement;
    this.btnUploadVideoText = this.getElement("btn-upload-video-text");
    this.videoFileInput = this.getElement("video-file-input") as HTMLInputElement;

    this.btnResetRecord = this.getElement("btn-reset-record") as HTMLButtonElement;

    this.userHeightInput = this.getElement("user-height-input") as HTMLInputElement;
    this.autoHeightBadge = this.getElement("auto-height-badge");
    this.heightChips = Array.from(document.querySelectorAll<HTMLButtonElement>("#mobile-height-chips .chip-btn"));

    this.videoElement = this.getElement("video-player") as HTMLVideoElement;
    this.canvasElement = this.getElement("output-canvas") as HTMLCanvasElement;

    // Indicador de calidad de señal
    this.signalBars = [
      this.getElement("signal-bar-1"),
      this.getElement("signal-bar-2"),
      this.getElement("signal-bar-3")
    ];
    this.signalLabel = this.getElement("signal-label");
    this.toastContainer = this.getElement("toast-container");

    // Elementos de comparación y rutina en modal de pantalla completa
    this.resultsModal = this.getElement("results-modal");
    this.modalJumpVal = this.getElement("modal-jump-val");
    this.modalComparison = this.getElement("modal-comparison");
    this.modalPrevVal = this.getElement("modal-prev-val");
    this.modalDiffBadge = this.getElement("modal-diff-badge");
    this.modalDiffVal = this.getElement("modal-diff-val");
    this.modalFeedback = this.getElement("modal-feedback");
    this.modalRoutineLevel = this.getElement("modal-routine-level");
    this.modalRoutineDesc = this.getElement("modal-routine-desc");
    this.modalRoutineExercises = this.getElement("modal-routine-exercises");
    this.btnCloseModal = this.getElement("btn-close-modal");
    this.btnModalDismiss = this.getElement("btn-modal-dismiss");
    this.btnShowRoutine = this.getElement("btn-show-routine") as HTMLButtonElement;



    // Configurar cierres nativos del modal
    const closeModal = () => {
      this.resultsModal.style.display = "none";
    };
    this.btnCloseModal.addEventListener("click", closeModal);
    this.btnModalDismiss.addEventListener("click", closeModal);

    const confettiCanvas = this.getElement("confetti-canvas") as HTMLCanvasElement;
    this.confettiEffect = new ConfettiEffect(confettiCanvas);

    // Elementos opcionales (nuevas mejoras de diseño)
    this.emptyState = document.getElementById('empty-state');
    this.athleteLevelBadge = document.getElementById('athlete-level-badge');
    this.levelProgressBar = document.getElementById('level-progress-bar');
    this.levelProgressLabel = document.getElementById('level-progress-label');
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

  public setInitialValues(userHeightCm: number): void {
    this.userHeightInput.value = String(userHeightCm);
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
   * Vincula los controladores de eventos de usuario a los callbacks.
   */
  public bindEvents(callbacks: UIEventCallbacks): void {

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

    this.btnShowRoutine.addEventListener("click", () => {
      if (callbacks.onShowRoutine) {
        callbacks.onShowRoutine();
      }
    });
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
    this.confettiEffect.start();
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
   * Actualiza la interfaz según la fuente activa (Video vs Inactivo)
   */
  public setSourceState(mode: 'video' | 'none', fileName?: string): void {
    // Resetear el toast de "Listo" al cambiar fuente
    this.readyToastShown = false;
    this.lastAvgVisibility = 0;
    this.lastSignalLevel = -1;

    // Mostrar u ocultar el estado vacío del canvas
    const canvasWrapper = this.canvasElement?.closest('.canvas-wrapper');
    if (canvasWrapper) {
      if (mode === 'video') {
        canvasWrapper.classList.add('has-video');
      } else {
        canvasWrapper.classList.remove('has-video');
      }
    }

    if (mode === 'video') {
      this.btnUploadVideoText.textContent = fileName ? `Video: ${fileName.substring(0, 10)}...` : "Cambiar Video";
      this.btnUploadVideo.classList.remove("btn-secondary");
      this.btnUploadVideo.classList.add("btn-primary");

      this.btnResetRecord.disabled = false;
    } else {
      this.btnUploadVideoText.textContent = "Subir Video";
      this.btnUploadVideo.classList.remove("btn-secondary");
      this.btnUploadVideo.classList.add("btn-primary");

      this.btnResetRecord.disabled = true;

      // Resetear indicador de señal
      this.signalBars.forEach(bar => { bar.className = "signal-bar"; });
      this.signalLabel.textContent = "—";
    }
  }

  /**
   * Actualiza el progreso comparativo y la recomendación de rutina de entrenamiento en un modal full-screen.
   */
  public updateRoutineAndProgress(currentJump: number, lastJump: number | null): void {
    // Mostrar modal
    this.resultsModal.style.display = "flex";

    // Contador animado: sube de 0 al valor real en ~800ms
    const targetVal = currentJump;
    const duration = 900;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Easing out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      this.modalJumpVal.textContent = (targetVal * eased).toFixed(1);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);

    // Actualizar badge de nivel dinámico en la tarjeta de Récord
    this.updateLevelBadgeAndProgress(currentJump);

    // 1. Mostrar comparación si existe salto anterior
    if (lastJump !== null && lastJump > 0) {
      this.modalComparison.style.display = "flex";
      this.modalPrevVal.textContent = `${lastJump.toFixed(1)} cm`;
      
      const diff = currentJump - lastJump;
      const diffStr = diff >= 0 ? `+${diff.toFixed(1)} cm` : `${diff.toFixed(1)} cm`;
      this.modalDiffVal.textContent = diffStr;

      if (diff > 0) {
        this.modalDiffBadge.className = "comp-diff-badge positive";
        this.modalFeedback.textContent = "¡Excelente progreso! Tu entrenamiento y consistencia están dando frutos. ¡Sigue así! 🚀";
      } else if (diff < 0) {
        this.modalDiffBadge.className = "comp-diff-badge negative";
        this.modalFeedback.textContent = "El salto ha sido ligeramente menor. Asegúrate de descansar bien (48-72h), nutrirte y entrenar la fuerza. 💤";
      } else {
        this.modalDiffBadge.className = "comp-diff-badge neutral";
        this.modalFeedback.textContent = "Has mantenido tu mismo nivel. ¡Intenta aumentar la intensidad o la explosividad de tus ejercicios! 🔥";
      }
    } else {
      this.modalComparison.style.display = "none";
    }

    // 2. Generar rutina basada en el nivel del salto actual
    let title = "";
    let levelClass = "";
    let exercises: string[] = [];

    if (currentJump < 30) {
      title = "Principiante (Fuerza Base)";
      levelClass = "routine-level-badge beginner";
      exercises = [
        "Sentadillas con salto explosivo - 3 series x 8 repeticiones",
        "Saltos de tobillo rápidos (rebotes continuos) - 3 series x 15 segundos",
        "Puentes de glúteo a una pierna - 3 series x 10 repeticiones por pierna",
        "Saltos a cajón bajo - 3 series x 6 repeticiones (foco en caída suave)"
      ];
    } else if (currentJump >= 30 && currentJump <= 45) {
      title = "Intermedio (Fuerza Explosiva)";
      levelClass = "routine-level-badge intermediate";
      exercises = [
        "Saltos desde caída (dejarse caer desde 30cm y saltar inmediatamente hacia arriba) - 3 series x 5 repeticiones",
        "Saltos horizontales explosivos continuos - 3 series x 6 repeticiones",
        "Saltos agrupados con rodillas al pecho - 3 series x 8 repeticiones",
        "Zancadas alternas explosivas con salto - 3 series x 10 repeticiones"
      ];
    } else if (currentJump > 45 && currentJump <= 65) {
      title = "Avanzado (Reactividad Pliométrica)";
      levelClass = "routine-level-badge advanced";
      exercises = [
        "Saltos desde caída alta (desde 45cm) con salto vertical máximo reactivo - 4 series x 4 repeticiones",
        "Saltos verticales a una pierna (foco en altura máxima) - 3 series x 5 repeticiones por pierna",
        "Saltos con contramovimiento resistidos (usando banda elástica o peso ligero) - 4 series x 5 repeticiones",
        "Saltos de tobillo reactivos rápidos sobre mini vallas - 3 series x 20 segundos"
      ];
    } else {
      title = "Élite (Pliometría Extrema y Potencia)";
      levelClass = "routine-level-badge elite";
      exercises = [
        "Saltos desde caída extrema (desde 60cm) con rebote vertical instantáneo - 4 series x 3 repeticiones",
        "Saltos verticales a una pierna asistidos (con banda para mayor aceleración) - 3 series x 6 repeticiones",
        "Saltos con contramovimiento cargados (mancuerna o barra ligera) - 4 series x 4 repeticiones",
        "Saltos de tobillo reactivos sobre obstáculos altos a un pie - 3 series x 15 segundos"
      ];
    }

    this.modalRoutineDesc.textContent = `A continuación, te sugerimos esta rutina personalizada para tu nivel de potencia:`;
    this.modalRoutineLevel.textContent = title;
    this.modalRoutineLevel.className = levelClass;
    
    this.modalRoutineExercises.innerHTML = "";
    exercises.forEach(ex => {
      const li = document.createElement("li");
      li.textContent = ex;
      this.modalRoutineExercises.appendChild(li);
    });
  }

  /**
   * Actualiza el badge de nivel del atleta y la barra de progreso al siguiente nivel.
   */
  private updateLevelBadgeAndProgress(jumpCm: number): void {
    if (!this.athleteLevelBadge || !this.levelProgressBar || !this.levelProgressLabel) return;

    const levels = [
      { label: 'Principiante', cls: 'beginner',     min: 0,  max: 30  },
      { label: 'Intermedio',   cls: 'intermediate', min: 30, max: 45  },
      { label: 'Avanzado',     cls: 'advanced',     min: 45, max: 65  },
      { label: 'Élite',        cls: 'elite',        min: 65, max: 100 },
    ];

    const currentLevel = levels.find((l, i) =>
      jumpCm < l.max || i === levels.length - 1
    )!;

    // Badge
    this.athleteLevelBadge.textContent = currentLevel.label;
    this.athleteLevelBadge.className = `athlete-level-badge ${currentLevel.cls}`;

    // Progress bar
    const progress = Math.min(
      ((jumpCm - currentLevel.min) / (currentLevel.max - currentLevel.min)) * 100,
      100
    );
    this.levelProgressBar.style.width = `${progress.toFixed(0)}%`;

    if (currentLevel.cls === 'elite') {
      this.levelProgressLabel.textContent = `¡Nivel élite alcanzado! 👑`;
    } else {
      const nextLevel = levels[levels.indexOf(currentLevel) + 1];
      const remaining = (currentLevel.max - jumpCm).toFixed(1);
      this.levelProgressLabel.textContent = `${remaining} cm para ${nextLevel.label}`;
    }
  }
}

class ConfettiEffect {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Array<{
    x: number;
    y: number;
    size: number;
    color: string;
    speedX: number;
    speedY: number;
    rotation: number;
    rotationSpeed: number;
  }> = [];
  private active: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  public start() {
    this.canvas.style.display = "block";
    this.active = true;
    this.particles = [];
    const colors = ["#ff007f", "#00f2fe", "#4facfe", "#f9d423", "#ff4e50", "#f9d423", "#70e1f5"];
    
    for (let i = 0; i < 150; i++) {
      const fromLeft = Math.random() > 0.5;
      this.particles.push({
        x: fromLeft ? 0 : this.canvas.width,
        y: this.canvas.height * 0.8,
        size: Math.random() * 8 + 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        speedX: (fromLeft ? 1 : -1) * (Math.random() * 15 + 10),
        speedY: -(Math.random() * 20 + 15),
        rotation: Math.random() * 360,
        rotationSpeed: Math.random() * 10 - 5
      });
    }

    this.animate();
    setTimeout(() => {
      this.active = false;
      this.canvas.style.display = "none";
    }, 4000);
  }

  private animate() {
    if (!this.active) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    let activeParticles = 0;

    this.particles.forEach((p) => {
      this.ctx.save();
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate((p.rotation * Math.PI) / 180);
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      this.ctx.restore();

      p.x += p.speedX;
      p.y += p.speedY;
      p.speedY += 0.5;
      p.speedX *= 0.98;
      p.rotation += p.rotationSpeed;

      if (p.y < this.canvas.height) {
        activeParticles++;
      }
    });

    if (activeParticles > 0 && this.active) {
      requestAnimationFrame(() => this.animate());
    }
  }
}
