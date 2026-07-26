/**
 * ============================================================================
 * MODELO: JumpModel.ts
 * Responsabilidad: Lógica de negocio del salto usando fórmula de física
 * cinemática (h = g × t² / 8) basada en el tiempo de vuelo.
 * No requiere conocer la estatura del usuario.
 * ============================================================================
 */

import { NormalizedLandmark } from "./PoseModel";

export type JumpState = 'IDLE' | 'PREPARING' | 'IN_AIR' | 'LANDED';

// Constante de gravedad terrestre en cm/s²
const GRAVITY_CM_S2 = 981;

export class JumpModel {
  // Calibración visual (solo para dibujar en canvas, no para la medición real)
  private baselineHipY: number | null = null;

  // ── Suavizado de señal EMA (Exponential Moving Average) ──
  // Reduce el ruido de MediaPipe promediando la señal de cadera con frames anteriores.
  // alpha = 0.35 balancea suavidad y respuesta rápida.
  private smoothedHipY: number | null = null;
  private readonly EMA_ALPHA = 0.35;

  // ── Confirmación de N frames consecutivos antes de cambiar estado ──
  // Evita que un solo frame ruidoso dispare transiciones falsas.
  private airFrameCount: number = 0;
  private airStartCandidateMs: number = 0; // timestamp del primer frame candidato a vuelo
  private landFrameCount: number = 0;
  private landCandidateMs: number = 0;     // timestamp del primer frame candidato a aterrizaje
  private readonly CONFIRM_FRAMES = 3;

  // ── Auto-recalibración dinámica del baseline ──
  // Después de DYNAMIC_BASELINE_DELAY_MS en IDLE, el baseline se adapta suavemente
  // a la posición actual del usuario (compensa si se mueve entre saltos).
  private idleSinceMs: number = 0;
  private readonly DYNAMIC_BASELINE_DELAY_MS = 2000; // esperar 2s antes de derivar
  private readonly BASELINE_DRIFT_ALPHA = 0.02;       // velocidad de adaptación por frame

  // Estado del salto
  private currentState: JumpState = 'IDLE';
  private currentJumpCm: number = 0;
  private peakJumpCm: number = 0;
  private maxJumpCm: number = 0;
  private peakHipY: number = Infinity; // mínima Y alcanzada en el salto (más arriba en canvas)

  // Tiempos y visualización
  private flightStartTime: number = 0;
  private lastFlightTimeMs: number = 0;
  private landedResetTimer: number | null = null;

  // Umbrales en porcentaje de la altura del video (independientes de escala)
  private readonly jumpThresholdRatio: number = 0.015;  // 1.5% del alto del canvas (~10px en 720p)
  private readonly crouchThresholdRatio: number = 0.02; // 2% del alto del canvas (~14px en 720p)

  // Callbacks al exterior
  public onJumpCompleted?: (peakJumpCm: number) => void;
  public onBaselineCalibrated?: () => void;
  public onNewRecord?: (peakJumpCm: number) => void;

  private static readonly STORAGE_KEY = 'youcanfly_record_cm';

  constructor() {
    // Recuperar récord guardado en localStorage (persiste entre sesiones)
    const saved = parseFloat(localStorage.getItem(JumpModel.STORAGE_KEY) ?? '0');
    if (!isNaN(saved) && saved > 0) {
      this.maxJumpCm = saved;
    }
  }

  // ── Getters públicos ──

  public getBaselineHipY(): number | null {
    return this.baselineHipY;
  }

  public getCurrentJumpCm(): number {
    return Math.max(0, this.currentJumpCm);
  }

  public getMaxJumpCm(): number {
    return this.maxJumpCm;
  }

  public getCurrentState(): JumpState {
    return this.currentState;
  }

  public getPeakHipY(): number {
    return this.peakHipY;
  }

  public getLastFlightTimeMs(): number {
    return this.lastFlightTimeMs;
  }

