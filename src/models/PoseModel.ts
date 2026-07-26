/**
 * ============================================================================
 * MODELO: PoseModel.ts
 * Responsabilidad: Inicializar MediaPipe PoseLandmarker (GPU/WASM) y procesar
 * frames de video para extraer puntos clave del cuerpo (Landmarks).
 * ============================================================================
 */

import { PoseLandmarker, FilesetResolver, PoseLandmarkerResult } from "@mediapipe/tasks-vision";

export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export class PoseModel {
  private poseLandmarker: PoseLandmarker | null = null;
  private isInitialized: boolean = false;

  /**
   * Inicializa el PoseLandmarker utilizando el CDN oficial de MediaPipe WASM.
   * Intenta primero el delegado GPU con un tiempo de espera de seguridad, y realiza
   * fallback automático a CPU si la GPU tarda o genera un error.
   */
  public async initialize(onProgress?: (msg: string) => void): Promise<void> {
    try {
      if (onProgress) onProgress("Cargando motor de visión MediaPipe (WASM 0.10.14)...");

      // Usar la versión exacta instalada en package.json (0.10.14) para evitar descalibres WASM/JS
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );

      const modelAssetPath =
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

      if (onProgress) onProgress("Iniciando aceleración GPU para PoseLandmarker...");

      // Función auxiliar con tiempo límite (timeout) para evitar bloqueos si la GPU no responde
      const createWithTimeout = (delegate: "GPU" | "CPU", timeoutMs: number) => {
        return Promise.race([
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath,
              delegate
            },
            runningMode: "VIDEO",
            numPoses: 1
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout de ${timeoutMs}ms al iniciar delegado ${delegate}`)), timeoutMs)
          )
        ]);
      };

      try {
        // Intentar GPU con tiempo máximo de 6 segundos
        this.poseLandmarker = await createWithTimeout("GPU", 6000);
        console.log("MediaPipe PoseLandmarker inicializado con éxito usando delegado GPU.");
      } catch (gpuError) {
        console.warn("GPU delegate falló o superó el tiempo límite. Cambiando a delegado CPU...", gpuError);
        if (onProgress) onProgress("Cambiando a modo CPU para garantizar compatibilidad...");

        // Fallback a CPU sin restricción estricta de tiempo
        this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath,
            delegate: "CPU"
          },
          runningMode: "VIDEO",
          numPoses: 1
        });
        console.log("MediaPipe PoseLandmarker inicializado en modo CPU.");
      }

      this.isInitialized = true;
      if (onProgress) onProgress("¡MediaPipe PoseLandmarker listo!");
    } catch (error) {
      console.error("Error crítico al inicializar MediaPipe Pose:", error);
      throw error;
    }
  }

  /**
   * Procesa un cuadro de video en tiempo real.
   * @param videoElement Elemento HTMLVideoElement con el stream activo
   * @param timestampMs Marca de tiempo actual en milisegundos
   */
  public detectPose(videoElement: HTMLVideoElement, timestampMs: number): PoseLandmarkerResult | null {
    if (!this.isInitialized || !this.poseLandmarker) {
      return null;
    }
    if (videoElement.readyState < 2) {
      return null;
    }
    return this.poseLandmarker.detectForVideo(videoElement, timestampMs);
  }

  public getReadyState(): boolean {
    return this.isInitialized;
  }
}
