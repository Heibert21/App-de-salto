/**
 * ============================================================================
 * VISTA: UIView.ts
 * Responsabilidad: Manejo y actualización de elementos del DOM de la interfaz,
 * superposición de métricas (cm en vivo), insignias de estado y controles.
 * ============================================================================
 */

import { JumpState } from "../models/JumpModel";

export interface UIEventCallbacks {
  onToggleCamera: () => void;
  onFlipCamera: () => void;
  onSelectVideoFile: (file: File) => void;
  onCalibrateBaseline: () => void;
  onResetRecord: () => void;
}

export class UIView {
  // Elementos HTML
  private liveHeightVal: HTMLElement;
  private maxJumpVal: HTMLElement;
  private jumpStateBadge: HTMLElement;
  private jumpStateText: HTMLElement;
  private flightTimeText: HTMLElement;
  private baselineYText: HTMLElement;
  private lastJumpTimeText: HTMLElement;

  private loadingOverlay: HTMLElement;
  private loadingText: HTMLElement;

  private btnToggleCam: HTMLButtonElement;
  private btnToggleCamText: HTMLElement;
  private btnUploadVideo: HTMLButtonElement;
  private btnUploadVideoText: HTMLElement;
  private videoFileInput: HTMLInputElement;
  private btnCalibrate: HTMLButtonElement;
  private btnResetRecord: HTMLButtonElement;
  private btnFlipCam: HTMLButtonElement;

  private videoElement: HTMLVideoElement;
  private canvasElement: HTMLCanvasElement;

  constructor() {
    // Obtener referencias de elementos del DOM
    this.liveHeightVal = this.getElement("live-height-val");
    this.maxJumpVal = this.getElement("max-jump-val");
    this.jumpStateBadge = this.getElement("jump-state-badge");
    this.jumpStateText = this.getElement("jump-state-text");
    this.flightTimeText = this.getElement("flight-time-text");
    this.baselineYText = this.getElement("baseline-y-text");
    this.lastJumpTimeText = this.getElement("last-jump-time");

    this.loadingOverlay = this.getElement("loading-overlay");
    this.loadingText = this.getElement("loading-text");

    this.btnToggleCam = this.getElement("btn-toggle-cam") as HTMLButtonElement;
    this.btnToggleCamText = this.getElement("btn-toggle-cam-text");
    
    this.btnUploadVideo = this.getElement("btn-upload-video") as HTMLButtonElement;
    this.btnUploadVideoText = this.getElement("btn-upload-video-text");
    this.videoFileInput = this.getElement("video-file-input") as HTMLInputElement;

    this.btnCalibrate = this.getElement("btn-calibrate") as HTMLButtonElement;
    this.btnResetRecord = this.getElement("btn-reset-record") as HTMLButtonElement;
    this.btnFlipCam = this.getElement("btn-flip-cam") as HTMLButtonElement;

    this.videoElement = this.getElement("webcam") as HTMLVideoElement;
    this.canvasElement = this.getElement("output-canvas") as HTMLCanvasElement;
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

    this.btnCalibrate.addEventListener("click", () => callbacks.onCalibrateBaseline());
    this.btnResetRecord.addEventListener("click", () => callbacks.onResetRecord());
    this.btnFlipCam.addEventListener("click", () => callbacks.onFlipCamera());
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
    baselineY: number | null,
    flightTimeMs: number
  ): void {
    // 1. Altura en tiempo real
    this.liveHeightVal.textContent = currentJumpCm.toFixed(1);

    // 2. Récord máximo
    this.maxJumpVal.textContent = maxJumpCm.toFixed(1);

    // 3. Insignia de estado
    this.updateStateBadge(state);

    // 4. Tiempo de vuelo actual
    if (flightTimeMs > 0) {
      this.flightTimeText.textContent = `${(flightTimeMs / 1000).toFixed(2)} s`;
      this.lastJumpTimeText.textContent = `Último vuelo: ${(flightTimeMs / 1000).toFixed(2)}s`;
    }

    // 5. Baseline
    this.baselineYText.textContent = baselineY !== null ? `${Math.round(baselineY)} px` : "-- px";
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
    if (mode === 'camera') {
      this.btnToggleCamText.textContent = "Detener Cámara";
      this.btnToggleCam.classList.remove("btn-primary");
      this.btnToggleCam.classList.add("btn-danger");

      this.btnUploadVideoText.textContent = "Subir Video";
      this.btnUploadVideo.classList.remove("btn-primary");
      this.btnUploadVideo.classList.add("btn-secondary");

      this.btnCalibrate.disabled = false;
      this.btnResetRecord.disabled = false;
    } else if (mode === 'video') {
      this.btnToggleCamText.textContent = "Usar Cámara";
      this.btnToggleCam.classList.remove("btn-danger");
      this.btnToggleCam.classList.add("btn-secondary");

      this.btnUploadVideoText.textContent = fileName ? `Video: ${fileName.substring(0, 10)}...` : "Cambiar Video";
      this.btnUploadVideo.classList.remove("btn-secondary");
      this.btnUploadVideo.classList.add("btn-primary");

      this.btnCalibrate.disabled = false;
      this.btnResetRecord.disabled = false;
    } else {
      this.btnToggleCamText.textContent = "Iniciar Cámara";
      this.btnToggleCam.classList.remove("btn-danger");
      this.btnToggleCam.classList.add("btn-primary");

      this.btnUploadVideoText.textContent = "Subir Video";
      this.btnUploadVideo.classList.remove("btn-primary");
      this.btnUploadVideo.classList.add("btn-secondary");

      this.btnCalibrate.disabled = true;
      this.btnResetRecord.disabled = true;
    }
  }
}