  /**
   * Calcula la altura del salto en centímetros usando la fórmula de cinemática:
   *   h = (g × t²) / 8
   * Donde t es el tiempo total de vuelo en segundos y g = 981 cm/s².
   * Esta fórmula se deriva de que el tiempo de vuelo total es t = 2 × sqrt(2h/g),
   * por lo tanto h = g × t² / 8.
   */
  private calculateJumpHeightFromFlightTime(flightTimeMs: number): number {
    const t = flightTimeMs / 1000; // convertir a segundos
    return (GRAVITY_CM_S2 * t * t) / 8;
  }

  /**
   * Calibra la línea de suelo (baseline) usando la posición actual de la cadera.
   * Sincroniza también el valor suavizado EMA para evitar una transición brusca.
   */
  public calibrateBaseline(landmarks: NormalizedLandmark[], canvasHeight: number): void {
    if (!landmarks || landmarks.length < 33) return;

    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    const hipYPx = ((leftHip.y + rightHip.y) / 2) * canvasHeight;

    this.baselineHipY = hipYPx;
    this.smoothedHipY = hipYPx; // Sincronizar el filtro EMA con el nuevo baseline
    this.peakHipY = hipYPx;
    this.currentJumpCm = 0;
    this.currentState = 'IDLE';
    this.airFrameCount = 0;
    this.landFrameCount = 0;
    this.idleSinceMs = performance.now();

    if (this.onBaselineCalibrated) this.onBaselineCalibrated();
  }

  /**
   * Procesa la posición actual de los landmarks y actualiza la máquina de estados.
   * Aplica suavizado EMA y confirmación de N frames antes de cada transición.
   */
  public processFrame(landmarks: NormalizedLandmark[], canvasHeight: number, nowMs: number): void {
    if (!landmarks || landmarks.length < 33) return;

    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    const rawHipY = ((leftHip.y + rightHip.y) / 2) * canvasHeight;

    // ── Aplicar suavizado EMA ──
    if (this.smoothedHipY === null) {
      this.smoothedHipY = rawHipY;
    } else {
      this.smoothedHipY = this.EMA_ALPHA * rawHipY + (1 - this.EMA_ALPHA) * this.smoothedHipY;
    }
    const currentHipY = this.smoothedHipY;

    // Auto-calibrar al primer frame
    if (this.baselineHipY === null) {
      this.calibrateBaseline(landmarks, canvasHeight);
      this.idleSinceMs = nowMs;
      return;
    }

    // Distancia vertical respecto a la línea de base (píxeles)
    // Positivo = por encima del suelo (elevación)
    const deltaYPx = this.baselineHipY - currentHipY;
    const jumpThresholdPx = canvasHeight * this.jumpThresholdRatio;
    const crouchThresholdPx = canvasHeight * this.crouchThresholdRatio;

    switch (this.currentState) {
      case 'IDLE':
        this.currentJumpCm = 0;

        // ── Auto-recalibración dinámica del baseline ──
        // Si el usuario lleva más de 2s en reposo, el baseline se adapta suavemente
        // a su posición actual para corregir drift entre sesiones.
        if (nowMs - this.idleSinceMs > this.DYNAMIC_BASELINE_DELAY_MS) {
          this.baselineHipY = (1 - this.BASELINE_DRIFT_ALPHA) * this.baselineHipY
                             + this.BASELINE_DRIFT_ALPHA * currentHipY;
        }

        if (currentHipY > this.baselineHipY + crouchThresholdPx) {
          // Flexión previa detectada → PREPARING
          this.currentState = 'PREPARING';
          this.airFrameCount = 0;
        } else if (deltaYPx > jumpThresholdPx) {
          // ── Confirmación: despegue directo (sin flexión previa) ──
          this.airFrameCount++;
          if (this.airFrameCount === 1) this.airStartCandidateMs = nowMs;
          if (this.airFrameCount >= this.CONFIRM_FRAMES) {
            this.transitionToAir(currentHipY, this.airStartCandidateMs);
          }
        } else {
          this.airFrameCount = 0;
        }
        break;

      case 'PREPARING':
        this.currentJumpCm = 0;

        if (deltaYPx > jumpThresholdPx) {
          // ── Confirmación: despegue desde flexión ──
          this.airFrameCount++;
          if (this.airFrameCount === 1) this.airStartCandidateMs = nowMs;
          if (this.airFrameCount >= this.CONFIRM_FRAMES) {
            this.transitionToAir(currentHipY, this.airStartCandidateMs);
          }
        } else if (Math.abs(deltaYPx) < jumpThresholdPx) {
          // Volvió a posición erguida sin saltar → IDLE
          this.airFrameCount = 0;
          this.currentState = 'IDLE';
          this.idleSinceMs = nowMs;
        } else {
          // Aún agachado entre umbrales: esperar
          this.airFrameCount = 0;
        }
        break;

      case 'IN_AIR': {
        // Registrar la cota máxima alcanzada (mínima coordenada Y en canvas)
        if (currentHipY < this.peakHipY) {
          this.peakHipY = currentHipY;
        }

        // Altura estimada en vivo usando el tiempo parcial de vuelo
        const partialFlightMs = nowMs - this.flightStartTime;
        this.currentJumpCm = this.calculateJumpHeightFromFlightTime(partialFlightMs);

        if (deltaYPx <= jumpThresholdPx / 2) {
          // ── Confirmación de aterrizaje ──
          this.landFrameCount++;
          if (this.landFrameCount === 1) this.landCandidateMs = nowMs;
          if (this.landFrameCount >= this.CONFIRM_FRAMES) {
            this.landJump(this.landCandidateMs);
          }
        } else {
          this.landFrameCount = 0;
        }
        break;
      }

      case 'LANDED':
        // Mantiene visible el resultado del pico del salto registrado
        this.currentJumpCm = this.peakJumpCm;

        // Si el usuario salta de nuevo inmediatamente
        if (deltaYPx > jumpThresholdPx) {
          this.airFrameCount++;
          if (this.airFrameCount === 1) this.airStartCandidateMs = nowMs;
          if (this.airFrameCount >= this.CONFIRM_FRAMES) {
            if (this.landedResetTimer) window.clearTimeout(this.landedResetTimer);
            this.transitionToAir(currentHipY, this.airStartCandidateMs);
          }
        } else {
          this.airFrameCount = 0;
        }
        break;
    }
  }

