/**
 * ============================================================================
 * CONTROLADOR: JumpController.ts
 * Responsabilidad: Orquestar el flujo de la aplicación. Conecta el feed de
 * video, la visión por computadora (PoseModel), la matemática/estado (JumpModel),
 * el renderizado en canvas (CanvasView) y el DOM (UIView).
 *
 * Mejoras v2:
 *  - Constraints de video mejoradas: mayor resolución en móvil portrait + frameRate ideal 30.
 *  - Modelo `full` activado automáticamente en desktop para mayor precisión.
 *  - Detección y manejo de cambios de orientación (portrait/landscape).
 *  - Pasa avgPoseVisibility a CanvasView y UIView para indicadores de calidad.
 *  - Escucha onBaselineAutoRecalibrated de JumpModel para disparar toasts en UIView.
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

  private activeSource: 'video' | 'none' = 'none';
  private currentObjectUrl: string | null = null;
  private animationFrameId: number | null = null;
  private lastLandmarks: any = null;
  private videoStopTimeout: number | null = null;

  // Optimizaciones de rendimiento móvil
  private lastInferenceMs: number = 0;
  private lastVideoWidth: number = 0;
  private lastVideoHeight: number = 0;
  // En móvil se limita a ~30fps para la inferencia de pose; en desktop se permite hasta 60fps
  private readonly INFERENCE_INTERVAL_MS: number = this.isMobile() ? 34 : 17;

  // Calidad de detección y notificaciones
  private lastAvgVisibility: number = 0;   // promedio de visibilidad de keypoints clave
  private lastLandmarkSeenMs: number = 0;  // última vez que se detectó una persona
  private poseLostNotified: boolean = false; // evita notificaciones repetidas

  // Orientación del dispositivo
  private isPortrait: boolean = true;

  constructor() {
    this.uiView = new UIView();
    this.canvasView = new CanvasView(this.uiView.getCanvasElement(), this.isMobile());
    this.poseModel = new PoseModel();
    this.jumpModel = new JumpModel();

    // Detectar orientación inicial
    this.isPortrait = window.innerHeight > window.innerWidth;

    // Escuchar cuando se completa un salto (en modo video: detener tras 2s)
    this.jumpModel.onJumpCompleted = (peakCm) => {
      // Actualizar rutina y progreso
      const lastJump = this.jumpModel.getLastJumpCm();
      this.uiView.updateRoutineAndProgress(peakCm, lastJump);

      if (this.activeSource === 'video') {
        console.log(`¡Salto medido exitosamente (${peakCm.toFixed(1)} cm)! Deteniendo y eliminando el video...`);
        if (this.videoStopTimeout) window.clearTimeout(this.videoStopTimeout);
        this.videoStopTimeout = window.setTimeout(() => {
          if (this.activeSource === 'video') {
            this.stopActiveSource();
          }
        }, 2000);
      }
    };

    // Toast al calibrar y fijar automáticamente el suelo
    this.jumpModel.onBaselineCalibrated = (isLocked) => {
      if (isLocked) {
        this.uiView.showToast("🔒 Suelo calibrado y fijado", 'success');
      } else {
        this.uiView.showToast("🎯 Suelo detectado automáticamente", 'info');
      }
    };

    // Toast y celebración visual al romper el récord personal
    this.jumpModel.onNewRecord = (peakCm) => {
      this.uiView.triggerRecordCelebration(peakCm);
    };

    // Notificación al estimar automáticamente la estatura 3D del atleta
    this.jumpModel.onAutoHeightEstimated = (estimatedCm) => {
      this.uiView.updateUserHeightInput(estimatedCm);
      this.uiView.showToast(`📏 Estatura estimada por IA: ${estimatedCm} cm`, 'info');
    };

    this.init();
  }

  /**
   * Inicializa los componentes de la aplicación y escucha los eventos de la UI.
   */
  private async init(): Promise<void> {
    // Sincronizar valores iniciales de la UI
    this.uiView.setInitialValues(
      this.jumpModel.getUserHeightCm()
    );

    // Vincular eventos de usuario desde la Vista UI
    this.uiView.bindEvents({
      onSelectVideoFile: (file) => this.loadVideoFile(file),
      onResetRecord: () => this.resetRecord(),
      onChangeUserHeight: (heightCm) => {
        this.jumpModel.setUserHeightCm(heightCm);
        this.uiView.showToast(`📏 Estatura actualizada: ${heightCm} cm`, 'success');
      },
      onShowRoutine: () => {
        const lastRecord = this.jumpModel.getMaxJumpCm();
        const lastJump = this.jumpModel.getLastJumpCm();
        if (lastRecord > 0) {
          this.uiView.updateRoutineAndProgress(lastRecord, lastJump);
        } else {
          this.uiView.showToast("📊 Registra un salto primero para generar tu rutina", 'info');
        }
      }
    });

    try {
      // Cargar modelo de MediaPipe: Full en desktop (más preciso), Lite en móvil (más rápido)
      const useLiteModel = this.isMobile();
      this.uiView.updateLoadingState(true, `Iniciando MediaPipe Pose (${useLiteModel ? 'Lite' : 'Full'})...`);
      await this.poseModel.initialize((msg) => {
        this.uiView.updateLoadingState(true, msg);
      }, !useLiteModel);
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

    await new Promise<void>((resolve) => {
      videoEl.onloadedmetadata = () => {
        videoEl.play();
        resolve();
      };
    });

    this.activeSource = 'video';
    this.jumpModel.setIsVideoMode(true);
    this.uiView.setSourceState('video', file.name);

    // Iniciar bucle de procesamiento de cuadros
    if (this.animationFrameId === null) {
      this.processLoop();
    }
  }

  /**
   * Detiene la fuente activa (video).
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
          this.lastLandmarkSeenMs = nowMs;

          // Notificar si la pose se recupera después de perderse
          if (this.poseLostNotified) {
            this.poseLostNotified = false;
            this.uiView.showToast("✅ Persona detectada", 'success');
          }

          // Calcular visibilidad media de los keypoints clave (hombros, caderas, rodillas, tobillos)
          const keyIndices = [11, 12, 23, 24, 25, 26, 27, 28];
          this.lastAvgVisibility = keyIndices.reduce(
            (s, i) => s + ((landmarks[i]?.visibility) ?? 0), 0
          ) / keyIndices.length;

          // 2. Procesar lógica del salto en el JumpModel con landmarks 2D y 3D (worldLandmarks)
          const worldLandmarks = (poseResult.worldLandmarks && poseResult.worldLandmarks.length > 0)
            ? poseResult.worldLandmarks[0]
            : undefined;
          this.jumpModel.processFrame(landmarks, videoEl.videoHeight, nowMs, worldLandmarks);
        } else {
          this.lastAvgVisibility = 0;

          // Notificar si no se detecta persona por más de 1.5 segundos
          if (!this.poseLostNotified && this.lastLandmarkSeenMs > 0
            && (nowMs - this.lastLandmarkSeenMs) > 1500) {
            this.poseLostNotified = true;
            this.uiView.showToast("⚠️ Ajústame tu posición — no se detecta la persona", 'warning');
          }
        }
      }

      // 3. Renderizar siempre con los últimos landmarks conocidos (suave a 60fps)
      this.canvasView.render(
        this.lastLandmarks,
        this.jumpModel.getBaselineHipY(),
        this.jumpModel.getBaselineAnkleY(),
        this.jumpModel.getIsBaselineLocked(),
        this.jumpModel.getPeakHipY(),
        this.jumpModel.getCurrentJumpCm(),
        this.jumpModel.getCurrentState(),
        this.lastAvgVisibility
      );

      // 4. Actualizar métricas y estado en UIView
      this.uiView.updateMetrics(
        this.jumpModel.getCurrentJumpCm(),
        this.jumpModel.getMaxJumpCm(),
        this.jumpModel.getCurrentState(),
        this.jumpModel.getIsBaselineLocked(),
        this.jumpModel.getLastFlightTimeMs(),
        this.jumpModel.getLastDisplacementHeightCm(),
        this.lastAvgVisibility
      );
    }

    // Solicitar siguiente frame
    this.animationFrameId = requestAnimationFrame(this.processLoop);
  };

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
