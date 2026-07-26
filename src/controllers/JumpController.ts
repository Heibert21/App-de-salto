/**
 * ============================================================================
 * CONTROLADOR: JumpController.ts
 * Responsabilidad: Orquestar el flujo de la aplicación. Conecta el feed de
 * cámara, la visión por computadora (PoseModel), la matemática/estado (JumpModel),
 * el renderizado en canvas (CanvasView) y el DOM (UIView).
 * ============================================================================
 */

import { PoseModel } from "../models/PoseModel";
import { JumpModel } from "../models/JumpModel";
import { CanvasView } from "../views/CanvasView";
import { UIView } from "../views/UIView";

export class JumpController {
  private poseModel: PoseModel;
  private jumpModel: JumpModel;
  private canvasView: CanvasView;
  private uiView: UIView;

  private activeSource: 'camera' | 'video' | 'none' = 'none';
  private mediaStream: MediaStream | null = null;
  private currentObjectUrl: string | null = null;
  private animationFrameId: number | null = null;
  private lastLandmarks: any = null;
  private videoStopTimeout: number | null = null;
  // Cámara activa: 'user' (frontal) o 'environment' (trasera)
  private facingMode: 'user' | 'environment' = 'environment';

  // Optimizaciones de rendimiento móvil
  private lastInferenceMs: number = 0;
  private lastVideoWidth: number = 0;
  private lastVideoHeight: number = 0;
  // En móvil se limita a ~30fps para la inferencia de pose; en desktop se permite hasta 60fps
  private readonly INFERENCE_INTERVAL_MS: number = this.isMobile() ? 34 : 17;

  constructor() {
    this.uiView = new UIView();
    this.canvasView = new CanvasView(this.uiView.getCanvasElement(), this.isMobile());
    this.poseModel = new PoseModel();
    this.jumpModel = new JumpModel();

    // Escuchar cuando se completa un salto
    this.jumpModel.onJumpCompleted = (peakCm) => {
      if (this.activeSource === 'video') {
        console.log(`¡Salto medido exitosamente (${peakCm.toFixed(1)} cm)! Deteniendo y eliminando el video...`);
        
        // Esperar 2 segundos para permitir ver la animación del pico y luego eliminar el video
        if (this.videoStopTimeout) window.clearTimeout(this.videoStopTimeout);
        this.videoStopTimeout = window.setTimeout(() => {
          if (this.activeSource === 'video') {
            this.stopActiveSource();
          }
        }, 2000);
      }
    };

    this.init();
  }