  /**
   * Finaliza el salto: calcula altura real, actualiza récord y dispara callbacks.
   * Usa landTimeMs (primer frame de aterrizaje confirmado) para mayor precisión.
   */
  private landJump(landTimeMs: number): void {
    this.currentState = 'LANDED';
    this.landFrameCount = 0;
    this.lastFlightTimeMs = landTimeMs - this.flightStartTime;

    this.peakJumpCm = this.calculateJumpHeightFromFlightTime(this.lastFlightTimeMs);
    this.currentJumpCm = this.peakJumpCm;

    // Registrar nuevo récord si aplica
    if (this.peakJumpCm > this.maxJumpCm) {
      this.maxJumpCm = Number(this.peakJumpCm.toFixed(1));
      localStorage.setItem(JumpModel.STORAGE_KEY, String(this.maxJumpCm));
      if (this.onNewRecord) this.onNewRecord(this.maxJumpCm);
    }

    if (this.onJumpCompleted) {
      this.onJumpCompleted(this.peakJumpCm);
    }

    // Temporizador para regresar al estado IDLE tras mostrar el resultado
    if (this.landedResetTimer) window.clearTimeout(this.landedResetTimer);
    this.landedResetTimer = window.setTimeout(() => {
      if (this.currentState === 'LANDED') {
        this.currentState = 'IDLE';
        this.idleSinceMs = performance.now();
        if (this.baselineHipY !== null) {
          this.peakHipY = this.baselineHipY;
        }
      }
    }, 3000);
  }

  private transitionToAir(initialHipY: number, nowMs: number): void {
    this.currentState = 'IN_AIR';
    this.peakHipY = initialHipY;
    this.flightStartTime = nowMs;
    this.airFrameCount = 0;
    this.landFrameCount = 0;
  }

  /**
   * Reinicia la métrica de récord máximo.
   */
  public resetRecord(): void {
    this.maxJumpCm = 0;
    this.peakJumpCm = 0;
    this.currentJumpCm = 0;
    localStorage.removeItem(JumpModel.STORAGE_KEY);
  }
}
