/**
 * ============================================================================
 * MODELO: PoseModel.ts
 * Responsabilidad: Inicializar MediaPipe PoseLandmarker (GPU/WASM) y procesar
 * frames de video para extraer puntos clave del cuerpo (Landmarks).
 *
 * Mejoras v2:
 *  - Soporte para modelo `pose_landmarker_full` en desktop (mayor precisión).
 *  - El modelo se selecciona en tiempo de inicialización con el parámetro `useFullModel`.
 * ============================================================================
 */

import { PoseLandmarker, FilesetResolver, PoseLandmarkerResult } from "@mediapipe/tasks-vision";

export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

const MODEL_LITE_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const MODEL_FULL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

export class PoseModel {
  private poseLandmarker: PoseLandmarker | null = null;
  private isInitialized: boolean = false;

  /**
   * Inicializa el PoseLandmarker utilizando el CDN oficial de MediaPipe WASM.
   * Intenta primero el delegado GPU con un tiempo de espera de seguridad, y realiza
   * fallback automático a CPU si la GPU tarda o genera un error.
   *
   * @param onProgress  Callback opcional de progreso para mostrar al usuario.
   * @param useLiteModel Si es true, usa el modelo `lite` (menor consumo, ideal móvil).
   */
  public async initialize(
    onProgress?: (msg: string) => void,
    useLiteModel: boolean = false
  ): Promise<void> {
    try {
      if (onProgress) onProgress(`Cargando motor MediaPipe WASM (${useLiteModel ? 'Lite' : 'Full'})...`);

      // Usar la versión exacta instalada en package.json (0.10.14) para evitar descalibres WASM/JS
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );

      // Modelo Full: mayor precisión en desktop (GPU potente)
      // Modelo Lite: menor consumo para móvil
      const modelAssetPath = useLiteModel
        ? "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
        : "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
      
      const modelLabel = useLiteModel ? "Lite" : "Full (alta precisión)";

      if (onProgress) {
        onProgress(`Iniciando aceleración GPU (modelo ${modelLabel})...`);
      }

      console.log(`[PoseModel] Usando modelo ${modelLabel}: ${modelAssetPath}`);

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
            setTimeout(
              () => reject(new Error(`Timeout de ${timeoutMs}ms al iniciar delegado ${delegate}`)),
              timeoutMs
            )
          )
        ]);
      };

      try {
        // Intentar GPU (modelo Full puede tardar más en inicializar)
        const gpuTimeoutMs = useLiteModel ? 6000 : 12000;
        this.poseLandmarker = await createWithTimeout("GPU", gpuTimeoutMs);
        console.log(`[PoseModel] PoseLandmarker (${modelLabel}) inicializado con delegado GPU.`);
      } catch (gpuError) {
        console.warn("[PoseModel] GPU delegate falló o superó el tiempo límite. Cambiando a CPU...", gpuError);
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
        console.log(`[PoseModel] PoseLandmarker (${modelLabel}) inicializado en modo CPU.`);
      }

      this.isInitialized = true;
      if (onProgress) onProgress(`¡MediaPipe Pose listo! (Modelo ${modelLabel})`);
    } catch (error) {
      console.error("[PoseModel] Error crítico al inicializar MediaPipe Pose:", error);
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