  /**
   * Inicializa los componentes de la aplicación y escucha los eventos de la UI.
   */
  private async init(): Promise<void> {
    // Vincular eventos de usuario desde la Vista UI
    this.uiView.bindEvents({
      onToggleCamera: () => this.toggleCamera(),
      onFlipCamera: () => this.flipCamera(),
      onSelectVideoFile: (file) => this.loadVideoFile(file),
      onCalibrateBaseline: () => this.calibrateBaseline(),
      onResetRecord: () => this.resetRecord()
    });

    try {
      // Cargar modelos de MediaPipe Pose
      this.uiView.updateLoadingState(true, "Iniciando MediaPipe Pose (GPU)...");
      await this.poseModel.initialize((msg) => {
        this.uiView.updateLoadingState(true, msg);
      });
      this.uiView.updateLoadingState(false);
    } catch (error) {
      console.error("No se pudo cargar MediaPipe Pose:", error);
      this.uiView.updateLoadingState(true, "Error al cargar MediaPipe Pose. Verifica tu conexión a internet.");
    }

    // Pausar el bucle cuando el usuario cambia de pestaña o app (ahorra batería)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.animationFrameId !== null) {
          cancelAnimationFrame(this.animationFrameId);
          this.animationFrameId = null;
        }
      } else if (this.activeSource !== 'none') {
        // Reanudar el bucle al volver a la pestaña
        this.processLoop();
      }
    });
  }

  /**
   * Alterna la cámara web.
   */
  private async toggleCamera(): Promise<void> {
    if (this.activeSource === 'camera') {
      this.stopActiveSource();
    } else {
      await this.startCamera();
    }
  }

  /**
   * Cambia entre cámara frontal (user) y trasera (environment).
   */
  private async flipCamera(): Promise<void> {
    if (this.activeSource !== 'camera') return;
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    // Reiniciar la cámara con el nuevo facingMode
    await this.startCamera();
  }

  /**
   * Carga un archivo de video local seleccionado por el usuario.
   */
  private async loadVideoFile(file: File): Promise<void> {
    this.stopActiveSource();

    this.currentObjectUrl = URL.createObjectURL(file);
    const videoEl = this.uiView.getVideoElement();
    
    videoEl.srcObject = null;
    videoEl.src = this.currentObjectUrl;
    videoEl.loop = false; // Sin bucle: se reproduce una vez para calcular el salto
    videoEl.muted = true;

    // Al finalizar el video por completo, eliminar la fuente
    videoEl.onended = () => {
      if (this.activeSource === 'video') {
        console.log("Fin de la reproducción del video. Eliminando fuente de video...");
        this.stopActiveSource();
      }
    };

    this.uiView.setMirrorMode(false); // No usar espejo para videos subidos

    await new Promise<void>((resolve) => {
      videoEl.onloadedmetadata = () => {
        videoEl.play();
        resolve();
      };
    });

    this.activeSource = 'video';
    this.uiView.setSourceState('video', file.name);

    // Iniciar bucle de procesamiento de cuadros
    if (this.animationFrameId === null) {
      this.processLoop();
    }
  }

  /**
   * Activa el stream de video de la cámara web.
   */
  private async startCamera(): Promise<void> {
    this.stopActiveSource();

    try {
      // Resolución adaptada: menor en móvil para reducir carga de procesamiento
      const mobile = this.isMobile();
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: mobile ? 640 : 1280 },
          height: { ideal: mobile ? 480 : 720 },
          facingMode: this.facingMode // frontal o trasera
        },
        audio: false
      });

      const videoEl = this.uiView.getVideoElement();
      videoEl.src = "";
      videoEl.srcObject = this.mediaStream;
      videoEl.muted = true;

      // Solo aplicar espejo en cámara frontal (user)
      this.uiView.setMirrorMode(this.facingMode === 'user');

      await new Promise<void>((resolve) => {
        videoEl.onloadedmetadata = () => {
          videoEl.play();
          resolve();
        };
      });

      this.activeSource = 'camera';
      this.uiView.setSourceState('camera');
      this.uiView.setFlipButtonVisible(true); // Mostrar botón flip

      if (this.animationFrameId === null) {
        this.processLoop();
      }
    } catch (err) {
      console.error("Error al acceder a la cámara web:", err);
      alert("No se pudo acceder a la cámara. Por favor otorga los permisos necesarios.");
    }
  }

  /**
   * Detiene la fuente activa (cámara o video).
   */
  private stopActiveSource(): void {
    if (this.videoStopTimeout) {
      window.clearTimeout(this.videoStopTimeout);
      this.videoStopTimeout = null;
    }

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }

    const videoEl = this.uiView.getVideoElement();
    videoEl.pause();
    videoEl.srcObject = null;
    videoEl.src = "";

    this.activeSource = 'none';
    this.uiView.setSourceState('none');
    this.uiView.setFlipButtonVisible(false); // Ocultar botón flip
    this.canvasView.clear();
  }

  /**
   * Bucle de animación continuo (requestAnimationFrame)
   */
  private processLoop = (): void => {
    if (this.activeSource === 'none') return;

    const videoEl = this.uiView.getVideoElement();
    const nowMs = performance.now();

    if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
      // Solo redimensionar el canvas cuando cambian las dimensiones del video
      if (videoEl.videoWidth !== this.lastVideoWidth || videoEl.videoHeight !== this.lastVideoHeight) {
        this.canvasView.resize(videoEl.videoWidth, videoEl.videoHeight);
        this.lastVideoWidth = videoEl.videoWidth;
        this.lastVideoHeight = videoEl.videoHeight;
      }

      // 1. Detectar pose con MediaPipe — limitado a INFERENCE_INTERVAL_MS para ahorrar CPU/GPU
      const shouldInfer = (nowMs - this.lastInferenceMs) >= this.INFERENCE_INTERVAL_MS;
      if (shouldInfer) {
        this.lastInferenceMs = nowMs;
        const poseResult = this.poseModel.detectPose(videoEl, nowMs);

        if (poseResult && poseResult.landmarks && poseResult.landmarks.length > 0) {
          const landmarks = poseResult.landmarks[0];
          this.lastLandmarks = landmarks;

          // 2. Procesar lógica del salto en el JumpModel
          this.jumpModel.processFrame(landmarks, videoEl.videoHeight, nowMs);
        }
      }

      // 3. Renderizar siempre con los últimos landmarks conocidos (suave a 60fps)
      this.canvasView.render(
        this.lastLandmarks,
        this.jumpModel.getBaselineHipY(),
        this.jumpModel.getPeakHipY(),
        this.jumpModel.getCurrentJumpCm(),
        this.jumpModel.getCurrentState()
      );

      // 4. Actualizar métricas y estado en UIView
      this.uiView.updateMetrics(
        this.jumpModel.getCurrentJumpCm(),
        this.jumpModel.getMaxJumpCm(),
        this.jumpModel.getCurrentState(),
        this.jumpModel.getBaselineHipY(),
        this.jumpModel.getLastFlightTimeMs()
      );
    }

    // Solicitar siguiente frame
    this.animationFrameId = requestAnimationFrame(this.processLoop);
  };

  /**
   * Fuerza la recalibración de la posición del suelo (baseline).
   */
  private calibrateBaseline(): void {
    if (this.lastLandmarks) {
      const videoEl = this.uiView.getVideoElement();
      this.jumpModel.calibrateBaseline(this.lastLandmarks, videoEl.videoHeight);
    }
  }

  /**
   * Detecta si el dispositivo es un teléfono o tablet.
   */
  private isMobile(): boolean {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      ('ontouchstart' in window && navigator.maxTouchPoints > 1);
  }

  /**
   * Reinicia el récord de salto máximo.
   */
  private resetRecord(): void {
    this.jumpModel.resetRecord();
  }
}
